## ADDED Requirements

### Requirement: Step width in centimetres is a metric gated on measured real-world scale

The system SHALL expose step width in centimetres as a `MetricId` (`stepWidthCm`), positioned last
in `MetricId` and every enumeration of it (after `footStrikePattern`). Its `value` SHALL be the
median, across footstrikes where a real-world scale was measured, of the signed ankle-x-minus-
hip-mid-x offset at that footstrike converted to centimetres via that same frame's
`pixelsPerMeter` — an instantaneous per-frame spatial ratio, never a value derived from
integrating or fitting a time series. `unit` SHALL be `'centimeters'`. When no frame in the clip
carries a measured real-world scale, the system SHALL check this FIRST, before attempting
footstrike detection, and report `value: null`, `confidence: 0`, and a caveat stating in plain
language that no real-world scale could be measured for this clip and pointing the reader to the
sibling pixel-ratio step-width metric that does not need one — naming no backend or model, the
same caveat regardless of whether the active backend has never measured scale or a scale-measuring
backend's per-frame measurement failed everywhere on this particular clip. When a real-world scale
WAS measured but no footstrikes could be detected in the clip at all, the system SHALL report
`value: null`, `confidence: 0`, and a distinct caveat stating that no footstrikes could be
detected — never conflating the two null-value causes into one message. When footstrikes ARE
detected but none of them has a resolvable hip position, ankle position, and usable scale
simultaneously, the system SHALL report a third, distinct caveat naming that. A footstrike
candidate whose frame lacks a usable scale (while other candidates' frames have one) SHALL be
excluded from that computation only, not treated as a whole-clip failure.

#### Scenario: A backend that doesn't measure scale reports an availability caveat

- **WHEN** `stepWidthCm` is computed against a clip where no frame's `pixelsPerMeter` is measured
- **THEN** `value` is `null`, `confidence` is `0`, `unit` is `'centimeters'`, and `caveat` states
  that no real-world scale could be measured for this clip — naming no backend or model — without
  throwing, and this check happens before footstrike detection is even attempted

#### Scenario: An empty frame list is indistinguishable from a scale-less backend

- **WHEN** `stepWidthCm` is computed against an empty frame list
- **THEN** the result is identical in shape to the scale-less-backend case: `value: null`,
  `confidence: 0`, without throwing

#### Scenario: A measured scale with no detectable footstrikes reports a distinct caveat

- **WHEN** `stepWidthCm` is computed against a clip where at least one frame carries a measured
  scale, but no footstrikes are detected anywhere in the clip
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` states that no footstrikes could be
  detected — distinct in wording from the no-scale-measured caveat

#### Scenario: Footstrikes with no usable scale at that instant are excluded, not fatal

- **WHEN** `stepWidthCm` is computed against a clip where some footstrike candidates' frames carry
  a measured scale and others do not
- **THEN** `value` is the median computed over only the footstrikes whose frame carried a usable
  scale (and a resolvable hip and ankle position), `frameCoverage` reflects that fraction, and the
  excluded candidates do not prevent a value from being reported

#### Scenario: A measured, resolvable clip reports a value with sane sample size

- **WHEN** `stepWidthCm` is computed against a clip with a measured real-world scale and multiple
  detectable footstrikes with resolvable hip and ankle positions
- **THEN** `value` is a finite number, `sampleSize` equals the count of footstrikes that
  contributed to the median, and `confidence` reflects view fit, coverage, interpolation, and
  sample-size-versus-minimum factors — with no separate scale-coverage confidence factor, since a
  missing scale at a footstrike is already priced into `frameCoverage` by the exclusion above

### Requirement: Step width in centimetres is front-view-primary, hard-gated away from side view

The system SHALL treat `'front'` as the primary view for step width in centimetres
(`viewFitTable.stepWidthCm.front = { fit: 'primary', multiplier: 1.0 }`) and `'side'` as
unsuitable (`multiplier: 0.1`) — mirroring `armSwingSymmetry`'s identical front-primary/
side-unsuitable gating exactly, not merely similarly — because a side-on camera collapses the
mediolateral (side-to-side) offset this metric measures onto the same image axis the hip already
occupies, producing a confidently-wrong small number rather than an obviously-degraded one.
`'ambiguous'` SHALL also be treated as unsuitable (`multiplier: 0.2`). The system SHALL still
compute and return a value when the view is `'side'` or `'ambiguous'` and a scale-and-footstrikes
value would otherwise resolve, never substituting `null` purely because the view is unsuitable.

#### Scenario: Front-view clip is the primary, highest-confidence case

- **WHEN** step width in centimetres is computed against a `'front'`-classified clip with a
  measured scale and resolvable footstrikes
- **THEN** a non-null `value` is returned with `viewFit: 'primary'`

#### Scenario: Side-view clip is computed, not withheld, but flagged unsuitable

- **WHEN** step width in centimetres is computed against a `'side'`-classified clip with a
  measured scale and resolvable footstrikes
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a caveat stating the view is unsuitable

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
- **THEN** the returned `stepWidthCm.viewFit` reflects the same `view.view` label present in the
  same result as every other metric

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `stepWidthCm.value` is `null` and `stepWidthCm.confidence` is `0`, without throwing

#### Scenario: Never NaN or Infinity across degenerate inputs

- **WHEN** step width in centimetres is computed against any combination of empty frames, a clip
  with no measured scale, a clip with a measured scale but no detectable footstrikes, or a clip
  with an unsuitable view
- **THEN** `value` is either a finite number or `null`, never `NaN` or `Infinity`, and `confidence`
  is `0` whenever `value` is `null`
