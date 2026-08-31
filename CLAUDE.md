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
- **A MODIFIED block REPLACES the whole requirement body, so two in-flight changes that MODIFY
  the same requirement will clobber each other — last archive wins, silently.** Hit for real on
  2026-08-18: `navbar-clip-shell` and `inline-annotated-evidence` both carried a MODIFIED
  "Evidence frames are planned purely, then extracted from a detached video element", each
  authored independently against the same original, so **neither was a superset** and no archive
  order alone was correct. Before archiving a batch, diff the changes' delta headers against each
  other, not just against `openspec/specs/`. The fix is to archive the older-worded one first,
  then **reconcile the second change's MODIFIED block against the now-current spec** (carry the
  first one's edits forward into it) before archiving it — a MODIFIED delta is only meaningful
  stated against the spec it will actually be applied to. `openspec validate --strict` will not
  catch this: both blocks validate fine, and the loss is invisible in the archive output's
  `~ 1 modified` line.

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

**Two guards now refuse instead of measuring the wrong thing — don't work around them.**
Both were added because their failure mode is a *clean, plausible* number rather than a crash
(beads `strides-zpb`, `strides-9wp`), and both are on by default because the six agents who each
hand-rolled a workaround for the first one had no idea they needed to.

1. **The dev-server port is DERIVED from the checkout's absolute path**, not 5173
   (`scripts/lib/harnessProvenance.mjs`, `resolveDevServerPort` — a sha256 of the repo root into
   5200-5399, stable per checkout, `STRIDES_DEV_PORT=<n>` to override). Parallel worktrees on this
   machine routinely left a dev server on 5173, and a foreign server answers *every* arm of an A/B
   and *every* assertion in a spec — so when the arm under test is a code change behind a flag,
   the foreign checkout lacks the code entirely, both arms collapse to old-code-plus-a-flag, and
   the output reads as a clean "no effect". This also produced a false FAIL (`1 failed` on a
   docs-only commit, 3/3 green on a dedicated port). `reuseExistingServer` is now **off unless
   `STRIDES_E2E_REUSE_SERVER=1`**, not `!process.env.CI`. Measured cost of never reusing: **under
   one second** (vite boot to first 200 ≈ 0.7 s; cold dep pre-bundling adds ≈ 0.1 s).
2. **Server identity is checked by content, and a status code cannot do it.** Vite's SPA fallback
   answers **HTTP 200 with `index.html` for any unmatched path**, so a foreign vite server returns
   200 for every probe URL you can invent — which is exactly what Playwright's own
   `reuseExistingServer` probe looks at, and why no choice of `webServer.url` closes this hole.
   `assertServesThisCheckout` writes a nonce into `public/`, demands it back through the server,
   and deletes it. It runs in `e2e/globalSetup.ts` and in `scripts/ab-person-selection.mjs`
   **unconditionally**, including on the reuse path — `--reuse-server` / `STRIDES_E2E_REUSE_SERVER`
   now skip a *startup*, not a *guard*. `e2e/globalSetup.ts` also asserts the renderer is not
   SwiftShader, which the e2e suite previously never checked at all.

**Driving the app** (a hand-rolled driver should use the same derived port rather than 5173, or
it re-creates the collision the guards exist to stop):
```bash
node -e "import('./scripts/lib/harnessProvenance.mjs').then(m=>console.log(m.resolveDevServerPort()))"
npm run dev -- --port <that port> --strictPort &
# poll: curl -sf http://localhost:<that port>/strides/
```
- `page.getByRole('button', { name: /demo 1/i }).click()` loads a fixed reference clip — the
  side-view track clip, the standard one for before/after comparisons, fetched live from Pexels
  so this button needs network. `/demo 2/i` loads the local front-approach clip
  (`src/video/demo-clips/park-approach.mp4`). The rendered labels are *Demo 1 (side view)* and
  *Demo 2 (front view)*, now in **`src/video/ClipPicker.tsx`** (they moved out of
  `VideoInputPanel.tsx` with the shell restructure — see "The app shell" below) — `'Try a demo
  video'` survives only as `DemoVideoButton`'s unused default prop and matching on it finds
  nothing, so ignore that string wherever older notes below still quote it. Alternative: Upload
  tab + `input[type=file]` + `setInputFiles(path)` for a different clip.
- **For clips 2..N, the same buttons live behind the header's add-a-clip action**, not in the page
  body. The full-page picker only renders at zero clips. See "The app shell" below.
- Analysis starts **automatically** once the clip is ready and the detector has loaded — no
  button click needed. Wait for `page.getByText(/analyzing|processing results/i)` then
  `page.getByText(/analysis complete/i)` (the latter can take 10-90s depending on clip
  length/resolution and whether the detector is cold).

**Never conceal a clip's `<video>` — it costs ~20% of sampled frames on the playback path**
(2026-08-17, `strides-kyu.13`). Measured on Demo 2, playback arm
(`{"sequentialSampling":{"enabled":false}}`), 5 trials/arm, one session, real GPU,
`sampling.path` asserted `'playback'` on all 30 trials:

| arm | painted area | detectedFrames |
|---|---|---|
| visible, full size (control) | 124,256 px | 61 [56..62] |
| visible, repeat at a different size | 182,756 px | 61 [49..62] |
| visible, 67.5×120 CSS px | 8,100 px | 62 [56..63] |
| visible, 33.75×**60** CSS px | 2,025 px | 62 [56..63] |
| offscreen + `inert` (0 px on screen) | 0 px | **49 [48..52]** |
| offscreen + `inert`, repeat | 0 px | **47 [46..55]** |

**There is no threshold.** Painted area varies 61× across the three passing arms with throughput
flat at 61-62; the discontinuity is binary — on screen or not. A genuinely visible element at
**60 CSS px** keeps full throughput. Both controls held within the same session (the negative
reproduced twice, the positive twice at two sizes), so the null in the tiny arms is real rather
than a blind instrument.

Two things that make this easy to misdiagnose:
- **Demo 1 is BLIND to it.** At 25 fps there is ~40 ms of per-frame slack to absorb the added
  cost, and Demo 1 reads 47 → 47 at every concealment rung. **Demo 2 on the playback arm is the
  only combination that observes it** — healthy **63-65**, broken **47-49**. Any gate measured
  only on Demo 1, or only on the default sampler, reads green straight through this failure.
- **A cold-start ramp looks like it and is not.** On the playback arm a first trial reads low and
  then climbs *monotonically* to a **64** steady state; a concealment regression reads **flat
  47-49 throughout**. The clincher is the default (sequential) arm, which shows **no ramp at
  all** — only the real-time playback sampler pays wall-clock cost in lost samples. Run both arms
  before calling a low first trial a regression.

The default WebCodecs path is untouched by any of this (Demo 1 53 → 53, Demo 2 99 → 99,
bit-identical). The loss lands only where `canUseSequentialDecode` returns false — WebM and
webcam recordings.

**Reading results — `analysisDiagnostics`, not screen-scraped card text:**

In development builds only, `useVideoAnalysis` auto-logs TWO console lines per run
(add-background-scale-pass):

1. `[analysis-diagnostics] {...}` the moment a run reaches `phase: 'ready'` — a JSON object with
   per-keypoint detected/interpolated/unrecoverable counts, raw view-detection diagnostics,
   sampling detected/missing counts, a `personSelection` block (see below), and every metric's
   `value`/`confidence`/`viewFit`/
   `frameCoverage`/`caveat` in one place (`src/results/analysisDiagnostics.ts`). PRIMARY pass only,
   and `'scaleCalibration' in <payload>` discriminates the PRIMARY backend only (a
   MoveNet-primary run never has the key here, even after a successful scale pass).

   **`sampling.detectedFrames` is POST-person-selection** (retroactive-person-selection): a frame
   the detector found but the selection stage attributed to somebody else counts as *missing*
   there. `personSelection.detectedSamplesIn` preserves the pre-selection count — compare the two
   to tell "the detector found nothing" from "the detector found somebody else". The stage ships
   **on** by default, so expect the two to DIVERGE — measured 2026-08-16 on Demo 1 (side view,
   post-#54 and post-#55): 65-66 in, **53** out, so 12-13 frames, of which 7-10 are
   `rejectedOtherSegment` and 3-5 `rejectedOutsideEvidence`. Since #55 the out figure equals
   `segments[0].frameCount` exactly and carries no trial-to-trial range on that clip — every
   surviving frame is one the winner has box evidence for.
   They are equal only under a `{ personSelection: { enabled: false } }` override, in which
   case this line reads exactly as it did before the stage existed. `personSelection` itself is
   ALWAYS present (unlike `scaleCalibration`):
   `{ status: 'selected'|'skipped', skipReason, minBoundingBoxAreaPx, totalSamples,
   detectedSamplesIn, detectedSamplesOut, rejectedBelowFloor, rejectedOtherSegment,
   rejectedOutsideEvidence, segmentCount,
   bridgedCuts, segments (ranked by integrated area DESC, capped at 10, `[0]` is the winner),
   separationRatio }` — `src/results/retroactivePersonSelection.ts`.

   **`rejectedOutsideEvidence`** (#55) counts detections nulled for sitting inside the WINNING
   segment's partition span but outside its **evidenced interior** — the closed span from the
   winner's first to its last surviving detection. Only a boxless frame (fewer than
   `minConfidentKeypoints` confident points, so `deriveBoundingBox` returns nothing) can land here:
   such a frame is never floor-checked and never segment-checked, and before #55 it rode through the
   winner's whole back- and forward-extended partition span carrying `status: 'detected'`. Note the
   two windows now DIFFER: `segments[k].startTimestamp`/`endTimestamp` still report the PARTITION
   span, never the evidenced interior, so do not read that span as "the frames that were kept".
   `detectedSamplesOut` is `detectedSamplesIn` minus all THREE rejection counts.

   **`bridgedCuts`** (#54) counts how many cuts the splice-tolerance rule DECLINED, because the
   surviving detections either side of an offending one were continuous with each other. It counts
   bridge *events*, not boundaries — one event removes the boundary in front of the frame and stops
   the one behind it from ever being evaluated. It is the primary observable for anything in epic
   #52: a smaller `segmentCount` alone cannot distinguish a clip that was healed from one that never
   needed healing. Read `bridgedCuts >> 1` as "check whether two people got stitched together" — the
   rule bounds *consecutive* bridging (two bad frames in a row still cut) but an alternating
   good/bad stream can merge end to end, so cross-check `segments[0].medianAreaPx` and
   `separationRatio` on multi-person footage.
2. `[analysis-diagnostics:scale-pass] {...}` when the background MediaPipe scale pass reaches a
   terminal status — `{ status: 'done'|'failed'|'skipped', reason?: 'disabled'|'primary-scale',
   error?: string, subjectAgreement?: SubjectAgreement, diagnostics?: AnalysisDiagnostics }`.
   `diagnostics` (the scale pass's own full object, `scaleCalibration` included) rides along only
   on `'done'`. On the default MoveNet primary this line arrives roughly one clip-replay after
   "Analysis complete" (the pass replays the clip in real time); wait for it separately.

   **`subjectAgreement`** (#56, `src/results/scalePassSubjectAgreement.ts`) is the sole observable
   for the primary/scale-pass divergence check, present on `'done'` only:
   `{ status: 'agreed'|'diverged'|'no-opinion', reason: 'primary-not-selected'|
   'scale-not-selected'|'too-few-comparable-instants'|null, comparedInstants, agreeingInstants }`.
   The two counts are the point — `agreeingInstants / comparedInstants` is the MARGIN, and a
   verdict landing anywhere near 0.5 means the winner may be half runner and half bystander
   (#52 items 4/5), not that the check is working. Expect ~1.0 on all three test clips. A
   permanently `'no-opinion'` reading is not silence: it names which side never selected a
   subject.

Capture both via `page.on('console', ...)`. **Match the first line's prefix exclusively** —
`text.startsWith('[analysis-diagnostics]') && !text.startsWith('[analysis-diagnostics:')` — or
the scale-pass line will collide with it; the second is `startsWith('[analysis-diagnostics:scale-pass]')`.
`JSON.parse()` the rest of each. Neither line logs in a production build
(`import.meta.env.DEV`-gated) — don't try to read them from a `vite build` output.

**Config overrides for comparing pipeline variants**, dev-only, read once per run:
- `window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__` — partial
  `SamplingRobustnessConfig` (`src/results/samplingRobustnessConfig.ts`): keypoint-confidence
  filtering, interpolation gap tolerance, detection error tolerance, per-frame timeout, plus two
  nested planes that merge one level deep the same way `robustness` does — `sequentialSampling`
  (`{ enabled, targetSamplesPerSecond }`) and `personSelection`.
  `personSelection` is `RetroactivePersonSelectionConfig`
  (`src/results/retroactivePersonSelection.ts`): `{ enabled, minBoundingBoxAreaFraction,
  minKeypointConfidence, minConfidentKeypoints, maxAreaRatio, maxCenterSpeedSidesPerSecond,
  maxContinuityGapSeconds }`, the retroactive person-of-interest stage (issue #51 Stage 1) that
  segments the sampled sequence at continuity breaks and keeps only the highest integrated-bbox-area
  segment. **Ships `enabled: true`** — by explicit user decision (2026-08-16), OVERRIDING the
  pre-registered ship rule, which fired. It works (picks the runner over two bystander spans by
  39-46x on `e2e/fixtures/multiperson-track.mp4`, and flips `trunkLean` there from -2.9° to +4.3°)
  but is NOT a no-op on the Demo 1 side-view clip: one collapsed detection at t=4.32 wedges the
  runner's own continuous 55-frame track apart and strands 5 real frames. That cost, plus boxless
  survival inside the winner's span and primary/scale-pass selection divergence, is what was
  knowingly accepted — issue #52's items 1-3, **all three of which are now closed**: the wedge
  (#54), boxless survival (#55, narrowed to the winner's evidenced interior — the inversion
  survives by design *inside* that interior, see `retroactivePersonSelection.ts`), and the
  divergence (#56). Divergence is detected rather than accepted: the two passes' selected subjects
  are compared at matched timestamps before the graft, and a diverging scale pass caveats its two
  centimetre metrics instead of silently attributing a bystander's numbers to the runner. Read
  `subjectAgreement` on the scale-pass console line, above. Turn it OFF (the non-default arm every A/B needs)
  with `{ personSelection: { enabled: false } }`. Full A/B tables and the root cause:
  `openspec/changes/retroactive-person-selection/design.md`. Note this stage has NO `window` global
  of its own — it rides on this one.
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
await page.goto(baseURL) // the DERIVED port, not 5173 — see "Two guards" above
// ...drive the demo clip, capture [analysis-diagnostics] as above
```

**Scripted multi-trial A/B — `scripts/ab-person-selection.mjs`** (#53). Everything above, packaged:
it starts (or reuses) the dev server, launches Chromium with the real-GPU args, runs N trials per
arm across the three available clips, and prints a median + range per field. Prefer it over a
throwaway driver — four `#52` tickets share it, and hand-written one-offs come out
mutually-incomparable.

```bash
node scripts/ab-person-selection.mjs \
  --arm 'off={"personSelection":{"enabled":false}}' \
  --arm 'on={"personSelection":{"enabled":true}}' \
  --clips demo1,demo2,multiperson --trials 3
# equivalently: npm run ab:person-selection -- --arm 'off={}' ...
```

- **Needs Node >=22.18** (or >=22.6 with `--experimental-strip-types`): it imports
  `playwright.config.ts` directly rather than duplicating the launch args, which relies on native
  type stripping. `package.json` only declares `>=20.19.0`; on an older Node the driver fails with
  a message naming this, not a bare `ERR_UNKNOWN_FILE_EXTENSION`.
- **An arm is `--arm <label>=<json>`**, repeatable, where `<json>` is a partial
  `SamplingRobustnessConfig` assigned to `window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__`
  via `addInitScript`. `{}` is an untouched baseline. That is the only config plane exposed — the
  backend and scale-pass globals still need hand-driving. Keys are validated at parse time
  **including one level down**, because the app ignores keys it doesn't recognise: a typo like
  `{personSelection:{enable:true}}` would otherwise merge into nothing and yield an arm identical
  to baseline, reading in the report as a real "no effect".
- **Clips**: `demo1` (side-view track, fetched live from Pexels — needs network), `demo2`
  (`park-approach.mp4`, local and fast), `multiperson` (`e2e/fixtures/multiperson-track.mp4`, via
  the Upload tab). Default: all three.
- Reads `playwright.config.ts` for the launch args, baseURL and dev-server command, and **refuses
  to run against a dev server it did not start** — stop it, pass `--port <n>`, or pass
  `--reuse-server`. Not pedantry: arms differ only by a `window` global, so a foreign checkout
  answers both arms and yields a plausible delta from code nobody is reviewing — and when the arm
  is a code change behind a flag, the foreign checkout lacks the code entirely, both arms collapse
  to old-code-plus-a-flag, and the output reads as a clean "no effect". That is a manufactured
  false negative for the exact hypothesis under test. **`--reuse-server` no longer means "take my
  word for it"**: the nonce identity check above runs on both paths, so the flag skips the startup
  and not the guard, and the report header records `identity verified` either way.
- **Fresh Chromium process per trial, by default** (`strides-9wp`). `--reuse-browser` opts back
  into one process for the whole matrix and exists only so the difference can be measured. **A
  fresh `browser.newContext()` is NOT enough** — the driver has always made one per trial, and the
  shift below happens anyway. Measured this session, Demo 2, 3 trials, real GPU, via `--evidence`:

  | | fresh process per trial | `--reuse-browser` |
  |---|---|---|
  | `armSwingSymmetry` exemplar[0] `timestamp` | **0.984317**, no spread | 1.46813 `[0.984317..1.46813]` |
  | same exemplar's `cropSidePx` | **320** (the `EVIDENCE_CROP_MIN_SIDE_PX` floor), no spread | 398.733 `[320..398.733]` |

  Trial 1 agrees in both regimes; trials 2+ are what move. Only the fresh regime reproduces the
  coverage this file records for that clip. ⚠️ **The exemplar TIMESTAMPS in that table are stale as
  a present-day reading** — `2ed7f0b` re-derived `armSwingSymmetry`'s instants from a spectral fit,
  and on `c79d307` the fresh-process value is `0.934267` (still at `cropSidePx` 320, still with no
  spread). The regime contrast the table demonstrates is unaffected. The damage is the same shape as
  a foreign dev server:
  in the reused regime the subject (449.4 px) is WIDER than the crop, so a subject-centring rule
  correctly declines to fire, and a driver reusing a browser would have reported **"no effect" for
  a fix that demonstrably works**. The defect reproduces either way; it is the FIX that goes
  invisible.
- **Browser reuse is also a large part of what this file calls "GPU non-determinism".** Two
  independent 3-trial fresh-process runs on Demo 1 (6 trials) agreed on **every field except
  `elapsedMs`** — zero spread within a run and zero difference between runs. The same clip under
  `--reuse-browser` spread on ~20 fields, including `segmentCount` 3↔4, `rejectedOtherSegment`
  7↔10, `kneeFlexion` 116.9↔120.7, `verticalRatio` 0.0524↔0.0682 (30%) and `stepWidth` 1.13↔1.70
  (51%). Treat a wide range column as a possible harness artifact before attributing it to the
  clip. (n=2 runs per regime — a strong signal, not a proven law.)
  **Extended 2026-08-29 (`strides-b0y`), and the mechanism is now known**: cold vs warm Chromium
  process, proved by moving which clip runs first. 5 fresh invocations and 3 reused ones across
  all three clips; the numbers above stand as measured on their commit (`verticalRatio` and
  `stepWidth` read differently on today's `main`). Full evidence: the rewritten **Determinism
  caveat** below.
- **The fresh-process default is close to free**: browser launch+close measures 63-77 ms, and end
  to end 3 trials came out 31.17 s fresh vs 31.06 s reused on Demo 2, and 43.5 s vs 42.2 s on
  Demo 1 — inside the per-trial jitter either way.
- **`--evidence`** additionally captures the `[evidence-coverage]` line as `evidence.*` rows
  (per-metric status/reason, and each exemplar's `timestamp`/`pairedTimestamp`/`cropSidePx`/
  `quality`). It waits for the stream to go **quiet** rather than taking the first line, because
  the scale-pass graft triggers a correct re-extraction and a second line; see "Take the LAST
  `[evidence-coverage]` line" below. Off by default — the settle wait costs real seconds per
  trial, and with it off the report is byte-identical to what the driver printed before.
- Prints the `WEBGL_debug_renderer_info` renderer string once per invocation and **refuses to run**
  on SwiftShader/software rendering rather than quietly producing unrepresentative numbers.
- Captures `sampling.*`, `view.*`, every metric's `value`/`confidence`, and the whole
  `personSelection` block (`segments[0]` included) **flattened from whatever keys are present**
  rather than an enumerated list, so a ticket adding a diagnostic doesn't have to edit the harness
  measuring it. Progress goes to stderr and the report to stdout, with a fixed field order, no
  timestamps, and a header stamping baseURL + whether the server was this run's + the commit — so
  `> before.txt` / `> after.txt` compare with `diff` and a provenance mismatch shows up on line 2.
  Verified: two same-version single-trial runs diff on exactly one line, `elapsedMs`.
  `--json <path>` also writes one record per (clip, arm) carrying every raw per-trial value.
- One throwaway navigation warms the server before the matrix — vite's on-demand transform and
  dep pre-bundling of the tfjs/MediaPipe graph is server-side and paid once, so without it
  whichever (clip, arm) went first absorbs all of it and reads systematically wide in the range
  column. Trial-major ordering after that, and a failed trial is recorded while the matrix
  continues.

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

**Determinism caveat — mostly a harness artifact, and the mechanism is browser-process warmth**
(rewritten 2026-08-29, `strides-b0y`; this paragraph previously blamed GPU float non-associativity
and frame-timing jitter, which is wrong for most of the spread this file records).

**Fresh process per trial is exactly reproducible, on all three clips.** Three independent
invocations of `scripts/ab-person-selection.mjs` at the default (fresh) regime — 3 + 3 + 5 trials,
a separate dev server each, real GPU, `ANGLE Metal Renderer: Apple M4 Pro` — agreed on **every
field except `elapsedMs`**: no spread within an invocation and no difference between invocations,
on Demo 1, Demo 2 *and* `multiperson`. Two further independent 8-trial `--evidence` invocations on
Demo 1 + multiperson reproduced that byte for byte, exemplar timestamps, crop sides and
`cropGrowth` included. That is **27 fresh trials on Demo 1, 11 on Demo 2, 27 on multiperson, over
5 invocations**; `metrics.kneeFlexion.value` reads `120.690220593611` on every Demo 1 trial of all
27.

**The spread is a COLD-vs-WARM process split, not scatter.** Under `--reuse-browser` (5 trials),
Demo 1 spread on ~23 fields — `segmentCount` 3↔4, `rejectedOtherSegment` 7↔10, `kneeFlexion`
116.924↔120.690, `overstriding` 0.172↔0.297, `stepWidth` −0.396↔−1.280. Per trial rather than as a
range, there are exactly **two states**: trial 1 is bit-identical to the fresh regime, and trials
2..N are bit-identical to each other at a different value. The upstream cause is one detection:
`personSelection.detectedSamplesIn` 66 (cold) vs 65 (warm), which re-partitions the track.

**Clip order proves it is the process, not the clip.** Re-running the same reused matrix with the
order reversed (`--clips multiperson,demo2,demo1`, 5 trials) moves the split: `multiperson` —
perfectly flat when it ran last — now splits between trial 1 and trials 2-5 (`detectedFrames`
103→127, `segmentCount` 3→2, `cadence` 174→`null`), with its trial 1 landing on the fresh regime's
exact values; and Demo 1 — which spread when it ran first — goes completely flat at the *warm*
values. Demo 2 never runs first in either order and is flat at its warm value both times. Only the
clip that gets the cold process shows a range.

**Which regime the other ranges in this file were measured under: the reused one.** Every `[a..b]`
recorded here before 2026-08-29 — the concealment table, the 4K-area-floor table, the
tracking-crop and person-of-interest A/Bs, the VO-family cross-trial spreads, `sampling.detected`
figures like "65-66 in" — predates the fresh-process default and was measured with one Chromium
process across trials. Read those range columns as an upper bound inflated by a cold/warm mixture
whose composition depends on trial index and clip order, not as physical spread. **They have not
been retrofitted**: they were honestly measured under a regime that is now named, and rewriting
them would destroy the record rather than correct it. The re-run judgement on the A/Bs whose
conclusions leaned on a range is recorded on bead `strides-b0y`.

The concealment table's "cold-start ramp" ("a first trial reads low and then climbs monotonically
to a 64 steady state") is this same effect, observed a session before it was explained.

**What fresh-process buys and what it costs.** It buys exact reproducibility, for ~65 ms a trial.
It costs representativeness: it pins *every* trial to the COLD operating point, and cold is not a
small perturbation of warm. On multiperson, cold samples 103 detected frames and warm 127 (+23%),
and `cadence`/`verticalOscillation`/`verticalRatio` resolve cold but are `null` warm. A real
user's browser is warm. So use fresh-process for anything that must reproduce or be diffed, and do
not read a fresh-process number as the number a user would see.

**What this does NOT explain.** The observations this paragraph used to carry are preserved, not
deleted: **74 vs. 75 detected frames across otherwise-identical MoveNet trials** (2026-08-11) and
MoveNet Thunder's much larger variance were both measured under the reused regime and neither has
been re-measured. The MediaPipe Tasks Vision path's bit-identical behaviour was measured there too
and is untouched by this. And "cold vs warm" is the demonstrated *correlate* — the microscopic
cause of the one flipped detection (JIT tier, WASM/shader cache, per-frame wall-clock budget) was
not isolated. n = 5 fresh invocations and 3 reused, one machine,
one session, on one commit — a mechanism demonstrated by a manipulation, not a proven law. For a
real before/after comparison, still run a few trials per variant; just expect the fresh regime to
hand you a single number rather than a range.

**Environment gotcha — the cached browser binary can be version-mismatched.** `playwright` is a
devDependency here (since `06d9f72`), so driver scripts written in this repo resolve the import and
run in place. But `chromium.launch()`'s default version-pinned browser lookup can fail if the only
cached binaries under `~/Library/Caches/ms-playwright/` don't match the installed `playwright`
package's expected revision (`Executable doesn't exist at
.../chromium_headless_shell-<rev>/...`). Bypass by pointing `executablePath` directly at a cached
full-Chromium binary instead of `headless_shell`, e.g.
`~/Library/Caches/ms-playwright/chromium-<rev>/chrome-mac-arm64/Google Chrome for
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
after `verticalOscillation`/`verticalRatio` — this took the panel from eight metrics to **nine**;
⚠️ the `MetricId` union has since grown to **eleven**, which is the count to check against today —
`src/heuristics/types.ts`, and `strides-x8w` swept three stale "ten" counts out of `src/` and the
results-view spec on 2026-08-29)
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
after the estimator swap). ⚠️ **The track row's `4.78–4.79` is STALE as a present-day anchor** — it
was measured with MediaPipe as the PRIMARY backend, before the background scale-pass graft path and
before #54/#55's person selection. On today's default MoveNet-primary path the anchor is
**4.4215 cm**; see "Regression anchor" at the end of the metric-frame-evidence section below. The
rest of this table stands as the record of that estimator swap:

| clip | VO_cm (extrema, before) | VO_cm (fit, after) | fit.sinusoidR2 | fit.frequencyHz ×60 vs cadence | sampleSize | driftRatio | torsoMeters | medianPxPerM |
|---|---|---|---|---|---|---|---|---|
| track (`try a demo video`) | 6.075–6.080 | **4.78–4.79** | 0.485–0.486 | 91.2 vs 91.2 (exact) | 3 | ~1.01 | ~0.505 | ~872 |
| park (`another demo`) | 11.7 / 14.9 / 15.5 | **9.4 / 10.2 / 12.0** | 0.42–0.73 | 175.2–196.8 vs 176.4–195.6 (≤2 grid steps) | 3–4 | 3.9–5.4 | ~0.47 | ~530 |

Track is the regression anchor and is stable to ±0.005 cm across trials — a >0.05 cm spread there
is worth investigating rather than averaging away. **Park is not deterministic** despite MediaPipe
being bit-reproducible elsewhere: its presence-trimmed window lands on 76/83/84 samples across
trials, and that alone moves the number. One baseline park trial sampled a single frame and
produced no `scaleCalibration` at all — the known cold-start flake, unrelated to any code change.

⚠️ **"Park is not deterministic" does NOT survive the fresh-process regime** (addendum
2026-08-29, `strides-b0y` — the 2026-08-12 numbers above are left exactly as measured). Three
fresh-process trials on today's default MoveNet-primary + grafted-scale-pass path return
`verticalOscillationCm` **10.486597716761532** cm, `fit.frequencyHz` 3.12, `sinusoidR2`
0.34968137749045114, **`sampleCount` 98**, `spanSeconds` 1.6182830000000001, `torsoMeters`
0.464629504405643, `medianPixelsPerMeter` 520.898452525673, `subjectAgreement` 99/99 — every digit
identical on all three. The presence-trimmed window does not land on 76/83/84 any more; it lands
on 98, every time. Eleven further fresh trials of the primary line (`--arm 'base={}'`) likewise
show zero spread on every Demo 2 field. Two things changed between the two measurements and this
addendum does not separate them: the regime (reused → fresh) and the path (MediaPipe-primary →
MoveNet-primary with a grafted scale pass). What is certain is that a reader today should not
expect park to wobble. See the rewritten **Determinism caveat**.

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

## The 4K area floor cannot be re-derived — measured and closed (2026-08-17, #57)

`minBoundingBoxAreaFraction: 2e-4` (`src/results/retroactivePersonSelection.ts`) resolves to
1,659 px² at 4K and does **not** catch Demo 1's 2,279–8,432 px² phantom detections on
keyframe-confirmed empty frames — the confirming symptom being `rejectedBelowFloor: 0` on both 4K
demo clips. Issue #57 (epic #52 item 4) set out to raise it so it would, and so Demo 1 would reach
`segmentCount === 1` / `rejectedOtherSegment === 0`, epic #52's amended headline gate.
**It failed on a pre-registered margin rule, and the reason kills the whole direction, not just
this attempt.** Do not re-litigate by picking a different number.

**The measurement.** A temporary `[bbox-trace]` probe (`boundingBoxTrace.experimental.ts` + one
dev-only log line + `scripts/bbox-trace-harvest.mjs`, all added-measured-reverted per the cycle
above) dumped every box-yielding detection **with no floor applied**, 3 trials × 3 clips, real
GPU. The extremes were then classified by pulling the keyframe at each timestamp.

```
A_4K = A_1080p×4 = 8,294,400 px²   (Demo 1 is 3840x2160; Demo 2 is 2160x3840 — PORTRAIT 4K,
                                    same frame area, transposed. A resolution "class" cannot
                                    key on width or height, only on frame area.)

G4 =  8,432 px²  Demo 1 t=8.36  keyframe: EMPTY TRACK          -> 1.0166e-3
S4 = 24,473 px²  Demo 1 t=4.32  keyframe: THE RUNNER (collapsed) -> 2.9506e-3   ratio 2.90
```

**Both endpoints come from the same clip and the same scene.** The squeeze is *intra-clip*, so it
is not a resolution problem and **no resolution model can widen it** — not a bigger fraction, not a
per-frame-area table, not a hybrid, not a power law. Phantom boxes and collapsed-subject boxes are
the same size and the same shape because they are the same kind of failure: a hull over too few,
badly-placed keypoints. The pre-registered rule wanted ≥4 (≥2× clear either side); 2.90 is the
generous reading and 1.32 the strict one.

**Two negative results, so nobody re-derives them:**
- **Confidence does not separate them.** Largest phantom: 9 confident keypoints, mean score 0.323.
  Genuine collapsed subject (the t=4.32 wedge): 4 and 0.258. A confidence gate rejects the *real*
  frame first.
- **Aspect ratio does not either.** Phantoms run 3.4:1 to 7.7:1 (h:w), well-detected subjects
  2.5:1 to 3.1:1 — cleanly separated until you notice the wedge is 7.1:1 and the multi-person
  clip's smallest genuine box is 4.6:1.

**The candidate was A/B'd anyway** (4 arms × 3 clips × 3 trials, `scripts/ab-person-selection.mjs`
unmodified, probe already reverted). `f = 1.7e-3` **does** reach the epic gate on Demo 1 —
`segmentCount` 3→1, `rejectedOtherSegment` 7→0, `rejectedBelowFloor` 4, winner still 53 frames from
t=0.08 at `medianAreaPx` 491,133, every metric value identical to baseline, Demo 2 bit-identical.
But the plateau collapses on both sides, which is the same 2.9× window measured behaviourally:

| | base `2e-4` | chosen `1.7e-3` | half `8.5e-4` | double `3.4e-3` |
|---|---|---|---|---|
| demo1 `segmentCount` | 3 [3..4] | **1** | 2 | 1 |
| demo1 `rejectedOtherSegment` | 7 [7..10] | **0** | 3 | 0 |
| demo1 `segments[0].frameCount` | 53 | 53 | 53 | **52** |
| demo1 `bridgedCuts` | 1 | 1 | 1 | **0** |
| demo2 | — | bit-identical | bit-identical | bit-identical |
| multiperson `segments[0].frameCount` | 123 | 119 | 121 | 112 |
| multiperson `medianAreaPx` | 31,670 | +0.84% | +0.7% | **+4.80%** |

`f/2` puts the 8,432 px² phantom back above the floor; `f×2` eats the 24,473 px² wedge and undoes
#54 (`frameCount` 52, `bridgedCuts` 0, `overstriding` 0.215→0.052). A factor-of-two cliff in both
directions, derived from three scenes, on footage nobody has measured.

**Where a next attempt should start**: the phantoms sit at **fixed screen positions with near-zero
motion** — Demo 1's cluster at x≈1710 across t=7.20/7.28/7.44, the multi-person clip's slivers
parked at c≈(492,604) for ~0.5s. Motion/persistence is the one discriminator the data supports and
a per-frame area threshold structurally cannot see. That is the **segmentation** stage's job, not
the floor's. Treat `2e-4` as a coarse degenerate-box filter and leave it alone.

**Also shipped from #57, independent of the number**: `retroactivePersonSelection.test.ts`'s
test-local `CONFIG` now pins `minBoundingBoxAreaFraction: 2e-4` explicitly instead of inheriting
the default. It had spread the default and overridden only `enabled`, which made a dozen fixtures'
above/below-floor status a live function of a number the suite is not measuring — `ABOVE_FLOOR_SIDE`
flips at 3.01e-4, the 60×60 bystanders at 1.736e-3, the 12-segment alternating fixture at 7.72e-4.
Verified load-bearing: with the default temporarily at 2.5e-3 the suite is green with the pin and
fails in nine places without it. `FLOOR_1080P` is now documented as the *test-local* floor.

Full tables, per-endpoint keyframe verdicts, the pre-registered criteria and the gate-by-gate
adjudication: `openspec/changes/derive-area-floor-from-4k-measurement/design.md`. The change
carries `skip_specs: true` — the sizing requirement drafted for it is **withdrawn**, because the
measurement shows it is unsatisfiable on this repo's own footage and weakening it to fit would be
editing a criterion to match a result.

## The app shell — clips live in the header strip (2026-08-18, epic `strides-kyu`)

**Clips are no longer a page column.** The two-column `lg:grid` layout is gone: clips left the page
body entirely and now render as a **strip in the application header** (`role="banner"`), one entry
per clip (`ClipStripEntry.tsx`, `clipStripStatus.ts`), while the results own the page as its main
content. Spec: `openspec/specs/multi-clip-analysis/spec.md` and `openspec/specs/results-view/spec.md`;
archived change `openspec/changes/archive/2026-08-17-navbar-clip-shell/`.

What this changes for anything driving or reading the app:

- **Clip `<video>` elements stay mounted and playable while hidden.** Sampling reads frames off a
  live, playing element, so hiding is visual only — never conditionally rendered, never behind a
  mount gate. **The strip thumbnail IS the live element while that clip's analysis is in flight**,
  reverting to a static poster (`posterFrame.ts`, `useClipPoster.ts`) once it reaches a terminal
  phase. That is not cosmetic: see the concealment/throughput finding in the harness section above
  for why the analysing clip must stay genuinely on screen.
- **Playback loops only while a clip is presented.** Reaching `phase: 'ready'` no longer starts a
  loop on its own — an unpresented clip stays paused. A clip is presented by opening its preview
  (`ClipPreviewDialog.tsx`), which reveals that clip's own element with its skeleton overlay.
- **Per-clip progress is rendered from each clip's own analysis state**, not from the session
  aggregate — verified live at 36 of 37 snapshots showing genuinely differing per-clip conditions.
  Session status stays a single announced line.
- **The in-body "Add another clip" block is gone**, replaced by an add-a-clip action in the header
  (`AddClipAction.tsx`), an in-flow disclosure that grows the header downward rather than an
  overlay. Asserted structurally: once a clip is loaded, `main` contains no `input[type=file]` and
  no text matching `/add (another|a) clip/i`.
- **Recording and demo clips are now reachable for clips 2..N** — they were not. Every `addClip`
  records a `pendingLoad`, so the new slot's own picker (gated on `status === 'empty'`) never
  rendered, leaving upload as the only route past clip 1. Both verified live: recording a second
  clip reaches `'Clip 2 of 2: Analyzed'`, and the Demo 2 button reaches
  `'Combined from clip 2 of 2.'`
- **`ClipPicker.tsx` owns the zero-clip state** as a full-page picker, and holds the demo buttons.
- **The `86px` / `150px` header constants are gone.** Three of the four hardcoded offsets left with
  the restructure; the surviving `max-h-[calc(100vh-150px)]` was a *false* dependency and was
  removed rather than re-derived. Nothing in `src/` reads a hardcoded header height now.

**Open, not decided — `strides-49e`.** `MetricsPanel.tsx` still renders the card grid as
`<div className="@container grid gap-4 @lg:grid-cols-2 @3xl:grid-cols-3">`. An element with
`container-type: inline-size` establishes a query container for its *descendants* and cannot query
itself, so those two utilities have never matched and the card grid has always been **one column at
every viewport width** (measured: 1104 px wide at a 1440 viewport, still one column). Pre-existing,
not a regression from this epic. The fix is one wrapper div, but it is a visible layout change with
a product decision inside it — today's full-width cards are why inline evidence sits beside the
description on a desktop, which is the behaviour the evidence epic was asked for. **Left open
deliberately; do not "fix" it as a typo.**

## Three metric-layer changes that moved numbers this file quotes (2026-08-29/31)

Every "expected value" recorded elsewhere in this file predates at least one of these. Check a
surprising reading against them before filing it as a regression.

**1. `view.confidence` is now comparable between a side label and a front label** (`strides-2iw`,
`a468fdb`, archived `2026-08-29-compare-view-confidence-across-labels`). It was not: the old
`marginAwayFromZero(value, threshold)` saturated at 2× the threshold, and for the bilateral-spread
ratio that point (1.10) sits at roughly twice the signal's ANATOMICAL maximum — so a perfect front
view structurally topped out around 0.51–0.61 while a side view could reach 1. Every per-(view,
signal) margin now ramps from its threshold to what that signal reads with the camera dead-on for
that view. **`frontViewMinBilateralSpreadRatio` moved 0.55 → 0.45**, forced rather than preferred:
0.55 sat BETWEEN a narrow build's dead-on value (0.4712) and the central one (0.5612), so it was
unreachable at any camera angle for a narrow-built runner. A threshold sweep is **flat across
0.35–0.50** — a plateau, the opposite of the 4K-area-floor's factor-of-two cliff, and the reason
this one was shippable. Measured effect: Demo 2 **0.0771 → 0.5343**, side controls untouched to
every digit, and **no metric changed value, confidence, `viewFit` or tier on any clip**.
- **Consequence for this file:** every `view confidence` figure recorded above this section — the
  pipeline-comparison table's `~0.76-0.79`, the tracking-crop A/B's park `0.073–0.136` — is on the
  OLD scale. Side-label numbers survive the rescale essentially unchanged; **front-label numbers do
  not** and must not be compared against a reading taken today. Current fresh-process values on
  `c79d307`: Demo 1 **0.7615**, Demo 2 **0.5486**, multiperson **0.7132**.
- Established in passing and worth knowing: `view.confidence` has exactly TWO readers —
  `fuseHeuristics.ts`'s cross-clip view pick and the dev diagnostics line. Everything user-facing
  gates on `view.plausibility` instead, since `strides-ich`.

**2. `armSwingSymmetry` is fitted, not scanned** (`strides-gzl`, `2ed7f0b`, archived
`2026-08-29-fit-arm-swing-amplitude`). The prominence-threshold extremum scan was latching onto
sub-cycle wiggles — 9 half-swings per side on Demo 2 across a window holding ~4.8, with spacings
down to 0.050 s against a 0.331 s half-cycle. Replaced by the shared spectral sinusoid fit +
`selectBounceInstants`, so an exemplar pair spans a half-cycle **by construction**, plus a
cross-side frequency-agreement check and a caveat naming a fit disparity. The 54.9% asymmetry was
REAL but overstated: both arms fit the stride rhythm within one grid step, but the weaker-looking
right arm fits at R² 0.497 against the left's 0.778. **Demo 2 moved 0.5464 → 0.6066 and its
confidence 0.980 → 0.385 — normal tier to caveated.** Re-measured on `c79d307`: value
`0.606563233508127`, confidence `0.38457189580244544`, exemplar pairs spanning 0.35035 s (left) and
0.33367 s (right). Anywhere this file shows `armSwingSymmetry` at high confidence on Demo 2, that
number is pre-`2ed7f0b`.

**3. Footstrikes are timed from the fitted hip-bounce phase** (`strides-cjl`, `478d271`/`7564e9d`/
`1b6720c`, archived `2026-08-31-derive-footstrike-timing-from-bounce-phase`). Touchdown = the
fitted hip-bounce low point minus `T/4`; the ankle-difference detector is retained VERBATIM as the
fallback when the hip fit is poor. This moves every consumer of `detectFootstrikes` —
`overstriding`, `footStrikePattern`, `stepWidth`, `stepWidthCm` and transitively `verticalRatio` —
on every clip. Demo 1, before → after: `overstriding` 0.29735 @ 1.000 → **0.325743 @ 0.875**,
`footStrikePattern` −0.0251745 @ 1.000 → **+0.00108462 @ 0.875** (midfoot both ways),
`verticalRatio` 0.0353716 @ 0.2397 → **0.0310419 @ 0.4795**. All three reproduce exactly on
`c79d307`. `cadence` does not consume this detector and did not move. A **+0.11 s systematic**
residual remains, shipped uncorrected on principle — fitting an offset is the thing this change
exists to stop — and is filed as `strides-24s`.

⚠️ **Demo 1's footstrike ground truth was itself wrong, and the corrected set is the one to use**
(addendum 2026-08-31, `strides-dly`). `strides-da8` recorded the contact onsets as ffmpeg
`3.90 / 4.60 / 5.16 / 5.84` (app `3.98 / 4.68 / 5.24 / 5.92`) and both its own design and
`strides-cjl`'s acceptance criterion were stated against them. Keyframes pulled from the source at
0.04 s intervals with a grid overlay, judged on shoe-versus-shadow, put them **1.5 to 4 frames
later**:

| contact | `strides-da8` (ffmpeg) | keyframe-confirmed (ffmpeg) | error |
|---|---|---|---|
| 1 (left) | 3.90 | **4.00** | 2.5 frames early |
| 2 (left) | 4.60 | **4.66** | 1.5 frames early |
| 3 (right) | 5.16 | **5.32** | 4 frames early |
| 4 (right) | 5.84 | **5.98** | 3.5 frames early |

**Corrected app-domain onsets: `4.08 / 4.74 / 5.40 / 6.06`** (ffmpeg + this clip's own 0.08 s
edit-list shift, unchanged). The original set is spaced 0.70 / 0.56 / 0.68 s; the corrected set is a
uniform **0.66 s**, agreeing with the clip's own fitted step period of 0.658 s to 0.3% — that
regularity is itself the evidence. Independently corroborated by the app's own `ankle.x` going
stationary (325 px/s against the hip's 1617 px/s) from app ≈ 4.84. The old numbers are NOT rewritten
where they were honestly recorded; `2026-08-29-detect-footstrike-contact-onsets/design.md` carries a
correction note beside them, and the full derivation is that change's own
`design.md` **D11.1**.

## Metric frame evidence — inline, annotated, measured live (2026-08-17/18, epic #59 and `strides-ac9`)

**Each metric card carries its own evidence, inline.** For every metric the app re-pulls the frames
it actually measured out of the clip after analysis and renders them as small **annotated
thumbnails inside that metric's own card**, ghosting two instants into one image where the metric's
meaning is a delta. The picture and the number it explains are on screen together.

**The ghost is NOT half the picture — 65/35, and two constants, since 2026-08-19 (`strides-c37`).**
The photograph was a symmetric `0.5·base + 0.5·ghost` (measured, PSNR peak at exactly 50/50) while
the caption and the annotation both named the base as the subject, so the picture contradicted its
own labels and the solid skeleton could read as sitting on the wrong body. `EVIDENCE_GHOST_OPACITY`
split into **`EVIDENCE_GHOST_BLEND_ALPHA = 0.35`** (photograph, `evidenceFrames.ts` only —
`source-over` makes that a 65/35 split toward the base) and **`EVIDENCE_GHOST_MARK_OPACITY = 0.5`**
(annotation marks, `evidenceAnnotations.ts` only, unchanged in value). The archived
`metric-frame-evidence`/`inline-annotated-evidence` designs still state the symmetric 50/50 intent
and are stale on this point. Number chosen by a five-arm sweep judged at the real 144 px size on all
three clips: `openspec/changes/weight-evidence-ghost-below-base/design.md`.

**The standalone gallery is gone.** There is no "What the analysis looked at" section below the
results, and no deep link from a card to one — `EvidenceGallery.tsx` was deleted (`strides-ac9.3`).
Ignore any older note below or elsewhere that describes a gallery section, a gallery figure, or a
"See evidence" link. The `src/` doc comments that still said "gallery" were swept on 2026-08-31
(`strides-hcm`); the word now survives in `src/` only where a comment names `EvidenceGallery.tsx`
as a deleted component it inherited code or discipline from — plus one test title in
`evidenceSeekOffset.test.ts`, left alone because renaming it is a code change, not a comment fix.

Current modules: `evidenceFrames.ts` plans purely, `evidenceAnnotations.ts` derives every annotation
mark's geometry purely, `extractFrames.ts` produces pixels, `drawEvidenceAnnotations.ts` paints the
marks, `EvidenceCanvas.tsx` renders, `useSessionEvidence.ts` drives extraction for the session,
`evidenceCaptions.ts` writes the captions, `evidenceSeekOffset.ts` calibrates the seek.

Everything below was measured in headless Chromium on real GPU
(`ANGLE Metal Renderer: Apple M4 Pro`, never SwiftShader), 3 trials per clip, across Demo 1, Demo 2
and `e2e/fixtures/multiperson-track.mp4`, plus two-clip sessions. Full tables:
`openspec/changes/archive/2026-08-17-metric-frame-evidence/design.md` **D14** and
`openspec/changes/archive/2026-08-17-inline-annotated-evidence/design.md`.

**Evidence images ARE annotated now — and the ban that survived is the one that matters.** The
images are no longer plain photographic crops: they carry the **detected joints** and the
**per-metric measurement geometry** (the actual construction each metric measured — calipers,
stride ticks, arcs, hip-mid crosses, travel-direction arrowheads). The earlier prohibition on
drawing *any* annotation over an extracted image was **deliberately reversed** for the runner's own
detected and measured geometry. **The adjacent ban survives and was strengthened**: an annotation
SHALL NOT overlay a reference or ideal posture — the only delta shown is the runner against
themself. That distinction is the whole point, so keep the two apart when reading the spec: drawing
what *was measured* is now required; drawing what *should have happened* is still forbidden.
Requirements: "Evidence thumbnails annotate the runner's own measured geometry and never a reference
posture" and "An annotation depicts what was measured at the depicted instant, never the card's
reported value" in `openspec/specs/results-view/spec.md`.

Annotation geometry is decided in the **pure** layer, not in a draw call — the unit suite runs where
`getContext('2d')` returns `null` by deliberate choice, so any geometry decided inside a draw call is
geometry no test can reach. There is **no text** in any annotation: no `fillText`/`strokeText`/
`measureText`/`font` in any annotation or extraction module, and zero text visible across ~15
inspected images.

**Legibility, measured by looking at every image at its real inline size.** The cyan joint layer and
the amber measurement layer are cleanly distinguishable at the 112 px inline size, and the joints
land on the right body throughout. Honest limit: the VO/VO_cm bounce delta (two guides 15-20 px
apart on a 640 px canvas, so ~3 px displayed) and the arc/caliper end-ticks **do not resolve** at
112 px — the gestalt reads, the fine marks do not. Best image on any clip is `verticalRatio`'s
`stridePair`.

⚠️ **Two corrections to the paragraph above, neither of which un-measures it** (2026-08-31). (1)
**The inline size is no longer 112 px**: `0325943` widened the thumbnail to `w-36` — 144 CSS px
nominal, **142 measured** (`strides-c37` recorded the 1.4% gap and deliberately left the design's
144 alone). Every "at 112 px" reading here is therefore a floor; the ~3 px bounce-guide separation
scales to roughly 4 px, still marginal rather than resolved. (2) **`verticalRatio`'s `stridePair`
is not produced any more** on any clip — see "Coverage re-measured 2026-08-31" below — so the
"best image" nomination names an image a reader can no longer find.

**A third dev-only console line, `[evidence-coverage]`.** Same contract as the two
`[analysis-diagnostics]` lines — `import.meta.env.DEV`-gated, `JSON.parse`able, matched exclusively
on `startsWith('[evidence-coverage]')`, and it carries **nothing image-shaped** (no canvas, `Blob`,
object URL or data URI — verified by scanning 38 captured lines). It reports, per clip:
`frameCount`, and per metric either `{status:'planned', exemplars:[{kind, side?, quality, timestamp,
pairedTimestamp, demotedFromPair, cropSidePx, cropGrowth}]}` or `{status:'no-evidence', reason}`
where reason is
`not-emitted | all-gated-out | metric-excluded | frames-unavailable | extraction-failed`. Plus
`sourceIndices`, the per-metric winning clip index. `[analysis-diagnostics]` is untouched — same six
top-level keys, ~5.5-5.6 kB, no exemplar data — and `vite build` output contains **zero** occurrences
of any of these prefixes. **This contract survived the move to inline annotated evidence unchanged**
and was re-verified on four clips: still the same six top-level keys, still no canvas/blob/dataUrl/
exemplar/crop, and the shipped JS still carries zero dev-only prefixes. It is still the right way to
read coverage — do not screen-scrape the cards.

**Take the LAST `[evidence-coverage]` line, not the first.** The design says "once per run"; that is
not what happens. On a MoveNet-primary run the background MediaPipe scale pass grafts
`verticalOscillationCm` into the fused heuristics *after* `phase: 'ready'`, which changes the
evidence input signature, correctly triggers a re-extraction, and emits a second line. Observed on
Demo 1: line 1 has `verticalOscillationCm: metric-excluded`, line 2 has it `planned`. Whether a
harness sees one line or two is a race against the scale pass.

**Coverage** (✅ = images produced; count is images, a ghosted pair being 1). ⚠️ **The table
immediately below is the 2026-08-17/18 reading and is NO LONGER the number to check a regression
against** — jump to "Coverage re-measured 2026-08-31" a few paragraphs down for the current one.
It is kept because the per-metric reasons it records are still the explanation for how the current
figures were reached. As measured then, Demo 1 and Demo 2 were **exact and reproduced on every
trial**, re-confirmed independently by both epics' live verification, and **multiperson was NOT** —
see the caveat under the table:

| metric | Demo 1 | Demo 2 | multiperson |
|---|---|---|---|
| `verticalOscillation` | ✅ 1 | ✅ 1 | ✅ 1 |
| `verticalRatio` | ✅ 2 | excluded | ✅ 2 |
| `verticalOscillationCm` | ✅ 1 (post-graft) | ✅ 1 | ✅ 1 |
| `trunkLean` | **`all-gated-out`** | excluded | **`all-gated-out`** |
| `overstriding` | **`all-gated-out`** | excluded | **`all-gated-out`** |
| `cadence` | `not-emitted` by design | `not-emitted` | `not-emitted` |
| `kneeFlexion` | ✅ 1 | excluded | ✅ 1 |
| `armSwingSymmetry` | excluded | ✅ 2 | excluded |
| `footStrikePattern` | ✅ 2 | excluded | ✅ 2 |
| `stepWidth` | excluded | ✅ 1 | excluded |
| `stepWidthCm` | excluded | excluded | excluded |
| **totals** | **7 images / 5 sections** | **5 / 4** | **range, see below** |

**`trunkLean` on multiperson is now correctly `all-gated-out`, not ✅ 1.** It is rejected by the
far-apart-pair guard (`EVIDENCE_MAX_PAIR_CROP_GROWTH = 2.5`, `evidenceFrames.ts`) — its pair's crop
growth is **3.375**, and the ghost it used to produce was unreadable. Gated out on all 3 trials.

**Record multiperson as a RANGE, not a number: observed 7/5, 4/3, 4/3 across trials.** That clip's
analysis is **not run-to-run deterministic**, so its coverage totals move between trials. The
per-metric multiperson column above is the highest-coverage trial (7 images / 5 sections); the
lower trials drop further metrics, and which ones is not pinned per-metric here. `trunkLean`'s
`all-gated-out` is the one multiperson cell confirmed identical on every trial. Do not treat a 4/3
reading there as a regression without checking against this range first.

⚠️ **"multiperson is not run-to-run deterministic" does NOT survive the fresh-process regime**
(addendum 2026-08-29, `strides-b0y` — the 7/5, 4/3, 4/3 observation above is left exactly as
measured). Two independent 8-trial `--evidence` invocations at the default (fresh) regime, 16
trials, returned a **bit-identical `[evidence-coverage]` payload every time** on multiperson:
same per-metric status, same exemplar `timestamp`/`pairedTimestamp`/`quality`/`cropSidePx`/
`cropGrowth` to full precision. Eleven further fresh trials of the primary line show zero spread
on every multiperson field. Under `--reuse-browser` the same clip splits into two states the
moment it runs first in the process (`detectedFrames` 103 cold vs 127 warm) — that split, not the
clip, is what the 7/5–4/3 range was recording. Caveat: this is today's `main`, several evidence
changes downstream of the 2026-08-17/18 table, so the *values* are not comparable to the column
above — only the presence or absence of a range is. See the rewritten **Determinism caveat**.

**Coverage re-measured 2026-08-31 on `c79d307` — this is the current reference** (`strides-h4u`).
`scripts/ab-person-selection.mjs --arm 'base={}' --clips demo1,demo2,multiperson --trials 3
--evidence`, fresh Chromium process per trial, dev server started and identity-verified by the run,
real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), reading the LAST `[evidence-coverage]` line.
**Bit-identical across all three trials on all three clips** — per-metric status, exemplar
`timestamp`/`pairedTimestamp`/`quality`/`cropSidePx`/`cropGrowth` to full precision.

| metric | Demo 1 | Demo 2 | multiperson |
|---|---|---|---|
| `verticalOscillation` | ✅ 1 | ✅ 1 | ✅ 1 |
| `verticalRatio` | ✅ 1 | excluded | ✅ 1 |
| `verticalOscillationCm` | ✅ 1 (post-graft) | ✅ 1 | ✅ 1 |
| `trunkLean` | ✅ 1 | excluded | ✅ 1 |
| `overstriding` | ✅ 1 | excluded | ✅ 1 |
| `cadence` | `not-emitted` by design | `not-emitted` | `not-emitted` |
| `kneeFlexion` | ✅ 1 | excluded | ✅ 1 |
| `armSwingSymmetry` | excluded | ✅ 2 | excluded |
| `footStrikePattern` | ✅ 2 | excluded | ✅ 2 |
| `stepWidth` | excluded | ✅ 1 | excluded |
| `stepWidthCm` | excluded | excluded | excluded |
| **totals** | **8 images / 7 sections** | **5 / 4** | **8 images / 7 sections** |

**multiperson is a single number again, and the "record it as a RANGE" instruction above is
retired.** Read that paragraph as a record of what the reused-browser regime produced, not as
advice: under the fresh-process default this clip reads 8/7 on every trial. What is *not*
comparable across the two tables is the **values** — several evidence changes land in between — so
do not read a per-metric difference as a regression without checking it against this table first.

**Four cells moved, and every one of them is expected drift from named changes:**
- **`trunkLean` and `overstriding` now emit on Demo 1 and on multiperson**, where the old table
  records `all-gated-out` on both clips. `edb3f07` (fall back to the next-best croppable exemplar
  pair), `9fa169c` (rank exemplar candidates by quality rather than scoring only the argmax) and
  `4fac355` (judge a pair on the crop it demands, before the frame cap clamps it) are exactly the
  fixes the old table's own follow-up **#70** predicted would move these cells. Measured qualities:
  Demo 1 `trunkLean` 0.567 (crop 1687.4 px, growth 1.866), Demo 1 `overstriding` 0.500 (crop 2160 px
  — the frame cap — growth 2.428), multiperson `trunkLean` 0.692 (crop 732.6 px, growth 2.289),
  multiperson `overstriding` 0.500 (crop 696.1 px, growth 2.175).
- **So `trunkLean` on multiperson is no longer `all-gated-out`**, and the note above explaining that
  cell is superseded: `EVIDENCE_MAX_PAIR_CROP_GROWTH` is untouched at 2.5, but the pair it now
  chooses demands 2.289 rather than the 3.375 the old pair demanded. The guard did not weaken; a
  better pair became reachable.
- **`verticalRatio` drops from ✅ 2 to ✅ 1 on Demo 1 and on multiperson.** Its one surviving
  exemplar is the `bounceCycle`; the `stridePair` that used to accompany it does not reach the
  line on any clip, on any trial. `MAX_EXEMPLARS_PER_METRIC` is still 2, so this is not the budget,
  and the metric itself still resolves on both clips — **the stage that drops it was NOT isolated
  in this docs pass**, and the two plausible suspects are `ceee2dc`'s fitted-step-period gate
  (`strides-dy8`, which changes which pairs exist) and `strides-cjl`'s footstrike re-timing (which
  moves every instant a stride pair is built from). Worth a bead if the image is wanted back.
  Either way it retires the "best image on any clip is `verticalRatio`'s `stridePair`" claim
  recorded under Legibility above: that image is not produced any more.
- **Demo 2 is unchanged at 5 / 4**, cell for cell, and its `armSwingSymmetry` pair still sits on
  the `EVIDENCE_CROP_MIN_SIDE_PX` floor at `cropSidePx` 320 — now centred on the subject, see the
  bystander bullet below.

`excluded` = `metric-excluded`, the tier-3 gate (the metric has no card, so there is nothing to hang
evidence on) — not the exemplar gate. **Zero `extraction-failed` on any run.** `cadence` deliberately
never emits (design D7). `stepWidthCm` produced nothing anywhere, for a reason outside this feature:
it is tier-3 on all three clips.

**The PTS drift was real and it is now FIXED — a per-clip, per-sampler offset ships.** The
measurement below stands as the diagnosis; the conclusion that followed it ("stays 0, do not fix it
by picking a number") does not. `sequentialSampling` defaults on, so most
MP4s sample through WebCodecs, where `robustFrames[].timestamp` is raw `sample.cts / sample.timescale`
(`mp4Demux.ts:174`) with **no edit-list adjustment**, while `HTMLVideoElement.currentTime` **is**
adjusted. Ground-truthed by rebuilding each exemplar's exact crop from the source with
`ffmpeg -vf "select='eq(n\,IDX)',crop=…,scale=…"` at a range of candidate frame indices (blended
50/50 for a ghosted pair) and PSNR-comparing against the app's own canvas — the argmax names the
frame actually drawn. ⚠️ **If you re-run this recipe, the blend is no longer 50/50** — since
`strides-c37` the photograph is `0.35·ghost + 0.65·base`, so a reconstruction blended 50/50 will
mis-rank candidates. The measurements in the table below were taken when 50/50 was correct and are
left as measured:

| clip | `elst media_time` ÷ media timescale | measured | best PSNR vs runner-up |
|---|---|---|---|
| Demo 1 (25 fps) | 2 / 25 = **0.0800 s** | **+2 frames** | 40.8 vs 21.6 dB; 34.0 vs 20.3 dB |
| Demo 2 (59.94 fps) | 2002 / 60000 = **0.033367 s** | **+2 frames** | four exemplars, +2 first in all |
| multiperson (60 fps) | 512 / 15360 = **0.033333 s** | **+2 frames** | 17.5/15.3, 22.0/20.6, 16.4/15.2 dB |

**Isolated to the WebCodecs domain, not to seeking.** The same Demo 1 clip under
`{ sequentialSampling: { enabled: false } }` measures **exactly 0** — δ=0 wins at 35.7 dB and
33.7 dB, ~15 dB clear. That path uses `requestVideoFrameCallback`'s `mediaTime`, already in
`currentTime`'s domain.

**The offset is now DERIVED PER CLIP, not configured — `src/video/evidenceSeekOffset.ts`.** The
reasoning that once argued for leaving it at 0 was right about the diagnosis and wrong about the
remedy: the correct value genuinely is per-clip (it is that clip's own edit list) **and** per-sampler
(exactly 0 for every WebM/webcam clip and every MP4 `canUseSequentialDecode` turns down), so no
single constant works — but both facts are recoverable from the clip's own bytes.
`resolveEvidenceSeekOffsetSeconds(blob)` re-derives them using the same two predicates the analysis
run itself used (`resolveSamplingRobustnessConfig().sequentialSampling.enabled` and
`canUseSequentialDecode(blob)`, both pure functions of the blob and the environment), reads the
`elst` via `containerTiming.ts`, caches per `Blob`, and returns **0** for any edit list that is not a
single constant shift. `extractFrames.ts` applies it at seek time and **never mutates
`robustFrames[].timestamp`** — that array is correct in its own domain.
`DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS` still exists and is still `0`, but it is now only the
fallback when no per-clip value is supplied.

**Why it was fixed rather than accepted: 31% of a torso.** Misregistration was measured in output
pixels — `‖p(t + offset) − p(t)‖` for every joint an annotation draws, scaled to the output canvas —
not in frames, because pixels are what decides whether a drawn skeleton floats off the body. Demo 1
came in at a **median 64.4 output px = 31% of a torso length**; Demo 2 at a median 7.2 px. Unannotated
photographs hid that; annotated ones would have looked broken while the numbers were right.
**Zero by construction after the fix.** Measured per-clip offsets, all exact: Demo 1 **−0.08**
(2/25), Demo 2 **−0.03336666666666667** (2002/60000), multiperson **−0.03333333333333333**
(512/15360). The webcam gap the assessment could not reach was later closed directly: a live
`getUserMedia` + `MediaRecorder` capture (`video/webm;codecs=vp9`, 205 samples,
`sampling.path 'playback'` — the rVFC branch that must not shift) returned **exactly 0** on both
extraction passes.

**One residual, and it is not the arithmetic: δ = −1 frame on the multiperson clip only**
(`strides-ac9.12`, **open**). δ = 0 on both demo clips. It reproduces with a **pure Chromium seek and
no app involved**, so it is not an app race: Chromium quantises to integer microseconds, and this
clip's stored timestamp sits ~1 µs above the double-subtraction result, putting the flip inside a
~0.6 µs window just above the frame's presentation timestamp. The arithmetic is correct and lands
**on** the frame boundary by construction. **Explicitly not to be fixed with an epsilon.**

**The extreme-role `1.5·MAD` risk fired — and only for `overstriding`.** An extreme instant's
typicality is `|v − median| / (3·MAD)`, so clearing `MIN_EXEMPLAR_QUALITY = 0.5` needs
`|v − median| ≥ 1.5·MAD`. Measured per-instance distributions (primary MoveNet pass, **bit-identical
across all 3 trials on all 3 clips** — no spread to report, which is itself notable):

| clip | metric | n | median | MAD | max dev (MADs) | ≥1.5 MAD | most: MADs / `detectionFactor` | least | pair quality |
|---|---|---|---|---|---|---|---|---|---|
| Demo 1 | `trunkLean` | 59 | 13.297° | 3.016° | 3.526 | 18 | 2.355 / **0** | 2.476 / 1 | **0.000** |
| Demo 1 | `overstriding` | 7 | 0.2266 | 0.2403 | 3.354 | 2 | **1.010** / 1 | 2.207 / 1 | **0.337** |
| Demo 2 | `trunkLean` | 99 | 3.002° | 1.414° | 3.108 | 14 | 2.148 / 1 | 2.412 / 1 | 0.716 |
| Demo 2 | `overstriding` | 7 | −0.0435 | 0.0422 | 14.495 | 1 | 1.211 / 1 | **1.000** / 1 | **0.333** |
| multiperson | `trunkLean` | 107 | 3.427° | 2.183° | 21.038 | 31 | 2.678 / 1 | 2.776 / 1 | **0.893** |
| multiperson | `overstriding` | 11 | 0.0542 | 0.3993 | **1.389** | **0** | 1.389 / 1 | 1.366 / 1 | **0.455** |

`describeDistribution().usable` was **true in every case** — the `<5 instances`/`MAD === 0` flat-0.5
fallback never fired, so it explains nothing here.

- **`overstriding` emits on no clip, always by the ramp** (0.333/0.337/0.455), never by
  `detectionFactor` (1.0 everywhere) and never by the `3·MAD` hard reject. multiperson is the clean
  proof: `maxDevMads = 1.389`, **zero** instants ≥1.5 MAD — unreachable at any `detectionFactor`.
  Demo 2's `least` sits at exactly **1.000 MAD**, the textbook tightly-bimodal ceiling for a
  left/right-alternating footstrike distribution. `MIN_EXEMPLAR_QUALITY` was **not** touched.
- **`trunkLean` is NOT the same problem.** Its pair quality reaches 0.716/0.893 — it clears this
  gate comfortably where `overstriding` cannot. Its Demo 1 failure is `detectionFactor = 0` on the
  argmax instant (t = 4.28 s, all four torso seed keypoints interpolated), while 18 other instants
  clear 1.5 MAD. **On multiperson it now emits no image either, but for an unrelated reason** — it
  passes this quality gate at 0.893 and is then rejected by the far-apart-pair crop-growth guard
  (see the coverage table above). Do not read its `all-gated-out` there as a MAD failure.
- **Second defect, separable and cheaper to fix:** `buildExemplars` in both metrics takes the raw
  argmax among outlier-bound survivors and *then* scores it, with no fallback to the next-most-extreme
  instant. Coverage therefore hinges on one frame. Proof: the same Demo 1 clip under
  `{ sequentialSampling: { enabled: false } }` samples a different set, the argmax lands on a
  well-tracked frame, and `trunkLean` **emits at quality 0.664**. Both in follow-up **#70**.

⚠️ **The three bullets above describe a state that has been FIXED — `overstriding` and `trunkLean`
both emit on Demo 1 and on multiperson today** (addendum 2026-08-31, `strides-h4u`; the
distribution table and the bullets are left exactly as measured, because the mechanism they
describe is still how the gate works and still what a future regression would look like). #70's
"second defect" — one argmax, scored after the fact, no fallback — is what `9fa169c` (rank
candidates by quality) and `edb3f07` (fall back to the next-best croppable pair) closed, with
`4fac355` measuring a pair's crop growth before the frame cap clamps it. Measured on `c79d307`:
Demo 1 `overstriding` 0.500 and `trunkLean` 0.567, multiperson `overstriding` 0.500 and `trunkLean`
0.692 — all four at or above `MIN_EXEMPLAR_QUALITY`, which was still not touched. Note two of them
land at exactly 0.500: these metrics clear the gate, they do not clear it comfortably, so a change
that shaves the ramp will silently take `overstriding`'s coverage back out on both clips.

**Image-quality findings — all three original defects are now closed** (every image was pulled
out of the DOM and looked at, both epics, full-res and at the real inline size — **112 px when
these three were judged; the cards were widened to `w-36` afterwards and the inline size is now
144 px nominal, 142 measured**, so every "at 112 px" reading below is a floor rather than the
present-day rendering):
- **`trunkLean` on multiperson was a whole-frame crop — FIXED.** Its two extremes are 1.25 s apart,
  the runner crosses the frame between them, `computeEvidenceCropRect` unioned both torso boxes,
  squared, and hit the `min(frameWidth, frameHeight)` cap → side 1080 on a 1920×1080 clip, showing
  the runner twice and tiny at opposite edges of an image that was mostly fence and crowd.
  Annotation made it unmistakable rather than merely odd: 27 of 28 off-canvas drawn ops across all
  three clips were this one case. Closed by the far-apart-pair guard
  (`EVIDENCE_MAX_PAIR_CROP_GROWTH = 2.5`, `isTooFarApartPair`) — the pair is now gated out instead
  of ghosted, and the **largest crop on that clip is 509 px**. Note the guard is the complement of
  D12, which demotes a pair that is too *similar*.
- **`armSwingSymmetry` on Demo 2 included a bystander, every trial — FIXED** (`strides-e9b`,
  archived change `openspec/changes/archive/2026-08-30-place-floored-evidence-crop-on-subject/`).
  `EVIDENCE_CROP_MIN_SIDE_PX = 320` inflated the small limb box until it swallowed a man in a
  yellow shirt standing to the right, who read as a second body. **The 320 did not move, and the
  advice not to move it stands** — it came from display reasoning, not from this clip. What changed
  is where a floor-inflated crop is PLACED: `frameSubjectExtentBox` + `subjectCentredCropRect`
  (`evidenceFrames.ts`) re-centre a crop on the subject's own keypoint extent on any axis where the
  FLOOR, not the padding, is what made it wider than the body. Verified by looking: the bystander
  is gone, and every other image on all three clips was byte-identical to baseline. Demo 2's
  `armSwingSymmetry` exemplars still sit at `cropSidePx` 320 on `c79d307`, so the floor is still
  binding — the crop is just aimed correctly now. (The caption this bullet used to quote — the
  "not two people" disclaimer — is also gone, dropped by `aed9a84` as restating what a *ghosted
  against* label already says.)
- **A bounce ghost read as horizontal translation on a side view — materially improved.**
  `verticalOscillation` on Demo 1 is two clearly-separated horizontal positions with the vertical
  delta the smaller displacement; the same exemplar on the front-approach Demo 2 always read well.
  Annotation improved it: two dashed guides now make the vertical delta explicit. It is a
  camera-angle limit with correct frames and a correct crop, not a crop bug — but the guides are
  ~3 px apart at the 112 px inline size, so the improvement is real at full resolution and marginal
  inline.

Also confirmed by looking: joints land on the right body throughout, and the annotation painter
order is correct (hips render *under* the amber cross rather than over it).

**N-clip provenance works.** Re-measured on a two-clip session (Demo 2 via the demo button,
multiperson added through the header add-a-clip action): **10 images / 7 sections**, and every
rendered *"From clip N of 2."* caption matched `sourceIndices` one-for-one.
`verticalOscillationCm` had a planned exemplar on both clips and correctly took the fusion winner's,
not "any clip that has it." (The pre-annotation measurement of the same check was 11 images /
8 sections, against the then-current coverage.) **Both totals move with per-clip coverage and neither
is a target** — see "Coverage re-measured 2026-08-31" below; what this check actually asserts is
that every rendered *"From clip N of 2."* caption matches `sourceIndices`, which is independent of
how many images there are.

**No analysis wall-clock regression, and evidence's own cost lands after `ready`.** Re-measured
against pre-epic baseline `2a3f009`, 6 trials/arm: **+1.4% on both demo clips** — noise, no
regression. The earlier #59 measurement agreed (baseline `896f775`, 3 trials/arm: Demo 1 5698 ms
[5539..5910] → 5747 ms [5550..6290]; Demo 2 3146 ms [3072..3157] → 3020 ms [3002..3086], noise in
both directions). Extraction then adds roughly 3.5–3.8 s (Demo 1), 3.5 s (Demo 2), 4.5 s
(multiperson) between "Analysis complete" and settled imagery, during which the results are already
fully readable.

**Regression anchor re-measured, and CLAUDE.md's own VO_cm number is stale.** The track clip now
reports **VO_cm 4.4215 cm**, not the 4.78–4.79 recorded in the "MediaPipe metric calibration" section
above. That is **not** #59's doing: `896f775` reproduces `4.421467928439415` cm, `fitHz 1.52`,
`sinusoidR2 0.42451916621964814`, `sampleCount 57`, `spanSeconds 2.24`, `torsoMeters 0.5041`,
`medianPixelsPerMeter 868.0` — **every digit identical** to this branch, Demo 2 likewise
(10.4866 cm both sides). The 4.78–4.79 figure was measured 2026-08-12 with **MediaPipe as the
PRIMARY backend**, before the background scale-pass graft path and before #54/#55's person selection;
on today's default MoveNet-primary + grafted-scale-pass path the anchor is **4.4215 cm**. The
cross-check the anchor really tests still holds exactly: `fit.frequencyHz × 60` = 91.2 ==
`cadence.value` 91.2.

**Re-confirmed 2026-08-18, after both the navbar shell and the inline-annotation epics**: the anchor
still reads `4.421467928439415` cm with `fit 1.52 × 60 = 91.2 == cadence 91.2`, and
`subjectAgreement` 52/53. Neither epic moved a number.

**Re-confirmed again 2026-08-31 on `c79d307`**, after the ghost-weight split, the arm-swing fit, the
view-confidence rescale, the subject-centred crop and the footstrike re-timing — two fresh-process
trials, every digit identical to both readings above: `verticalOscillationCm`
**`4.421467928439415`**, `fit.frequencyHz` **1.52** so `× 60 = 91.2 == cadence.value 91.2`,
`sinusoidR2` `0.42451916621964814`, `sampleCount` 57, `spanSeconds` 2.24, `torsoMeters`
`0.504143645953322`, `medianPixelsPerMeter` `868.0221516689736`, `subjectAgreement` 52/53. Note the
anchor lives on the `[analysis-diagnostics:scale-pass]` line, which
`scripts/ab-person-selection.mjs` does not capture — checking it needs a driver that waits for that
line separately, after "Analysis complete".

**Probe recipes used, if this needs re-measuring.** Both were added, measured and reverted per the
add-measure-revert cycle. (1) `[evidence-seek]`: one dev-only `console.log` in
`extractFrames.ts`'s `drawInstant`, dumping `{planned, target, outcome, currentTime, opacity, crop,
outputSide}` — note `video.currentTime` after a seek reports the *requested* target in Chromium, not
the snapped frame, so it cannot answer "which frame" on its own; the ffmpeg/PSNR comparison is what
does. (2) `[exemplar-mad]`: an `exemplarMadProbe.experimental.ts` called from `trunkLean.ts` and
`overstriding.ts` right before `selectExemplars`, dumping the distribution plus the surviving
argmax/argmin with their `devMads`/`typicality`/`detectionFactor`. Expect **two** `[exemplar-mad]`
lines per metric per run — the primary pass and the MediaPipe scale pass both compute heuristics;
the first occurrence is the primary.

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

Person-of-interest (multi-pose acquisition/reacquisition) shipped 2026-08-15 on
`openspec/changes/multi-person-acquisition/` (branch `claude/detection-pipeline-person-id-xh63ni`,
not yet merged to this branch/main as of this writing) — the MoveNet backend gains a
person-of-interest concept it previously lacked entirely. `SINGLEPOSE_LIGHTNING`/
`SINGLEPOSE_THUNDER` have no way to tell people apart; live testing (real browser, headless
Chromium) found the tracked skeleton could lock onto a background bystander instead of the
runner (full repro: proposal.md's "Why"). Fix: a `MULTIPOSE_LIGHTNING` pass, run only at
acquisition (no prior anchor for the run) and reacquisition (anchor confidence dropped below
`reacquisitionLossThreshold`), scored by bbox-area×confidence on acquisition and
IoU/proximity-continuity on reacquisition — plus two additive mechanisms so a correct
acquisition/reacquisition moment actually keeps sticking, not just wins once: a bounded
settle-in window (`POST_ACQUISITION_SETTLE_FRAMES`, default 3 calls) that forces crop-mode
framing around the just-selected/reconfirmed anchor independent of
`trackingCropConfig.enabled`, and periodic re-verification (`REVERIFICATION_INTERVAL_FRAMES`,
default 45 calls) that re-runs multi-pose selection even when confidence hasn't dropped, to
catch MoveNet's own saliency smoothly drifting onto a different person without ever tripping the
confidence-based reacquisition trigger. Ships **`personOfInterest.enabled: true` by default**
(`src/pose/backends/personOfInterestConfig.ts`) — unlike tracking-crop above, this is a
correctness fix for a live-confirmed bug rather than a pure optimization, so the pre-registered
ship rule was "confidence tiers hold → default on," the inverse of tracking-crop's "any median
tier degrades → default off." Config override: the same
`window.__STRIDES_POSE_BACKEND_OVERRIDE__`'s `personOfInterest` field.

**Measured cost — real, not free.** 2026-08-15 live-browser A/B (both demo clips, 3 trials/arm,
real GPU, `enabled: true` vs. `false`): confidence tiers hold (track stays T1 both ways; park is
T2 at baseline and T2-or-better after, never degrading) and metric values stay close (cadence
within ~2-3%, verticalOscillation within ~3-5%), but detected-frame/total-sample counts drop —
track loses ~16% of detected frames (~4% of samples), park loses ~25% of both. Mechanism: the
acquisition dispatch on frame 1 of every run, plus periodic re-verification, both do real
inference work that competes with `sampleClip.ts`'s real-time sampling loop for wall-clock
budget. As of this writing this has not been decomposed into settle-window-only vs.
re-verification-only contributions — `POST_ACQUISITION_SETTLE_FRAMES`/
`REVERIFICATION_INTERVAL_FRAMES` have no runtime override point by design, so isolating them
would need a temporary code patch not made in this A/B; the number above is the combined,
ship-relevant cost. Full table: `openspec/changes/multi-person-acquisition/design.md`'s
"Live-browser A/B results" section.

**Validation gap — the actual reported bug is not yet confirmed fixed on real footage.** This
change also added this repo's first e2e/Playwright test infrastructure
(`e2e/multiPersonAcquisition.spec.ts`, run via `npm run test:e2e`, separate from the mocked
`npm test` Vitest unit suite) against a real multi-person clip (`e2e/fixtures/multiperson-track.mp4`,
e2e-only, not UI-wired). 3 trials, real GPU: the multi-pose dispatch mechanism fires correctly
and identically every trial — roughly 30 acquisition attempts before the runner is confidently
detected (~t=1.52s), then two periodic re-verification dispatches — and a keyframe spot-check
confirms the clip genuinely has a second, near-field person (a walker) in frame alongside the
runner for most of the clip, not just a distant background crowd. But candidate count never
exceeded 1 across ~33 sampled dispatch calls in any of the 3 trials — `MULTIPOSE_LIGHTNING` never
registered two simultaneously-confident poses in these particular runs. So "the tracked skeleton
correctly favors the right person over a bystander" is confirmed only on synthetic unit-test
fixtures, not yet on real footage — closing this needs either more trials (this repo's documented
GPU/frame-timing determinism caveat means different frames get sampled run-to-run) or a clip
where the second person is detected as confidently as the first. What IS confirmed on real
footage: the fixture reliably exercises the acquisition + periodic-re-verification code paths
end-to-end. Full description: same design.md section, "Multi-person fixture" paragraph.

The eval harness/comparison tooling this backlog used to list as missing now exists for the
sampling/robustness plane: `scripts/ab-person-selection.mjs` (#53, documented under "Live-browser
verification harness" above) drives multi-trial, labeled, diffable A/Bs across all three clips.
The backend (`__STRIDES_POSE_BACKEND_OVERRIDE__`), scale-pass and heuristics planes are still
hand-driven — extending the driver to them is unbuilt, not designed away.

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
gotcha found the hard way, and corrected in review round 1 (see the addendum at the end of this
section — the paragraph below states the corrected understanding, not the original, wrong one):
`media_rate_integer`/`media_rate_fraction` are together ONE signed 32-bit 16.16 fixed-point value,
but `mp4box` reads/writes each 16-bit half separately via `readInt16()`/`writeInt16()` (both
signed) — so `0.5`'s spec-correct fraction encoding, bits `0x8000`, reads back as a NEGATIVE
`mediaRateFraction` (`-32768`), not `32768`. This is a READ-side sign-reinterpretation issue, not
a write-side overflow — `writeInt16(32768)` and `writeInt16(-32768)` emit identical bytes either
way. Fixtures use the real, correctly-signed on-wire values (e.g. `-32768` for `0.5`) directly.
Eight fixture modules, one per predicate branch plus three extra: `normalFps`, `highFpsNoElst`,
`highFpsUnityRateElstNoStretch` (the ordinary-trim trap), `highFpsStretchingElstDirectRate` (high
confidence), `highFpsFastPlaybackDirectRate` (1.5x FAST playback — the false-positive regression
the sign bug produced, added in review round 1),
`highFpsStretchingElstDurationRatio` (medium confidence, bonus coverage beyond the plan's four
branches), `highFpsStretchingElstFfmpegShape` (models the real empirical finding below as a
regression — as of review round 1, with the REAL multi-run `stts` shape, straggler sample
included, not an idealized single uniform run — see addendum), `nonMp4Bytes` (garbage bytes +
empty buffer), plus two more added in review round 1: `webmBytes` (a real, tiny ffmpeg-generated
WebM file) and `corruptedMp4` (a truncated buffer and a deliberately-corrupted `moov`) — see the
addendum for why. `tsc -b` clean; `eslint` clean on every new/touched file; exact test counts are
in the review round 1 addendum below (grew from the original pass).

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

**Review round 1 fixes (2026-08-14).** Four issues found reviewing the first pass, all fixed on a
follow-up commit (same branch, not amended):

1. **MUST-FIX — a real false-positive bug in `elstEntryRate` (`containerTiming.ts`).**
   `media_rate_integer`/`media_rate_fraction` are together one signed 32-bit 16.16 fixed-point
   value, but `mp4box` reads each 16-bit half separately via `readInt16()` (signed) — so a real
   0.5x rate (fraction bits `0x8000`) reads back as `mediaRateFraction: -32768`, and the original
   `integer + fraction / 65536` naively SUBTRACTED instead of adding. Concretely: a real 0.5x
   slow-motion rate computed as `-0.5` (silently fell through to the duration-ratio path instead
   of being read directly), and — worse — a real 1.5x FAST-playback rate computed as `0.5`,
   indistinguishable from an actual 0.5x slowdown, which would have reported `detected: true,
   confidence: 'high'` on a clip playing faster than native, not slower. Fixed by reinterpreting
   the fraction as unsigned before combining (`(mediaRateFraction & 0xffff) / 65536`), which is
   also correct for genuinely negative/reverse-play rates since the two halves are one
   two's-complement value regardless. Also collapsed the `find()` + ternary that had been
   evaluating `elstEntryRate` twice for the winning entry into a single pass. Regression fixture:
   `highFpsFastPlaybackDirectRate.ts` (1.5x fast playback, must NOT detect) — new test in
   `slowMotionDetection.test.ts` asserts this explicitly. The original write-up above (What was
   tried / Fixtures) had this bug BACKWARDS — claiming `mp4box` "silently overflows" a spec-legal
   `32768` **on write** — which is wrong on both counts (`32768` is not the correct on-wire
   encoding of `0.5` in the first place; `writeInt16(32768)` and `writeInt16(-32768)` emit
   identical bytes, nothing overflows on write). That paragraph and
   `highFpsStretchingElstDirectRate.ts`'s doc comment are corrected in place, above, to describe
   the real bug (a read-side sign misinterpretation) rather than left as a wrong historical claim.

2. **SHOULD-FIX — the ffmpeg-shape fixture had idealized away the real measured shape.**
   `highFpsStretchingElstFfmpegShape.ts` modeled the `-itsscale` finding as a single uniform `stts`
   run (`[[240, 800]]`), despite its own doc comment claiming to model what was ACTUALLY measured
   — the real dump earlier in this write-up (98 samples @ 8008 ticks + 1 straggler sample @ 1001
   ticks, 60000Hz timescale) is multi-run. Replaced with the exact real shape (`sttsRuns: [[98,
   8008], [1, 1001]]`, `mediaTimescaleHz: 60000`, matching real `elst` values). This reproduces the
   exact live numbers already quoted above (`nominalFps ≈ 7.492507492507492`, `stretchFactor ≈
   1.0000445414458152`) — both now asserted precisely in `containerTiming.test.ts` — and gives
   `weightedMedianSampleDeltaTicks` its first exercise with more than one run. Also asserted
   explicitly, per the review's request: a naive sample-count-weighted MEAN over the same two runs
   (`785785 ticks / 99 samples ≈ 7937.22 ticks` → `≈ 7.559fps`) differs measurably from the CORRECT
   median (`8008 ticks` → `≈ 7.49fps`, anchored to the dominant run) — the straggler pulls a naive
   mean upward; the median correctly ignores it.

3. **SHOULD-FIX — the documented `parseStatus` mapping was backwards for the single most likely
   real non-MP4 input.** The original doc claimed WebM/non-ISO-BMFF input maps to
   `'unsupported-container'` and a corrupt-but-recognized MP4 maps to `'parse-error'`. Verified
   against `mp4box` directly (a real ffmpeg-generated WebM file; a deliberately mdhd-corrupted
   valid fixture; a truncated valid fixture) — actual behavior is close to inverted: WebM's EBML
   header gets actively misparsed as a bogus box and rejected via `mp4box`'s own `onError` →
   `'parse-error'`, WITH an error message. A structurally-plausible-but-broken `moov` (e.g. an
   unrecognized box where `mdhd` should be) doesn't throw during the box walk itself, but `mp4box`'s
   internal `getInfo()` unconditionally dereferences fields like `trak.mdia.mdhd.timescale` while
   preparing the `Movie` object and throws a `TypeError` reading a property off `undefined` — caught
   by the outer `appendBuffer`/`flush` `try`/`catch` → `'unsupported-container'`, WITH an error
   message. Only genuinely unrecognizable input (truncated buffers, garbage bytes, empty buffers)
   reaches `'unsupported-container'` with NO error message — nothing ever throws and neither
   `onReady` nor `onError` fires. `containerTiming.ts`'s doc comments (`probeContainerTiming`'s
   module doc, the trailing fallback comment, and `ContainerTimingProbe.error`'s doc, which
   incorrectly claimed `error` is present "only on `'parse-error'`") are corrected in place to this
   verified mapping. Two new fixtures lock it in: `webmBytes.ts` (a real, tiny ffmpeg-generated
   WebM, base64-embedded) and `corruptedMp4.ts` (`buildTruncatedMp4`, `buildCorruptedMoovMp4`, both
   built by slicing/corrupting `mp4BoxFixture.ts`'s own valid output rather than hand-rolled bytes).

4. **SHOULD-FIX — the duration-ratio path double-counted empty/dwell edits.**
   `computeStretchFactor`'s Path 2 summed `segmentDuration` across every `elst` entry, including
   empty edits (`mediaTime === -1`, a presentation gap backed by no media) and dwell edits (rate
   `0`) — both inflate the ratio in the false-positive direction without a matching native-duration
   contribution. Fixed with a one-line filter (`entry.mediaTime >= 0 && elstEntryRate(entry) > 0`)
   before the sum.

Net effect on fixture/test counts: 8 fixture modules → 11 (added
`highFpsFastPlaybackDirectRate.ts`, `webmBytes.ts`, `corruptedMp4.ts` — the last exports two
builders; the ffmpeg-shape fixture was corrected in place, not added). Full suite still green
after the fix — exact pass counts are in the commit that made these changes, not duplicated here
to avoid this write-up drifting out of sync with the test files again.

## Dynamic valgus proxy investigation (2026-08-14)

Spike for GitHub #47, executed on branch `spike-heel-whip-pronation` — a prototype and a
recommendation, not a shipped feature. `src/pose/backends/mediapipeImageSegmenter.experimental.ts`
and `src/heuristics/dynamicValgusProxy.experimental.ts` exist on that branch as of this writing.

**Motivation.** #47 originally scoped a heel-whip + shoe-roll pronation-proxy spike against
rear-view running footage. Before this run started, a scope check found no rear-view test clips
exist anywhere in this repo — the only two demo clips are side-view (`try a demo video`, fetched
live from Pexels) and front-approach (`park-approach.mp4`). Heel-counter roll and heel-whip
(mid-swing lateral heel kick-out) are both structurally occluded or foreshortened from a front
view — the heel counter is hidden by the foot/shin mass, and mid-swing the foot tucks behind the
shin/thigh — so neither of the ticket's original two signals is testable on the footage actually
available; both stay blocked on a real rear-view clip the user will record later, not attempted
this run. What IS front-visible at zero new-footage cost: dynamic ankle/knee frontal-plane
collapse toward the midline during stance ("dynamic valgus" / colloquially "knock-knee") — a
distinct, coaching-relevant signal, correlated with but NOT identical to true rearfoot
pronation. This run retargets #47's SAME technique (crop + MediaPipe Image Segmenter silhouette
+ major-axis fit) at the lower leg (shin/ankle) on `park-approach.mp4`, the one available
front-view clip, instead of attempting signals that clip structurally can't show. Naming
discipline carried over unchanged from the original ticket: "dynamic valgus proxy" only — never
"pronation," never "clinical" anything.

**What was tried.**

*Crop* (`src/pose/backends/movenetCrop.ts`, reused as-is, untouched). `pickTrackingSide` (new,
`dynamicValgusProxy.experimental.ts`) picks ONE side for the whole clip — by summed knee+ankle
confidence on the first frame both resolve — rather than re-deciding per frame, which would make
the crop (and the signal) discontinuous for reasons unrelated to real motion. Picked `'left'`
every trial, all 3 runs. `deriveLegCropRect` builds a 2-point knee+ankle bounding box
(`deriveBoundingBox`) and pads it (`computeCropRect`, 1.8x multiplier, 150px floor) — the same
primitives MoveNet's tracking crop uses for a full-body box, here over just the tracked side's
shank so the crop shows the shank, not just the foot.

*Segmentation* (new, `src/pose/backends/mediapipeImageSegmenter.experimental.ts`, mirrors
`mediapipePoseLandmarker.ts`'s integration pattern). MediaPipe's stock `selfie_segmenter`
(float16, fetched live from Google's hosted bucket — a throwaway probe has no shipped bytes
worth pinning the way the self-hosted pose-landmarker model does), `outputCategoryMask: true`,
GPU delegate, VIDEO running mode. `getLabels()` returned `["selfie"]` on every run — confirms
the assumed binary foreground/background category encoding (any nonzero mask pixel =
foreground) rather than a multiclass scheme, which is also what the architecture note in #47
predicted this specific model would give in a tight leg crop.

*The candidate calc* (new, `dynamicValgusProxy.experimental.ts`). `computeMaskPca`: 2D PCA over
foreground-mask pixel coordinates (centroid + covariance, closed-form 2x2 dominant eigenvector),
with the sign-continuity rule the ticket flagged as a real gotcha up front — always orient the
axis to point "up" (toward the knee end) rather than trust frame-to-frame continuity, since a
single noisy/fragmented mask could break continuity-based disambiguation. `computeMaskIoU`:
intersection-over-union between consecutive masks — the crop canvas is a fixed 256x256
regardless of the source crop rect's own side length, so this always compares same-size masks.

*Splice* (`src/results/sampleClip.ts`'s `onFrame`, right after `detector.estimatePose`
resolves — reverted after use, see below, `git diff` on that file is clean). Dev-only
(`import.meta.env.DEV`-guarded), draws the crop into a 256x256 offscreen canvas, segments it,
computes PCA + IoU-vs-previous, accumulates into a module-level array, logs once under
`[dynamic-valgus-probe]` when `sampleClip` finishes (plus a one-time `[dynamic-valgus-probe:labels]`
line for the model's label list).

*Driving the app.* `window.__STRIDES_POSE_BACKEND_OVERRIDE__ = { backend:
'mediapipePoseLandmarker' }`, `window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__ = { enabled: false
}` — the background scale pass shares `sampleClip.ts` and would otherwise re-invoke this
splice's module-level segmenter singleton a second time with a restarted, non-monotonic
timestamp; simplest to disable it for a one-shot probe rather than add restart-remap logic
(`mediapipePoseLandmarker.ts`'s own trick for exactly this problem) that would never ship.
Headless Chromium, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`, confirmed via
`WEBGL_debug_renderer_info`, not SwiftShader). **A real methodological finding, not just a probe
detail**: at native 1x playback, the splice's added per-frame cost (a second MediaPipe task
serialized after pose detection in the same `onFrame` cycle) was heavy enough that only 2-3
frames sampled across the whole 1.65s clip — nowhere near enough to evaluate any gate. Fixed by
monkey-patching `HTMLMediaElement.prototype.play` (in the Playwright driver, not shipped code)
to force `playbackRate = 0.1` before playing — gives the pipeline 10x the wall-clock time per
video-time frame without touching frame content, timestamps, or either task's own per-frame
logic. 3 trials at 0.1x playback sampled 83, 84, and 84 of the clip's 99 frames respectively — a
real, if slow, technique-viability signal, not a runtime-cost benchmark (segmentation throughput
was never optimized here; moot once gates 1-2 failed, see below).

**Findings.**

*Gate 1 — segmentation quality.* Usable most of the time, but not clean. Across all 3 trials,
8/83, 8/84, and 8/84 frames (9.5-9.6%, strikingly consistent) came back with the ENTIRE 256x256
crop canvas classified foreground — a degenerate "everything is person" mask with a meaningless
dead-center centroid and, by construction via the axis-aligned PCA fallback, an exact 90.0°
reading. These saturated frames cluster late in the clip — 6 of the 8 in the trial-2/3 timestamps
land after t=1.1s (of a ~1.47s sampled span) — consistent with, though not proven to be caused
by, this clip's own already-documented camera-distance change (the subject's on-screen size
roughly triples across this clip — see "Vertical oscillation accuracy investigation" above): a
fixed-multiplier crop sized appropriately for a distant subject can end up with no background
margin left at all once the subject fills most of the frame, which is exactly the observed
failure signature. Separately, isolated severe fragmentation also occurs with no obvious visual
explanation: trial 2's minimum (2,657 of 65,536 px, ~4%) at t=0.217s pulls a keyframe showing
nothing unusual about the runner's visible leg position — a genuine segmenter-quality glitch,
not a crop or occlusion artifact. Non-saturated frames have a plausible median foreground
fraction (~76% of the crop canvas) that looks like a real leg/shoe blob. Net: doesn't hit the
ticket's hard "noisy/fragmented on every frame → stop here" floor, but falls well short of
"segments cleanly."

*Gate 2 — signal-vs-noise.* Clear FAIL. Frame-to-frame lean-angle changes exceeded 90° on
16.2% (trial 1, 12/74) and 25.3% (trials 2 and 3, 19/75) of non-saturated transitions. This is
the exact gotcha the ticket called out — PCA eigenvector sign ambiguity — but manifesting as a
DIFFERENT, harder problem than the sign-continuity rule already guards against: not a ±180° sign
flip of the SAME axis (handled), but the dominant/secondary eigenvalue IDENTITY swapping between
consecutive frames whenever the mask's width and height are close to equal — which principal
axis "wins" becomes highly sensitive to single-pixel noise, and the winner alternates between
near-vertical and near-horizontal essentially at random. Concrete, visually-verified example:
trial 2's two most extreme readings, -89.85° at t=0.86753s and +89.99° at t=0.88422s, are ONE
60fps video frame apart — 16.7ms of real playback time (the harness's 0.1x slowdown only
stretches wall-clock *processing* time, never the video's own frame spacing or content). Pulled
keyframes at both timestamps (`ffmpeg -ss` + `drawgrid`, per this file's keyframe-review method)
show the runner in visually indistinguishable poses — a real leg cannot reorient ~180° in 17ms,
so this swing is unambiguously computational noise, not signal. The raw lean-angle series'
standard deviation (64-68° across trials) is on the same order as its entire physically
meaningful range (180°, from -90° to +90°) — noise amplitude comparable to signal amplitude.

*Gate 3 — directional plausibility.* Undermined by gate 2's failure (sign can't be trusted to
mean "inward" vs "outward" when adjacent frames flip ~180° with no visible cause), but the
keyframe review surfaced a more fundamental, unplanned finding. The clip's one sustained,
high-IoU (0.8-0.97), non-noisy stretch (t≈0.60-0.78s, trial 2) holds steady near +73-88°
(silhouette axis close to horizontal) — and the matching keyframe shows why: the trailing leg's
shin is genuinely near-horizontal at that instant, heel kicked up behind during the stride's
recovery phase. That IS a real, stable, non-noisy signal — but it's a SAGITTAL-plane feature
(fore-aft leg swing), not the FRONTAL-plane collapse this proxy is supposed to measure. A 2D
silhouette's projected tilt-off-vertical cannot distinguish "the shin is tilted sideways toward
the midline" from "the shin is swinging backward and foreshortens into an off-vertical
silhouette from this camera angle" — a structural confound specific to a front/near-front camera
view with substantial fore-aft leg swing, separate from and additional to gate 2's noise
problem, and one that would persist even if a better segmentation model or a temporally-smoothed
PCA fit fully solved the axis-swap issue above.

**Recommendation: NO-GO for the silhouette-major-axis-PCA technique as implemented, on this
clip — evaluated against the ticket's own 4 pre-registered gates.** Gate 1 is a soft pass with
real caveats (9.5% saturation, isolated fragmentation). Gate 2 is a clear, visually-confirmed
fail: noise dominates signal via a PCA axis-identity-swap failure mode distinct from, and not
fixed by, the sign-continuity rule already implemented. Gate 3 can't be cleanly evaluated
because of gate 2, but reveals a second, independent problem — a sagittal/frontal-plane
confound baked into measuring silhouette tilt from a front-ish camera angle at all. Per the
ticket's own gate-4 fork ("is there a narrower version worth a follow-up spike, or is this a
clean no-go"), this lands closer to the former — two separable, unproven ideas are worth naming
rather than abandoning the whole direction outright:
- **Track the mask centroid's lateral (x) displacement directly, instead of a fitted major-axis
  angle.** Centroid position is a far simpler statistic than a 2x2 eigendecomposition and has no
  analogous "which axis wins" instability — it would plausibly fix gate 2 on its own. Not tried
  this pass (this run's design was pre-committed to the ticket's "major axis" framing); worth a
  narrow, cheap follow-up before writing off segmentation-based proxies as a category.
- **The sagittal/frontal confound (gate 3) is a camera-angle problem, not a math problem** — no
  amount of noise reduction fixes it. A true rear-view or dead-front-view clip (camera roughly
  along the direction of travel, minimizing the shin's fore-aft swing component in the 2D
  projection) is the only real fix, and that is the SAME rear-view-footage gap the original
  ticket was already blocked on.

Both follow-ups point back toward "a narrower centroid-tracking idea, validated on real
rear/front-square-on footage that doesn't exist yet" rather than "ship something today" — so
this write-up treats the overall result as a no-go for now, not a promising caveated metric, but
not a dead end either.

**Risk notes.**
- **Single-clip sample size.** Everything above comes from 3 trials on ONE clip
  (`park-approach.mp4`) — a smoke test, not a validated result. No cross-clip generalization is
  claimed or implied.
- **Front-view ≠ rear-view signal.** This investigation's target (dynamic valgus, frontal-plane
  knee/ankle collapse) is a DIFFERENT signal from the original ticket's heel-whip/shoe-roll
  pronation proxy — findings here say nothing about whether THOSE signals would fare better or
  worse on real rear-view footage, which remains completely untested.
- **Valgus ≠ pronation — not interchangeable, don't conflate.** Dynamic valgus is a
  frontal-plane knee/ankle motion; pronation is rearfoot/subtalar motion. They're correlated in
  some populations but are different joints and different mechanisms; this investigation never
  measured, and never claims to measure, pronation.
- **Determinism.** Trials 2 and 3 (of 3) were bit-identical — all 84 samples, every downstream
  statistic matched exactly — consistent with this repo's previously-documented finding that the
  MediaPipe Tasks Vision path is bit-reproducible on this machine (see the pipeline-comparison
  table earlier in this file). Trial 1 differed by exactly one sampled frame (83 vs. 84 total),
  the same ±1-frame run-to-run sampling variance already documented elsewhere in this file — not
  evidence against the determinism finding, just the known frame-count jitter.
- **Splice performance is not representative of any real cost.** The 10x playback slowdown was a
  harness workaround, not evidence about how expensive this technique would be to ship — no
  attempt was made to optimize segmentation throughput (e.g. running it at a lower cadence than
  every detected frame) because gates 1-2 failed before that question became relevant.

**Backlog.**
- **Centroid-lateral-displacement variant** — the narrower follow-up flagged above (replace the
  PCA major-axis fit with straight centroid x-tracking), cheap to try against this same clip
  before requiring new footage.
- **Heel whip and true heel-roll — still blocked on rear-view footage**, entirely unattempted
  this run (out of scope, correctly deferred — see Motivation). Whenever a rear-view clip
  exists, both the original ticket's signals AND a rear/front-square-on retry of the
  centroid-tracking variant above become testable for the first time.
- **A real rear-view or dead-front-view (camera along the direction of travel) clip** — the
  single highest-value next step for this whole direction, the same shape as the slow-motion
  investigation's "real device-native slow-motion clip" gap above: without one, gate 3's
  sagittal/frontal confound can't be ruled out for ANY silhouette-tilt-based proxy, including the
  centroid-tracking variant.
- Prospective openspec slug if this crystallizes into something shippable later:
  `dynamic-valgus-proxy-metric`.

**Not filed as an openspec change this pass.** The recommendation above is a no-go for the
implemented technique, with two narrower, unvalidated follow-up ideas — not something ready to
scope as a shipped metric.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
