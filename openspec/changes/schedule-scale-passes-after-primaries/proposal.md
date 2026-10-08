## Why

A multi-clip session was fully serial: clip N+1's primary MoveNet pass could not start until clip
N's background MediaPipe scale pass had finished, because `nextActiveClipIndex` waited for both.
Nothing the fused result shows depends on a scale pass, only the two centimetre metrics, which are
grafted in afterwards. On the three-clip demo the T0 baseline (bead `strides-e4c.1`) measured
14.3 s from the click to fused results, with every clip's scale pass on the critical path ahead of
the next clip's primary (bead `strides-4vu`).

## What Changes

- **All primaries first, then scale passes one at a time.** A clip that sampled on the sequential
  (WebCodecs) path hands the shared detector on as soon as its primary pass is `'ready'`. Its scale
  pass waits on a separate lane, `nextScalePassClipIndex`, which allows at most one pass at a time and
  none while any primary is outstanding.
- **Playback-path clips keep today's rule.** A clip that sampled by playing its own `<video>` (WebM,
  webcam, or an MP4 the probe declined) still keeps the detector until its scale pass is terminal,
  and gets the lane straight after its own primary. It also starts its primary only once every
  earlier clip's scale pass is terminal, so it sees exactly the reference order. Without that, a
  WebM primary in a mixed session detected 93/97 frames instead of 99/99 (design.md D9).
- **A started pass is never cancelled.** It keeps the lane until it is terminal, and the active clip
  does not advance into a newly added clip while any pass is running.
- **The aggregate scale-pass status ranks `pending` above every terminal status.** Without this, a
  session with clip 1's pass done and clip 2's still queued would report the second look as finished.
- `useVideoAnalysis` gains a fifth parameter, `scalePassAllowed` (default `true`). A due pass stays
  `'pending'` until it is allowed. A clip whose pass waits for the lane while another clip holds the
  detector releases its cached demux and goes back to its poster in the strip.
- No overlap mode and no flag. Overlapping clip N+1's primary with clip N's scale pass was rejected
  in the plan: it gives no time-to-first-results gain over this schedule, saves only 2–3 s on the
  last graft, and puts GPU contention under detections that are known to flip between cold and warm
  processes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `multi-clip-analysis`: "Serialized shared-detector access across concurrently mounted clips"
  advances at primary ready, with a playback-path exception and no advance while a pass runs.
  "Aggregate multi-clip analysis state" ranks `pending` above `done`. New requirement "At most one
  scale pass runs, and none while a primary is outstanding".
- `results-view`: "Background scale pass grafts measured vertical oscillation" starts its pass only
  once the session allows it, and gains a scenario for a pass waiting its turn.

## Impact

- `src/results/multiClipAnalysis.ts`: `isDoneWithSharedDetector`, `nextActiveClipIndex`, new
  `nextScalePassClipIndex`, and the status priority order.
- `src/results/useVideoAnalysis.ts`: the `scalePassAllowed` parameter, its guard on the scale-pass
  effect, a demux-release branch for a pass waiting for the lane, and `isWaitingForScalePassLane`.
- `src/results/ClipSlot.tsx`, `src/results/MultiClipVideoSession.tsx`: compute the lane and pass it
  down.
- `src/results/clipStripStatus.ts`: a pass waiting for the lane no longer keeps the live element on
  screen.
- Single-clip runs: the pass starts one render later than before. No computed field should move.
- Multi-clip runs: clip 2's primary now runs before any MediaPipe inference in the process (detector
  creation still overlaps clip 1's primary). Per-clip fields should be checked against fresh
  single-clip runs.
