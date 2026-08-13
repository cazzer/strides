## Context

#37 (`openspec/changes/archive/2026-08-12-confidence-tiered-results/`) introduced the
three-tier metrics layout, with tier 3 ("excluded") defined as `confidence <
LOW_CONFIDENCE_THRESHOLD (0.4) OR value === null`. The verified RCA behind this change: the
shared hip-bounce spectral fit's `sinusoidR2` on the track demo clip is bimodal run-to-run
(~0.8+ vs. ~0.31–0.41, GPU non-determinism on identical input), which collapses
`verticalOscillation`/`verticalRatio`/`cadence` confidence to 0.02–0.21 on ~25% of runs — and
#37's confidence clause then deletes all three MEASURED, `viewFit: 'primary'` metrics from the
grid. #37's design.md D5 pre-registered "tier-boundary flicker" as a known limitation, but the
observed failure is worse than styling flicker: real values vanish behind "Not measured for this
clip", which is simply false — they were measured.

This change makes the excluded tier mean exactly one thing: **structurally unmeasurable**. The
confidence-math follow-up (why R² is bimodal; whether confidence should collapse so hard on a
marginal fit) is issue #38 and is not addressed here.

## Goals / Non-Goals

**Goals**: a measured value at a workable camera angle always renders as a card; exclusion
reserved for `value === null` (nothing measured) and `viewFit === 'unsuitable'` (wrong camera
geometry); `LOW_CONFIDENCE_THRESHOLD` demoted to a copy-only boundary (Medium vs. Low indicator);
preserve #37's null-value fix (`verticalOscillationCm` on MoveNet stays excluded) and its whole
visual system (cards, borders, excluded section, summary line) unchanged.

**Non-goals**: touching `src/heuristics/*` in any way (confidence formulas, caveat text,
`viewFitTable` — all issue #38's plane); changing any markup/structure in `MetricsPanel`;
changing `confidenceLabel`'s code; hysteresis/debouncing for run-to-run tier stability (still out
of scope, as it was for #37 D5).

## Decisions

### D1 — Tier rule: excluded iff `value === null || viewFit === 'unsuitable'` (reverses #37 D1)

```ts
export function metricTier(metric: MetricResult): MetricTier {
  if (metric.value === null || metric.viewFit === 'unsuitable') {
    return 'excluded'
  }
  return metric.confidence >= HIGH_CONFIDENCE_THRESHOLD ? 'normal' : 'caveated'
}
```

**This is an explicit reversal of #37 design.md D1's "deliberately excludes `viewFit` from the
tier rule". Reason: the RCA above.** #37 D1's argument was sound for the rule it shipped: with a
`confidence < 0.4` exclusion clause in place, a `viewFit` check was provably redundant (every
`'unsuitable'` multiplier in `DEFAULT_VIEW_FIT_TABLE` is ≤ 0.2, confidence is a product of
factors each ≤ 1, so unsuitable-view metrics always fell below 0.4 anyway). The RCA showed the
confidence clause itself is the defect — it cannot distinguish "wrong camera geometry" from
"measured fine, fit wobbled" — so the clause is removed, and with it the arithmetic that made the
`viewFit` check redundant. The check is now explicit and load-bearing: exclusion means
"structurally unmeasurable" (wrong camera geometry, or nothing measured), never "measured but
uncertain", and that meaning has to be read off the metric's own `viewFit` field rather than
inferred from multiplier arithmetic. A side benefit: exclusion no longer depends on
`DEFAULT_VIEW_FIT_TABLE` multiplier values staying below any threshold — #37 D1's documented
fragility (a future `HeuristicsConfig` override raising an `'unsuitable'` multiplier above 0.4
would have silently changed layout) is gone, because the tier rule reads the classification, not
the number.

Concrete outcomes on the two live shapes from the RCA (track demo, MoveNet):
- `verticalOscillation`/`verticalRatio`/`cadence` at conf 0.02–0.21, non-null, `viewFit:
  'primary'` → **`'caveated'`**: cards with values and a "Low confidence" indicator, on every
  run — the bad-fit runs now differ from good runs only in the indicator text, not in whether the
  number exists.
- `armSwingSymmetry` (side view: non-null value, conf ~0.06, `viewFit: 'unsuitable'`) →
  **`'excluded'`** via the viewFit clause. Same on-screen outcome as before, now for the stated
  structural reason rather than as a confidence side effect.
- `verticalOscillationCm` on MoveNet (`value: null`) → **`'excluded'`**, unchanged — #37's
  original wart fix is preserved by the null clause.

### D2 — Ambiguous view: hard-gated metrics stay excluded — a decision, not an accident

For the six hard-gated metrics (`verticalRatio`, `trunkLean`, `overstriding`, `kneeFlexion`,
`armSwingSymmetry`, `footStrikePattern`), an `ambiguous` view maps to `fit: 'unsuitable'` in
`DEFAULT_VIEW_FIT_TABLE` — so under D1 they land in the excluded section on an
ambiguous-view clip even when they carry a non-null value. This is deliberate, not a leftover:
the heuristics layer classifies ambiguous-view readings of sagittal (or, for arm swing,
frontal) quantities as unsuitable because the failure mode is a *confidently wrong* number
(foreshortened denominator, degenerate angle), not a noisy one — see `DEFAULT_VIEW_FIT_TABLE`'s
own doc comments in `src/heuristics/types.ts`. "Structurally unmeasurable" is exactly the right
bucket for that: the camera geometry can't support the measurement, regardless of how the
confidence arithmetic happens to land. The view-TOLERANT metrics (`verticalOscillation`,
`verticalOscillationCm`, `cadence`) map ambiguous to `'tolerated'` and therefore stay in the
grid, which is equally deliberate — their signals survive an unknown facing direction.

### D3 — `LOW_CONFIDENCE_THRESHOLD` survives as copy-only; the "Low confidence" branch goes live

`confidenceLabel` in `MetricsPanel.tsx` keeps both thresholds and its exact code: "High
confidence" at ≥ 0.7, "Medium confidence" at ≥ 0.4, "Low confidence" below. Under #37 the "Low
confidence" branch was unreachable on a rendered card (anything below 0.4 was excluded); under D1
it renders whenever a measured, view-workable metric's confidence lands below 0.4 — the RCA's
bad-fit runs are exactly this case. Deleting the 0.4 constant was considered and rejected: a
two-band indicator ("High"/"Medium") would understate how weak a 0.02-confidence reading is, and
the three-band copy costs nothing. The single-sourcing rationale from #37 still holds for what
remains: `HIGH_CONFIDENCE_THRESHOLD` is shared by `metricTier` (layout) and `confidenceLabel`
(copy), so the normal/caveated boundary and the High/Medium boundary can never disagree;
`LOW_CONFIDENCE_THRESHOLD` now feeds only the Medium/Low label and no layout decision at all.

### D4 — `ExcludedEntry` fallback copy becomes confidence-neutral

The defensive fallback for an excluded metric with a null `caveat` was "Confidence was too low to
report for this clip." — written for #37's confidence-exclusion path, which no longer exists.
Under D1 the fallback could only ever describe a null-value or unsuitable-view exclusion, for
which a confidence explanation is wrong (a null-valued metric's confidence is forced to 0 as a
consequence, not a cause; an unsuitable-view metric may even have measured a value). New copy:
"Not measurable for this clip." — states the structural fact without asserting a reason the rule
no longer implies. Still expected to be near-unreachable in practice: every `value === null` path
in the heuristics layer contractually sets a caveat (each metric's `nullResult` helper requires
one), and every `'unsuitable'`-path caveat string names the camera-angle issue; the fallback
covers type-legal shapes, not known live ones.

### D5 — Spec delta shape: REMOVE + re-ADD, not MODIFIED

The intended delta was a single MODIFIED block reusing the existing requirement title. That shape
is impossible under openspec 1.8.0: the "A tier-3 metric with a non-null value but low confidence
is excluded, withholding the value" scenario fully reverses (its replacement is "A measured
metric is never excluded for low confidence alone"), and both `openspec validate --strict` and
`openspec archive` hard-reject a MODIFIED block that omits a scenario the main spec still has —
there is no scenario-level removal syntax, and a same-name REMOVE+ADD pair in one change is an
explicit conflict. So this change follows the repo's documented convention for full reversals
(see CLAUDE.md's openspec notes): REMOVE "Metrics panel readouts with confidence/applicability
indicators" with Reason/Migration, ADD "Metrics panel readouts with measurability and confidence
tiers" carrying every surviving scenario — verbatim where behavior is unchanged, updated for the
two whose conditions change ("A tier-2 metric renders its value..." and "A view-unsuitable
metric is visibly flagged..."), plus the replacement scenario.

## Risks / Trade-offs

- **Very-low-confidence numbers now render.** A 0.02-confidence cadence shows its value. That is
  the point of the change — the alternative (deleting measured data on a quarter of runs) was
  measured as worse — but it does shift responsibility onto the indicator copy ("Low confidence")
  and the caveat note to keep a reader appropriately skeptical. If confidence math is later fixed
  (#38), these cards simply migrate back toward "Medium"/"High" with no further layout change.
- **Tier flicker narrows but doesn't vanish**: a metric hovering near 0.7 still flips between
  normal and caveated styling run-to-run (#37 D5's accepted limitation, unchanged). What no
  longer happens is the grid↔excluded flip for measured metrics — the only boundary that deleted
  data.
- **`viewFit` in, confidence out** means a future heuristics-layer change that reclassifies a
  view's fit (not its multiplier) now directly changes layout. That is the intended coupling —
  fit classification is the structural statement — but worth naming: `viewFitTable` fit-label
  edits are now layout-visible.
