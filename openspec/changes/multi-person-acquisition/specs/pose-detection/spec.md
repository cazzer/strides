## MODIFIED Requirements

### Requirement: A never-tracked segment is behavior-identical to the untracked baseline

The system SHALL, for any segment where the CONTINUOUS whole-clip tracking-crop optimization has
not engaged — including the entire clip when tracking-crop is disabled via configuration — call
the underlying MoveNet detector's `estimatePoses` with the video element directly, with no crop
canvas, no coordinate remapping, and no additional state tied to that optimization, so this
segment's behavior is provably unchanged from the pre-existing full-frame-only implementation.
This guarantee covers the continuous cropped-canvas optimization only: it does NOT extend to (a)
the multi-pose acquisition/reacquisition/re-verification path itself (see "Multi-pose acquisition
on the first detection of a run", "Multi-pose reacquisition applies regardless of tracking-crop
configuration", and "Periodic re-verification during steady-state tracking"), which runs at
acquisition, reacquisition, and periodic re-verification moments independent of whether
tracking-crop is enabled, nor (b) the bounded settle-in window of crop-mode calls that follows a
successful one of those events (see "Settle-in window follows a successful multi-pose selection
event"), which is this capability's own mechanism and is likewise independent of
`TrackingCropConfig.enabled`.

#### Scenario: A clip where tracking never engages behaves identically to today

- **WHEN** every call fails to produce a usable detection (or tracking-crop is configured
  disabled), AND no acquisition/reacquisition/re-verification event has ever succeeded (so no
  settle-in window is ever active)
- **THEN** every such call is `estimatePoses(video)` with no other arguments, matching the MoveNet
  backend's behavior before this capability existed

#### Scenario: Disabling tracking-crop is a total kill-switch

- **WHEN** `TrackingCropConfig.enabled` is `false`
- **THEN** no crop canvas is ever used for the CONTINUOUS whole-clip crop optimization, and no
  crop-mode tracking state tied to that optimization is read or written across calls — every call
  outside an acquisition/reacquisition/re-verification moment, and outside any settle-in window
  following one, runs the full-frame path regardless of what would otherwise have engaged or
  disengaged crop-mode tracking — but the multi-pose acquisition/reacquisition/re-verification
  path still runs at the moments it is defined to run, and a bounded settle-in window of crop-mode
  calls (see "Settle-in window follows a successful multi-pose selection event") still follows a
  successful one of those events regardless of this config value, since that window is this
  capability's own mechanism, not the continuous whole-clip optimization `TrackingCropConfig`
  gates

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
  known bounding box; if it fails to select a usable candidate, every call after that runs the
  ordinary full-frame single-pose path, unchanged from the behavior of a never-tracked segment,
  until tracking re-engages; if it succeeds, a bounded settle-in window of crop-mode calls (see
  "Settle-in window follows a successful multi-pose selection event") follows immediately
  regardless of `TrackingCropConfig.enabled`, after which ordinary tracking (full-frame or
  continuously cropped, per `TrackingCropConfig.enabled`) resumes

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

### Requirement: Steady-state tracking pays for a multi-pose call only at bounded, identifiable moments

The system SHALL NOT run a multi-pose detection pass on any call where a confident anchor already
exists, the reacquisition trigger has not fired, and periodic re-verification is not yet due (see
"Periodic re-verification during steady-state tracking") — those calls remain the existing
single-pose call (optionally wrapped by tracking-crop or, within a settle-in window, by the
settle-in window's own crop-mode call), unchanged, so the multi-pose pass's additional cost is
paid only at the moments identity is genuinely ambiguous or a periodic check is due, not on every
call.

#### Scenario: Confident, recently-verified steady-state tracking issues no multi-pose call

- **WHEN** a call's tracked anchor is confident, the reacquisition trigger has not fired, and
  fewer than `REVERIFICATION_INTERVAL_FRAMES` calls have elapsed since the last (re)acquisition or
  re-verification event
- **THEN** only the ordinary single-pose call is issued for that frame (optionally in crop mode,
  per `TrackingCropConfig.enabled` or an active settle-in window); no multi-pose model is invoked

### Requirement: Settle-in window follows a successful multi-pose selection event

The system SHALL, for `POST_ACQUISITION_SETTLE_FRAMES` calls immediately following any call where
a multi-pose acquisition, reacquisition, or periodic re-verification event selects a usable
candidate, run those calls in crop mode around the selected/reconfirmed bounding box — using the
same crop-canvas mechanism `TrackingCropConfig`-driven crop-mode tracking already uses
(`computeCropRect`, the reusable crop canvas, remapping returned keypoints back to source-video
pixel space) — independent of `TrackingCropConfig.enabled`. Each settle-in call re-derives the
tracked bounding box from its own fresh detection exactly as ordinary crop-mode steady-state
tracking already does, so tracking state never goes stale during the window; the window's purpose
is to give the single-pose detector a run of calls actually centered on the just-identified person
before any continuous whole-clip crop optimization (or lack thereof) takes over, since nothing
about a multi-pose selection otherwise carries forward into the single-pose detector's own next
call.

#### Scenario: A successful acquisition engages the settle-in window

- **WHEN** a multi-pose acquisition call selects a usable candidate
- **THEN** the next `POST_ACQUISITION_SETTLE_FRAMES` calls run in crop mode around the selected
  bounding box, regardless of `TrackingCropConfig.enabled`

#### Scenario: A successful reacquisition engages the settle-in window

- **WHEN** a multi-pose reacquisition call (confidence-triggered or periodic) selects a usable
  candidate
- **THEN** the next `POST_ACQUISITION_SETTLE_FRAMES` calls run in crop mode around the selected
  bounding box, regardless of `TrackingCropConfig.enabled`

#### Scenario: The settle-in window is a no-op when tracking-crop is already continuously enabled

- **WHEN** `TrackingCropConfig.enabled` is `true` at the moment a settle-in window would otherwise
  engage
- **THEN** no additional crop-mode calls are triggered beyond what the continuous whole-clip
  optimization already runs — the settle-in window never causes observably different behavior in
  this configuration

#### Scenario: The settle-in window expires after its configured length

- **WHEN** `POST_ACQUISITION_SETTLE_FRAMES` calls have elapsed since the settle-in window last
  engaged, with no intervening acquisition/reacquisition/re-verification event to restart it
- **THEN** subsequent calls return to ordinary framing — crop mode only if
  `TrackingCropConfig.enabled`, full-frame otherwise — until the window is next triggered

### Requirement: Periodic re-verification during steady-state tracking

The system SHALL, every `REVERIFICATION_INTERVAL_FRAMES` calls since the last (re)acquisition or
re-verification event, run a multi-pose detection pass and score the returned candidates for
continuity against the current tracked anchor (the same heuristic and code path confidence-
triggered reacquisition already uses), even when the anchor's confidence has not dropped below
the usability gate — since MoveNet's own saliency can drift smoothly onto a different person
without the confidence-based reacquisition trigger ever firing. A continuous match resets the
re-verification interval counter. A non-continuous match (the multi-pose pass disagrees with what
the single-pose detector has been tracking) is treated exactly as a non-continuous confidence-
triggered reacquisition already is: the underlying single-pose detector's internal state is reset,
the anchor is re-seeded from the newly-selected candidate, and a settle-in window begins. An empty
or not-usable periodic check is a strict no-op on every piece of tracking state except the
re-verification interval counter itself — it must never be able to degrade steady-state tracking
that was already working.

#### Scenario: The periodic interval triggers a re-verification call

- **WHEN** `REVERIFICATION_INTERVAL_FRAMES` calls have elapsed since the last (re)acquisition or
  re-verification event, and the anchor is confident (the confidence-triggered reacquisition
  trigger has not fired)
- **THEN** the next call is a multi-pose re-verification call scored by continuity against the
  current anchor, not an ordinary single-pose call

#### Scenario: A continuous re-verification match resets the interval

- **WHEN** a periodic re-verification call selects a candidate continuous with the current anchor
  (matched by IoU or proximity)
- **THEN** the re-verification interval counter resets, and steady-state tracking continues
  unaffected otherwise

#### Scenario: A non-continuous re-verification match corrects tracking onto the right person

- **WHEN** a periodic re-verification call's candidates have no meaningful IoU or proximity match
  against the current anchor, so the selection falls through to the acquisition heuristic
- **THEN** the underlying single-pose detector's internal state is reset, the anchor is re-seeded
  from the newly-selected candidate, and a settle-in window begins around it — the same treatment
  a non-continuous confidence-triggered reacquisition already receives

#### Scenario: An empty or unusable periodic check does not degrade existing tracking

- **WHEN** a periodic re-verification call returns zero candidates, or candidates none of which
  clear the usability gate
- **THEN** the current anchor, its loss counters, and the give-up budget are left completely
  untouched — only the re-verification interval counter resets, so the next periodic check is
  attempted after another full interval rather than every subsequent call
