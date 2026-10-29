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
drawn twice: while the inset shows, the bounce's own true-scale bracket SHALL give way. The stride
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
