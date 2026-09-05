# Tasks

## 1. Migrate the shared-module coverage BEFORE deleting anything

- [x] 1.1 Create `src/heuristics/armSwing.test.ts` with the 12 migrated cases, rewritten to call
      `computeSideSwing` / `buildSideExemplar` / `caveatForFailure` directly rather than through a
      metric
- [x] 1.2 Replace the `rawPixelRatio` helper with a per-side `rawPixelAmplitude`, so the two
      bit-exact no-op assertions (`MIN_SCALE_TREND_SAMPLES`, `FLAT_TREND_LOG_RANGE`) keep `toBe`
      rather than degrading to `toBeCloseTo`
- [x] 1.3 Run both suites side by side and confirm they pass together — the one moment the migrated
      assertion and the original are provably testing the same thing

## 2. Port the two cases whose coverage the deletion would otherwise open a hole in

- [x] 2.1 Port the ambiguous-view case into `armSwingAmplitude.test.ts` (its view requirement states
      the `0.2` row and had no scenario for it)
- [x] 2.2 Port the noise-arm fixture route (a real unfittable arm reaching the shared gate, where
      the existing case tightens the config instead)

## 3. Re-point every comment reference

- [x] 3.1 `armSwing.ts` — comments only, no behaviour; including the dangling
      `armSwingSymmetry.test.ts` pointer at the image-y sign trap
- [x] 3.2 `types.ts`, `verticalRatio.ts`, `stepWidthCm.ts`, `viewPlausibility.ts`, `extrema.test.ts`
- [x] 3.3 Evidence modules — `evidenceAnnotations.ts`, `evidenceCaptions.ts`, `evidenceFrames.ts`,
      `MetricsPanel.tsx`, `scripts/ab-person-selection.mjs`
- [x] 3.4 `armSwingAmplitude.ts` / `.test.ts` — including the "min is recoverable from the published
      symmetry ratio" claim, which the withdrawal makes false

## 4. Re-point the two test files that cover surviving code

- [x] 4.1 `viewPlausibility.test.ts` — the only witness to `resolveViewFitTable`'s front-primary path
- [x] 4.2 `index.test.ts` — the `propagate-view-confidence-to-metric-gating` regressions

## 5. Delete

- [x] 5.1 Delete `src/heuristics/armSwingSymmetry.test.ts`
- [x] 5.2 Remove `'armSwingSymmetry'` from `MetricId` and let the compiler enumerate the rest
- [x] 5.3 Fix every compile error, then delete `src/heuristics/armSwingSymmetry.ts`
- [x] 5.4 Sweep by grep for references the compiler cannot see (a fixture behind
      `as unknown as FormHeuristicsResult` hid one)

## 6. Verify

- [x] 6.1 `npx tsc -b` — one pre-existing error only (`vite.config.ts`, `strides-3rp`)
- [x] 6.2 `npm run lint` clean
- [x] 6.3 Full unit suite green
- [x] 6.4 Live A/B (`scripts/ab-person-selection.mjs --evidence`, 3 clips, 3 trials): confirm
      `armSwingSymmetry.*` rows are the ONLY disappearing fields
- [x] 6.5 Confirm `armSwingAmplitude` still renders two per-side images on `front-approach`

## 7. Bookkeeping

- [x] 7.1 Re-point `strides-9c9` and `strides-56e` rather than closing them
- [x] 7.2 File the follow-ups this change deliberately did not do

## 8. Review round 1 — spec deltas only (code approved as-is)

- [x] 8.1 🔴 Re-home the scale-stabilization contract (R1 ¶3 + its scale-change scenario), which
      the first pass deleted and re-homed nowhere: ADDED *The per-side arm-swing series is
      scale-stabilized before it is fitted*, plus an exact-no-op scenario for the two rungs the
      migrated tests pin bit-exactly
- [x] 8.2 🔴 Verify the claim that the amplitude requirement already states the fitted-phase rule.
      **It does not** — confirmed by reading all three `armSwingAmplitude` requirements and by
      `grep armSwingCycle openspec/specs/` returning zero. Fold BOTH paragraphs of the removed
      exemplar requirement, and both its scenarios, into the metric-neutral ADDED requirement
- [x] 8.3 🔴 Correct the two false Reason/Migration texts and `design.md` D5
- [x] 8.4 🟡 MODIFIED for `results-view`'s "thirteen `MetricId`s" normative SHALL; sweep 12 stale
      `thirteen` counts from `src/`, leaving the grafted-exemplar measurement records alone
- [x] 8.5 🟡 CLAUDE.md retirement pointer — measurements left exactly as taken
- [x] 8.6 🟢 Drop "the shared kind" from an exemplar test title
