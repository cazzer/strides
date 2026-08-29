# Tasks

## 1. The plausibility itself

- [x] 1.1 Add `ViewPlausibility` (`{ side, front, ambiguous }`, summing to 1) and a named
  `ViewFitEntry` to `types.ts`, documenting the plausibility as a normalized weighting rather than
  a calibrated probability — the same disclaimer `computeMetricConfidence` carries.
- [x] 1.2 New `viewPlausibility.ts` with `computeViewPlausibility(bsr, ser, config)`: one
  `signalSupport` ramp per signal, spanning the two views' own thresholds for that signal, with a
  degenerate-config fallback to a step instead of a divide-by-zero.
- [x] 1.3 Combine by PRODUCT per view, `ambiguous` taking the remainder — the continuous form of
  the existing two-vote agreement rule. No new constant anywhere in the module.
- [x] 1.4 Return `AMBIGUOUS_VIEW_PLAUSIBILITY` when either signal is null: one signal cannot carry
  a view on its own.
- [x] 1.5 `detectView` returns `plausibility` alongside its untouched `view`/`confidence`, and
  returns the all-ambiguous constant on the below-coverage-floor early return.

## 2. Resolving the gate

- [x] 2.1 `mostPlausibleView(plausibility)` — argmax with `'ambiguous'` taking ties.
- [x] 2.2 `resolveViewFitTable(table, plausibility)` — multiplier as the plausibility-weighted
  mean of the three rows, `fit` from the most plausible view's row, written under all three view
  keys so the label cannot disagree with the resolution.
- [x] 2.3 Return the input table BY REFERENCE for a one-hot plausibility (blending against it is
  the identity), so a committed-view clip is provably untouched.
- [x] 2.4 `computeFormHeuristics` resolves once and passes the resolved table plus the most
  plausible view to all eleven metrics — and passes the CALLER'S OWN config object through when
  the table came back unresolved, mirroring `fuseFormHeuristicsResults`'s single-clip reference
  identity as a regression proof.
- [x] 2.5 No metric module touched. Confirmed: the only `src/` files changed are
  `viewPlausibility.ts` (new), `viewDetection.ts`, `index.ts` and `types.ts`.

## 3. Tests

- [x] 3.1 `viewPlausibility.test.ts`: the two committed corners, the disagreement corner, the
  missing-signal case, and Demo 2's own measured signals (0.5507 / 0.3389) resolving to a pure
  front — the case the naive `view.confidence` multiplier would have gotten wrong.
- [x] 3.2 Continuity across the front bar: BSR 0.5499 vs 0.5507 move the gate by <1%, where the
  label flips outright.
- [x] 3.3 Properties: three non-negative components summing to 1 across a BSR x SER grid; one
  signal alone never carries a view at any strength of the other; a crossed-threshold config does
  not divide by zero.
- [x] 3.4 `resolveViewFitTable`: reference identity on one-hot; a front-primary metric kept
  measurable when only side is ruled out (0.84 multiplier); a sagittal metric still excluded; both
  directions degraded symmetrically on a genuinely ambiguous clip; every resolved fit is one of the
  metric's own rows and every multiplier within its own rows' range; caller's table not mutated.
- [x] 3.5 `viewDetection.test.ts`: one-hot on every committed label, all-ambiguous on
  disagreement, all-ambiguous below the coverage floor and on empty input.
- [x] 3.6 `index.test.ts`, the three cases the ticket asks for: a decisively-committed view
  deep-equalling direct metric calls with the untouched default config; a marginally-committed
  front view (BSR 0.56) keeping `armSwingSymmetry`/`stepWidth` at `primary` while the sagittal
  metrics stay excluded; a clip in the undecided band reporting `stepWidth` at a confidence
  strictly between its ambiguous-row and front-row values; and a genuinely ambiguous clip
  degrading both directions.
- [x] 3.7 Ten existing `ViewDetectionResult` fixtures across `src/results/` gain a `plausibility`
  field matching their label. No existing assertion changed.

## 4. Verification

- [x] 4.1 `npx tsc -b` clean.
- [x] 4.2 `npx eslint` clean on every touched file.
- [x] 4.3 `npx vitest run` — 1238 passed, 0 failed (1211 before, +27 new).
- [x] 4.4 `openspec validate propagate-view-confidence-to-metric-gating --strict` passes.
- [ ] 4.5 Live-browser verification on all three reference clips, run by the maintainer serially.
  Expected: `view.plausibility` present on the `[analysis-diagnostics]` line, one-hot on all three
  ({side:1} / {front:1} / {side:1}), and every metric value, confidence, `viewFit` and evidence
  coverage total unchanged from the recorded baseline. Any movement on those three clips is a bug
  in this change, not a result — see design.md D7.

## 5. Follow-up filed

- [x] 5.1 `strides-2iw` — `view.confidence` is not comparable between a side and a front label
  (the BSR margin saturates at ~2x the anatomical maximum of the signal). Verified with
  anthropometry and Demo 2's own measurement; deliberately not fixed here. See design.md D8.
