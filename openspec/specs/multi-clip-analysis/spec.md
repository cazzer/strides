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

