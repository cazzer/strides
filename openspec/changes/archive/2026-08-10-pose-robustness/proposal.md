## Why

Raw per-frame pose detection (#3) is noisy in exactly the ways a runner's footage guarantees:
a runner's limb can drop below the model's confidence threshold for a stride or two, or leave
the frame entirely for a moment (arm swings out of shot, temporary occlusion by the other leg,
camera framing). Feeding that raw stream straight into the future heuristics engine would mean
every heuristic has to independently re-derive "is this point trustworthy" and "what do I do
about a hole in the middle of a stride cycle" — duplicated, easy-to-get-wrong logic scattered
across consumers. This change introduces a single robustness layer that every downstream
consumer (heuristics, results view) depends on instead of the raw `PoseFrame` stream, so that
low-confidence/missing-keypoint handling is decided once, here, and documented once, here.

This is a distinct concern from the (separate, parallel) video-quality pre-analysis gate: that
gate is a whole-video pre-check before analysis starts; this layer handles per-frame gaps
*during* analysis, frame by frame.

## What Changes

- Add `src/pose/robustness/types.ts`: `PoseSample` (the layer's input — see design.md for why
  this is `{ timestamp, frame: PoseFrame | null }` rather than the ticket's literal
  `PoseFrame | null`), `KeypointStatus`, `RobustKeypoint`, `FrameSource`, `RobustPoseFrame`,
  `RobustnessConfig`, and the default config/threshold constants.
- Add `src/pose/robustness/confidenceFilter.ts`: `classifyFrame`, a pure per-frame function that
  labels each of the 12 fixed keypoints `'present'` or `'missing'` against a configurable
  confidence threshold (`null` input frame is the degenerate case of the same rule — 12
  `'missing'` entries, no special-casing).
- Add `src/pose/robustness/interpolate.ts`: `applyRobustness`, the module's public entry point.
  Treats the 12 keypoints as 12 independent 1-D time series and gap-fills each one by linear
  interpolation between real neighboring detections, bounded by a max time-gap; gaps that can't
  be bounded on both sides (leading/trailing, or too long) are flagged `'unrecoverable'` rather
  than extrapolated or defaulted to `(0, 0)`.
- Unit tests for both modules covering: a clean stream, an isolated short gap (exact
  hand-computed lerp values), a long unrecoverable gap, a fully-missing frame, and gaps at the
  very start/end of the sequence (the "never extrapolate" case).
- No UI, no heuristics/quality-gating logic, no live polling loop against a `<video>` element —
  this is a pure data transform tested with hand-built `PoseSample[]` fixtures. Wiring a real
  polling loop is ticket #8's job.

## Capabilities

### New Capabilities
- `pose-robustness`: a gap-tolerant transform from a raw, possibly-gappy `PoseSample` stream into
  a `RobustPoseFrame` stream where every keypoint is explicitly marked `detected`,
  `interpolated`, or `unrecoverable`, with no frame ever dropped and no keypoint ever silently
  defaulted to a fabricated position.

### Modified Capabilities
<!-- none: pose-robustness is additive, it doesn't change pose-detection's existing contract -->

## Impact

- New code only, under `src/pose/robustness/**`; no existing files change.
- No new runtime dependencies.
- Establishes the `RobustPoseFrame` output contract that the heuristics and results-view
  tickets will consume instead of the raw `PoseFrame`/`PoseDetector` output from #3.
- Deliberately deviates from the ticket's literal input type (`PoseFrame | null`) in favor of
  `PoseSample = { timestamp, frame: PoseFrame | null }` — see design.md for the rationale; this
  costs the eventual caller nothing since it already has `video.currentTime` in hand on every
  poll, detection failure or not.
