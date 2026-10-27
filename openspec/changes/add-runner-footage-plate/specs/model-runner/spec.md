## ADDED Requirements

### Requirement: A still figure can show its measured instant's footage behind it, faintly

The renderer SHALL accept an optional footage source: an evidence canvas, the metric it was measured
for, the base instant's joints in the image's unit square, the measured side, whether the clip runs
right to left, and a text note. While the figure is still (paused, or under reduced motion before
the reader plays it) at its held phase, with no camera tween and no value tween running, and that
held phase is the footage metric's own key leg phase on the held leg, the renderer SHALL draw a copy
of the canvas's pixels as the drawing's first element, under the ground and the figure, at 0.26
opacity, fading in and out over 240 ms (with no transition under reduced motion), and SHALL NOT draw
it under forced colours. The copy SHALL be made from the canvas's pixels only while the figure is
still, SHALL never move or draw into the source canvas, and SHALL be released when the source
changes or the runner unmounts.

The plate SHALL be placed by a similarity transform only: one uniform scale, a translation, and a
horizontal mirror for a right-to-left clip; never a rotation, shear or per-joint warp. The footage's
hip-mid SHALL land on the drawn hip-mid, and the scale SHALL be the ratio of the drawn to the
footage's summed hip-mid → knee → ankle lengths (hip-mid → ankle where the knee is missing; feet
excluded), over the legs the footage has, the measured side's joints compared with the drawn held
(near) leg. It SHALL be computed from the pose as drawn, every still draw. While hidden the plate
SHALL keep its last placement rather than follow the figure.

#### Scenario: A reduced-motion knees stop over a side clip
- **WHEN** the runner mounts under reduced motion on the legs camera with knee flexion in focus and knee-flexion footage, and the copy is ready
- **THEN** the plate is the drawing's first element, shown at 0.26, and its transform is the hip-anchored, segment-length-scaled fit over the drawn joints

#### Scenario: A right-to-left clip
- **WHEN** the footage's clip runs right to left
- **THEN** the plate's horizontal scale is the negative of its vertical scale

#### Scenario: Play hides it
- **WHEN** the reader presses Play while the plate shows
- **THEN** the plate fades out where it is, and shows again, without a second copy, when the reader pauses

#### Scenario: A camera tween hides it until the camera rests
- **WHEN** the camera changes while the figure is paused with the plate shown
- **THEN** the plate is hidden while the camera tweens and shown, refitted, once it rests

#### Scenario: No plate without a copy, a matching key phase or footage
- **WHEN** the copy is not ready yet, the canvas cannot be read back, no footage is passed, or the footage's metric is keyed to a different leg phase than the held one
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

### Requirement: The text alternative names the footage plate when it shows

While the footage plate is offered (its copy ready, the figure still, its key phase the held one),
the runner's visually hidden text alternative SHALL end with the footage's note, which SHALL say the
picture is the reader's own clip, scaled to fit, and not a target. While the figure plays, or with no
plate, the note SHALL be absent.

#### Scenario: Offered, then playing
- **WHEN** the plate is offered and the reader then presses Play
- **THEN** the text alternative contains the note while offered and no longer contains it while playing
