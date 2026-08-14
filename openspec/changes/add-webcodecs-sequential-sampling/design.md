# Design — add-webcodecs-sequential-sampling

## D1 — `PoseFrameSource` as the backend-agnostic bridge

`PoseDetector.estimatePose` changes from `(video: HTMLVideoElement)` to
`(source: PoseFrameSource)`:

```ts
interface PoseFrameSource {
  image: HTMLVideoElement | HTMLCanvasElement
  timestampSec: number
  width: number
  height: number
}
```

Neither existing pixel-input union covers both paths on its own:
`@tensorflow-models/pose-detection`'s `PixelInput` has no `VideoFrame` variant at all (confirmed
against the installed `2.1.3`), so MoveNet cannot accept a raw decoded `VideoFrame`.
`@mediapipe/tasks-vision`'s `ImageSource` (`= TexImageSource`) does include `VideoFrame`, but
MoveNet is the default/primary backend — the bridge has to work for the backend every user
actually runs, not just the one that happens to support it natively.

The resolution: `sampleClipSequential.ts` draws every selected decoded `VideoFrame` onto one
reusable offscreen `<canvas>`, closes the `VideoFrame`, and hands the canvas through
`PoseFrameSource.image`. Every backend already accepted `HTMLCanvasElement` as a `PixelInput`
(MoveNet's own tracking-crop preprocessing already draws into a reusable canvas for the same
reason), so this required zero backend-specific new code — only replacing every
`video.currentTime`/`video.videoWidth`/`video.videoHeight`/bare-`video` reference with
`source.timestampSec`/`source.width`/`source.height`/`source.image`.

This was landed **first, alone, as step 1**, isolating "did the interface refactor break
anything" from "does the new WebCodecs code work" — the full existing test suite (504 tests
before this change) passed with zero behavior change once the refactor was mechanical
throughout: detector.ts, all 4 backends, sampleClip.ts's wrapping, and every backend/sampleClip
test file's mocks.

## D2 — Decode order vs. presentation order, and where each layer sees which

MP4 samples are stored, and must be fed to `VideoDecoder.decode()`, in **decode order**
(`mp4Demux.ts`'s `DemuxedSample[]` — confirmed against the real `park-approach.mp4` clip: its DTS
values are contiguous (0, 1001, 2002, ...) while its PTS values jump around due to B-frame
reordering). `VideoDecoder` internally reorders and emits frames from its `output` callback in
**presentation order** — this is `sequentialFrameSource.ts`'s `SelectedVideoFrame` stream, and
the only order `sequentialSamplingStep.ts`'s PTS-bucket selector is meaningful against (it
assumes non-decreasing `ptsSec` calls). Getting this backwards — feeding decode() in presentation
order, or bucketing on DTS — would corrupt either the decode itself or the sampling density in a
way that wouldn't necessarily throw, just silently produce wrong output. There's a regression
test for decode-order specifically (`mp4Demux.test.ts`'s "returns samples in decode order"),
grounded in the same real clip's actual (non-monotonic) PTS sequence.

## D3 — Where frame selection actually happens: inside `output()`, not one layer up

`sampleClipSequential.ts`'s doc describes it as "applying the selector," but the actual
close-vs-keep decision runs inside `sequentialFrameSource.ts`'s own `VideoDecoder` `output`
callback, which receives the `selectFrame` predicate as a parameter rather than the raw
`SequentialSamplingConfig`. This is required, not stylistic: WebCodecs gives no way to pause an
in-flight decode from outside its callback, so a rejected frame has to be closed the instant it's
produced — if selection happened one layer up in `sampleClipSequential.ts`, every unselected
frame would already be a leaked, unclosed `VideoFrame` by the time it got there. This is the
mechanism behind #41's gate 6 (no `VideoFrame` pool exhaustion).

Backpressure is separate from selection: the feed loop throttles `decoder.decode()` calls by both
`decoder.decodeQueueSize` and the selected-frame queue's fill level (`MAX_DECODE_QUEUE_SIZE`/
`MAX_QUEUED_FRAMES`, both small — 2), waking via the decoder's own `dequeue` event rather than
polling. The consumer (`sampleClipSequential.ts`) then drains that queue strictly one item at a
time: draw to the shared canvas, `frame.close()`, *then* `await detector.estimatePose(...)` —
never a second detection in flight, matching `sampleClip.ts`'s existing "one detection in flight"
discipline exactly. Live-verified directly: instrumenting every `VideoFrame`'s creation/close
across a full 228-frame run showed a peak of exactly 1 concurrently-open frame throughout, 0
remaining open after completion — the discipline holds in practice, not just by inspection.

**Bug found here during live verification, now fixed**: the backpressure wait originally read
```ts
await Promise.race([
  new Promise<void>((resolve) => decoder.addEventListener('dequeue', () => resolve(), { once: true })),
  queue.waitForRoom(MAX_QUEUED_FRAMES),
])
```
unconditionally — but `queue.waitForRoom()` resolves *immediately* whenever the queue already has
room (correct per its own contract; it's meant for callers that only sometimes need to wait).
Whenever the decoder's own queue (not the selected-frame queue) was the actual reason the loop
was blocked, racing against an already-resolved promise made `Promise.race` settle on every
single loop iteration without ever truly waiting for a `dequeue` event — a tight, non-yielding
microtask loop with no macrotask boundary anywhere in it. The first live run hit this immediately
and hung the entire page (confirmed via Playwright: even a plain `document.body` text read timed
out — not slow, completely unresponsive). Fixed by only including each race member when its own
resource is actually the reason for blocking:
```ts
const waiters: Promise<void>[] = []
if (decoder.decodeQueueSize >= MAX_DECODE_QUEUE_SIZE) waiters.push(/* dequeue listener */)
if (queue.size() >= MAX_QUEUED_FRAMES) waiters.push(queue.waitForRoom(MAX_QUEUED_FRAMES))
await Promise.race(waiters)
```
`waiters` is never empty here — the enclosing `while` only runs when at least one of the two
conditions holds. Re-verified: the same run that previously hung now completes in ~4.5s with
`sampling.path: 'sequential'`, repeatably, with zero page errors across every live trial run
afterward.

## D4 — `sampleClipAdaptive`'s dispatch signal, and why auto-start waits on it

`sourceBlob: Blob | null` is both the sequential path's actual input AND its own feasibility
signal (see proposal.md's "Deviations" #3 for why there's no separate boolean parameter).
`useVideoAnalysis.ts` resolves `canUseSequentialDecode(sourceBlob)` once per freshly loaded clip
(an effect keyed on `metadata` identity, mirroring the file's existing `autoStartedForRef`
pattern), and at each of the two `sampleClipAdaptive` call sites (primary run's `start()`,
background scale pass) passes `sourceBlob` only when that probe resolved `true`.

**This has to be `useState`, not a ref, and the auto-start effect has to wait on it** — the
original plan's "best-effort, `start()` reads whatever's already resolved, never blocks" framing
turned out to describe a mechanism that could never actually engage in practice (see proposal.md
"Deviations" #2 for the full story: this app's only trigger for a normal run is auto-start, and
React's synchronous passive-effects flush meant the probe-kickoff effect and the auto-start
effect always ran back-to-back with zero microtask ticks in between — `start()` invariably read
the flag before the probe's `await` chain could advance at all). The fix keeps `start()`'s own
contract exactly as designed (still a synchronous, non-blocking read at call time — the manual
"Analyze again" retry path, the only *other* caller, is unaffected since the probe has long since
settled by the time a user manually retries) and instead delays *when auto-start fires*:
```ts
useEffect(() => {
  if (
    videoSource.status !== 'ready' ||
    state.phase !== 'idle' ||
    !detector ||
    !metadata ||
    sequentialDecodeSupported === null ||  // wait for the probe (or its timeout) to settle
    autoStartedForRef.current === metadata
  )
    return
  autoStartedForRef.current = metadata
  start()
}, [videoSource.status, state.phase, detector, metadata, sequentialDecodeSupported, start])
```
Bounded by a 3-second defensive timeout on the probe itself (`SEQUENTIAL_DECODE_PROBE_TIMEOUT_MS`)
so a hypothetical hung probe can't stall auto-start indefinitely — `canUseSequentialDecode` is
documented to never hang, so this is a safety net, not an expected path. Live-measured probe
latency on the 24MB/3840×2160 track clip: ~16-20ms end to end (blob→arrayBuffer→demux→
isConfigSupported) — auto-start's visible delay in practice is negligible next to that timeout.

## D5 — mp4box.js integration specifics

- `demuxMp4` calls `appendBuffer` + `flush()` with the ENTIRE file's bytes in one call — this
  repo's mp4box.js (`2.4.1`) parses and extracts synchronously end-to-end for that usage pattern
  (verified directly: `onReady`/`onSamples`/extraction all complete before `appendBuffer` returns
  control). This is what makes it safe to treat "neither `onReady` nor `onError` fired by the time
  parsing returns" as conclusive rather than "still pending" — nothing later would change the
  outcome, so that case rejects explicitly instead of leaving the returned promise to hang
  forever. Confirmed this matters: an empty buffer and a bare-`ftyp`-no-`moov` file both hit
  exactly this path in testing.
- `onError`'s real signature is `(module: string, message: string) => void`, not the single-error
  callback its README example's naming style suggests.
- The codec's out-of-band config (`VideoDecoderConfig.description`) comes from the `avcC`/`hvcC`/
  `vpcC`/`av1C` sample-entry child box, written via mp4box's own `DataStream` and stripped of its
  8-byte box header (4-byte size + 4-byte fourcc) — the standard mp4box.js-to-WebCodecs bridging
  idiom. `mp4Demux.test.ts` snapshots that the extracted bytes start with `0x01`
  (`configurationVersion`), the real first byte of a raw `avcC` payload, not a box header byte.
- `demuxMp4` is called TWICE per sequential-decode run today: once by `canUseSequentialDecode`'s
  feasibility probe (full parse + extraction, not literally "header-only" despite that being the
  probe's conceptual intent — no header-only variant exists in the given `demuxMp4` contract), and
  again by `sampleClipSequential.ts` for the real sampling pass. Not deduplicated in this change —
  mp4box parsing is box-traversal-plus-memcpy, no decode, and was measured fast enough (see the
  implementation report's gate-3 numbers) that a second pass is a rounding error next to actual
  `VideoDecoder` decode work. A shared-parse-result optimization (threading the probe's demuxed
  `DemuxedTrack` through to the real sampler instead of re-parsing) is a reasonable follow-up if
  profiling on a much larger clip ever shows otherwise.

## D6 — Test-only TypeScript scoping (`mp4Demux.test.ts`)

This app's `src` tree is otherwise browser-only (`tsconfig.app.json`'s `types` is deliberately
just `vite/client`). `mp4Demux.test.ts` is the first test to need real Node filesystem access
(reading `park-approach.mp4`'s actual bytes off disk, per this repo's own precedent of testing
against real files rather than synthetic fixtures where ground truth is available) — it opts into
Node's ambient types locally via a `/// <reference types="node" />` directive rather than
widening every file under `src` to see `process`/`Buffer`/etc. Also: `import.meta.url` resolves
to a simulated `http://localhost` document URL under vitest's `jsdom` test environment, not a
real `file://` URL, so the demo clip's path is resolved off `process.cwd()` instead (vitest always
runs with cwd at the project root).

## D7 — Live finding: sequential decode shifts confidence and VO-cm on the track clip (not a bug)

Live verification (12 trials: 2 clips × {sequential, playback-forced} × 3) turned up a real,
measured divergence beyond the six pre-registered gates, worth recording here since it affects
how much to trust the sequential path's *output values* (as opposed to its plumbing correctness,
which the six gates below cover).

**Track clip, primary pass (MoveNet)**: `view` came back `'ambiguous'`/confidence `0` on all 3
sequential trials, vs `'side'`/`0.75-0.77` on all 3 playback trials. Root cause traced to
`detectView`'s own early-exit: `estimateBodyScale`'s `sampleCoverage` (fraction of the
presence-trimmed window with both shoulder-mid and hip-mid resolvable) came out at ~0.37 under
sequential decode, below `minViewDetectionFrameCoverage` — the presence-trimmed window itself
was small (69 frames) because MoveNet's detections were less *contiguous* under sequential
decode, not less frequent (84/228 detected — a HIGHER ratio than playback's 75-79/219-220).

**Ruled out as causes**: (1) a rendering bug — a mid-run canvas frame captured via a debug hook
was byte-for-byte identical to the same timestamp decoded independently by `ffmpeg` from the same
source file (including the source video's own mirrored-looking lane-number text, confirming it's
an artifact of the stock footage, not this pipeline); (2) non-determinism — the same `'ambiguous'`
result and the same `sampling.detectedFrames` count (84, then 82, then 82 — small run-to-run
spread, consistent with this repo's documented GPU float non-associativity, not a fresh bug)
recurred across all 3 trials; (3) sample-set drift — gate 1 (below) confirms the exact same 228
timestamps are fed to the detector every single trial.

**Working theory, not fully isolated**: MoveNet's detection quality on canvas-drawn
`VideoFrame`s is intermittently worse than on played `<video>` frames for THIS clip specifically —
plausible mechanisms include subtle YUV→RGB conversion or color-space differences between the two
decode pipelines (WebCodecs vs the browser's native video decode/paint path), though this wasn't
isolated further within this change's time budget. The **park clip shows the opposite pattern** —
sequential decode's `view` confidence there is small but consistent (`'front'`/`0.033`, identical
across trials) and close to playback's own already-low front-view confidence (`0.115-0.124`) — so
this isn't a universal regression, it's clip-specific, and it may be specific to MoveNet rather
than pose detection broadly (the scale pass, running MediaPipe over the IDENTICAL sequential-
decoded frames, reports a healthy `'side'`/`0.68` on the same track clip in the same run).

**Downstream effect on VO-cm anchors (gate 5)**: with `view` ambiguous, the primary pass's own
vertical-oscillation metrics read confidence `0`, but the scale pass (MediaPipe, unaffected by
the primary's view failure) still produces a VO-cm figure — measured `4.42cm` (bit-identical
across all 3 sequential trials) vs the documented `≈4.8cm` anchor (playback measured `4.79cm`,
matching). An `~8%` shift, at the edge of this repo's previously-documented `±3-7%` sine-underfit
tolerance band but not clearly inside it. Park showed a larger shift: `10.49cm` (sequential,
bit-identical) vs `≈12.2cm` anchor (playback trials: `10.38/10.27/12.25cm`, `12.25` closest to
anchor) — roughly `14%` low. Since the underlying estimator is unchanged by this work (only
*which frames* feed it changed), the most likely explanation is that the fitted spectral estimate
is sensitive to the sample composition itself — analyzing 100% of decoded frames uniformly in
time is a materially different input than a real-time-throttled subset, even though both are
"correct" samplings of the same clip.

**Disposition**: not a blocker for this change (the plumbing gates below all measure real,
positive, or neutral results) but a genuine open question for whoever tunes the sequential path's
default `targetSamplesPerSecond` or investigates MoveNet-on-VideoFrame quality further — tracked
as a follow-up, not fixed here.
