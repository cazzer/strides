# results-view

## MODIFIED Requirements

### Requirement: An annotation depicts what was measured at the depicted instant, never the card's reported value

An annotation SHALL depict a quantity that is genuinely present in the frame or pair it is drawn on,
and SHALL be described as **what was measured at that instant**. The system SHALL NOT label a mark
with the metric's reported value unless the drawn quantity and the reported value are the same
quantity, arrived at the same way, over the same instants.

For most metrics they are not, and the gap is structural rather than incidental:

- The vertical-oscillation family (`verticalOscillation`, `verticalOscillationCm`, `verticalRatio`)
  reports an amplitude taken from a **whole-clip least-squares spectral sinusoid fit with a
  `c + d·t + e·t²` trend removed**. The pixel gap between the two ghosted midpoints in the image is a
  two-sample difference that still contains the whole-body translation the fit deliberately subtracts
  — it is not that fitted amplitude. The depicted cycle is chosen as the best-supported one, not the
  largest, so it is not even the clip's biggest bounce. `verticalOscillationCm` is further removed
  still: its fit runs over integrated metre deltas from one winning integration run, so no pixel
  distance in any image is its unit.
- `verticalRatio` reports a quotient formed across two **different** exemplars — a bounce cycle and a
  stride pair. Each image shows one factor of it; neither image shows the quotient.
- `overstriding` and `footStrikePattern` divide a drawable pixel offset by a **clip-median torso
  length**. The numerator is drawable; the denominator exists in no single frame.
- `stepWidth` divides its drawable offset by a **clip-median hip width**. The hip-to-hip segment is
  drawable in the frame, but the segment in the picture is that frame's hip width, not the clip median
  the value was divided by — a drawable-looking denominator that is still not the one used.
- `trunkLean` and `overstriding` deliberately select the **extreme** instants while their cards report
  a **median**, so the drawn geometry is by construction not the reported number. `kneeFlexion`'s
  reported value is likewise a median across swing-phase peaks, not the one peak depicted.
- `kneeFlexion` reports `180° − interiorAngle`, so an arc drawn on the interior angle at the knee is
  the **supplement** of the reported value.
- `trunkLean`'s reported value is multiplied by the direction of travel, so on a runner moving
  right-to-left the **sign** of the tilt visible on screen is the opposite of the sign the card
  reports. A mark that reads as "leaning this way" must not be equated with a signed number that means
  "leaning forward" in the runner's own frame of reference.

Where the drawn quantity differs from the reported value, the mark SHALL be captioned as the
per-instant measurement it is, and SHALL NOT be captioned with, annotated with, or visually equated to
the card's number. Where a metric's reported quantity has **no** honest single-still depiction, the
thumbnail SHALL carry the joint layer and whatever per-instant geometry is honestly drawable, and
SHALL carry no numeric label at all — never an invented, approximated, or back-computed one. An
instant carried purely for legibility, that no measurement was taken at, SHALL NOT be captioned as
measured.

`cadence` SHALL emit no evidence. It is a property of a sequence, and no still or pair of stills
depicts a rate. That decision SHALL be enforced independently both at the point the metric would emit
an exemplar and at the point evidence is planned, so that removing either enforcement alone cannot
cause a cadence thumbnail to appear.

This requirement is what keeps the reference-posture prohibition above meaningful. A picture that
silently restates a number it cannot show is already claiming more than it can support; a picture that
went on to show a target as well would be claiming to know what correct form is.

#### Scenario: A fitted amplitude is not labelled on the ghost that illustrates it

- **WHEN** a vertical-oscillation-family metric's evidence renders as a ghosted pair of bounce
  instants
- **THEN** the marks show the two midpoint positions and the gap between them at those instants, and
  neither the marks nor the caption labels that gap with the card's reported amplitude

#### Scenario: A ratio between two images is labelled on neither

- **WHEN** a metric's reported value is a ratio formed across its two exemplars
- **THEN** each image is captioned with what it shows on its own, and neither carries the ratio

#### Scenario: An angle arc is not labelled with a value it is the supplement of

- **WHEN** `kneeFlexion`'s evidence draws the interior angle at the knee
- **THEN** the arc is not labelled with the card's reported flexion value, because the reported value
  is that angle's supplement

#### Scenario: An extreme instant is not captioned as the reported median

- **WHEN** a metric that reports a median selects its most extreme instant as its exemplar
- **THEN** the annotation is captioned as the measurement at that instant, and never as the metric's
  reported value

#### Scenario: A screen-relative tilt is not equated with a travel-signed value

- **WHEN** `trunkLean`'s evidence renders for a runner travelling right-to-left, so the on-screen tilt
  and the reported value carry opposite signs
- **THEN** the drawn torso vector, vertical reference and arc are captioned as the tilt measured at
  that instant, and are not labelled with the card's signed value

#### Scenario: A ratio with an unshowable denominator carries no number

- **WHEN** a metric normalizes a drawable pixel offset by a clip-median body scale
- **THEN** the offset is drawn as the per-instant geometry it is, and no normalized figure is
  rendered on the image

#### Scenario: A legibility-only instant is not captioned as measured

- **WHEN** an exemplar carries a second instant purely so the first is readable, and no value was
  measured at that second instant
- **THEN** that instant's geometry is not captioned or labelled as a measurement

#### Scenario: Cadence renders no thumbnail, and two independent guards say so

- **WHEN** an analysis run completes with a measured cadence
- **THEN** the cadence card renders no thumbnail, and removing either the metric-side or the
  planning-side guard on its own still leaves the other one refusing it
