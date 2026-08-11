## Why

Diagnostics work this session (`add-analysis-diagnostics-export`) surfaced why a real demo clip
scored near-zero confidence across every metric: the subject is out of frame for stretches at
the start and end of the clip, and those dead frames dilute confidence denominators that are
computed against the raw clip length. Separately, cadence's value itself — not just its
confidence — is wrong under the same conditions: `strikeCount / elapsedClipDuration` divides by
time nobody was running, systematically underestimating steps/minute whenever there's dead time
anywhere in the clip, not just gaps in confidence.

## What Changes

- A new presence-window trim identifies the span of a clip where the subject is actually
  trackable (shoulder+hip resolvable, with a short consecutive-frame guard against a single
  spurious detection anchoring the window) and is applied before metrics are computed, so
  `frameCoverage`/`sampleCoverage` — currently `resolvedFrames / frames.length` in `bodyScale.ts`
  and four metric modules — stop being diluted by out-of-frame stretches. `VideoAnalysisState`'s
  `robustFrames` (used by the skeleton overlay) and `diagnostics` (used for debugging) are
  **not** trimmed — only the frames fed into `computeFormHeuristics` are, so the overlay and
  diagnostics keep showing the full, honest picture while the metrics' confidence reflects only
  the window where there was something to measure.
- Cadence's value computation changes from `footstrikeCount / elapsedClipDuration` to `60 /
  median(consecutive inter-footstrike-interval seconds)` — robust to dead time anywhere in the
  clip (start, end, or a mid-clip dropout), not just requiring a presence-window trim to already
  have removed it, since it never looks at total elapsed time at all.

## Capabilities

### Modified Capabilities
- `form-heuristics`: cadence's value-computation requirement changes; a new requirement covers
  the presence-window trim's effect on `frameCoverage`-derived confidence for the metrics that
  use it.

## Impact

- New `src/heuristics/presenceWindow.ts` (+ test): pure function, no new dependencies.
- `src/heuristics/types.ts`: new `presenceMinConsecutiveFrames` config constant.
- `src/heuristics/cadence.ts` (+ test): value computation rewritten; the "clip duration could
  not be determined" null case is replaced by a "not enough footstrikes for an interval" one
  (needs >= 2 candidates instead of >= 1).
- `src/results/useVideoAnalysis.ts`: presence-window-trimmed frames are computed and passed to
  `computeFormHeuristics`; `robustFrames`/`diagnostics` continue to reflect the untrimmed clip.
- No changes to `sampleClip.ts`, the robustness/interpolation layer, or the other five metric
  modules — their value computations were already gap-tolerant (median aggregation over
  `findLocalExtrema`'s gap-independent runs); they benefit from the trim's effect on
  `bodyScale.sampleCoverage` automatically, with no code changes of their own.
