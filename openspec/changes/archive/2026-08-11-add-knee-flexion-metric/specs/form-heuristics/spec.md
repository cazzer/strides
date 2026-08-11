## ADDED Requirements

### Requirement: Knee flexion is hard-gated to side view

The system SHALL still compute and return a value for knee flexion when the detected view is
`'front'` or `'ambiguous'` — never substituting `null` purely because the view is unsuitable —
while applying `viewFitTable.kneeFlexion`'s low multipliers (`front: 0.1`, `ambiguous: 0.2`) and
attaching a caveat stating the view is unsuitable, since a front-facing camera cannot see the
sagittal-plane hip-knee-ankle angle knee flexion measures.

#### Scenario: Front-view knee flexion is computed, not withheld

- **WHEN** knee flexion is computed against a `'front'`-classified clip with resolvable
  hip/knee/ankle positions
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a non-null `caveat` stating the view is unsuitable

### Requirement: Knee flexion reports the median swing-phase peak across both legs

The system SHALL compute, for each leg independently, the hip-knee-ankle interior joint angle per
frame wherever that leg's hip/knee/ankle all resolve, convert it to degrees of flexion from full
extension (`180° - interior angle`, so `0°` is a fully straight leg and larger values mean more
bend), detect each leg's swing-phase peak-flexion cycles via a prominence-thresholded extrema scan
of that per-leg flexion-degrees series, and report the clip's `value` as the median of the peaks
pooled from both legs.

#### Scenario: A clean clip reports a plausible pooled median

- **WHEN** knee flexion is computed against a side-view clip with a clear, repeating flexion/
  extension cycle on both legs
- **THEN** `value` is the median of the per-leg swing-phase peak-flexion values (in degrees),
  `unit` is `'degrees'`, and `sampleSize` reflects the number of peaks pooled from both legs

#### Scenario: No swing-phase peak is detectable

- **WHEN** hip/knee/ankle positions resolve but the per-leg flexion-degrees series never moves by
  at least `kneeFlexionMinProminenceDegrees` (e.g. a flat, unbending trace)
- **THEN** `value` is `null`, `confidence` is `0`, `sampleSize` is `0`, and `caveat` is non-null,
  without throwing

#### Scenario: No resolvable leg position at all

- **WHEN** neither leg's hip/knee/ankle resolve in any frame
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` is non-null, without throwing

### Requirement: Knee flexion is included in orchestrated output

The system SHALL include `kneeFlexion: MetricResult` in `FormHeuristicsResult`, computed by
`computeFormHeuristics` using the same detected `View` shared with the other three metrics.

#### Scenario: Orchestrated result includes knee flexion

- **WHEN** `computeFormHeuristics` is called on a frame sequence
- **THEN** the returned result's `kneeFlexion.viewFit` reflects the same `view.view` label present
  in the same result as the other three metrics
