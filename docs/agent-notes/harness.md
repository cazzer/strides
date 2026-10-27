# Live-browser verification harness

> Moved verbatim from CLAUDE.md on 2026-10-27 to keep the auto-loaded file under the size limit. Index: CLAUDE.md "Notes index". Cross-references like "above"/"below" may now point into a sibling file in this directory.

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
- ⚠️ **There is ONE demo button and it loads THREE clips** (`bundle-a-three-clip-demo`,
  2026-09-04). `page.getByRole('button', { name: /demo \(3 clips\)/i }).click()` creates clips 1-3
  of a single fused session — it is not a way to load one clip, and any driver that clicks it and
  then reads "the" result is reading a three-clip fusion. The rendered label is *Demo (3 clips)*,
  in **`src/video/ClipPicker.tsx`**. `'Try a demo video'`, `'Demo 1 (side view)'` and
  `'Demo 2 (front view)'` all match nothing now; ignore those strings wherever older notes below
  still quote them.
- **To drive ONE clip, upload it** — every demo clip is a local file, so
  Upload tab + `input[type=file]` + `setInputFiles(path)` is the per-clip route, and it needs no
  network. The three, in the order the demo loads them:

  | file (`src/video/demo-clips/`) | dimensions | frames | duration | view |
  |---|---|---|---|---|
  | `park-side-landscape.mp4` | 3840×2160 | 233 | 3.88 s | side |
  | `park-side-portrait.mp4` | 1080×1920 | 345 | 12.17 s | side |
  | `park-approach.mp4` | 2160×3840 | 99 | 1.65 s | front |

  ⚠️ **The old Demo 1 — the Pexels side-view track clip — is GONE from the app**, and every
  measurement recorded below under the name "Demo 1" was taken on it. Those readings do not
  transfer to `park-side-landscape.mp4`: different runner, different camera, different frame rate
  (25 fps vs 60). They are left exactly as measured rather than retrofitted, because they were
  honestly measured and the clip still exists at a stable URL
  (`https://videos.pexels.com/video-files/8533913/8533913-uhd_3840_2160_25fps.mp4`) — but read
  "Demo 1" anywhere below as *retired footage*, not as something you can re-measure by clicking a
  button. "Demo 2" below is still `park-approach.mp4`, same bytes, and its readings DO stand.
- **The demo button lives behind the header's add-a-clip action for clips 2..N**, not in the page
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
  --clips side-landscape,side-portrait,front-approach,multiperson --trials 3
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
- **`--view-arm <label>=<json>`** (`strides-trn2.3`) opens the trial on a results view,
  `{"view":"tour"|"summary"|"classic"}` → `?view=<value>`; `{}` is the bare address (the tour, in a
  fresh context with no remembered landing). Joined to the other planes by label; key AND value
  validated, since an unknown view silently resolves to the default. It exists for view-fidelity
  gates: on 2026-10-27, tour vs classic over side-landscape, side-portrait and front-approach, three
  fresh trials each with `--evidence`, was bit-identical in all 1968 rows but `elapsedMs` — the
  tour's animating runner does not perturb the scale pass. Two re-runs on the final commit agreed
  row for row with the first. One of them lost its very FIRST trial (side-landscape, tour arm) to
  the 300 s "never reached Analysis complete" timeout; 17 later tour trials, including a
  side-landscape-only re-run, all completed, and the cause is not established. ⚠️ The primary `[analysis-diagnostics]`
  line predates the graft (VO_cm/stepWidthCm read `null` there); only the `[evidence-coverage]` rows
  carry scale-pass output.
- **Clips**: `side-landscape`, `side-portrait`, `front-approach` (the three bundled demo clips —
  see the table above) and `multiperson` (`e2e/fixtures/multiperson-track.mp4`). Default: all
  four. **Every one goes through the Upload tab**, including the demo clips: the demo button now
  loads three clips at once, so it cannot serve as a per-clip arm — every arm would measure the
  same fusion instead of the clip under test. Nothing here touches the network any more.
  ⚠️ **The keys were `demo1`/`demo2` and were RENAMED, not repointed** — `demo1` meant the Pexels
  clip, which is gone. A `before.txt` captured under the old keys diffs against a new one on every
  clip row, by design: reusing `demo1` for different footage would make two incomparable
  measurements look comparable. `front-approach` is the old `demo2`, same file, so those readings
  carry over. **`side-portrait` is new** and lands in the default, so a default run is longer than
  it used to be — name `--clips` explicitly for the old three-clip cost.
  ⚠️ **`side-portrait` resolves NO vertical-oscillation family and no `cadence`** (null value,
  `sampleSize` 0) despite the best view confidence (0.8366) and detection ratio (277/345) in the
  corpus — the shared hip-bounce spectral fit misses its quality gate there. `trunkLean`,
  `overstriding`, `kneeFlexion`, `footStrikePattern` and `kneeDrive` all resolve normally. Open as
  `strides-aha`; don't read those nulls as a regression from whatever you are measuring.
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
  coverage this file records for that clip. ⚠️ **`armSwingSymmetry` no longer exists** — it was
  withdrawn by `strides-zhv` (see the retirement note in "Three metric-layer changes" below); the
  identical exemplar is `armSwingAmplitude`'s today, at the same instants and the same 320 px floor,
  so the regime contrast this table demonstrates still reproduces under that name.
  ⚠️ **The exemplar TIMESTAMPS in that table are also stale as
  a present-day reading** — `2ed7f0b` re-derived that metric's instants from a spectral fit,
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
  ⚠️ **Use `rtk proxy diff before.txt after.txt`, NOT bare `diff`, whenever the conclusion
  matters** (`strides-ef5`). This machine's shell rewrites `diff` through a summarizing wrapper
  that has twice, in two different sessions, reported **"Files are identical" for two files with
  different MD5s** — most recently on `strides-utn.4`'s acceptance gate, whose entire criterion
  was "no field moves except `elapsedMs`". It fails in the SAFE-LOOKING direction, so nothing
  prompts a second look, and it turns this A/B — the repo's sharpest correctness instrument —
  into a rubber stamp. Neither sighting has ever reproduced under a controlled test (tried at
  322, 500 and 1000 lines on 2026-09-03; plain `diff` was correct every time), so do not go
  looking for a threshold to stay under: there isn't a known one. Cross-check with `md5` any
  time the answer comes back "no difference". The older `rtk-diff-exit-code` note covers only
  the exit status; this is worse, because the summary TEXT asserts equality.
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

