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

### D1. Two lanes, both pure, plus a remembered lease

`MultiClipVideoSession` already recomputes `nextActiveClipIndex` on every render. It now also
computes `nextScalePassClipIndex(clips, activeIndex, leaseIndex)` and passes `scalePassAllowed` to
exactly the one clip it names. It remembers that clip's id (`scalePassLeaseClipId`, adjusted during
render like the active index), and `scalePassLeaseIndex` resolves it back to an index only while that
clip's pass is still `'pending'` or `'running'`. The lease keeps the lane, and blocks the active
index, from the grant until the pass is terminal. It does not depend on when the clip gets round to
reporting `'running'` (see D3).

### D2. The shared detector is released at primary ready, except on the playback path

`isDoneWithSharedDetector` is true at primary `'ready'`/`'error'`. A clip whose
`diagnostics.sampling.path` is `'playback'` still waits for its scale pass, because that pass replays
the clip's own `<video>` element. To keep that clip from deadlocking the session (it holds the active
index, and later primaries count as outstanding), the lane serves a waiting playback-path clip before
it checks for outstanding primaries. A playback session therefore still runs P1 S1 P2 S2 P3 S3.

### D3. No advance into a new clip while the lane is held

Once every primary is done the active index sits on the last clip. If a clip is added while a pass
runs, advancing would start its primary on top of that pass. `nextActiveClipIndex` returns the
current index unchanged while any pass is `'running'` or the lease (D1) is held. The new clip's
primary then counts as outstanding, so the queued passes wait behind it.

Review round 1 found that `'running'` alone left a real window. The claim (`'pending'` →
`'running'`) was a `setState` in a passive effect, which lands on the default lane. A click that
adds a clip is a sync-lane update, so it could render, have the new `ClipSlot` report through its
layout effect, and re-render the session before the claim landed. The session then saw the granted
pass still `'pending'`, advanced into the new clip, and started its primary alongside MediaPipe. If
that clip is a WebM or a webcam recording, its playback sampler loses real-time frames to the
contention; this costs samples, not just time. Two fixes, either of which closes it:

- The claim moved to a `useLayoutEffect`. It is now a sync update flushed at the end of the commit
  that granted the lane, so `ClipSlot`'s layout-effect report carries `'running'` before the browser
  can deliver any event. The sampling body stays in the passive effect, keyed on `'running'` plus a
  once-per-run latch.
- The lease (D1) blocks the active index from the grant itself, so the session no longer depends on
  that ordering at all. `multiClipAnalysis.test.ts` pins the race state: lane granted to A, A still
  `'pending'`, idle C added, and the active index does not advance.

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

### D6. A playback primary waits for an in-flight scale-detector creation

`strides-e4c.2` creates the scale-pass detector while a sequential primary runs, and only then,
because the playback sampler drops real-time frames under the contention creation causes
(`strides-gyl`). Before this change the next clip could not start until clip 1's scale pass had
finished, so creation had always settled by then. Now the active clip advances at clip 1's
`'ready'`, so with clip 1 sequential and clip 2 a WebM, creation can still be running when clip 2
starts playback sampling.

`useVideoAnalysis` records the warm-up's promise in its own module scope
(`scaleDetectorCreationInFlight`, cleared once it settles either way). `start()` on the playback path
waits for it before sampling, re-checking the run id afterwards. The wait is bounded by
`SCALE_DETECTOR_CREATION_WAIT_MS` (8 s): a stalled WASM or model fetch can leave creation pending
forever, which is why the scale pass races it against its watchdog, and an unbounded wait would hang
the primary. Past the bound the run samples anyway and accepts the contention. The sequential path never reads it.
`src/pose/scalePassDetector.ts` is not touched, because the unmerged `feat/eager-model-prefetch`
branch rewrites it. The run shows `'sampling'` during the wait, and its playback starts muted outside
any click's call stack. That is the same state every auto-started run is already in.

### D7. A clip whose video failed to load is skipped

`isDoneWithSharedDetector` checks `videoSource.status === 'error'` first. Before this, the active
index stopped on such a clip forever. Every later clip's primary then never ran, stayed an
outstanding primary under rule 4, and held back every queued scale pass, including those of clips
before it. Rule 4 already ignored a failed source, so the lane needed no change of its own.

### D9. A playback-path primary sees exactly the reference order

Gate 4 (integration `68ee714`) passed the all-MP4 checks, and the three-clip demo's fused results
moved from 13.0 s to 7.8 s. But it failed the epic's "never reduce sample count" constraint on a
mixed session: `park-approach.mp4` plus a VP9 WebM of it, two fresh-process trials per arm, each arm
identical across its trials.

| arm | order | WebM primary detected / total |
|---|---|---|
| reference | P-seq, S-seq, P-webm, S-webm | **99 / 99** |
| integration | P-seq, P-webm (after the warm-up settled, ~200 ms wait), S-webm, S-seq | **93 / 97** |

The likely cause: the real-time playback primary now ran right after MediaPipe detector creation,
instead of after a whole MediaPipe pass had run. CLAUDE.md records how warmth-sensitive that path
is, and the D6 wait on creation alone was not enough.

Decision (the coordinator's, decided by the epic's constraint): a playback-path clip sees EXACTLY
the reference ordering.

- `nextActiveClipIndex` advances into a clip whose primary may sample on the playback path only once
  every earlier clip's scale pass is terminal and none is running.
- A clip's path is known from its sequential-decode probe, which every clip runs at load. It reaches
  the session as `VideoAnalysisState.primarySamplingPath`, from the same predicate `start()` uses. A
  clip whose probe has not answered counts as playback, the conservative reading.
- Rule 4 of the lane counts only the NEXT primary to run, and only if it is sequential. A playback
  primary waiting on the gate does not block the lane, or the session would deadlock. The lane
  drains the earlier passes in index order, and the playback clip's own pass then follows its
  primary (rule 3), as at reference.
- All-sequential sessions are unchanged: P1 P2 P3 S1 S2 S3. Mixed sessions run [seq, webm] as P1 S1
  P2 S2, and [seq, seq, webm] as P1 P2 S1 S2 P3 S3.
- The D6 creation wait is now implied whenever an earlier pass actually ran, since running a pass
  settles creation. It stays as a bounded safety net for creation left in flight by a clip that
  errored, or whose pass failed or was skipped.

### D8. `pending` outranks `done` in the aggregate

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
- **"Try again" leaves the queued passes waiting until the reader restarts.** "Try again" resets an
  errored clip to `'idle'` and does not start it, because auto-start fires only once per loaded
  clip. If that clip sits at or after the active index (for example, the last clip), it counts as an
  outstanding primary, so every `'pending'` scale pass waits until the reader presses Analyze. The
  fused base metrics are already on screen; only the centimetre grafts wait. A clip reset behind the
  active index is ignored (D4). Making "Try again" restart the run is a separate change.
- **Pre-existing spec drift, left alone.** "Aggregate multi-clip analysis state" still says
  `progress` is the mean of clip progress (the aggregate has had no `progress` since `strides-e4c.3`)
  and that mixed ready/idle reads `'idle'` (the code reads `'sampling'`). The MODIFIED block restates
  that text verbatim, changing only the priority order.

## Migration Plan

None. The schedule changes when passes start, not what they compute.
