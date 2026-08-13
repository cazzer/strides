# Plain-language metric copy

## Why

User-facing metric copy currently leaks pipeline and estimator internals: caveats quote R²
("fit quality 0.49", "below the 0.30 minimum"), name frequency bands ("the searched 1.2–4.0 Hz
range"), and name detection machinery ("a pose-detection backend that measures real-world scale
(today, MediaPipe Pose Landmarker)", "a second, scale-aware analysis pass (MediaPipe)", "this
pipeline has no toe/foot keypoint or ground-plane calibration", "tracked stretches", "considered
frames"). A runner reading their results has no use for any of that vocabulary — it reads as
debug output on a consumer surface, and it couples user copy to implementation details that have
already churned several times (estimator swaps, backend additions).

## What Changes

Strings only — zero logic changes. Every caveat fires under exactly the same conditions, every
confidence number and tier is identical, and exports keep their names. The copy policy applied:

- **Metric card descriptions**: `verticalOscillationCm`'s description drops backend talk — it
  "needs a real-world scale measurement from the clip", not "a pose-detection backend".
- **Fit-quality caveats** (cadence, verticalOscillation, verticalOscillationCm, verticalRatio):
  the R²-with-threshold sentences become "the step/bounce rhythm in this clip wasn't perfectly
  steady — confidence reduced accordingly" (mild on purpose: it fires across the whole
  cleared-the-gate band, including next to a "High confidence" label), and the below-gate
  null-value caveats become "…the step/bounce rhythm was too irregular to measure". Failure
  caveats still distinguish WHAT failed (too few frames vs. too short vs. no motion vs.
  irregular rhythm).
- **Cadence grid-edge caveat**: names that the detected cadence sits at the edge of what the
  analysis can measure, not the numeric Hz band.
- **Availability caveats** (`verticalOscillationCm`): no backend names; states no real-world
  scale could be measured for this clip and points at the sibling bounce metrics.
- **Scale-pass narrative** (results status line, excluded-entry hints, provenance sentence): no
  "detection pass"/"scale-aware"/backend names; the visible replay is explained as a second
  look at the same clip, and the completion line only claims a metric was added when the
  grafted metric actually carries a value.
- **Foot-strike proxy caveat**: keeps the approximation framing, drops the
  "this pipeline has no toe/foot keypoint or ground-plane calibration" clause.
- **Jargon in degraded-value caveats**: "tracked stretches" → "stretches of the clip",
  "considered frames" → "analyzed frames", "candidate stride pair(s) were dropped (unresolvable
  hip position or non-advancing displacement)" → "stride pair(s) couldn't be read cleanly and
  didn't count toward the measurement".

Out of scope: internal surfaces (analysis-diagnostics JSON, `fitFailureReason` enum values,
console logging, code comments except doc comments describing the changed strings), view-geometry
caveats, sample-size caveats, and direction-of-travel caveats (already plain).

## Impact

- Affected specs: `form-heuristics` (4 requirements loosened from pinning estimator-internal
  caveat wording to pinning plain-language meaning), `results-view` (3 requirements likewise).
- Affected code: `src/results/MetricsPanel.tsx`, `src/results/ResultsView.tsx`,
  `src/results/scalePassGraft.ts`, `src/heuristics/cadence.ts`,
  `src/heuristics/verticalOscillation.ts`, `src/heuristics/verticalOscillationCm.ts`,
  `src/heuristics/verticalRatio.ts`, `src/heuristics/footStrikePattern.ts`, plus the test files
  asserting the old strings.
- No behavioral change: caveat conditions, confidence math, tiering, and exports are untouched.
