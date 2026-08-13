## Why

CLAUDE.md's backlog flags input preprocessing — specifically that a 4K demo clip's subject can be
too small/distant once downscaled to MoveNet's fixed 192×192 (Lightning) or 256×256 (Thunder)
model input — as an assessed-but-unbuilt root cause of low-confidence detections. MoveNet's own
TF.js implementation already runs an internal temporal crop-region tracker
(`node_modules/@tensorflow-models/pose-detection/dist/movenet/detector.js`), but two things make
it insufficient on its own: its cold-start/reset fallback is a *centered square crop of the full
frame*, which can miss a subject entering from the side on a wide/4K source; and it resets on a
single sub-threshold frame with no debounce, discarding useful tracking on ordinary motion blur.
It also tracks torso visibility only (hip/shoulder confidence), not the limb extremities
(wrists, ankles) this app's running-form metrics actually depend on. This change adds our own
explicit, external tracking-crop layer around MoveNet, built on this app's 15
`COMMON_KEYPOINT_NAMES`, so a tracked subject gets a tighter, higher-resolution model input on
subsequent frames — while keeping the untouched full-frame call path as the fallback, so a
never-tracked or lost-tracking segment is provably behavior-identical to today.

## What Changes

- Add `src/pose/backends/trackingCropConfig.ts`: a `TrackingCropConfig` type (enable flag,
  keypoint-confidence gate, padding multiplier, minimum crop size, reacquisition-loss debounce)
  with a `DEFAULT_TRACKING_CROP_CONFIG`. Just the type + default — no override machinery of its
  own; see the config-plumbing bullet below for why. **Ships `enabled: false` by default**: the
  2026-08-13 revival A/B measured the crop helping the side-view track clip but consistently
  degrading cadence/vertical-oscillation confidence a full tier on the front-approach park clip
  (subject scale changes ~3×; the lagging tracked box mismatches it), firing the pre-registered
  default-off rule — see design.md's "Revival note". The feature stays available via the
  existing backend override's `trackingCrop` field.
- Add `src/pose/backends/movenetCrop.ts`: pure, dependency-free functions —
  `deriveBoundingBox` (bounding box over the confident `COMMON_KEYPOINT_NAMES` from confident points, or `null` if too few
  qualify) and `computeCropRect` (padded, square, frame-clamped crop rectangle in source-video
  pixels).
- Rewrite `src/pose/backends/movenet.ts`'s `estimatePose` as a small state machine: on a usable
  detection, remember its bounding box; on the next call, draw a cropped/upscaled region of the
  video into a reusable off-screen canvas and run MoveNet against that instead of the full frame;
  after `reacquisitionLossThreshold` consecutive not-usable crop-mode frames, fall back to the
  unmodified full-frame call path. Calls the underlying `pose-detection` package's `reset()`
  (part of its public API) at the points needed to keep its own internal crop/smoothing state
  from fighting our externally-computed crop. `createMoveNetDetector` gains a new, optional
  `trackingCropConfig` parameter — its second, after the existing `modelType` parameter (MoveNet
  Lightning/Thunder selection, already shipped separately) — since the crop canvas is sized to
  whichever model variant is active.
- Thread `TrackingCropConfig` through `PoseDetectorConfig` (`src/pose/detector.ts`) and fold it
  into `src/pose/poseBackendConfig.ts`'s existing `DEFAULT_POSE_DETECTOR_CONFIG`/
  `resolvePoseDetectorConfig()` — this repo's real, already-shipped backend-selection
  config-resolution layer (its `movenetModelType` field is the established precedent this
  mirrors) — rather than adding a second, separate `window` override surface.
- No changes to `PoseDetector`, `PoseFrame`, or `Keypoint` — this is entirely internal to the
  MoveNet backend's preprocessing.

## Capabilities

### Modified Capabilities
- `pose-detection`: adds a tracking-crop preprocessing stage to the MoveNet backend (a new
  requirement alongside the existing "MoveNet SinglePose Lightning backend" requirement); no
  existing requirement's behavior changes.

## Impact

- `src/pose/backends/movenet.ts`: `createMoveNetDetector` gains a new, optional
  `trackingCropConfig` second parameter (after the existing `modelType` parameter); internal
  `estimatePose` behavior changes only when a subject has actually been tracked on a prior frame.
  A never-tracked or lost-tracking segment (including `trackingCrop.enabled: false`) is
  byte-identical to today's `rawDetector.estimatePoses(video)` call.
- `src/pose/detector.ts`: `PoseDetectorConfig` gains an optional `trackingCrop` field, threaded to
  `createMoveNetDetector` through the existing backend registry (alongside the existing
  `movenetModelType` field).
- `src/pose/poseBackendConfig.ts`: `DEFAULT_POSE_DETECTOR_CONFIG` gains `trackingCrop:
  DEFAULT_TRACKING_CROP_CONFIG`; `resolvePoseDetectorConfig()`'s merge logic shallow-merges
  `trackingCrop` one level deep (same nested-merge shape `resolveSamplingRobustnessConfig` uses
  for its own nested `robustness` field), so `window.__STRIDES_POSE_BACKEND_OVERRIDE__` — the
  single, existing override surface for backend + model variant — gains a `trackingCrop` field
  too, rather than a separate `window` global being introduced for this one plane.
  `usePoseDetector.ts` needs no changes: it already calls
  `createDetector(resolvePoseDetectorConfig())`.
- Out of scope: the math/heuristics config plane CLAUDE.md's backlog already tracks separately;
  the eval harness/comparison tooling itself.
