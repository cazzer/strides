## ADDED Requirements

### Requirement: A mixed-side pair names each instant's own measured keypoints, separately from its crop set

An exemplar SHALL be able to state, per instant, **which keypoints that instant's own measurement
was about** — separately from `cropKeypoints`, which states which keypoints define the region of the
frame the exemplar is about. The two SHALL NOT be conflated: the crop is a property of the IMAGE and
on a two-instant exemplar must be the UNION across both instants, because one photograph has to
contain both; the per-instant set is a property of the INSTANT, because it is what a consumer draws
when it draws that moment.

A metric whose exemplar pairs two instants that need **not** share a side SHALL state both
per-instant sets. The obligation attaches to the metric's CONSTRUCTION, not to how a particular
pairing happened to fall: whether a given pair's two instants agree is a property of the run, and a
producer that stated the fields only when they diverged would make its own contract a function of
the footage. That construction is the case the union is wrong for, and wrong for both halves: the
union names the limb neither instant's own measurement touched, so a consumer drawing it at each
instant depicts a measurement that was never taken, alongside one that was, with nothing separating
them.

The per-instant fields MAY be omitted wherever they would coincide with `cropKeypoints` — on a
producer whose two instants can never differ, and on every single-instant exemplar — and a consumer
SHALL fall back to `cropKeypoints` there. That fallback is correct by construction on such an
exemplar rather than an approximation: there is only one instant's worth of measured points in the
crop set to begin with. Where a producer states them anyway, including on a pairing that happens to
be same-side, the two sets SHALL equal each other and SHALL equal `cropKeypoints`, so that a
consumer draws the same set whether it reads the statement or the fallback.

The per-instant set SHALL be **stated by the metric that took the measurement**, and a consumer
SHALL NOT derive it by filtering `cropKeypoints` — neither by side, by name prefix, nor by position.
A crop set legitimately names points belonging to NEITHER instant's measurement: a single
step-width strike names the OPPOSITE ankle deliberately, because a width read against the hip
midline is only legible with the other foot in frame. Filtering by the spelling of a keypoint's name
would delete exactly that, and would make the drawn set a silent function of keypoint naming rather
than of what the metric measured.

Stating a per-instant set SHALL NOT change `cropKeypoints`, and SHALL NOT change any metric's
`value`, `confidence`, `viewFit`, `interpolatedFraction`, `frameCoverage`, `sampleSize`, or
`caveat`.

#### Scenario: A mixed-foot pair's two instants name disjoint measured limbs

- **WHEN** a metric emits a ghosted pair whose two instants were measured on opposite feet
- **THEN** each instant states its own measured keypoints, the two sets name disjoint ankles, and
  `cropKeypoints` remains the union of both instants' seeds plus whichever context points resolve

#### Scenario: A same-side pairing's per-instant sets agree with each other and with the crop set

- **WHEN** a metric whose pair need not share a side emits one whose two instants happen to share it
- **THEN** the two per-instant sets are equal to each other and to `cropKeypoints`, so a consumer
  reading the statement and a consumer taking the fallback draw the same set

#### Scenario: A single step-width strike keeps the opposite ankle and omits the per-instant sets

- **WHEN** the step-width construction demotes to one representative strike because the clip never
  puts two opposite plants next to each other
- **THEN** it emits no per-instant set at all, and `cropKeypoints` still names the opposite ankle as
  context — that ankle is part of what this one measurement is about, and there is no second instant
  for it to be misattributed to
