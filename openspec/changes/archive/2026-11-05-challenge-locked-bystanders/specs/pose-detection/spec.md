## MODIFIED Requirements

### Requirement: Steady-state tracking pays for a multi-pose call only at bounded, identifiable moments

The system SHALL NOT run a multi-pose detection pass on any call where a confident anchor already
exists, the reacquisition trigger has not fired, periodic re-verification is not yet due (see
"Periodic re-verification during steady-state tracking"), and the identity challenge is not yet
due (see "Identity challenge can move the anchor to a better-evidenced person") — those calls
remain the existing single-pose call (optionally wrapped by tracking-crop or, within a settle-in
window, by the settle-in window's own crop-mode call), unchanged, so the multi-pose pass's
additional cost is paid only at the moments identity is genuinely ambiguous or a periodic check is
due, not on every call.

#### Scenario: Confident, recently-verified steady-state tracking issues no multi-pose call

- **WHEN** a call's tracked anchor is confident, the reacquisition trigger has not fired, fewer
  than `REVERIFICATION_INTERVAL_FRAMES` calls have elapsed since the last (re)acquisition or
  re-verification event, and fewer than the identity challenge's current interval have elapsed
  since its last check
- **THEN** only the ordinary single-pose call is issued for that frame (optionally in crop mode,
  per `TrackingCropConfig.enabled` or an active settle-in window); no multi-pose model is invoked

## ADDED Requirements

### Requirement: Identity challenge can move the anchor to a better-evidenced person

While person-of-interest is enabled, not suspended, and an anchor is healthy (not stale), outside
a settle-in window, and on a call no other multi-pose trigger claims, the system SHALL
periodically run a multi-pose pass on a dedicated multi-pose instance with the library's tracker
and keypoint smoothing disabled, and decide whether the anchor should move to someone else. Every
scale comparison SHALL be made against the anchor's tracked single-pose box, never against the
anchor's multi-pose match.

- An identity is TENTATIVE until `identityChallenge.confirmationsToSettle` checks have re-picked
  it; any change of identity makes it tentative again. A tentative identity is checked every
  `tentativeIntervalFrames` ordinary calls: the acquisition heuristic is re-run over every usable
  candidate; the anchor's own continuous match winning is a confirmation; any other winner takes
  the anchor if its box is at least `tentativeMinAreaRatio` times the anchor's, or, when no
  candidate is continuous with the anchor, at least `1 / tentativeMinAreaRatio` times it.
- A SETTLED identity is checked every `settledIntervalFrames` ordinary calls. A candidate other
  than the anchor's continuous match whose box is at least `minAreaRatio` times the anchor's wins
  the check; the anchor moves once the same person (by the reacquisition continuity rule) has won
  `minConsecutiveWins` consecutive checks. A check that sees no usable candidate leaves the win
  streak unchanged; a check that sees candidates but no qualifying one ends it.
- A switch SHALL hand over exactly like a non-continuous re-verification switch: re-seed the
  anchor, start a settle-in window, reset the single-pose detector, and return the chosen
  candidate's frame for that call.
- A check that does not switch SHALL change no state other than its own interval, confirmation
  and streak bookkeeping, and SHALL fall through to the ordinary single-pose call for the same
  frame.

#### Scenario: A much larger runner entering after acquisition takes the anchor

- **WHEN** the anchor is a settled bystander and a different person at least `minAreaRatio` times
  the anchor's tracked box appears on two consecutive identity checks
- **THEN** the second check moves the anchor to that person, returns their frame, resets the
  single-pose detector and starts a settle-in window around them

#### Scenario: A tentative pick yields to someone the check can see when it cannot see the pick

- **WHEN** the anchor is tentative, the identity check finds no candidate continuous with it, and
  the acquisition winner's box is at least `1 / tentativeMinAreaRatio` times the anchor's
- **THEN** the anchor moves to the acquisition winner

#### Scenario: A near-tie keeps the incumbent

- **WHEN** the anchor is tentative and visible to the check, and another person wins acquisition
  with a box less than `tentativeMinAreaRatio` times the anchor's tracked box
- **THEN** the anchor does not move and the check is not a confirmation

#### Scenario: A check that does not switch is invisible to everything else

- **WHEN** an identity check does not switch
- **THEN** the ordinary single-pose call runs for the same frame and returns its result, and the
  shared multi-pose instance, the re-verification interval, the settle-in window and the loss
  counters are exactly as they would have been without the check

#### Scenario: The challenge can be turned off entirely

- **WHEN** `personOfInterest.identityChallenge.enabled` is `false`
- **THEN** no challenge multi-pose instance is created and no identity check ever runs

### Requirement: Seeded hand-off keeps the anchor across the end of a settle-in window

When a call switches the single-pose detector from crop mode back to the full frame while an
anchor exists and person-of-interest is enabled and not suspended, and the result of the plain
(reset) call is not continuous with the anchor, the system SHALL, when
`personOfInterest.seedHandOff` is `true`, retry that same frame once with the single-pose
detector's own crop region started from the anchor's keypoints (the region MoveNet itself derives
from a detection, per its `determineNextCropRegion` rule), and use the retry's result. A hand-off
whose plain result is already continuous with the anchor, or whose anchor yields no usable seed
(torso not visible, or a crop larger than half the frame's longer side), SHALL be left exactly as
it was.

#### Scenario: A runner at the frame edge survives the hand-off

- **WHEN** the settle-in window ends and the plain full-frame call returns a different person (or
  nothing) because the anchor lies outside MoveNet's centre-square initial crop
- **THEN** the frame is re-run with MoveNet's crop around the anchor, and the anchor is tracked

#### Scenario: A hand-off that already found the anchor costs nothing

- **WHEN** the plain full-frame call after a settle-in window returns a detection continuous with
  the anchor
- **THEN** no retry is made and the single-pose detector is not reset again
