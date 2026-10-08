## 1. Scheduling

- [x] 1.1 `isDoneWithSharedDetector`: done at primary `'ready'`/`'error'`; a playback-path clip still
  waits for its scale pass to be terminal
- [x] 1.2 `nextActiveClipIndex`: never advance while any scale pass is `'running'`
- [x] 1.3 `nextScalePassClipIndex(clips, activeIndex)`: running keeps the lane; none while a primary
  samples; a waiting playback-path clip next; none while a primary is outstanding; else the
  lowest-index pending
- [x] 1.4 `SCALE_PASS_STATUS_PRIORITY`: `running > pending > done > failed > skipped`

## 2. Wiring

- [x] 2.1 `useVideoAnalysis` fifth parameter `scalePassAllowed` (default `true`): a guard and a
  dependency on the scale-pass effect, with no cancellation
- [x] 2.2 Release the demux while a queued clip's pass waits for the lane
  (`isWaitingForScalePassLane`)
- [x] 2.3 `ClipSlot` passes `scalePassAllowed` through; `MultiClipVideoSession` computes the lane and
  sets it on exactly one clip
- [x] 2.4 `clipHostsLiveElement`: a pass waiting for the lane does not keep the live element on screen

## 3. Tests

- [x] 3.1 `multiClipAnalysis.test.ts`: advance at ready, playback rule, no advance while running,
  lane cases (null while a primary is outstanding, first pending wins, running keeps its lease,
  playback, errored and failed-load clips, idle before the active index, single clip), `pending`
  priority, and a two-lane simulation (P1 P2 P3 S1 S2 S3 sequential, P1 S1 P2 S2 P3 S3 playback,
  mixed)
- [x] 3.2 `useVideoAnalysis.test.ts`: gating, no cancellation, demux release while waiting, no
  release for the detector-holding clip
- [x] 3.3 `MultiClipVideoSession.test.tsx`: three sequential clips run P1 P2 P3 S1 S2 S3 with one pass
  in flight and at most one clip allowed a pass at every step; the existing playback test keeps the
  old order
- [x] 3.4 `clipStripStatus.test.ts`: hosting while waiting for the lane

## 4. Verification

- [x] 4.1 `npm test`, `npx tsc -b`, `npx eslint` on touched files
- [x] 4.2 `openspec validate schedule-scale-passes-after-primaries --strict`
- [ ] 4.3 Live (run by the verifier): three-clip demo time to fused results, last graft and settled
  evidence against T0; per-clip fields against fresh single-clip runs; single-clip A/B bit-identical

## 5. Review round 1

- [x] 5.1 Claim the lane synchronously (`useLayoutEffect`), and remember the grant as a lease that
  blocks the active index until the pass is terminal; pin the race state in a pure test
- [x] 5.2 `useVideoAnalysis` takes an options object, so a spy on its arguments cannot silently
  read the wrong position
- [x] 5.3 A playback primary waits for an in-flight scale-detector creation; a sequential one never
  does
- [x] 5.4 A clip whose video failed to load is skipped by the active index
