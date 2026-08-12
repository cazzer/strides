## Why

Issue #35 (epic #33). Vertical oscillation's shipped `verticalOscillation` metric normalizes bounce
by torso length — a defensible number, but not the quantity a runner's watch means by "Vertical
Ratio" (Garmin/COROS: VO / stride length × 100). The 2026-08-12 accuracy investigation
(`CLAUDE.md`) prototyped bounce_px / stride_px on the track demo clip and got ~5–10%, much closer
to the user's ~10% watch reading than the torso-length version's ~18–25% — but that investigation
was throwaway instrumentation, reused `analyzeBounceSignal`'s general form rather than the
hip-pinned fit the VO family is standardizing on (epic #33), and was never wired into the pipeline,
tested, or view-gated. This change ships it for real: a reusable `estimateStrideLength` extractor
plus a new `verticalRatio` metric, sharing the exact same hip-bounce spectral fit
`verticalOscillation` uses (no independent re-fit, no drift between the two numbers).

Stride length is only observable from a camera angle with net horizontal (fore-aft) hip
displacement — `estimateTravelDirection` already exists for exactly this determination
(`overstriding` reuses it). An approach/indeterminate-direction clip (e.g. this repo's park demo)
structurally cannot produce a stride length, so `verticalRatio` is null there by construction, with
the same caveat phrasing `overstriding` already established for a travel-direction gate.

## What Changes

- **New `src/heuristics/strideLength.ts`**: `estimateStrideLength(frames, config)` — a pure
  extractor (no confidence/caveat policy) reusing `estimateBodyScale`, `estimateTravelDirection`,
  and `detectFootstrikes` as-is. Returns the median same-side consecutive-footstrike-pair hip-x
  displacement in pixels, gated (in order) on body scale, then travel direction, then footstrike
  count, then at least one advancing (positive, signed-by-travel-direction) pair.
- **New `src/heuristics/verticalRatio.ts`**: `computeVerticalRatio(frames, view, config)` — policy
  layer. Reads bounce amplitude from `analyzeHipBounce` (hip-pinned, NOT
  `verticalOscillationSignal`-configurable — this metric's numerator must stay pinned to the same
  physical quantity as its denominator regardless of that setting) and stride length from
  `estimateStrideLength`; `value = peakToPeakAmplitudePx / strideLengthPx`, unit `'percent'`
  (0..1 fraction — `formatValue` already renders `× 100`, no formatting change needed).
- **`MetricId` widens `verticalOscillation` → `verticalRatio` → `trunkLean`** (7 → 8 metrics), in
  that family-adjacent position everywhere `MetricId` is enumerated.
- **`viewFitTable.verticalRatio`**: side primary/1.0, front unsuitable/0.1, ambiguous
  unsuitable/0.2 — argued from stride observability (see design.md D4), not copied from an
  existing row.
- **Results layer**: `METRIC_LABELS`, a new `MetricsPanel` card, and `LowConfidenceBanner`'s
  metric-id enumeration all pick up `verticalRatio` — the last of these refactored to derive its
  id list from `METRIC_LABELS`'s keys instead of a hand-written array, closing off the class of bug
  where a new metric ships without being added to a hardcoded enumeration site (design.md D9).
- **No new config keys.** `verticalRatio` reuses `verticalOscillationMinFitR2` for its fit-quality
  gate — see design.md D6 for why a separate `verticalRatioMinFitR2` would be incoherent (same
  amplitude, same fit, two gates on one number).
- **Watch-comparability remains unconfirmed** (design.md D8) — this change targets the
  VO_cm/stride_length inference from the prior investigation, not a value the user has confirmed
  against their own watch reading yet.

## Impact

- Affected specs: `form-heuristics` (ADDED: stride length extraction, travel-direction gating,
  vertical-ratio computation from the shared fit, side-view hard-gating, orchestration
  participation).
- Affected code: `src/heuristics/types.ts`, `strideLength.ts` (new), `verticalRatio.ts` (new),
  `index.ts`, `src/results/metricConfidence.ts`, `MetricsPanel.tsx`, `LowConfidenceBanner.tsx`,
  `__fixtures__/syntheticGait.ts` (additive `travelSpeedPxPerSec` param). No changes to
  `detectFootstrikes`, `overstriding.ts`, `footStrikePattern.ts`, or `verticalOscillationCm.ts`
  (owned by the parallel #34 ticket).
