## ADDED Requirements

### Requirement: The outline-pass detector is dedicated, cached, image-mode with person masks

The outline pass SHALL use its own MediaPipe PoseLandmarker instance, separate from the scale
pass's, created once per page from the same self-hosted `.task` through the model cache (no new
download), in IMAGE running mode with one pose and `outputSegmentationMasks: true`. A failed
creation SHALL resolve to null and be retried on the next run. Each planned frame SHALL be drawn
from the sampler's full-frame canvas as a MoveNet-guided crop at native pixels (no rescale) before
segmentation, every segmentation result SHALL be closed after reading, and no full mask SHALL be
retained past its frame.

#### Scenario: Segmenter creation fails
- **WHEN** the outline segmenter cannot be created
- **THEN** the pass fails with the unavailable caveat and the next run tries to create it again

#### Scenario: A mask is read
- **WHEN** a planned frame is segmented
- **THEN** its mask is reduced to per-row runs, measured, and the segmentation closed before the next frame
