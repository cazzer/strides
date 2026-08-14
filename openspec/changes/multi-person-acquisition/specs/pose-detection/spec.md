## MODIFIED Requirements

### Requirement: A never-tracked segment is behavior-identical to the untracked baseline

The system SHALL, for any segment where tracking-crop has not engaged — including the entire
clip when tracking-crop is disabled via configuration — call the underlying MoveNet detector's
`estimatePoses` with the video element directly, with no crop canvas, no coordinate remapping,
and no additional state, so this segment's behavior is provably unchanged from the pre-existing
full-frame-only implementation. This guarantee covers the cropped-canvas optimization only: it
does NOT extend to the multi-pose acquisition/reacquisition path (see "Multi-pose acquisition on
the first detection of a run" and "Multi-pose reacquisition applies regardless of tracking-crop
configuration"), which runs at acquisition and reacquisition moments independent of whether
tracking-crop is enabled.

#### Scenario: A clip where tracking never engages behaves identically to today

- **WHEN** every call fails to produce a usable detection (or tracking-crop is configured
  disabled)
- **THEN** every call outside an acquisition or reacquisition moment is `estimatePoses(video)`
  with no other arguments, matching the MoveNet backend's behavior before this capability existed

#### Scenario: Disabling tracking-crop is a total kill-switch

- **WHEN** `TrackingCropConfig.enabled` is `false`
- **THEN** no crop canvas is ever used and no crop-mode tracking state is read or written across
  calls — every call outside an acquisition or reacquisition moment runs the full-frame path
  regardless of what would otherwise have engaged or disengaged crop-mode tracking — but the
  multi-pose acquisition/reacquisition path still runs at the moments it is defined to run

### Requirement: Tracking-crop reacquisition loss falls back to full-frame detection

The system SHALL fall back to running MoveNet against the full, unmodified video frame — the
same call path used when nothing has ever been tracked — after `reacquisitionLossThreshold`
consecutive crop-mode calls fail to produce a usable detection, rather than continuing to crop
around a stale, no-longer-valid bounding box indefinitely. When this fallback is reached, the
first full-frame call after the threshold is met is a multi-pose reacquisition call (see "Multi-
pose reacquisition applies regardless of tracking-crop configuration"), not a plain single-pose
call, so the fallback has a chance to reselect the same person rather than whichever person the
single-pose model's own internal saliency happens to land on next.

#### Scenario: Sustained tracking loss falls back to full-frame detection

- **WHEN** `reacquisitionLossThreshold` consecutive crop-mode calls each fail to produce a usable
  detection (either no pose detected, or too few confident keypoints)
- **THEN** the next call is a multi-pose reacquisition call scored by continuity against the last
  known bounding box, and every call after that (until tracking re-engages) runs the ordinary
  full-frame single-pose path, unchanged from the behavior of a never-tracked segment

#### Scenario: A single low-confidence frame does not drop tracking

- **WHEN** a crop-mode call fails to produce a usable detection, but fewer than
  `reacquisitionLossThreshold` consecutive such failures have occurred
- **THEN** the next call still runs in crop mode, using the most recently tracked bounding box

## ADDED Requirements

### Requirement: Multi-pose acquisition on the first detection of a run

The system SHALL, for the first call of an analysis run that has not yet produced any usable
detection (no prior bounding box exists for this run), run a multi-pose detection pass
(`MULTIPOSE_LIGHTNING`) instead of the ordinary single-pose call, and select among the returned
candidate poses using an acquisition heuristic scored by each candidate's bounding-box area
weighted by its mean keypoint confidence. The selected candidate's keypoints are mapped to the
resulting `PoseFrame`, and its bounding box seeds tracking state for subsequent calls exactly as
a usable single-pose detection would.

#### Scenario: Multiple people present at first detection

- **WHEN** the first successful multi-pose acquisition call returns more than one candidate pose
- **THEN** the candidate with the highest bbox-area-weighted-by-confidence score is selected, and
  every other candidate is discarded

#### Scenario: Exactly one person present at first detection

- **WHEN** the first successful multi-pose acquisition call returns exactly one candidate pose
- **THEN** that candidate is selected, producing a `PoseFrame` equivalent to what the single-pose
  path would have produced for the same person

#### Scenario: No candidates returned

- **WHEN** a multi-pose acquisition call returns zero candidate poses
- **THEN** `estimatePose` resolves to `null` for that call, and the next call is also treated as
  an acquisition attempt (no tracking state was seeded)

### Requirement: Multi-pose reacquisition applies regardless of tracking-crop configuration

The system SHALL treat sustained loss of confidence in the current tracked anchor as a
reacquisition trigger independent of whether `TrackingCropConfig.enabled` is `true` or `false` —
today, loss is only ever counted in crop mode, so the default (`enabled: false`) configuration
has no loss signal to trigger on at all. When the trigger fires, the system SHALL run a
multi-pose detection pass and select among the returned candidates using a reacquisition
heuristic scored by IoU/proximity continuity against the last known bounding box, rather than
allowing the next full-frame single-pose call to land on whichever person the model's own
internal saliency happens to prefer.

#### Scenario: Sustained low confidence with tracking-crop disabled triggers reacquisition

- **WHEN** `TrackingCropConfig.enabled` is `false` and a threshold number of consecutive calls
  produce a detection with too few confident keypoints to count as usable
- **THEN** the next call is a multi-pose reacquisition call, not an ordinary full-frame
  single-pose call

#### Scenario: The previously tracked person is favored over a more prominent bystander

- **WHEN** a multi-pose reacquisition call returns multiple candidates, one of which overlaps or
  sits near the last known bounding box and another of which has a larger bbox-area-weighted-by-
  confidence score
- **THEN** the candidate scored by continuity against the last known bounding box is selected,
  not the candidate the acquisition heuristic alone would prefer

#### Scenario: No candidate matches the last known position

- **WHEN** a multi-pose reacquisition call returns candidates, none of which meaningfully overlap
  or sit near the last known bounding box
- **THEN** the system falls back to the acquisition heuristic (bbox area weighted by mean
  keypoint confidence) among the returned candidates, treating this call as a fresh acquisition

### Requirement: Steady-state tracking is unaffected by the multi-pose acquisition/reacquisition path

The system SHALL NOT run a multi-pose detection pass on any call where a confident anchor already
exists and the reacquisition trigger has not fired — those calls remain the existing single-pose
call (optionally wrapped by tracking-crop), unchanged, so the multi-pose pass's additional cost is
paid only at the moments identity is genuinely ambiguous.

#### Scenario: Confident steady-state tracking issues no multi-pose call

- **WHEN** a call's tracked anchor is confident and the reacquisition trigger has not fired
- **THEN** only the ordinary single-pose call is issued for that frame; no multi-pose model is
  invoked
