## ADDED Requirements

### Requirement: Per-frame metric scale passes through unmodified
The system SHALL copy a sample's optional `PoseFrame.pixelsPerMeter` verbatim onto the
corresponding `RobustPoseFrame` as a required, nullable `pixelsPerMeter: number | null`, using
`null` wherever the sample carried no frame or the frame carried no scale. It SHALL NOT
interpolate, extrapolate, smooth, or otherwise synthesize a scale value for any frame, even where
it interpolates that frame's keypoint positions — a fabricated scale would silently corrupt every
real-world measurement derived from it, in a way a fabricated keypoint position does not, because
the scale is the conversion factor rather than the signal.

#### Scenario: A detected frame's scale reaches the robust frame
- **WHEN** a `PoseSample` carries a frame with a `pixelsPerMeter` value
- **THEN** the corresponding `RobustPoseFrame`'s `pixelsPerMeter` equals that exact value

#### Scenario: A missing frame yields a null scale
- **WHEN** a `PoseSample`'s `frame` is `null`
- **THEN** the corresponding `RobustPoseFrame`'s `pixelsPerMeter` is `null`

#### Scenario: An interpolated frame is never given a fabricated scale
- **WHEN** a sample's keypoints are gap-filled by interpolation from flanking detections that
  themselves carried `pixelsPerMeter` values
- **THEN** that frame's `pixelsPerMeter` is `null`, not a value interpolated from its neighbours

#### Scenario: A scale-less backend yields null throughout
- **WHEN** every sample's frame comes from a backend that does not measure scale
- **THEN** every `RobustPoseFrame` has `pixelsPerMeter: null`, and no other output field differs
  from what it would have been
