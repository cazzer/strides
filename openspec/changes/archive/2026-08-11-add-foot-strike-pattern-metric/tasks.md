## 1. Design

- [x] 1.1 Decide the exact proxy (ankle-relative-to-knee, signed by travel direction, normalized
      by torso length), the classification bands, and `footStrikeMidfootBandRatio = 0.05`; document
      reasoning and alternatives considered in `design.md`

## 2. Type contract

- [x] 2.1 Add `'footStrikePattern'` to `MetricId`, a `footStrikePattern: MetricResult` field on
      `FormHeuristicsResult`, a `footStrikePattern` entry in `DEFAULT_VIEW_FIT_TABLE`
      (side-view-primary, hard-gated like `trunkLean`/`overstriding`), and
      `footStrikeMidfootBandRatio` (+ default `0.05`) on `HeuristicsConfig`, in
      `src/heuristics/types.ts`
- [x] 2.2 Document on `MetricResult.caveat` that `footStrikePattern` is the one deliberate
      exception to "non-null only when degraded"

## 3. Metric implementation

- [x] 3.1 Implement `computeFootStrikePattern(frames, view, config)` in
      `src/heuristics/footStrikePattern.ts`: reuse `detectFootstrikes` for footstrike timing,
      resolve same-side ankle/knee at each candidate, compute the signed torso-normalized offset
      ratio, aggregate via median, gate/confidence via the existing `viewFitTable`/
      `computeMetricConfidence` machinery
- [x] 3.2 Implement and export `classifyFootStrike(ratio, midfootBandRatio)` as a pure function
- [x] 3.3 Seed every returned result's `caveat` with the mandatory proxy disclaimer
      (`PROXY_CAVEAT`), appending situational caveats (view-unsuitable, indeterminate travel
      direction, low sample size) after it — never replacing it, never returning `null`

## 4. Orchestration wiring

- [x] 4.1 Wire `computeFootStrikePattern` into `computeFormHeuristics` in
      `src/heuristics/index.ts`
- [x] 4.2 Update `src/heuristics/index.test.ts` for the new field: fully-populated clean-clip
      result, ambiguous-view gating, empty-input null case, and a caveat-non-null-even-when-clean
      assertion

## 5. Results view

- [x] 5.1 Add `footStrikePattern` label/description to `METRIC_LABELS`/`METRIC_DESCRIPTIONS` and a
      proxy-aware value formatter (ratio -> heel/midfoot/forefoot label via `classifyFootStrike`)
      in `src/results/MetricsPanel.tsx`; render a fourth `MetricCard`
- [x] 5.2 Update `src/results/MetricsPanel.test.tsx`, `src/results/ResultsView.test.tsx`, and
      `src/results/useVideoAnalysis.test.ts` fixtures for the new `FormHeuristicsResult` field;
      add a dedicated assertion that the foot-strike-pattern card's caveat renders even in an
      otherwise-unflagged, clean result

## 6. Unit tests (`src/heuristics/footStrikePattern.test.ts`)

- [x] 6.1 Synthetic classification: ankle notably ahead of the knee -> heel, roughly under -> 
      midfoot, notably behind -> forefoot
- [x] 6.2 Insufficient/no footstrikes -> `null` value, `0` confidence, non-null caveat, no throw
- [x] 6.3 No resolvable body-scale reference -> `null` value, `0` confidence, non-null caveat
- [x] 6.4 Front-view clip -> `viewFit: 'unsuitable'`, confidence capped at the `0.1` multiplier,
      caveat mentions the view
- [x] 6.5 Explicit, consolidated assertion that `caveat` is non-null across the clean/high-
      confidence case AND every degraded case above — the guardrail for the hard requirement
- [x] 6.6 `classifyFootStrike` boundary cases: just past each band edge, and both edges themselves
      (inclusive -> midfoot)

## 7. Verification

- [x] 7.1 `npx vitest run` passes
- [x] 7.2 `npx tsc -b` passes
- [x] 7.3 `npx eslint .` passes clean
- [x] 7.4 `openspec validate --strict` passes for this change
- [x] 7.5 Live-browser check: dev server + uploaded test clip, analysis auto-starts, screenshot
      confirms a Foot strike pattern card renders with its caveat text visible
