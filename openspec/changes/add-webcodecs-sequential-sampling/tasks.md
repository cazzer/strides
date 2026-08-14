## 1. OpenSpec change

- [x] 1.1 `openspec new change add-webcodecs-sequential-sampling`; write `proposal.md`,
      `design.md` (D1-D6), `tasks.md`, spec deltas (`pose-detection` MODIFIED ×2 + ADDED ×5,
      `video-input` ADDED ×1, `sampling-robustness-config` MODIFIED ×1, `analysis-diagnostics`
      MODIFIED ×1).
- [x] 1.2 `openspec validate add-webcodecs-sequential-sampling --strict` passes. Do NOT archive.

## 2. `PoseFrameSource` refactor (pure, zero behavior change) — D1

- [x] 2.1 `src/pose/detector.ts`: add `PoseFrameSource` interface + `videoFrameSource()` helper;
      `PoseDetector.estimatePose` signature changes to take `PoseFrameSource`.
- [x] 2.2 `src/pose/backends/movenet.ts`, `blazepose.ts`, `posenet.ts`,
      `mediapipePoseLandmarker.ts`: every `video.currentTime`/`video.videoWidth`/
      `video.videoHeight`/bare-`video` reference becomes `source.timestampSec`/`source.width`/
      `source.height`/`source.image`.
- [x] 2.3 `src/pose/types.ts`: `PoseFrame.timestamp` doc comment names both producing clocks.
- [x] 2.4 `src/results/sampleClip.ts`: `onFrame` wraps `video`/`metadata.mediaTime`/dimensions
      into a `PoseFrameSource` before calling `estimatePose`; `withTimeout`/
      `DetectionTimeoutError` exported for `sampleClipSequential.ts`'s reuse.
- [x] 2.5 Update mocked `estimatePose` in `sampleClip.test.ts` and all 4 backend test files to
      the new parameter shape. `detector.test.ts`/`usePoseDetector.test.ts`/
      `scalePassDetector.test.ts` needed no changes (untyped `vi.fn()` mocks).
- [x] 2.6 Full typecheck (`tsc -b --noEmit`) + full test suite green before proceeding — isolates
      "did the refactor break anything" from "does new WebCodecs code work."

## 3. MP4 demuxing — D2, D5

- [x] 3.1 `npm install mp4box`.
- [x] 3.2 New `src/video/mp4Demux.ts`: `demuxMp4(bytes)` → `DemuxedTrack` (codec, description,
      width, height, fps, durationSec, decode-order `samples`). Never hangs or throws uncaught on
      malformed/non-MP4/no-video-track input.
- [x] 3.3 New `src/video/mp4Demux.test.ts`: real bytes off disk (`park-approach.mp4`, the only
      demo clip checked into the repo — the other is fetched remotely at runtime, see
      `DemoVideoButton.tsx`) — codec/dimensions/fps/duration/sample-count snapshot; description
      bytes start with `0x01` (box header stripped); decode-order (non-monotonic PTS) confirmed
      against this clip's real B-frame reordering; keyframe count; every sample has data +
      positive duration; rejects (never hangs) on WebM magic bytes, an empty buffer, a
      truncated/no-`moov` file, and a corrupted sample-entry fourcc.

## 4. Frame-rate-aware sampling stride — D2

- [x] 4.1 New `src/results/sequentialSamplingStep.ts`: `SequentialSamplingConfig` +
      `createFrameSelector` — PTS-bucket selection (`floor(ptsSec * targetSamplesPerSecond)`),
      `null` = every frame.
- [x] 4.2 New `src/results/sequentialSamplingStep.test.ts`: null passthrough; CFR 30fps and 60fps
      downsampled to an exact expected index pattern; target exceeding source fps selects every
      frame; PTS-bucket (not index-modulo) behavior confirmed against an irregular-gap synthetic
      sequence; never double-selects within one bucket; independent state per factory call.

## 5. WebCodecs decode + adaptive dispatch — D1, D3, D4

- [x] 5.1 New `src/video/sequentialFrameSource.ts`: `openSequentialFrameSource(track,
      selectFrame)` — configures `VideoDecoder` (`isConfigSupported` first), feeds samples in
      decode order with backpressure (`decodeQueueSize` + a small bounded selected-frame queue),
      closes every unselected `VideoFrame` synchronously inside `output()`, exposes selected
      frames in presentation order via an async iterable, `stop()` for early cancellation. Not
      meaningfully unit-testable (jsdom has no `VideoDecoder`/`VideoFrame`) — typecheck-clean,
      verified live (section 8).
- [x] 5.2 New `src/results/sampleClipSequential.ts`: consumes the frame source + a `PoseDetector`,
      draws each selected frame to one reusable canvas, closes it, then awaits detection —
      matches `sampleClip`'s `{ promise, handle }` contract and circuit-breaker/timeout
      discipline exactly.
- [x] 5.3 New `src/video/webCodecsSupport.ts`: `canUseSequentialDecode(blob)` — `VideoDecoder`
      exists → blob present → cheap `ftyp`-magic-byte pre-check → real `demuxMp4` attempt →
      `VideoDecoder.isConfigSupported`. Never throws.
- [x] 5.4 New `src/results/sampleClipAdaptive.ts`: the shared dispatch point — `sourceBlob !==
      null` routes to `sampleClipSequential`, `null` to `sampleClip` (see design.md D4 for why
      `sourceBlob` itself, not a separate boolean, is the dispatch signal).
- [x] 5.5 `src/video/types.ts` + `useVideoSource.ts`: `VideoSource` gains `sourceBlob: Blob |
      null`, as `useState` (deviation from the plan's `sourceBlobRef` — see proposal.md;
      `react-hooks/refs` lint forbids reading `.current` in the hook's render-time return).
      `useVideoSource.test.ts` extended: exposes the blob verbatim; cleared on `reset()`.
- [x] 5.6 `src/results/useVideoAnalysis.ts`: `canUseSequentialDecode` probe kicked off once per
      freshly loaded clip (effect keyed on `metadata` identity), cached in a ref, read
      synchronously (never awaited) at both `sampleClipAdaptive` call sites (`start()`, scale-pass
      effect) — never blocks `start()`'s click-derived synchronous `video.play()`.

## 6. Config plumbing

- [x] 6.1 `src/results/samplingRobustnessConfig.ts`: `SamplingRobustnessConfig` gains
      `sequentialSampling: SequentialSamplingConfig`; `DEFAULT_SAMPLING_ROBUSTNESS_CONFIG` default
      `{ targetSamplesPerSecond: null }`; `Window` override type widened; merge gains the third
      nested-partial branch.
- [x] 6.2 `samplingRobustnessConfig.test.ts` extended: default matches; override merges
      independently of `robustness`/other fields; untouched fields keep defaults.

## 7. Diagnostics

- [x] 7.1 `src/results/analysisDiagnostics.ts`: `AnalysisDiagnostics.sampling` gains `path:
      'sequential' | 'playback'`, a required parameter on `computeAnalysisDiagnostics` (nothing
      in the existing inputs reveals which sampler produced them).
- [x] 7.2 `useVideoAnalysis.ts`'s two `computeAnalysisDiagnostics` call sites pass the same
      resolved dispatch decision (`usesSequentialDecode`) each run actually used, captured once
      per run rather than re-read from the ref later.
- [x] 7.3 `analysisDiagnostics.test.ts` updated: all call sites pass `'playback'`; one new test
      confirms `'sequential'` passes through verbatim; existing `toEqual(diagnostics.sampling)`
      assertions include the new `path` field.

## 8. Gates + live verification

- [x] 8.1 `npx vitest run` all green (525 tests); `npx tsc -b --noEmit` clean; `npx eslint .`
      clean; `openspec validate add-webcodecs-sequential-sampling --strict` passes.
- [x] 8.2 Live verification against the six pre-registered gates from issue #41 (Playwright, real
      GPU flags). Found and fixed a critical microtask-starvation hang in the backpressure wait,
      and a structural bug where auto-start always won the race against the feasibility probe
      (see proposal.md "Bug found and fixed" and "Deviations" #2) — both discovered only once
      live-driven, both fixed, both re-verified. Final results (2 clips × 3 trials per arm):
      gate 1 (bit-identical timestamps) PASS; gate 2 (coverage ≥ playback) PASS, notably on the
      60fps park clip (99/99 = 100% vs playback's 77-78/77-78 real frames actually presented);
      gate 3 (wall-time ≤ 2×) PASS (~0.5-0.6× on the largest clip, not quite the ~0.4× estimate);
      gate 4 (confidence stability) MIXED — see design.md D7, the track clip's primary-pass view
      confidence is technically more "stable" under sequential decode but stuck at a degenerate
      0 (view detection fails), a regression, not a win, on that specific clip; gate 5 (VO-cm
      anchors) DID NOT CLEANLY HOLD — 4.42cm vs ≈4.8cm (track), 10.49cm vs ≈12.2cm (park), both
      low, see D7; gate 6 (no VideoFrame pool exhaustion) PASS, directly instrumented — peak 1
      concurrently-open frame across a full 228-frame run, 0 leaked. Full numbers in the
      implementation report.
