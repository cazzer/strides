# results-view

## ADDED Requirements

### Requirement: Evidence already on screen survives a re-extraction

An analysis result is not final when it first renders: the background scale pass grafts its
centimetre metrics into the fused heuristics one clip-replay later, which legitimately changes what
some metrics' evidence should depict. The system SHALL absorb that second arrival without taking the
first arrival's imagery off the screen.

The system SHALL decide whether a clip's already-extracted evidence can be reused by comparing the
inputs that **determine the pixels** — the clip's extraction plan and the source blob the frames are
decoded from — and SHALL NOT key that decision on the identity of an upstream object that merely
contains them. A graft that replaces two of a result's metrics leaves the other metrics' plans
unchanged, and re-decoding a clip to reproduce images that were already correct is work whose only
observable effect is to remove them from the screen while it runs.

While a re-extraction is in flight for an unchanged set of clips, the system SHALL continue to
render the evidence produced by the previous pass, and SHALL replace it only when the new pass
settles. Evidence SHALL be withheld entirely only when none has ever been produced for the current
session.

Carrying evidence forward SHALL be conditional on the set of clips being unchanged. A section
addresses its source clip by position in the session's clip list, so a clip added or removed
invalidates that addressing; in that case the system SHALL withhold evidence rather than render an
image attributed to the wrong clip.

#### Scenario: The scale-pass graft does not blank the thumbnails

- **WHEN** a clip's evidence has been extracted and rendered, and the background scale pass then
  completes and grafts its centimetre metrics into that clip's heuristics
- **THEN** the thumbnails already on screen remain rendered continuously, and the cards' layout does
  not collapse and reflow, whether or not the graft causes a new extraction to run

#### Scenario: An unchanged plan re-decodes nothing

- **WHEN** an evidence input changes in a way that leaves every metric's extraction plan and the
  clip's source blob identical to the ones the cached evidence was extracted from
- **THEN** the cached images are reused, no detached decoder is opened for that clip, and the
  rendered evidence is the same set of images rather than an equivalent freshly-decoded set

#### Scenario: A changed plan re-extracts without a visible gap

- **WHEN** the graft changes a metric's plan, so that clip genuinely requires a new extraction pass
- **THEN** the previous pass's images stay on screen for the duration of the new pass, and are
  replaced by the new pass's images only once it settles

#### Scenario: Adding or removing a clip withholds evidence rather than mis-attributing it

- **WHEN** a clip is added to, or removed from, the session while evidence is on screen
- **THEN** the previous sections are not carried forward, because a section's clip index addresses a
  position in the clip list that the change has invalidated
