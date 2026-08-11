# video-input Specification

## Purpose
Lets a user get a running-form video into the app either by recording with
their webcam or by uploading a local file, and guarantees both paths hand
downstream analysis the exact same video contract.
## Requirements
### Requirement: Unified video source contract
Both the webcam-record path and the file-upload path SHALL resolve to the
same `src`-backed (blob-URL) `HTMLVideoElement`, exposed via a stable
`RefObject`, plus a metadata object (`durationSec`, `width`, `height`,
`frameRate`). Consuming code SHALL NOT need to know or special-case whether
the video was recorded or uploaded.

#### Scenario: Recorded video matches uploaded video shape
- **WHEN** a video is produced by stopping a webcam recording
- **THEN** the resulting video source has the same `status`/`metadata`/`error`
  shape, and the same kind of `src`-backed `<video>` element, as a video
  produced by uploading a file

#### Scenario: Live camera stream never reaches downstream consumers
- **WHEN** the user is actively recording via webcam
- **THEN** the canonical video element exposed to the rest of the app is not
  attached to the live `MediaStream` (no `srcObject`); only the internal
  recording preview is stream-backed

#### Scenario: Metadata available once a video is ready
- **WHEN** a loaded video reaches the ready state
- **THEN** its metadata includes a finite `durationSec`, pixel `width` and
  `height`, and `frameRate` (a number when known, otherwise `null`)

### Requirement: Webcam recording
The system SHALL let a user record video through their webcam with a visible
start/stop control, using `getUserMedia` for capture and `MediaRecorder` for
encoding.

#### Scenario: User records and stops
- **WHEN** the user grants camera permission, starts recording, and then
  clicks stop
- **THEN** the system produces a single video blob and hands it to the
  unified video source for loading

#### Scenario: Camera unavailable in the browser
- **WHEN** `navigator.mediaDevices.getUserMedia` is not available in the
  current browser/context
- **THEN** the system shows a clear message steering the user to the file
  upload path instead of attempting to record

#### Scenario: No codec supported for recording
- **WHEN** none of the `MediaRecorder` MIME types the system tries
  (`video/webm;codecs=vp9`, `video/webm;codecs=vp8`, `video/webm`,
  `video/mp4`) are supported by the browser
- **THEN** the system shows a clear "recording isn't supported" message
  steering the user to file upload, and does not attempt to record

#### Scenario: Recording device disconnects mid-recording
- **WHEN** the active camera track ends unexpectedly while recording and at
  least some video data has already been captured
- **THEN** the system finalizes and uses the data captured so far rather than
  discarding it

#### Scenario: Recording device disconnects before any data is captured
- **WHEN** the active camera track ends unexpectedly while recording and no
  video data has been captured yet
- **THEN** the system shows a clear device-error message instead of handing
  downstream an empty or invalid video

### Requirement: Local file upload
The system SHALL let a user choose a local video file through a standard file
input, accepting common video formats the browser can decode.

#### Scenario: User selects a supported video file
- **WHEN** the user selects a file whose type starts with `video/` from the
  file picker
- **THEN** the system hands that file to the unified video source for loading

#### Scenario: User selects a file the browser cannot decode
- **WHEN** the selected file fails to decode once handed to the video element
- **THEN** the system shows a clear "format not supported" message rather
  than a silent failure

### Requirement: Clear error messages for permission and format failures
Permission-denied (webcam) and unsupported-format or decode (file) failures
SHALL surface a plain-language, user-facing message identifying what went
wrong and naming the alternative input path, never a silent failure or an
unhandled crash.

#### Scenario: Camera permission denied
- **WHEN** the user denies the camera permission prompt
- **THEN** the system shows a message explaining that camera access was
  denied, how to allow it, and that uploading a file is an alternative

#### Scenario: Unsupported or corrupt video file
- **WHEN** the browser's native video error handling reports an unsupported
  format or decode failure for a loaded source
- **THEN** the system shows a plain-language message naming the problem and
  suggesting a different file or recording with the webcam instead

#### Scenario: Recoverable error states
- **WHEN** the video source or webcam capture is in an error state
- **THEN** the user can retry (choose a different file, or attempt recording
  again) without reloading the page

### Requirement: Camera resource cleanup
The system SHALL stop all active camera tracks when recording stops
normally, when a recording error occurs, and when the recording component is
unmounted, so the camera indicator is not left on after the user is done.

#### Scenario: Tracks stopped after normal recording
- **WHEN** the user stops a recording normally
- **THEN** every track on the underlying `MediaStream` is stopped

#### Scenario: Tracks stopped when leaving the recording view
- **WHEN** the webcam capture component unmounts while a stream is still open
- **THEN** every track on that stream is stopped before unmount completes

