## Context

#36 shipped `verticalOscillationCm` as the vertical-oscillation family's third real metric, and
its report flagged a wart it deliberately didn't fix: on MoveNet (the default pose backend, which
doesn't measure real-world scale), the cm card renders as if it were merely "low confidence" —
same layout, same discounted-number visual language every other flagged card gets — when the
truth is structurally different: this backend cannot ever measure this quantity, no amount of
better footage would change that. #37 (this change) is that deferred fix, scoped by the epic to
all nine metrics uniformly rather than a `verticalOscillationCm`-specific patch: replace the
current "one grid, flagged cards look slightly different" layout with three explicit confidence
tiers, so "not shown because it's absent/untrustworthy" becomes a place a metric renders, not a
copy detail on a card that still looks like every other card.

## Goals / Non-Goals

**Goals**: single-sourced tier thresholds; a pure, boundary-tested tier function; visibly (not
color-only) distinct tier-2 treatment; a labeled tier-3 section with name+reason only, no value
leakage; stable within-tier ordering; fix the `verticalOscillationCm`-on-MoveNet wart as a
consequence of the general rule, not a special case.

**Non-goals**: touching the heuristics layer (confidence formulas, `caveat` text, `viewFitTable`
multipliers) — all untouched; touching `VerticalOscillationChart` or its placement; adding new
metrics or config; building a cross-run stability mechanism for metrics that sit near a tier
boundary (see D5).

## Decisions

### D1 — Pure tier function home: `metricTier` in `metricConfidence.ts`

```ts
export type MetricTier = 'normal' | 'caveated' | 'excluded'

export function metricTier(metric: MetricResult): MetricTier {
  if (metric.value === null || metric.confidence < LOW_CONFIDENCE_THRESHOLD) {
    return 'excluded'
  }
  return metric.confidence >= HIGH_CONFIDENCE_THRESHOLD ? 'normal' : 'caveated'
}
```

`metricConfidence.ts` is already the confidence-semantics module (`METRIC_LABELS`,
`LOW_CONFIDENCE_THRESHOLD`) — a pure `MetricResult -> MetricTier` function belongs there, not in
`MetricsPanel.tsx`, so it's testable without rendering and reusable if a future surface (e.g. an
export/summary view) needs the same classification.

Boundary behavior, tested exactly (`metricConfidence.test.ts`):
- `confidence === 0.7` (exact) → `'normal'` (the `>=` in the ticket's tier 1 definition).
- `confidence === 0.4` (exact) → `'caveated'` (the `<=` on tier 2's lower bound in the ticket).
- `value === null` at high confidence → `'excluded'` (null always wins, regardless of confidence
  — a metric that measured nothing is never "trusted a little").
- `confidence === 0` → `'excluded'` (falls out of the `< LOW_CONFIDENCE_THRESHOLD` clause; also
  covers `value === null` results, which the heuristics layer always pairs with `confidence: 0`).

**Deliberately excludes `viewFit` from the tier rule** — the ticket's own tier definitions never
mention it, and this is not an oversight to patch: every `'unsuitable'` row in
`DEFAULT_VIEW_FIT_TABLE` (`src/heuristics/types.ts`) carries a `multiplier` of 0.1 or 0.2, and
`computeMetricConfidence` (`src/heuristics/confidence.ts`) multiplies that against every other
factor, each capped at 1 — so `confidence <= multiplier <= 0.2 < LOW_CONFIDENCE_THRESHOLD`
always holds when `viewFit === 'unsuitable'`, for all nine metrics, under the current config.
Checking `viewFit` in `metricTier` would be redundant with arithmetic the confidence formula
already guarantees, not a source of additional coverage. This is an assumption tied to
`DEFAULT_VIEW_FIT_TABLE`'s current values, not a type-level invariant — if the "Math/heuristics"
backlog item (a pluggable `HeuristicsConfig`, not yet built) ever lets a caller raise an
`'unsuitable'` multiplier above 0.4, this derivation needs re-checking. `metricConfidence.test.ts`
has one test documenting exactly this reasoning so a future config change gets a red test instead
of silent drift. This also lets `MetricCard` drop the previous
`metric.viewFit === 'unsuitable' && ' — not reliable from this camera angle'` line: it can never
fire on a tier-1/2 card (a `viewFit: 'unsuitable'` metric always lands in tier 3), and tier 3's
own reason text already names the camera-angle issue verbatim (every `'unsuitable'`-path
`caveat` string in the heuristics layer already says so, e.g. trunkLean's `"...is not reliable
from a ${view} view."`).

### D2 — `LowConfidenceBanner`'s fate: deleted

A dedicated excluded section listing name + reason for every tier-3 metric is a strict superset
of what the banner did (name every flagged metric in one sentence, pointing the reader at each
card's own note). Keeping both would mean the same information appears twice, in two different
shapes, one of which (the banner) no longer even agrees with the layout underneath it — the
banner's `isMetricFlagged` condition and the panel's own flagged treatment used to be
independently maintained matching definitions; `metricTier` replacing both makes that
duplication moot rather than needing to be re-synced. Deleted: `LowConfidenceBanner.tsx`,
`LowConfidenceBanner.test.tsx`. `ResultsView.tsx` drops the import and render call.
`isMetricFlagged` in `metricConfidence.ts` is deleted too — it has no remaining consumer once the
banner is gone and `MetricsPanel` moves to `metricTier`.

Repurposing the banner as a static "section header" was considered and rejected: the excluded
section already has its own heading ("Not measured for this clip"); a second header duplicating
the same idea one component up would be dead weight, not a distinct decision.

### D3 — Tier-2 visual treatment

Border alone is insufficient (WCAG 1.4.1) — pairs with visible text on every tier-2 card:
- **Border**: reuses the app's existing left-accent-stripe idiom (`border-2 border-black
  dark:border-white border-l-4 border-l-brand-600 dark:border-l-brand-400`), the same treatment
  this app's error alert and the now-deleted banner already used for "this needs attention" —
  visually distinct from both tier 1's plain border and tier 3 (which isn't a card at all), and
  consistent with an idiom a user may have already learned elsewhere in this app rather than
  inventing a fourth visual language.
- **Text**: the existing `confidenceLabel` text ("Medium confidence") already renders on every
  tier-2 card unconditionally — this alone satisfies "not color alone" even in the case (real,
  see below) where a tier-2 metric's `caveat` happens to be `null`. When `caveat` IS present, it
  renders in its own bordered note (`border border-brand-600 dark:border-brand-400 p-2`, larger
  text than a tier-1 card's muted footnote-style caveat) rather than the same faint styling a
  tier-1 card's caveat gets — the ticket's "the distinction structural" requirement, applied to
  the note itself, not just the card's outer border.
- **A tier-2 `caveat` can legitimately be `null`**: verified against `cadence.ts` (representative
  of the family) — its `caveats` array only pushes a message for three specific named shortfalls
  (sample size, fit quality, grid-edge frequency); a result whose confidence lands in [0.4, 0.7)
  purely from `frameCoverage`/`interpolatedFraction` degradation, with none of those three named
  conditions true, has `caveat: null`. `metricConfidence.test.ts`'s "no caveat" fixture and
  `MetricsPanel.test.tsx`'s corresponding test exercise this directly rather than assuming caveat
  presence.

### D4 — Excluded section: inside `MetricsPanel`, not a `ResultsView` sibling

Lives at the bottom of `MetricsPanel`'s own `<section aria-label="Form metrics">`, as a second
child alongside the card grid (`<section aria-labelledby="metrics-panel-excluded-heading">`,
headed by an `<h3 id="metrics-panel-excluded-heading">Not measured for this clip</h3>`). Kept
inside `MetricsPanel` rather than promoted to a `ResultsView`-level sibling because it's drawing
from the exact same nine-metric partition the grid above it does — splitting that partition
across two components would mean `ResultsView` needs its own copy of the tier-filtering logic
(or `MetricsPanel` needs to export its partitioned lists), for no benefit: nothing else in
`ResultsView` needs to know which metrics are excluded. `VerticalOscillationChart`'s placement is
untouched either way — it only ever renders inside `verticalOscillation`'s own card when that
metric lands in tier 1/2, exactly as before; if `verticalOscillation` itself lands in tier 3, no
chart renders at all (a chart is exactly the kind of "value markup" tier 3's "no value markup at
all" rule forbids).

Each excluded entry renders `METRIC_LABELS[metric.metric]` (the name) and `metric.caveat` (the
reason) — explicitly no formatted value, no confidence label, no "Not available" placeholder
(asserted by absence in `MetricsPanel.test.tsx`, not merely by not asserting presence). A
defensive fallback string (`"Confidence was too low to report for this clip."`) covers the
narrow gap D3 already surfaces for tier 2 and which applies equally to tier 3: a metric can be
excluded via the `confidence < 0.4` clause with a non-null value and no per-metric caveat message
pushed for that specific shortfall. Every `value === null` path in the heuristics layer IS
contractually guaranteed a non-null `caveat` (each metric's `nullResult` helper takes `caveat` as
a required parameter, not optional) — the fallback exists for the narrower `value` non-null,
`confidence < 0.4`, `caveat: null` combination, not for the null-value path, which never needs it
in practice.

### D5 — Ordering within sections: stable `MetricId` order, no re-sorting by confidence

Both the card grid and the excluded list iterate the same fixed nine-metric array (in `MetricId`
declaration order) and filter by tier, rather than sorting entries by confidence within a
section. Cards don't shuffle position among themselves between runs just because one metric's
confidence moved from 0.61 to 0.68 relative to a sibling's fixed 0.65 — layout stability for a
metric that stays in the same tier.

**Known, accepted limitation**: this does NOT make the panel stable across a tier boundary. A
metric whose confidence crosses 0.7 (or 0.4) between two otherwise-identical runs — plausible on
this app's GPU-non-deterministic pipeline (see this repo's CLAUDE.md "Determinism caveat") — still
jumps from the grid to the excluded section, or between tier-1 and tier-2 styling, run to run.
Within-tier order stability is the cheap, unconditionally-correct win this decision buys; it does
not and cannot smooth over a metric oscillating across a hard threshold, and no debouncing/
hysteresis mechanism is introduced here to do so — out of scope for this change, and not
requested by the ticket.

## Risks / Trade-offs

- **Tier-boundary flicker** (D5's known limitation) — a metric hovering near 0.4 or 0.7 can visibly
  change sections/styling between re-analyzing the same clip. Accepted as a pre-existing property
  of the underlying pipeline's non-determinism, not something this ticket's layout change
  introduces or is scoped to fix.
- **`viewFit`-independence assumption** (D1) is tied to `DEFAULT_VIEW_FIT_TABLE`'s current
  multiplier values, not a type-level guarantee. Flagged with an explicit regression test and this
  note so a future config change surfaces as a test failure rather than a silent behavior change.
- **Deleting `LowConfidenceBanner`** removes a `role="status"` live-region announcement that fired
  once per ready analysis when any metric was flagged. The excluded section is not a live region
  (it's part of the panel's static `phase: 'ready'` render, same as every card) — screen-reader
  users get the same information by reading the panel, but lose the one-time announcement. Judged
  acceptable: `phase === 'ready'` already renders `<p role="status">Analysis complete.</p>`
  (`ResultsView.tsx`), which already announces that results — including the excluded section — are
  now on the page.
