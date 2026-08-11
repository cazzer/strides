# video-quality-gate Specification

## Purpose
Provide a whole-clip, pre-analysis quality assessment — resolution, frame rate, and a
detection-confidence sample against a few frames spread across the clip — so a user is warned,
with specifics, before running full analysis against footage unlikely to produce trustworthy
metrics, and can explicitly choose to proceed anyway rather than being silently misled or hard
blocked.
## Requirements
### Requirement: Quality check result contract
The system SHALL represent each of the three quality checks (resolution, frame rate, confidence)
as an independent `QualityCheckResult` with a `status` of exactly one of `'pass'`, `'fail'`,
`'skipped'`, or `'error'`, an observed `value`, the `threshold` it was compared against (`null`
when not applicable), and a user-facing `message` populated only for `'fail'`/`'error'`.

#### Scenario: Skipped and error statuses carry no message obligation beyond error context
- **WHEN** a check's status is `'skipped'`
- **THEN** its `message` is `null` — nothing failed, there is nothing to tell the user

#### Scenario: Fail and error statuses populate a user-facing message
- **WHEN** a check's status is `'fail'` or `'error'`
- **THEN** its `message` is a non-null, plain-language string suitable for direct display

### Requirement: Fail-open overall verdict
The system SHALL compute `VideoQualityAssessment.overall` as `'warn'` if and only if at least one
of the three checks has `status === 'fail'`; a `'skipped'` or `'error'` check SHALL never cause
`overall` to be `'warn'` on its own.

#### Scenario: All checks passing yields an overall pass
- **WHEN** resolution, frame rate, and confidence all report `status: 'pass'`
- **THEN** `overall` is `'pass'`

#### Scenario: A single failing check yields an overall warning, even with others passing
- **WHEN** exactly one check reports `status: 'fail'` and the other two report `status: 'pass'`
- **THEN** `overall` is `'warn'`

#### Scenario: Skipped and errored checks never flip the verdict
- **WHEN** frame rate is `'skipped'` (unknown for an upload) and the detector is unavailable so
  confidence is `'error'`, while resolution is `'pass'`
- **THEN** `overall` is `'pass'` — the gate fails open when a check cannot render a verdict

### Requirement: Resolution check
The system SHALL evaluate the resolution check on every assessed video by comparing the shorter of
`metadata.width`/`metadata.height` against `MIN_SHORT_SIDE_PX`, and SHALL never report this check
as `'skipped'`.

#### Scenario: Resolution at or above the minimum passes
- **WHEN** `Math.min(metadata.width, metadata.height) >= MIN_SHORT_SIDE_PX`
- **THEN** the resolution check reports `status: 'pass'`

#### Scenario: Resolution below the minimum fails with a specific message
- **WHEN** `Math.min(metadata.width, metadata.height) < MIN_SHORT_SIDE_PX`
- **THEN** the resolution check reports `status: 'fail'` with a non-null message identifying
  resolution as the problem

### Requirement: Frame rate check is best-effort
The system SHALL evaluate the frame rate check by comparing `metadata.frameRate` against
`MIN_FRAME_RATE_FPS` only when `metadata.frameRate` is not `null`, and SHALL report `status:
'skipped'` when it is `null` — the case for every file upload and for any webcam recording that
did not yield a `frameRateHint`.

#### Scenario: Unknown frame rate is skipped, not failed
- **WHEN** `metadata.frameRate` is `null`
- **THEN** the frame rate check reports `status: 'skipped'`, `value: null`, `message: null`

#### Scenario: Known frame rate at or above the minimum passes
- **WHEN** `metadata.frameRate` is a number `>= MIN_FRAME_RATE_FPS`
- **THEN** the frame rate check reports `status: 'pass'`

#### Scenario: Known frame rate below the minimum fails with a specific message
- **WHEN** `metadata.frameRate` is a number `< MIN_FRAME_RATE_FPS`
- **THEN** the frame rate check reports `status: 'fail'` with a non-null message identifying
  frame rate as the problem

### Requirement: Detection-confidence sample
The system SHALL evaluate a detection-confidence check by seeking the video to `sampleCount`
timestamps spread across the trimmed middle of the clip, running the injected `PoseDetector` at
each, and comparing the average fraction of keypoints scoring at or above
`VISIBLE_KEYPOINT_SCORE` against `MIN_AVG_VISIBLE_FRACTION`.

#### Scenario: No detector available reports error, not fail
- **WHEN** `detector` is `null`
- **THEN** the confidence check reports `status: 'error'`, `value: null`, and a non-null message,
  without attempting to seek or sample

#### Scenario: Sufficient average visibility passes
- **WHEN** the average fraction of keypoints scoring `>= VISIBLE_KEYPOINT_SCORE` across all
  samples is `>= MIN_AVG_VISIBLE_FRACTION`
- **THEN** the confidence check reports `status: 'pass'`

#### Scenario: Insufficient average visibility fails with a specific message
- **WHEN** the average visible fraction across samples is `< MIN_AVG_VISIBLE_FRACTION`
- **THEN** the confidence check reports `status: 'fail'` with a non-null message identifying
  detection confidence (lighting/visibility) as the problem

#### Scenario: A single failed or null sample degrades, not aborts, the average
- **WHEN** one sampled frame's `estimatePose` call throws or resolves to `null`, while other
  samples succeed
- **THEN** that sample counts as a 0-visible-fraction sample in the average, and sampling
  continues for the remaining timestamps rather than aborting the check

#### Scenario: Sampling avoids the clip's start and end
- **WHEN** timestamps are generated for a clip long enough to trim (`durationSec > 3`)
- **THEN** no sampled timestamp falls within the first or last 10% of `durationSec`

#### Scenario: Playhead is restored after sampling
- **WHEN** the confidence check finishes sampling, whether it passes, fails, or a sample throws
- **THEN** the video's `currentTime` is seeked back to its value from before the check began

### Requirement: Quality gate hook lifecycle
The system SHALL provide a `useVideoQualityGate(videoSource)` hook that runs the full assessment
whenever `videoSource.status` transitions to `'ready'` for a newly loaded clip, exposing
`status` (`'idle' | 'assessing' | 'ready' | 'error'`), the resulting `assessment`, a `dismissed`
flag, and a `proceedAnyway()` action.

#### Scenario: Assessment runs on video-ready and reaches a ready state
- **WHEN** `videoSource.status` becomes `'ready'`
- **THEN** the hook's `status` transitions to `'assessing'` and then to `'ready'` once the
  assessment resolves, with `assessment` populated

#### Scenario: Dismissal resets on a newly loaded clip
- **WHEN** a video has been dismissed (`dismissed === true`) and the user loads a different clip
  that reaches `'ready'`
- **THEN** `dismissed` resets to `false` for the new clip's assessment

#### Scenario: Proceeding anyway dismisses the current warning
- **WHEN** `proceedAnyway()` is called
- **THEN** `dismissed` becomes `true` and stays `true` until a new clip reaches `'ready'`

#### Scenario: A superseded assessment is discarded, not applied
- **WHEN** a second clip is loaded and reaches `'ready'` before the first clip's assessment has
  resolved
- **THEN** the first (now-stale) assessment's result, when it eventually resolves, does not
  overwrite the hook's state — the final `assessment` reflects only the second clip

#### Scenario: Detector reused across clips, disposed on unmount
- **WHEN** multiple clips are loaded in sequence during one mount of the hook
- **THEN** at most one `PoseDetector` is created for the hook's lifetime, and it is `dispose()`d
  only when the hook unmounts

### Requirement: Quality warning banner
The system SHALL provide a `QualityWarningBanner` that renders nothing while the gate's `status`
is not `'ready'` (except a lightweight in-progress notice while `'assessing'`), renders nothing
when the assessment's `overall` is `'pass'`, renders nothing once `dismissed` is `true`, and
otherwise lists every failed check's message alongside a control that calls `proceedAnyway()`.

#### Scenario: Assessing state shows a non-alarming status notice
- **WHEN** `status === 'assessing'`
- **THEN** the banner renders a `role="status"` element indicating a quality check is in progress,
  with no failed-check content

#### Scenario: Passing assessment renders nothing
- **WHEN** `status === 'ready'` and `assessment.overall === 'pass'`
- **THEN** the banner renders nothing

#### Scenario: Warning assessment renders an alert listing failed checks
- **WHEN** `status === 'ready'`, `assessment.overall === 'warn'`, and `dismissed === false`
- **THEN** the banner renders a `role="alert"` element listing the `message` of every check with
  `status: 'fail'` (skipping any check without a message) and a "Proceed anyway" control

#### Scenario: Dismissed warning renders nothing
- **WHEN** `dismissed === true`
- **THEN** the banner renders nothing, regardless of `assessment.overall`

#### Scenario: Proceeding anyway invokes the callback
- **WHEN** the user activates the "Proceed anyway" control
- **THEN** the banner calls the `proceedAnyway` callback passed in via props

