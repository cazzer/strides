## Why

Pose-detection, robustness, and quality-gate all need a video to analyze, but a
user might supply one two different ways: record live via webcam, or upload an
existing file. Downstream code (`estimatePoses()`, duration/resolution checks,
etc.) should not have to know or care which path produced the video. Today
there is no video input at all, so this change adds both capture paths and
collapses them to one contract before anything else touches the result.

## What Changes

- Add `useVideoSource()` — a hook owning a canonical, `src`-backed
  `HTMLVideoElement` (via `ref`) plus status/metadata/error state. Both
  capture paths feed it a `Blob`/`File`; it is the single place bytes become a
  ready, seekable `<video>`.
- Add `WebcamCapture` — `getUserMedia` + `MediaRecorder` recording with a
  visible start/stop control, its own internal live preview (a separate
  `<video>` from the canonical one), and recoverable error states for denied
  permission, no camera, device errors, and unsupported recorder codecs.
- Add `FileUpload` — a thin `<input type="video/*">` wrapper that hands the
  selected `File` to the caller; no format-sniffing duplicated here.
- Add `VideoInputPanel` — tab UI switching between Record and Upload, renders
  the canonical `<video>` plus loading/error/ready states, wired to a
  `VideoSource` passed in as a prop (it does not own video state itself).
- Add `mediaErrors.ts` — pure, dependency-free classification of
  `MediaError` (post-load decode/format errors) and `getUserMedia`/recorder
  errors (pre-capture permission/device errors) into clear, actionable
  messages that name the alternative path.
- Wire `App.tsx` to call `useVideoSource()` and render
  `<VideoInputPanel videoSource={...} />`, giving a real integration point.

## Capabilities

### New Capabilities
- `video-input`: unified video acquisition (webcam recording and local file
  upload) that both resolve to the same `src`-backed `HTMLVideoElement` +
  metadata contract, with clear user-facing errors on failure.

### Modified Capabilities
(none — this is the first capability touching video acquisition)

## Impact

- New directory `src/video/` (types, hook, components, tests). No existing
  files change behavior except `src/App.tsx`, which gains a
  `useVideoSource()` call and renders `VideoInputPanel`.
- No new runtime dependencies — uses browser-native `getUserMedia`,
  `MediaRecorder`, and `HTMLVideoElement` APIs only.
- Establishes the `VideoSource`/`VideoMetadata` shape that the pose-detection,
  robustness, and quality-gate tickets will consume; those tickets are out of
  scope here.
