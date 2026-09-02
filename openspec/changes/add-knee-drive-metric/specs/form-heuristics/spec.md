## ADDED Requirements

### Requirement: Knee drive is a metric reporting the median peak thigh-lift angle across both legs

The system SHALL expose knee drive as a `MetricId` (`kneeDrive`), positioned last in `MetricId`
and every enumeration of it (after `stepWidthCm`). Its `value` SHALL be the median, in degrees,
of per-stride peak thigh-lift angles — the hip→knee vector's angle off the image's down-vertical
ray at that leg's swing-phase lift peak — detected per leg by the shared gap-aware
prominence-thresholded extrema finder (`findLocalExtrema`, gated by
`kneeDriveMinProminenceDegrees`), one peak per leg per stride, pooled across both legs. `unit`
SHALL be `'degrees'`. The metric measures thigh-lift AMPLITUDE as a 2D angle proxy: it is
distinct from knee flexion (which measures the hip-knee-ankle interior bend and reads the ankle;
knee drive never does), and neither its caveats nor its presentation SHALL claim to measure
propulsive force or drive effectiveness. When no frame resolves a hip and knee for either leg,
the system SHALL report `value: null`, `confidence: 0`, and a caveat naming the unresolvable
input. When positions resolve but no lift peak clears the prominence floor, the system SHALL
report `value: null`, `confidence: 0`, and a distinct caveat stating that no thigh-lift peaks
could be detected — never conflating the two null-value causes into one message.

#### Scenario: A clean side-view clip reports the median peak lift with sane sample size

- **WHEN** knee drive is computed against a side-view clip where both legs' hips and knees
  resolve and each leg swings through detectable lift peaks
- **THEN** `value` is a finite number of degrees equal to the median of the detected per-leg peak
  angles, `sampleSize` equals the count of peaks pooled across both legs, and `confidence`
  reflects view fit, coverage, interpolation, and sample-size-versus-minimum factors

#### Scenario: A thigh that never lifts reports a distinct no-peaks caveat

- **WHEN** knee drive is computed against a clip whose hip and knee positions resolve but whose
  thigh angle never clears the prominence floor (e.g. standing or walking in place with minimal
  lift)
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` states that no thigh-lift peaks
  could be detected — distinct in wording from the unresolvable-input caveat

#### Scenario: Unresolvable hip/knee input reports the unresolvable-input caveat

- **WHEN** knee drive is computed against a clip where no frame resolves a hip and knee pair for
  either leg
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` names the unresolvable input,
  without throwing

### Requirement: Knee drive is side-view-primary, hard-gated away from front view

The system SHALL treat `'side'` as the primary view for knee drive
(`viewFitTable.kneeDrive.side = { fit: 'primary', multiplier: 1.0 }`) and `'front'` as unsuitable
(`multiplier: 0.1`) — copying `kneeFlexion`'s identical side-primary/front-unsuitable gating
exactly, not merely similarly — because the thigh-lift angle is a sagittal-plane quantity
foreshortened toward a degenerate reading face-on. `'ambiguous'` SHALL also be treated as
unsuitable (`multiplier: 0.2`). The system SHALL still compute and return a value when the view
is `'front'` or `'ambiguous'` and a value would otherwise resolve, never substituting `null`
purely because the view is unsuitable, and SHALL attach a caveat naming the unsuitable camera
angle via the shared view phrasing.

#### Scenario: Side-view clip is the primary, highest-confidence case

- **WHEN** knee drive is computed against a `'side'`-classified clip with resolvable hips and
  knees and detectable lift peaks
- **THEN** a non-null `value` is returned with `viewFit: 'primary'`

#### Scenario: Front-view clip is computed, not withheld, but flagged unsuitable

- **WHEN** knee drive is computed against a `'front'`-classified clip with resolvable hips and
  knees and detectable lift peaks
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a caveat stating the measurement is not reliable from that camera
  angle

### Requirement: Knee drive participates in the shared orchestration and output contract

The system SHALL include knee drive in `computeFormHeuristics`'s result
(`FormHeuristicsResult.kneeDrive`), positioned last — appended after `stepWidthCm` rather than
inserted elsewhere, matching `MetricId`'s own declaration order — computed under the same
once-per-clip detected view as every other metric, and SHALL follow the same output contract
every other metric follows: `value` a finite number or `null` (never `NaN` or `Infinity`),
`confidence` in `[0, 1]` forced to `0` when `value` is `null`, and no exception for any
well-typed `RobustPoseFrame[]` input including an empty array.

#### Scenario: computeFormHeuristics includes knee drive gated by the shared detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `kneeDrive.viewFit` reflects the same view decision present in the same
  result as every other metric

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `kneeDrive.value` is `null` and `kneeDrive.confidence` is `0`, without throwing

#### Scenario: Never NaN or Infinity across degenerate inputs

- **WHEN** knee drive is computed against any combination of empty frames, a clip with no
  resolvable hip/knee positions, a clip with no detectable lift peaks, or a clip with an
  unsuitable view
- **THEN** `value` is either a finite number or `null`, never `NaN` or `Infinity`, and
  `confidence` is `0` whenever `value` is `null`
