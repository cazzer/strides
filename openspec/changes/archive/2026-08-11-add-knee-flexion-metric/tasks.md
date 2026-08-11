## 1. Design decision

- [x] 1.1 Decide and document (in `design.md`) the representative per-clip statistic: median
      swing-phase peak flexion, pooled across both legs, expressed as degrees of flexion from full
      extension (`180° - interior hip-knee-ankle angle`)

## 2. Shared primitive

- [x] 2.1 Add `angleBetweenVectorsDeg` (atan2-based three-point joint angle) to
      `src/heuristics/mathUtils.ts`

## 3. Type contract

- [x] 3.1 Add `'kneeFlexion'` to `MetricId` in `src/heuristics/types.ts`
- [x] 3.2 Add `kneeFlexion: MetricResult` to `FormHeuristicsResult`
- [x] 3.3 Add a `kneeFlexion` entry to `DEFAULT_VIEW_FIT_TABLE` (side: primary/1.0, front:
      unsuitable/0.1, ambiguous: unsuitable/0.2 — matching trunk lean/overstriding)
- [x] 3.4 Add `kneeFlexionMinProminenceDegrees` to `HeuristicsConfig`/`DEFAULT_HEURISTICS_CONFIG`

## 4. Metric implementation

- [x] 4.1 Implement `computeKneeFlexion(frames, view, config)` in
      `src/heuristics/kneeFlexion.ts`: per-leg per-frame hip-knee-ankle flexion-degrees series via
      `resolvePoint` + `angleBetweenVectorsDeg`, swing-phase peak detection via
      `findLocalExtrema`, both legs' peaks pooled and medianed, `computeMetricConfidence` (no
      `travelDirectionKnown` factor), hard view gating via `viewFitTable.kneeFlexion`, never
      throws, never returns `NaN`
- [x] 4.2 `src/heuristics/kneeFlexion.test.ts`: clean clip with resolvable flexion → plausible
      non-null median value and sane sample size; insufficient/unresolvable data → `null` value +
      caveat (both the "no resolvable leg position at all" and "resolvable but no detectable peak"
      cases); view-unsuitable (front) gating → value still computed, `viewFit: 'unsuitable'`,
      confidence capped at the `0.1` multiplier, caveat present

## 5. Orchestration and UI wiring

- [x] 5.1 Wire `computeKneeFlexion` into `computeFormHeuristics` in `src/heuristics/index.ts`
- [x] 5.2 Add `kneeFlexion` to `METRIC_LABELS`/`METRIC_DESCRIPTIONS` and render a fourth
      `MetricCard` in `src/results/MetricsPanel.tsx`
- [x] 5.3 Update existing `FormHeuristicsResult` test fixtures (`MetricsPanel.test.tsx`,
      `ResultsView.test.tsx`, `useVideoAnalysis.test.ts`) to include `kneeFlexion`, and adjust any
      count-based assertions (e.g. flagged-card counts) that now include the fourth metric

## 6. OpenSpec + verification

- [x] 6.1 `openspec validate --strict` passes for `add-knee-flexion-metric`
- [x] 6.2 `npx vitest run` passes
- [x] 6.3 `npx tsc -b` passes
- [x] 6.4 `npx eslint .` passes clean
- [x] 6.5 Live-browser check: dev server, upload a generated test clip, confirm a "Knee flexion"
      `MetricCard` renders in the results view
