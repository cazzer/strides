## 1. Types and config

- [x] 1.1 Add `'armSwingSymmetry'` to `MetricId`; extend `FormHeuristicsResult` with an
      `armSwingSymmetry: MetricResult` field; add `'percent'` to `MetricResult['unit']`; add
      `armSwingMinProminenceRatio` to `HeuristicsConfig` + `DEFAULT_HEURISTICS_CONFIG`; add an
      `armSwingSymmetry` entry to `DEFAULT_VIEW_FIT_TABLE` (`front: primary/1.0`, `side:
      unsuitable/0.1`, `ambiguous: unsuitable/0.2`) — `src/heuristics/types.ts`

## 2. Metric implementation

- [x] 2.1 Implement `computeArmSwingSymmetry(frames, view, config)`: per-side wrist-relative-to-
      shoulder vertical (`wrist.y - shoulder.y`) series, `findLocalExtrema` + half-cycle amplitude
      pairing (mirroring `verticalOscillation.ts`), torso-normalized median amplitude per side,
      `min/max` ratio with a guarded `maxValue === 0` case, weakest-side `frameCoverage`/
      `sampleSize` aggregation, view gating via `config.viewFitTable.armSwingSymmetry`, never
      `null`/`NaN`/throw — `src/heuristics/armSwingSymmetry.ts`
- [x] 2.2 `src/heuristics/armSwingSymmetry.test.ts`: a clean front-view clip with symmetric swing
      (high ratio, `viewFit: 'primary'`, high confidence); insufficient data — no resolvable
      wrist/shoulder and separately no complete swing cycle — both `-> null` + non-null caveat;
      side-view gating (`viewFit: 'unsuitable'`, confidence capped near the `0.1` multiplier, value
      still computed); a genuinely asymmetric synthetic case (one side's amplitude well below the
      other's) scoring meaningfully lower than an otherwise-identical symmetric case; empty frame
      list does not throw

## 3. Orchestration

- [x] 3.1 Wire `computeArmSwingSymmetry` into `computeFormHeuristics` — `src/heuristics/index.ts`
- [x] 3.2 Extend `src/heuristics/index.test.ts`'s existing "fully-populated result" assertions to
      also cover `result.armSwingSymmetry`

## 4. UI rendering

- [x] 4.1 `formatValue` handles the `'percent'` unit (plain `NN.N%`, no torso-length suffix); add
      `armSwingSymmetry` to `METRIC_LABELS`/`METRIC_DESCRIPTIONS`; render a fourth `MetricCard` for
      `heuristics.armSwingSymmetry` — `src/results/MetricsPanel.tsx`
- [x] 4.2 Update `src/results/MetricsPanel.test.tsx` fixtures (`FormHeuristicsResult` now requires
      `armSwingSymmetry`) and assertions (label rendering, flagged-card counts, `'percent'`
      formatting) for the fourth card — `src/results/MetricsPanel.test.tsx`

## 5. OpenSpec and verification

- [x] 5.1 `openspec validate --strict` passes for this change
- [x] 5.2 `npx vitest run` passes
- [x] 5.3 `npx tsc -b` passes
- [x] 5.4 `npx eslint .` passes clean
- [x] 5.5 Live-browser check: dev server, upload a synthetic test clip, confirm an "Arm swing
      symmetry" card renders with a plausible value
