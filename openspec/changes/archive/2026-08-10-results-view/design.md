## Context

Issue #8 (parent: #1, partial) is the epic's final MVP integration point, blocked on #4
(video-input), #5 (robustness — already folded into #7's `RobustPoseFrame[]` contract), and #7
(form-heuristics). Every prior ticket produced a piece of the pipeline against fixtures or a
non-playing element; nothing until now has driven pose detection against a real, playing
`<video>` over a whole clip, or rendered anything back to the user. The three things #8 must get
right are: (1) sampling a whole clip efficiently without a fixed frame budget, (2) drawing a
canvas overlay that stays in sync with arbitrary playback (not just a single forward pass), and
(3) presenting metrics whose confidence/applicability already varies by design (#7's `viewFit`/
`confidence`/`caveat` fields exist specifically so a consumer can show that variance, not paper
over it).

## Goals / Non-Goals

**Goals:**
- Sample a whole clip's worth of frames (~150+) at whatever density the detector can sustain,
  with zero manual interval/frame-count math.
- Keep the skeleton overlay in sync with playback at any point — a full run start-to-finish, a
  scrub to the middle, a pause — not just the moment analysis finishes.
- Visibly distinguish detected from interpolated (and skip unrecoverable) keypoints in the
  overlay, and visibly distinguish high- from low-confidence/unsuitable-view metrics in the
  panel — in both cases without relying on color alone.
- Share one `PoseDetector` between the quality gate (#6) and analysis, since both are guaranteed
  to run in the same session.
- Keep the whole thing testable in jsdom, which has neither `requestVideoFrameCallback` nor a
  real `HTMLCanvasElement.getContext('2d')`.

**Non-Goals:**
- Google Drive save/export — one documented empty seam in `ResultsView`, no logic.
- A charting library or the `canvas` npm package — both are avoidable for a single waveform and a
  single overlay, and each carries real cost (a new dependency; a native binary in CI/sandboxes).
- Automatic analysis on clip load — an explicit "Analyze" button, see Decisions.
- Multi-person tracking, 3D pose, or any metric beyond the three #7 already defines.

## Decisions

**Sampling: self-throttled `requestVideoFrameCallback`, not seek-per-frame.** The quality gate
(#6) samples 5 fixed timestamps by seeking to each one — fine for a handful of frames, far too
slow for a whole clip at 150+ frames (each seek pays real decode latency). Instead, `sampleClip`
plays the clip once at 1x and lets `requestVideoFrameCallback` present frames as the video
actually decodes them; each callback either starts detection for the frame just presented (if the
previous detection has resolved) or drops that frame and re-arms (if not). This gives a sampling
density that automatically matches detector throughput — no fixed frame budget, no manual
interval math — at the cost of not being able to guarantee any particular frame count. That's an
acceptable trade: the robustness layer (#5) already tolerates a gappy, irregularly-sampled
`PoseSample[]`/`RobustPoseFrame[]` by construction, so an adaptively-sampled stream is not a new
kind of input it has to cope with.

**Per-frame detection errors are skipped, not aborted — only a run of `maxConsecutiveErrors`
(default 30) consecutive failures aborts.** This matches #3's decision that `estimatePose` errors
propagate uncaught, and #6's `checkConfidence` precedent of treating an isolated failure as a
0-signal sample rather than failing the whole check. An isolated miss (one bad frame) is normal
noise; 30 in a row is a different failure class entirely (e.g. a lost WebGL context) that no
amount of "keep sampling" will recover from, and continuing to burn GPU cycles against a dead
detector for the rest of the clip would be wasted work with no chance of a useful result.

**Detector-sharing extraction (`usePoseDetector`) is justified now, not deferred again.** Every
session that reaches this screen runs the quality gate (#6) and then, if the user proceeds,
analysis (#8) — both need a `PoseDetector`. Before this change, `useVideoQualityGate` created and
cached its own detector; #8 needs one too. Creating a second one would pay MoveNet's WebGL
init/model-load cost twice per session, every session — a guaranteed cost, not a hypothetical one,
since the two consumers are not alternatives to each other but sequential stages of the same flow.
Extracting the lifecycle (lazy-create, cache in a ref, dispose on unmount) that
`useVideoQualityGate` already had into a small shared hook, called once in `App.tsx`, removes the
duplication with no loss of behavior: `useVideoQualityGate`'s signature changes from
`(videoSource)` to `(videoSource, detector: PoseDetector | null)`, and its existing `detector:
null` fail-open handling (`checkConfidence` reporting `status: 'error'`) covers the case where the
shared detector hasn't finished loading yet, unchanged.

**No mutex between the quality gate and analysis sharing one detector.** Both call
`detector.estimatePose(video)` against the same `<video>` element. A genuine interleaving hazard
would require both to run concurrently, but the "Analyze" button is disabled while
`qualityGate.status === 'assessing'` (gated in `ResultsView`), and quality assessment finishes in
well under a second in practice (5 samples, no full-clip playback) — by the time a user could
plausibly click "Analyze", the gate has already settled. This is a documented, accepted
trade-off, not an oversight: building real cross-hook coordination for a race that's practically
unreachable would be speculative complexity.

**Coordinate space / canvas sizing: canvas `width`/`height` set to `metadata.width`/`height`
(native pixel space), CSS `100%`/`100%` over an `absolute`/`inset: 0` stage.** MoveNet keypoints
are in video-native pixel coordinates (confirmed via `movenet.ts`'s `toPoseFrame` — no
normalization anywhere in the pipeline), so drawing directly in that space and letting the
canvas's own CSS scaling handle fit-to-displayed-size means zero manual coordinate math, and the
overlay tracks the video's actual rendered size (including CSS-driven resizing) automatically.

**Overlay redraw: `requestAnimationFrame` while playing, `seeked`/`timeupdate` otherwise — never
both at once.** A `rAF` loop gives smooth per-frame sync during normal playback; running it while
paused would spin for no reason (`video.currentTime` isn't changing). `seeked` fires once when a
scrub completes; `timeupdate` fires continuously while dragging the native scrubber's thumb before
that — together they give an immediate one-shot redraw for the "paused, scrubbing" case without
ever needing a watchdog or a manual timer.

**Skip-frame-not-abort error policy (restated for the overlay/analysis boundary).** The same
principle from #6 threads through this whole ticket: an isolated failure (one frame, one
detection call) degrades gracefully and the system keeps going; only a failure that indicates the
underlying capability itself is broken (detector unavailable, or `maxConsecutiveErrors`
consecutive misses) surfaces as a hard error state. This keeps a flaky-but-working detector from
producing a worse experience than a merely-imperfect one.

**Explicit "Analyze" button, not automatic analysis on clip load.** Sampling a whole clip means
playing it once, end to end, through the pose detector — a real, possibly tens-of-seconds
operation with a visible side effect (the video plays). Starting that automatically the instant a
clip loads would be surprising (video starts playing itself) and wasteful (a user previewing
multiple candidate clips before picking one to analyze would pay the full sampling cost for every
clip, not just the one they care about). An explicit button makes analysis a deliberate action,
consistent with `sampleClip`'s `video.play()` needing to be called synchronously in the same call
chain as a user gesture anyway (autoplay policy) — the button click *is* that gesture.

**`useVideoAnalysis`'s reset-on-new-clip is split across render-time state and an effect,
specifically to satisfy `eslint-plugin-react-hooks`'s `refs`/`set-state-in-effect` rules without
sacrificing correctness.** Resetting `state` to idle when `videoSource.metadata`'s identity
changes happens during render (comparing against a tracked-previous-metadata piece of state and
calling `setState` immediately if it differs) — React's documented pattern for "adjusting state
when a prop changes," which avoids an extra render-then-effect round trip. Actually cancelling the
in-flight `sampleClip` run (calling `handle.stop()`, bumping the `runId` ref) cannot happen during
render (refs are read/write-only outside render), so it lives in a `useEffect` keyed on
`[metadata]`, whose cleanup fires when `metadata` is about to change (or on unmount) — cleanup
never calls `setState`, so it doesn't trip the "don't setState synchronously in an effect" rule
either. The narrow theoretical gap this leaves — a stale run resolving *between* the render-time
state reset and the cleanup effect's cancellation — would require a video's `ended` event to fire
in that exact window, which DOM event dispatch timing relative to React's commit/passive-effect
flush makes practically unreachable; even if it happened, the worst outcome is a momentarily stale
`'ready'` render that self-corrects, not a crash or data corruption.

**`toDrawOps` is pure and canvas-free by construction, specifically so the overlay's core logic
is unit-testable in jsdom.** `HTMLCanvasElement.getContext('2d')` returns `null` in jsdom (no
native canvas package added — a real CI/sandbox risk as a native binary dependency), so anything
that needs Canvas 2D calls to verify can only ever be smoke-tested against a fake context. Putting
all of the actual decision logic (which points/edges to draw, at what opacity) in a pure function
over `RobustPoseFrame` means "overlay renders keypoints matching a fixture PoseFrame sequence" —
the ticket's literal acceptance criterion — is satisfied by direct, fast, real assertions in
`skeletonGeometry.test.ts`, with `SkeletonOverlay.test.tsx` only needing to confirm the wiring
(fake-context draw calls happen) rather than re-prove the geometry.

## Risks / Trade-offs

- `sampleClip`'s frame count is not deterministic — it depends on detector throughput during the
  actual run. Tests exercise the *policy* (drop-when-busy, skip-vs-abort, pause/resume) via a
  controllable fake detector and a stubbed `requestVideoFrameCallback`, not a real frame-rate
  guarantee.
- No cross-hook mutex between the quality gate and analysis (see Decisions) — accepted given the
  UI-level gating and the gate's sub-second real-world duration; would need revisiting if a
  future change made quality assessment meaningfully slower or removed the button gate.
- `VideoInputPanel`'s new `children` prop is rendered inside an *always-mounted* stage wrapper,
  not one conditionally rendered on `status !== 'empty'` as a literal reading of the ticket's
  sketch would suggest. The literal sketch would unmount `<video>` while `status === 'empty'`,
  but `useVideoSource.load()` reads `videoRef.current` synchronously and no-ops if it's null (see
  `useVideoSource.test.ts`'s "does nothing if load() is called with no video element attached") —
  conditionally rendering `<video>` would silently break the picker's `load()` calls, which fire
  while `status` is still `'empty'`. The implemented version keeps `<video>` unconditionally
  mounted (matching its pre-existing behavior exactly) and only gates the `hidden` attribute and
  `children` on `status`.
- Manual, real-browser end-to-end verification (record/upload → overlay + metrics render
  correctly against live camera/WebGL) was not performed as part of this change — the
  implementation environment has no browser, camera, or WebGL available. Automated coverage
  (unit/component tests, `tsc -b`, `vite build`, `eslint`) stands in for it; a manual pass is
  flagged as an explicit follow-up before this ships to real users.

## Post-review fixes

Code review caught several issues the automated suite couldn't, precisely because none of it
exercises real playback — each is a good illustration of the gap the still-outstanding manual
pass above is meant to close:

- **`video.play()` was never called anywhere.** `sampleClip`'s docstring said the caller
  (`useVideoAnalysis.start()`) was responsible for it (autoplay policy requires it happen
  synchronously in the click handler), but `start()` never actually called it. In a real browser
  this meant the video never advanced past frame one, `requestVideoFrameCallback` fired at most
  once, `ended` never fired, and "Analyze" hung at 0% forever with no way to recover short of the
  user manually pressing the native video's own play button. Fixed by calling `video.play()` in
  `start()`, right after registering the `sampleClip` handle, with a `.catch` that surfaces a
  `phase: 'error'` if the browser refuses (e.g. a stricter autoplay policy than expected).
- **`sampleClip`'s in-flight detection could mutate `samples` after cancellation.** `stop()`
  resolves the returned promise synchronously with the current `samples` array, but the
  in-flight `estimatePose` call's `.then`/`.catch`/`.finally` had no guard against still running
  afterward — a late resolution could push into (and thus silently mutate) an array the caller
  already treats as final. Fixed by checking `cancelled` at the top of each handler.
- **The circuit breaker only counted rejections, not hangs.** A single `estimatePose` call that
  never settles would leave `inFlight` permanently non-null, silently halting all further
  sampling for the rest of the clip without ever tripping `maxConsecutiveErrors`. Fixed by
  wrapping each attempt in a 5-second timeout (`withTimeout`/`DEFAULT_DETECTION_TIMEOUT_MS`) so a
  hang degrades into a normal counted error instead of a silent full stop.
- **The quality gate could flash a spurious "couldn't check confidence" result.** `detector` alone
  can't distinguish "the shared detector is still loading" from "it failed" — both are `null`.
  Since loading is the near-universal state on first render, the gate would previously assess
  immediately with `detector: null`, show a degraded result, then self-correct a moment later once
  the detector actually resolved (via its existing `detector` dependency / stale-run discard).
  Fixed by threading `usePoseDetector`'s `status` through as a third `useVideoQualityGate`
  parameter and waiting out `status === 'loading'` before assessing at all — only a genuine
  `'error'` proceeds immediately with `detector: null`, per the existing fail-open design.
- **Two accessibility regressions of a bug class already fixed twice in this codebase** (#4's
  `WebcamCapture`, #6's `QualityWarningBanner`): `ResultsView`'s "Try again" button called
  `analysis.reset` directly, unmounting its own `role="alert"` wrapper while it held focus,
  dropping focus to `<body>`. Fixed the same way as the prior two instances — the button now
  calls an injected `onTryAgain` prop, and `App.tsx` wraps `analysis.reset` with a
  `videoRef.current?.focus()` call, matching `handleProceedAnyway`'s existing shape exactly.
- **"Analyze" got stuck permanently disabled after a successful run.** `analyzeDisabled` included
  `phase !== 'idle'`, which is also true for `'ready'` — with no re-run affordance rendered in
  that phase, a user who wanted to re-check the same clip had no path forward and no explanation.
  Fixed: only `'sampling'`/`'processing'` (plus `qualityAssessing`) disable the button now; the
  label switches to "Analyze again" once a run has completed or errored, and a `title` explains
  *why* it's disabled during the states where it still is (mirroring `VideoInputPanel`'s
  disabled-tab `title` pattern from #4). Also added a `role="status"` "Analysis complete."
  announcement on the `'ready'` transition, closing a related gap where a screen-reader user got
  no signal that results had appeared.
