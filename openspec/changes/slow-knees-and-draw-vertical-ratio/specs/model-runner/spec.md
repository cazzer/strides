## MODIFIED Requirements

### Requirement: Every degree of freedom is bound to exactly one measured value or held at a documented neutral constant

The system SHALL bind each runner parameter to its candidate metric's value when that metric is
non-null and its tier is not `'excluded'`, and SHALL otherwise hold the parameter at its neutral
constant. A `'caveated'` metric SHALL bind. Vertical oscillation SHALL bind from the torso ratio,
falling back to centimetres divided by the model's 50 cm torso only when the ratio is unmeasured.
Vertical ratio SHALL bind the stride length, as the stride it was computed over in torso lengths:
the bounce reading's derived stride (relative vertical oscillation ÷ vertical ratio), and only where
that reading can derive it (relative vertical oscillation measured on vertical ratio's own clip from
the same hip fit); otherwise the stride SHALL hold its neutral constant. In a multi-clip session the
relative bounce SHALL be read off vertical ratio's own clip's result, whichever clip fusion took the
fused relative bounce from; this SHALL NOT change any fused value or any clip choice. No metric SHALL
be a candidate for more than one parameter, and `stepWidthCm` SHALL bind nothing. A value outside the
drawable range SHALL be clamped and the bound parameter SHALL record the metric's own value and that
it was clamped.

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

#### Scenario: Vertical ratio binds the stride
- **WHEN** `verticalOscillation` is 0.154 and `verticalRatio` 0.0246, both from the same clip
- **THEN** the stride length is bound to 0.154 / 0.0246 torso lengths, names `verticalRatio`, and
  records 0.0246 as its metric value

#### Scenario: The stride's bounce comes from vertical ratio's own clip
- **WHEN** vertical ratio won on clip 1 at 0.0246, clip 1 measured a relative bounce of 0.154, and
  fusion took the relative bounce (0.172) from clip 2
- **THEN** the stride length is bound to 0.154 / 0.0246, the fused relative bounce stays 0.172 from
  clip 2, and pelvis bounce stays bound to 0.172

#### Scenario: No stride without a relative bounce on vertical ratio's clip
- **WHEN** vertical ratio's clip's relative bounce is null or excluded, or, with no per-clip bounce
  given, the fused relative bounce came from another clip than vertical ratio
- **THEN** the stride length holds its neutral constant

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
`strideCamera(values, ratio)` frames the whole figure over its cycle, one drawn stride along the
ground ahead of the near foot's contact, the magnified bounce inset over it and the bounce's own
bracket behind the hips, with room for their labels. The preset itself SHALL be the neutral
parameters' stride frame; the renderer SHALL reframe it on the values it draws and the bound
vertical ratio.

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

### Requirement: The focus area is accented and annotated with its metric's own value

Edges shaped by a measured focus parameter SHALL be accented, by a wider stroke as well as a hue,
with the other measured parts receding; measured parts SHALL never be dimmed so far that they read
as neutral, and neutral dashes SHALL never be dimmed. In forced-colours mode measured, neutral and
focus parts SHALL use distinct system colours. Each measured focus parameter SHALL carry an
annotation of its natural kind (an angle arc for trunk lean, knee drive and knee flexion; a
vertical bracket for bounce and arm swing; a horizontal offset for overstride, foot strike, step
width and swing-foot excursion; a footfall beat for cadence; for vertical ratio, a stride bracket
and a magnified bounce inset), whose geometry is the drawn value exactly and whose label is the
metric's own reported value in the guided card's format, except that the foot-strike label names
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

### Requirement: The runner is described in text and captioned honestly

The drawing SHALL be hidden from assistive technology, and a visually hidden text alternative SHALL
name which parameters were measured, which are fixed illustrative settings, and each measured focus
value. A parameter nothing draws while it is neutral (the stride) SHALL NOT be named among the fixed
settings, so a measured vertical ratio whose stride is unsaid, or an unmeasured one, is never called
"not measured" there. The figure SHALL carry its accessible name from a prop and the caption "Model
built from your numbers". No text SHALL call the runner a reference, an ideal or the reader's body.

#### Scenario: Text alternative
- **WHEN** only cadence and trunk lean are measured and trunk lean is in focus
- **THEN** the text alternative begins "Measured from your clip: Cadence, Trunk lean." and states "Shown: Trunk lean 5.0°."

#### Scenario: An undrawn neutral stride is not a fixed setting
- **WHEN** vertical ratio is measured but its stride is unsaid (the relative bounce excluded), or vertical ratio is excluded
- **THEN** the text alternative's fixed settings do not name vertical ratio

## ADDED Requirements

### Requirement: Vertical ratio is drawn as the hip bounce over one stride

A focus on vertical ratio with a measured stride SHALL draw the ratio's two inputs: a horizontal
stride bracket under the ground, at the figure's own scale, from the near foot's first contact point
to that point plus the drawn stride (exactly the drawn stride length), and the hip bounce as a
magnified inset over the stride, a vertical bracket exactly ten times the bounce (vertical ratio ×
the drawn stride: the relative bounce on vertical ratio's clip whenever the stride is unclamped),
tagged "hip bounce ×10" so the magnification is stated on the drawing. Inset ÷ 10 ÷ stride SHALL be
vertical ratio. The label SHALL print vertical ratio's own value at its band's precision, as the stop
prints it, over the words "bounce ÷ stride", and say "shown approximately" when the stride had to be
clamped; the stride SHALL be tagged "stride"; neither tag carries a value. The bounce SHALL NOT be
drawn twice at one stop: while the inset shows, the bounce's own true-scale bracket SHALL give way,
unless the bounce is the stop's headline (two marks at two scales). An inset taller than 3 torso
lengths SHALL be drawn at 3 and its label SHALL say "shown approximately". The stride
SHALL move no joint and SHALL get no intro step. The runner SHALL frame such a focus with the stride
camera (`strideSide`): side on, framed on the drawn values and vertical ratio so the whole figure,
the whole stride, the inset and the labels' room fit the frame.

#### Scenario: The drawn marks are the measured inputs

- **WHEN** vertical ratio 0.0246 is drawn with a bounce of 0.154 torso lengths
- **THEN** the stride bracket is 0.154 / 0.0246 long and horizontal, the inset is 1.54 long and
  tagged "hip bounce ×10", inset ÷ 10 ÷ stride is 0.0246, and the label reads "2.46%" over
  "bounce ÷ stride"

#### Scenario: A mixed-clip session

- **WHEN** vertical ratio and the relative bounce were fused from different clips
- **THEN** the inset is ten times the bounce measured on vertical ratio's clip, and the figure's own
  hip motion keeps the fused bounce

#### Scenario: No stride, no drawing

- **WHEN** the bounce is known only in centimetres
- **THEN** a vertical-ratio focus draws nothing new and the bounce keeps its own bracket

#### Scenario: The stride camera fits every drawable stride

- **WHEN** the stride is anywhere in its drawable range, with a bounce up to its drawable limit
- **THEN** the stride camera keeps the figure, the stride, the inset and the label pads inside the
  frame, zooming out further the longer the stride
