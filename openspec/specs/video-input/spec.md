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

### Requirement: Retained source blob for downstream demuxing
The unified video source SHALL retain the original `Blob`/`File` passed to its load function,
exposed verbatim (the same object, not re-derived from the `<video>` element, which exposes only
decoded pixels and playback state — never its own source bytes back out), so that downstream
consumers can read the clip's raw bytes independently of `<video>`/object-URL playback. The
retained blob SHALL be `null` before any clip has loaded, and SHALL be cleared back to `null` on
reset.

#### Scenario: The loaded blob is exposed verbatim
- **WHEN** a clip is loaded via the video source's load function
- **THEN** the video source exposes that exact `Blob`/`File` object

#### Scenario: No blob is exposed before any clip loads
- **WHEN** no clip has been loaded yet
- **THEN** the video source's exposed blob is `null`

#### Scenario: The blob is cleared on reset
- **WHEN** the video source is reset after a clip was loaded
- **THEN** its exposed blob returns to `null`

### Requirement: Poster frame for a loaded clip

The unified video source SHALL expose a poster image for the clip it holds — a single still frame
suitable for rendering the clip at thumbnail size — so that a clip can be represented in the
interface without its video element being on screen. The poster SHALL be `null` before a frame is
available and SHALL return to `null` on reset, the same lifecycle the retained source blob follows.

Deriving the poster SHALL NOT disturb the clip's canonical video element: it SHALL NOT seek, play,
pause, mute, or otherwise write to that element's playback state, and SHALL NOT require a reference
to it. The canonical element is shared with sampling, with the background scale pass, and with the
reader's own preview playback, all of which would be corrupted by a write from a thumbnail.

The poster MAY therefore be decoded from the clip's retained source blob through a separate,
short-lived decoder that the derivation owns outright, rather than copied from whatever frame the
canonical element happens to be showing. That is the preferred mechanism, for two reasons: it makes
the no-interference property **structural** rather than a discipline the caller must maintain, and
the canonical element's already-decoded frame is not a good thumbnail — at `'ready'` it is the first
frame, which on real footage is routinely a fade-in or black leader, and during sampling it is
whichever mid-analysis frame happens to be current, which varies run to run. A derivation that owns
its own decoder MAY seek that decoder freely, since nothing else observes it, and SHALL tear down the
decoder and revoke its object URL on every exit path, including timeout and error.

At most one such decoder SHALL exist at a time across the whole session, and that limit SHALL be
enforced by the derivation itself rather than asked of its callers. A session can acquire several
clips in a single interaction — one multi-file selection loads every file at once — and each clip's
derivation is requested independently, with no call site able to see the others. Full-resolution
decoders are held open at the clip's own dimensions, which for this app's own reference footage is
4K, and they are opened during analysis, competing with a live sampling run for memory and GPU.

The instant a poster is taken from SHALL be the **midpoint of the clip**, and SHALL NOT be the
clip's first frame whenever any later instant can be reached — **including when the clip's duration
cannot be read at all**.

The midpoint rather than merely some offset past the start, because a running clip's opening second
is the approach: the subject is at their smallest, furthest from camera, and frequently not yet in
frame. The middle is where the runner is most reliably present, largest, and mid-stride, which is
what a thumbnail exists to show. The midpoint is strictly inside any positive duration, so it can
never land on the final frame, and it SHALL NOT be capped at a fixed ceiling — capping it would put
every clip longer than a few seconds back near its opening, defeating the rule.

A duration of `Infinity` is not an exotic failure: it is what a MediaRecorder-produced clip can
report. Treating an unreadable duration as zero would silently apply the first-frame outcome to a
whole input mode. With no duration there is no midpoint to compute, so an unreadable duration SHALL
instead fall back to a fixed offset into the clip, and only then to the first frame if that offset
cannot be reached.

Because the source reaches `'ready'` on metadata alone, a frame is not guaranteed at that moment. The
poster SHALL therefore become available at or after `'ready'`, once a frame has actually been
decoded, and a consumer SHALL treat its absence as "not yet", rendering a neutral placeholder rather
than an error or an empty box.

The poster itself SHALL be held in memory for the session only. The system SHALL NOT serialize **the
poster** to a data URL, a blob, an object URL, or any persistent storage — the same rule extracted
evidence images follow. An object URL minted for a transient decoder is not a serialization of the
poster and is permitted, provided it is revoked as required above. The poster SHALL be released when
the clip is removed and when the session resets.

Any sizing or aspect-ratio arithmetic involved SHALL be computable without a canvas or a DOM, so it
is unit-testable in an environment with no canvas implementation; only the frame copy itself touches
a rendering context.

#### Scenario: A poster appears once a frame has been decoded

- **WHEN** a clip finishes loading and a frame has been decoded for it
- **THEN** the video source exposes a poster image for that clip

#### Scenario: No poster before a frame exists

- **WHEN** a clip has reached `'ready'` on metadata but no frame has been decoded yet
- **THEN** the exposed poster is `null`, and a consumer renders a neutral placeholder rather than an
  error or a blank frame

#### Scenario: Poster derivation never reaches the canonical element

- **WHEN** a poster is derived for any clip, in any phase
- **THEN** the derivation obtains no reference to that clip's canonical video element, so no write to
  its playback state is possible in the first place

#### Scenario: Poster capture leaves playback alone

- **WHEN** a poster is captured for a clip that is mid-analysis, or whose preview the reader has
  open and playing
- **THEN** the canonical element's current time, paused state, muted state, and loop state are all
  unchanged, and the in-flight analysis completes exactly as it would have

#### Scenario: A transient decoder is torn down on every path

- **WHEN** a poster derivation opens its own decoder and that derivation succeeds, times out, errors,
  or is abandoned because the clip was removed first
- **THEN** the decoder is released and its object URL revoked in every one of those cases

#### Scenario: Several clips arrive at once and decode one at a time

- **WHEN** several clips are added in a single interaction and each asks for its poster
- **THEN** no two poster decoders are open simultaneously — each starts only after the previous one
  has been torn down — without any caller having arranged that ordering

#### Scenario: A poster is taken from the middle of the clip

- **WHEN** a clip reports a usable duration, of any length
- **THEN** the poster is taken from that clip's midpoint — not its opening, and not a fixed offset
  from the start — so a long clip posters from its middle rather than from its approach

#### Scenario: A clip whose duration cannot be read still posters past its first frame

- **WHEN** a clip reports no usable duration, as a webcam recording can
- **THEN** the poster is taken from a fixed offset into the clip rather than from its first frame,
  and falls back to the first frame only if that offset cannot be reached

#### Scenario: The poster is not serialized or persisted

- **WHEN** a poster exists for a clip
- **THEN** it exists only as an in-memory image handle — no data URL, blob, download, or stored copy
  of the poster is produced, and no object URL outlives the transient decoder that needed it

#### Scenario: The poster is released on reset

- **WHEN** the video source is reset, or its clip is removed from the session
- **THEN** the exposed poster returns to `null` and the underlying image resource is released

### Requirement: The picker owns the empty state and collapses into a persistent add-a-clip action

The system SHALL present the full video picker — record, upload, and the demo clips — as the page's
main content while the session holds no loaded clip. Once at least one clip is loaded, that
full-page picker SHALL collapse into a single persistent action in the application header that
offers the **same** input paths: recording with the webcam and uploading a file, not upload alone.
Both presentations SHALL drive the same unified video source contract, so a clip added later is
indistinguishable downstream from the first.

The action SHALL be keyboard reachable and carry an accessible name stating what it does. No
add-a-clip affordance SHALL remain in the page body.

#### Scenario: An empty session shows the full picker

- **WHEN** the session holds no loaded clip
- **THEN** the record/upload picker and the demo clips are presented as the page's main content

#### Scenario: The picker collapses once a clip exists

- **WHEN** the first clip finishes loading
- **THEN** the full-page picker is no longer the page's main content, the results take that place,
  and a single add-a-clip action is available in the header

#### Scenario: The header action offers recording as well as upload

- **WHEN** the reader activates the header's add-a-clip action
- **THEN** both the webcam-recording path and the file-upload path are available from it — closing
  the gap left by an upload-only in-body affordance, which offered no way to record or to add a demo
  clip after the first clip existed

#### Scenario: The action is labeled and keyboard reachable

- **WHEN** the reader navigates the header by keyboard
- **THEN** the add-a-clip action can be reached and activated, and exposes an accessible name saying
  it adds a clip

