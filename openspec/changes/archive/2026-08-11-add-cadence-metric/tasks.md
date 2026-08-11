## 1. Type contract

- [x] 1.1 Add `'cadence'` to `MetricId`, add `'stepsPerMinute'` to `MetricResult['unit']`, extend
      `FormHeuristicsResult` with `cadence: MetricResult`, add a `cadence` entry to
      `DEFAULT_VIEW_FIT_TABLE` (`side: primary/1.0`, `front: tolerated/0.8`,
      `ambiguous: tolerated/0.6`) in `src/heuristics/types.ts`

## 2. Cadence computation

- [x] 2.1 Implement `computeCadence(frames, view, config)` in `src/heuristics/cadence.ts`: uses
      `detectFootstrikes` directly (no reimplemented detection), clip duration as
      `frames[frames.length - 1].timestamp - frames[0].timestamp`, `value =
      strikeCount / durationMinutes`, `frameCoverage` from `bodyScale.sampleCoverage`,
      `interpolatedFraction` read per-candidate via `resolvePoint`, view-tolerant confidence via
      `viewFitTable.cadence`, distinct caveats for "no body scale" / "no footstrikes" / "clip spans
      no measurable time" / "below minimum sample size"
- [x] 2.2 `src/heuristics/cadence.test.ts`: clean side-view clip -> value matches
      `sampleSize / durationMinutes` and lands near the fixture's requested cadence, confidence
      near 1; front-view and ambiguous-view clips -> still computed, `viewFit: 'tolerated'`,
      confidence discounted by `0.8`/`0.6` respectively; too-few-footstrikes -> null value, 0
      confidence, explicit caveat, no crash; no body-scale reference -> null value, 0 confidence,
      distinct caveat; zero-duration single-frame input -> null value, no crash, no NaN/Infinity

## 3. Orchestration and UI wiring

- [x] 3.1 Wire `computeCadence` into `computeFormHeuristics` in `src/heuristics/index.ts`
- [x] 3.2 Extend `src/heuristics/index.test.ts` to cover cadence in the existing
      fully-populated-result, ambiguous-view-gating, and empty-input assertions
- [x] 3.3 Add `cadence: 'Cadence'` + description to `MetricsPanel.tsx`'s label/description maps,
      add a `'stepsPerMinute'` case to `formatValue` (e.g. "172 steps/min"), render a fourth
      `MetricCard` for `heuristics.cadence`
- [x] 3.4 Extend `MetricsPanel.test.tsx`'s fixtures and assertions to cover the fourth card
- [x] 3.5 Extend the `FormHeuristicsResult` fixtures in `ResultsView.test.tsx` and
      `useVideoAnalysis.test.ts` with a `cadence` field so they keep typechecking

## 4. Verification

- [x] 4.1 `npx vitest run` passes
- [x] 4.2 `npx tsc -b` passes
- [x] 4.3 `npx eslint .` passes
- [x] 4.4 `openspec validate --strict` passes for this change
- [x] 4.5 Live-browser check: dev server + Playwright/chromium with real WebGL/TF.js pose
      detection on an uploaded test clip, confirming a Cadence card renders with a plausible value
