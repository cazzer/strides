## Why

Every analysis run today samples pose via `sampleClip.ts`: play the `<video>` element once at 1x
and detect off whatever `requestVideoFrameCallback` presents, throttled to detector throughput.
That ties sampling density to real-time playback and to the browser's own frame-presentation
cadence — on a 60fps source, coverage is capped well below the source frame rate by GPU decode
time, and detection density is neither deterministic nor frame-rate-aware (issue #41).

WebCodecs (`VideoDecoder`) lets the app demux an MP4 once and decode every frame sequentially,
off the real-time clock, then pick frames by a frame-rate-aware PTS-bucket stride instead of
whatever `requestVideoFrameCallback` happened to present. This change adds that path as an
alternative to (not a replacement for) the existing `<video>`-playback sampler, dispatched
per-run based on real feasibility (`VideoDecoder` support, a demuxable MP4, a decodable codec) —
falling back to the existing, proven playback path for anything that isn't a clean MP4 (WebM
webcam recordings, in particular).

## What Changes

- **`PoseDetector.estimatePose` signature change** (`src/pose/detector.ts` + all 4 backends +
  `sampleClip.ts`): takes a new `PoseFrameSource` (`{ image: HTMLVideoElement |
  HTMLCanvasElement, timestampSec, width, height }`) instead of a raw `HTMLVideoElement` — the
  backend-agnostic bridge both sampling paths funnel through, since MoveNet's `PixelInput` union
  has no `VideoFrame` variant and WebCodecs `VideoFrame`s have no common ground with
  `HTMLVideoElement` otherwise. Landed first, alone, as a pure refactor (zero behavior change,
  verified by the full existing test suite passing unmodified in substance) before any new
  sampling code was added.
- **New `src/video/mp4Demux.ts`**: a pure, `mp4box`-based MP4 parser — `demuxMp4(bytes)` extracts
  codec, dimensions, average fps, duration, and every sample (bitstream bytes, PTS, duration,
  keyframe flag) in **decode order**. Never hangs or throws uncaught on malformed/non-MP4 input;
  always settles the returned promise.
- **New `src/video/sequentialFrameSource.ts`**: wraps a `VideoDecoder` around a demuxed track,
  feeding samples with backpressure (`decoder.decodeQueueSize` + an internal bounded queue) and
  exposing decoded frames in **presentation order**. Applies the caller's frame selector inside
  its own `output` callback so every unselected `VideoFrame` closes immediately — the memory
  discipline gate (#41's gate 6) depends on this happening here, not one layer up.
- **New `src/results/sequentialSamplingStep.ts`**: `createFrameSelector` — a pure, PTS-bucket
  frame-rate-aware stride (`floor(ptsSec * targetSamplesPerSecond)`), correct on variable-frame-
  rate content where a fixed index stride would drift.
- **New `src/results/sampleClipSequential.ts`** + **`src/results/sampleClipAdaptive.ts`**: the
  WebCodecs-path sampler (matches `sampleClip`'s exact `{ promise, handle }` contract and
  circuit-breaker/timeout discipline) and the single dispatch point both call sites
  (`useVideoAnalysis.ts`'s primary run and background scale pass) now go through.
- **New `src/video/webCodecsSupport.ts`**: `canUseSequentialDecode(blob)` — the feasibility probe
  (VideoDecoder exists → blob present → looks like MP4 → demuxes → codec decodable), resolved
  once per loaded clip, ahead of `start()`'s autoplay-policy-constrained synchronous call stack,
  never inside it.
- **`VideoSource` gains `sourceBlob`** (`src/video/useVideoSource.ts` + `types.ts`): the original
  `Blob`/`File` retained verbatim, as `useState` (not the originally-sketched ref — see Deviations
  below).
- **`SamplingRobustnessConfig` gains `sequentialSampling: { targetSamplesPerSecond: number |
  null }`** (`src/results/samplingRobustnessConfig.ts`), default `null` (every decoded frame),
  same dev-only override plumbing as the rest of the plane.
- **`AnalysisDiagnostics.sampling` gains `path: 'sequential' | 'playback'`**
  (`src/results/analysisDiagnostics.ts`) so a run's console diagnostics report which sampler
  actually produced its samples.
- **~9 test files' `PoseDetector` mocks updated** to the new `PoseFrameSource` parameter shape, as
  a pure mechanical follow-through of the interface change.

## What Does NOT Change

- `src/heuristics/`, `src/pose/robustness/` — untouched. Both samplers produce the same
  `PoseSample[]` shape, so the entire downstream pipeline (robustness → presence-trim →
  heuristics → diagnostics) needed zero changes beyond the one new `samplingPath` parameter on
  `computeAnalysisDiagnostics`.
- The `<video>`-playback path (`sampleClip.ts`) itself — no behavior change, only the
  `estimatePose` call site's argument shape.
- Default behavior for a clip that isn't a clean, `VideoDecoder`-decodable MP4 (WebM recordings,
  unsupported codecs): falls back to exactly today's playback-path behavior.

## Impact

- Affected specs: `pose-detection` (MODIFIED ×2, ADDED ×5), `video-input` (ADDED ×1),
  `sampling-robustness-config` (MODIFIED ×1), `analysis-diagnostics` (MODIFIED ×1).
- Affected code: see "What Changes" above; full diff stat in the implementation report.
- New dependency: `mp4box` (MP4 box parsing/demuxing).
- Runtime cost when the sequential path is used: one `blob.arrayBuffer()` read plus one MP4 demux
  pass ahead of decode (measured cheap, see design.md); when it isn't used (probe says no, or
  still resolving), zero — the playback path runs exactly as it did before this change.

## Deviations from the original architectural plan

Recorded here, with reasoning, since the plan this change was implemented from was followed
closely but not literally in several places — two of them (#2 and a live-verification-only bug,
see design.md D3) discovered only once the feature was actually driven end-to-end in a real
browser, which is exactly why this repo's CLAUDE.md requires that live pass before calling a
pipeline change done.

1. **`sourceBlob` is `useState`, not a ref.** The plan specified `sourceBlobRef`. This repo's
   `react-hooks/refs` lint rule (enforced, zero-warning baseline) flags reading `ref.current`
   inside a hook's render-time return statement — exactly what exposing it via a ref would
   require. `useState`, mirroring how `metadata`/`error` are already exposed, is lint-clean and
   behaviorally equivalent here (every write is already paired with a `status`/`metadata` state
   write in the same synchronous call, so no extra re-render is introduced).
2. **The sequential-decode feasibility flag (`sequentialDecodeSupported`) is also `useState`, not
   a ref, and the auto-start effect now waits for it to settle before firing.** The plan described
   this as a ref-based, fire-and-forget "best-effort" value that `start()` reads whenever it
   happens to run. Measured live: this app has no "run again on an already-completed clip"
   control (`ResultsView.tsx`'s re-run button only appears after an *error*), so auto-start is the
   trigger for nearly every real run — and React flushes passive effects synchronously, one after
   another, with no yield to the microtask queue in between. That means the probe-kickoff effect
   and the auto-start effect run back-to-back in the same pass every time, and `start()` always
   read the flag before the probe's `async`/`await` chain got a single tick to advance. The
   "best-effort, might miss the first run" framing was actually "always misses every auto-started
   run" — sequential decode would never have engaged in practice. Fixed by making the auto-start
   effect wait for the probe to settle (state, so it can be an effect dependency), bounded by a
   3-second defensive timeout so a hypothetical hung probe can't stall auto-start forever. See
   design.md D4 for the full mechanism; `start()`'s own contract (still reads a resolved value
   synchronously, never awaits) is unchanged.
3. **`sampleClipAdaptive`'s dispatch signal is `sourceBlob: Blob | null` itself, not a separate
   boolean parameter.** The plan's prose said the function "takes the `canUseSequentialDecode`
   probe result as an already-resolved boolean argument," but the literal signature it specified
   had no such parameter. Read literally, the signature already carries that signal: the caller
   passes the real blob only when the probe already said yes, `null` otherwise — so `sourceBlob
   !== null` **is** the resolved boolean, with no separate parameter to disagree with it.
4. **`VideoMetadata.frameRate` is not populated from the WebCodecs demux result.** The plan noted
   this as a "free byproduct" of the sequential path. Implementing it would require new
   cross-hook plumbing (a metadata-update path from `useVideoAnalysis.ts`, which runs the probe,
   back into `useVideoSource.ts`, which owns `metadata`) that no file in the plan's change list
   was scoped to add, and `frameRate` currently has zero downstream consumers. Left unwired;
   flagged as a follow-up if `frameRate` ever gains a real consumer.

## Bug found and fixed during live verification

`sequentialFrameSource.ts`'s backpressure wait (feed loop, D3 in design.md) originally raced
`queue.waitForRoom(MAX_QUEUED_FRAMES)` against a `dequeue` event listener unconditionally, even
when the selected-frame queue wasn't the reason the loop was blocked. `waitForRoom` resolves
immediately whenever the queue already has room (correct, by its own contract) — but racing an
immediately-resolving promise while the decoder's own queue was the actual bottleneck made
`Promise.race` settle on every loop iteration without ever really waiting for the decoder to
catch up: a tight, non-yielding microtask loop with no macrotask boundary in it anywhere. The
first live run hit this on the very first analysis and hung the entire page — not slow, not
degraded, completely unresponsive (confirmed via Playwright: even a plain `document.body`
read timed out). Fixed by only including each wait in the race when its own resource is actually
over-full (see design.md D3's updated text). Re-verified: the same run that hung now completes
in ~4.5s with `sampling.path: 'sequential'` and zero page errors, repeatably.
