## Context

MediaPipe tasks-vision gives no health signal for its GPU delegate. The only deterministic signal
the page can see is a failed `linkProgram`. On Adreno 660 exactly one of ~82 programs fails (a
4-output bilinear-resize+add kernel, empty info log), and every later draw with it raises
`GL_INVALID_OPERATION`.

## Decisions

- **Watch links, don't validate masks.** Comparing against a CPU mask needs a CPU graph, which
  aborts on the S21 (below), and a tuned threshold. A failed link is binary and costs one
  LINK_STATUS query per program, and only while a watch is open.
- **Watch build and first inference.** On the S21 the build shows 0 failures; the failure comes on
  the first detect that runs the landmark model. The watch covers creation (async) and each GPU
  `detect()` (synchronous, so nothing else can link inside it) until a pose comes back. The
  `linkProgram` wrap exists only while a watch is open.
- **Fail closed, no CPU fallback.** Tried first: on the S21 the CPU-delegate graph with
  `outputSegmentationMasks` hits `F image_frame.cc:415 Check failed: 1 == ChannelSize() (1 vs. 4)`
  and `Aborted()` on its first detect of a crop, after which the renderer's main thread spins
  (41-minute hang, uninterruptible). Shipping that would wedge every affected phone, so the pass
  fails with the unavailable caveat instead. Making CPU masks work is strides-p1qt.23.
- **`segment()` became async** so the reader can catch the unavailable rejection. Its only
  consumer is the outline frame reader, whose `estimatePose` was already async.
- **Scale pass unchanged.** Its landmarks are not visibly affected (GPU-vs-CPU landmark gaps match
  desktop's), and it needs no masks.

## Risks

- A kernel that only links on some later, rarer inference path would slip past the watch. On the
  S21 the one failing kernel is caught on the first pose.
