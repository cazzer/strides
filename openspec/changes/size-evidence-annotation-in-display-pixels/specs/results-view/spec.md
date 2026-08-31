## MODIFIED Requirements

### Requirement: Evidence thumbnails annotate the runner's own measured geometry and never a reference posture

A thumbnail SHALL be annotated. The system SHALL draw, over the extracted image, the **detected
joints** the exemplar is about and the **measurement geometry** the metric was derived from — the
segments, reference rays, angle arcs, plumb lines, calipers and midlines that the metric's own
calculation forms. An unannotated photograph shows a moment; an annotated one shows what was measured
in it, which is the question a reader has about a number they did not compute.

Every mark SHALL be derived from **this runner's own keypoints in the depicted frames**. The system
SHALL NOT overlay a reference posture, an ideal, a target, a model or template skeleton, a
"correct-form" outline, or any other geometry the runner did not produce. Where a metric measures a
delta, the only delta shown SHALL be the runner against themself — two instants of one run — never
the runner against a standard. This application holds no reference-form data, and SHALL NOT
synthesize one in order to draw it: a picture of a target implies the system knows what correct form
is, which is a claim this product does not make and cannot support.

The joint layer SHALL preserve the pipeline's own certainty distinction: a keypoint the detector
found directly SHALL read as more certain than one the robustness layer interpolated, and an
unrecoverable keypoint SHALL be drawn not at all rather than faintly. The joint layer SHALL be drawn
only for the keypoints the exemplar's own mark set names — not for the whole skeleton, most of which
falls outside a metric's crop.

The joint layer and the measurement layer SHALL be visually distinguishable from each other, so a
reader can tell "these are the joints the pipeline found" from "this is the thing that was measured".
Annotation SHALL remain legible at the thumbnail's real display size; stroke weights, mark sizes and
any text SHALL be sized against the image the reader actually sees, not inherited from a full-size
video overlay.

A fraction of the canvas is not on its own enough to satisfy that. A fraction fixes a mark's
*apparent* size, but it fixes it at whatever that fraction was worth when it was chosen, and these
images are drawn into a box far smaller than the canvas they are painted on. Any feature whose whole
job is to be **seen as a separate thing** — as opposed to merely to be present — SHALL therefore
carry a floor stated in **display** pixels, resolved against the size the card actually renders the
thumbnail at, in addition to any canvas-pixel floor. A canvas-pixel floor scales with the canvas and
so cannot detect this class of failure at all: the mark stays correctly proportioned right up to the
point where the compositor averages it out of the delivered image entirely. The display size SHALL be
a parameter with a default rather than a constant, so that a larger surface relaxes the floors
instead of inheriting a size only the smallest surface needed.

Separation from the photograph SHALL be carried by a **dark boundary drawn beneath every mark**,
and that boundary is the only mechanism available: the mark colours are light, so their contrast
against a bright photograph is below the 3:1 a reader needs at *any* stroke width and *any* opacity,
while a dark edge between the mark and the photograph reaches it against light and dark ground alike.
The boundary SHALL be present in the **delivered** pixels rather than merely in the canvas — a
boundary thinner than a display pixel is averaged into the mark on one side and the photograph on the
other, so the edge it exists to create is not in the image the reader is served.

The boundary SHALL NOT be scaled by the mark's own opacity. A mark's opacity states how far a reader
should trust it — a ghost instant's marks are weaker than the base's, an interpolated joint weaker
than a detected one — and separability is not part of that statement. A fainter mark needs its
boundary more, not less, because it has less contrast of its own to spend. Emphasis ordering SHALL
continue to be carried by the marks' own colour, so the base still reads ahead of the ghost.

Where a mark's meaning is carried by a **gap** — the dash pattern that separates a construction the
calculation formed from a segment it measured — the gap SHALL be floored in display pixels the same
way, and SHALL be measured on the gap that survives the boundary rather than on the dash pattern
handed to the renderer. The two differ: one path stroked twice means the boundary pass draws the same
dashes at a greater width, and a round cap extends every dash at both ends, so a gap that is adequate
on paper can be closed completely in the image.

Compositing SHALL be explicit: annotation SHALL be drawn at its own intended opacity and SHALL NOT
inherit the ghost's blend opacity by accident, so a ghosted pair's marks are as solid as a single
frame's.

#### Scenario: A metric's own measurement geometry is drawn, not just its joints

- **WHEN** a metric whose quantity is an angle produces evidence
- **THEN** the thumbnail carries that metric's own vertex, its two rays, and the arc between them,
  in addition to the joints the pipeline detected

#### Scenario: No reference or ideal posture is ever drawn

- **WHEN** any metric's evidence renders, for any value, confidence, or camera view
- **THEN** every drawn mark traces positions taken from this runner's own detected keypoints in the
  depicted frames, and no target line, model skeleton, ideal outline, or "correct" posture is drawn
  or offered

#### Scenario: An interpolated joint reads as less certain than a detected one

- **WHEN** a depicted frame carries a mix of directly-detected and interpolated keypoints
- **THEN** the interpolated ones are visibly weaker than the detected ones, and any keypoint the
  robustness layer could not recover is absent rather than drawn

#### Scenario: Only the exemplar's own keypoints are drawn

- **WHEN** a metric's crop covers one limb
- **THEN** the joints drawn are the ones that metric's exemplar names, not every keypoint the pose
  backend emits

#### Scenario: A ghosted pair's annotation is not drawn at the ghost's opacity

- **WHEN** a thumbnail composites a base frame and a ghost frame
- **THEN** the annotation over it is drawn at its own opacity, not at the ghost blend's

#### Scenario: A mark's dark boundary survives being drawn into the card's thumbnail box

- **WHEN** an annotation is sized for a canvas that the card renders into a much smaller box
- **THEN** the boundary beneath every mark resolves to at least the display-pixel floor once scaled
  into that box, on every canvas side the crop planner produces, rather than to a fraction of a
  display pixel that the compositor averages away

#### Scenario: Halving the canvas still halves every weight

- **WHEN** the same annotation is sized for a canvas half as wide
- **THEN** every stroke weight, radius and boundary width is half what it was, because the
  display-pixel floors are themselves proportional to the canvas side, so the proportional sizing the
  fractions exist to provide is preserved rather than replaced

#### Scenario: A weaker mark keeps the same boundary as a stronger one

- **WHEN** a thumbnail draws a ghost instant's marks and an interpolated joint alongside the base
  instant's detected marks
- **THEN** every one of them carries a boundary of the same strength, while the marks themselves keep
  their differing opacities, so the weakest mark is still separable from the photograph and the base
  still reads as the stronger of the two instants

#### Scenario: A construction line still reads as dashed once its boundary is wide enough to see

- **WHEN** a construction line is drawn with a boundary wide enough to survive the downscale
- **THEN** the gap left between its dashes after that boundary's caps have extended them is still at
  least the display-pixel floor, so the line reads as dashed rather than as one continuous bar

#### Scenario: A larger display surface is not given the smallest surface's weights

- **WHEN** the same canvas is sized for a display box substantially larger than the metric card's
  thumbnail
- **THEN** the display-pixel floors bind less or not at all, and the weights fall back to the
  canvas fractions, rather than every surface inheriting the width only the smallest one required
