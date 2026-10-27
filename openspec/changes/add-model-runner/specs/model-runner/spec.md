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

The model-runner core modules (`types`, `gaitModel`, `runnerParams`, `camera`, `runnerScene` and
`runnerAnnotations`) SHALL be pure functions and constants with no React, DOM or I/O dependency,
and SHALL NOT change any measurement, threshold or heuristic. They SHALL read the heuristics only
through their result types and the results view's value formatter. `ModelRunner.tsx` and `usePrefersReducedMotion.ts` SHALL be the only
model-runner modules that depend on React or the DOM (the dev-only sandbox under `src/runner/dev/`
aside, which is never bundled).

#### Scenario: Adding the model runner changes no measurement
- **WHEN** the model-runner modules are added
- **THEN** no file under `src/heuristics/` changes and every existing measurement test passes unchanged

### Requirement: The model runner renders measured parts solid and neutral parts dashed grey

The renderer SHALL draw every skeleton edge, solid when the edge is measured and dashed grey when it
is neutral, with joints as dots. Overridden sources (the intro beat's seam) SHALL take the place of
the bound ones; without overrides the renderer SHALL draw exactly the bound parameter values and
sources. A value tween passed through the seam SHALL be interpolated by the animation loop without
re-rendering React, and SHALL end exactly at its target values. The ground SHALL be drawn at the
lowest foot point over the cycle, as an illustrative reference.

#### Scenario: Only knee drive is measured
- **WHEN** the runner is rendered with only `kneeDrive` measured
- **THEN** both thighs are drawn without a dash array and every other edge is dashed

#### Scenario: An override turns a part neutral
- **WHEN** every parameter's source is overridden to neutral
- **THEN** every edge is dashed

### Requirement: The focus area is accented and annotated with its metric's own value

Edges shaped by a measured focus parameter SHALL be accented, by a wider stroke as well as a hue,
with the other measured parts receding; measured parts SHALL never be dimmed so far that they read
as neutral, and neutral dashes SHALL never be dimmed. In forced-colours mode measured, neutral and
focus parts SHALL use distinct system colours. Each measured focus parameter except
cadence SHALL carry an annotation of its natural kind (an angle arc for trunk lean, knee drive and
knee flexion; a vertical bracket for bounce and arm swing; a horizontal offset for overstride, foot
strike, step width and swing-foot excursion), whose geometry is the drawn value exactly and whose
label is the metric's own reported value in the guided card's format. A clamped value's label SHALL
say it is shown approximately. A limb annotation SHALL be built on the pose its metric reads (its
key phase) and SHALL lie on the live figure's limb whenever the figure is at that phase; no
second, limb-shaped figure SHALL be drawn. While the figure is still, a limb mark whose key phase is
not the held phase SHALL NOT be drawn (its value stays in the text alternative); while the figure
plays, every mark SHALL be drawn. A focus metric that drives no parameter SHALL be
ignored, and two focus metrics driving one parameter SHALL give one annotation.

#### Scenario: Trunk lean is annotated
- **WHEN** trunk lean is measured at 5° and in focus
- **THEN** the torso is accented and an arc sweeping 5° is labelled "5.0°"

#### Scenario: A clamped foot strike says so
- **WHEN** overstriding is measured at 0.05 and foot strike at 0.10, with foot strike in focus
- **THEN** the foot-strike label reads its class and "shown approximately", and the text alternative says it is drawn at a limit of the figure, not at the measured value

#### Scenario: A second keyed focus does not float
- **WHEN** knee drive and knee flexion are both in focus and the runner is still
- **THEN** only the knee-drive arc is drawn, and the knee-flexion arc appears once the runner plays

#### Scenario: The annotated limb is the live limb
- **WHEN** knee drive is in focus and the runner is still
- **THEN** the arc's centre is the live near hip and its end lies on the live near thigh

#### Scenario: An unmeasured focus is not annotated
- **WHEN** a focus parameter is neutral
- **THEN** it carries no annotation and no accent

### Requirement: The runner animates at most thirty frames a second and only while seen

The renderer SHALL animate from a single requestAnimationFrame loop that writes geometry to the
rendered elements without re-rendering React, draws at most thirty times a second, and integrates
phase at cadence / 120 cycles a second times the playback rate. The loop SHALL stop while the
document is hidden or the figure is off screen, and resume without a jump.

#### Scenario: A hidden tab
- **WHEN** the document becomes hidden
- **THEN** no animation frame is pending and the pose is frozen until it is visible again

#### Scenario: Scrolled offscreen
- **WHEN** the figure stops intersecting the viewport
- **THEN** no animation frame is pending until it intersects again

#### Scenario: Cadence changes mid-run
- **WHEN** the bound cadence changes while the runner plays
- **THEN** the drawn pose does not jump

### Requirement: Camera changes tween, except under reduced motion

A camera change SHALL tween from the current camera to the new one over about 600 ms, including
while paused. Under reduced motion, or while the figure is hidden or off screen, it SHALL cut.

#### Scenario: A camera change tweens
- **WHEN** the camera changes without reduced motion
- **THEN** joints are between the two projections at 300 ms and at the new projection after the tween

#### Scenario: Reduced motion cuts
- **WHEN** the camera changes under reduced motion
- **THEN** the new projection is drawn immediately with no animation frame pending

### Requirement: An inline pause control is always available and remembered

The renderer SHALL show a pause/play button outside the hidden drawing at every width. The reader's
choice SHALL persist for the component's lifetime, across focus and camera changes.

#### Scenario: Pausing persists across focus and camera changes
- **WHEN** the reader pauses and the focus and camera then change
- **THEN** the button still offers "Play runner" and the phase stays frozen

### Requirement: Reduced motion holds a still pose

Under reduced motion the runner SHALL NOT autoplay; it SHALL hold a still pose until the reader
presses play. The still pose (under reduced motion, while paused, and on the first frame) SHALL be
the key phase of the first focus parameter that has one, so that limb lies exactly on its
annotation, and mid-stance otherwise. The key phase SHALL be taken on the same leg in every
camera (the leg a side view shows nearer), so a camera change never moves the still pose. A still
figure SHALL move to a new focus's still pose, and reduced motion switching on while the reader has
not chosen to play SHALL stop the figure at its still pose.

#### Scenario: Reduced motion on load
- **WHEN** the runner mounts with reduced motion preferred and no keyed focus
- **THEN** it draws the mid-stance pose, offers "Play runner", and stays still until played

#### Scenario: Reduced motion with an overstride focus
- **WHEN** the runner mounts with reduced motion preferred and overstriding in focus
- **THEN** it holds the near leg at contact, with the offset mark ending at the live ankle

### Requirement: The runner is described in text and captioned honestly

The drawing SHALL be hidden from assistive technology, and a visually hidden text alternative SHALL
name which parameters were measured, which are fixed illustrative settings, and each measured focus
value. The figure SHALL carry its accessible name from a prop and the caption "Model built from
your numbers". No text SHALL call the runner a reference, an ideal or the reader's body.

#### Scenario: Text alternative
- **WHEN** only cadence and trunk lean are measured and trunk lean is in focus
- **THEN** the text alternative begins "Measured from your clip: Cadence, Trunk lean." and states "Shown: Trunk lean 5.0°."

### Requirement: The runner adopts the reader's gait in a short intro, once per result

When a result is first shown and the runner is first seen (tab visible and figure on screen), the
runner SHALL hold fully neutral (every part dashed grey, every measured parameter at its neutral
constant, legend "Dashed: not applied yet") for about 500 ms, and then apply the measured
parameters one at a time: the focus-area parameters first in focus order, the rest in parameter
order, landing always before foot strike. Each step SHALL last 4.5 s divided by the number of
steps, bounded to 450–1000 ms, so the steps take at most about 4.5 s after the hold. Each
parameter SHALL tween from its neutral constant to its bound value, its part SHALL turn solid as
the tween starts, its value SHALL flash for about 500 ms beside a fixed point of its part (not
following the stride, clear of visible annotation labels), and its own focus annotation SHALL be
hidden while it tweens. A parameter whose change cannot be seen from the camera (step width and
swing-foot arc from a side view) SHALL get no step and no flash; it is applied with the final
state. Unmeasured parameters SHALL be drawn at their bound values throughout and never change. At
the end every measured parameter SHALL be drawn at exactly its bound value and an `onDone`
callback SHALL fire once. The motion SHALL run in the renderer's loop, with no React commit per
frame. The order, values and step length SHALL be fixed when the first step begins, so a result
updated mid-intro cannot shift the steps; the final state draws the current result.

A visible "Skip intro" button (at least 44 px) SHALL sit beside the pause control while the intro
runs. Skipping, or pressing Pause, SHALL jump to the final state and fire `onDone` once. When the
Skip button goes away while it holds focus, focus SHALL move to the pause control. Under reduced
motion the intro SHALL NOT start: the final state is drawn at once, no Skip button is shown, and
`onDone` fires once.

The intro SHALL play once per result, keyed on an analysis-run or session id: a remount with the
same id SHALL draw the final state at once and SHALL NOT fire `onDone` again; a new id SHALL play
it. An intro that never started because the runner was never seen SHALL NOT count as played.
StrictMode's simulated remount SHALL NOT count as played.

#### Scenario: Parameters are applied in focus order
- **WHEN** cadence, trunk lean, knee flexion and overstriding are measured and knee flexion then overstriding are in focus
- **THEN** after the neutral hold the swing-knee bend, landing offset, cadence and torso pitch are applied in that order, each tween ends at exactly its bound value, and no unmeasured parameter's value or style changes at any step

#### Scenario: Lateral parameters from a side view
- **WHEN** step width is measured and the camera is a side view
- **THEN** step width gets no step and no flash, stays neutral during the intro, and is drawn at its bound value in the final state

#### Scenario: Skip or Pause
- **WHEN** the reader presses "Skip intro" or Pause mid-intro
- **THEN** the runner draws exactly the bound parameters, the Skip button is gone, and `onDone` has fired once; after Skip, focus is on the pause control; after Pause, the figure is still

#### Scenario: Reduced motion
- **WHEN** the runner mounts with reduced motion preferred
- **THEN** it draws the bound parameters at once, shows no Skip button, and fires `onDone` once

#### Scenario: Not seen
- **WHEN** the runner mounts in a hidden tab or off screen
- **THEN** it holds the neutral start and the intro begins only once it is seen; if it is unmounted before then, a later mount for the same result plays the intro

#### Scenario: Plays once per result
- **WHEN** the runner remounts for a result whose intro already played
- **THEN** it draws the final state at once without firing `onDone`; a different result plays the intro again
