## MODIFIED Requirements

### Requirement: At most one scale pass runs, and none while a primary is outstanding

The system SHALL allow at most one clip in a session to run its background scale pass at any time,
and SHALL NOT start a clip's scale pass while a primary pass is outstanding, so that every
sequential-path primary — the work the fused result waits on — runs before any scale pass, and a
primary pass and a scale pass never contend for the GPU. A primary pass is outstanding while a clip
is `'sampling'` or `'processing'`, or while the next primary to run — the first clip at or after
the shared detector's active index that is `'idle'` with a video source that has not failed to
load — samples on the sequential path, or has not yet had its sampling path decided because its
video is still loading or its sequential-decode probe has not answered. A next primary known to
sample on the playback path is NOT outstanding for this purpose: it is itself waiting for the
earlier clips' passes to finish (see "Serialized shared-detector access across concurrently mounted
clips"), and the passes SHALL be allowed to drain, in index order, so that it can start. Waiting for
an undecided next primary cannot deadlock: its answer depends on neither the shared detector nor
the scale-pass allowance, only on its own video finishing loading — a source that fails to load is
not outstanding — and on its probe, which is bounded by a timeout. A source with no load in progress
has no answer coming and is not outstanding. The allowance SHALL be decided in
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

#### Scenario: A next clip still loading or probing holds the passes

- **WHEN** clip 1 is `'ready'` with its scale pass `'pending'`, and clip 2 — the next primary to
  run — is still loading its video, or has loaded it but its sequential-decode probe has not
  answered
- **THEN** no clip is allowed a scale pass until clip 2's probe answers; if it answers sequential,
  clip 2 receives the detector and its primary runs before clip 1's pass, and if it answers
  playback, clip 1's pass runs first, as for any playback clip

#### Scenario: Three MP4 clips that load slowly still run every primary first

- **WHEN** three clips that all sample on the sequential path are loaded together, and clips 2 and 3
  are still loading their videos when clip 1's primary reaches `'ready'`
- **THEN** the passes run in the order primary 1, primary 2, primary 3, scale 1, scale 2, scale 3

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
  absent, whether or not its sampling path was ever decided

