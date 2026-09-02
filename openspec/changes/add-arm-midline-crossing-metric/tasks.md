## 1. OpenSpec skeleton with pre-registered decisions

- [x] 1.1 `openspec/changes/add-arm-midline-crossing-metric/`: `proposal.md`, `design.md` (D1–D8
      registered BEFORE the probe runs; D4 measurements and D8 adjudication explicitly pending),
      `tasks.md`, spec deltas (`form-heuristics` ADDED ×3, `results-view` MODIFIED ×1: thirteen →
      fourteen).
- [x] 1.2 `openspec validate add-arm-midline-crossing-metric --strict` passes. Commit the
      skeleton BEFORE the probe runs, so pre-registration is verifiable. (Step-0 baseline —
      `wave3/baseline.txt` + the anchor driver — captured at worktree HEAD before any edit.)

## 2. The measurement probe (add–measure–revert)

- [ ] 2.1 Temporary `src/heuristics/armMidlineCrossing.experimental.ts` computing D3's report
      (per-side + pooled signed series per D1, percentile ladder, per-side counts/interpolated
      fractions, strict-pair frame count, fraction past midline, `shoulderWidthPx` AND
      `torsoLengthPx`, top-⌈0.05n⌉ tail timestamps + interpolated flags); one dev-only
      `console.log('[arm-crossing-probe]', ...)` in `useVideoAnalysis.ts` after the
      `[analysis-diagnostics]` line; throwaway scratchpad Playwright driver, fresh process per
      trial, real GPU. TWO fresh trials Demo 2 (expect bit-identical), one each Demo 1 /
      multiperson.
- [ ] 2.2 Adjudicate D3's five pre-registered rules; record measurements + verdicts in design.md
      D4, pinning the rung and the D8 live anchor. Any STOP rule fires → stop and report, do not
      implement.
- [ ] 2.3 Revert the instrumentation (`git checkout -- src/results/useVideoAnalysis.ts && rm
      src/heuristics/armMidlineCrossing.experimental.ts`); commit the design.md record. If the
      rung moved to p90, retitle the spec requirement accordingly and re-validate.

## 3. Implementation

- [ ] 3.1 `bodyScale.ts`: `ShoulderWidth`/`estimateShoulderWidth` mirroring `estimateHipWidth`
      verbatim (D2) + `bodyScale.test.ts` cases.
- [ ] 3.2 New `src/heuristics/armMidlineCrossing.ts` — `computeArmMidlineCrossing(frames, view,
      config)` on stepWidth.ts/kneeDrive.ts's skeleton: D1's per-frame signal (strict shoulder
      pair, `WRIST_NAME`/`SHOULDER_NAME`/`ELBOW_NAME` imported from `armSwing.ts`, per-frame
      own-side `outwardSign`), pooled percentile at the pinned rung, `unit: 'percent'`. Null
      paths and caveats in D7's order; confidence per D7; module constants
      `ARM_CROSSING_PERCENTILE` + `MIN_ARM_CROSSING_SAMPLE_SIZE = 61` with the D1 derivation
      docstring; no new config keys.
- [ ] 3.3 Exemplar per D5: one single-instant `'armCrossingInstant'` (representative,
      value-nearest-statistic, tie → earlier), sign-branched label; new builder in
      `evidenceAnnotations.ts` (strict shoulder-mid guide, shoulder-width segment with the
      clip-median comment, elbow-chained arm, horizontal caliper with builder-local polarity);
      registered in `INSTANT_MARK_BUILDERS`; ADDED to `SINGLE_INSTANT_KINDS`; `measuredAtInstant`
      unbranched; seed `['left_shoulder', 'right_shoulder', WRIST_NAME[side]]`, context
      `[ELBOW_NAME[side]]`, `annotationKeypoints` omitted.
- [ ] 3.4 `src/heuristics/armMidlineCrossing.test.ts`: exact clean value (constructed series,
      known pooled p95); sign convention on both screen orientations (mirrored-clip case);
      strict-pair discard incl. the tolerant-fallback would-fail-if proof (stepWidth.test.ts
      model); zero-net-displacement front fixture still emits (direction independence);
      one-arm-only → null; no-shoulder-pair → null; degenerate width; side view
      computed-not-withheld; empty frames; shortfall discount + caveat; side-imbalance caveat;
      positive-value interpretive caveat; exemplar kind/side/label/crop; never-NaN. Fixtures via
      `__fixtures__/testFrames.ts` `buildFrame` per armSwingSymmetry.test.ts style.

## 4. Fan-out + count sweep (thirteen → fourteen)

- [ ] 4.1 `types.ts`: `MetricId` += `'armMidlineCrossing'` appended last (after
      `'armSwingAmplitude'`); new `MetricExemplarKind` member with doc;
      `FormHeuristicsResult.armMidlineCrossing` appended last; `viewFitTable.armMidlineCrossing`
      row appended COPYING `stepWidth`'s row exactly, comment saying so; `MetricResult.unit` doc
      widened ("Two metrics use it" → three, naming shoulder width).
- [ ] 4.2 `index.ts`: wire `armMidlineCrossing` appended last; doc counts thirteen → fourteen +
      append-order doc sentence.
- [ ] 4.3 `npx tsc -b`; fix every surfaced site: `fuseHeuristics.ts` both lists;
      `metricConfidence.ts` `METRIC_LABELS` += `'Arm midline crossing'`; `MetricsPanel.tsx`
      `METRIC_DESCRIPTIONS` (movement-observation copy, distinct-from-armSwingAmplitude
      sentence) + metrics array + doc count; `MetricsPanel.test.tsx` title + counts 13 → 14;
      `index.test.ts` 'gates all fourteen' + per-metric expectations; the same fixture-builder
      test set wave 2 touched.
- [ ] 4.4 Count sweep via `grep -rn "thirteen" src/ CLAUDE.md AGENTS.md` — TRUE sites:
      `index.ts:21/23/41`, `viewPlausibility.ts:127-128`, `exemplars.ts:468`,
      `index.test.ts:241`, `extractFrames.ts:66`, `analysisDiagnostics.ts:61`,
      `evidenceFrames.ts:1502-1503`, `useSessionEvidence.ts:193`, `MetricsPanel.tsx:351`,
      `MetricsPanel.test.tsx:251`, `CLAUDE.md:621`. FALSE positives, LEAVE (verify context):
      `evidenceFrames.ts:248/:266` ("thirteen readings"/"thirteen measured pairs" —
      image-measurement provenance counts). AGENTS.md is count-free (verified). Do NOT hand-edit
      `openspec/specs/`.

## 5. Live verification

- [ ] 5.1 `npm test`, `npx tsc -b`, `npm run lint` — all clean.
- [ ] 5.2 Rerun the Step-0 command → `wave3/afterB.txt`; adjudicate D8's six pre-registered rules
      against `wave3/baseline.txt` and record in design.md D8.
- [ ] 5.3 Anchor driver re-check: `verticalOscillationCm 4.421467928439415`,
      `fit.frequencyHz × 60 = 91.2 == cadence`.

## 6. Ship + archive (NOT this pass — after code review)

- [ ] 6.1 `openspec archive add-arm-midline-crossing-metric --yes` after ship + verify; close the
      bead per the epic's flow.
