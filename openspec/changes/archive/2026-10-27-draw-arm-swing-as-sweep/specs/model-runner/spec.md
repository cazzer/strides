## ADDED Requirements

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

## MODIFIED Requirements

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
