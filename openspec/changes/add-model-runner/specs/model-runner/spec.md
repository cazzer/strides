## ADDED Requirements

### Requirement: The model runner is a seamless procedural gait cycle over the nineteen pose joints

The system SHALL provide a pure function `poseAt(phase, params)` that returns one 3D joint for each
of the nineteen `COMMON_KEYPOINT_NAMES`, in that order, for any real `phase`, where one unit of
phase is one full gait cycle (left contact at 0, right contact at 0.5). The pose SHALL be
continuous in phase, SHALL be identical at phase 0 and phase 1, and every skeleton segment's length
SHALL be constant over the cycle. The second half-cycle SHALL be the first mirrored. The body
proportions SHALL be fixed and documented as illustrative.

#### Scenario: The loop has no seam
- **WHEN** the pose is computed at phase 0 and at phase 1 (or at phase 0 and just below phase 1)
- **THEN** every joint is in the same place, to within numerical precision

#### Scenario: The second step mirrors the first
- **WHEN** the pose at phase p + 0.5 is compared with the pose at phase p
- **THEN** each left joint matches the corresponding right joint with its lateral coordinate negated

### Requirement: Every degree of freedom is bound to exactly one measured value or held at a documented neutral constant

The system SHALL bind each runner parameter to its candidate metric's value when that metric is
non-null and its tier is not `'excluded'`, and SHALL otherwise hold the parameter at its neutral
constant. A `'caveated'` metric SHALL bind. Vertical oscillation SHALL bind from the torso ratio,
falling back to centimetres divided by the model's 50 cm torso only when the ratio is unmeasured.
No metric SHALL be a candidate for more than one parameter, and `verticalRatio` and `stepWidthCm`
SHALL bind nothing. A value outside the drawable range SHALL be clamped and the bound parameter
SHALL record the metric's own value and that it was clamped.

Every bound parameter's value SHALL be exactly what the model draws. Where the landing offset, the
contact shank offset and the peak thigh angle cannot all be drawn together, a measured parameter
SHALL take precedence over a neutral one, and among parameters of the same source the order SHALL
be landing offset, then contact shank offset, then peak thigh angle. A measured parameter that gives
way SHALL carry the drawn value, be marked clamped, and keep the metric's own value. A neutral
parameter that gives way SHALL remain neutral, with its constant adjusted to fit.

#### Scenario: A measured metric binds
- **WHEN** `trunkLean` is measured at 5° with normal confidence
- **THEN** torso pitch is bound to 5°, its source is measured, and it names `trunkLean`

#### Scenario: A null metric leaves its part neutral
- **WHEN** `kneeDrive` is null
- **THEN** the peak thigh angle is held at its neutral constant with source neutral

#### Scenario: An excluded metric leaves its part neutral
- **WHEN** `stepWidth` has a value but its view fit is unsuitable
- **THEN** step width is held at its neutral constant

#### Scenario: A low-confidence metric still binds
- **WHEN** `trunkLean` is measured with confidence below the high-confidence threshold
- **THEN** torso pitch is bound to that measurement

#### Scenario: Bounce falls back to centimetres
- **WHEN** `verticalOscillation` is null and `verticalOscillationCm` is measured at 7.5 cm
- **THEN** pelvis bounce is bound to 7.5 / 50 torso lengths and names `verticalOscillationCm`

#### Scenario: One metric never drives two degrees of freedom
- **WHEN** the binding table is inspected
- **THEN** each metric appears as a candidate for at most one parameter

#### Scenario: A measured foot strike beats a neutral landing
- **WHEN** `footStrikePattern` is measured at 0.2 and `overstriding` is null
- **THEN** the contact shank offset is drawn at exactly 0.2, unclamped, and the neutral landing offset is adjusted to fit and stays neutral

#### Scenario: Two measured contact offsets conflict
- **WHEN** `overstriding` is measured at 0.05 and `footStrikePattern` at 0.10
- **THEN** the landing offset is drawn at exactly 0.05, and the contact shank offset carries the drawn value (about 0.025), is marked clamped, and keeps 0.10 as its metric value

#### Scenario: The bound values are what is drawn
- **WHEN** the model is drawn from the bound values and each binding metric's formula is applied to it
- **THEN** every formula returns its parameter's bound value

### Requirement: Neutral constants are illustrative and never a target

Each neutral constant SHALL be documented as illustrative and SHALL NOT equal, to within 1%, any
reference-band zone midpoint, band envelope midpoint, or published central value of the metrics that
can bind its parameter. The system SHALL NOT provide an "ideal" or second reference runner, and
SHALL NOT provide any per-side or variability parameter, because no metric reports either.

#### Scenario: A neutral is not a band centre
- **WHEN** the knee-bend neutral is compared with the knee-flexion band's midpoint and its central value
- **THEN** it differs from each by more than 1%

#### Scenario: The model carries no asymmetry
- **WHEN** the parameter set is inspected
- **THEN** it has no left/right or spread parameter, and the right side is always the left side mirrored half a cycle later

### Requirement: A bound parameter changes only its own part of the runner, in the direction of its value

Applying a bound metric's own formula to the model's joints SHALL return the parameter's value
for every parameter in a conflict-free set (the swing-foot arc to within its percentile sampling,
the peak metrics to within their extrema finder's sampling). Raising a parameter SHALL raise
that measured quantity. Changing a parameter SHALL leave every joint outside that parameter's
documented set of joints bit-identical. Cadence SHALL change only the cycle rate.

#### Scenario: More lean pitches the torso further and leaves the legs alone
- **WHEN** torso pitch is raised from 0° to 20° with all else neutral
- **THEN** the measured trunk lean rises from 0° to 20° and every hip, knee, ankle, heel and toe is unchanged

#### Scenario: Measuring the model returns the bound value
- **WHEN** step width is bound to 0.05 hip widths
- **THEN** the contact ankle's outward offset from the hip midline, over the model's hip width, is 0.05

#### Scenario: Contact conflict keeps the stronger parameter exact
- **WHEN** both contact offsets are measured and the shank offset is too large for the landing offset without hyperextending the knee
- **THEN** the landing offset is still exact, the knee is held straight, and the foot-strike offset is what gives way, drawn at the value its bound parameter carries

### Requirement: Neutral parts are identifiable per segment

The system SHALL report, for every skeleton edge, whether it is measured or neutral. An edge SHALL be
measured when any parameter that shapes it is measured, and neutral otherwise. Head edges SHALL
always be neutral.

#### Scenario: Only knee drive is measured
- **WHEN** every metric except `kneeDrive` is excluded
- **THEN** both thighs are measured, and the shanks, arms, torso and head are neutral

#### Scenario: Everything is measured
- **WHEN** every binding metric is measured
- **THEN** every edge except the head edges is measured

### Requirement: An orthographic camera turns, zooms and interpolates continuously

The system SHALL project model joints orthographically through a camera with yaw, pitch, zoom and a
target, into SVG-oriented screen coordinates with the target at the origin and a depth for draw
order. Yaw 0 SHALL be the side view with travel toward screen right, and yaw 90 the front view with
the runner's left on screen right. The system SHALL provide the presets `wholeBodySide`,
`upperFrontQuarter`, `torsoSide`, `legsSide`, `footSide` and `feetFront`, and
`interpolateCamera(a, b, t)` SHALL return `a` at t = 0 and `b` at t = 1, take yaw the shorter way
round, and move every projected joint continuously in t.

#### Scenario: Side view
- **WHEN** a point one torso length ahead in the direction of travel is projected at yaw 0, zoom 1
- **THEN** it lands one unit to screen right of the target

#### Scenario: Front view
- **WHEN** a point on the runner's left is projected at yaw 90
- **THEN** it lands to screen right of the target

#### Scenario: Turning from 350° to 10°
- **WHEN** the camera is interpolated halfway from yaw 350° to yaw 10°
- **THEN** its yaw is 0°, not 180°

#### Scenario: Each preset frames its subject
- **WHEN** the neutral runner is projected through a preset
- **THEN** the joints that preset focuses on lie within the documented frame half-height

### Requirement: The model-runner core is pure and leaves measurement untouched

The model-runner modules SHALL be pure functions and constants with no React, DOM or I/O
dependency, and SHALL NOT change any measurement, threshold or heuristic. They SHALL read the
heuristics only through their result types.

#### Scenario: Adding the model runner changes no measurement
- **WHEN** the model-runner modules are added
- **THEN** no file under `src/heuristics/` changes and every existing measurement test passes unchanged
