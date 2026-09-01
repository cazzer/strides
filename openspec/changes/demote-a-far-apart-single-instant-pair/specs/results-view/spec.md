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

An exemplar's named keypoints SHALL bound the region the image must show **at both instants of a
pair**, not at whichever instant happens to sit more comfortably inside the frame. A pair whose two
instants differ along an axis has, by construction, one instant nearer each edge on that axis; a
keypoint set that stops short of the subject therefore does not clip the pair evenly, it clips the
extreme instant. Where a metric pairs two instants that differ in the runner's vertical position,
the named keypoints SHALL reach the head, so that the instant at the top of the motion keeps it.

That is a statement about which instant is harmed, not about tidiness. The system draws one instant
solid and the other faint, and names the solid one in the caption; if the crop removes the solid
instant's head while keeping the faint one's, the image contains exactly one complete face and it
is the wrong one. A reader anchors on the face that is there, and then reads correctly-placed marks
on the other body as mis-registered.

A crop SHALL additionally carry a minimum side in native pixels, so that a degenerate keypoint box —
a seed resolving to a single point, or to a set that nearly collapses onto a line — does not produce
an empty image. That minimum is a **display** guarantee about pixel count and SHALL NOT be treated as
a statement about framing.

Where that minimum is what makes a crop wider than the subject on an axis, the system SHALL place the
crop **centred on the subject** along that axis rather than on the measured region, provided the
subject is at least as large as the crop on the other axis. The subject's extent SHALL be derived from
every keypoint that resolves at the frames the crop is drawn through, not only the ones the exemplar
named for its crop — a limb box says where the measurement was, and only the whole keypoint set says
where the runner is. Both conditions are required:

- The **minimum**, and not the padding, SHALL be what made the crop wider than the subject. A crop the
  padding sized is framed as the padding intended, and re-placing it would move an image whose
  composition nothing had inflated.
- The crop SHALL be smaller than the subject on the other axis, so that it is a detail of one body
  rather than a scene containing a whole one. When a crop already holds the entire subject, moving it
  only exchanges one region of background for another, and the system has no evidence with which to
  prefer either.

That placement SHALL change only the rectangle's position. The crop's side SHALL be exactly what the
padding, minimum and frame-bound arithmetic produced, so that everything judging a crop by its
size — including the ghosted-pair growth ratio — is unaffected.

The subject extent SHALL be treated as a **lower bound** on the subject rather than as its outline,
because a pose backend that cannot produce a keypoint contributes nothing to it: on a backend with no
foot keypoints the extent stops at the ankles while the runner's shoes continue below it. Centring
follows from that: it reserves the same margin at both ends of the axis, which is the largest margin
obtainable at either end, and is therefore the placement that best protects an extent the system
cannot observe. The system SHALL NOT infer from this box that the subject ends where it ends.

A pair whose two instants are indistinguishable — near-identical crop regions, both resolving to the
same sampled frame, or **separated by fewer sampled frame intervals than can express a difference in
gait phase** — SHALL be demoted to a single frame, or dropped when the metric has no honest
single-instant meaning. A blurred double exposure of two identical frames is worse than one clean
still.

Those tests are complementary and the system SHALL apply all of them. A comparison of the two
instants' crop REGIONS cannot see a pair that is merely too close in time: a bounding box is blind to
motion inside itself, so a limb swinging within its own hull changes the pose completely while barely
moving the box, and a small distant limb box changes shape a great deal between two adjacent frames
while depicting one pose. Measured on this repo's own footage, region overlap orders the two
situations backwards — the broken pair overlaps LESS than a pair that ghosts perfectly — so no
threshold on region overlap can separate them and the separation test SHALL be made on elapsed time
instead.

The separation floor SHALL be expressed in the clip's own sampled frame intervals rather than in
absolute seconds, because a sparsely sampled clip genuinely cannot resolve gait phase as finely as a
densely sampled one, and the floor should widen with the interval. It SHALL NOT be applied where no
usable interval can be derived: a guard that cannot form its own criterion must decline rather than
reject everything.

**This does not contradict the rule against measuring a too-far-apart pair by elapsed time**, because
the two ends of the range ask different questions. At the far end the question is whether two bodies
can share one legible crop — a spatial question, on which a stationary subject seconds apart ghosts
perfectly and a fast one a fraction of a second apart does not. At the near end the question is
whether the two instants are the two distinct phases the exemplar's own label names, which is a
property of the signal and is measured in time.

Whether a pair that cannot be drawn as a pair is demoted or dropped SHALL be decided by where the
REPORTED NUMBER lives, not by whether the exemplar arrived as a pair. A quantity read off a single
instant — a footstrike angle, a step width, a peak joint angle, a trunk-lean angle, an overstride
offset against the hip midline — survives losing its partner, because the surviving frame still
shows what the card reports and the annotation still draws the geometry that was measured there. A
quantity that IS a difference between two instants — an amplitude, a stride length — does not,
because one frame of it depicts no part of the number, and such a pair SHALL be dropped.

An exemplar built from the two ends of a spread SHALL be classified by the card's NUMBER, not by how
the exemplar was CONSTRUCTED. A metric reporting the median of per-instant measurements reports a
single-instant quantity however its picture was assembled: the two ends are how the exemplar found a
legible extreme to show, and one instant of it still carries a whole measurement taken at that
instant. Reading the construction as the classification is how a range came to be grouped with the
amplitudes it does not resemble, and the kind's own NAME is the thing that misleads — it describes
how the exemplar was built.

Demoting is the honest outcome wherever it is available: these rules exist to REPLACE a misleading
ghost with a truthful still, so classifying a single-instant measurement as un-demotable makes them
delete evidence instead.

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

#### Scenario: A minimum-sized limb crop is placed on the runner, not on the limb

- **WHEN** an exemplar names a small limb region whose padded box falls below the crop's minimum side,
  and the runner is narrower than that minimum but taller than it
- **THEN** the crop is centred horizontally on the runner's own keypoint extent rather than on the
  limb box, so the enlargement the minimum introduced is spent on the runner instead of on whatever
  stands beside them, while the crop's side, its aspect ratio and the limb region's presence in the
  image are all unchanged

#### Scenario: A crop that already holds the whole subject is left where it is

- **WHEN** a minimum-sized crop is larger than the subject on both axes — a distant runner in a foot
  or knee close-up, say
- **THEN** the crop is not re-placed, because moving it would exchange one region of background for
  another with nothing to choose between them, and a crop that rode up the body would reframe a foot
  close-up as a whole-body shot and pull whatever stands behind the runner into the middle of it

#### Scenario: A near-identical pair is demoted rather than blended

- **WHEN** a pair's two instants produce near-identical crop regions, or both resolve to the same
  sampled frame
- **THEN** the pair is demoted to a single frame — or dropped entirely for a metric with no honest
  single-instant meaning — and no double exposure is composited

#### Scenario: A bounce pair's crop keeps the head of the instant at the top of the motion

- **WHEN** a metric pairs the highest and lowest points of the runner's vertical oscillation, and the
  higher instant is the one drawn solid
- **THEN** the crop contains both instants' heads, so the image does not present the faint instant as
  the only complete figure in it

#### Scenario: A pair a couple of sampled frames apart is demoted, not ghosted

- **WHEN** an exemplar pairs two instants separated by fewer sampled frame intervals than a change of
  gait phase can occupy, so the two depict one pose however different their crop regions are
- **THEN** the pair is demoted to a single frame with the caption that says so, rather than composited
  into an image whose caption promises a difference the picture does not contain

#### Scenario: A single-instant measurement survives demotion where a difference measurement does not

- **WHEN** a pair cannot be drawn as a pair — because its two instants are indistinguishable, and
  separately because they are too far apart to share one legible crop — and it belongs to a metric
  whose reported value is read off one instant, and separately again when it belongs to one whose
  reported value is the difference between two
- **THEN** the first is demoted to a single frame that still shows the measured geometry, and the
  second is dropped, because one frame of a difference depicts no part of the reported number
- **AND** the verdict is the same under both reasons the pair could not be drawn, because the
  classification is a property of the metric's number rather than of the rule that rejected the pair

#### Scenario: A failed seek degrades to no evidence

- **WHEN** the detached element never reports a completed seek for a planned timestamp
- **THEN** that metric's evidence resolves to an explicit "no evidence" outcome naming extraction
  failure, and the interface renders the metric exactly as it does without evidence

#### Scenario: Missing backend keypoints do not corrupt a crop

- **WHEN** an exemplar names optional context keypoints the running pose backend structurally cannot
  produce, so they carry no position
- **THEN** those keypoints are omitted from the crop derivation and the crop is computed from the
  exemplar's core keypoints alone — never anchored at the coordinate origin

#### Scenario: A foot close-up is framed the same way whether or not the backend resolves feet

- **WHEN** the same footstrike instant is planned on a backend that produces heel and toe keypoints
  and on one that does not, so the subject's derived extent stops at the ankles on the second
- **THEN** both produce the identical crop rectangle, and neither reframes the close-up around a
  subject extent it read as an outline

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

### Requirement: A ghosted pair is judged on the crop it demands, not the crop the frame can supply

The system SHALL reject a two-instant evidence exemplar whose two instants are too far apart to
share one legible image, and SHALL make that judgement on the crop each side **demands** — the
subject's own box, padded, floored against a degenerate box — and SHALL NOT let the frame's own
`min(width, height)` cap enter the comparison.

The rejection criterion is a ratio: the crop the pair demands divided by the crop the better-framed
of its two instants demands alone, which is the factor by which ghosting shrinks the subject on
screen. Clamping the numerator to what the frame can supply destroys that quantity precisely where
it matters: once the pair's demand exceeds the frame, the numerator stops growing while the
separation does not, so every pair past that point — including one at opposite edges of the frame —
reports the same number as one at half the separation.

The two clamps SHALL be treated differently, because they are different. A floor binds from below
and genuinely cancels: a pair whose union the floor already frames costs the reader nothing a single
would not also have paid, and SHALL read as no growth. A cap binds from above and does not cancel;
it SHALL be excluded from the measure.

Excluding the cap SHALL NOT be implemented as, or degenerate into, a test of whether a crop reached
the cap. On a small source the cap binds on every crop, so such a test would delete every ghost on
every webcam clip. The retained floor is what keeps a small source safe: the union's long side
cannot exceed the frame's own larger dimension, so with the denominator resting on the floor the
ratio is bounded, and on a frame small enough that bound sits below the rejection threshold for every
pair the source can produce.

The criterion, the threshold it is compared against, and the calibration behind that threshold are
UNCHANGED by everything that follows. A pair is rejected on exactly the reading it was rejected on
before, and nothing below relaxes, re-derives or re-scopes what counts as too far apart.

A pair rejected on this criterion SHALL be routed to the same classification rule that decides a
collapsed pair's fate: demoted to its base where the metric's reported number is read off a single
instant, dropped where that number is a difference between two. The rejection establishes that the
two instants cannot share one legible image; it establishes nothing about whether either instant
alone is worth showing, and that second question already has an answer stated elsewhere in this
capability.

A demoted single's crop SHALL be derived from the one instant it draws. The whole-frame union this
requirement's own scenarios describe is therefore unreachable for a demoted image by construction:
its crop is exactly what a single-instant exemplar of the same geometry would have received,
inheriting every existing crop guard and adding none.

The caption of a demoted image SHALL survive on its label's leading clause, which names the base
instant — see the form-heuristics requirement that a paired exemplar's label names its base first.
That is what makes demotion honest at this end of the range: the leading clause is a true statement
about the only body on screen.

The crop rectangle that is actually drawn SHALL be unchanged by this: the drawn crop remains padded,
squared and clamped to the frame bounds. Only the judgement changes.

#### Scenario: Opposite edges of a large frame are distinguished from adjacent instants

- **WHEN** a metric emits a pair on a 3840×2160 clip whose subject box is a full-body 320×1240, at
  three separations — adjacent, half a frame apart, and at opposite edges of the frame
- **THEN** the three readings are distinct and strictly increasing, and the opposite-edge pair is
  rejected, rather than all three passing on readings that differ by under a tenth

#### Scenario: A runner who crossed the frame produces no evidence image at all

- **WHEN** a metric whose reported number is a DIFFERENCE between two instants — a stride length,
  say — emits a pair putting the runner at opposite edges of the frame, so their union crop would
  saturate at the frame's own dimension and centre on background with neither runner inside it
- **THEN** the pair is dropped and that metric reports no evidence, rather than rendering a crop of
  empty background captioned as a measurement

#### Scenario: A far-apart pair of a single-instant measurement is demoted rather than dropped

- **WHEN** a metric whose reported number is read off ONE instant — an overstride offset against the
  hip midline, say — offers a pair whose union crop demands more growth than the threshold allows,
  and it has no other pair to offer
- **THEN** the pair is demoted to its base instant, the image is cropped from that instant alone at
  the size a single-instant exemplar of the same geometry would have received, and the metric
  reports evidence rather than reporting that every candidate was gated out

#### Scenario: An ordinary pair on a small source is still ghosted

- **WHEN** a clip is small enough that every crop reaches the frame cap — a 320×240 webcam
  recording — and a metric emits an ordinary pair on it, at any separation the source can produce
  and for any subject size the frame can hold
- **THEN** the pair is ghosted normally, because the retained floor bounds the ratio below the
  rejection threshold there, and no ghost on that clip is deleted

#### Scenario: The drawn crop is unaffected by the change of measure

- **WHEN** a pair passes the criterion and is ghosted
- **THEN** the rectangle both instants are drawn through is exactly the padded, squared,
  frame-clamped rectangle it was before, so no surviving image changes

#### Scenario: The development-only coverage output reports the reading it was judged on

- **WHEN** an evidence run completes in a development build and emits its separately-prefixed
  evidence coverage output
- **THEN** each exemplar record carries the growth reading for the image it produced, as a number
  beside the crop side already reported, and an explicit absence for a single-instant exemplar and
  for a pair demoted to its base
- **AND** that output remains parseable as JSON and carries nothing image-shaped — no canvas, blob,
  object URL or data URI

### Requirement: An undrawable exemplar falls back to the next-best pair before the metric loses its evidence

When an exemplar offers ranked alternative pairs, the system SHALL walk that list in order and plan
the **first pair it can actually render**, and SHALL report that the metric has no evidence only
once every offered pair has failed. Dropping the metric on the strength of its first pair alone
makes coverage hinge on the geometry of one frame pair, which is the same defect as scoring a
single pre-chosen instant instead of ranking many — one level up.

The walk SHALL fall back on **any** reason the pair could not be rendered, not only on the two
instants being too far apart to share a crop. A pair whose ghost does not resolve to a sampled
frame, whose two instants land on the same frame, whose boxes are near-identical, or which has no
derivable crop region, is as undrawable as one that is too far apart, and a lower-ranked pair may
suffer from none of them.

Falling back SHALL NOT weaken any drop rule. Each candidate pair SHALL be planned by exactly the
same rules the winner is planned by, including the emission-quality gate, so a fallback pair can
only be rendered on terms the winner would also have had to meet.

Demotion SHALL be the walk's LAST RESORT. Any pair that renders AS A PAIR, at any rank, SHALL be
preferred over a demoted single derived from a higher-ranked one, and a demoted plan SHALL be
returned only once every offered pair has failed to render as a pair. Without that ordering,
classifying a kind as demotable silently converts a fallback into a demotion: the winner stops at
its own base instead of the walk reaching the drawable alternate below it, and a metric that renders
a good ghost today renders a lone frame instead. That regression would read on the evidence coverage
output as the metric still producing an image, which is why the ordering is required here rather
than left to how the walk happens to be written.

The rendered result SHALL describe the pair that was actually drawn. The instants, the quality and
the growth reading reported for the image SHALL be the selected pair's own, so that a reader —
and the development-only evidence coverage output — is never told about a pair the image does not
show.

The per-metric image budget SHALL be applied after the walk, unchanged: a fallback consumes the
slot its exemplar already owned and SHALL NOT let one metric render more images than before.

#### Scenario: An un-croppable winner is replaced rather than dropped

- **WHEN** a metric's best-scoring pair puts the subject at opposite edges of the frame, so ghosting
  the two would shrink the subject past legibility, and a lower-ranked pair sits close enough
  together to share a crop
- **THEN** the lower-ranked pair is rendered, and the metric reports evidence rather than reporting
  that all its candidates were gated out

#### Scenario: A drawable winner is untouched

- **WHEN** a metric's best-scoring pair can be rendered
- **THEN** it is rendered and no alternative is examined, so the image, its instants, its quality
  and its growth reading are exactly what they were before alternatives existed

#### Scenario: A drawable lower-ranked pair outranks a demoted higher-ranked one

- **WHEN** a metric's best-scoring pair is too far apart to share a crop and belongs to a kind that
  may be demoted, and a lower-ranked pair of the same exemplar can be rendered as a pair
- **THEN** the lower-ranked pair is rendered as a ghosted pair and no demoted single is produced,
  because demotion is the walk's last resort rather than a per-candidate outcome

#### Scenario: No offered pair is drawable

- **WHEN** every pair a metric offers fails to render as a pair, whatever the reason, and the
  metric's kind is one with no honest single-instant meaning
- **THEN** the metric reports no evidence with the same reason it reported before, rather than
  rendering a pair that failed a drop rule

#### Scenario: The reported image describes the pair that was drawn

- **WHEN** a fallback pair is rendered in place of the winner
- **THEN** the reported instants, quality and growth reading are the fallback pair's own, not the
  rejected winner's

#### Scenario: Falling back does not enlarge the per-metric image budget

- **WHEN** a metric's exemplars each fall back to an alternative pair
- **THEN** the metric renders no more images than the per-metric budget already allowed, because
  the alternatives belong to the exemplars rather than adding to them

## ADDED Requirements

### Requirement: A demoted evidence caption names which rule took the pair apart

Where an evidence image was planned as a pair and rendered as a single frame, the caption SHALL say
that it was demoted AND say WHY, distinguishing a pair whose two instants were indistinguishable
from one whose two instants were too far apart to share a legible crop. Those are opposite
conditions, and a caption naming the wrong one is a false statement about the picture it sits under.

The reason SHALL travel with the plan as an explicit value rather than as a boolean. A boolean
cannot carry three states, and two independent fields could disagree with each other about one
image.

The far-apart sentence SHALL state the SPATIAL criterion the guard actually applies — that the two
instants could not share one legible crop — and SHALL NOT describe the pair in terms of elapsed
time, which this capability explicitly rejects as the measure at that end of the range.

Every demotion reason SHALL have a sentence, and the mapping from reason to sentence SHALL be
total, so that a reason added without its sentence is rejected before it can caption an image with
nothing.

The development-only evidence coverage output SHALL report the demotion reason in place of the
boolean it reported before, so that a demoted image can be told from an un-demoted one AND from a
differently-demoted one without reading a caption off the interface.

#### Scenario: A far-apart demotion is not captioned as a near-identical one

- **WHEN** a pair is demoted because its two instants were too far apart to share a legible crop
- **THEN** the caption says the paired instant was too far away to share a legible crop, and does
  NOT say that the two instants were too similar to tell apart

#### Scenario: A near-identical demotion keeps the sentence it already had

- **WHEN** a pair is demoted because its two instants were indistinguishable
- **THEN** the caption is exactly the sentence it carried before demotion reasons were
  distinguished, so no image that reads correctly today changes

#### Scenario: The coverage output reports which rule demoted an image

- **WHEN** an evidence run completes in a development build and emits its evidence coverage output
- **THEN** each exemplar record carries its demotion reason, or an explicit absence where the image
  was not demoted, and the output remains parseable as JSON
