## Context

Each clip runs a primary MoveNet pass and then a background MediaPipe scale pass. The primary
detector is one shared, stateful instance, handed to one clip at a time by `nextActiveClipIndex`.
The scale-pass detector is also one module-cached instance (`getScalePassDetector`), with its own
timestamp-restart logic. Until now `nextActiveClipIndex` advanced only once a clip's primary AND
scale pass were both terminal, so a three-clip session ran P1 S1 P2 S2 P3 S3.

The plan for bead `strides-4vu` (2026-10-05) weighed two schedules: (a) all primaries, then scale
passes one at a time; (b) overlap clip N+1's primary with clip N's scale pass on the sequential path.
Both reach fused results at about 9.3 s on the three-clip demo, against 14.3 s at baseline. (b) only
saves 2–3 s on the last centimetre graft, and it runs MoveNet and MediaPipe on the GPU at once, where
a cold-versus-warm process is already known to flip a detection and re-partition a track. (a) was
chosen, with no flag.

## Goals / Non-Goals

**Goals**

- Fused results as soon as every primary has run.
- Never a primary and a scale pass at once, and never two scale passes.
- Playback-path clips behave exactly as before.

**Non-Goals**

- Overlapping passes, or any hybrid mode.
- Changing what any pass computes.

## Decisions

### D1. Two lanes, both pure and recomputed every render

`MultiClipVideoSession` already recomputes `nextActiveClipIndex` on every render. It now also
computes `nextScalePassClipIndex(clips, activeIndex)` and passes `scalePassAllowed` to exactly the
one clip it names. Nothing is remembered across renders: a started pass is reported as `'running'`,
and a running pass keeps the lane by rule 1 of the function, so the lease needs no state of its own.

### D2. The shared detector is released at primary ready, except on the playback path

`isDoneWithSharedDetector` is true at primary `'ready'`/`'error'`. A clip whose
`diagnostics.sampling.path` is `'playback'` still waits for its scale pass, because that pass replays
the clip's own `<video>` element. To keep that clip from deadlocking the session (it holds the active
index, and later primaries count as outstanding), the lane serves a waiting playback-path clip before
it checks for outstanding primaries. A playback session therefore still runs P1 S1 P2 S2 P3 S3.

### D3. No advance into a new clip while a pass runs

Once every primary is done the active index sits on the last clip. If a clip is added while a pass
runs, advancing would start its primary on top of that pass. `nextActiveClipIndex` returns the
current index unchanged while any pass is `'running'`. The new clip's primary then counts as
outstanding, so the queued passes wait behind it.

### D4. "Outstanding" ignores idle clips before the active index

A clip reset by "Try again" after an error returns to `'idle'` behind the active index. The active
index never moves backwards, so that clip can never be given the detector again. Counting it as an
outstanding primary would hold every queued pass forever, so only idle clips at or after the active
index count.

### D5. Waiting for the lane releases the demux and the live element, but only away from the detector

`isWaitingForScalePassLane(phase, status, queued, allowed)` is true for a `'ready'` clip with a
`'pending'` pass that does not hold the detector (`queued`) and is not allowed a pass. While it is
true:

- The cached demux (`strides-dt9`) is released. That clip's pass may be several primaries away. When
  the lane reaches it, `sampleClipSequential` calls `demuxClip`, misses the cache, and reads and
  demuxes the blob again (about 20–40 ms on the T0 baseline). It cannot fail for this reason.
- `clipHostsLiveElement` returns `false`, so the strip shows the poster instead of a paused live
  element, and a presented clip's controls become interactive. On the sequential path nothing reads
  the element. A playback-path clip is never in this state, because it holds the detector until its
  pass is terminal.

`queued` is required because the session learns of a clip's `'ready'` one render after the clip
does. On that render a lone clip still reads `scalePassAllowed: false`, and without the `queued`
check it would drop its demux and conceal its element just before its own pass starts. The last clip
of a session also stays active after its primary, so it keeps its demux and stays hosted while
earlier clips' passes run. That holds at most one track.

The loop-restart requirement ("Clip playback loops only while that clip is presented") is unchanged:
a `'pending'` pass still blocks the loop, so presentation stays purely observational.

### D6. `pending` outranks `done` in the aggregate

With the old order (`running > done > failed > skipped`), clip 1 `'done'` and clip 2 `'pending'`
aggregated to `'done'`. The status line would then say a second look "added N more metrics" while a
pass was still to come.

## Risks / Trade-offs

- **Clip 2's primary is now the first MoveNet run after clip 1's, with no MediaPipe inference in
  between.** That changes how warm the process is when each pass runs, and CLAUDE.md records a cold
  or warm process flipping one detection. Per-clip fields should be compared against fresh
  single-clip runs. Detector creation for the scale pass still overlaps clip 1's primary
  (`strides-e4c.2`).
- **More grafts land after evidence starts.** Evidence extraction starts when every clip is
  `'ready'`, so on a three-clip session all three grafts arrive during or after it. Per-metric reuse
  (`strides-zm8`) limits each re-extraction to the metrics whose plan moved.
- **A narrow race on a late-added clip.** The lane is granted in one render, and the clip reports
  `'running'` a render later. A clip added within that window could see the pass as `'pending'` and
  advance the active index. The two passes use different detectors, so the cost is GPU contention,
  not shared tracking state. It needs a user action inside one React commit.
- **Pre-existing spec drift, left alone.** "Aggregate multi-clip analysis state" still says
  `progress` is the mean of clip progress (the aggregate has had no `progress` since `strides-e4c.3`)
  and that mixed ready/idle reads `'idle'` (the code reads `'sampling'`). The MODIFIED block restates
  that text verbatim, changing only the priority order.

## Migration Plan

None. The schedule changes when passes start, not what they compute.
