## ADDED Requirements

### Requirement: Stride length is derived from same-side consecutive footstrike pairs

The system SHALL estimate stride length, in pixels, as the median of same-side consecutive-
footstrike-pair hip-mid horizontal displacement — reusing `estimateBodyScale`,
`estimateTravelDirection`, and `detectFootstrikes` as-is, without reimplementing footstrike
detection or body-scale estimation. For each side's consecutive footstrike pair, displacement
SHALL be signed by the clip's travel direction and kept only when positive (advancing in the
direction of travel); a pair whose signed displacement is zero or negative SHALL be dropped rather
than counted, and the system SHALL NOT re-pair across a dropped footstrike (e.g. pairing strike
`k` with strike `k+2` when `k+1` is dropped), since doing so would silently double the measured
interval.

#### Scenario: A clean side-view clip yields a stride length close to the true per-stride
displacement

- **WHEN** stride length is estimated against a `'side'`-view clip with a clean, detectable
  footstrike rhythm and known travel direction
- **THEN** the returned `strideLengthPx` is close to the true horizontal distance traveled per
  stride, `pairCount` is at least 3, and `pairCount` equals `candidatePairCount` when every
  consecutive pair resolved and advanced

#### Scenario: Too few footstrikes to form any consecutive pair

- **WHEN** fewer than two footstrikes are detected on every side (so no side has a consecutive
  pair to measure)
- **THEN** the result is not-ok with reason `'too-few-footstrikes'`

#### Scenario: No resolvable body-scale reference at all

- **WHEN** stride length is estimated against frames with no resolvable shoulder/hip position
  anywhere in the clip
- **THEN** the result is not-ok with reason `'no-body-scale'`

#### Scenario: Empty input never throws

- **WHEN** stride length is estimated against an empty frame list
- **THEN** the result is not-ok (reason `'no-body-scale'`) without throwing

### Requirement: Stride length requires a known direction of travel

The system SHALL check `estimateTravelDirection` before attempting footstrike-pair extraction, and
SHALL report a stride-length result of not-ok with reason `'travel-direction-unknown'` whenever
travel direction is indeterminate (`estimateTravelDirection` returns `0`) — regardless of whether
footstrikes are otherwise detectable — since a footstrike-pair displacement without a known sign
convention cannot be filtered into advancing/non-advancing pairs, and every resulting pair would
be meaningless even if footstrike detection itself succeeded.

#### Scenario: An approach/front-on clip with no net horizontal displacement

- **WHEN** stride length is estimated against a clip where `estimateTravelDirection` returns `0`
  (e.g. a runner approaching the camera head-on, or in-place footage)
- **THEN** the result is not-ok with reason `'travel-direction-unknown'`, checked ahead of, and
  regardless of, footstrike detectability

### Requirement: Vertical ratio is computed from the shared hip-bounce fit and stride length

The system SHALL compute `verticalRatio.value` as `fit.peakToPeakAmplitude / stride.strideLengthPx`
— exactly this expression, with no additional scaling factor and no intermediate rounding — where
`fit` comes from `analyzeHipBounce` (the hip-pinned bounce signal, independent of the
`verticalOscillationSignal` configuration option that only affects the `verticalOscillation`
metric) and `stride` comes from `estimateStrideLength`. The reported `unit` SHALL be `'percent'` (a
dimensionless 0..1 fraction, not pre-multiplied by 100). `sampleSize` SHALL be
`stride.pairCount`. The system SHALL reuse `verticalOscillationMinFitR2` as this metric's fit-
quality gate rather than introducing a separate configurable threshold, since both metrics gate the
identical fitted amplitude. When either the hip-bounce fit or the stride-length estimate fails —
including specifically when stride length fails because travel direction is indeterminate — the
system SHALL report `value: null`, `confidence: 0`, and a non-null caveat naming the specific
reason; the travel-direction-unknown case SHALL produce a caveat whose text begins with "Direction
of travel could not be determined (no net horizontal displacement)".

Watch comparability is explicitly **PENDING**: this metric targets the same ratio concept
(bounce ÷ stride length) that consumer running watches report as "Vertical Ratio", inferred from
the user's percentage-shaped ground-truth reading during the 2026-08-12 investigation — but which
specific quantity that reading represents has not been confirmed with the user, and this pipeline
computes the ratio in pixel space (real-world scale cancels) rather than reproducing any specific
watch's calibrated centimetre-based algorithm.

#### Scenario: A clean side-view clip yields a plausible vertical-ratio value

- **WHEN** vertical ratio is computed against a `'side'`-classified clip with both a fittable
  hip-bounce rhythm and a resolvable stride length
- **THEN** `value` equals `fit.peakToPeakAmplitude / stride.strideLengthPx` exactly, `unit` is
  `'percent'`, and `sampleSize` equals the stride-length estimate's `pairCount`

#### Scenario: Indeterminate travel direction reports no value with the exact caveat prefix

- **WHEN** vertical ratio is computed against a clip where `estimateTravelDirection` returns `0`
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` begins with "Direction of travel
  could not be determined (no net horizontal displacement)"

#### Scenario: No fittable hip-bounce rhythm reports no value

- **WHEN** the hip-bounce fit's sinusoid partial R² falls below `verticalOscillationMinFitR2`, or
  the fit otherwise fails
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` names the measured fit quality (or
  failure reason)

#### Scenario: Degenerate zero bounce reports no value ahead of the stride-length check

- **WHEN** the hip-bounce fit succeeds but its amplitude is degenerate (no measurable vertical
  motion), even if stride length would otherwise be computable
- **THEN** the numerator gate is evaluated first and `value` is `null` with a caveat describing the
  degenerate bounce, not a stride-length-shaped caveat

### Requirement: Vertical ratio is hard-gated to side view

The system SHALL still compute and return a value for vertical ratio when the detected view is
`'front'` or `'ambiguous'` and both the hip-bounce fit and stride length happen to resolve — never
substituting `null` purely because the view is unsuitable — while applying
`viewFitTable.verticalRatio`'s low multipliers (`front: 0.1`, `ambiguous: 0.2`) and attaching a
caveat stating the view is unsuitable, since stride length is a fore-aft (sagittal) displacement
that foreshortens toward zero away from a side-on camera angle, which would otherwise inflate the
ratio (a shrunk denominator) rather than merely add noise to it.

#### Scenario: A front-view clip that happens to have resolvable stride length is discounted, not
withheld

- **WHEN** vertical ratio is computed against a `'front'`-classified clip where
  `estimateTravelDirection` nonetheless returns a direction (e.g. a runner crossing the frame at a
  shallow angle) and a stride length resolves
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'` and confidence discounted by
  the `0.1` multiplier, with a caveat stating the view is unsuitable

#### Scenario: An ambiguous-view clip is discounted more gently than a confidently-front one

- **WHEN** vertical ratio is computed against an `'ambiguous'`-classified clip with an otherwise
  resolvable value
- **THEN** `viewFit` is `'unsuitable'` and confidence is discounted by the `0.2` multiplier, not the
  `0.1` front-view multiplier

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
- **THEN** the returned `verticalRatio.viewFit` reflects the same `view.view` label present in the
  same result as every other metric

#### Scenario: Empty frame list produces a well-formed vertical-ratio result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `verticalRatio.value` is `null` and `verticalRatio.confidence` is `0`, without throwing

#### Scenario: Never NaN or Infinity across degenerate inputs

- **WHEN** vertical ratio is computed against any combination of empty frames, a clip with zero
  bounce amplitude, a clip with indeterminate travel direction, or a clip with an unsuitable view
- **THEN** `value` is either a finite number or `null`, never `NaN` or `Infinity`, and `confidence`
  is `0` whenever `value` is `null`
