## ADDED Requirements

### Requirement: View detection reports how plausible each view is

The system SHALL return, alongside the committed view label and its confidence, a
`plausibility` distribution over `'side'`, `'front'` and `'ambiguous'` whose components are
non-negative and sum to 1, derived from the same two signals (BSR and SER) the label is derived
from and from the same configurable thresholds, with no additional tunable of its own.

Each signal SHALL contribute a support in `[0, 1]` for each committed view, equal to 1 once the
signal has cleared that view's own threshold, 0 once it has cleared the other view's threshold,
and interpolated across the band between them. A committed view's plausibility SHALL be the
product of the two signals' support for it, so that one signal alone can never carry a view, and
`'ambiguous'` SHALL take the remaining mass.

The distribution SHALL be one-hot on `'ambiguous'` whenever either signal is unavailable or
body-scale coverage is below `minViewDetectionFrameCoverage`.

#### Scenario: A clip that commits to a label is one-hot on that same label

- **WHEN** both signals sit inside one view's regions, so the clip is classified `'side'` or
  `'front'`
- **THEN** that view's plausibility is 1 and the other two are 0

#### Scenario: A signal in the undecided band splits mass with ambiguous

- **WHEN** one signal has cleared one view's threshold but the other signal sits between the two
  thresholds for its own measure
- **THEN** that view's plausibility is between 0 and 1, the opposite view's is 0, and `'ambiguous'`
  holds the remainder

#### Scenario: Disagreeing signals leave all the mass on ambiguous

- **WHEN** one signal fully supports `'side'` and the other fully supports `'front'`
- **THEN** both committed views have plausibility 0 and `'ambiguous'` has 1

#### Scenario: A missing signal or insufficient coverage supports no view

- **WHEN** no frames yield a usable BSR or SER sample, or body-scale coverage is below
  `minViewDetectionFrameCoverage`, or the frame list is empty
- **THEN** `plausibility` is `{ side: 0, front: 0, ambiguous: 1 }`

### Requirement: Metric view fit is resolved from view plausibility, not from the committed label

The system SHALL resolve each metric's view fit against the clip's `plausibility` before any
metric reads it: the applied confidence multiplier SHALL be the plausibility-weighted mean of that
metric's three `viewFitTable` rows, and the reported `viewFit` SHALL be the row of the view holding
the most plausibility mass, with `'ambiguous'` taking ties. Both SHALL be derived from the same
distribution, so that a metric can never be reported as structurally unmeasurable and another
metric granted full confidence on the strength of the same uncertain view classification.

`computeFormHeuristics` SHALL perform this resolution exactly once per clip and share it across
every metric. Where another requirement in this capability names a metric's per-view row values
(for example `side: 1.0`, `front: 0.85`, `ambiguous: 0.6`), those values are the endpoints of this
resolution: they are the multiplier applied whenever the clip commits to a view, and the values
blended otherwise.

Resolution SHALL NOT depend on body-scale sample coverage beyond the existing
`minViewDetectionFrameCoverage` gate, since every metric already factors its own frame coverage
into its confidence over the same frames.

#### Scenario: A committed view is gated exactly as its own row prescribes

- **WHEN** `computeFormHeuristics` runs on a clip classified `'side'` or `'front'`
- **THEN** every metric's `viewFit` and confidence multiplier are exactly that view's row from
  `viewFitTable`, identical to computing the metric directly against that view label

#### Scenario: A marginally-committed view is not degraded for being marginal

- **WHEN** a clip commits to a view because both signals cleared that view's thresholds, but one of
  them cleared its threshold only narrowly
- **THEN** that view's metrics are gated by its own row at full strength, because the opposite
  view's conditions are unmet and the narrowness of one margin is not evidence for the opposite
  view

#### Scenario: A metric measurable from the most plausible view is reported, not excluded

- **WHEN** one committed view has plausibility 0 and the other holds most of the remaining mass,
  so the label is `'ambiguous'`
- **THEN** a metric whose row for the plausible view is not `'unsuitable'` reports that fit rather
  than being excluded, with a multiplier between what the plausible view's row and the
  `'ambiguous'` row would each have given it alone

#### Scenario: A metric unsuitable from every plausible view stays excluded

- **WHEN** a metric's rows are `'unsuitable'` for every view carrying plausibility mass
- **THEN** its resolved `viewFit` is `'unsuitable'` and it remains excluded

#### Scenario: A genuinely ambiguous clip degrades in both directions

- **WHEN** both signals sit in their undecided bands, so `'ambiguous'` holds the most mass
- **THEN** side-primary and front-primary metrics alike resolve to their `'ambiguous'` rows' fit,
  neither direction favoured, while view-tolerant metrics continue to report

## MODIFIED Requirements

### Requirement: Orchestration runs view detection once and shares it across all three metrics

The system SHALL provide `computeFormHeuristics(frames, config?)` that runs `detectView` exactly
once and passes its result into all three metric computations, so callers never need to invoke
view detection and each metric separately in the correct order.

#### Scenario: All three metrics use the same detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `verticalOscillation.viewFit`, `trunkLean.viewFit`, and
  `overstriding.viewFit` all reflect the same resolved view (the one holding the most plausibility
  mass, which is that result's `view.view` label whenever the clip commits to a label) present in
  the same result

### Requirement: Cadence participates in the shared orchestration and output contract

The system SHALL include cadence in `computeFormHeuristics`'s result (`FormHeuristicsResult.cadence`),
computed under the same once-per-clip detected view as the other three metrics, and SHALL follow
the same output contract every other metric follows: `value` a finite number or `null` (never
`NaN`), `confidence` in `[0, 1]` forced to `0` when `value` is `null`, and no exception for any
well-typed `RobustPoseFrame[]` input including an empty array.

#### Scenario: computeFormHeuristics includes cadence gated by the shared detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `cadence.viewFit` reflects the same resolved view (the one holding the
  most plausibility mass, which is that result's `view.view` label whenever the clip commits to a
  label) present in the same result as `verticalOscillation`, `trunkLean`, and `overstriding`

#### Scenario: Empty frame list produces a well-formed cadence result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `cadence.value` is `null` and `cadence.confidence` is `0`, without throwing

### Requirement: Knee flexion is included in orchestrated output

The system SHALL include `kneeFlexion: MetricResult` in `FormHeuristicsResult`, computed by
`computeFormHeuristics` using the same detected `View` shared with the other three metrics.

#### Scenario: Orchestrated result includes knee flexion

- **WHEN** `computeFormHeuristics` is called on a frame sequence
- **THEN** the returned result's `kneeFlexion.viewFit` reflects the same resolved view (the one
  holding the most plausibility mass, which is that result's `view.view` label whenever the clip
  commits to a label) present in the same result as the other three metrics

### Requirement: Vertical ratio participates in the shared orchestration and output contract

The system SHALL include vertical ratio in `computeFormHeuristics`'s result
(`FormHeuristicsResult.verticalRatio`), positioned immediately after `verticalOscillation` in
`MetricId` and every enumeration of it, computed under the same once-per-clip detected view as
every other metric, and SHALL follow the same output contract every other metric follows: `value`
a finite number or `null` (never `NaN` or `Infinity`), `confidence` in `[0, 1]` forced to `0` when
`value` is `null`, and no exception for any well-typed `RobustPoseFrame[]` input including an
empty array.

#### Scenario: computeFormHeuristics includes vertical ratio gated by the shared detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `verticalRatio.viewFit` reflects the same resolved view (the one holding
  the most plausibility mass, which is that result's `view.view` label whenever the clip commits
  to a label) present in the same result as every other metric

#### Scenario: Empty frame list produces a well-formed vertical-ratio result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `verticalRatio.value` is `null` and `verticalRatio.confidence` is `0`, without throwing

#### Scenario: Never NaN or Infinity across degenerate inputs

- **WHEN** vertical ratio is computed against any combination of empty frames, a clip with zero
  bounce amplitude, a clip with indeterminate travel direction, or a clip with an unsuitable view
- **THEN** `value` is either a finite number or `null`, never `NaN` or `Infinity`, and `confidence`
  is `0` whenever `value` is `null`

### Requirement: Vertical oscillation in centimetres participates in the shared orchestration and output contract

The system SHALL include vertical oscillation in centimetres in `computeFormHeuristics`'s result
(`FormHeuristicsResult.verticalOscillationCm`), positioned immediately after `verticalRatio` —
appended after it rather than inserted between `verticalOscillation` and `verticalRatio`, so that
`verticalRatio`'s own orchestration requirement (that it sits immediately after
`verticalOscillation`) remains true without modification — computed under the same once-per-clip
detected view as every other metric, and SHALL follow the same output contract every other metric
follows: `value` a finite number or `null` (never `NaN` or `Infinity`), `confidence` in `[0, 1]`
forced to `0` when `value` is `null`, and no exception for any well-typed `RobustPoseFrame[]` input
including an empty array.

#### Scenario: computeFormHeuristics includes vertical oscillation in centimetres gated by the shared detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `verticalOscillationCm.viewFit` reflects the same resolved view (the one
  holding the most plausibility mass, which is that result's `view.view` label whenever the clip
  commits to a label) present in the same result as every other metric

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `verticalOscillationCm.value` is `null` and `verticalOscillationCm.confidence` is `0`,
  without throwing

#### Scenario: Never NaN or Infinity across degenerate inputs

- **WHEN** vertical oscillation in centimetres is computed against any combination of empty
  frames, a clip with no measured scale, a clip with a measured scale but no fittable rhythm, or a
  clip with an unsuitable view
- **THEN** `value` is either a finite number or `null`, never `NaN` or `Infinity`, and `confidence`
  is `0` whenever `value` is `null`

### Requirement: Step width in centimetres participates in the shared orchestration and output contract

The system SHALL include step width in centimetres in `computeFormHeuristics`'s result
(`FormHeuristicsResult.stepWidthCm`), positioned last — appended after `footStrikePattern` rather
than inserted elsewhere, matching `MetricId`'s own declaration order — computed under the same
once-per-clip detected view as every other metric, and SHALL follow the same output contract every
other metric follows: `value` a finite number or `null` (never `NaN` or `Infinity`), `confidence`
in `[0, 1]` forced to `0` when `value` is `null`, and no exception for any well-typed
`RobustPoseFrame[]` input including an empty array.

#### Scenario: computeFormHeuristics includes step width in centimetres gated by the shared detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `stepWidthCm.viewFit` reflects the same resolved view (the one holding the
  most plausibility mass, which is that result's `view.view` label whenever the clip commits to a
  label) present in the same result as every other metric

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `stepWidthCm.value` is `null` and `stepWidthCm.confidence` is `0`, without throwing

#### Scenario: Never NaN or Infinity across degenerate inputs

- **WHEN** step width in centimetres is computed against any combination of empty frames, a clip
  with no measured scale, a clip with a measured scale but no detectable footstrikes, or a clip
  with an unsuitable view
- **THEN** `value` is either a finite number or `null`, never `NaN` or `Infinity`, and `confidence`
  is `0` whenever `value` is `null`
