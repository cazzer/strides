## 1. OpenSpec change

- [x] 1.1 `openspec new change exclude-only-unmeasurable-metrics`; write `proposal.md`,
      `design.md` (D1–D4, incl. the explicit #37-D1 reversal record and the ambiguous-view
      decision), `tasks.md`, one spec delta (`results-view`: REMOVED "Metrics panel readouts
      with confidence/applicability indicators" + ADDED "Metrics panel readouts with
      measurability and confidence tiers" — a MODIFIED block was the intended shape, but the
      confidence-exclusion scenario fully reverses and openspec rejects a MODIFIED block that
      drops a scenario, so the repo's REMOVE+re-ADD convention for full reversals applies; the
      "never excluded for low confidence alone" scenario replaces the dropped one).
- [x] 1.2 `openspec validate exclude-only-unmeasurable-metrics --strict` passes. Do NOT archive.

## 2. `metricConfidence.ts` — tier rule reversal

- [x] 2.1 `metricTier` body: `'excluded'` iff `value === null || viewFit === 'unsuitable'`;
      otherwise `'normal'` at `confidence >= HIGH_CONFIDENCE_THRESHOLD`, else `'caveated'`. No
      type changes; both threshold constants stay exported.
- [x] 2.2 Rewrite the threshold doc comment: HIGH feeds layout + copy; LOW feeds ONLY the
      Medium/Low indicator label, never layout — a measured value is never withheld for low
      confidence.
- [x] 2.3 Rewrite the `metricTier` doc comment: new tier definitions; replace the "deliberately
      does NOT read viewFit" paragraph with the inverse (explicit `viewFit === 'unsuitable'`
      check, exclusion = structurally unmeasurable, no longer coupled to
      `DEFAULT_VIEW_FIT_TABLE` multiplier values); reference issue #38 for the confidence-math
      follow-up.
- [x] 2.4 `metricConfidence.test.ts`: flip conf-0.39 non-null → `'caveated'` (retitle); flip
      conf-0 non-null → `'caveated'` (retitle; the RCA case); rewrite the
      unsuitable-via-confidence-arithmetic test as an explicit viewFit-clause exclusion. Keep
      the 0.7-boundary and null-value tests. New: non-null primary conf 0.02 and 0.21 →
      `'caveated'`; non-null `'tolerated'` conf 0.1 → `'caveated'`; armSwingSymmetry value 0.5
      conf 0.06 viewFit `'unsuitable'` → `'excluded'`; pathological viewFit `'unsuitable'` conf
      0.95 non-null → `'excluded'`.

## 3. `MetricsPanel.tsx` — copy + comments only

- [x] 3.1 `ExcludedEntry` fallback copy → "Not measurable for this clip." (confidence-neutral);
      update its doc comment.
- [x] 3.2 Tier-count summary line: no logic change; one-line comment noting the caveated tier now
      spans all sub-0.7 confidence.
- [x] 3.3 Update `MetricsPanel` + `MetricCard` doc comments for the new tier definitions;
      `confidenceLabel` code unchanged, comment notes its "Low confidence" branch is now live on
      cards.
- [x] 3.4 `MetricsPanel.test.tsx`: invert "excludes a low-confidence but non-null
      verticalOscillationCm value..." (conf 0.37 value 12.4 primary → caveated card "12.4 cm" +
      "Low confidence", retitle); rebuild "falls back to a generic reason..." fixture as a
      type-legal excluded shape, assert the new fallback copy. New: track-demo RCA shape
      (VO/verticalRatio/cadence conf 0.02–0.21 non-null primary → cards with values, excluded
      section contains none of them); armSwing unsuitable with real caveat → in excluded
      section, numeric value nowhere in document; summary line counts a low-conf card under
      "with caveats". Grep: no `too low to report` stragglers.
- [x] 3.5 `ResultsView.test.tsx`: verify no flips needed (its excluded fixture is null-valued).

## 4. Gates

- [x] 4.1 `npx tsc -b` — no errors.
- [x] 4.2 `npx vitest run` — full suite green.
- [x] 4.3 `npx eslint .` — no issues.

## 5. Live verification

- [x] 5.1 Playwright, real GPU, MoveNet, track demo clip, n≥5 trials: Vertical oscillation /
      Vertical ratio / Cadence render as cards with values on EVERY trial (bad-fit trials show
      "Low confidence" — that's success); the "Not measured for this clip" section contains
      exactly `Vertical oscillation (cm)` and `Arm swing symmetry`, never any other metric; the
      summary line accounts for all 7 measured metrics on every trial (its "measured" +
      "with caveats" counts sum to 7 — the summary's "measured" word covers tier 1 only, so a
      bad-fit trial reads e.g. "4 metrics measured · 3 with caveats · 2 not measured", never
      fewer than 7 in the grid).
