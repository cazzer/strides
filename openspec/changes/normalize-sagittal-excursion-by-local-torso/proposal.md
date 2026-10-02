## Why

View detection's Sagittal Excursion Ratio (SER) divides each side's ankle-relative-to-hip range by
ONE clip-wide torso length. When a runner approaches a handheld camera their on-screen size grows
several-fold, the p95−p5 range is set by the near-field frames, and the mid-clip torso undersizes
the denominator. SER reads high, the front vote is lost, and a front-view clip is labelled
`'ambiguous'` (bead `strides-cge`; measured on the private front-approach fixture IMG_9116 at SER
0.594 against a 0.40 front bar while BSR, 0.571, votes front).

## What Changes

- SER normalizes each directly-detected sample by its LOCAL torso length — the median over a ±0.5 s
  time window — rescaled to the clip-median torso before the p95−p5 range is taken. On a
  constant-distance clip the rescale factor is exactly 1 and the result is bit-identical.
- A sample whose window resolves no torso is skipped, like an unresolvable ankle.
- `bodyScale.ts` gains `torsoLengthAt(frame)` (extracted, `estimateBodyScale` unchanged) and
  `estimateLocalTorsoLengths(frames, halfWindowSeconds)`.
- BSR, every threshold, the sample floor, votes, margins, plausibility, and every other consumer of
  the clip-wide torso are unchanged. The diagnostics shape is unchanged.

## Capabilities

### Modified Capabilities

- `form-heuristics`: "View classification from independent geometric signals" — SER's normalization
  becomes per-sample local-torso, referenced to the clip torso.

## Impact

- `src/heuristics/viewDetection.ts`, `src/heuristics/bodyScale.ts`, `src/heuristics/types.ts` (doc
  only), and their tests.
- Moves `view.diagnostics.sagittalExcursionRatio` on every clip whose runner changes size; on the
  four public clips it moves SER only (largest move `front-approach` 0.334 → 0.294) and changes no
  view label and no metric tier. See design.md "Measurement".
