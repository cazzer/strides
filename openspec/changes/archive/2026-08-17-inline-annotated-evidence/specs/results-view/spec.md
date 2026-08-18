# results-view (delta)

## MODIFIED Requirements

### Requirement: Evidence frames are planned purely, then extracted from a detached video element

The system SHALL, only after an analysis run has reached `phase: 'ready'`, extract a small number of
still frames from the analyzed clip at the timestamps its metrics reported as exemplars, crop each to
the region of the frame that exemplar names, and — for an exemplar naming two instants — composite
the two into a single alpha-blended image.

The decision half SHALL be **pure**: turning an exemplar into timestamps, resolving those timestamps
to sampled frames, deriving a crop rectangle, deciding which frame is the base, which is the ghost,
and at what opacities, **and deriving every annotation mark's geometry in the output image's own
coordinate space**, SHALL all be computable with no DOM, no canvas, and no video element, so that all
of it is unit-testable in an environment with no canvas implementation. Only the final draw SHALL
touch a rendering context. Annotation is inside this rule, not beside it: the unit suite runs in an
environment whose `getContext('2d')` returns `null` by deliberate choice, so any geometry decided
inside a draw call is geometry no test can reach.

The pure layer SHALL have, for every instant it plans, the information an annotation needs: the
resolved position of each keypoint the exemplar's own mark set names, each carrying whether it was
directly detected, interpolated, or unrecoverable; the transform from video-native pixels to the
output image's coordinate space; the sign of any directional quantity a mark's orientation depends
on — direction of travel, or which side of the body's midline counts as outward; and, where the
metric measures one side of the body, **which side that instant's own measurement was about**. A mark
whose orientation is guessed rather than derived is a false statement about the runner, and the plan
is the only place where it can be derived and tested.

That last one SHALL be recorded **per instant**, not per image. A metric may deliberately pair two
instants measured on opposite sides — step width's constructed opposite-foot pair is exactly that,
and an overstride range's two extremes need not share a foot either — so a single image-level side
is absent on precisely the pairs it would be needed for. The plan SHALL carry an explicit absence
where no side was stated, and a mark that needs one SHALL be omitted rather than anchored on a
guessed limb.

Timestamps SHALL be resolved against that clip's own sampled frames. The system SHALL NOT derive any
extraction timestamp from the clip's reported duration: a recorded webcam clip commonly reports an
infinite duration, and any fraction-of-duration arithmetic would silently produce a nonsensical
instant on exactly those clips.

Crop rectangles SHALL be computed in video-native pixel space, from the resolvable subset of the
exemplar's named keypoints **unioned across both frames of a pair**, then padded and clamped to the
frame bounds so that a subject near an edge or partly out of frame yields a valid rectangle rather
than a negative or out-of-bounds one. Every crop SHALL share a single aspect ratio across all
metrics, so the images read as one coherent set wherever they render. Keypoints that a given pose
backend structurally cannot produce SHALL be treated as absent rather than as positions: a crop SHALL
be well-defined from the exemplar's core keypoints alone, and an annotation SHALL omit a mark it has
no resolved position for rather than anchoring it at the coordinate origin.

A pair whose two instants are indistinguishable — near-identical crop regions, or both resolving to
the same sampled frame — SHALL be demoted to a single frame, or dropped when the metric has no honest
single-instant meaning. A blurred double exposure of two identical frames is worse than one clean
still.

Extraction SHALL use a **second, detached** video element created from the clip's own source blob,
never the clip's own presented element, whose playback state belongs to the reader (it may be paused
on an arbitrary frame, or loop-playing while its preview is open). It SHALL hold at most one detached
decoder open at a time, extracting every instant for one clip in a single pass before moving
to the next. It SHALL own and release the object URL it creates, and SHALL NOT reuse or release the
one the video source hook holds privately. After a seek reports completion it SHALL wait for the new
frame to be presented before drawing, since seek completion does not imply the new frame is
composited. A seek that never completes SHALL degrade that metric to "no evidence" rather than
leaving the interface waiting.

Extracted images SHALL be held in memory for the session only. The system SHALL NOT serialize them to
a data URL or blob, offer a download, or persist them to any storage.

A metric with no evidence SHALL be distinguishable, in the extraction result, from a metric whose
evidence has not been computed yet — an explicit outcome the interface can branch on, carrying the
reason (the metric emitted no exemplars, every candidate was gated out, the metric is not being
reported at all, the clip's frames are unavailable, or extraction failed).

#### Scenario: Extraction happens after analysis and never disturbs the visible playback

- **WHEN** an analysis run reaches `phase: 'ready'`, whether or not the clip's own element is
  currently presented and playing
- **THEN** evidence extraction runs against a separate detached element created from the clip's
  source blob, the clip's own element's playback state is untouched, and analysis wall-clock time is
  unchanged from a run with no extraction

#### Scenario: A webcam clip reporting an infinite duration still yields a valid plan

- **WHEN** the clip's metadata reports a non-finite duration, as recorded webcam blobs commonly do
- **THEN** the extraction plan is well-formed, because every timestamp derives from the clip's own
  sampled frames and none from its reported duration

#### Scenario: A subject near the frame edge yields a valid crop

- **WHEN** an exemplar's keypoints sit near, or partly beyond, a frame boundary
- **THEN** the crop rectangle is clamped inside the frame with a positive size and the same aspect
  ratio every other crop uses, rather than a negative or out-of-bounds rectangle

#### Scenario: A near-identical pair is demoted rather than blended

- **WHEN** a pair's two instants produce near-identical crop regions, or both resolve to the same
  sampled frame
- **THEN** the pair is demoted to a single frame — or dropped entirely for a metric with no honest
  single-instant meaning — and no double exposure is composited

#### Scenario: A failed seek degrades to no evidence

- **WHEN** the detached element never reports a completed seek for a planned timestamp
- **THEN** that metric's evidence resolves to an explicit "no evidence" outcome naming extraction
  failure, and the interface renders the metric exactly as it does without evidence

#### Scenario: Missing backend keypoints do not corrupt a crop

- **WHEN** an exemplar names optional context keypoints the running pose backend structurally cannot
  produce, so they carry no position
- **THEN** those keypoints are omitted from the crop derivation and the crop is computed from the
  exemplar's core keypoints alone — never anchored at the coordinate origin

#### Scenario: Annotation geometry is decided with no canvas in reach

- **WHEN** the unit suite runs in an environment where `getContext('2d')` returns `null`
- **THEN** every annotation mark's position, orientation and extent in the output image's coordinate
  space is computed and asserted, and the only untested step is the sequence of draw calls that
  paints them

#### Scenario: A directional mark is oriented from the plan, not from the drawing layer

- **WHEN** a metric's mark depends on which way the runner is travelling, or on which side of the
  midline counts as outward
- **THEN** that sign reaches the drawing layer as part of the plan, and a runner travelling
  right-to-left produces a mark oriented opposite to the same runner travelling left-to-right

#### Scenario: An unresolved keypoint drops its mark rather than moving it

- **WHEN** a keypoint an annotation mark depends on is `'unrecoverable'` at the depicted instant
- **THEN** that mark is omitted from the plan, and no mark is drawn at the coordinate origin or at a
  substituted position

## REMOVED Requirements

### Requirement: An evidence gallery renders below the results, grouped by metric

**Reason**: The gallery is removed as a surface. Evidence rendered a page-scroll away from the number
it explains, in a section a reader reaches by following a link and then has to navigate back from;
the picture and the claim it supports were never on screen together. Evidence now renders inside the
metric card it belongs to, so this requirement's core premise — a dedicated full-width section below
the cards, grouped by metric, reached by deep link — no longer describes anything the system does.

The requirement also carries the clause this change exists to reverse: "The system SHALL NOT draw a
skeleton, angle arc, reference line, or any other annotation over an extracted image". Annotating the
detected joints and the measured geometry is now REQUIRED, so the requirement cannot be MODIFIED into
its replacement without contradicting a scenario it declares ("A ghosted image shows one runner at
two instants" asserts "with no drawn annotation of any kind"). Per this repo's convention a full
reversal is a REMOVE plus a fresh ADD, not a MODIFIED block that no longer resembles the original.

**Migration**: Replaced by "Evidence renders as annotated thumbnails inside the metric card",
"Evidence thumbnails annotate the runner's own measured geometry and never a reference posture", and
"An annotation depicts what was measured at the depicted instant, never the card's reported value"
(all ADDED below). Everything in this requirement except the anti-annotation clause survives into
those three, re-stated for the new surface:

- Grouping by metric survives as the strongest possible form of it — the images live in the metric's
  own card.
- Captioning, alt text, the per-side identification, and the "same runner at two instants, never two
  people" sentence survive verbatim in intent.
- The single shared aspect ratio survives in the MODIFIED planning requirement above.
- Usability at narrow widths survives, restated as a per-card container-width rule, because a card
  can be narrow on a wide viewport.
- "Drive extraction at most once per clip, releasing the detached element and any retained images when
  it unmounts or the session resets" survives verbatim in intent, re-homed onto whatever component
  owns extraction once the gallery is gone.

**The second half of the anti-annotation clause does NOT lapse.** "SHALL NOT overlay any reference or
ideal posture — the only delta shown is the runner against themself" is re-stated, in stronger and
more explicit terms, in "Evidence thumbnails annotate the runner's own measured geometry and never a
reference posture" below. Only the ban on drawing the runner's *own* detected and measured geometry is
lifted.

### Requirement: Metric cards deep-link to their evidence, and are otherwise unchanged

**Reason**: There is nothing left to deep-link to. The link existed only because the imagery lived in
a separate section; with the imagery inside the card, an in-page anchor from a card to itself is not
a degraded version of this requirement, it is meaningless. The reporting channel that fed it — the
gallery telling the panel which metrics produced imagery, so a card knew whether to render the link —
goes with it.

**Migration**: The first half is replaced by "Evidence renders as annotated thumbnails inside the
metric card" (ADDED below). The second half is **kept in full** and is replaced by "A metric card
without evidence is unchanged, and an excluded metric gets none" (ADDED below), which restates both
surviving guarantees:

- "A metric card whose metric has no evidence SHALL render exactly as it does today — no link, no
  placeholder, no empty frame, and no layout shift relative to a build without this capability."
- "Evidence SHALL be offered only for metrics that render as a card. A metric excluded from the card
  grid — because nothing was measured, or because the camera geometry cannot support the measurement
  — SHALL have no [imagery] and no link."

Both scenarios carry over with their conditions intact; only the words "gallery section" and "link"
are re-pointed at the inline thumbnail, since neither a gallery nor a link exists to be withheld.

## ADDED Requirements

### Requirement: Evidence renders as annotated thumbnails inside the metric card

The system SHALL render a metric's extracted evidence **inside that metric's own card**, as small
annotated thumbnails, and SHALL render no standalone evidence gallery and no link from a card to one.
The picture and the number it explains SHALL be visible together.

Placement within the card SHALL be: after the metric's description, **below** it when the card is
narrow and **beside** it when the card is wide. The narrow/wide decision SHALL be a function of the
**card's own width**, not the viewport's. The card grid is one, two, or three columns depending on the
width available to the panel, so a card on a wide screen in a three-column layout is a narrow card; a
viewport-width rule would place a thumbnail beside a description in a card with no room for it. The
placement SHALL be correct at every card-grid density the panel produces.

Thumbnails SHALL be sized for a card rather than for a gallery figure. Display size SHALL remain a
presentation decision expressed in the layout: the system SHALL NOT extract a second copy of an image
at a second resolution to serve a second display size, and every image SHALL share the single aspect
ratio the planning requirement fixes, so a card carrying two thumbnails and a card carrying one read
as the same set.

Each thumbnail SHALL be captioned well enough to be interpretable on its own: which metric it is
evidence for, which side where the metric is per-side, and — for a blended image — that the two
visible positions are the **same runner at two instants**, never two people. Each SHALL carry a text
alternative describing what it shows, since the image itself carries no text. Where more than one clip
is present, the card SHALL indicate which clip its evidence came from.

The rendered image SHALL be the extracted canvas element itself, adopted into the document. The
system SHALL NOT introduce a data URL, blob, object URL, download affordance, or any other
serialization of a thumbnail in order to display it inside a card.

Extraction SHALL run at most once per clip, and whatever component owns it SHALL hold at most one
detached decoder open at a time and SHALL release the detached element, its object URL, and every
retained image when the results unmount or the session resets. Moving the imagery into the cards
SHALL NOT weaken any of those.

#### Scenario: A thumbnail sits below the description in a narrow card and beside it in a wide one

- **WHEN** a metric with evidence renders as a card
- **THEN** its thumbnails render after the card's description — stacked below it while the card is
  narrow, and alongside it once the card is wide enough

#### Scenario: The card's own width drives the split, not the viewport's

- **WHEN** the card grid is at its three-column density on a wide viewport, so each card is narrow
- **THEN** each card's thumbnails render below its description, exactly as they would in a
  single-column layout on a phone

#### Scenario: A ghosted thumbnail says it is one runner, not two people

- **WHEN** a card's evidence is a blended pair
- **THEN** its caption states that both positions are the same runner at two moments of the same run,
  and its text alternative names the metric and, where the metric is per-side, the side

#### Scenario: No gallery and no deep link remain

- **WHEN** the results render with evidence for several metrics
- **THEN** no separate evidence section renders anywhere on the page, no card carries a link to one,
  and every image is inside the card for the metric it is evidence for

#### Scenario: Nothing is retained after the results go away

- **WHEN** the results unmount or the session is reset
- **THEN** no detached video element, object URL, or extracted image is retained

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
- `armSwingSymmetry` reports a ratio **between** its two images, one per side. Neither image shows it.
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

### Requirement: A metric card without evidence is unchanged, and an excluded metric gets none

A metric card whose metric has no evidence SHALL render exactly as it does without this capability —
no thumbnail, no link, no placeholder, no empty frame, no reserved space, and no layout shift. A card
with evidence and a card without SHALL differ only by the presence of the imagery itself. Evidence
coverage varies per clip by design, so the no-evidence card is the common case, not the exception.

Evidence SHALL be offered only for metrics that render as a card. A metric excluded from the card
grid — because nothing was measured, or because the camera geometry cannot support the measurement —
SHALL have no thumbnail and no imagery anywhere, whatever exemplars it may carry: imagery for a
measurement the system declined to report would be a picture explaining a number that is not on
screen.

#### Scenario: A card without evidence is the card it was before this capability

- **WHEN** a metric renders as a card but has no evidence
- **THEN** the card renders with no thumbnail and no placeholder, identically to a build without this
  capability, and its position and height in the grid are unaffected

#### Scenario: An excluded metric gets no thumbnail

- **WHEN** a metric is excluded from the card grid because its value is null or its view fit is
  unsuitable
- **THEN** no thumbnail is rendered for it anywhere, whatever exemplars it may carry
