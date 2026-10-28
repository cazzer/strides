# model-runner Specification

## Purpose
A procedural stick-figure runner drawn from the reader's own numbers: every degree of freedom is
bound to exactly one measured value or held at a documented, dashed-grey neutral constant, with an
orthographic camera, a short adopt-your-gait intro and reduced-motion handling, and no effect on
any measurement.
## Requirements
### Requirement: The model runner is a seamless procedural gait cycle over the nineteen pose joints

The system SHALL provide a pure function `poseAt(phase, params)` that returns one 3D joint for each
of the nineteen `COMMON_KEYPOINT_NAMES`, in that order, for any real `phase`, where one unit of
phase is one full gait cycle (left contact at 0, right contact at 0.5). The pose SHALL be
continuous in phase, SHALL be identical at phase 0 and phase 1, and every skeleton segment's length
SHALL be constant over the cycle. The second half-cycle SHALL be the first mirrored. The body
proportions SHALL be fixed and documented as illustrative. The stance leg SHALL be solved by
inverse kinematics so the stance foot stands on the ground (see "The stance foot stands on the
ground, and the bindings outrank it"); the swing leg SHALL follow keyframe curves.

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
documented set of joints unchanged, apart from one whole-figure vertical shift per phase that keeps
the runner standing on the ground: those joints' forward and lateral coordinates SHALL stay
bit-identical, and their heights SHALL differ only by that one shared shift. No metric reads
absolute height, so the shift moves no binding. Cadence, torso pitch, arm swing and swing-foot arc
do not change the figure's height, so every joint outside their sets SHALL stay bit-identical.
Pelvis bounce SHALL move the legs as well as the shared shift, because the stance leg's solve
depends on the hips' height through stance. Cadence SHALL change only the cycle rate.

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
`upperFrontQuarter`, `armsQuarter`, `torsoSide`, `legsSide`, `footSide`, `feetFront` and
`landingSide`, and
`interpolateCamera(a, b, t)` SHALL return `a` at t = 0 and `b` at t = 1, take yaw the shorter way
round, and move every projected joint continuously in t.

`landingSide` SHALL be a contact-tracking side view: `landingCamera(values)` frames, for one
parameter set, hip-mid and the near (right) leg's knee, ankle, heel and toe through the landing
phase window around that leg's contact, with the span from just above hip-mid's highest point in
that window to below the ground (room for the ground-lane labels) inside the frame's height. The preset itself SHALL be
the neutral parameters' landing frame; the renderer SHALL reframe it on the values it draws.

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

#### Scenario: The landing camera frames the landing at any landing offset
- **WHEN** the runner, with its landing offset anywhere from −0.3 to 0.7 torso lengths or its bounce at the top of its range, is projected through `landingCamera` of its own values at any phase of the landing window
- **THEN** hip-mid and the near knee, ankle, heel and toe lie inside the frame's half-width and half-height

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

### Requirement: The stance foot stands on the ground, and the bindings outrank it

The figure's height SHALL be solved per parameter set so that the contact foot's lowest point
(ankle, heel or toe) is exactly on the ground (y = 0). Through stance, from contact to toe-off, the
stance leg SHALL be solved so that the foot's lowest point stays on the ground: within numerical
precision at the neutral parameters, and within 0.01 torso lengths over the declared realistic
domain (landing offsets up to 0.3 torso lengths, which is the neutral overstride, every other leg
parameter across its realistic spread) and at every range corner with the landing offset at its lower end. The bound values SHALL
outrank the pin: where a parameter set cannot keep the foot down without breaking a binding (very
large landing offsets), the mid-stance foot SHALL give way by a bounded amount, every bound value
SHALL still read back exactly, and the contact foot SHALL still stand exactly on the ground. The
figure SHALL never be raised so that the contact foot floats.

#### Scenario: The neutral stance foot is planted through stance
- **WHEN** the neutral runner is sampled from contact to toe-off
- **THEN** the stance foot's lowest point is at y = 0 at every sample, to within numerical precision

#### Scenario: Contact is on the ground for every parameter set
- **WHEN** the runner is drawn at contact for any parameter set, including every range corner
- **THEN** the contact foot's lowest point is at y = 0

#### Scenario: Undrawable geometry gives way while bound values read back exactly
- **WHEN** the landing offset is bound to 0.7 torso lengths, at any corner of the other leg parameters
- **THEN** every bound value reads back exactly, the contact foot is on the ground, and the mid-stance foot is at most 0.19 torso lengths from it

#### Scenario: Still frames show a planted foot
- **WHEN** the renderer holds a still frame at mid-stance or at any limb parameter's key phase, at the neutral parameters
- **THEN** one foot stands on the ground

### Requirement: The model runner renders measured parts solid and neutral parts dashed grey

The renderer SHALL draw every skeleton edge, solid when the edge is measured and dashed grey when it
is neutral, with joints as dots. Overridden sources (the intro beat's seam) SHALL take the place of
the bound ones; without overrides the renderer SHALL draw exactly the bound parameter values and
sources. A value tween passed through the seam SHALL be interpolated by the animation loop without
re-rendering React, and SHALL end exactly at its target values. The ground SHALL be drawn at
y = 0, the plane the stance foot stands on.

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
focus parts SHALL use distinct system colours. Each measured focus parameter SHALL carry an
annotation of its natural kind (an angle arc for trunk lean, knee drive and knee flexion; a
vertical bracket for bounce and arm swing; a horizontal offset for overstride, foot strike, step
width and swing-foot excursion; a footfall beat for cadence), whose geometry is the drawn value
exactly and whose label is the metric's own reported value in the guided card's format, except
that the foot-strike label names its class as the part of the foot that lands first, as an
estimate ("Heel first (estimate)", "Midfoot first (estimate)", "Forefoot first (estimate)"),
classed exactly as the card classes it. A clamped value's label SHALL say it is shown
approximately. A limb annotation SHALL be built on the pose its metric reads (its key phase) and
SHALL lie on the live figure's limb whenever the figure is at that phase; no second, limb-shaped
figure SHALL be drawn. While the figure is still, a limb mark whose key phase is not the held phase
SHALL NOT be drawn (its value stays in the text alternative); while the figure plays, every mark
SHALL be drawn. A focus metric that drives no parameter SHALL be ignored, and two focus metrics
driving one parameter SHALL give one annotation.

The contact marks SHALL meet the points their metrics read, which are ankles, not heels: the
overstride offset's guides SHALL be plumb lines from hip-mid and from the contact ankle down to the
offset, and the foot-strike offset SHALL run at ankle height from under the knee (a plumb from the
knee) to the contact ankle. When it is the ground lane's only label, the foot-strike label SHALL hang
under the contact keypoint: the heel when the foot lands heel-down, the toe on a forefoot strike. Labels hanging below the ground (the
ground lane) SHALL NOT overlap: two or more SHALL share the lane's lowest anchor height and stack in
focus order as one block, centred on the first label's anchor, with half a line of extra space
between consecutive labels so a stacked label never reads as the previous one's continuation.

The step-width offset SHALL run below the ground from the midline to the contact ankle's lateral
position, and its guides SHALL meet both feet: a midline plumb from hip-mid down past the offset,
and a tick rising to the ground under each foot's planted position, so that in the front view each
foot, while planted, stands exactly above its tick.

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

#### Scenario: The overstride guides meet hip-mid and the contact ankle
- **WHEN** overstriding is in focus and the runner holds the contact
- **THEN** one guide starts at the live hip-mid and the other at the live contact ankle, both dropping to the offset

#### Scenario: The foot-strike label hangs at the heel
- **WHEN** foot strike is the only ground-lane label in focus, with a heel-down landing, and the runner holds the contact
- **THEN** the foot-strike offset ends at the live contact ankle, and its label hangs under the live heel; on a forefoot strike it hangs under the live toe

#### Scenario: Overstride and foot-strike labels stack
- **WHEN** overstriding and foot strike are both in focus
- **THEN** both labels share one centre and lane height, the second's first line one and a half line pitches below the first's last line

#### Scenario: The step-width guides meet both feet
- **WHEN** step width is in focus on the `feetFront` camera, at any step width and swing-foot arc
- **THEN** the offset is exactly |step width| × hip width long, the midline guide starts at the live hip-mid, and every planted ankle of either foot stands exactly above a tick whose top is on the ground

#### Scenario: The foot-strike label names the first contact
- **WHEN** foot strike is measured at 0.2 (heel), 0.02 (midfoot) or −0.2 (forefoot) and in focus
- **THEN** its label reads "Heel first (estimate)", "Midfoot first (estimate)" or "Forefoot first (estimate)", and the text alternative states the same words

### Requirement: The runner animates at most thirty frames a second and only while seen

The renderer SHALL animate from a single requestAnimationFrame loop that writes geometry to the
rendered elements without re-rendering React, draws at most thirty times a second, and integrates
phase at cadence / 120 cycles a second times the playback rate. The loop SHALL stop while the
document is hidden or the figure is off screen, and resume without a jump.

While the camera is `landingSide`, playback SHALL loop a window of the cycle around the near leg's
contact (late swing into early stance) at the playback rate given, starting again from the
window's start each time it passes its end. Each pass SHALL rest on the exact contact frame for
about 300 ms of wall-clock time, and briefly on the window's last frame before starting again;
playback SHALL only move forward, never back through the window. The rests SHALL NOT lift the
thirty-frame cap. A figure outside the window when the camera changes to
`landingSide` SHALL play on into it without a jump, and leaving `landingSide` SHALL let the phase
run round the whole cycle again from where it is. A change of the drawn values that moves the
contact SHALL reframe the landing camera like any camera change.

#### Scenario: A hidden tab
- **WHEN** the document becomes hidden
- **THEN** no animation frame is pending and the pose is frozen until it is visible again

#### Scenario: Scrolled offscreen
- **WHEN** the figure stops intersecting the viewport
- **THEN** no animation frame is pending until it intersects again

#### Scenario: Cadence changes mid-run
- **WHEN** the bound cadence changes while the runner plays
- **THEN** the drawn pose does not jump

#### Scenario: The landing camera loops the contact
- **WHEN** the runner plays with the camera at `landingSide` at 0.4×
- **THEN** every drawn phase lies inside the landing window, and the loop passes through the near leg's contact again and again

#### Scenario: Each landing loop rests on the contact
- **WHEN** the runner plays with the camera at `landingSide`
- **THEN** once per loop the drawn pose is exactly the contact pose for about 300 ms, and no more than thirty frames a second are drawn

#### Scenario: Entering the landing window
- **WHEN** the runner plays with the camera at `landingSide` from a phase outside the landing window
- **THEN** every frame steps the phase a little forward until it is inside the window

#### Scenario: Leaving the landing camera
- **WHEN** the camera changes from `landingSide` to another preset while the runner plays
- **THEN** the phase continues without a jump and runs outside the landing window again

#### Scenario: A bound landing change reframes
- **WHEN** the bound overstride changes while the camera is `landingSide`
- **THEN** the camera tweens to the landing frame of the new values

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
annotation, and otherwise the near leg's contact while the camera is `landingSide`, and mid-stance
otherwise. While the camera is `landingSide`, every still state (paused included, wherever in the
landing loop the reader pauses) SHALL show that still pose, so the contact marks always meet the
drawn leg. The key phase SHALL be taken on the same leg in every
camera (the leg a side view shows nearer), so a camera change never moves the still pose. A still
figure SHALL move to a new focus's still pose, and reduced motion switching on while the reader has
not chosen to play SHALL stop the figure at its still pose.

#### Scenario: Reduced motion on load
- **WHEN** the runner mounts with reduced motion preferred and no keyed focus
- **THEN** it draws the mid-stance pose, offers "Play runner", and stays still until played

#### Scenario: Reduced motion with an overstride focus
- **WHEN** the runner mounts with reduced motion preferred and overstriding in focus
- **THEN** it holds the near leg at contact, with the offset mark ending at the live ankle

#### Scenario: Reduced motion on the landing camera
- **WHEN** the runner mounts with reduced motion preferred and the camera at `landingSide`, with a landing focus, a focus with no key phase, or none
- **THEN** it holds the near leg's contact with that foot's lowest point on the drawn ground, and no animation frame is pending

#### Scenario: Pausing on the landing camera
- **WHEN** the reader pauses the runner partway through a landing loop
- **THEN** the figure stands at the contact, with the overstride's ankle plumb starting at the drawn ankle

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
steps, bounded to 450–1000 ms, so the steps take at most about 4.5 s after the hold (about 5 s
in all, deliberately). Each
parameter SHALL tween from its neutral constant to its bound value, its part SHALL turn solid as
the tween starts, its value SHALL flash for about 500 ms (the whole step when under 150 ms of it would remain)
beside a fixed point of its part (not following the stride, clear of visible annotation labels,
marks and guides, the lean value on the torso's back side), and its own focus annotation SHALL be
hidden while it tweens. A parameter whose change cannot be seen from the camera (step width and
swing-foot arc from a side view) SHALL get no step and no flash; it is applied with the final
state. Unmeasured parameters SHALL be drawn at their bound values throughout and never change. At
the end every measured parameter SHALL be drawn at exactly its bound value and an `onDone`
callback SHALL fire once. The motion SHALL run in the renderer's loop, with no React commit per
frame. The order, values and step length SHALL be fixed when the first step begins, so a result
updated mid-intro cannot shift the steps or change any drawn value; the final state draws the
current result. With nothing to apply, the intro SHALL finish at once, with no hold.

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

### Requirement: Cadence is drawn as a footfall beat at the drawn cadence

A measured cadence in focus SHALL be labelled with its reported steps per minute just above the
head, with a short tick under each foot's contact point on the ground. Cadence is keyed on a
footfall: when it is the first keyed focus, the still frame SHALL hold the near foot's contact, so
that foot stands planted on its tick. While the figure plays, reduced motion is not preferred and
the camera plays the whole cycle (not the landing window, whose contact hold would freeze a ring),
a ring SHALL flash at each foot's contact point at that foot's contact phase: largest and opaque
at contact, shrinking as it fades, gone within a quarter of a cycle, with that foot's tick flashing
in the accent at the same strength, so the rings beat once per drawn footfall, at the drawn cadence
times the playback rate per minute. The label SHALL always state the measured cadence, never the
playback-scaled one. Paused, or whenever reduced motion is preferred (even after the reader presses
play), no ring SHALL be drawn; the label and ticks remain. The ring SHALL be written by the animation loop without a React
commit per frame, SHALL use the focus accent (never a saturated red; the system highlight colour in
forced-colours mode), and SHALL stay far below the WCAG 2.3.1 general-flash area threshold at every
runner size. The cadence ticks stay on the ground, and its label follows the figure's height, while
an intro tween changes the figure's standing height.

#### Scenario: The beat follows the footfalls
- **WHEN** cadence is measured at 180 steps/min and in focus, playing at 1× for 10 seconds
- **THEN** the rings start 30 ± 1 times, each one at a foot's contact point as that foot lands

#### Scenario: Slow motion slows the beat, not the number
- **WHEN** the same runner plays at 0.4× for 10 seconds
- **THEN** the rings start 12 ± 1 times, and the label still reads "180 steps/min"

#### Scenario: Reduced motion beat
- **WHEN** cadence is in focus with reduced motion preferred
- **THEN** the near foot stands planted on the ticks, the label and both ticks are drawn, no ring is drawn even after the reader presses play, and no animation frame is pending while still

#### Scenario: Paused beat
- **WHEN** the reader pauses a runner with cadence in focus
- **THEN** the rings disappear and the label and ticks stay; pressing play brings the rings back

#### Scenario: No beat on the landing camera
- **WHEN** cadence is in focus and the camera is `landingSide`, playing
- **THEN** the label and ticks are drawn and no ring is drawn

### Requirement: The runner's bounce plays smoothly at thirty frames a second

Drawn at 30 frames a second at a cadence of 150, 174 or 190 steps a minute, from any start phase,
the hips' largest change in height between two consecutive frames SHALL be at most 1.3 times that
of a sinusoidal bounce of the same peak-to-peak size, for every pelvis bounce up to 0.22 torso
lengths; at most 1.6 times for a bounce of 0.25 or 0.3; and at most 1.9 times for a bounce of 0.4
or 0.5. Over twelve consecutive steps, the spread of each step's highest drawn hip height SHALL be
at most 0.12 of the bounce for every bounce up to 0.3, and at most 0.13 of it for a bounce of 0.4
or 0.5. The hips SHALL be lowest at mid-stance, halfway through stance, and highest a quarter cycle
later, midway between toe-off and the other foot's contact; for a bounce small enough that the
planted leg absorbs it, they SHALL sit at contact and toe-off at the height a sinusoid of the same
size would. Between those keys the path is eased, close to a sinusoid but not one, and is held to
the per-frame bounds above.

#### Scenario: A typical bounce moves like a sinusoid
- **WHEN** the runner with a pelvis bounce of 0.14 torso lengths is drawn at 30 fps at 174 steps a minute
- **THEN** no frame-to-frame hip change exceeds 1.3 times a sinusoid's, and the step peaks spread by at most 0.12 of the bounce

#### Scenario: A large bounce spreads its flight over several frames
- **WHEN** the runner with a pelvis bounce of 0.3 torso lengths is drawn at 30 fps at 150, 174 or 190 steps a minute
- **THEN** no frame-to-frame hip change exceeds 1.6 times a sinusoid's, and the step peaks spread by at most 0.12 of the bounce

#### Scenario: The hips peak midway through flight
- **WHEN** the neutral runner is sampled over one step
- **THEN** its hips are highest midway between toe-off and the other foot's contact, a quarter cycle after mid-stance

### Requirement: Every limb key phase falls while the other foot is planted

Each swing-side key phase a limb annotation or still frame is held on (the thigh peak, the swing
knee's peak bend and the middle of the swing-foot arc) SHALL fall while the other leg is in stance,
and the swing-foot arc SHALL start no earlier than toe-off.

#### Scenario: The knee-drive still frame has a foot down
- **WHEN** the neutral runner is held at the thigh peak's key phase
- **THEN** the other leg is in stance and its foot stands on the ground

### Requirement: The swing thigh moves steadily from toe-off to its peak

From toe-off to the thigh peak, the swing thigh SHALL start and end at rest, so the peak stays the
thigh's maximum, and over the middle 80% of that span SHALL never move slower than a quarter of its
mean speed over the span. Drawn at 30 frames a second at 190 steps a minute, at the neutral
parameters, the thigh SHALL move at most 14.42 degrees between two frames (the largest step before
this change, 13.11, plus 10%).

#### Scenario: No stall in early swing
- **WHEN** the runner's thigh is sampled from toe-off to its peak at a thigh peak of 15°, the neutral value or 85°
- **THEN** between 10% and 90% of the span its speed never falls below a quarter of its mean

### Requirement: A still figure stands on the ground

While the figure is still (reduced motion before the reader plays it, or paused), the renderer SHALL
raise the whole drawn figure by however far its lowest foot point sits below the ground, so a held
frame past the pin's declared domain never shows a foot under the ground. Marks that hang off the
figure SHALL rise with it; marks on the ground (landing, step width, cadence ticks) SHALL stay on
it. The lift SHALL be dropped as soon as the figure plays (a snap is acceptable). No metric reads
absolute height, so every bound value still reads back exactly.

#### Scenario: The knees stop on a large overstride
- **WHEN** reduced motion holds the knee-flexion frame of a runner whose landing offset is 0.512
- **THEN** the drawn lowest foot point is on the ground line, and the knee-flexion mark rides the figure

#### Scenario: Pausing mid-stance
- **WHEN** the reader pauses a runner whose stance foot is below the ground at that phase
- **THEN** the whole figure rises rigidly until its lowest foot is on the ground, the cadence ticks stay put and the head label rises with the figure

### Requirement: A still figure can show its measured moment's evidence image behind it, faintly

The renderer SHALL accept an optional footage source: an evidence canvas (the metric's evidence
image as its card shows it: the measured moment and, for a paired metric, a fainter second moment
ghosted over it), the metric it was measured for, the measured moment's joints in the image's unit
square, the measured side, whether the clip runs right to left, and a text note. While the figure
is still (paused, or under reduced motion before the reader plays it) at its held phase, with no
camera tween and no value tween running, and that held phase is the footage metric's own key leg
phase on the held leg, the renderer SHALL draw a greyscale copy of the canvas's pixels as the
drawing's first element, under the ground and the figure, at 0.26 opacity, fading in (on its first
appearance too) and out over 240 ms, with no transition under reduced motion, and SHALL NOT draw it
under forced colours. The copy SHALL be made from the canvas's pixels only while the figure is
still, SHALL never move or draw into the source canvas, and SHALL be released when the source
changes or the runner unmounts.

The plate SHALL be placed by a similarity transform only: one uniform scale, a translation, and a
horizontal mirror for a right-to-left clip; never a rotation, shear or per-joint warp. The measured
moment's hip-mid SHALL land on the drawn hip-mid, and the scale SHALL be the ratio of the drawn to
the footage's summed hip-mid → knee → ankle lengths (hip-mid → ankle where the knee is missing;
feet excluded), over the legs the footage has, the measured side's joints compared with the drawn
held (near) leg. It SHALL be computed from the pose as drawn, every still draw. While hidden the
plate SHALL keep its last placement rather than follow the figure. A placement whose image side
exceeds 2.5 drawing widths SHALL NOT be shown (the subject was small in its crop, and magnified the
photograph and its baked-in marks become clutter).

#### Scenario: A reduced-motion knees stop over a side clip
- **WHEN** the runner mounts under reduced motion on the legs camera with knee flexion in focus and knee-flexion footage, and the copy is ready
- **THEN** the plate is the drawing's first element, greyscale, shown at 0.26, and its transform is the hip-anchored, segment-length-scaled fit over the drawn joints

#### Scenario: A right-to-left clip
- **WHEN** the footage's clip runs right to left
- **THEN** the plate's horizontal scale is the negative of its vertical scale

#### Scenario: Play hides it
- **WHEN** the reader presses Play while the plate shows
- **THEN** the plate fades out where it is, and shows again, without a second copy, when the reader pauses

#### Scenario: A camera tween hides it until the camera rests
- **WHEN** the camera changes while the figure is paused with the plate shown
- **THEN** the plate is hidden while the camera tweens and shown, refitted, once it rests

#### Scenario: No plate without a copy, a matching key phase, footage or a legible scale
- **WHEN** the copy is not ready yet, the canvas cannot be read back, no footage is passed, the footage's metric is keyed to a different leg phase than the held one, forced colours are active, or the fit would make the image wider than 2.5 drawing widths
- **THEN** no plate shows

#### Scenario: The fit never reshapes the footage
- **WHEN** the footage's knee is bent further than the model's, with the same thigh and shank lengths
- **THEN** the scale and the hip anchor are unchanged and the footage's ankle stays where the footage has it

### Requirement: Pausing with a limb focus stands the figure at its key phase

When the reader pauses a runner whose focus includes a limb parameter with a key leg phase (any
annotation other than the cadence beat), the figure SHALL stand at its held phase, so the limb lies
on its mark, as it does on the landing camera. A runner whose only keyed focus is the cadence beat
SHALL pause where it is.

#### Scenario: Pausing mid-cycle with knee flexion in focus
- **WHEN** the reader pauses a playing runner on the legs camera with knee flexion in focus
- **THEN** the figure stands at the near leg's peak swing knee bend, with the knee arc's centre on the drawn knee

#### Scenario: Pausing a cadence beat
- **WHEN** the reader pauses a playing runner with cadence in focus
- **THEN** the figure stays at the phase it was at, lifted onto the ground

### Requirement: The footage plate is named in the legend and the text alternative while it is on offer

While the footage plate is on offer (its copy ready, the figure still, its key phase the held one,
the placement within the clutter cap, forced colours off), the runner's legend row SHALL show the
line "Faint photo: your clip, not a target", followed by " · flipped" when the image is mirrored,
and its visually hidden text alternative SHALL end with the footage's note, which SHALL name the
metric's evidence image as the measured moment, say "with a fainter second moment over it" when the
image is ghosted and that it is flipped when mirrored, and say it is the reader's footage, not a
target. While the figure plays, or with no plate on offer, both SHALL be absent.

#### Scenario: Offered, then playing
- **WHEN** the plate is on offer and the reader then presses Play
- **THEN** the legend line and the note are present while it is on offer and gone while the figure plays

#### Scenario: A mirrored image
- **WHEN** the plate on offer is mirrored
- **THEN** the legend line reads "Faint photo: your clip, not a target · flipped"

#### Scenario: Refused by the clutter cap
- **WHEN** the fit would make the image wider than 2.5 drawing widths
- **THEN** neither the legend line nor the note is present

### Requirement: The arm sweeps fore and aft past the trunk, its wrist travel exactly the measured value

The runner's arm SHALL swing as a rigid bent unit about the shoulder, about a shoulder→wrist centre
of 33° forward of vertical, so that at typical values the upper arm passes behind the trunk line on
the backswing. Where a swing symmetric about that centre would carry the wrist behind the shoulder,
the backswing SHALL instead be pinned with the wrist straight below the shoulder. In every case the
wrist SHALL never be behind the shoulder, and the peak-to-peak height of the wrist relative to the
shoulder SHALL be exactly the bound arm swing (the measurement's own formula read back to within
1e-9 torso lengths). The fore-aft sweep is illustrative, never a measurement or a target.

The arm swing's vertical bracket SHALL span exactly the drawn value, and its label SHALL sit above
the bracket's top end, centred on it, so that the label never covers the bracket and never hangs
below the bracket's foot, where a phone's stop panel overlays the figure.

#### Scenario: A front-view reading

- **WHEN** arm swing is bound to 0.33 at the neutral trunk lean
- **THEN** the upper arm runs about −25°…+15° from vertical, the elbow passes behind the trunk line
  on the backswing, and the wrist travels 0.33 torso lengths up and down

#### Scenario: A side-view reading

- **WHEN** arm swing is bound to 0.51
- **THEN** the upper arm runs about −37°…+27° from vertical and the wrist travels 0.51 torso lengths

#### Scenario: The largest drawable swing

- **WHEN** arm swing is bound to 0.9
- **THEN** the wrist is never behind the shoulder and travels 0.9 torso lengths

#### Scenario: The arms stop on a phone with a pinned swing

- **WHEN** the arms stop is shown at 390 px wide with arm swing bound to 0.5627
- **THEN** the bracket spans 0.5627 torso lengths, and both lines of its label sit above the
  bracket's top end and clear of the stop panel

