## MODIFIED Requirements

### Requirement: The focus area is accented and annotated with its metric's own value

Edges shaped by a measured focus parameter SHALL be accented, by a wider stroke as well as a hue,
with the other measured parts receding, except that the knee parameters SHALL accent only the leg
they are annotated on: knee flexion its thigh and shank (the two arms of the angle it measures),
knee drive its thigh; the other leg SHALL keep the figure's own style. An accented edge that no
measured parameter shapes SHALL stay neutral (dashed grey), never accented as if measured; measured parts SHALL never be dimmed so far that they read
as neutral, and neutral dashes SHALL never be dimmed. In forced-colours mode measured, neutral and
focus parts SHALL use distinct system colours. Each measured focus parameter SHALL carry an
annotation of its natural kind (an angle arc for trunk lean, knee drive and knee flexion; a
vertical bracket for bounce and arm swing; a horizontal offset for overstride, foot strike, step
width and swing-foot excursion; a footfall beat for cadence; for vertical ratio, a stride bracket
and a magnified bounce inset), whose geometry is the drawn value exactly and whose label is the
metric's own reported value in the guided card's format, except that knee flexion's label reads
the value followed by "bend" ("104.4° bend"), and the foot-strike label names
its class as the part of the foot that lands first, as an estimate ("Heel first (estimate)",
"Midfoot first (estimate)", "Forefoot first (estimate)"), classed exactly as the card classes it,
and vertical ratio's prints at its band's precision as the stop does. A clamped value's label
SHALL say it is shown approximately. A limb annotation SHALL be built on the pose its metric reads
(its key phase) and SHALL lie on the live figure's limb whenever the figure is at that phase; no
second, limb-shaped figure SHALL be drawn. While the figure is still, a limb mark whose key phase is
not the held phase SHALL NOT be drawn (its value stays in the text alternative); while the figure
plays, every mark SHALL be drawn. A focus metric that drives no parameter (`stepWidthCm`) SHALL be
ignored, and two focus metrics driving one parameter SHALL give one annotation. When vertical ratio
is annotated, the bounce's own true-scale bracket SHALL give way to vertical ratio's inset unless
the bounce heads the focus (its parameter is the focus's first), so the bounce is drawn once except
where it is the stop's headline.

Knee flexion SHALL be drawn as a bend from straight: a dashed straight-leg reference line running
from the knee straight on along the live thigh's direction, longer than the arc's radius and well
short of a shank (so it reads as a reference line, never as a second leg), and the arc from that
line onto the live shank, sweeping exactly the drawn knee bend; its label hangs past the line's end.

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

#### Scenario: The bounce gives way to vertical ratio's inset, except as the headline
- **WHEN** vertical ratio and the bounce are both in focus
- **THEN** only vertical ratio's marks are drawn when vertical ratio or another metric heads the focus, and both the bounce's true-scale bracket and the inset are drawn when the bounce heads it

#### Scenario: Knee flexion accents its own leg and reads from straight
- **WHEN** knee flexion is measured and in focus on a side camera
- **THEN** the near leg's thigh and shank are accented and the far leg's are not, a dashed line runs from the near knee straight on along its thigh, the arc runs from that line onto the shank sweeping the drawn value, and the label reads the card's value followed by "bend"

#### Scenario: Knee drive accents its own thigh
- **WHEN** knee drive is measured and in focus on a side camera
- **THEN** only the near thigh is accented

### Requirement: An orthographic camera turns, zooms and interpolates continuously

The system SHALL project model joints orthographically through a camera with yaw, pitch, zoom and a
target, into SVG-oriented screen coordinates with the target at the origin and a depth for draw
order. Yaw 0 SHALL be the side view with travel toward screen right, and yaw 90 the front view with
the runner's left on screen right. The system SHALL provide the presets `wholeBodySide`,
`upperFrontQuarter`, `armsQuarter`, `torsoSide`, `legsSide`, `footSide`, `feetFront`,
`landingSide` and `strideSide`, and
`interpolateCamera(a, b, t)` SHALL return `a` at t = 0 and `b` at t = 1, take yaw the shorter way
round, and move every projected joint continuously in t.

`landingSide` SHALL be a contact-tracking side view: `landingCamera(values)` frames, for one
parameter set, hip-mid and the near (right) leg's knee, ankle, heel and toe through the landing
phase window around that leg's contact, with the span from just above hip-mid's highest point in
that window to below the ground (room for the ground-lane labels) inside the frame's height. The preset itself SHALL be
the neutral parameters' landing frame; the renderer SHALL reframe it on the values it draws.

`strideSide` SHALL be a side view framed per parameter set and vertical ratio:
`strideCamera(values, ratio, framing)` frames the whole figure over its cycle, one drawn stride along
the ground ahead of the near foot's contact (whatever stride length is bound, never a fixed one),
the magnified bounce inset over it and, where it is drawn, the bounce's own bracket behind the hips,
with room for exactly the labels drawn (the cadence label above the head, vertical ratio's label
under the stride, the bounce's label beside its bracket) sized at the renderer's live scale plus a
small margin. It SHALL fill the drawing's whole visible frame (a drawing wider or taller than the
viewBox's 3:4 shows more than the viewBox) above its clear bottom: the share of the drawing's height,
at its bottom, that the page may cover, which a layout states on the runner (the phone tour: 15%,
where its stop panel may overlap the drawing; elsewhere none). The preset itself SHALL be the
neutral parameters' stride frame in the viewBox; the renderer SHALL reframe it on the values it
draws, the bound vertical ratio, the labels it draws and its drawing's visible frame. Labels SHALL be
kept inside the drawing's visible frame.

`wholeBodySide` SHALL likewise be reframed, once the renderer has measured its drawing, on the bound
values (not the intro's overrides, so the intro never moves the camera) and that drawing: the whole
figure over its cycle from the ground (or a stance foot that gives way below it) to the head, with
room for the cadence label above the head and for the footfall rings or ground-lane labels under the
ground where they are drawn, as large as fits above the clear bottom, centred there and on hip-mid's
line. Until the drawing is measured, and for a bare `resolveCamera('wholeBodySide')`, the preset
stands. Every whole-body view (the intro, the rhythm stop's opening, the one-thing stop, the
summary's runner with no row open) uses it.

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

#### Scenario: The stride camera frames the stride at any length
- **WHEN** the stride is anywhere in its drawable range and the bounce up to and past its drawable limit
- **THEN** the figure, the whole stride, the (capped) inset and the label pads lie inside the frame

#### Scenario: The whole body stays above a phone's stop panel
- **WHEN** the whole figure is shown on a 390×844 phone tour, whose panel may cover the bottom 15% of the drawing
- **THEN** every joint over the cycle, the ground and the cadence label's room lie inside the drawing above that 15%

#### Scenario: The stride camera fills a wide drawing
- **WHEN** the drawing is wider than 3:4 (the tour's rail at 1280×800, its phone stage at 390×844)
- **THEN** the stride camera frames the figure larger than in the viewBox alone, and the figure, the stride, the inset and their labels' room stay inside the visible frame and above its bottom 15%

## ADDED Requirements

### Requirement: A knee view rests on its key phase each cycle

While playing with a limb focus and a dwell (`keyPhaseDwellMs`, the knees view's 500 ms), the
renderer SHALL rest on the held phase (the focus's first limb key phase, the headline's) for the
dwell, wall-clock, once each cycle, so the moving limb meets its annotation for a beat; the rest
SHALL NOT lift the thirty-frame cap and playback SHALL otherwise run round the whole cycle, only
forward. The landing camera's own window and rests take precedence. Without a dwell the figure
never rests. Under reduced motion, or paused, the figure stands still at the held phase as before.

#### Scenario: The knees view rests on the peak bend
- **WHEN** the runner plays the knees view (knee flexion in focus, legs from the side, 0.4×, a 500 ms dwell)
- **THEN** once per cycle the drawn pose is exactly the peak-bend pose for about 500 ms, and no more than thirty frames a second are drawn

#### Scenario: No dwell, no rest
- **WHEN** the runner plays a limb focus without a dwell
- **THEN** the pose changes on every frame
