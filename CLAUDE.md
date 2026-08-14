# Strides — notes for Claude sessions working in this repo

Browser-only React/TypeScript app: webcam/upload/demo video → MoveNet pose detection (TF.js,
WebGL) → running-form heuristics → results UI. No backend.

## Spec-driven changes: openspec

This repo uses [openspec](openspec/) for anything beyond a trivial fix. Convention established
across this project's history:

```
openspec new change "<kebab-case-name>"
# write proposal.md, specs/<capability>/spec.md (delta), design.md, tasks.md
openspec validate <name> --strict
# implement against tasks.md, checking items off as you go
openspec archive <name> --yes   # folds the delta into openspec/specs/, do this once shipped
```

- `openspec/specs/` is the current, authoritative behavior contract per capability.
- `openspec/changes/` holds in-flight change proposals; `openspec/changes/archive/` holds
  completed ones. **Archive promptly after a change ships and is verified** — letting several
  changes pile up unarchived means `openspec/specs/` drifts out of sync with what's actually in
  the codebase (this happened once this session; six changes had to be archived in a batch to
  catch the main spec back up before a later change could reference what they'd added).
- If a change removes every requirement from a capability, delete that capability's spec file
  entirely rather than archiving to an empty stub — `openspec validate` rejects a spec with zero
  requirements, and an empty file doesn't mean anything anyway.
- MODIFIED/REMOVED requirement deltas must reuse the **exact existing requirement/scenario
  title text** — the archive step matches by name, not content, and silently drops anything it
  can't match. If a requirement's behavior fully reverses (not just changes), it's usually
  cleaner to REMOVE the old one (with Reason/Migration) and ADD a new one under a fresh name,
  rather than fighting the validator over a MODIFIED block that no longer resembles the
  original.

## Live-browser verification harness

Type checking and unit tests verify code correctness, not that a change actually works end to
end in a browser. This repo's pose-detection pipeline especially needs a real run — unit tests
mock the detector — so verify UI/pipeline changes live before calling them done.

**Use headless Chromium via Playwright, with real GPU acceleration — not SwiftShader.**

```js
import { chromium } from 'playwright'
const browser = await chromium.launch({
  args: ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist'],
})
```

Do **not** use `--use-angle=swiftshader --enable-unsafe-swiftshader` — that forces software
rendering, which was slow enough this session to sometimes sample only 1 detection frame across
an entire ~9s clip (a one-time cold-start fluke aside, steady-state it undercounts badly).
`--headless=new --enable-gpu --ignore-gpu-blocklist` gets real hardware acceleration (verified
via `WEBGL_debug_renderer_info`: `ANGLE Metal Renderer` on Apple Silicon, not
`SwiftShader Device`) and is dramatically faster and more representative of what a real user's
browser does.

**Driving the app:**
```bash
npm run dev -- --port 5173 --strictPort &
# poll: curl -sf http://localhost:5173
```
- `page.getByRole('button', { name: /try a demo video/i }).click()` loads a fixed reference
  clip (`src/video/DemoVideoButton.tsx`) — the standard clip for before/after comparisons.
  Alternative: Upload tab + `input[type=file]` + `setInputFiles(path)` for a different clip.
- Analysis starts **automatically** once the clip is ready and the detector has loaded — no
  button click needed. Wait for `page.getByText(/analyzing|processing results/i)` then
  `page.getByText(/analysis complete/i)` (the latter can take 10-90s depending on clip
  length/resolution and whether the detector is cold).

**Reading results — `analysisDiagnostics`, not screen-scraped card text:**

In development builds only, `useVideoAnalysis` auto-logs TWO console lines per run
(add-background-scale-pass):

1. `[analysis-diagnostics] {...}` the moment a run reaches `phase: 'ready'` — a JSON object with
   per-keypoint detected/interpolated/unrecoverable counts, raw view-detection diagnostics,
   sampling detected/missing counts, and every metric's `value`/`confidence`/`viewFit`/
   `frameCoverage`/`caveat` in one place (`src/results/analysisDiagnostics.ts`). This line is
   byte-identical to what it was before the background scale pass existed: PRIMARY pass only,
   and `'scaleCalibration' in <payload>` discriminates the PRIMARY backend only (a
   MoveNet-primary run never has the key here, even after a successful scale pass).
2. `[analysis-diagnostics:scale-pass] {...}` when the background MediaPipe scale pass reaches a
   terminal status — `{ status: 'done'|'failed'|'skipped', reason?: 'disabled'|'primary-scale',
   error?: string, diagnostics?: AnalysisDiagnostics }`. `diagnostics` (the scale pass's own
   full object, `scaleCalibration` included) rides along only on `'done'`. On the default
   MoveNet primary this line arrives roughly one clip-replay after "Analysis complete" (the pass
   replays the clip in real time); wait for it separately.

Capture both via `page.on('console', ...)`. **Match the first line's prefix exclusively** —
`text.startsWith('[analysis-diagnostics]') && !text.startsWith('[analysis-diagnostics:')` — or
the scale-pass line will collide with it; the second is `startsWith('[analysis-diagnostics:scale-pass]')`.
`JSON.parse()` the rest of each. Neither line logs in a production build
(`import.meta.env.DEV`-gated) — don't try to read them from a `vite build` output.

**Config overrides for comparing pipeline variants**, dev-only, read once per run:
- `window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__` — partial
  `SamplingRobustnessConfig` (`src/results/samplingRobustnessConfig.ts`): keypoint-confidence
  filtering, interpolation gap tolerance, detection error tolerance, per-frame timeout.
- `window.__STRIDES_POSE_BACKEND_OVERRIDE__` — partial `PoseDetectorConfig`
  (`src/pose/poseBackendConfig.ts`): `{ backend: 'movenet' | 'blazepose' | 'posenet' |
  'mediapipePoseLandmarker', movenetModelType?: 'lightning' | 'thunder', trackingCrop?:
  Partial<TrackingCropConfig> }`. `movenetModelType` and `trackingCrop`
  (`src/pose/backends/trackingCropConfig.ts`: enable flag, keypoint-confidence gate, padding
  multiplier, minimum crop size, reacquisition-loss debounce) only matter when `backend:
  'movenet'` (default `'lightning'`, default tracking-crop config respectively); ignored
  otherwise. `trackingCrop` merges shallowly, one level deep, over the default — set `{
  trackingCrop: { enabled: false } }` to A/B against the pre-tracking-crop baseline. Read once
  per detector creation in `usePoseDetector.ts`. Selects the PRIMARY detector only — the
  background scale pass's detector (`src/pose/scalePassDetector.ts`) is hardcoded to
  `mediapipePoseLandmarker` and never reads this.
- `window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__` — partial `ScalePassConfig`
  (`src/results/scalePassConfig.ts`): `{ enabled: boolean }`, the background MediaPipe scale
  pass's kill switch (default on). Read once per analysis run, at the moment the primary pass
  reaches 'ready'. `{ enabled: false }` makes the run behave exactly as it did before the scale
  pass existed (scale-pass line reports `'skipped'`/`'disabled'`).
- Math (`HeuristicsConfig`) selection doesn't have an override point yet — deferred, see
  "Backlog" below.
- **Set overrides with `page.addInitScript()`, not `page.evaluate()`.** Auto-analyze can start
  before an `evaluate()` call after `goto()` lands; `addInitScript()` guarantees the global
  exists before any page script runs, including before React mounts.

```js
await page.addInitScript((override) => {
  window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = override
}, { robustness: { minKeypointConfidence: 0.9 } })
await page.addInitScript((backend) => {
  window.__STRIDES_POSE_BACKEND_OVERRIDE__ = { backend }
}, 'blazepose')
await page.goto('http://localhost:5173')
// ...drive the demo clip, capture [analysis-diagnostics] as above
```

**Known issues — two of the four registered backends are broken (2026-08-11).** MoveNet is the
only `@tensorflow-models/pose-detection` model in this installed version (`2.1.3`) confirmed
working end-to-end in this environment; both non-MoveNet models from that same package fail, in
different ways:
- **`blazepose`** (`src/pose/backends/blazepose.ts`, `SupportedModels.BlazePose`, `runtime:
  'tfjs'`) loads and runs — unit tests pass, model assets fetch fine — but live inference returns
  `score: NaN` and `x/y/z: NaN` for every keypoint, every frame. Ruled out: GPU/WebGL float
  precision (CPU backend reproduces it identically), model size (`lite` same as `full`), and the
  stateful smoothing filter (`enableSmoothing: false` reproduces it too, and the symptom hits
  frame 1 before filter state could accumulate). `pose-detection@2.1.3`'s declared peer range for
  `tfjs-core` (`^4.10.0`) is satisfied by the installed `4.22.0`, so it isn't an obvious
  declared-range version skew. Root cause not found — next things to try: a real (non-headless)
  browser to rule out this specific Playwright/Chromium/macOS-ANGLE combination, or bisecting
  `pose-detection` versions.
- **`posenet`** (`src/pose/backends/posenet.ts`, `SupportedModels.PoseNet`) throws `Error: roi
  width cannot be 0` (from the package's shared `shared/calculators/image_utils.js`
  `validateSize`) on every single call to `estimatePoses`, tripping the app's
  30-consecutive-failures abort within the first ~10s. Not investigated further — PoseNet is
  MoveNet's superseded predecessor and was always a low-priority "if a lower baseline is useful"
  backend (GitHub #26), not an accuracy candidate worth debugging a third-party ROI-calculator
  bug for.

**Working alternative — `mediapipePoseLandmarker`** (`src/pose/backends/mediapipePoseLandmarker.ts`,
new `@mediapipe/tasks-vision` dependency). A different runtime entirely from the other three —
MediaPipe's own WASM/GPU-delegate pipeline (`PoseLandmarker.detectForVideo`), not
`@tensorflow-models/pose-detection`/`tfjs-core` — added specifically to sidestep the `blazepose`
NaN bug, and it works: full analysis completes, all 7 metrics resolve. Not to be confused with
the older, deprecated `@mediapipe/pose` package this repo already stubs out dead in
`backends/__shims__/mediapipe-pose.ts` (unrelated package, still unused).

**Pipeline comparison results (demo clip, 3 trials per variant, real GPU):**

| | MoveNet Lightning (baseline) | MoveNet Thunder | MediaPipe PoseLandmarker |
|---|---|---|---|
| detectedFrames (median) | ~75-78 | 63 (one trial: 20 — cold-start-like anomaly, see below) | 57, identical all 3 trials |
| detection ratio | ~0.34-0.35 | lower, more variable | ~0.26 |
| view confidence | ~0.76-0.79 | 0.35-0.50 | ~0.68, identical all 3 trials |
| run-to-run variance | normal (GPU float non-associativity) | high | near-zero — suspiciously more deterministic than the tfjs path |

- **MoveNet Thunder is worse than Lightning here**, not better — lower coverage, lower confidence
  on every metric, more variable. One Thunder trial sampled only 92 total frames vs. ~219-220 for
  every other trial (all variants) — an anomaly not root-caused; possibly a heavier-model
  cold-start effect distinct from the SwiftShader cold-start fluke below, not confirmed.
- **MediaPipe PoseLandmarker disagrees with MoveNet on cadence and kneeFlexion specifically**
  (166.7 steps/min vs. MoveNet's 107-125; ~100° vs. ~117-120°), while trunkLean and
  footStrikePattern land close to MoveNet's values. Lower view confidence and detection ratio
  than MoveNet Lightning. Whether MediaPipe or MoveNet is *more correct* on this clip is
  unverified — no ground truth was established, this is a disagreement, not a verdict.
- Full GitHub issues: #24 (MoveNet variant), #25 (MediaPipe Tasks Vision), #26 (PoseNet).

**Determinism caveat**: the `tfjs-core` pipeline (MoveNet, BlazePose, PoseNet) is not bit-exact
run-to-run even with identical input and config — GPU float non-associativity and minor
frame-timing jitter produce small variance (e.g. 74 vs. 75 detected frames across
otherwise-identical MoveNet trials, observed this session; much larger variance observed for
MoveNet Thunder, see above). The MediaPipe Tasks Vision path was, by contrast, bit-identical
across all 3 trials this session — not yet confirmed whether that holds in general or was
coincidental to this clip/environment. For a real before/after comparison, run a few trials per
variant and compare medians/ranges, not single runs.

**Environment gotcha — no local Playwright install, and its cached browser binary is
version-mismatched (2026-08-12).** This repo has no `playwright` devDependency. Driver scripts
written here fail to resolve the import; run them from a sibling project that has `playwright`
installed instead (`node script.mjs` with `cwd` in that project), or `npm i -D playwright`
here if a persistent local install is preferred. Separately, `chromium.launch()`'s default
version-pinned browser lookup can fail if the only cached binaries under
`~/Library/Caches/ms-playwright/` don't match the installed `playwright` package's expected
revision (`Executable doesn't exist at .../chromium_headless_shell-<rev>/...`). Bypass by
pointing `executablePath` directly at a cached full-Chromium binary instead of `headless_shell`,
e.g. `~/Library/Caches/ms-playwright/chromium-<rev>/chrome-mac-arm64/Google Chrome for
Testing.app/Contents/MacOS/Google Chrome for Testing` — `ls
~/Library/Caches/ms-playwright/` to see what's actually cached on the machine first. Still pass
`args: ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist']`, same as above.

**Testing a candidate calculation before it's wired into the pipeline.** To measure a new
metric/normalization idea against real clips without touching the shipped calc: (1) write the
candidate as a standalone function in its own `*.experimental.ts` file next to the metric it's
iterating on, reusing existing primitives (`resolveMidpoint`/`resolvePoint`/`estimateBodyScale`/
`findLocalExtrema`/`detectFootstrikes` etc. from `src/heuristics/`) rather than reinventing them;
(2) temporarily import it into `useVideoAnalysis.ts`'s dev-only diagnostics effect (right after
the existing `console.log('[analysis-diagnostics]', ...)` line) and log its result under its own
console prefix, e.g. `console.log('[my-experiment]', JSON.stringify(result))`; (3) drive the app
and capture that prefix via `page.on('console', ...)`, same as reading `[analysis-diagnostics]`;
(4) **revert the instrumentation and delete the experimental file when done** —
`git checkout -- src/results/useVideoAnalysis.ts` + `rm` the experimental file. Don't leave probe
scaffolding in the shipped pipeline between experiments or after concluding one — every round
this session followed exactly this cycle (add, measure, revert) rather than accumulating dead
debug code.

**Externally-sourced test clips (Google Drive links, phone recordings).** Google Drive direct-
download works with plain `curl` for files small enough to skip the virus-scan interstitial —
`curl -sL -c cookies.txt "https://drive.google.com/uc?export=download&id=<FILE_ID>" -o out.mov`;
check the result with `file out.mov` (an HTML confirmation page vs. an actual `ISO Media` file is
easy to tell apart). iPhone-recorded clips commonly arrive as HEVC-in-`.mov` — transcode to
H.264 (`ffmpeg -i in.mov -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -an out.mp4`)
before using them in a Chromium-driven pipeline; HEVC decode support outside Safari is spotty and
this app's canvas-based frame reads need a codec the browser can actually decode. **Container
duration/frame-count metadata can lie** — `ffprobe -show_entries format=duration` and the video
stream's declared `nb_frames` are not authoritative; cross-check with an actual decode pass
(`ffmpeg -i in.mov -map 0:v:0 -c copy -f null - 2>&1 | grep time=` or
`ffprobe -count_frames -show_entries stream=nb_read_frames`) — one clip this session declared 94
frames in its container metadata but only 66 were actually decodable, which broke this app's
frame-sampling loop down to a single sample for the whole clip (see "Vertical oscillation
accuracy investigation" below).

**Pulling and visually reviewing keyframes.** To sanity-check a calculated metric against what a
human sees: log the algorithm's extrema/amplitude timestamps via the experimental-probe pattern
above, then `ffmpeg -i clip.mp4 -ss <timestamp> -frames:v 1 -q:v 3 out.png` per timestamp (output
seeking — `-ss` after `-i` — for frame-accurate extraction; the video is usually short enough
that the slower full-decode isn't a real cost). Read the resulting PNGs directly (the `Read` tool
renders images) rather than trying to reason about pixel positions from data alone. A
`drawgrid=width=40:height=40` ffmpeg video filter overlaid before extraction turns this into an
actual ruler for comparing vertical positions across frames when a precise measurement (not just
a gut check) is needed — see the "Vertical oscillation accuracy investigation" section for a
worked example (manual grid-pixel measurement landed close to, and in two cases above, this
app's own calculated hip-bounce figures, which was evidence *against* the hip signal being
noisy/inflated).

## Vertical oscillation accuracy investigation (2026-08-12)

The `verticalOscillation` metric (`src/heuristics/verticalOscillation.ts`) was suspected of
reading too high (~18-25% of torso length on real clips) — this section records what was tried
against real footage and what's still open. No code changed as a direct result of this
investigation yet (see "Backlog"); the only shipped outcome so far is the second demo button
(`src/video/demo-clips/park-approach.mp4`, added so the front-approach clip below is reproducible
without an upload).

**Hip-only signal vs. a 5-limb blend — blend rejected.** Tried averaging bilateral-pair midpoints
across shoulders/elbows/wrists/knees/ankles (hip excluded) as an alternative center-of-mass
proxy, on the theory that hip keypoints track less reliably than other joints. Manual grid-pixel
measurement against fixed background references (a running track's lane markings, confirmed
static camera) showed the *existing hip-only signal* tracks real visible bounce reasonably
well — manual estimates ran as high or higher than the calculated hip value on both half-cycles
checked, undercutting "hip is noisy." The blended signal showed a concrete artifact instead: a
133px average-limb swing across just 0.08s (2 frames) — not a physically plausible body-
translation speed, almost certainly a jittery wrist/elbow detection spike. Blending in fast-
moving limb joints trades one noise source for a worse one. Not pursued further.

**Camera-distance change is a real, separate bug.** `estimateBodyScale`
(`src/heuristics/bodyScale.ts`) computes `torsoLengthPx` as a single clip-wide median. On a clip
where the subject's on-screen size changes substantially (e.g. running toward a handheld camera
rather than passing at fixed lateral distance — verified visually, on point: the subject's
apparent size roughly tripled across one ~1.6s clip), a single global normalizer mis-sizes every
amplitude that occurs away from the clip's "average" distance from camera. Two fixes tried:
- **Per-half-cycle-local torso length** (`estimateBodyScale` re-run on just the frames spanning
  each half-cycle): confirmed a safe no-op on a fixed-camera-distance clip (control), but
  *unstable* on the short/noisy approach clip — two otherwise-identical runs produced 32.5% and
  14.4% for the same clip, because which half-cycles even get detected varies run-to-run (GPU
  non-determinism, see "Determinism caveat" above) and a half-cycle's own frame window is too
  small a sample to estimate torso length reliably.
- **Rolling-window smoothed per-frame torso length** (median over a ±8-frame window, resampled
  at each extremum): same idea, slightly stabilized, same fundamental problem — the underlying
  clip (1.65s, ~2-3 real strides) is too short for *any* normalization scheme to produce a
  trustworthy single number. Per-half-cycle ratios within one run spanned 2.8%-59% — that spread
  is a property of the clip, not of the normalizer.

Conclusion: local/smoothed torso-length normalization is more correct in principle (verified
harmless on a stable clip, and a global median is provably wrong under camera-distance change)
but wasn't validated as an improvement on the one ground-truth clip available, because that clip
is too short/noisy to validate anything against. Not yet shipped — see "Backlog".

**Stride-length normalization — different, possibly more correct concept, but untestable on the
available ground-truth clip.** Consumer running watches (Garmin, COROS) report two distinct VO
metrics: raw VO in cm, and "Vertical Ratio" = VO_cm / stride_length_cm × 100, as a percentage.
Since the user's ground-truth reading was given as a percentage ("~10%"), Vertical Ratio is the
likely target — **inferred, not confirmed with the user**. This pipeline's existing calc
normalizes by torso length, not stride length — a categorically different ratio with no
principled reason to match a watch's number even if perfectly noise-free. Tried: bounce_px /
stride_px (same pixel space, real-world scale cancels out, same trick torso-length normalization
already relies on), stride length = same-side footstrike-to-footstrike horizontal hip
displacement (`detectFootstrikes` from `src/heuristics/footstrikes.ts`, reused as-is). On the
fixed-camera track clip this produced ~5-10% (vs. ~18-20% for the torso-length version) — much
closer to a plausible real-world Vertical Ratio, though there's no ground truth for that clip to
confirm against. **Could not be tested on the one clip with ground truth**: that clip's subject
runs toward the camera, so net horizontal (x) displacement is near zero — confirmed independently
by this pipeline's own `overstriding` metric, which already emits "direction of travel could not
be determined" on that clip (`estimateTravelDirection` in `src/heuristics/travelDirection.ts`
returns `0` below a half-torso-length displacement threshold). Pixel-space stride length simply
isn't observable from this camera angle. A side-view/lateral-motion ground-truth clip is needed
to actually validate this direction.

**Ground truth available**: one real data point — a park clip (front/approach view, ~1.65s,
now the second demo button) with a watch-measured reading of ~10% (assumed Vertical Ratio, see
above). This pipeline's baseline hip-only reading on that clip: ~24-25% (stable across runs). No
ground truth exists for the original side-view track demo clip — it's a stability/plausibility
control only, never a target.

## MediaPipe metric calibration — VO in real centimetres (2026-08-12, promoted to a metric #36)

**Update (#36, same day): no longer diagnostics-only.** `verticalOscillationCm` is now the
vertical-oscillation family's third real `MetricId` (`FormHeuristicsResult.verticalOscillationCm`,
after `verticalOscillation`/`verticalRatio` — the panel now shows **nine** metrics, not seven/eight)
— `computeVerticalOscillationCmMetric` (`verticalOscillationCm.ts`) wraps the calculation described
below with a `value`/`confidence`/`viewFit`/`caveat`, view-tolerant on the identical terms
`verticalOscillation` uses (side 1.0 / front 0.85 / ambiguous 0.6 — it has no denominator to be
degraded by camera angle, unlike `verticalRatio`). On a backend that doesn't measure real-world
scale (every backend but MediaPipe, still), the card renders as an availability statement — "Not
available" plus a caveat naming what backend capability is needed — not an error. The rest of this
section, describing the underlying `computeVerticalOscillationCm` calculation itself, is unchanged
by the promotion: that calculation was not touched, and is still called exactly once per run.

`[analysis-diagnostics]` still gains a `scaleCalibration` block **only** when the PRIMARY pass's
backend is `mediapipePoseLandmarker` — MoveNet-primary runs have no such key on that line at all
(test `'scaleCalibration' in diagnostics`, not `!= null`; a MoveNet run's first line still
serializes to exactly the JSON it did before). Since add-background-scale-pass, that test
discriminates the PRIMARY backend only: on a default MoveNet run the background scale pass's
measured calibration appears on the separate `[analysis-diagnostics:scale-pass]` line (see
"Reading results" above), never on the first line. As of #36 this block is sourced from `verticalOscillationCm.calibration` BY
REFERENCE (`diagnostics.scaleCalibration === heuristics.verticalOscillationCm.calibration`), not a
second computation — the diagnostics helper no longer takes a 4th parameter at all. It comes from
the per-frame `pixelsPerMeter` the MediaPipe backend derives from `worldLandmarks` (pixel torso ÷
**3D** world torso, shoulder-mid→hip-mid, landmark indices 11/12/23/24) and carries through
`PoseFrame` → `RobustPoseFrame` verbatim, never interpolated.

Fields: `verticalOscillationCm` (fitted PEAK-TO-PEAK bounce, cm — this is also the metric's
`value`), `sampleSize` (complete bounce cycles across contributing runs — one bounce per STEP; it
counted half-cycles before 2026-08-12), `observedCycles` (the same count, unfloored — added by #36
so confidence can read the fractional value rather than the display-rounded one), `fit` (the
winning run's spectral fit: `frequencyHz`, `peakToPeakAmplitudeCm`, `sinusoidR2`, `totalR2`,
`secondPeakRatio`, `sampleCount`, `spanSeconds`, `observedCycles`), `fitFailureReason`
(`'too-few-samples' | 'degenerate-signal' | 'insufficient-cycles' | 'below-quality-gate' |
'no-usable-run'`), `scaleDriftRatio`, `medianPixelsPerMeter`, `torsoMeters`, `scaleCoverage`,
`integrationRuns`. `fit` and `fitFailureReason` are exactly-one-non-null, so a measured-but-
unfittable clip names its reason instead of reporting a bare null. Computed over the
**presence-trimmed** window (unlike every other diagnostics field) — as of #36 this is true BY
CONSTRUCTION rather than by a second `trimToPresenceWindow` call, since `computeFormHeuristics`
now produces this block itself over the same trimmed frames it computes every other metric from.
`src/heuristics/verticalOscillationCm.ts`; the existing torso-length-ratio `verticalOscillation`
metric is untouched.

**Estimator (since 2026-08-12, #34)**: the amplitude comes from the shared spectral sinusoid fit
(`spectralFit.ts` — same primitive `verticalOscillation` and `cadence` use), fitted **once per
integration run** over that run's converted metric series, gated at `config.verticalOscillationMinFitR2`
(0.30 by default — **as of #36, the same `HeuristicsConfig` key `verticalOscillation`/`verticalRatio`
gate on, not the private `CM_MIN_FIT_R2` module constant this section originally described**; two
independently-tunable gates on the identical fitted amplitude would let the family disagree with
itself about whether it's trustworthy, so the constant was deleted rather than kept alongside the
config key), and aggregated across contributing runs by a sample-count-weighted median that SELECTS
one run's fit rather than blending several. It replaced per-run extrema pairing, whose prominence
threshold was the module's only use of `torsoLengthPx` — so a clip with no resolvable body scale can
now report centimetres with `torsoMeters: null`. The fit's `c + d·t + e·t²` trend terms are the
point: they absorb approach translation instead of charging it to the bounce. `fit.frequencyHz × 60`
is a free cross-check against `metrics.cadence.value` — same body, same rhythm, reached through a
completely separate series; a large disagreement means one fit landed on a harmonic or a grid edge.
Config is read for the frequency GRID and (as of #36) the quality GATE, never for signal selection
(`verticalOscillationSignal` does not apply here — hip-pinned unconditionally).

**The one correctness constraint**: the pixel→metre conversion integrates per-frame *deltas*
(`Σ (y[k−1] − y[k]) / s̄[k]`, reset at every hip-tracking gap), never `y_px / s(t)`. Dividing
absolute positions by a drifting scale reports the drift itself as bounce — measured as a 480 cm
artifact on the approach clip. There's a regression test for exactly that case
(`verticalOscillationCm.test.ts`).

Expected live values (real GPU, 3 trials/clip, measured 2026-08-12 on the same machine before and
after the estimator swap):

| clip | VO_cm (extrema, before) | VO_cm (fit, after) | fit.sinusoidR2 | fit.frequencyHz ×60 vs cadence | sampleSize | driftRatio | torsoMeters | medianPxPerM |
|---|---|---|---|---|---|---|---|---|
| track (`try a demo video`) | 6.075–6.080 | **4.78–4.79** | 0.485–0.486 | 91.2 vs 91.2 (exact) | 3 | ~1.01 | ~0.505 | ~872 |
| park (`another demo`) | 11.7 / 14.9 / 15.5 | **9.4 / 10.2 / 12.0** | 0.42–0.73 | 175.2–196.8 vs 176.4–195.6 (≤2 grid steps) | 3–4 | 3.9–5.4 | ~0.47 | ~530 |

Track is the regression anchor and is stable to ±0.005 cm across trials — a >0.05 cm spread there
is worth investigating rather than averaging away. **Park is not deterministic** despite MediaPipe
being bit-reproducible elsewhere: its presence-trimmed window lands on 76/83/84 samples across
trials, and that alone moves the number. One baseline park trial sampled a single frame and
produced no `scaleCalibration` at all — the known cold-start flake, unrelated to any code change.

**Why the track number dropped 21%, and why that is not a regression.** The pre-registered
tolerance for this swap was −7% (from #28's measured sine-underfit bias on the pixel path); the
measured drop was −21%, so it was investigated rather than accepted or tuned away. The finding:
the new centimetre figure agrees with the *pixel* path's spectral fit on the identical clip to
within 1.2% (4.786 cm vs. 42.24 px ÷ 871.9 px/m = 4.845 cm), at exactly the same winning frequency
(1.52 Hz), the same 57 samples, the same 2.24 s span, and a `sinusoidR2` within 0.003 (0.4860 vs.
0.4886) — the affine-equivalence identity, holding on real footage. Before the swap the pipeline
reported two mutually inconsistent amplitudes for the same clip (4.84 cm-equivalent from the fit,
6.07 cm from extrema pairing); that 25% gap is what closed. #28's −3…−7% band was measured on the
raw pixel trace of better-fitting clips and does not transfer: at this clip's `sinusoidR2` ≈ 0.49
a sine explains under half the residual variance, so it necessarily underfits the peak excursions
by much more than 7%. `CM_MIN_FIT_R2` was NOT touched. Note also that the integration itself adds
almost nothing to the noise — the cm path's `sinusoidR2` is within 0.6% of the pixel path's, which
is direct evidence against scale noise accumulating materially as red noise on this clip.

`driftRatio` is last measured scale ÷ first — a two-sample statistic, so one noisy endpoint
frame swings it trial-to-trial (hence 3.9–5.4 on park). Treat it as a flag, not a measurement.

`torsoMeters` ≈ 0.5 is the sanity check — a human torso really is about half a metre, so a
wildly different number means the calibration is wrong and the centimetres shouldn't be believed.
**The park number is no longer drift-inflated the way it was**: the fit's trend terms absorb the
approach translation, and the measured effect is a 30% drop (median 14.9 → 10.2 cm) with the
alternating large/small half-cycle pattern gone by construction. It is still not a *target* —
there is no ground truth in centimetres for that clip; the watch's ~10% is a *ratio*, not
centimetres, and is not comparable. The 6–13 cm literature range is the plausibility check: park
(10.2) now sits inside it, but track (4.79) reads ~20% BELOW the band's floor — a real shortfall,
not a marginal one. The mechanism is the sine-underfit described above: at this clip's
`sinusoidR2` ≈ 0.49 a single sinusoid explains under half the residual variance and necessarily
underfits the peak excursions, so the fitted amplitude reads low on a peaky waveform. The
pixel-space `verticalOscillation` ratio metric inherits the identical downward bias (same
primitive, same clip, same R²) — the whole VO family reads low on peaky waveforms, consistently.

## Head-keypoint widening + vertical-oscillation signal A/B (2026-08-12)

`COMMON_KEYPOINT_NAMES` widened from 12 to 15 (`nose`, `left_ear`, `right_ear` appended —
`src/pose/types.ts`): both MoveNet and MediaPipe already emitted these names, they were just
dropped at the `toPoseFrame` adapter boundary. Every downstream consumer
(confidenceFilter/interpolate/analysisDiagnostics/skeleton overlay) was already name-driven off
`COMMON_KEYPOINT_NAMES` rather than a hardcoded 12, so this widened for free except for
`syntheticGait.ts`'s exhaustive keypoint-name switch, which needed a new head model (nose + ears
as a rigid unit above the shoulders, phase-locked to the hip bounce with its own damped
amplitude — see `openspec/changes/widen-keypoints-selectable-vo-signal/design.md`'s "D-fixture"
section). Skeleton overlay now draws a head triangle (ear-ear-nose) plus two neck anchors
(ear-to-same-side-shoulder).

Vertical oscillation's input signal is now selectable via `HeuristicsConfig.verticalOscillationSignal:
'hipMid' | 'earMid'` (`src/heuristics/types.ts`), backed by a generalized
`analyzeBounceSignal(frames, config, pair)` in `hipBounce.ts` (cadence keeps calling the
hip-pinned `analyzeHipBounce` wrapper unchanged — cadence stays hip-pinned regardless of this
setting). **A prior offline investigation (test4-headbob.json) found ear-mid bounce roughly half
hip-mid's run-to-run spread on both demo clips — a live, paired, 5-trial-per-clip A/B against the
actual pipeline (real GPU, MoveNet) did NOT reproduce that advantage.** Measured this session:
hip-mid spread 20.5% (track) / 3.2% (park), ear-mid spread 23.8% (track) / 3.5% (park) — ear-mid
was not more stable, and on the track clip paid a real confidence cost from the single-ear
interpolation tax (17-22% of frames only resolving one ear). The gap between the two
investigations' findings is explained by timing: the offline investigation predates the
spectral-fit VO estimator (#28), which already fixed most of hip-mid's original instability (its
own measurement: park clip cross-trial spread 18.2% → 4.2%) — against that already-stabilized
baseline, ear-mid's theoretical advantage had nothing left to add. **Default stays `hipMid`**;
`earMid` ships as a documented, tested, available config option. Full numbers, the pre-registered
decision rule, and the gate-by-gate evaluation are in
`openspec/changes/widen-keypoints-selectable-vo-signal/design.md`. GitHub issue #30.

## Backlog (assessed, not yet built)

One more iteration plane was scoped but deferred as of 2026-08-11 — same "bundle into one
config, thread it through, dev-only override" pattern as the sampling/robustness and
model-backend planes above:
- **Math/heuristics**: `computeFormHeuristics` already takes a `HeuristicsConfig` — threshold
  iteration is free today, just needs the same override-point treatment for a harness to swap
  it without a code edit.

Model/detection backend selection shipped 2026-08-11: `src/pose/detector.ts`'s registry now has
`'movenet'`, `'blazepose'`, `'posenet'`, and `'mediapipePoseLandmarker'`, with a dev-only
override point (`window.__STRIDES_POSE_BACKEND_OVERRIDE__`, see above). MoveNet's
Lightning-vs-Thunder variant is exposed too, via the same override's `movenetModelType` field —
tested, Thunder came out worse (see comparison results above). BlazePose's and MediaPipe
PoseLandmarker's lite/full/heavy-equivalent variant selection is still hardcoded (`full`) —
narrower follow-up if that granularity is ever needed. Status: `movenet` and
`mediapipePoseLandmarker` work; `blazepose` and `posenet` are broken, see "Known issues" above.
GitHub issues #24 (MoveNet variant — done, results recorded), #25 (MediaPipe Tasks Vision — done,
works), #26 (PoseNet — done, confirmed broken, not worth further investment).

Input preprocessing now has a pluggable stage too: MoveNet's backend gained an external
tracking-crop layer (`src/pose/backends/movenetCrop.ts`, `trackingCropConfig.ts`) — once a
subject is detected, subsequent frames run against a padded, upscaled crop centered on the
tracked bounding box instead of the full (possibly 4K, subject-too-small-after-downscale) frame,
falling back to full-frame detection after sustained tracking loss. Config override: the same
`window.__STRIDES_POSE_BACKEND_OVERRIDE__`'s `trackingCrop` field, see "Config overrides" above.
It was the "input preprocessing has no pluggable stage" backlog item (built 2026-08-11, ported
onto the 15-keypoint/9-metric main and re-verified 2026-08-13 — fresh A/B table below).

**Ships `enabled: false` by default** — decided by a pre-registered rule in the 2026-08-13
revival A/B (both demo clips, 3 trials per arm, real GPU, crop-on vs `{ enabled: false }`):

| | track, crop off | track, crop on | park, crop off | park, crop on |
|---|---|---|---|---|
| detectedFrames | 75/75/75 | **77/78/79** | 75/75/76 | 62/75/76 |
| view confidence | 0.755–0.774 | 0.779–0.782 | 0.073–0.136 | 0.099–0.175 |
| kneeFlexion conf | 0.94–0.98 | **0.83–0.85** | ~0.06 (front-gated) | ~0.07 (front-gated) |
| cadence/VO conf | 0.71–0.74 median (one bad-fit 0.15) | 0.60–0.72 | **0.63–0.69, tight** | **0.18–0.77, median 0.32** |

On the side-view track clip cropping helps (more detected frames, slightly higher view
confidence — same direction as the original 2026-08-11 verification), and the known kneeFlexion
confidence cost reproduces (0.83–0.85 vs 0.94–0.98, still tier-1). But on the front-approach
park clip — where the subject's on-screen scale changes ~3× — the lagging tracked box mismatches
the subject and consistently halves cadence/vertical-oscillation confidence (median tier T2→T3),
which fired the pre-registered "any median tier degrades → default off" rule. Two implementation
notes from the revival: the bbox deliberately EXCLUDES the head keypoints (nose/ears) — a
15-point box was measured strictly worse than the original 12-point one (it inflates the padded
crop side ~560→674px on the reference fixture and jitters frame-to-frame; detectedFrames dropped
to 69–72 vs 75 baseline) — and tracking only helps *after* a first confident detection, so it
never addresses the cold-start moment (subject entering frame small/distant), a genuinely
different problem (upstream resize before *any* detection) that remains unbuilt. Full two-round
tables: `openspec/changes/archive/*movenet-tracking-crop/design.md` "Revival note". Enable for
experiments via `{ trackingCrop: { enabled: true } }` in the backend override.

Also flagged, not yet scoped: the eval harness/comparison tooling itself (multi-trial, labeled,
diffable) that would actually drive variants through these config planes hasn't been built —
this doc covers how to do it by hand, not a scripted harness.

From the vertical-oscillation accuracy investigation (2026-08-12, see section above), not yet
built:
- **Ship-or-don't decision on local/smoothed torso-length normalization** in
  `computeVerticalOscillation` — a defensible correctness fix (global-median normalization is
  provably wrong under camera-distance change, verified harmless on a stable clip) that wasn't
  cleanly validated as an *improvement* because the only ground-truth clip is too short/noisy to
  validate anything against. Needs either a decision to ship it anyway on correctness grounds, or
  a better validation clip first.
- **Confirm the Vertical-Ratio-vs-raw-VO assumption with the user** — this investigation targeted
  matching VO_cm/stride_length_cm × 100 (a percentage) since the user's watch reading was given
  as "~10%", but that's inferred from the unit, not confirmed. Changes which normalization
  concept (torso-length vs. stride-length) is even the right target.
- **A lateral-motion ground-truth clip** — the only clip with a known-correct reading (the park
  demo, front/approach view) structurally can't validate stride-length normalization
  (`estimateTravelDirection` returns indeterminate on it — no net horizontal pixel displacement
  at that camera angle). Would need a side-view clip, filmed like the original track demo, with a
  watch reading to actually test the stride-length direction.
- **A longer or multi-trial-averaged ground-truth clip generally** — the park clip is ~1.65s
  (~2-3 real strides); per-half-cycle bounce ratios within a single run spanned 2.8%-59%, and
  which half-cycles even get detected varies between identical runs (GPU non-determinism). No
  normalization scheme can be responsibly validated against a single short run of this clip.

## Slow-motion clip detection investigation (2026-08-14)

Spike for GitHub #42, executed on branch `spike-slowmo-detection` (worktree
`strides-slowmo`) — findings, a prototype, and a recommendation, not a shipped feature.
`src/video/containerTiming.ts`, `src/video/slowMotionDetection.ts`, and their tests/fixtures
exist on that branch only as of this writing.

**Motivation.** This pipeline's cadence/vertical-oscillation estimators search a fixed 1.2–4.0 Hz
bounce-frequency band (`HeuristicsConfig.spectralFitMinFrequencyHz`/`spectralFitMaxFrequencyHz`,
`src/heuristics/types.ts`) — correct for real running cadence, wrong for a raw slow-motion clip. A
true 180 spm cadence filmed at 8x slow-motion plays back at 22.5 spm (0.375 Hz), below the grid's
floor entirely. The concern: does the pipeline currently produce a plausible-looking but wrong
number on such a clip ("silently wrong"), and if so, can container-level metadata detect that
case before the user sees it?

**What was tried.**

*Parsing (`containerTiming.ts`).* Added `mp4box@2.4.1` as a direct dependency — self-contained,
not shared with the parallel `webcodecs-sampling` worktree (see Backlog). `probeContainerTiming`
drives `mp4box`'s `createFile()`/`appendBuffer()`/`onReady`, synchronously for a single fully-
buffered `ArrayBuffer`, and reduces its box tree to: per-video-track `mediaTimescaleHz` (from
`mdia/mdhd`), `movieTimescaleHz` (from `moov/mvhd`), `nominalFps` (1 / weighted-median `stts`
sample delta — the median, not `nb_samples / duration`, since a stretched duration would corrupt
that ratio), raw `edts/elst` entries verbatim, and a `stretchFactor` with a `stretchFactorSource`
tag (`'direct-rate'` when an entry's `media_rate_integer`/`media_rate_fraction` combine to a
non-unity, non-dwell rate; `'duration-ratio'`, inferred by comparing the edit list's total
presentation duration against the `stts`-implied native duration, otherwise). Fails closed via
`parseStatus: 'ok' | 'unsupported-container' | 'parse-error'` — a non-MP4 buffer (garbage bytes,
empty buffer) never throws, it resolves `'unsupported-container'`.

*Policy (`slowMotionDetection.ts`).* `detectSlowMotion` requires the conjunction the plan
specified: (1) `nominalFps >= 100` (native-capture-rate tier, clears 24–60fps with margin, sits
below iPhone's 120/240fps slo-mo tiers) AND (2) `stretchFactor >= 1.5` (both defaults, in
`DEFAULT_SLOW_MOTION_DETECTION_CONFIG` — **not tuned against any real-world sample**, see
Findings). Confidence is `'high'` when the winning `stretchFactor` came from the direct-rate path,
`'medium'` from duration-ratio, `'none'` on any parse failure, missing video track, or predicate
miss. Neither signal alone is trusted: real evidence for why is in the Findings below.

*Fixtures (`src/video/__fixtures__/`).* Built via `mp4box`'s OWN `BoxParser.box[fourcc]`/
`BoxParser.sampleEntry[fourcc]` constructors + `write()` — a genuinely minimal box tree
(`ftyp` + `moov(mvhd, trak(tkhd, [edts(elst)], mdia(mdhd, hdlr, minf(stbl(stsd(avc1), stts)))))`,
no `mdat`, no `vmhd`/`dinf`/`stco`/`stsz`/`stsc`) verified empirically to round-trip through
`mp4box`'s own parser to `onReady` before committing to it — those extra boxes turned out to be
unnecessary for `mp4box`'s parser specifically, not for ISO-BMFF conformance in general. One
gotcha found the hard way: `mp4box`'s `elstBox` reads/writes `media_rate_fraction` as a **signed**
16-bit int, so the spec-legal `32768` (`0.5` exactly) silently overflows on write — fixture values
had to stay under `32768` (`16384` = `0.25` was used instead). Seven fixture modules, one per
predicate branch plus two extra: `normalFps`, `highFpsNoElst`, `highFpsUnityRateElstNoStretch`
(the ordinary-trim trap), `highFpsStretchingElstDirectRate` (high confidence),
`highFpsStretchingElstDurationRatio` (medium confidence, bonus coverage beyond the plan's four
branches), `highFpsStretchingElstFfmpegShape` (models the real empirical finding below as a
regression), `nonMp4Bytes` (garbage bytes + empty buffer). 19 tests across
`containerTiming.test.ts`/`slowMotionDetection.test.ts`, all passing; full suite 523/523 passing;
`tsc -b` clean; `eslint` clean on every new/touched file.

*Live pipeline (Step 3).* Generated the slow-motion-shaped fixture exactly as specified:
`ffmpeg -itsscale 8 -i src/video/demo-clips/park-approach.mp4 -c copy /tmp/park-approach-8x-slowmo-shaped.mp4`
(stream copy, ~12MB, not committed — regenerate from this command). Temporarily imported
`probeContainerTiming`/`detectSlowMotion` into `useVideoAnalysis.ts`'s existing dev-diagnostics
effect, logged under `[slowmo-probe]`, drove the app via headless Chromium (real GPU —
`ANGLE Metal Renderer: Apple M4 Pro`, confirmed via `WEBGL_debug_renderer_info`, not
SwiftShader), Upload tab + the shaped clip, captured both `[analysis-diagnostics]` and
`[slowmo-probe]`, then reverted the instrumentation (`git checkout -- src/results/useVideoAnalysis.ts`
— the only change that file had; a clean revert, confirmed via `git diff`).

**Findings.**

*Does `-itsscale` produce an `elst`, or rewrite `stts`/`mdhd` directly? Rewrites `stts` directly —
confirmed by inspecting both files' raw boxes with `containerTiming.ts`'s own parser* (also
cross-checked by hand against the un-rescaled source first). The source clip
(`park-approach.mp4`, 60000Hz media timescale, 1000Hz movie timescale) already carries an
edit list even untouched — `elst: [{segment_duration: 1652, media_time: 2002, media_rate: 1}]`,
a ~2-frame priming offset with a UNITY rate, `stts` uniform at 1001 ticks/sample (59.94fps) — real,
independent evidence that an ordinary, non-slow-motion file commonly carries a unity-rate edit
list, exactly the trap the conjunction predicate exists to avoid. After `-itsscale 8`: `stts` was
rewritten from a uniform 1001-tick delta to two runs — 98 samples @ 8008 ticks (`1001 × 8`, exactly
scaled) + 1 sample left at 1001 ticks (an ffmpeg rounding/edge artifact on the last sample) —
`mdhd.timescale` stayed unchanged at 60000Hz (the tick *rate* was never touched, only the tick
*values*). The pre-existing `elst` was scaled in lockstep: `segment_duration` 1652 → 13097 ticks
(movie timescale, matching the new `mvhd.duration`), `media_time` 2002 → 16016 (exactly `× 8`),
`media_rate` **stayed unity** throughout. Nothing in the rescaled container disagrees with
anything else — ffmpeg kept every duration and tick value mutually consistent under the new,
slower rate.

*Measured pipeline behavior on the shaped clip, live, real GPU (95/95 frames detected, full
sampling coverage — this is not a data-starvation problem):*
```json
{"probe":{"parseStatus":"ok","videoTracks":[{"trackId":1,"mediaTimescaleHz":60000,
"movieTimescaleHz":1000,"nominalFps":7.492507492507492,
"elst":[{"segmentDuration":13097,"mediaTime":16016,"mediaRateInteger":1,"mediaRateFraction":0}],
"stretchFactor":1.0000445414458152,"stretchFactorSource":"duration-ratio"}]},
"result":{"detected":false,"confidence":"none","trackId":1,"nominalFps":7.492507492507492,
"stretchFactor":1.0000445414458152,"stretchFactorSource":"duration-ratio",
"reason":"nominal fps 7.492507492507492 below native-capture-rate threshold 100"}}
```
`cadence.value: null`, `caveat: "Hip position was tracked, but the step rhythm was too irregular
to measure."` — `verticalOscillation` carries the identical shape of result with its own version
of that same generic message. Both come from `cadence.ts`'s below-quality-gate branch
(`fit.sinusoidR2 < cadenceMinFitR2`), not from `isNearGridEdge`'s caveat text ("sits at the edge
of the range this analysis can measure") — confirmed by exact string match against
`cadence.ts`'s source, and by the message being a single standalone sentence rather than the
multi-caveat `join(' ')` format a returned-but-marginal value would carry.

**The pre-registered grid-edge-caveat hypothesis is REFUTED, not confirmed.** The spectral fit
does not land near either edge of the 1.2–4.0 Hz grid with a passing-but-marginal R² (which would
have produced the "may fall outside it" caveat) — it finds NO candidate frequency in that band
that fits the (now extremely slow, 8x-stretched) hip trace well at all, so `sinusoidR2` falls
below the 0.30 gate everywhere in the searched range and the metric returns `null` with a fully
generic message that gives no indication the clip's own timing is the actual problem. This is
arguably a worse outcome than the hypothesis predicted, not a better one: "may fall outside the
measurable range" would at least point a user in the right direction; "too irregular to measure"
does not. This confirms the motivating "silently/confusingly wrong" problem more starkly than
expected, on the one concrete piece of evidence available — while also showing the SPECIFIC
predicate this spike built cannot detect the ONE concrete slow-motion-shaped file it was possible
to generate and test end-to-end.

**Recommendation: detect-and-caveat, not detect-and-rescale — and not shipped this pass.**
Evaluated against the four pre-registered criteria:
- **Exactness of stretch factor.** Even setting aside whether the predicate fires at all, this
  spike found the one real container-rewrite mechanism available for testing (`ffmpeg -itsscale`)
  destroys the very information a rescale would need — there is no recoverable "how much slower
  than native" number left in the container once `-itsscale` has run. A rescale path would only
  ever activate on the *hypothesized*, unverified real-device shape (native `stts` + a separately
  stretched `elst`), for which no real sample exists to confirm the recovered factor is even
  correct.
- **Asymmetry of failure cost.** A wrong caveat over- or under-warns — mildly annoying, never
  misleading about the numbers shown. A wrong rescale multiplies every timestamp by a number that
  might be wrong and then presents a *confidently displayed*, normal-looking metric value — this
  is strictly worse than today's status quo (null-with-generic-caveat stays honestly unhelpful; it
  never becomes actively deceptive).
- **Validation sample size.** n=0 real iPhone (or any real device) slow-motion clips were
  available to this spike, and none were found. Every fixture is hand-built or ffmpeg-shaped
  synthetic data. `DEFAULT_SLOW_MOTION_DETECTION_CONFIG`'s two thresholds (100fps, 1.5x) are
  untuned defaults, not calibrated against any real distribution of real-vs-slow-motion clips.
  This is a thin evidence base for shipping ANY user-facing behavior change, and a much thinner
  one for a change that alters computed metric values.
- **Blast radius.** Detect-and-caveat only ever adds an informational banner; it can never change
  a computed number, so its worst-case failure (a false-positive banner on a legitimate high-fps
  clip that happens to carry an unusual edit list) is cosmetic. Detect-and-rescale's worst case is
  a corrupted metric on a clip the user did nothing wrong with.
- **Does caveat-only already solve the stated motivation?** Yes. The motivating complaint is
  "silently/confusingly wrong," and the measured finding above shows the pipeline today gives a
  generic, timing-agnostic caveat with no hint that the clip's own timing might be the cause. A
  slow-motion-specific banner — even at `'medium'` confidence, even imperfectly recalled — directly
  converts "confusingly wrong" into "clearly explained," which is the actual problem. Solving
  "recover the true absolute timing and rescale" is a substantially harder, differently-scoped
  problem this spike found no reliable way to validate.

(Widening the spectral-fit search grid itself, rather than detecting-and-warning, was considered
and rejected as a direction: without a trustworthy rescale, a widened grid would happily fit *some*
frequency to the stretched signal and report a plausible-looking wrong cadence instead of `null`
— actively worse than today, not better.)

**Not filed as an openspec change this pass.** `detect-raw-slowmo-clips` would be the name if/when
it is — the plan pre-authorized filing it if the recommendation "crystallizes into something
concrete enough to ship in this same pass." It has not: the banner's exact placement, copy, and
which confidence tier(s) surface it (`'high'` only, or `'medium'` too) are real UI/UX decisions
this spike did not make, and shipping a detection predicate with zero real-device validation
behind a live user-facing banner deserves a decision point of its own rather than riding in on a
spike's momentum.

**Risk notes.**
- **Overlapping-caveat coordination.** The grid-edge caveat does NOT already fire on this clip
  (see Findings — hypothesis refuted), and neither `cadence` nor `verticalOscillation`'s existing
  caveat text mentions timing at all. There is no existing per-metric caveat machinery to
  coordinate with or risk duplicating today. This makes the architecture recommendation easy to
  follow: a **video-level banner shown independently by `VideoInputPanel`/`ResultsView`**, gated
  on `detectSlowMotion`'s result, rather than re-plumbing `HeuristicsConfig`/`cadence.ts`'s
  per-metric caveat machinery to know about container-level facts it currently has no access to.
  That re-plumbing is a real cost and is explicitly flagged as unsolved future work, not attempted
  here.
- **Confidence-tier UI question**, unresolved: should a `'medium'`-confidence (duration-ratio)
  detection surface the same banner as `'high'`, a softer one, or none at all? No data exists yet
  to inform that call.
- **Multi-video-track files**: `detectSlowMotion` evaluates only `probe.videoTracks[0]` and never
  reconciles disagreement across tracks. A known simplification (unusual for consumer video),
  not a considered design choice.

**Backlog.**
- **mp4box de-dup with `webcodecs-sampling`** once both land — that worktree is implementing a
  parallel MP4-parsing need at the same time; this spike deliberately did not attempt to share
  code with it per instruction, but the two `mp4box` integrations should be reconciled into one
  before both merge to `main`.
- **File `detect-raw-slowmo-clips` as an openspec change** once the banner UI/UX decision above is
  made — proposal, spec delta, design, and tasks, following this repo's usual openspec flow.
- **A real device-native slow-motion clip.** The single highest-value next step: without one,
  whether real slow-motion footage produces the `containerTiming.ts`-detectable shape this
  predicate targets, the `-itsscale`-shape this spike found and confirmed is NOT detectable, or a
  third mechanism entirely (Apple's proprietary slow-motion metadata, unexamined here) remains
  completely unknown. Everything about detection accuracy in this write-up is conditional on that
  gap.
- **Threshold calibration** (`minNativeFps: 100`, `minStretchFactor: 1.5`) against a real
  distribution of clips, once real slow-motion samples exist to calibrate against.
