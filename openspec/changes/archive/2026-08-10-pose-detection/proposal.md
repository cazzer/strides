## Why

Running-form analysis (#1) needs per-frame body keypoints, but nothing downstream — the
robustness/gap-handling layer, scoring heuristics, or overlay rendering — should depend on
`@tensorflow-models/pose-detection` or MoveNet directly. Coupling those layers to a specific
model's types and API would make swapping to BlazePose or a Thunder variant later a rewrite
instead of a config change. This change introduces that seam: an app-facing `PoseFrame` type
and a `createDetector`/`PoseDetector` abstraction, with MoveNet (SinglePose Lightning) as the
first and only backend today.

## What Changes

- Add `src/pose/types.ts`: `Keypoint` / `PoseFrame` types, restricted to the 12-keypoint subset
  common to MoveNet/COCO and BlazePose naming (shoulders, elbows, wrists, hips, knees, ankles),
  always fixed-length and fixed-order.
- Add `src/pose/backends/common.ts`: a shared `toPoseFrame` helper that filters/reorders any
  backend's raw keypoints into the fixed `PoseFrame` shape, so a future BlazePose backend reuses
  it instead of duplicating the mapping.
- Add `src/pose/backends/movenet.ts`: `createMoveNetDetector`, running SinglePose Lightning on
  the TF.js WebGL backend.
- Add `src/pose/detector.ts`: `createDetector(config)` factory/registry that selects a backend by
  a single config parameter and returns a `PoseDetector` (`estimatePose`, `dispose`) — the only
  API downstream code touches. Zero TF.js imports in this file.
- Unit tests for the mapping helper, the MoveNet backend (mocked at the module boundary), and the
  factory/registry.
- No UI, no robustness/heuristics/overlay-rendering — those are separate tickets that will
  consume `PoseFrame`/`PoseDetector` as-is.

## Capabilities

### New Capabilities
- `pose-detection`: swappable pose-detection abstraction — own `Keypoint`/`PoseFrame` types, a
  backend-selecting `createDetector` factory, and a MoveNet (SinglePose Lightning) backend
  implementation.

### Modified Capabilities
<!-- none: first capability in this repo -->

## Impact

- New code only, under `src/pose/**`; no existing files change.
- Runtime dependencies (`@tensorflow-models/pose-detection`, `@tensorflow/tfjs-core`,
  `@tensorflow/tfjs-backend-webgl`) are already pinned in `package.json` from `feat/2-bootstrap`
  — no dependency changes.
- Establishes the type contract (`PoseFrame`) and interface (`PoseDetector`) that the video-input,
  robustness, quality-gate, heuristics, and results-view tickets will build on.
