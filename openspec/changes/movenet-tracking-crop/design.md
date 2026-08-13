## Context

See proposal.md for motivation. Relevant current state, confirmed by reading the installed
`@tensorflow-models/pose-detection@2.1.3` package source directly (not just its `.d.ts`):

- `node_modules/@tensorflow-models/pose-detection/dist/movenet/detector.js`'s
  `MoveNetDetector.estimateSinglePose` already maintains `this.cropRegion` across calls on the
  same detector instance: it narrows the crop via `determineNextCropRegion` (hip-centered,
  torso-visible, 1.9x torso / 1.2x body padding) after each detection scoring at or above
  `minPoseScore` (default `0.25`), and resets to `initCropRegion` — a **centered square crop of
  whatever image it's given** — the moment `this.cropRegion` is falsy or a frame's pose score
  drops below `minPoseScore`, with no debounce.
- `initCropRegion(firstFrame, imageSize)` (`movenet/crop_utils.js`): when `imageSize.width ===
  imageSize.height` (a **square** input), both its `firstFrame` and not-`firstFrame` branches
  resolve to the *same* full-coverage box (`yMin: 0, xMin: 0, height: 1, width: 1`) — confirmed by
  reading both branches. This is the mechanism this change relies on to make MoveNet's own
  internal crop a no-op against our externally-computed, always-square crop canvas.
- `PoseDetector.reset()` (`dist/pose_detector.d.ts`) is public API: `this.cropRegion = null` plus
  resetting the one-euro keypoint filter and the four crop-region low-pass filters
  (`resetFilters()`).
- `estimatePoses(image, estimationConfig?, timestamp?)` (`dist/pose_detector.d.ts`,
  confirmed against `detector.js`'s actual implementation): `timestamp` is optional, **in
  milliseconds**; if omitted and `image` is a live video (`image.currentTime != null`), MoveNet
  derives it from `image.currentTime` itself — but a canvas has no `currentTime`, so an explicit
  timestamp must be passed when feeding it a crop canvas.
- `MOVENET_SINGLEPOSE_LIGHTNING_RESOLUTION = 192`, `MOVENET_SINGLEPOSE_THUNDER_RESOLUTION = 256`
  (`movenet/constants.js` — not part of the public `.d.ts`).
- This app's `toPoseFrame` (`src/pose/backends/common.ts`) already restricts any backend's raw
  keypoints to `COMMON_KEYPOINT_NAMES` (15 points: nose, ears, shoulders, elbows, wrists, hips, knees,
  ankles) — unlike MoveNet's internal torso-only (`left_hip`/`right_hip`/
  `left_shoulder`/`right_shoulder`) crop-visibility criterion.

## Goals / Non-Goals

**Goals:**
- A tracked subject gets a tighter, higher-effective-resolution model input on the next frame,
  without changing `PoseFrame`, `Keypoint`, or the `PoseDetector` interface.
- A segment where nothing has ever been tracked (including `trackingCrop.enabled: false`) is
  provably identical to today's code path: literally `rawDetector.estimatePoses(video)`, not a
  reimplementation of it.
- MoveNet's own internal crop-region tracking and one-euro smoothing never fight our
  externally-computed crop across calls that reuse the same long-lived `rawDetector` instance.
- Quick to engage (one usable detection is enough to try a crop next frame), cautious to
  disengage (`reacquisitionLossThreshold` consecutive not-usable frames before falling back) —
  deliberate asymmetric hysteresis so ordinary single-frame motion blur doesn't drop tracking.

**Non-Goals:**
- Building a new full-frame fallback (e.g. pad-to-square). Reusing the exact existing call path
  is what guarantees the byte-identical-baseline goal above; a new implementation would only risk
  it, and would make a centered cold-start subject *smaller* in the model's fixed input than
  today's baseline (which benefits from MoveNet's own internal center-crop init).
- The math/heuristics config plane — separately tracked in CLAUDE.md's backlog. (Model/variant
  selection, unlike at this change's original drafting, has since shipped — see Decisions below
  for how tracking-crop composes with it.)
- The eval harness/comparison tooling itself.

## Decisions

**Bounding box and reacquisition gate use this app's 15 `COMMON_KEYPOINT_NAMES`, not MoveNet's
17-point COCO output or its own torso-only visibility check.** This app's metrics (knee flexion,
foot-strike pattern, arm-swing symmetry) depend on limb extremities that swing well outside a
torso box during a running gait. A torso-only crop — MoveNet's own internal criterion — risks
clipping ankles/wrists during the most extended part of a stride. Operating on the
already-`toPoseFrame`-mapped name-driven output (15 points since the head-keypoint widening) keeps this logic decoupled from MoveNet's raw COCO
shape, consistent with the rest of this codebase's backend-agnostic layering.

**`rawDetector.reset()` is called only on the mode-transition boundary — full-frame→crop or
crop→full-frame — not on every crop-mode call.** Originally this called `reset()` unconditionally
on every crop-mode call too, reasoning that our crop's framing/origin changes every call as it
re-centers, so MoveNet's own internal `cropRegion`/smoothing-filter state (computed relative to
whatever canvas it was handed *last* call) would otherwise fight our crop. Code review caught
that this reasoning didn't hold: `reset()` also clears MoveNet's one-euro *smoothing* filter
(`resetFilters()`, confirmed in the installed package's `detector.js`), so calling it every
crop-mode call wiped that smoothing continuously through the exact tracked segments this feature
means to improve — for no correctness benefit, since (per Context above) a same-size square crop
canvas makes `initCropRegion` resolve to full `[0,1]x[0,1]` coverage regardless of whatever stale
`cropRegion` MoveNet is still holding from the previous crop-mode call. The only point where a
*stale* `cropRegion`/filter state actually risks anything is the transition itself — framing
genuinely changes shape there (full video frame ↔ square crop canvas) — so `reset()` now fires
only when `usingCrop !== previousCallUsedCrop`, in either direction, symmetric with how the
crop→full-frame direction already worked.

**Two more state-safety fixes, both caught in code review, both self-contained to
`movenet.ts`** (not touching the `PoseDetector` interface or `usePoseDetector.ts`/
`useVideoAnalysis.ts`, preserving the interface-stability goal above):

- **Cross-run leak**: `usePoseDetector.ts` creates one `PoseDetector` per app lifetime and caches
  it — every clip a user analyzes in a session reuses the *same* `createMoveNetDetector` closure,
  including its tracking state. Without a fix, tracking engaged near the end of clip A would
  leave `lastBoundingBox` non-null; clip B's opening calls would then crop against a region with
  nothing to do with clip B's content until `reacquisitionLossThreshold` more frames happened to
  fall back correctly. Fixed by watching `video.currentTime` monotonicity rather than adding any
  new signal across the `PoseDetector` interface: `sampleClip.ts` always plays a clip forward
  from ~0 in real time, so a genuinely new run's first call always has a `currentTime` far below
  wherever the previous run's tracking left off. `lastSeenTime` tracks the highest `currentTime`
  this instance has processed; if a call's `currentTime` drops more than `NEW_RUN_TIME_DROP_SEC`
  (0.5s — comfortably larger than any plausible single-frame backward jitter, comfortably smaller
  than any real run boundary) below it, all tracking state clears and `rawDetector.reset()` fires,
  before that call proceeds — same "safe to fall back to the untouched full-frame path" posture
  used everywhere else in this design.
- **Reentrancy**: `sampleClip.ts` wraps every `estimatePose` call in a timeout that, on expiry,
  moves on *without cancelling* the underlying call — an anticipated failure mode, not a
  theoretical one. If a crop-mode call actually stalls that long, a new call can start on this
  same detector instance while the old one is still pending, both sharing one `cropCanvas`/
  `cropCtx` and the same tracking-state closure variables. A generation counter, incremented at
  the start of every call and captured locally (`myGeneration`), gates every *shared-state write*
  (`lastBoundingBox`, `consecutiveLowConfidence`, `previousCallUsedCrop`, `lastSeenTime`) behind
  `myGeneration === generation` (checked once, after the `await`) — a call that's no longer the
  most recent one still returns whatever it detected (this detector's existing "always return
  what you got" contract is unchanged) but can no longer clobber a newer call's progress.
  `previousCallUsedCrop`/`lastSeenTime` need this guard applied on *every* current call, including
  ones where nothing was detected (`poses.length === 0`) — not only ones with a usable
  detection — otherwise the transition-detection state machine and the new-run clock would stay
  stuck at whatever the last *successful* call left them while the video kept playing forward in
  the meantime, corrupting `isModeTransition` for later calls. (This was itself a regression
  caught while implementing the reentrancy fix, not a pre-existing bug — fixed via one shared
  `commitCallProgress()` helper called from both the empty- and non-empty-`poses` paths.)

**The crop canvas is sized to whichever MoveNet variant is active (192px for Lightning, 256px for
Thunder — both already-shipped `movenetModelType` choices), read from the installed package's
internal `constants.js`.** Feeding MoveNet a crop canvas that's already square and already at its
target input size means `initCropRegion` (see Context) resolves to full coverage regardless of
firstFrame state, making MoveNet's own internal second crop a geometric no-op, for either variant.
This is a local `Record<MoveNetModelType, number>` constant (`MODEL_INPUT_RESOLUTION`) in
`movenet.ts`, not part of `TrackingCropConfig` — it's a fact about the model, not a tuning knob,
and correctness of the no-op property doesn't depend on an exact value match (any square canvas
produces full coverage), only efficiency. `createMoveNetDetector`'s existing `modelType` parameter
is read once at detector-creation time to pick the crop canvas's fixed size for that instance's
whole lifetime; `trackingCropConfig` becomes its second parameter, after `modelType`.

**`trackingCrop` folds into `poseBackendConfig.ts`'s existing `PoseDetectorConfig`
resolution, rather than getting its own `window` override global.** `movenetModelType` already
established the precedent of a per-backend-relevant field on `PoseDetectorConfig`, resolved by
`resolvePoseDetectorConfig()` from a single `window.__STRIDES_POSE_BACKEND_OVERRIDE__`. Tracking
whether a subject is being cropped is a MoveNet-backend-internal concern exactly like
`movenetModelType` is, so it follows the same path rather than introducing a second window global
for what's conceptually one plane (pose backend configuration) — matching this codebase's
one-plane-per-window-global convention (compare `SamplingRobustnessConfig`'s single override for
the whole sampling/robustness plane). `trackingCrop` merges shallowly, one level deep, the same
way `SamplingRobustnessConfig`'s nested `robustness` field does in
`resolveSamplingRobustnessConfig()`.

**Engaging tracking has no separate "N good frames" threshold; losing it requires
`reacquisitionLossThreshold` (default 5) consecutive not-usable crop-mode frames.** One usable
full-frame detection is sufficient to try a crop on the very next call — quick to engage. Losing
track requires sustained failure, not a single bad frame — cautious to disengage. This asymmetry
is deliberate: false engagement is cheap to correct (the very next frame can fail usability and
immediately start the loss counter), but losing a good track on one motion-blurred frame would
discard useful state for no benefit.

**Full-frame mode when `trackingCrop.enabled: false` bypasses all of the above — no state is
read or written, `rawDetector.estimatePoses(video)` is called exactly as before.** A single,
total kill-switch for A/B comparison, matching the `SamplingRobustnessConfig`/`HeuristicsConfig`
override precedent already established in this codebase.

## Risks / Trade-offs

- [Coordinate remap math (`crop-space → video-space`) is a classic off-by-one risk] → Covered by
  a dedicated numeric round-trip unit test with hand-computed expected values, plus the pure
  `computeCropRect`/`deriveBoundingBox` functions being unit-tested independent of any
  canvas/detector mocking.
- [`reset()` call-timing could silently under- or over-fire] → Covered by call-count/timing-
  specific unit tests asserting: fires on the mode-transition call in either direction, never
  fires mid-steady-tracking or during a run of consecutive full-frame-only calls (including the
  cold-start segment).
- [Tracking state is cached-detector-lifetime, not analysis-run-lifetime, so it can leak across
  a user's separate clips in one session] → Caught in code review, not the original design.
  Mitigated by the `lastSeenTime`-monotonicity new-run check described in Decisions; covered by a
  dedicated two-sequential-runs unit test, plus a boundary test confirming ordinary small
  backward jitter within one run doesn't falsely trigger it.
- [A stalled detection call (past `sampleClip`'s timeout, which doesn't cancel the underlying
  call) can resolve after a newer call already started on the same detector instance, clobbering
  its tracking-state progress via the shared closure/canvas] → Caught in code review, not the
  original design. Mitigated by the generation-counter guard described in Decisions; covered by a
  dedicated unit test simulating a stale call resolving after a newer one has already engaged
  tracking, asserting the stale result doesn't disturb it.
- [A crop that's too tight could clip a limb mid-stride, actively hurting accuracy versus the
  full-frame baseline] → Mitigated by deriving the box from all 15 app-relevant keypoints (not
  MoveNet's torso-only criterion) and a generous default `paddingMultiplier` (1.75) with a
  `minCropSidePx` floor (256px in source-video pixels) so a compact detection (e.g. distant
  subject) doesn't produce a degenerately tiny crop.
- [This pipeline is not bit-exact run-to-run even pre-existing this change (GPU float
  non-associativity, frame-timing jitter, per CLAUDE.md's Determinism caveat)] → Live-browser
  verification (separate phase, per CLAUDE.md's harness) should compare medians/ranges across a
  few trials per variant, not single runs, same as any other pipeline-variant comparison in this
  repo.

## Revival note (2026-08-13)

This change was implemented and live-verified on 2026-08-11 but never committed; it was
rescue-committed and ported onto the current main (15 `COMMON_KEYPOINT_NAMES` after the
head-keypoint widening; 9 metrics; tiered results UI) on 2026-08-13. Two findings from the
port's re-verification changed the shipped shape:

**1. Head keypoints are excluded from bbox derivation (`BBOX_EXCLUDED_KEYPOINT_NAMES`).**
The original design derived the box from the then-12 limb/torso keypoints. After the widening,
a naive name-driven box picked up nose/ears — and a live A/B (round 1) measured that 15-point
box strictly worse than both the original result and the crop-disabled baseline: head points
inflate the padded box side (~560 → ~674 px on the reference test fixture, less zoom benefit)
and jitter the box frame-to-frame. Track detectedFrames fell to 69/70/72 vs 75/75/75 disabled
(the original 12-point result was 77/77/77 vs 74/75/75); park cadence/VO confidence roughly
halved. Excluding nose/left_ear/right_ear (round 2) restored the track benefit: 77/78/79.

**2. `DEFAULT_TRACKING_CROP_CONFIG.enabled` flipped to `false`.** Pre-registered rule for the
revival: ship enabled unless any metric's median confidence tier degrades on either demo clip
with crop on. Round-2 results (3 trials/arm, real GPU, medians):

| clip | arm | detectedFrames | viewConf | kneeFlexion | cadence/VO conf |
|---|---|---|---|---|---|
| track | off | 75/75/75 | 0.755–0.774 | 0.94/0.96/0.98 | 0.15–0.74 (one bad-fit trial) |
| track | on (12-pt bbox) | 77/78/79 | 0.779–0.782 | 0.83/0.85/0.84 | 0.60–0.72 |
| park | off | 75/75/76 | 0.073–0.136 | ~0.06 (front-gated) | 0.63/0.68/0.69 |
| park | on (12-pt bbox) | 62/75/76 | 0.099–0.175 | ~0.07 (front-gated) | 0.77/0.18/0.32 |

Track passes (kneeFlexion cost reproduces, 0.83–0.85 vs 0.94–0.98, but stays tier-1; cadence
medians 0.67-on vs 0.71-off are inside the documented spectral-fit flapping band). Park fails:
cadence/VO fall from a tight 0.63–0.69 (tier 2) to a scattered median 0.32 (tier 3) — not
fit-flapping (the off arm is tight), but the tracked box lagging the subject's ~3× on-screen
scale change on an approach clip. Rule fired → default off. The crop remains available for
side-view/stable-scale experiments via `window.__STRIDES_POSE_BACKEND_OVERRIDE__ =
{ trackingCrop: { enabled: true } }`.

Round-1 (15-point bbox) full numbers, for the record: track on 69/70/72 detectedFrames,
kneeFlexion 0.74–0.83; park on cadence/VO 0.32–0.38 vs off 0.63–0.69.
