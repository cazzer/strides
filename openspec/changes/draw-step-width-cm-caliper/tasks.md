# Tasks

## 1. Confirm the diagnosis independently

- [x] 1.1 Trace `measuredSide` → `resolveInstantSide` (`evidenceFrames.ts`) → `buildStepWidthMarks`
  (`evidenceAnnotations.ts`) and confirm the `if (side === null) return` lands **before**
  `builder.caliper`.
- [x] 1.2 Prove the two `buildExemplars` bodies are identical apart from the defect: strip comments,
  diff. Result — 62 code lines vs 60, diff is exactly `measuredSide` and `pairedMeasuredSide`.
- [x] 1.3 Reproduce end to end through the real planning + annotation path on a synthetic front-view
  fixture: `stepWidth` yields 2 `ankleOffsetCaliper` ops, `stepWidthCm` yields 0, both yield
  `hipWidthSegment` + `hipMidlinePlumb`.

## 2. Fix, by removing the duplication rather than patching one copy

- [x] 2.1 Add `src/heuristics/stepWidthExemplars.ts` holding `STEP_WIDTH_ANKLE_NAME`,
  `StepWidthStrikeSample` and `buildStepWidthExemplars` — the body transplanted from `stepWidth.ts`,
  the correct copy.
- [x] 2.2 Verify the transplant is byte-identical to the original modulo the renames, mechanically
  rather than by inspection.
- [x] 2.3 Rewire `stepWidth.ts` and `stepWidthCm.ts` to call it; drop both private copies and the
  now-unused imports. `HIP_NAME` stays in `stepWidthCm.ts` — it is used by that metric's own body.
- [x] 2.4 Leave `evidenceAnnotations.ts` and `evidenceFrames.ts` untouched: both are correct, and the
  fix belongs where the side is stated.

## 3. Test

- [x] 3.1 Add a regression test in `stepWidthCm.test.ts` asserting the metric-layer contract
  (`measuredSide`/`pairedMeasuredSide` present, opposite, no pair-level `side`) **and** its
  consequence — one `ankleOffsetCaliper` on each of `base` and `ghost`, planned and annotated
  through `planMetricEvidence` + `planEvidenceAnnotations`.
- [x] 3.2 Give the fixture a 1 px/frame drift so the pair is not demoted by `isNearIdenticalPair`,
  and both halves are genuinely exercised.
- [x] 3.3 Mutation-check: revert the fix, confirm the test fails. It does — and so does
  `stepWidth.test.ts`'s existing assertion, which is the dedup working.
- [x] 3.4 Mutation-check the caliper assertion in isolation, so it is not carried by the
  metric-layer assertions in front of it. With those suppressed it still fails:
  `expected [] to deeply equal [ 'base', 'ghost' ]`.
- [x] 3.5 Restore, confirm green.

## 4. Verify

- [x] 4.1 `npx tsc -b`, `npx eslint src/`, full `npm test` — clean, clean, 1343 passing.
- [x] 4.2 Live browser, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), fresh Chromium per trial,
  derived port with identity verified, 2 trials across Demo 1 / Demo 2 / multiperson.
- [x] 4.3 Coverage: Demo 1 **8 images / 7 sections**, Demo 2 **5 / 4**, multiperson **8 / 7**.
- [x] 4.4 multiperson's 8/7 differs from the 7/6 this change was briefed against, so re-measure the
  **same clip on clean `main`** to attribute it. Baseline is also 8/7, metric for metric — the
  brief's figure predates today's footstrike-phase change. Not a regression.
- [x] 4.5 Anchor: Demo 1 `cadence.value` 91.2. `verticalOscillationCm` is `null` on the primary
  diagnostics line by design (grafted after `ready`) and is `planned` in evidence on all three clips.
- [x] 4.6 Confirm the change is a live no-op: `stepWidthCm` is `metric-excluded` on all three clips
  both before and after, so no rendered image moves.
