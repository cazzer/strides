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
  has higher confidence on `armSwingSymmetry`
- **THEN** the fused result's `trunkLean` is clip 0's object (with clip 0's provenance caveat) and
  its `armSwingSymmetry` is clip 1's object (with clip 1's provenance caveat)

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
across all clips in the order `running > done > failed > skipped`; `error` is the first
(lowest-index) errored clip's error; `robustFrames`, `diagnostics`, and `scalePass.diagnostics`
are always `null` at the aggregate level, since nothing downstream reads an aggregate version of
either (each clip renders its own skeleton overlay off its own state).

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

### Requirement: Serialized shared-detector access across concurrently mounted clips

The system SHALL grant the shared pose detector to at most one clip at a time, advancing which
clip holds it only once the previously-active clip's entire per-clip pipeline — its primary
analysis run AND its background scale pass — has reached a terminal state (primary `phase` is
`'ready'` or `'error'`; `scalePass.status` is `'done'`, `'failed'`, or `'skipped'`). This exists
because the shared detector carries mutable cross-frame tracking state (MoveNet's tracking-crop
bounding box, MediaPipe's `PoseLandmarker` VIDEO-mode timestamp tracking) that is not
per-clip-scoped, so two clips sampling concurrently against it could silently leak one clip's
tracking state into another's frames.

#### Scenario: Only one clip receives a live detector at a time

- **WHEN** two or more clips are mounted concurrently
- **THEN** at most one of them is ever passed a non-null detector at any point in time; every
  other clip receives `null`

#### Scenario: The active clip advances only after its scale pass also finishes

- **WHEN** the active clip's primary analysis reaches `'ready'` but its background scale pass is
  still `'pending'` or `'running'`
- **THEN** the active clip does not yet change — the next clip does not receive a detector until
  the scale pass also reaches a terminal status

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

