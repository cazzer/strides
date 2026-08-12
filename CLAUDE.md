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

In development builds only, `useVideoAnalysis` auto-logs a single console line
`[analysis-diagnostics] {...}` the moment a run reaches `phase: 'ready'` — a JSON object with
per-keypoint detected/interpolated/unrecoverable counts, raw view-detection diagnostics,
sampling detected/missing counts, and every metric's `value`/`confidence`/`viewFit`/
`frameCoverage`/`caveat` in one place (`src/results/analysisDiagnostics.ts`). Capture it via
`page.on('console', ...)`, find the line by its prefix, `JSON.parse()` the rest. This never logs
in a production build (`import.meta.env.DEV`-gated) — don't try to read it from a `vite build`
output.

**Config overrides for comparing pipeline variants**, dev-only, read once per run:
- `window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__` — partial
  `SamplingRobustnessConfig` (`src/results/samplingRobustnessConfig.ts`): keypoint-confidence
  filtering, interpolation gap tolerance, detection error tolerance, per-frame timeout.
- `window.__STRIDES_POSE_BACKEND_OVERRIDE__` — partial `PoseDetectorConfig`
  (`src/pose/poseBackendConfig.ts`): `{ backend: 'movenet' | 'blazepose' | 'posenet' |
  'mediapipePoseLandmarker', movenetModelType?: 'lightning' | 'thunder' }`. `movenetModelType`
  only matters when `backend: 'movenet'` (defaults to `'lightning'`); ignored otherwise. Read
  once per detector creation in `usePoseDetector.ts`.
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

## MediaPipe metric calibration — VO in real centimetres (2026-08-12)

`[analysis-diagnostics]` gains a `scaleCalibration` block **only** on the
`mediapipePoseLandmarker` backend — MoveNet runs have no such key at all (test
`'scaleCalibration' in diagnostics`, not `!= null`; a MoveNet run still serializes to exactly the
JSON it did before). It comes from the per-frame `pixelsPerMeter` the MediaPipe backend now
derives from `worldLandmarks` (pixel torso ÷ **3D** world torso, shoulder-mid→hip-mid, landmark
indices 11/12/23/24) and carries through `PoseFrame` → `RobustPoseFrame` verbatim, never
interpolated.

Fields: `verticalOscillationCm` (median half-cycle bounce, cm), `sampleSize` (half-cycles),
`scaleDriftRatio`, `medianPixelsPerMeter`, `torsoMeters`, `scaleCoverage`, `integrationRuns`.
Computed over the **presence-trimmed** window (unlike every other diagnostics field), so it lines
up with the metrics beside it. `src/heuristics/verticalOscillationCm.ts`; the existing
torso-length-ratio `verticalOscillation` metric is untouched.

**The one correctness constraint**: the pixel→metre conversion integrates per-frame *deltas*
(`Σ (y[k−1] − y[k]) / s̄[k]`, reset at every hip-tracking gap), never `y_px / s(t)`. Dividing
absolute positions by a drifting scale reports the drift itself as bounce — measured as a 480 cm
artifact on the approach clip. There's a regression test for exactly that case
(`verticalOscillationCm.test.ts`).

Expected live values (real GPU, MediaPipe deterministic — trials should be near-identical;
>0.05 cm spread on the track clip is worth investigating rather than averaging away):

| clip | VO_cm | driftRatio | torsoMeters | medianPxPerM |
|---|---|---|---|---|
| track (`try a demo video`) | 6.07–6.09 | ~1.01 | ~0.50 | ~872 |
| park (`another demo`) | 14.9–15.7 | 3.9–5.4 | ~0.47 | ~530 |

`torsoMeters` ≈ 0.5 is the sanity check — a human torso really is about half a metre, so a
wildly different number means the calibration is wrong and the centimetres shouldn't be believed.
**The park number is drift-inflated and is not a target**: that clip's subject runs at the camera,
`scaleDriftRatio` says so, and approach-drift correction is deliberately unimplemented (see the
change's `design.md`). The watch's ~10% is a *ratio*, not centimetres — not comparable. The 6–13
cm literature range is the plausibility check the track clip passes.

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

Also flagged, not yet scoped: input preprocessing (resize/crop before detection — the actual
root cause of this session's low-confidence demo-clip investigation, a 4K frame with the subject
too small/distant after downscaling to the model's fixed input size) doesn't have a pluggable
stage at all yet; and the eval harness/comparison tooling itself (multi-trial, labeled,
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
