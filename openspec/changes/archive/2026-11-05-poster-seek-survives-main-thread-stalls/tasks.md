## 1. Implementation

- [x] 1.1 Add `seekToThroughStalls` to `src/video/videoElement.ts` with tick-credited budget and wall-clock ceiling
- [x] 1.2 Use it for the poster's seek in `src/video/posterFrame.ts`; leave `seekTo` unchanged
- [x] 1.3 Unit tests: seek landing after a stall longer than the budget, timeout on a responsive page, wall-clock ceiling, already-there

## 2. Verification

- [x] 2.1 Phone (`--android --perf`): `perf.poster.derived` true on the second-runner clips; time to complete not longer
- [x] 2.2 Phone: posters derive for all three clips of the 3-clip demo
- [x] 2.3 Desktop 9-clip A/B under the gate lock: every non-timing field identical
- [x] 2.4 `npm run lint`, unit tests, `npm run build`
