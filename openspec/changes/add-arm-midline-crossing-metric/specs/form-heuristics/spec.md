## ADDED Requirements

### Requirement: Arm midline crossing is a metric reporting the 95th-percentile signed medial wrist excursion past the shoulder midline as a fraction of shoulder width

The system SHALL expose arm midline crossing as a `MetricId` (`armMidlineCrossing`), positioned
last in `MetricId` and every enumeration of it (after `armSwingAmplitude`). Per frame and per
side, the signal SHALL be the wrist's signed offset from the shoulder midline: the midline
resolved with the STRICT bilateral primitive (`resolveBilateralPair` on the two shoulders),
never the tolerant single-side-fallback midpoint — a midline collapsed onto one shoulder
falsifies exactly the crossing sign being measured, the same documented regression class step
width's hip midline guards against — and the sign resolved PER FRAME from that frame's own-side
shoulder relative to shoulder-mid (the `outwardSign` pattern), never from a clip-wide
travel-direction constant, so that a wrist toward or past the midline reads POSITIVE (medial) on
both screen orientations and a wrist out on its own side reads negative. Each offset SHALL be
divided by the clip-median shoulder width (`estimateShoulderWidth`, the strict-pair sibling of
`estimateHipWidth`), and `unit` SHALL be `'percent'` — a fraction of shoulder width, not of
torso length.

The metric's `value` SHALL be the 95th percentile of the POOLED signed series — both arms'
per-frame samples pooled into one distribution — so the reported number is owned by the
more-medial arm rather than diluted by averaging a crossing arm against a non-crossing one, and
so a typical deepest reach is reported without segmenting swing cycles.

Below `MIN_ARM_CROSSING_SAMPLE_SIZE` (61) pooled samples — the derived point at which the
interpolated 95th percentile's read ranks fall strictly interior to the clean subsample under
two same-direction contaminants (`n ≥ 20k + 21`, `k = 2`) — the metric SHALL be DISCOUNTED
(`min(1, n / 61)` in confidence, plus a caveat), never withheld.

The metric SHALL report `value: null` with `confidence: 0` and a caveat naming the TRUE cause —
never a false or conflated one — in each of these distinct cases: no frame with a strict
shoulder pair (which is also the missing-denominator case, since the denominator resolves iff
the midline resolves); a side contributing zero usable samples, named as such (a one-arm pool's
upper tail silently becomes that one arm's, so it is not reported as "the arms'"); and a
degenerate (non-positive) clip-median shoulder width. The metric SHALL take no travel-direction
input — it emits on footage where the direction of travel is indeterminate. The metric measures
where the wrists TRAVEL relative to the runner's own shoulder midline, as a 2D movement
observation: neither its caveats nor its presentation SHALL claim propulsive effectiveness,
wasted energy, or injury implications, and a positive (crossing) value's interpretive caveat
SHALL present an observation about this one clip, not a diagnosis.

#### Scenario: A clean front clip reports the pooled 95th-percentile crossing

- **WHEN** arm midline crossing is computed against a front-view clip where the strict shoulder
  pair and both wrists resolve across the clip
- **THEN** `value` equals the 95th percentile of the pooled per-frame signed medial offsets
  divided by the clip-median shoulder width, with `unit: 'percent'` and `viewFit: 'primary'`

#### Scenario: The sign convention is medial-positive on both screen orientations

- **WHEN** the same crossing gait is presented in mirrored screen orientations (the runner's
  left on screen-left versus screen-right)
- **THEN** a wrist crossing past the midline reads positive in both, because each sample's sign
  comes from its own frame's own-side shoulder, not from a clip-level constant

#### Scenario: A frame with one resolvable shoulder contributes no samples

- **WHEN** a frame resolves only one of the two shoulders
- **THEN** that frame contributes no sample for either side — the midline is not approximated
  from the single resolvable shoulder

#### Scenario: A small pooled sample discounts confidence rather than withholding the value

- **WHEN** fewer than 61 pooled samples resolve but at least one per side does
- **THEN** a non-null `value` is returned with confidence discounted by `min(1, n / 61)` and a
  caveat naming the shortfall

#### Scenario: One untracked arm is a null naming the wrists

- **WHEN** one side's wrist never resolves in any strict-pair frame
- **THEN** `value` is `null` with `confidence: 0` and a caveat naming the missing wrist
  tracking, never a one-arm number presented as both arms'

#### Scenario: No strict shoulder pair anywhere is a null naming the midline

- **WHEN** no frame resolves both shoulders
- **THEN** `value` is `null` with `confidence: 0` and a caveat naming the unresolvable shoulder
  pair/midline

#### Scenario: Indeterminate travel direction does not suppress the metric

- **WHEN** the clip has no net horizontal displacement (travel direction indeterminate)
- **THEN** the metric still reports its value — no travel-direction input exists in its
  computation

### Requirement: Arm midline crossing is front-view-primary, hard-gated away from side view

The system SHALL treat `'front'` as the primary view for arm midline crossing
(`viewFitTable.armMidlineCrossing.front = { fit: 'primary', multiplier: 1.0 }`) and `'side'` as
unsuitable (`multiplier: 0.1`) — copying `stepWidth`'s identical front-primary/side-unsuitable
gating exactly, not merely similarly — because a side-on camera looks straight along the
mediolateral axis this metric measures, collapsing the wrist-to-midline offset toward a
degenerate reading. `'ambiguous'` SHALL also be treated as unsuitable (`multiplier: 0.2`). The
system SHALL still compute and return a value when the view is `'side'` or `'ambiguous'` and a
value would otherwise resolve, never substituting `null` purely because the view is unsuitable,
and SHALL attach a caveat naming the unsuitable camera angle via the shared view phrasing.

#### Scenario: Front-view clip is the primary, highest-confidence case

- **WHEN** arm midline crossing is computed against a `'front'`-classified clip with a
  resolvable strict shoulder pair and both wrists tracking
- **THEN** a non-null `value` is returned with `viewFit: 'primary'`

#### Scenario: Side-view clip is computed, not withheld, but flagged unsuitable

- **WHEN** arm midline crossing is computed against a `'side'`-classified clip where a value
  would otherwise resolve
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a caveat stating the measurement is not reliable from that camera
  angle

### Requirement: Arm midline crossing participates in the shared orchestration and output contract

The system SHALL include arm midline crossing in `computeFormHeuristics`'s result
(`FormHeuristicsResult.armMidlineCrossing`), positioned last — appended after
`armSwingAmplitude` rather than inserted elsewhere, matching `MetricId`'s own declaration
order — computed under the same once-per-clip detected view as every other metric, and SHALL
follow the same output contract every other metric follows: `value` a finite number or `null`
(never `NaN` or `Infinity`), `confidence` in `[0, 1]` forced to `0` when `value` is `null`, and
no exception for any well-typed `RobustPoseFrame[]` input including an empty array.

#### Scenario: computeFormHeuristics includes arm midline crossing gated by the shared detected view

- **WHEN** `computeFormHeuristics` is called on a single frame sequence
- **THEN** the returned `armMidlineCrossing.viewFit` reflects the same view decision present in
  the same result as every other metric

#### Scenario: Empty frame list produces a well-formed result

- **WHEN** `computeFormHeuristics` is called with an empty `RobustPoseFrame[]`
- **THEN** `armMidlineCrossing.value` is `null` and `armMidlineCrossing.confidence` is `0`,
  without throwing

#### Scenario: Never NaN or Infinity across degenerate inputs

- **WHEN** arm midline crossing is computed against any combination of empty frames, a clip with
  no strict shoulder pair, a clip with one untracked arm, a degenerate shoulder width, or a clip
  with an unsuitable view
- **THEN** `value` is either a finite number or `null`, never `NaN` or `Infinity`, and
  `confidence` is `0` whenever `value` is `null`
