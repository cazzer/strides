## 1. OpenSpec change

- [x] 1.1 `openspec new change confidence-tiered-results`; write `proposal.md`, `design.md`
      (D1–D5), `tasks.md`, one spec delta (`results-view`: MODIFIED "Metrics panel readouts with
      confidence/applicability indicators", REMOVED "Low-confidence results banner").
- [x] 1.2 `openspec validate confidence-tiered-results --strict` passes. Do NOT archive.

## 2. `metricConfidence.ts` — thresholds + tier function

- [x] 2.1 Add `HIGH_CONFIDENCE_THRESHOLD = 0.7` alongside the existing `LOW_CONFIDENCE_THRESHOLD
      = 0.4`; both exported, both consumed by `metricTier` and `MetricsPanel`'s
      `confidenceLabel` — no duplicated literal `0.7`/`0.4` anywhere else in `src/results/`.
- [x] 2.2 Add `MetricTier = 'normal' | 'caveated' | 'excluded'` and pure `metricTier(metric):
      MetricTier` per design.md D1 (value-null-wins, then the two threshold comparisons,
      deliberately no `viewFit` check — documented why).
- [x] 2.3 Delete `isMetricFlagged` (superseded; no remaining consumer once `LowConfidenceBanner`
      is deleted in task 4).
- [x] 2.4 `metricConfidence.test.ts` (new file): boundary tests at exactly 0.7 and 0.4, null value
      at high confidence, null value at confidence 0, non-null value at confidence 0, and the
      `viewFit: 'unsuitable'`-is-always-excluded documentation test (design.md D1's arithmetic
      argument, exercised as a regression test).

## 3. `MetricsPanel.tsx` — tier partitioning + card/section variants

- [x] 3.1 `confidenceLabel` reads `HIGH_CONFIDENCE_THRESHOLD` instead of a hardcoded `0.7`.
- [x] 3.2 `MetricCard` computes its own tier via `metricTier`; drops the old `isFlagged`/
      `data-flagged` styling and the dead `viewFit === 'unsuitable'` inline text (see design.md
      D1 for why it's provably unreachable once tier 3 owns every unsuitable-view metric); gains
      `data-tier` and tier-2's distinct border + bordered-note caveat treatment (design.md D3).
- [x] 3.3 New `ExcludedEntry` component: name + `caveat` (or the D4 fallback string) only, no
      value/confidence markup.
- [x] 3.4 `MetricsPanel` partitions all nine metrics by `metricTier`; tier 1/2 render in the
      existing grid (VO's chart prop wiring unchanged, only rendered when VO itself is tier 1/2);
      tier 3 renders in a new labeled (`aria-labelledby`) section below the grid, only when
      non-empty. Both sections preserve `MetricId` declaration order (design.md D5).
- [x] 3.5 `MetricsPanel.test.tsx` rewritten: all-tier-1 fixture (labels, formatted values, chart,
      9× "High confidence", `data-tier="normal"` on every card); new mixed-tier fixture (1
      caveated incl. the null-caveat case, 2 excluded, 6 normal) covering tier-2 caveat presence/
      absence, tier-3 absence-of-value-markup assertions, the excluded section's accessible name
      and per-entry name+reason content, within-section ordering for both the grid and the
      excluded list, the `verticalOscillationCm`-on-MoveNet wart fix (null value → excluded, not
      a "Not available" card), a resolved-but-<0.4-confidence `verticalOscillationCm` case
      (value withheld even though one exists), and the D4 no-caveat fallback text.

## 4. `LowConfidenceBanner` — deleted (design.md D2)

- [x] 4.1 Delete `src/results/LowConfidenceBanner.tsx` and `LowConfidenceBanner.test.tsx`.
- [x] 4.2 `ResultsView.tsx`: drop the import and the `<LowConfidenceBanner heuristics={...} />`
      render call.
- [x] 4.3 `ResultsView.test.tsx`: replace the two banner-specific tests with tests asserting the
      excluded section (not a banner) surfaces a flagged metric, and that no
      "lower-confidence results" banner text exists anywhere.

## 5. Gates

- [x] 5.1 `npx tsc -b` — no errors.
- [x] 5.2 `npx vitest run` — full suite green (431 tests).
- [x] 5.3 `npx eslint .` — no issues.

## 6. Live verification

- [x] 6.1 Playwright, real GPU (`--headless=new --enable-gpu --ignore-gpu-blocklist`), MoveNet
      (default backend), both demo clips: captured `[analysis-diagnostics]` console output +
      screenshots. Cross-checked each metric's tier against `metricTier` applied to the
      diagnostics JSON's own confidence/value fields — 0 mismatches across the three verification scenarios (MoveNet track, MoveNet park, MediaPipe track — one run each, cross-checking DOM data-tier against metricTier on the diagnostics JSON).
- [x] 6.2 MediaPipe Pose Landmarker backend override, track clip: confirmed
      `verticalOscillationCm` resolving a numeric value (4.79 cm) at confidence ~0.37 (< 0.4)
      renders in the excluded section (value withheld, reason shown), not as a low-confidence
      card.
