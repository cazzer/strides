## 1. Type contract

- [x] 1.1 Add `src/video/types.ts` with `VideoMetadata`, `VideoSourceStatus`,
      `VideoSourceError`, `VideoSource` — confirm `RefObject<HTMLVideoElement
      | null>` against the installed `@types/react` (^19.2.17).

## 2. Error classification (pure, dependency-free)

- [x] 2.1 Add `src/video/mediaErrors.ts` with `classifyMediaError` (maps
      `MediaError` codes 4/3/other to `unsupported-format`/`decode-error`/
      `unknown`, each with a plain-language, actionable message naming the
      alternative path).
- [x] 2.2 Add `classifyGetUserMediaError` (maps `getUserMedia`/recorder
      failures to `permission-denied`/`no-camera`/`device-error`/
      `recorder-unsupported`/`unknown`, each with a message naming the
      alternative path).
- [x] 2.3 Add `mediaErrors.test.ts` unit tests for both classifiers covering
      every mapped case.

## 3. Test environment setup

- [x] 3.1 Add jsdom stubs to `src/test/setup.ts`: `HTMLMediaElement.prototype.load`,
      `URL.createObjectURL`/`URL.revokeObjectURL`.

## 4. Unified video source hook

- [x] 4.1 Implement `src/video/useVideoSource.ts`: `load()` revokes any prior
      object URL, sets `status='loading'`, clears `error`/`metadata`, creates
      an object URL, defensively clears `srcObject`, sets `.src`, calls
      `.load()`.
- [x] 4.2 Wire `loadedmetadata` listener → populate `metadata`
      (`durationSec`/`width`/`height`/`frameRate` from `opts.frameRateHint`
      or `null`), `status='ready'`.
- [x] 4.3 Wire native `error` event listener → `classifyMediaError`,
      `status='error'`.
- [x] 4.4 Implement `reset()`: revoke object URL, clear `.src`,
      `status='empty'`.
- [x] 4.5 Add unmount cleanup effect that revokes the last object URL.
- [x] 4.6 Add `useVideoSource.test.ts` driving loading→ready and
      loading→error transitions via a detached `<video>` element and manual
      `Object.defineProperty`/`dispatchEvent`, plus `reset()` and unmount
      cleanup revoking the object URL.

## 5. File upload path

- [x] 5.1 Implement `src/video/FileUpload.tsx`: `<input type="file"
      accept="video/*">` calling `onSelected(file)`, optional cheap
      `file.type.startsWith('video/')` pre-check, `disabled` prop support.
- [x] 5.2 Add `FileUpload.test.tsx` covering selection calling `onSelected`
      and the `disabled` state.

## 6. Webcam capture path

- [x] 6.1 Implement `src/video/WebcamCapture.tsx` state machine (`idle →
      requesting-permission → recording → stopping → idle`) with recoverable
      error states (`permission-denied`, `no-camera`, `device-error`,
      `recorder-unsupported`).
- [x] 6.2 Guard on `navigator.mediaDevices?.getUserMedia` existing before
      attempting capture; otherwise go straight to an error state steering
      to Upload.
- [x] 6.3 Call `getUserMedia({ video: { facingMode: 'user', width: { ideal:
      1280 }, height: { ideal: 720 } }, audio: false })`.
- [x] 6.4 Implement `MediaRecorder.isTypeSupported` fallback chain
      (`vp9` → `vp8` → plain webm → mp4); `recorder-unsupported` if none
      match.
- [x] 6.5 Capture `frameRate` from `getVideoTracks()[0].getSettings()` right
      after `getUserMedia` resolves; thread through as `frameRateHint` to
      `onRecorded`.
- [x] 6.6 Start recorder with no timeslice; on stop, assemble the single
      blob and call `onRecorded(blob, { frameRateHint })`.
- [x] 6.7 Stop every track on normal stop, on error, and on unmount
      (`useEffect` cleanup).
- [x] 6.8 Handle mid-recording `track.onended`: finalize captured data if
      any exists, else surface a device-error.
- [x] 6.9 Render the internal live preview as its own
      `<video muted autoPlay playsInline srcObject={stream}>`, separate from
      the canonical video element.
- [x] 6.10 Add `WebcamCapture.test.tsx` using a hand-rolled
      `FakeMediaRecorder` (`vi.stubGlobal`) and mocked
      `navigator.mediaDevices.getUserMedia`, covering: successful
      record→stop→`onRecorded`, permission denied, and unsupported codec.

## 7. Panel composition

- [x] 7.1 Implement `src/video/VideoInputPanel.tsx`: local `'record' |
      'upload'` tab state, disables the inactive tab while recording,
      renders `WebcamCapture`/`FileUpload` wired to call `videoSource.load(...)`.
- [x] 7.2 Render the canonical `<video ref={videoSource.videoRef} controls
      playsInline />` once `status !== 'empty'`.
- [x] 7.3 Render loading indicator, error message + "try again" (calls
      `reset()`), and ready-state review player + "choose a different
      video" (calls `reset()`) per `status`.
- [x] 7.4 Add `VideoInputPanel.test.tsx` covering tab switching and the
      loading/error/ready render states given a stubbed `VideoSource` prop.

## 8. App wiring

- [x] 8.1 Update `src/App.tsx` to call `useVideoSource()` and render
      `<VideoInputPanel videoSource={...} />`.
- [x] 8.2 Update `src/App.test.tsx` if the existing heading assertion needs
      adjusting for the new content.

## 9. Verification

- [x] 9.1 `npm run lint` passes.
- [x] 9.2 `npm run build` (typecheck + build) passes.
- [x] 9.3 `npm run test` passes, file-upload path covered at minimum per
      acceptance criteria.
- [x] 9.4 `openspec validate --all` passes clean.
- [x] 9.5 Archive the change (`openspec archive video-input`).
