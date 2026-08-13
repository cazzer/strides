## Why

Issue #37 (epic #33). Today the metrics panel treats "confidence" as a per-card cosmetic
detail — every metric renders as a card, and a flagged one (`value: null`, `confidence` below
`LOW_CONFIDENCE_THRESHOLD`, or `viewFit: 'unsuitable'`) just gets muted-opacity styling, a
different confidence-label string, and an entry in a separate `LowConfidenceBanner` summary above
the grid. That treats "this metric couldn't be measured at all" the same as "this metric measured
fine but the camera angle discounted it a little" — both are a slightly-different-looking card
with a number on it. #36's report explicitly named the sharpest case of this: on MoveNet (the
default backend), `verticalOscillationCm` is structurally NOT APPLICABLE (no backend measures
real-world scale), yet it renders exactly like a LOW-CONFIDENCE card — same layout, same "low
confidence" family of copy — collapsing "not applicable" and "measured badly" into one visual
language a reader can't tell apart.

This change restructures the panel into three explicit confidence tiers, applied uniformly to
all nine metrics: a normal card (confidence ≥ 0.7, value present), a visibly distinct caveated
card (0.4 ≤ confidence < 0.7, value present), and a bottom "excluded" section for everything else
(confidence < 0.4, OR value is null) — where an excluded metric shows only its name and the
reason it was excluded, with NO value markup at all. Tier 3 makes "not applicable"/"measured too
unreliably to show" a structural fact about where a metric renders, not a copy detail on an
otherwise-identical card, which is what actually fixes the #36 wart: `verticalOscillationCm` on
MoveNet no longer renders as a discounted number, it renders as an absent one, next to its stated
reason.

## What Changes

- **`metricConfidence.ts` gains `HIGH_CONFIDENCE_THRESHOLD` (0.7) and a pure `metricTier(metric):
  'normal' | 'caveated' | 'excluded'`** — single-sourced with the existing
  `LOW_CONFIDENCE_THRESHOLD` (0.4), consumed by both the tier function and `MetricsPanel`'s
  `confidenceLabel` copy so the two can never disagree about where a metric falls. `metricTier`
  deliberately does not inspect `viewFit`: every `'unsuitable'` entry in
  `DEFAULT_VIEW_FIT_TABLE` carries a confidence multiplier ≤ 0.2, and confidence is a product of
  factors each ≤ 1 (`confidence.ts`), so a view-unsuitable metric's confidence can never clear
  0.4 — it always lands in `'excluded'` via the confidence clause alone, with no separate check
  needed. `isMetricFlagged` is removed (superseded by `metricTier`, and no longer has a consumer
  after `LowConfidenceBanner`'s removal below).
- **`MetricsPanel.tsx` partitions all nine metrics by tier.** Tier 1/2 render as cards in the
  existing grid, in `MetricId` declaration order; tier 2 gets a structurally distinct treatment
  (the app's existing left-accent-stripe border idiom, plus its caveat — when present — rendered
  in its own bordered note rather than the muted footnote styling a tier-1 card's caveat gets).
  Tier 3 metrics are removed from the grid entirely and listed, name + reason only, in a new
  labeled "Not measured for this clip" section at the bottom of the panel (`aria-labelledby`,
  no value/confidence markup of any kind). Ordering within each section follows `MetricId`
  declaration order — never re-sorted by confidence.
- **`LowConfidenceBanner.tsx` and its test are deleted.** A dedicated excluded section at the
  bottom of the panel makes a separate summary banner above it redundant — the same information
  (which metrics are unreliable and why) now lives in one place instead of two, and the excluded
  section says *why* per metric where the banner only ever named *which*. `ResultsView.tsx` drops
  its render and import.
- **`verticalOscillationCm`'s #36-deferred wart is fixed as a side effect of the tier rule**, not
  a special case: on a backend that doesn't measure real-world scale, its `value` is `null`, so
  it now lands in tier 3 (excluded) like any other null-valued metric — no longer a "low
  confidence" card, just an absent one next to its availability reason.

## Impact

- Affected specs: `results-view` (MODIFIED: "Metrics panel readouts with confidence/applicability
  indicators" restated for the tier system, now scoped to all nine metrics rather than three;
  REMOVED: "Low-confidence results banner", migration note pointing at the new excluded section).
- Affected code: `src/results/metricConfidence.ts` (+test), `src/results/MetricsPanel.tsx`
  (+test), `src/results/ResultsView.tsx` (+test); `src/results/LowConfidenceBanner.tsx` and
  `LowConfidenceBanner.test.tsx` deleted.
- Not in scope: the heuristics layer (`src/heuristics/*`) is untouched — no metric's confidence
  formula, `caveat` text, or `viewFitTable` changes. `VerticalOscillationChart` and its placement
  are untouched (the chart is not a card, and only renders when `verticalOscillation` itself
  lands in tier 1/2). No new `MetricId`s, no new `HeuristicsConfig` keys.
