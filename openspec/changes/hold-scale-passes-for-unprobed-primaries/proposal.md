## Why

`schedule-scale-passes-after-primaries` promises that a three-clip session of MP4s runs every
primary first: P1 P2 P3, then S1 S2 S3. On a Galaxy S21 one run did, and the next ran
P1 S1 P2 S2 P3 S3, reaching "Analysis complete" 25 s later (81 s against 56 s; bead `strides-6i6.5`).

The phone's own `[perf-timings]` lines show why. Clip 2's sequential-decode probe started at 3.0 s
and took **12,991 ms**, nearly all of it in `blob.arrayBuffer()` (12,941 ms) while clip 1's primary
held the main thread. The probe's 3 s timeout fired first and committed "no sequential decode" for
good. The probe then answered `supported: true` at 16 s, and the answer was thrown away. So clip 2
was treated as a playback clip twice over:

- **It was scheduled as one.** A playback primary starts only after every earlier pass is terminal
  (design D9 of the earlier change), so S1 ran before P2, and S2 straight after P2.
- **It was sampled as one.** Clip 2's primary ran on the playback path and took **153 samples**
  where the sequential path takes all **345**. That is a fidelity loss, not just a delay, and it is
  exactly what this epic's rule forbids: never trade pose-input fidelity for speed.

The bead's first guess, that clip 2's video was still loading, is a separate and smaller gap, and
it is real too. The lane counted an unprobed next clip as "may be playback" and let the earlier
pass run. Reproduced on desktop by holding clip 2's `loadedmetadata` for 8 s: P1 S1 P2 P3 S2 S3.

## What Changes

- **The probe timeout's "no" is a stand-in, not a verdict.** It still lets auto-start go ahead
  when a run is waiting on a hung probe. But if the probe's real answer arrives before any run of
  that clip has picked its sampler, the real answer replaces it. A clip queued behind another, whose
  probe was only slow, now samples on the path its bytes support. The stand-in is also kept from
  the multi-clip schedule: the clip reads as undecided until the real answer arrives, a run picks
  its sampler, or a 30 s give-up bound passes.
- **An unprobed next primary holds the scale-pass lane.** While the next clip to run is still
  loading its video, or loaded and not yet probed, no scale pass starts. Only a next clip *known* to
  sample on the playback path lets the earlier passes drain ahead of it, as before.
- This cannot deadlock. The answer needs nothing from either lane: the clip's own video loads (or
  fails, and a failed source is not an outstanding primary), and the probe starts at
  `loadedmetadata` and is bounded by the give-up bound. An `'empty'` source has no load in progress and
  does not hold the lane.
- The dev-only `sequential-probe` perf line gains `fellBack` and `committed`, so a log shows whether
  the timeout fired and whether the answer was used. Before this, that line read `supported: true`
  for a clip that had in fact sampled on the playback path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `multi-clip-analysis`: "At most one scale pass runs, and none while a primary is outstanding" now
  counts a next primary whose sampling path is still being decided as outstanding.
- `pose-detection`: adds "A slow feasibility answer still picks the sampler for a run that has not
  started".

## Impact

- `src/results/multiClipAnalysis.ts`: rule 4 of `nextScalePassClipIndex`.
- `src/results/useVideoAnalysis.ts`: the probe effect, and `start()` records that it picked a
  sampler.
- Tests in `multiClipAnalysis.test.ts` and `useVideoAnalysis.test.ts`.
- No change to what any pass computes. A single clip has no ordering question, and its probe answers
  in well under the timeout on desktop, so the single-clip gate is unaffected.
