## 1. Diagnose

- [x] 1.1 Read the phone runs' `[perf-timings]` lines: clip 2's probe took 12,991 ms, the 3 s timeout
      committed playback, and clip 2 sampled 153 of 345 frames on the playback path
- [x] 1.2 Reproduce on desktop: slow probe (P1 S1 P2 S2 P3 S3, playback) and slow load
      (P1 S1 P2 P3 S2 S3); CPU ×6 alone does not reproduce it

## 2. Implement

- [x] 2.1 `useVideoAnalysis`: the probe timeout's `false` is replaced by a late real answer until a
      run picks its sampler (`samplerChosenForRef`, set in `start()`)
- [x] 2.1a `useVideoAnalysis`: `primarySamplingPath` stays `null` while only the stand-in is known
      and no run has acted on it, until `SEQUENTIAL_DECODE_PROBE_GIVE_UP_MS` (30 s)
- [x] 2.2 `useVideoAnalysis`: the `sequential-probe` perf line reports `fellBack` and `committed`
- [x] 2.3 `nextScalePassClipIndex` rule 4: an undecided next primary with a loading or ready source
      holds the lane

## 3. Test

- [x] 3.1 `multiClipAnalysis.test.ts`: clip 2 loading or probing when P1 finishes ⇒ S1 waits; answers
      sequential ⇒ P2 next; answers playback ⇒ S1 next; failed and empty sources do not hold the lane;
      a waiting playback clip still takes the lane; render-by-render simulation of slow loads
- [x] 3.2 `useVideoAnalysis.test.ts`: a queued clip's late answer replaces the stand-in and its run
      samples sequentially, and reads undecided (not playback) in between; a probe that never
      answers reads playback after the give-up bound; a run already started on the stand-in keeps it
- [x] 3.3 `npx tsc -b`, `npm run lint`, `npm test`

## 4. Verify

- [ ] 4.1 Single-clip gate, base against branch, identical outside `elapsedMs`
- [ ] 4.2 Three-clip sessions, plain and CPU ×6, base against branch
- [ ] 4.3 Slow-probe and slow-load arms on the branch run P1 P2 P3 S1 S2 S3
