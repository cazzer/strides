# multi-clip-analysis

## MODIFIED Requirements

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
