## ADDED Requirements

### Requirement: Steady-state anchor acceptance requires continuity with the existing anchor

The system SHALL, on an ordinary steady-state call (one that did not dispatch a multi-pose
acquisition, reacquisition, or re-verification pass) that produces a usable detection while a
person-of-interest anchor already exists, accept that detection's bounding box as the new anchor
only if it is continuous with the existing anchor in BOTH position and scale. A usable detection
that is not continuous SHALL NOT become the anchor, SHALL NOT reset the reacquisition-loss
counter or any multi-pose episode state, and SHALL instead be counted as a tracking loss, so that
`reacquisitionLossThreshold` can be reached and the multi-pose reacquisition path — which scores
continuity across every simultaneously visible candidate — is given the chance to recover.

Position continuity SHALL be satisfied when the derived bounding box has non-zero
intersection-over-union with the existing anchor, OR when the distance between the two boxes'
centers is within `maxCenterSpeedSidesPerSecond` multiplied by the anchor's own side
(`max(width, height)`) and by the elapsed time since the previous call. Scale continuity SHALL be
satisfied when the ratio of the derived box's area to the anchor's area lies within
`[1 / maxAreaRatio, maxAreaRatio]`.

The call SHALL still return the `PoseFrame` it detected, whether or not the gate accepted it —
this gate governs which person the backend considers tracked, not whether a frame is emitted.

#### Scenario: A confidently detected bystander does not steal the anchor

- **WHEN** a steady-state call returns a usable detection whose bounding box neither overlaps the
  existing anchor nor lies within the elapsed-time-scaled distance bound, or whose area differs
  from the anchor's by more than `maxAreaRatio`
- **THEN** the anchor is left unchanged, the reacquisition-loss counter is incremented rather than
  reset, and the detected `PoseFrame` is still returned to the caller

#### Scenario: Sustained rejection reaches the existing reacquisition path

- **WHEN** `reacquisitionLossThreshold` consecutive steady-state calls each produce a detection
  the continuity gate rejects
- **THEN** the anchor is stale and the next call dispatches a multi-pose reacquisition scored by
  continuity against the last known bounding box, exactly as it does for any other sustained
  tracking loss

#### Scenario: Ordinary frame-to-frame motion is unaffected

- **WHEN** a steady-state call's derived bounding box overlaps the existing anchor at all, and its
  area is within `maxAreaRatio` of the anchor's
- **THEN** it is accepted as the new anchor and every counter is reset, exactly as before this
  gate existed

#### Scenario: The gate does not apply when there is nothing to be continuous with

- **WHEN** no anchor currently exists, or the person-of-interest capability is disabled, or the
  run has suspended person-of-interest disambiguation after exhausting its reacquisition budget
- **THEN** the first usable detection is accepted as the anchor unconditionally, as it was before
  this gate existed

#### Scenario: A settle-in call is held to the same continuity requirement

- **WHEN** a call inside the bounded settle-in window following a multi-pose selection event
  produces a usable detection
- **THEN** it is subject to the same continuity gate, scored against the just-selected anchor

### Requirement: A periodic re-verification match claiming continuity must be scale-plausible

The system SHALL, when a periodic re-verification pass selects a candidate whose selection was
scored as CONTINUOUS with the existing anchor, additionally require that candidate's bounding-box
area to lie within `[1 / maxAreaRatio, maxAreaRatio]` of the anchor's before adopting its box.
A claimed-continuous selection failing that check SHALL be treated exactly as the existing "raw
candidates but none usable during a periodic check" case: the anchor, the reacquisition-loss
counter, and every multi-pose episode counter are left untouched, only the re-verification
interval resets, and the call falls through to the ordinary single-pose call for that same frame.

The selection heuristic's own continuity test is intersection-over-union and centre proximity
only, with no scale term, so a candidate overlapping the anchor is scored continuous however
differently sized it is — and then replaces the anchor with its own box. A collapsed anchor is
worse than no gate at all, because the steady-state continuity gate then defends the collapsed box
and begins rejecting genuine full-size detections of the real subject.

This requirement SHALL NOT extend to a selection scored as NON-continuous. That case is an
explicit "the tracked person is gone, here is the salient one now" switch, which is the purpose
periodic re-verification exists to serve; a large scale change is expected there and is usually
the very reason the switch is happening.

#### Scenario: An overlapping but far smaller re-verification match does not collapse the anchor

- **WHEN** a periodic re-verification pass selects a candidate scored continuous with the anchor,
  whose bounding-box area differs from the anchor's by more than `maxAreaRatio`
- **THEN** the anchor is unchanged, no settle-in window starts, the underlying detector is not
  reset, the re-verification interval resets, and the call falls through to the ordinary
  single-pose call for that same frame

#### Scenario: A deliberate non-continuous identity switch is still allowed at any scale

- **WHEN** a periodic re-verification pass selects a candidate scored NON-continuous with the
  anchor, at any bounding-box area
- **THEN** it re-seeds the anchor, resets the underlying detector, and starts a settle-in window,
  exactly as it does when this gate is disabled

### Requirement: Anchor continuity gate is configurable through the existing backend override

The system SHALL expose the continuity gate's kill switch and both of its thresholds as a nested
`continuityGate` object on `PersonOfInterestConfig` — `enabled`,
`maxCenterSpeedSidesPerSecond`, and `maxAreaRatio` — resolved by the existing
`resolvePoseDetectorConfig()` so the development-only `window.__STRIDES_POSE_BACKEND_OVERRIDE__`
surface covers it alongside backend, model variant, tracking-crop, and person-of-interest
selection, rather than introducing a separate override surface. A partial override of the nested
object SHALL merge field-by-field over the defaults rather than replacing the whole object.

#### Scenario: The gate can be disabled without disabling multi-pose dispatch

- **WHEN** `personOfInterest.continuityGate.enabled` is `false` while
  `personOfInterest.enabled` is `true`
- **THEN** steady-state anchor acceptance behaves as it did before this gate existed, while
  multi-pose acquisition, reacquisition, and periodic re-verification still run

#### Scenario: A partial gate override preserves the other gate fields

- **WHEN** the development-only backend override supplies only one of the `continuityGate` fields
- **THEN** that field takes the overridden value and the remaining fields keep their defaults

## MODIFIED Requirements

### Requirement: A never-tracked segment is behavior-identical to the untracked baseline

The system SHALL, for any segment where the CONTINUOUS whole-clip tracking-crop optimization has
not engaged — including the entire clip when tracking-crop is disabled via configuration — call
the underlying MoveNet detector's `estimatePoses` with the video source directly, with no crop
canvas and no coordinate remapping, so this segment's behavior is provably unchanged from the
pre-existing full-frame-only implementation.

That call SHALL supply the frame's own timestamp, in milliseconds, as `estimatePoses`' third
argument, in the same units the crop-mode call site already uses. The underlying model applies
its built-in per-keypoint temporal smoothing only when a timestamp is available, and derives one
implicitly only when the image source exposes `currentTime` — so omitting it silently disables
smoothing for any source that is not an `HTMLVideoElement`, including the reusable canvas the
sequential-decode sampler draws into. Supplying it explicitly makes the full-frame path's
smoothing behavior identical regardless of which sampler produced the frame, and matches what the
video-element source produced implicitly before the sequential-decode sampler became the default.

This guarantee covers the continuous cropped-canvas optimization only: it does NOT extend to (a)
the multi-pose acquisition/reacquisition/re-verification path itself (see "Multi-pose acquisition
on the first detection of a run", "Multi-pose reacquisition applies regardless of tracking-crop
configuration", and "Periodic re-verification during steady-state tracking"), which runs at
acquisition, reacquisition, and periodic re-verification moments independent of whether
tracking-crop is enabled, nor (b) the bounded settle-in window of crop-mode calls that follows a
successful one of those events (see "Settle-in window follows a successful multi-pose selection
event"), which is this capability's own mechanism and is likewise independent of
`TrackingCropConfig.enabled`.

The combined kill-switch path — tracking-crop disabled AND person-of-interest disabled — is
exempt from the timestamp requirement above and SHALL continue to call `estimatePoses` with the
image source as its only argument. That path performs no new-run reset of the underlying
detector, so supplying timestamps there would hand the model's smoothing filter a non-monotonic
series across separate analysis runs; it exists to reproduce pre-capability behavior exactly, and
that includes deriving a timestamp only when the source itself carries one.

#### Scenario: A clip where tracking never engages behaves identically to today

- **WHEN** every call fails to produce a usable detection (or tracking-crop is configured
  disabled), AND no acquisition/reacquisition/re-verification event has ever succeeded (so no
  settle-in window is ever active)
- **THEN** every such call is `estimatePoses(videoSource, undefined, timestampMs)` with no crop
  canvas and no coordinate remapping, matching the MoveNet backend's full-frame behavior

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

#### Scenario: The combined kill-switch path passes no timestamp

- **WHEN** both `TrackingCropConfig.enabled` and `PersonOfInterestConfig.enabled` are `false`
- **THEN** every call is `estimatePoses(imageSource)` with no further arguments, byte-identical to
  this backend's behavior before the tracking-crop and person-of-interest capabilities existed
