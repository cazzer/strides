## 1. Type contract

- [x] 1.1 Define `PoseSample`, `KeypointStatus`, `RobustKeypoint`, `FrameSource`,
      `RobustPoseFrame`, `RobustnessConfig` in `src/pose/robustness/types.ts`, plus
      `DEFAULT_MIN_KEYPOINT_CONFIDENCE`, `DEFAULT_MAX_GAP_SECONDS`,
      `DEFAULT_ROBUSTNESS_CONFIG`, with a doc comment on `RobustKeypoint.score` warning it reads
      as confident even when interpolated and consumers must gate on `status`, not `score`

## 2. Confidence classification

- [x] 2.1 Implement `RawKeypointState` and `classifyFrame(frame, minConfidence)` in
      `src/pose/robustness/confidenceFilter.ts`: `frame === null` → 12 `'missing'` entries;
      otherwise map each of the 12 keypoints, `score >= minConfidence` → present else missing
- [x] 2.2 `src/pose/robustness/confidenceFilter.test.ts`: score above/below/exactly-at threshold
      (`>=` is inclusive-present); `frame === null` → 12 missing entries

## 3. Interpolation core + public entry point

- [x] 3.1 Implement the per-channel gap-fill algorithm in `src/pose/robustness/interpolate.ts`:
      for each of the 12 `COMMON_KEYPOINT_NAMES`, scan for runs of consecutive missing
      classifications, find the nearest present sample before/after each run, compute
      `gapSeconds`, and mark the run `'interpolated'` (lerp x/y/score) only when both anchors
      exist and `0 <= gapSeconds <= maxGapSeconds`; otherwise `'unrecoverable'`
      (`x: null, y: null, score: 0`) — leading/trailing gaps (missing one-sided anchor) are
      always unrecoverable regardless of length
- [x] 3.2 Implement `applyRobustness(samples, config = DEFAULT_ROBUSTNESS_CONFIG)`: classify every
      sample via `classifyFrame`, run the per-channel algorithm for each keypoint name, zip back
      into `RobustPoseFrame[]` (`source: sample.frame === null ? 'missing' : 'detected'`), one
      output frame per input sample in order
- [x] 3.3 `src/pose/robustness/interpolate.test.ts` covering: clean stream (all `'detected'`,
      values unchanged); isolated single-frame gap within `maxGapSeconds` (assert exact
      hand-computed lerp values, not just status); long gap exceeding `maxGapSeconds`
      (`'unrecoverable'`, `x`/`y` null, `score: 0`); fully-missing frame mid-sequence (no throw,
      `source: 'missing'`, correct per-keypoint status from surrounding context); gap at the very
      start or end of the sequence (`'unrecoverable'` even if short — the never-extrapolate
      proof); output-length invariant (`applyRobustness(samples).length === samples.length`)

## 4. OpenSpec + verification

- [x] 4.1 `npm run lint` passes
- [x] 4.2 `npm run build` passes (`tsc -b` + `vite build`)
- [x] 4.3 `npm run test` passes
- [x] 4.4 `openspec validate --all` passes clean
- [x] 4.5 `openspec archive pose-robustness` once all of the above are complete
