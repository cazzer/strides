## Context

Issue #3 (parent: #1) asks for a pose-detection abstraction that downstream tickets — robustness
(gap-handling), quality-gate, heuristics, results-view — will all consume via `PoseFrame` /
`PoseDetector`. The shape decided here is effectively load-bearing API for the rest of the app,
so it's worth pinning down deliberately even though this ticket itself only ships one backend.

`feat/2-bootstrap` already pins `@tensorflow-models/pose-detection@2.1.3`,
`@tensorflow/tfjs-core@4.22.0`, and `@tensorflow/tfjs-backend-webgl@4.22.0` in `package.json`.
`tsconfig.app.json` has `verbatimModuleSyntax: true`, so type-only cross-file imports must use
`import type`.

## Goals / Non-Goals

**Goals:**
- Own `PoseFrame`/`Keypoint` types, fully decoupled from `@tensorflow-models/pose-detection`'s
  types — nothing from that package's public API leaks past `src/pose/backends/`.
- Backend selection as a single config parameter (`createDetector({ backend })`), not a code
  branch scattered through the app.
- MoveNet SinglePose Lightning as the only implemented backend today, structured so a future
  BlazePose backend is a drop-in (same `toPoseFrame` mapping helper, same registry entry).
- Distinguish "no person in frame" (`null`) from "person present, low confidence" (`PoseFrame`
  with low per-keypoint scores) — these are different signals for a future robustness layer.

**Non-Goals:**
- Robustness/gap-handling, heuristics, overlay rendering — separate tickets that consume this
  abstraction's output as-is.
- Multi-pose or tracking (`box`/`id`) — single runner in frame only, MoveNet SinglePose.
- Loading UX for model-fetch latency inside `createDetector`.
- Implementing the BlazePose backend itself — only leaving the seam for it.
- Retry/catch policy around `estimatePoses` errors — they propagate uncaught from this layer.

## Decisions

**Fixed-length-12, fixed-order keypoints array, never sparse.** Rationale: downstream code never
needs an existence check, only score thresholding — `keypoints[i]` is always the same body part
for every `PoseFrame`, from every backend. The `toPoseFrame` helper in `backends/common.ts`
enforces this by building a `Map<string, RawKeypoint>` from a backend's raw output, then mapping
over `COMMON_KEYPOINT_NAMES` to produce the fixed output — regardless of how many points, or in
what order, the underlying model actually returns.

**`timestamp` is `video.currentTime`, not `performance.now()`.** Rationale: `currentTime` means
the same thing for a live webcam stream and an uploaded file's playback position — "how far into
this video are we." Wall-clock time wouldn't give downstream code a consistent way to correlate a
`PoseFrame` back to "where in the video" for both source types. Documented via JSDoc on the field
in `types.ts`.

**`null` return is distinct from a low-confidence `PoseFrame`.** Rationale: "no person detected"
and "person present but blurry/occluded/low-confidence" are different signals. Collapsing them
(e.g., always returning a `PoseFrame`, sometimes with all-zero scores) would make it impossible
for a future robustness layer to distinguish "nothing to analyze right now" from "keep analyzing,
just filter by score." `estimatePose` returns `null` only when the model's raw result array is
empty.

**No overall `Pose.score` field.** The ticket's acceptance criteria pin the shape to exactly
`{ keypoints, timestamp }`; per-keypoint `score` is sufficient for downstream thresholding, so an
aggregate confidence field is intentionally omitted rather than left for "later."

**Shared `toPoseFrame` mapping helper lives in `backends/common.ts`, not per-backend.**
Rationale: this is the one place that filters non-subset names and reorders raw keypoints into
the fixed contract. Every future backend (BlazePose) reuses it instead of duplicating
filter/reorder logic — this is what makes a new backend a drop-in rather than a parallel
reimplementation.

**Backend registry is a plain synchronous `Record<PoseBackendId, () => Promise<PoseDetector>>` in
`detector.ts`, with zero TF.js imports in that file.** Rationale: keeps the app-facing boundary
free of TF.js/model-loading weight in its own module graph. Dynamic `import()` per backend isn't
needed yet since only one backend exists; the map shape leaves room for it once a second backend
(and its bundle-size cost) justifies lazy loading.

**`estimatePoses` errors propagate uncaught.** Rationale: retry/backoff/fallback policy is a
concern for a future robustness layer, which will wrap this abstraction's calls — this layer's
job is just to reflect the model's outcome (a `PoseFrame`, `null`, or a thrown error) faithfully.

**`dispose()` is required, not optional, on `PoseDetector`.** Rationale: forces every backend —
and every caller — to have an explicit WebGL-resource-release story from day one, rather than
leaving it to be bolted on once GPU-memory leaks show up.

**`createDetector` is not declared `async`, even though it returns `Promise<PoseDetector>`.**
Rationale, discovered during implementation: an `async function` can never throw synchronously to
its caller — a `throw` before the first `await` is caught internally and turned into a rejected
Promise, not a synchronous exception. Since "unknown backend throws synchronously" is an explicit
requirement (so a caller can validate config with a plain `try/catch` before any async work, and
so it fails loudly instead of as an easily-missed unhandled rejection), `createDetector` is a
plain function that either throws synchronously or returns the backend factory's Promise
directly. The public signature (`(config) => Promise<PoseDetector>`) is unchanged.

## Risks / Trade-offs

- MoveNet's exact TS enum path/value for "SinglePose Lightning" (conceptually
  `poseDetection.SupportedModels.MoveNet` +
  `movenet.modelType: SinglePoseLightning`/`SINGLEPOSE_LIGHTNING`) needs confirming against the
  installed `@tensorflow-models/pose-detection@2.1.3` `.d.ts` rather than assumed — verified
  empirically during implementation; any deviation from the assumed symbol is called out in the
  implementation report.
- jsdom mocking of `@tensorflow/tfjs-backend-webgl` (side-effect import), `@tensorflow/tfjs-core`
  (`setBackend`/`ready`), and `@tensorflow-models/pose-detection` (`createDetector`, plus
  `SupportedModels`/model-type constants via `importOriginal` or hardcoded fallbacks) needs
  empirical verification — real WebGL/network calls are not viable under jsdom, so backend unit
  tests mock at the module boundary rather than exercising the real model.
- No loading UX for model-fetch latency is an explicit non-goal here; a later ticket may need to
  add it once this abstraction is wired into the UI.
