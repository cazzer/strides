## MODIFIED Requirements

### Requirement: An orthographic camera turns, zooms and interpolates continuously

The system SHALL project model joints orthographically through a camera with yaw, pitch, zoom and a
target, into SVG-oriented screen coordinates with the target at the origin and a depth for draw
order. Yaw 0 SHALL be the side view with travel toward screen right, and yaw 90 the front view with
the runner's left on screen right. The system SHALL provide the presets `wholeBodySide`,
`upperFrontQuarter`, `torsoSide`, `legsSide`, `footSide`, `feetFront` and `landingSide`, and
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

The contact marks SHALL meet the points their metrics read, which are ankles, not heels: the
overstride offset's guides SHALL be plumb lines from hip-mid and from the contact ankle down to the
offset, and the foot-strike offset SHALL run at ankle height from under the knee (a plumb from the
knee) to the contact ankle. The foot-strike label SHALL hang under the contact keypoint: the heel
when the foot lands heel-down, the toe on a forefoot strike. Labels hanging below the ground (the
ground lane) SHALL NOT overlap: two or more SHALL share the lane's lowest anchor height and stack in
focus order as one block, centred on the first label's anchor.

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
- **WHEN** foot strike is in focus with a heel-down landing, and the runner holds the contact
- **THEN** the foot-strike offset ends at the live contact ankle, and its label hangs under the live heel; on a forefoot strike it hangs under the live toe

#### Scenario: Overstride and foot-strike labels stack
- **WHEN** overstriding and foot strike are both in focus
- **THEN** both labels share one centre and lane height, the second's first line at least a line pitch below the first's last line

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
