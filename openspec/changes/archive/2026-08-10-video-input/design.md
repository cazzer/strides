## Context

This is the first video-handling code in the app. Downstream tickets
(pose-detection, robustness, quality-gate, results-view) all need to read a
finite `duration`, iterate frames, and seek — none of which
`HTMLVideoElement` supports when it's backed by a live `MediaStream`
(`.duration` is `Infinity`/`NaN`, not seekable). See proposal.md - Why.

## Goals / Non-Goals

**Goals:**
- One code path turns "some bytes representing a video" into a ready,
  seekable `<video>` + metadata, regardless of whether those bytes came from
  a webcam recording or a file picker.
- Every failure mode (permission denied, no camera, unsupported codec,
  unsupported file format, decode error) ends in a clear, recoverable,
  user-facing message — never a silent failure or crash.
- The camera is never left running after the user stops using it.

**Non-Goals:**
- Frame-accurate frame rate detection for uploaded files (no browser API
  exposes this without expensive frame sampling — documented as a known gap
  via `frameRate: null`).
- Any pose-detection, quality, or results-view logic — this ticket only
  produces a `VideoSource`; later tickets consume it.
- Audio capture — not needed for form analysis, and skipping it avoids a
  second permission prompt.

## Decisions

### D1: Normalize both paths to a `src`-backed `<video>` before anything downstream sees them

`WebcamCapture` never exposes its live `MediaStream` past its own internal
preview `<video muted autoPlay playsInline srcObject={stream}>`. Once
recording stops, `MediaRecorder` produces a `Blob`; that `Blob` (and an
uploaded `File`, which is already a `Blob`) both go through the exact same
`useVideoSource().load()` path: `URL.createObjectURL()` → defensively clear
`.srcObject` → set `.src` → `.load()`. This is what makes "no special-casing
recorded vs uploaded" literally true past `WebcamCapture` — the function that
turns bytes into a ready `<video>` is the same function regardless of origin.

Alternative considered: expose `srcObject` directly for the live-record case
and only convert to `src` on stop. Rejected — it would mean two different
downstream shapes existing simultaneously (mid-recording vs finished), and
downstream consumers would need to know which one they had. Collapsing to
one representation at the `WebcamCapture` boundary means `VideoInputPanel`,
`useVideoSource`, and everything below it only ever sees one shape.

### D2: Split error handling into two layers by when the failure is knowable

- **Pre-data errors** (permission denied, no camera device, no
  `getUserMedia`, no supported recorder codec, mid-recording device
  disconnect with zero bytes captured) are only knowable inside
  `WebcamCapture`, before any bytes exist to hand to `useVideoSource`. These
  are classified by `classifyGetUserMediaError` and held as local state in
  `WebcamCapture`'s state machine.
- **Post-data errors** (unsupported file format, decode failure) are only
  knowable once a `src` has been set on the `<video>` element and the
  browser's native `error` event fires with a `MediaError`. These are
  classified by `classifyMediaError` and held as `useVideoSource`'s
  `error`/`status` state, regardless of whether the bytes came from a
  recording or an upload.

Both classifiers live in `mediaErrors.ts` as pure functions (no DOM access,
no React) — the cheapest, highest-confidence unit tests in this ticket, and
reusable independent of which component needs to render the message.

Alternative considered: a single unified error state in `useVideoSource`
covering both permission and format errors. Rejected — permission/device
errors happen before there is a `Blob`/`File` to give `useVideoSource` at
all, so `useVideoSource` has nothing to classify yet; forcing that state
through the hook would mean `WebcamCapture` writing into `useVideoSource`'s
internals rather than just calling `load()`, breaking the hook's ownership
boundary.

### D3: `useVideoSource` owns state only, not DOM rendering

The hook returns a `RefObject` and state; `VideoInputPanel` renders the
actual `<video ref={videoSource.videoRef} controls playsInline />` element.
This keeps `useVideoSource` testable without a real render tree (tests can
construct a detached `<video>`, assign it to `videoRef.current`, and drive
events directly) and keeps ownership of the video source at the `App.tsx`
level per the ticket's stated ownership model, rather than inside the panel
component.

### D4: `FileUpload` does not duplicate format validation

`FileUpload` only does a cheap `file.type.startsWith('video/')` fast-fail
before calling `onSelected`. The authoritative source of truth for
format/corruption errors is the native `error` event on the `<video>`
element once `useVideoSource` has actually tried to load it (via
`classifyMediaError`). Duplicating sniffing logic in `FileUpload` would give
two different error paths for the same failure class.

## Risks / Trade-offs

- [Risk] Squarespace iframe embed (eventual deployment target) may block
  `getUserMedia` unless the iframe has `allow="camera"`, which is outside
  this repo's control and not discoverable in local dev. → Mitigation: the
  existing "no `getUserMedia` → steer to upload" error path already covers
  this case gracefully; no additional handling needed now.
- [Risk] `frameRate` is `null` for all file uploads, which later
  quality-gate logic may want. → Mitigation: documented as a known gap in
  the type contract (`VideoMetadata.frameRate` comment); out of scope to
  solve here.
- [Risk] jsdom's `HTMLMediaElement`/`MediaRecorder` are stubs or missing
  entirely, so webcam tests require hand-rolled fakes. → Mitigation: minimal
  shared stubs added once in `src/test/setup.ts`; file-upload path (the hard
  acceptance-criteria requirement) does not depend on `MediaRecorder` at all
  and is fully covered without those fakes.

## Migration Plan

No migration — this is new, additive code (`src/video/`) plus a small
`App.tsx` wiring change. No existing behavior changes. Rollback is a plain
revert of this change's commit.
