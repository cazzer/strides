## 1. Type contract

- [x] 1.1 Define `COMMON_KEYPOINT_NAMES`, `KeypointName`, `Keypoint`, `PoseFrame` in
      `src/pose/types.ts`, with a JSDoc comment on `PoseFrame.timestamp` documenting that it is
      `video.currentTime` (seconds), not wall-clock time

## 2. Shared mapping helper

- [x] 2.1 Define `RawKeypoint` and `toPoseFrame(rawKeypoints, timestamp)` in
      `src/pose/backends/common.ts`, using a `Map<string, RawKeypoint>` keyed by name and
      `COMMON_KEYPOINT_NAMES.map(...)` to produce fixed-order, fixed-length output (missing names
      → `{ x: 0, y: 0, score: 0 }`)
- [x] 2.2 Add `src/pose/backends/__fixtures__/movenet-keypoints.fixture.ts`: a hand-built
      17-entry raw keypoint fixture including non-subset names (e.g. `nose`, `left_eye`)
- [x] 2.3 `src/pose/backends/common.test.ts` (no mocking): assert `toPoseFrame` output has
      exactly 12 entries in `COMMON_KEYPOINT_NAMES` order, non-subset names dropped, x/y/score
      passed through, timestamp echoed

## 3. MoveNet backend

- [x] 3.1 Confirm the exact `SupportedModels`/model-type enum path against the installed
      `@tensorflow-models/pose-detection` `.d.ts` (don't guess blindly)
- [x] 3.2 Implement `createMoveNetDetector` in `src/pose/backends/movenet.ts`: side-effect import
      of `@tensorflow/tfjs-backend-webgl`, `tf.setBackend('webgl')` + `tf.ready()`, create the
      `pose-detection` MoveNet SinglePose Lightning detector; `estimatePose(video)` calls
      `rawDetector.estimatePoses(video)` with no branching on source type, returns `null` when
      empty else `toPoseFrame(poses[0].keypoints, video.currentTime)`; `dispose()` delegates to
      `rawDetector.dispose()`
- [x] 3.3 `src/pose/backends/movenet.test.ts`: mock `@tensorflow/tfjs-backend-webgl`,
      `@tensorflow/tfjs-core`'s `setBackend`/`ready`, and `@tensorflow-models/pose-detection`'s
      `createDetector` at the module boundary; assert init calls `createDetector` with the right
      model/type, a single-frame estimate maps correctly using the fixture from 2.2, and an
      empty-array result returns `null`

## 4. Detector registry/factory

- [x] 4.1 Implement `PoseBackendId`, `PoseDetectorConfig`, `PoseDetector`, `createDetector` in
      `src/pose/detector.ts`: synchronous `Record<PoseBackendId, () => Promise<PoseDetector>>`
      backend map, unknown `backend` throws synchronously, zero TF.js imports in this file
- [x] 4.2 `src/pose/detector.test.ts`: `createDetector({ backend: 'movenet' })` resolves; an
      unknown backend value throws synchronously

## 5. Verification

- [x] 5.1 `npm run lint` passes
- [x] 5.2 `npm run build` passes (`tsc -b` + `vite build`) — confirms `verbatimModuleSyntax`
      compliance
- [x] 5.3 `npm run test` passes
- [x] 5.4 `openspec validate --all` passes clean
- [x] 5.5 `openspec archive pose-detection` once all of the above are complete
