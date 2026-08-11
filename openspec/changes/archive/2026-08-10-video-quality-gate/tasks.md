## 1. Type contract

- [x] 1.1 Define `QualityCheckId`, `QualityCheckStatus`, `QualityCheckResult`,
      `VideoQualityAssessment` in `src/quality/types.ts`, with JSDoc on `QualityCheckStatus`
      documenting the fail-open meaning of `'skipped'`/`'error'`

## 2. Core assessment logic

- [x] 2.1 Implement exported constants (`MIN_SHORT_SIDE_PX`, `MIN_FRAME_RATE_FPS`,
      `VISIBLE_KEYPOINT_SCORE`, `MIN_AVG_VISIBLE_FRACTION`, `DEFAULT_SAMPLE_COUNT`) in
      `src/quality/assessVideoQuality.ts`
- [x] 2.2 Implement `sampleTimestamps(durationSec, count)` — trims 10% off each end when
      `durationSec > 3`, spreads `count` samples evenly across the remaining middle span
- [x] 2.3 Implement `seekTo(video, time)` — no-op resolve when already at `time` (within 0.001s),
      otherwise seeks and resolves on `seeked` or after `SEEK_TIMEOUT_MS` (2000ms), whichever
      comes first, always cleaning up its listener/timer
- [x] 2.4 Implement `checkResolution(metadata)` — always evaluated, compares
      `Math.min(width, height)` against `MIN_SHORT_SIDE_PX`
- [x] 2.5 Implement `checkFrameRate(metadata)` — `'skipped'` when `frameRate` is `null`, else
      compares against `MIN_FRAME_RATE_FPS`
- [x] 2.6 Implement `visibleFraction(frame)` and `checkConfidence(video, metadata, detector,
      sampleCount)` — `'error'` immediately when `detector` is `null`; otherwise seeks+samples
      each timestamp from `sampleTimestamps`, catches a per-sample `estimatePose` throw and treats
      it as 0-visible, averages, restores the original `currentTime` in a `finally`
- [x] 2.7 Implement `assessVideoQuality({ video, metadata, detector, sampleCount })` — composes
      the three checks (resolution, frame rate awaited-free, confidence awaited) into one
      `VideoQualityAssessment`; `overall: 'warn'` iff any check status is exactly `'fail'`

## 3. Quality gate hook

- [x] 3.1 Implement `useVideoQualityGate(videoSource)` in `src/quality/useVideoQualityGate.ts`:
      `QualityGateStatus`, `QualityGateState` per the plan; lazily creates
      `createDetector({ backend: 'movenet' })` once on first use, cached in a ref for the hook's
      lifetime; on `videoSource.status === 'ready'` for a new load, resets `dismissed`, bumps a
      monotonic `runId` ref, runs `assessVideoQuality`, and applies the result only if the ref
      still matches after the `await`
- [x] 3.2 `dispose()` the cached detector on unmount; `proceedAnyway()` sets `dismissed = true`

## 4. Warning banner

- [x] 4.1 Implement `QualityWarningBanner` in `src/quality/QualityWarningBanner.tsx` per the
      role-based rendering rules (nothing when not ready/passing/dismissed; `role="status"` while
      assessing; `role="alert"` listing failed-check messages plus "Proceed anyway" when warning)

## 5. Test helper

- [x] 5.1 Add a fake-seekable-video helper (`src/test/setup.ts` or `src/test/videoTestUtils.ts`)
      that makes `currentTime` assignment synchronously (or via microtask) dispatch a `seeked`
      event, following `useVideoSource.test.ts`'s `Object.defineProperty`/manual-`dispatchEvent`
      idiom

## 6. Tests

- [x] 6.1 `src/quality/assessVideoQuality.test.ts`: resolution pass/fail at the boundary; frame
      rate pass/fail/skipped(null); confidence pass/fail with a fake `PoseDetector`; confidence
      with the detector returning `null` for some samples; confidence with `detector: null` →
      `'error'`; overall pass only when all non-skipped/error checks pass; overall warn when a
      single check fails even with others passing; playhead restored after assessment
- [x] 6.2 `src/quality/useVideoQualityGate.test.ts`: transitions `'assessing'` → `'ready'` on
      video-ready; `dismissed` resets to `false` on a new video load; `proceedAnyway()` sets
      `dismissed = true`; stale-result discard when a second load happens before the first
      assessment resolves
- [x] 6.3 `src/quality/QualityWarningBanner.test.tsx`: renders nothing when pass/dismissed/
      not-ready; renders failed-check messages when warn; "Proceed anyway" calls the callback

## 7. Integration

- [x] 7.1 Wire `App.tsx`: `useVideoQualityGate(videoSource)` + render `QualityWarningBanner` once
      `videoSource.status === 'ready'`

## 8. Verification

- [x] 8.1 `npm run lint` passes
- [x] 8.2 `npm run build` passes (`tsc -b` + `vite build`)
- [x] 8.3 `npm run test` passes
- [x] 8.4 `openspec validate --all` passes clean
- [x] 8.5 `openspec archive video-quality-gate` once all of the above are complete
