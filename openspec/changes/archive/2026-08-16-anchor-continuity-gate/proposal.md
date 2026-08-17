# Anchor continuity gate + restore MoveNet keypoint smoothing on the canvas path

## Why

Two independent defects, both surfaced by live testing on a real side-view park clip
(2026-08-16), both in `src/pose/backends/movenet.ts`.

### 1. The steady-state path accepts any confident pose as the person of interest

`estimatePose`'s ordinary (non-multi-pose-dispatch) branch installs a new anchor with no
continuity check whatsoever:

```ts
const derived = deriveBoundingBox(frame.keypoints, minKeypointConfidence, minConfidentKeypoints)
if (derived !== null) {
  lastBoundingBox = derived
  consecutiveLowConfidence = 0
  personOfInterestSuspended = false
  anchorWasReacquired = false
  consecutiveEmptyReacquisitions = 0
}
```

Any pose clearing the usability gate (`minConfidentKeypoints` keypoints at
`minKeypointConfidence`) becomes the tracked person — regardless of where it is, how big it is,
or whether it plausibly relates to the person tracked on the previous call. The multi-pose path
does score continuity (`pickBestCandidate` → `continuous`, via IoU/proximity), but it only runs
at acquisition, reacquisition, and every `REVERIFICATION_INTERVAL_FRAMES` (45) calls. The
overwhelming majority of calls take the unguarded steady-state path.

The consequence is worse than "occasionally tracks the wrong person": accepting also resets
`consecutiveLowConfidence` to `0`. Reacquisition only triggers once that counter reaches
`reacquisitionLossThreshold`. A **confidently detected wrong person resets the counter on every
frame**, so the recovery path can never fire. The wrong anchor is permanent for the rest of the
run.

Observed live, with `trackingCrop.enabled: true` on a side-view pass-by clip: `computeCropRect`
clamps the crop inside the frame and never shrinks it, so as the runner approaches the frame edge
the crop stops following and progressively fills with background. The first frame a distant
bystander by the fence outscores the edge-hugging runner inside that crop, the anchor is stolen;
the crop re-centers on the bystander and both trackers agree on the wrong person permanently. The
skeleton appears to "stop animating" because it is now fitted to a near-static background crowd.

The same hole exists with `trackingCrop.enabled: false` (today's default) — the anchor is
unconditionally overwritten there too, just without the crop's positive feedback amplifying it.
Periodic re-verification is the only guard, and 45 calls is 1.5–3 s of clip.

### 2. MoveNet's built-in keypoint smoothing is silently disabled on the default sampling path

`pose-detection@2.1.3`'s MoveNet ships a one-euro keypoint filter, on by default
(`enableSmoothing` defaults to `true`; filter params `{frequency: 30, minCutOff: 2.5, beta: 300,
derivateCutOff: 2.5}`). Its `estimateSinglePose` applies it only when a timestamp is present:

```js
null != n && this.enableSmoothing && (o.keypoints = this.keypointFilter.apply(o.keypoints, n, 1))
```

and `estimatePoses(image, config, timestamp)` auto-derives that timestamp **only** when `image`
exposes `currentTime` — i.e. only for an `HTMLVideoElement`.

Of this backend's three `rawDetector.estimatePoses` call sites, only the crop-mode one
(`movenet.ts:816`) passes a timestamp. The full-frame steady-state call passes the image alone.
Since `add-webcodecs-sequential-sampling` made sequential decode the default sampler,
`sampleClipSequential.ts` supplies `image: canvas` — a canvas has no `currentTime`, so the
timestamp is `null` and **the filter never runs**. `trackingCrop.enabled` defaults to `false`, so
apart from the `POST_ACQUISITION_SETTLE_FRAMES` settle window, every frame of a default run is
unsmoothed.

The old playback sampler passed the `HTMLVideoElement`, which auto-derived the timestamp. So
changing the default sampler silently removed a temporal filter the pipeline had always been
getting for free. This is the direct cause of the increased per-frame keypoint jitter reported
live, and it is also why enabling tracking-crop "looked smoother" — that arm was accidentally the
only one still receiving smoothing.

## What Changes

- **Anchor continuity gate.** The steady-state path stops accepting a detection as the new anchor
  unconditionally. When an anchor already exists, a freshly derived bounding box must be
  *continuous* with it — spatially (bounding-box IoU above zero, or center displacement within a
  time-normalized speed bound) and in scale (bounding-box area within a bounded ratio of the
  previous anchor's). A detection failing either test does not become the anchor and is counted as
  a tracking loss instead, so `reacquisitionLossThreshold` can actually be reached and the
  existing multi-pose reacquisition path — which *does* score continuity — gets its chance to
  recover.
- The rejected call still **returns its detected frame**, preserving this backend's existing
  "always return what was detected" invariant. The gate governs *who this backend considers the
  tracked person*, not whether a frame is emitted.
- **Two new tunables on `PersonOfInterestConfig`**, under a nested `continuityGate` object with
  its own `enabled` kill switch, reachable through the existing
  `window.__STRIDES_POSE_BACKEND_OVERRIDE__` surface. `personOfInterest.enabled: false` disables
  the gate along with everything else, keeping the documented pre-change baseline intact.
- **Restore keypoint smoothing on the full-frame path** by passing the frame's timestamp to
  `rawDetector.estimatePoses` there, matching what the crop-mode call already does and what the
  video-element path used to get automatically.

## Impact

- Affected specs: `pose-detection`
- Affected code: `src/pose/backends/movenet.ts`,
  `src/pose/backends/personOfInterestConfig.ts`, `src/pose/backends/movenetCrop.ts`
- The `trackingCrop.enabled: false` + `personOfInterest.enabled: false` kill-switch path is
  deliberately **not** touched — it must stay byte-identical to pre-`multi-person-acquisition`
  behavior, and it performs no new-run reset, so feeding it timestamps would hand the one-euro
  filter a non-monotonic series across runs. See design.md.
- Not in scope, deferred pending the live A/B result: an explicit "subject exited frame" terminal
  state, and resetting/stabilizing MoveNet's own persisted internal crop region during continuous
  crop tracking.
