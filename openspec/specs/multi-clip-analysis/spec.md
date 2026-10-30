# multi-clip-analysis Specification

## Purpose
TBD - created by archiving change add-multi-clip-fusion. Update Purpose after archive.
## Requirements
### Requirement: Per-metric confidence fusion across clips

The system SHALL merge an array of `FormHeuristicsResult`s (one per analyzed clip) into a single
`FormHeuristicsResult` by, for each `MetricId`, selecting the whole `MetricResult` object from
whichever input clip reports the highest `confidence` for that metric (ties resolved in favor of
the lowest-index clip), and appending a provenance sentence naming the source clip (`"Combined
from clip N of TOTAL."`) to that object's `caveat`, space-joined after any existing caveat text.
`view` SHALL be selected independently by its own highest confidence, with no provenance caveat
appended (it carries no `caveat` field). Given exactly one input, the function SHALL return that
input by reference, unchanged. Given zero inputs, the function SHALL throw.

#### Scenario: A single clip is returned unchanged

- **WHEN** fusion is given an array containing exactly one `FormHeuristicsResult`
- **THEN** the returned object is reference-identical (`===`) to that input, with no caveat
  text appended anywhere

#### Scenario: Each metric independently picks its highest-confidence source

- **WHEN** fusion is given two clips where clip 0 has higher confidence on `trunkLean` and clip 1
  has higher confidence on `armSwingAmplitude`
- **THEN** the fused result's `trunkLean` is clip 0's object (with clip 0's provenance caveat) and
  its `armSwingAmplitude` is clip 1's object (with clip 1's provenance caveat)

#### Scenario: A metric that resolves on only one clip surfaces that clip's value

- **WHEN** fusion is given clips where one metric is non-null (with positive confidence) on only
  one of the N input clips
- **THEN** the fused result reports that clip's value for the metric rather than excluding it,
  even though every other input clip's confidence for that metric is lower (including zero)

#### Scenario: Rich payload fields travel with the winning object

- **WHEN** the winning clip for `verticalOscillation` or `verticalOscillationCm` is selected
- **THEN** the fused result's `series`/`fit` (for `verticalOscillation`) or `calibration` (for
  `verticalOscillationCm`) are exactly the winning clip's objects, carried by reference

#### Scenario: view is selected independently of any metric's confidence

- **WHEN** the clip with the highest-confidence `trunkLean` is not the clip with the
  highest-confidence `view`
- **THEN** the fused `view` is selected by `view.confidence` alone, independent of which clip won
  any metric

#### Scenario: Zero inputs is a programmer error

- **WHEN** fusion is called with an empty array
- **THEN** it throws rather than returning a degenerate result

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

### Requirement: The fusion source clip is exposed as a machine-readable per-metric index

The system SHALL expose, as a pure function sitting alongside per-metric fusion, a mapping from each
`MetricId` to the zero-based index of the clip whose `MetricResult` won that metric. The mapping
SHALL be derived with the **same** selection rule fusion itself uses, so the two can never disagree
about which clip won a metric. Given a single input the mapping SHALL report index `0` for every
metric.

This SHALL be a sibling function rather than a change to the fusion function's return shape. Fusion's
guarantee that a single input is returned by reference, unchanged, is load-bearing for proving that
adding this capability moves no number, and altering its return shape would force that guarantee to
be re-established rather than simply preserved.

Consumers needing to know which clip a fused metric came from SHALL read this mapping. They SHALL NOT
recover it by parsing the human-readable provenance sentence fusion appends to the winning metric's
caveat: that sentence is copy for a reader, not a data channel.

#### Scenario: The sibling mapping agrees with fusion on every metric

- **WHEN** several clips are fused
- **THEN** for every `MetricId`, the mapped index names the same clip whose `MetricResult` fusion
  selected for that metric

#### Scenario: A single clip maps every metric to index zero

- **WHEN** exactly one result is given
- **THEN** every metric maps to index `0`, and fusion's own single-input reference-identity behaviour
  is unchanged

### Requirement: Exemplar instants are resolved against the clip that produced them

Because fusion selects the **whole** winning `MetricResult` per metric, a metric's exemplar
timestamps can refer to a different clip than the one a consumer is displaying, and a naive consumer
would resolve them against the wrong clip's frames — landing on a real-looking but wrong moment, or
on the first or last frame of an unrelated clip.

The system SHALL therefore resolve a fused metric's exemplars — both the frames used to derive their
crop regions and the media they are extracted from — against the clip named by the per-metric source
index above, never against a clip chosen by display position or by assuming the first clip. Exemplars
SHALL NOT be dropped on fusion: discarding them would remove all evidence for every metric whose
winner is not the first clip, degrading the capability precisely when a user has done the extra work
of adding a second clip.

An exemplar SHALL NOT itself carry a clip identifier. Exemplars are produced by the per-clip metric
computation, which has no concept of a clip session; a clip identifier written there would be
meaningless for a single-clip run and would duplicate, and eventually contradict, the source index.

Where a metric's result was replaced by a second pass over the **same** clip, its exemplar timestamps
remain on that clip's media clock and SHALL remain valid; their crop regions SHALL be derived by
resolving those timestamps against the frames the consumer actually holds for that clip, dropping any
exemplar that resolves to no nearby frame. However, when the two passes over that clip are judged to
have selected **different subjects**, the replaced metrics' exemplars SHALL be dropped entirely — a
crop derived from one subject's position, captioned with a number measured from another's, would
assert an identity the system knows to be in doubt, and an image asserts that identity far more
strongly than a caveat sentence can qualify it.

When more than one clip is present, the interface SHALL indicate which clip a metric's evidence came
from.

#### Scenario: A metric won by the second clip resolves against the second clip

- **WHEN** two clips are fused and a metric's winning result came from the second clip
- **THEN** that metric's exemplars are resolved against the second clip's frames and media, not the
  first clip's, and the interface indicates which clip the evidence came from

#### Scenario: Exemplars survive fusion rather than being discarded

- **WHEN** a metric's winning result came from a clip other than the first
- **THEN** its exemplars are still available as evidence, rather than dropped because they crossed a
  fusion boundary

#### Scenario: A metric replaced by a same-clip second pass keeps its evidence

- **WHEN** a metric's result is replaced by a second pass over the same clip, and that pass's subject
  agrees with the first pass's
- **THEN** its exemplar timestamps are resolved against the frames the consumer holds for that clip,
  and any exemplar with no frame within the snapping tolerance is dropped

#### Scenario: A diverged second pass loses its evidence entirely

- **WHEN** a metric's result is replaced by a second pass over the same clip whose selected subject
  is judged to have diverged from the first pass's
- **THEN** that metric's exemplars are dropped and no imagery is rendered for it, while the replaced
  value, its confidence, and its divergence caveat are unaffected

### Requirement: Clips are presented as a strip in the application header, one entry per clip

The system SHALL present the session's clips as a strip in the application header, beside the
wordmark, with exactly one entry per clip session and no clip rendered as a full-height panel in the
page body. Each entry SHALL show that clip's poster frame, SHALL be an activatable control that
opens that clip's preview, and SHALL be reachable and operable by keyboard.

Entries SHALL appear in clip-session order — the same zero-based order the per-metric fusion source
index and the human-readable provenance copy (`"Combined from clip N of TOTAL"`) already number
clips by — so a reader can match a metric's stated source clip to a strip entry by counting. Clip
identity remains positional: this requirement adds no clip name, label, or user-assigned title.

The strip SHALL remain usable when the session holds more clips than fit the header's width, by
scrolling within its own bounds rather than by wrapping the header onto additional lines or
overflowing the page.

Any layout offset derived from the header's height — sticky positioning, height caps on scrolling
regions — SHALL track the header's actually-rendered height, including the difference between a
header with a clip strip and one without, rather than a hardcoded pixel constant.

#### Scenario: One entry per clip, in fusion order

- **WHEN** a session holds two clips and a fused metric's provenance names clip 2 of 2
- **THEN** the strip renders exactly two entries, and the second entry is the clip that metric's
  evidence and provenance refer to

#### Scenario: Clips do not occupy the page body

- **WHEN** at least one clip has loaded
- **THEN** no clip is rendered as a panel in the page body, and the analysis results are the page's
  main content rather than one column of a two-column split

#### Scenario: A strip entry opens that clip's preview

- **WHEN** the reader activates a strip entry, by pointer or by keyboard
- **THEN** that clip's preview opens

#### Scenario: A crowded strip scrolls rather than reflowing the header

- **WHEN** the session holds more clips than fit the available header width
- **THEN** the strip scrolls within its own bounds and the header keeps its single-row layout

#### Scenario: Layout offsets follow the header's real height

- **WHEN** the header's height changes because the clip strip appears, disappears, or changes size
- **THEN** every layout offset derived from the header height follows it, with no stale gap or
  overlap at any viewport width

### Requirement: Each clip's progress is rendered from that clip's own analysis state

The system SHALL render each clip's processing progress on that clip's own strip entry, sourced from
that clip's own `VideoAnalysisState` — its `phase` and `progress` — never from the aggregate state
derived across clips. No new analysis state machine SHALL be introduced for this: the per-clip state
already exists, one instance per clip.

The entry SHALL visually distinguish, by more than color alone, these conditions:

- **sampling** — this clip is actively being analysed, with its own `progress` reflected;
- **processing** — sampling finished, results are being computed;
- **ready** — this clip's analysis is complete;
- **error** — this clip's analysis failed;
- **queued** — this clip's video is loaded and idle only because another clip currently holds the
  shared detector (see "Serialized shared-detector access across concurrently mounted clips"), which
  is a derived condition rather than a `phase` value and SHALL read differently from a clip that is
  actively sampling.

Each entry's condition SHALL be available to assistive technology as text, never conveyed by the
progress graphic alone.

#### Scenario: Two clips show their own progress, not a shared average

- **WHEN** one clip is `'sampling'` at 40% and another is `'ready'`
- **THEN** the first entry reflects 40% and the second reads as complete — neither shows the
  aggregate's mean progress, and the two do not move in lockstep

#### Scenario: A queued clip is distinguishable from a sampling one

- **WHEN** a clip's video is loaded, its `phase` is `'idle'`, and another clip holds the shared
  detector
- **THEN** its entry reads as waiting for its turn, visibly and textually distinct from the entry of
  the clip that is actively sampling

#### Scenario: A failed clip is visible in the strip

- **WHEN** one clip's `phase` is `'error'`
- **THEN** that clip's entry reads as failed, distinguishably from every other condition and by more
  than color alone

#### Scenario: Progress is text, not only a graphic

- **WHEN** any clip is mid-analysis
- **THEN** its entry exposes its condition and progress to assistive technology as text

### Requirement: Every source a reader supplies becomes its own clip session

The system SHALL create one clip session per video source the reader supplies, whether supplied one
at a time or several at once: selecting N files in a single file-picker interaction SHALL create N
clip sessions, and completing a webcam recording SHALL create one. A clip added this way SHALL enter
the session exactly as a clip added by any other path — same video source contract, same per-clip
analysis lifecycle, same position in the strip and in fusion order.

#### Scenario: A multi-file selection creates one clip each

- **WHEN** the reader selects three files in one file-picker interaction
- **THEN** three clip sessions are created, in selection order, each analysed independently under
  the existing shared-detector serialization

#### Scenario: A recorded clip joins the session like an uploaded one

- **WHEN** the reader records a clip after the session already holds one
- **THEN** the recording becomes an additional clip session, indistinguishable downstream from an
  uploaded one

### Requirement: A losing clip that would read differently is named in the fused caveat

Fusion selects one clip's `MetricResult` per metric and presents it alone. Where a clip it did NOT
select would have given the reader a DIFFERENT READING of that metric, the system SHALL append a
sentence to the fused metric's `caveat`, after the provenance sentence, naming each such clip and
the reading it produced. The system SHALL NOT state which clip is correct.

"A different reading" SHALL be decided by an interpretive band the metric ALREADY owns — a
classifier mapping its value to a named category — and SHALL NOT be decided by any magnitude
threshold introduced for this purpose. A metric owning no such band SHALL surface nothing, however
far apart its clips read. A boundary with no dead zone (a bare sign test) SHALL NOT be treated as
such a band: it flips on a value indistinguishable from zero and stays silent on two same-signed
values an entire body-scale apart.

A clip SHALL be eligible to contest, and the winner SHALL be eligible to be contested, only where
that clip's `MetricResult` is one the results panel would render as a card — excluding a null value
and a `viewFit` the camera geometry cannot support. Fewer than two eligible clips SHALL surface
nothing.

This SHALL change `caveat` and nothing else: the metric's `value`, `confidence`, `viewFit`,
`sampleSize`, `interpolatedFraction` and `frameCoverage` SHALL be exactly the winning clip's, and
the selection rule (highest `confidence`, ties to the lowest clip index) SHALL be unchanged.

#### Scenario: Two clips straddling a band both surface

- **WHEN** two clips resolve `footStrikePattern` at the same confidence, one classifying as `heel`
  and the other as `forefoot`
- **THEN** the fused metric's `caveat` carries the provenance sentence for the winning clip AND a
  following sentence naming the other clip and the reading it produced, and asserts no winner
  between them

#### Scenario: Numbers far apart inside one band surface nothing

- **WHEN** two clips resolve the same metric to values that differ greatly but classify into the
  same category
- **THEN** the fused metric's `caveat` carries the provenance sentence alone

#### Scenario: A metric with no band surfaces nothing

- **WHEN** two clips resolve a metric that owns no classifier — `overstriding` at `+0.512135` on
  one clip and `-0.00809497` on the other, both at confidence 1.0
- **THEN** the fused metric's `caveat` carries the provenance sentence alone, and the metric's own
  unconditional caveat text is unchanged

#### Scenario: A clip the panel would not render is not quoted

- **WHEN** a losing clip's result for the metric has a null value, or a `viewFit` of `unsuitable`
- **THEN** that clip contributes no reading and no disagreement sentence is produced on its account

#### Scenario: No computed field moves when the sentence is appended

- **WHEN** the disagreement sentence is appended to a fused metric
- **THEN** that metric's `value`, `confidence`, `viewFit`, `sampleSize`, `interpolatedFraction` and
  `frameCoverage` are exactly the winning clip's, unchanged

#### Scenario: A single-clip session is unaffected

- **WHEN** fusion is given exactly one `FormHeuristicsResult`
- **THEN** the returned object is reference-identical to that input, with no disagreement sentence
  and no provenance sentence anywhere

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
not outstanding — and on its probe, whose answer the clip reports once it arrives or once a fixed
give-up bound passes (see "A slow feasibility answer still picks the sampler for a run that has not
started"). A source with no load in progress has no answer coming and is not outstanding. The
allowance SHALL be decided in this order: a clip already allowed its pass keeps the allowance until that pass is terminal (a
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

### Requirement: With more than one clip, each metric names the clip it was measured from

Where a session holds more than one clip, every rendered metric card, in either results view, SHALL
state which clip its value was measured from, by number and total and by that clip's detected camera
view ("Measured from Clip 2 of 3 · Side view"). The clip SHALL be the one the per-metric source index
names, never one recovered from the caveat's provenance sentence. Where a clip's view is not yet
known the label SHALL say so rather than guess.

Each clip's entry in the header strip SHALL carry the same view label, so the reader can match the
number on a card to the footage in the strip.

With a single clip the label SHALL NOT render: there is no other clip it could have come from.

Fusion picks a winning clip per metric, so the numbers on one page can come from different footage
filmed from different angles. A reader comparing a side-view knee angle with an approach-view step
width needs to know they are looking at two clips, and which.

#### Scenario: Each metric names its source clip and view

- **WHEN** a session of three clips renders its fused results
- **THEN** every metric card states the clip number, the total, and that clip's view, taken from the
  per-metric source index

#### Scenario: A single clip renders no source label

- **WHEN** a session of one clip renders its results
- **THEN** no metric card renders a "Measured from" label

#### Scenario: The strip carries the same view labels

- **WHEN** a clip's analysis has detected its camera view
- **THEN** that clip's strip entry shows the same view label the cards use, and a clip whose view is
  not yet known shows that it is pending

### Requirement: Outline passes run after every scale pass, one at a time, and hold the background lane

The session's background lane SHALL grant at most one background pass at a time, scale or outline.
Every due scale pass SHALL be granted before any outline pass; outline passes SHALL then be granted
in clip order. A clip leased the lane for its outline pass SHALL keep it only while no scale pass is
due. A lease SHALL name the pass it was granted for: a scale lease SHALL end with that scale pass
and SHALL NOT carry over into the same clip's outline pass. No primary pass SHALL start while an
outline pass runs or holds its lease. The session's aggregate state SHALL carry the outline pass's
status.

#### Scenario: Three sequential clips, the third front-facing
- **WHEN** three clips sampled on the sequential path are analysed and only the third plans an outline pass
- **THEN** the order is primary 1, 2, 3, scale 1, 2, 3, then outline 3

#### Scenario: A clip added while a scale pass runs
- **WHEN** a clip is added while a front clip's scale pass is running
- **THEN** the added clip's primary runs before the front clip's outline pass

#### Scenario: A clip added while an outline pass runs
- **WHEN** a clip is added while another clip's outline pass is running
- **THEN** the new clip's primary waits until that outline pass is terminal

