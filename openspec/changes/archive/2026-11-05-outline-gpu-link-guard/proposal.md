## Why

On a Galaxy S21 (Adreno 660, Chrome 156) one of MediaPipe's GPU-delegate kernels fails to link
(strides-p1qt.16/.22). MediaPipe raises no error, and the outline pass's person masks come out as
garbage: GPU-vs-CPU IoU is 0.06–0.26 on the phone, against 0.77–0.98 on desktop. The outline pass
reported "0 sideways travel, confidence 1" from those masks. A reading built on them must never
reach a user.

## What Changes

- The outline segmenter watches WebGL program links while its GPU graph is built, and on each
  segmentation until one returns a pose (the kernel links lazily, at the landmark model's first
  run). On any failure it discards that result and goes unavailable. The pass ends `failed` with
  the unavailable caveat and reports nothing.
- No CPU-delegate fallback. On the S21 the CPU graph aborts the WASM module on its first masked
  detect (`image_frame.cc:415 Check failed: 1 == ChannelSize()`), which wedges the page (follow-up
  strides-p1qt.23).
- The dev-only outline `[perf-timings]` line reports `gpuLinkFailures`.
- Where every program links (desktop), nothing changes: same graph, same masks, same values.

## Impact

- Code: `src/pose/backends/glProgramLinkWatch.ts` (new), `src/pose/backends/mediapipePoseLandmarker.ts`,
  `src/results/outlineFrameReader.ts` (async `segment`, unavailable flag), `src/results/useVideoAnalysis.ts`
  (fail on unavailable, dev perf field).
- Phones with a broken GPU graph get no sideways-foot-travel reading, and say why.
