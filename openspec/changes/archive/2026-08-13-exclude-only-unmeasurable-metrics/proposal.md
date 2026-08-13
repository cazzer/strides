## Why

Root cause analysis (issue #38's parent finding, verified live): on the track demo clip, the
shared hip-bounce spectral fit's `sinusoidR2` is bimodal run-to-run — ~0.8+ on most runs, but
~0.31–0.41 on roughly a quarter of them, pure GPU non-determinism on identical input. When a run
lands in the low mode, the fit-quality confidence factor collapses `verticalOscillation`,
`verticalRatio`, and `cadence` confidence to 0.02–0.21. Under #37's tier rule
(`openspec/changes/archive/2026-08-12-confidence-tiered-results/`, `confidence <
LOW_CONFIDENCE_THRESHOLD` → tier 3), that deletes all three metrics from the card grid entirely —
"Not measured for this clip" — on ~25% of otherwise-identical runs. But those metrics WERE
measured: they carry real values, at `viewFit: 'primary'`, on the clip's best-suited camera
angle. The panel is withholding measured numbers over a confidence wobble, and a user re-running
the same clip watches three metrics blink in and out of existence.

#37's own "Why" was a different problem — the null-valued `verticalOscillationCm`-on-MoveNet
wart, where "structurally not applicable" rendered as "low confidence". That fix stays fully
intact here: a null value still excludes, unconditionally. What this change reverses is only the
confidence clause #37 attached alongside it: exclusion becomes **structurally unmeasurable
only** — `value === null` (nothing was measured) or `viewFit === 'unsuitable'` (wrong camera
geometry for this quantity) — and never "measured, but we're not confident". A measured value at
a workable camera angle now always renders as a card; low confidence is expressed on the card
("Medium confidence"/"Low confidence" indicator, caveat note, distinct border), not by deleting
the number.

The confidence-math side — why the fit's R² is bimodal at all, and whether confidence should
respond less violently to it — is deliberately NOT touched here. That is follow-up issue #38.
This change fixes the layout rule so that even when confidence math misbehaves, measured data
survives on screen.

## What Changes

- **`metricTier` (src/results/metricConfidence.ts)**: `'excluded'` iff `value === null ||
  viewFit === 'unsuitable'`; otherwise `'normal'` at `confidence >= HIGH_CONFIDENCE_THRESHOLD`
  (0.7), else `'caveated'`. The caveated tier loses its 0.4 floor — it now spans all sub-0.7
  confidence for measured, view-workable metrics. This explicitly reverses #37 design.md D1's
  "deliberately does NOT read `viewFit`" decision — see this change's design.md.
- **`LOW_CONFIDENCE_THRESHOLD` (0.4) survives, but feeds ONLY copy**: the Medium/Low boundary in
  `MetricsPanel`'s `confidenceLabel`. It no longer participates in any layout decision. The "Low
  confidence" label branch, previously unreachable on a card (any metric below 0.4 was excluded),
  is now live.
- **`MetricsPanel.tsx`**: the `ExcludedEntry` defensive fallback copy drops its confidence framing
  ("Confidence was too low to report for this clip." → "Not measurable for this clip.") — an
  excluded metric is never excluded for confidence anymore, so the old string could only mislead.
  Doc comments updated for the new tier definitions. No markup or structure changes.
- **Tests**: `metricConfidence.test.ts` boundary flips (non-null conf 0.39 and conf 0 →
  `'caveated'`; explicit `viewFit: 'unsuitable'` exclusion incl. a pathological
  high-confidence-unsuitable case), `MetricsPanel.test.tsx` flips (low-confidence non-null
  `verticalOscillationCm` now renders as a card with its value and "Low confidence"; the
  track-demo RCA shape renders all three affected metrics as cards on every run; fallback-copy
  fixture rebuilt as a type-legal excluded shape).

## Impact

- Affected specs: `results-view` (REMOVED: "Metrics panel readouts with confidence/applicability
  indicators"; ADDED: "Metrics panel readouts with measurability and confidence tiers" — the
  same requirement restated with the new tier definitions. A single MODIFIED block was the
  intended shape, but its "non-null value but low confidence is excluded" scenario fully
  reverses, and `openspec validate`/`archive` both reject a MODIFIED block that drops a
  scenario — so this follows the repo convention for full reversals: REMOVE with
  Reason/Migration, re-ADD under a fresh name. Every surviving scenario carries over, most
  verbatim; the reversed one is replaced by "A measured metric is never excluded for low
  confidence alone").
- Affected code: `src/results/metricConfidence.ts` (+test), `src/results/MetricsPanel.tsx`
  (+test). Nothing else.
- Not in scope: the heuristics layer (`src/heuristics/*`) — no confidence formula, caveat text,
  or `viewFitTable` change; that whole plane is issue #38. `ResultsView`, the chart, the excluded
  section's markup, and the tier-count summary line's logic are all untouched.
