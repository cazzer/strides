## ADDED Requirements

### Requirement: Scale-pass detector is dedicated, cached, and exempt from the backend override

The system SHALL provide the background scale pass its own detector accessor that lazily creates
a `PoseDetector` hardcoded to the `mediapipePoseLandmarker` backend, caches the instance for the
page lifetime (no per-pass creation or disposal), resolves to `null` — never throws — when
creation fails, and resets its pending state on failure so a later run can retry. The accessor
SHALL NOT read `resolvePoseDetectorConfig()` or the `__STRIDES_POSE_BACKEND_OVERRIDE__` window
override: that override selects the PRIMARY pass's backend only, and the scale pass's backend is
not configurable.

#### Scenario: One detector serves every scale pass on the page

- **WHEN** the scale-pass detector is requested for a second analysis run after a first run
  already created it
- **THEN** the cached instance is returned and the underlying `createDetector` is not called
  again

#### Scenario: The backend override does not leak into the scale pass

- **WHEN** `window.__STRIDES_POSE_BACKEND_OVERRIDE__` selects a non-MediaPipe backend and the
  scale-pass detector is requested
- **THEN** the detector is still created with `{ backend: 'mediapipePoseLandmarker' }`

#### Scenario: Creation failure degrades to null and permits a retry

- **WHEN** the scale-pass detector's creation rejects
- **THEN** the accessor resolves to `null` rather than throwing, and a subsequent request
  attempts creation again instead of returning a cached failure
