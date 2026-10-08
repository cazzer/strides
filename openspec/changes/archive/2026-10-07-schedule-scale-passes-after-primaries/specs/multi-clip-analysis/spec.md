## ADDED Requirements

### Requirement: At most one scale pass runs, and none while a primary is outstanding

The system SHALL allow at most one clip in a session to run its background scale pass at any time,
and SHALL NOT start a clip's scale pass while a primary pass is outstanding, so that every
sequential-path primary — the work the fused result waits on — runs before any scale pass, and a
primary pass and a scale pass never contend for the GPU. A primary pass is outstanding while a clip
is `'sampling'` or `'processing'`, or while the next primary to run — the first clip at or after
the shared detector's active index that is `'idle'` with a video source that has not failed to
load — samples on the sequential path. A next primary that samples, or may sample, on the playback
path is NOT outstanding for this purpose: it is itself waiting for the earlier clips' passes to
finish (see "Serialized shared-detector access across concurrently mounted clips"), and the passes
SHALL be allowed to drain, in index order, so that it can start. The allowance SHALL be decided in
this order: a clip already allowed its pass keeps the allowance until that pass is terminal (a
started pass is never cancelled, and an allowance outlives any delay before the clip reports its
pass `'running'`); otherwise none, while any primary is `'sampling'` or `'processing'`; otherwise
the lowest-index `'ready'` clip with a `'pending'` pass whose primary sampled on the playback path;
otherwise none, while a primary is outstanding; otherwise the lowest-index `'ready'` clip with a
`'pending'` pass. The scale-pass detector is one stateful MediaPipe instance shared by every clip,
which is why passes never overlap. A playback-path clip is served ahead of the outstanding-primary
rule because it keeps the shared detector until its own pass is terminal, so every later primary
waits for it. A primary pass that samples on the playback path SHALL NOT begin sampling while the
scale-pass detector is still being created, since that sampler loses real-time frames under the
contention creation causes — but SHALL wait no longer than a fixed bound of a few seconds, after
which it samples anyway, so a creation that never settles cannot hang the run; a primary on the
sequential path SHALL NOT wait for it. Since a playback primary now starts only after every earlier
pass is terminal, this wait is a safety bound for creation left in flight by a clip that errored or
whose pass failed.

#### Scenario: A playback primary waits for a scale-pass detector still being created

- **WHEN** a sequential-path clip's primary has started creating the scale-pass detector, and the
  next clip — which samples on the playback path — becomes active before that creation settles
- **THEN** the playback clip begins sampling once the creation has settled or the bounded wait has
  elapsed, whichever comes first, while a sequential-path clip in the same position begins at once

#### Scenario: Three sequential-path clips run every primary first

- **WHEN** three clips are loaded together and every one samples on the sequential path
- **THEN** the passes run in the order primary 1, primary 2, primary 3, scale 1, scale 2, scale 3,
  with exactly one pass in flight at any moment

#### Scenario: No scale pass starts while a primary is outstanding

- **WHEN** one clip is `'ready'` with its scale pass `'pending'` and another clip is `'sampling'`,
  or is the next primary to run and samples on the sequential path
- **THEN** no clip is allowed a scale pass, and the `'ready'` clip's pass stays `'pending'`

#### Scenario: A sequential clip followed by a playback clip keeps the reference order

- **WHEN** a sequential-path clip and then a playback-path clip are loaded together
- **THEN** the passes run in the order primary 1, scale 1, primary 2, scale 2

#### Scenario: Sequential primaries run first, then the passes drain before a playback primary

- **WHEN** two sequential-path clips and then a playback-path clip are loaded together
- **THEN** the passes run in the order primary 1, primary 2, scale 1, scale 2, primary 3, scale 3

#### Scenario: The lowest-index pending pass goes first

- **WHEN** every primary is terminal and two or more clips are `'ready'` with `'pending'` passes
- **THEN** only the lowest-index such clip is allowed its pass, and the next is allowed only once
  that pass is terminal

#### Scenario: A running pass keeps its allowance

- **WHEN** a clip's scale pass is `'running'` and a new clip is added to the session
- **THEN** the running pass keeps its allowance and completes, the new clip's primary runs after it,
  and the remaining `'pending'` passes run after that primary

#### Scenario: A playback-path clip's pass runs straight after its own primary

- **WHEN** a clip that sampled on the playback path reaches `'ready'` with its pass `'pending'` while
  later clips have not yet run their primaries
- **THEN** that clip is allowed its pass immediately, and the later clips' primaries wait for it

#### Scenario: A clip that cannot run does not hold up the passes

- **WHEN** a clip has errored, or its video source failed to load
- **THEN** it is not an outstanding primary, and the other clips' passes are allowed as if it were
  absent

## MODIFIED Requirements

### Requirement: Aggregate multi-clip analysis state

The system SHALL derive one aggregate analysis state from a list of per-clip sessions (each
carrying its own independently-driven `VideoAnalysisState`): `phase` is `'idle'` when there are no
clips, `'error'` if any clip's phase is `'error'`, `'sampling'`/`'processing'` if any clip is in
that phase, `'ready'` iff every clip's phase is `'ready'`, and `'idle'` otherwise; `progress` is
the mean of every clip's own progress; `isPausedMidAnalysis` is true iff any clip reports it;
`heuristics` is `null` until the aggregate phase is `'ready'`, at which point it is the per-metric
fusion (above) over every clip's heuristics; `scalePass.status` is the highest-priority status
across all clips in the order `running > pending > done > failed > skipped` — `pending` outranks
every terminal status because a clip's pass can wait its turn (see "At most one scale pass runs, and
none while a primary is outstanding") after another clip's pass has finished, and the session has
not finished measuring until it has run; `error` is the first (lowest-index) errored clip's error;
`robustFrames`, `diagnostics`, and `scalePass.diagnostics` are always `null` at the aggregate level,
since nothing downstream reads an aggregate version of either (each clip renders its own skeleton
overlay off its own state).

#### Scenario: Aggregate phase requires every clip ready

- **WHEN** two clips are both present, one `'ready'` and one still `'sampling'`
- **THEN** the aggregate `phase` is `'sampling'`, not `'ready'`

#### Scenario: Aggregate phase is error if any clip errored

- **WHEN** one clip is `'ready'` and another is `'error'`
- **THEN** the aggregate `phase` is `'error'`, and `error` is the errored clip's error

#### Scenario: Aggregate heuristics appear only once every clip is ready

- **WHEN** every clip's phase is `'ready'`
- **THEN** the aggregate `heuristics` is the fusion of every clip's own `heuristics`, and is
  `null` at every phase other than `'ready'`

#### Scenario: Empty clip list is idle

- **WHEN** there are no clips
- **THEN** the aggregate `phase` is `'idle'`

#### Scenario: A pass still waiting its turn keeps the aggregate pending

- **WHEN** one clip's scale pass is `'done'` and another clip's is still `'pending'`
- **THEN** the aggregate `scalePass.status` is `'pending'`, not `'done'`, so nothing reports the
  second look as finished while a pass is still to run

### Requirement: Serialized shared-detector access across concurrently mounted clips

The system SHALL grant the shared pose detector to at most one clip at a time, advancing which
clip holds it only once the previously-active clip's primary analysis run has reached a terminal
state (`phase` is `'ready'` or `'error'`), or its video source has failed to load (it will never
run, and stopping on it would starve every later clip). A clip whose primary run sampled on the playback path —
by playing its own `<video>` element, as a WebM, a webcam recording, or an MP4 the sequential-decode
probe declined does — SHALL additionally keep the detector until its background scale pass has
reached a terminal state (`scalePass.status` is `'done'`, `'failed'`, or `'skipped'`), because that
pass replays the same element. The active clip SHALL advance into a clip whose primary samples,
or may sample, on the playback path — its sequential-decode probe said no, or has not answered —
only once every earlier clip's scale pass is terminal, so that a playback primary always runs after
a whole scale pass has finished and never right after scale-pass detector creation; a real-time
playback sampler is that sensitive to what ran on the GPU just before it. The active clip SHALL NOT
advance while any clip holds the
scale-pass allowance — its pass `'running'`, or allowed and not yet reported as started. A
sequential-path clip's scale pass uses its own detector and is scheduled separately
(see "At most one scale pass runs, and none while a primary is outstanding"). This exists because
the shared detector carries mutable cross-frame tracking state (MoveNet's tracking-crop bounding
box, MediaPipe's `PoseLandmarker` VIDEO-mode timestamp tracking) that is not per-clip-scoped, so two
clips sampling concurrently against it could silently leak one clip's tracking state into another's
frames.

#### Scenario: Only one clip receives a live detector at a time

- **WHEN** two or more clips are mounted concurrently
- **THEN** at most one of them is ever passed a non-null detector at any point in time; every
  other clip receives `null`

#### Scenario: The active clip advances once its primary pass is ready

- **WHEN** the active clip sampled on the sequential path and its primary analysis reaches
  `'ready'` while its background scale pass is still `'pending'`
- **THEN** the next clip receives the detector without waiting for that scale pass

#### Scenario: The active clip advances only after its scale pass also finishes

- **WHEN** the active clip sampled on the playback path and its primary analysis reaches `'ready'`
  but its background scale pass is still `'pending'` or `'running'`
- **THEN** the active clip does not yet change — the next clip does not receive a detector until
  the scale pass also reaches a terminal status

#### Scenario: A clip added while a scale pass runs waits for it

- **WHEN** every primary is terminal, one clip has been allowed its scale pass — whether or not it
  has yet reported that pass `'running'` — and a new clip is added
- **THEN** the new clip does not receive the detector until that scale pass is terminal

#### Scenario: A playback-path clip is not handed the detector while an earlier pass is due

- **WHEN** the active clip sampled on the sequential path and is `'ready'` with its scale pass
  `'pending'`, and the next clip's probe said it will sample on the playback path (or has not
  answered)
- **THEN** the next clip does not receive the detector until that scale pass is terminal

#### Scenario: A clip whose video failed to load is skipped

- **WHEN** the active clip's video source fails to load and a later clip is waiting
- **THEN** the later clip receives the detector, rather than every later clip waiting forever

#### Scenario: A single clip never needs to advance

- **WHEN** exactly one clip is mounted
- **THEN** it holds the detector for the lifetime of the session; the active-clip index never
  changes
