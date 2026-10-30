## Why

`swingFootLateralExcursion` (strides-za1) reports an unsigned P80−P20 range of ankle-minus-knee over
hip width. On the user's whip-free front footage it reads 25.4%: an unsigned range is never ~0, so it
cannot say "no sideways travel". The `strides-uz48` probe showed why joint positions cannot fix that
from the front: in early swing a whip-free foot is hidden behind the thigh, and the detector guesses
its ankle. The `strides-uz48.1` spike asked the reverse question of MediaPipe's person mask instead —
does anything below the swing knee stick out past the outer edge of that leg's thigh? — and on
`park-approach.mp4` it read 0 in all four usable early swings, inside a stance floor of 0, with a
synthetic flick read back within pixel rounding (`docs/agent-notes/swing-foot-travel.md`).

## What Changes

- On front clips, `swingFootLateralExcursion` becomes an early-swing **outline check**. The primary
  pass only plans it (value null, "checking…" caveat, `outlinePlan`); a new background **outline
  pass** runs after every scale pass, segments MoveNet-guided 7×12 hip-width crops at native pixels
  with a dedicated IMAGE-mode MediaPipe PoseLandmarker with person masks, and grafts ONLY this
  metric. Side and ambiguous views abstain as before.
- Value: per early-swing window [strike + T/2, strike + 5T/4], P80 of protrusion past the thigh's
  outer edge in hip widths; per side the median of usable windows; the larger side is reported, and
  reads exactly 0 when inside the clip's stance floor. The caveat always gives the swing counts and
  says it is an outline check.
- Card label "Sideways foot travel"; value "None past the leg's outline" at 0, "12.3% of hip width
  outward" otherwise. No band. Evidence: the early-swing outline ghosted against stance, with the
  thigh edge, the leg's outline, the outermost point and the hip midline drawn.
- The runner's `swingFootArc` is rebound as peak outward ankle travel past the knee line (neutral 0).
- **BREAKING (metric meaning):** values before this change are a different quantity.
- Playback-path clips and a failed pass show an "unavailable" caveat; a kill switch ships ON.

## Capabilities

### New Capabilities

### Modified Capabilities
- `form-heuristics`: the swing-foot requirements are replaced by the outline check.
- `results-view`: new presentation and graft requirements for the metric.
- `multi-clip-analysis`: the outline pass's place in the background lane.
- `pose-detection`: the dedicated outline-pass segmenter.
- `analysis-diagnostics`: the outline-pass console line.
- `model-runner`: the swing-foot arc is read as a peak, not a percentile range.

## Impact

`src/heuristics/swingFootOutline.ts` (new), `swingFootLateralExcursion.ts`, `types.ts`;
`src/pose/outlinePassDetector.ts` (new), `backends/mediapipePoseLandmarker.ts`;
`src/results/outlineFrameReader.ts`, `swingFootOutlineGraft.ts`, `outlinePassConfig.ts` (new),
`useVideoAnalysis.ts`, `multiClipAnalysis.ts`, `MultiClipVideoSession.tsx`, `ClipSlot.tsx`,
`GuidedResultsView.tsx`, formatters, copy, `evidenceFrames.ts`, `evidenceAnnotations.ts`;
`src/runner/*`; `scripts/ab-person-selection.mjs`. No other metric's value or evidence changes.
