## MODIFIED Requirements

### Requirement: Evidence already on screen survives a re-extraction

An analysis result is not final when it first renders: the background scale pass grafts its
centimetre metrics into the fused heuristics one clip-replay later, which legitimately changes what
some metrics' evidence should depict. The system SHALL absorb that second arrival without taking the
first arrival's imagery off the screen.

The system SHALL decide whether already-extracted evidence can be reused **per metric**, by comparing
the inputs that **determine that metric's pixels**: that metric's own entry in the clip's extraction
plan, and the source blob the frames are decoded from. It SHALL NOT key that decision on the identity
of an upstream object that merely contains them. A graft that replaces two of a result's metrics
leaves the other metrics' plan entries unchanged, and re-decoding images that were already correct is
work whose only observable effect is delay. A re-extraction SHALL decode only the metrics with no
reusable evidence, and SHALL return every reused metric's images as the same image elements.

Only a **complete** metric SHALL be reusable: one whose extraction produced every image its plan entry
asked for. A metric whose extraction failed, or produced fewer images than planned (for example
because a seek timed out), SHALL be decoded again by the next pass even when its plan entry and
source blob are unchanged, rather than having its failure reused.

A metric that a pass finished in full before that pass was superseded SHALL be reusable by the pass
that superseded it. Nothing else from a superseded pass SHALL be rendered or reused.

While a re-extraction is in flight for an unchanged set of clips, the system SHALL continue to
render the evidence produced by the previous pass, and SHALL replace it only when the new pass
settles. For a metric with nothing on screen, the system MAY render, before the new pass settles,
complete evidence that pass already holds for its own plan; that SHALL never replace an image already
on screen. Evidence SHALL be withheld entirely only when none has ever been produced for the current
session.

Carrying evidence forward, and rendering held evidence before the pass settles, SHALL be conditional
on the set of clips being unchanged. A section addresses its source clip by position in the session's
clip list, so a clip added or removed invalidates that addressing; in that case the system SHALL
withhold evidence rather than render an image attributed to the wrong clip.

#### Scenario: The scale-pass graft does not blank the thumbnails

- **WHEN** a clip's evidence has been extracted and rendered, and the background scale pass then
  completes and grafts its centimetre metrics into that clip's heuristics
- **THEN** the thumbnails already on screen remain rendered continuously, and the cards' layout does
  not collapse and reflow, whether or not the graft causes a new extraction to run

#### Scenario: An unchanged plan re-decodes nothing

- **WHEN** an evidence input changes in a way that leaves a metric's plan entry and the clip's source
  blob identical to the ones that metric's complete cached evidence was extracted from
- **THEN** that metric's cached images are reused as the same image elements rather than an
  equivalent freshly-decoded set, and where every planned metric of a clip is reused in this way no
  detached decoder is opened for that clip

#### Scenario: A changed plan re-decodes only the metrics whose plan moved

- **WHEN** the graft changes one metric's plan entry and leaves the others unchanged
- **THEN** only that metric's instants are seeked and drawn, and every other metric's images are the
  same image elements as before

#### Scenario: A failed or partial metric is retried

- **WHEN** a pass finishes with a metric whose extraction failed, or produced fewer images than its
  plan entry asked for, and a later pass runs with that metric's plan entry and source blob unchanged
- **THEN** the later pass decodes that metric again instead of reusing the earlier outcome

#### Scenario: A superseded pass's finished metrics are kept

- **WHEN** an extraction pass has finished some metrics in full and is then superseded by a pass
  whose plan entries for those metrics are unchanged
- **THEN** the superseding pass reuses those metrics' images without seeking them, and the superseded
  pass's own result is never rendered

#### Scenario: A held image appears before the pass settles without replacing one on screen

- **WHEN** a re-extraction is in flight for an unchanged set of clips, and it already holds complete
  evidence for a metric that has nothing on screen
- **THEN** that metric renders the held images instead of a pending placeholder, while a metric whose
  previous image is on screen keeps showing it until the pass settles

#### Scenario: A changed plan re-extracts without a visible gap

- **WHEN** the graft changes a metric's plan, so that clip genuinely requires a new extraction pass
- **THEN** the previous pass's images stay on screen for the duration of the new pass, and are
  replaced by the new pass's images only once it settles

#### Scenario: Adding or removing a clip withholds evidence rather than mis-attributing it

- **WHEN** a clip is added to, or removed from, the session while evidence is on screen
- **THEN** the previous sections are not carried forward, and no held evidence is rendered before the
  pass settles, because a section's clip index addresses a position in the clip list that the change
  has invalidated
