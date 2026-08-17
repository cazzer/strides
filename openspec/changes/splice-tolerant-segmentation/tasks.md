# Tasks

## 1. The bridge rule

- [x] 1.1 Add `bridgedCuts: number` to `PersonSelectionDiagnostics`, documented as counting bridge
  EVENTS rather than boundaries, and as the field that distinguishes a healed clip from a clip that
  never needed healing.
- [x] 1.2 Emit `bridgedCuts: 0` on every skip path (`skipped()`'s literal). Non-optional, uniform
  with every other field.
- [x] 1.3 Add two local helpers inside `selectRetroactivePersonOfInterest`, after the surviving/area
  arrays are populated: `isContinuousPair(referenceIndex, candidateIndex)` and
  `nextSurvivingIndex(after)`. `isContinuousPair` must be the SINGLE path both the adjacent check
  and the bridge check take, so the `maxContinuityGapSeconds` term cannot be omitted on the bridge
  pair. Comment the chronological parameter order and the relation's asymmetry.
- [x] 1.4 Rewrite the cut loop to consult `isContinuousPair`, and on failure attempt one bridge
  against `nextSurvivingIndex(i)` before cutting. On a successful bridge, increment `bridgedCuts`
  and `continue` **without advancing `previousIndex`** — with a comment saying why.
- [x] 1.5 Emit `bridgedCuts` in the returned diagnostics object.
- [x] 1.6 Do NOT touch `src/pose/backends/movenetCrop.ts`. The bridge is a second call to the
  existing pure `isBoundingBoxContinuous` on a different pair; the online anchor gate is unaffected.

## 2. Documentation corrections in the same file

- [x] 2.1 `DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG`'s `maxAreaRatio` note: the position half of
  the Demo 1 wedge is handled by the bridge rule, not by any value of this bound. Must not
  reintroduce the "ships off" claim.
- [x] 2.2 The `enabled: true` override record: **append** to it, do not erase it. Record that
  follow-up 1 has landed, what it heals, and that the pre-registered rule's Demo 1 condition also
  depends on #57.
- [x] 2.3 Step 3 of the function doc's method list: add the bridge clause and the one-detection
  bound.

## 3. Fixtures outside this module

- [x] 3.1 `src/results/analysisDiagnostics.test.ts` — add `bridgedCuts: 0` to `makePersonSelection`'s
  literal body (the helper has an explicit `PersonSelectionDiagnostics` return type, so a missing
  property is a type error). The `Partial`-override call site needs no edit.
- [x] 3.2 `src/results/runClipAnalysisPipeline.test.ts` — add `bridgedCuts: 0` to the whole-object
  `toEqual` on the disabled-stage personSelection block, which fails on an extra defined property.
- [x] 3.3 `src/results/analysisDiagnostics.ts` — confirm no edit is needed (type-level and
  by-reference pass-through) and that no other construction of `PersonSelectionDiagnostics` exists
  in `src/` or `e2e/`.
- [x] 3.4 `scripts/ab-person-selection.mjs` — add `personSelection.bridgedCuts` to the captured
  field list. The driver enumerates fields explicitly rather than spreading the block, so without
  this the A/B cannot read criterion D1-1, Demo 2's no-op proof, or do-not-ship conditions 3 and 4.

## 4. Tests

- [x] 4.1 New `describe('splice tolerance')` block with four cases: (A) the wedge shape — does NOT
  cut when the neighbours are continuous with each other; (B) still cuts when the discontinuity
  survives removing the offending frame; (C) two consecutive discontinuous detections still cut;
  (D) does not bridge across a time gap even when the geometry would allow it.
- [x] 4.2 Deliberate re-assertions, adding `bridgedCuts` expectations without changing any existing
  assertion: `:597` (the 12-segment landmine), `:184` (the #51 trace), the single-smooth-track case,
  and the disabled case.
- [x] 4.3 Confirm every pre-existing test in `retroactivePersonSelection.test.ts` passes with no
  assertion edited. Verified by running the file's pre-change revision verbatim
  (`git show HEAD:…` into a scratch spec) against the new implementation: 32 test cases, 32 passed,
  0 failed. The 32 are 28 `it`/`it.each` declarations, one of which is a five-case `it.each`; the
  ticket's "25" was an undercount of the same suite.

## 5. Verification

- [x] 5.1 `openspec validate splice-tolerant-segmentation --strict`
- [x] 5.2 `npm test`, `npm run build`, `npm run lint` — all green.
- [x] 5.3 3-trial A/B on all three clips via `scripts/ab-person-selection.mjs`, against the
  pre-registered criteria in design.md, results recorded there as tables. **Run twice.** Round 1
  (bridge rule alone) failed every substantive Demo 1 criterion — do-not-ship 3 fired, the cause
  was re-traced with a temporary probe (since reverted) and no threshold was tuned. Round 2 (with
  D4's widened bound) passes 11 of 12 gates; D1-3 fails by one frame and is recorded as a failure.
  Both tables are kept in design.md — round 1 is the evidence for D4.

## 6. Widened centre-speed bound (D4)

- [x] 6.1 Merge `main` (picks up #53 and #58); resolve the `maxAreaRatio` doc-comment conflict so
  #58's corrected "ships on" wording survives.
- [x] 6.2 `maxCenterSpeedSidesPerSecond: 3` → `4` in `DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG`
  only. `personOfInterestConfig.ts` keeps 3 — the online gate is untouched.
- [x] 6.3 Record it as **D4** in design.md: the measured 7.6% shortfall and IoU-0 finding, D7's
  asymmetric-false-reject argument never having been applied to this bound, why 4 and not 3.3, and
  that it loosens the adjacent check too. Mirror the `maxAreaRatio: 4` doc comment's style.
- [x] 6.4 Spec delta: **no numeric bound appears in any spec** (verified by grep over
  `openspec/specs/`), so no delta was required for the value. The already-MODIFIED
  `person-selection` requirement gains one paragraph separating the predicate's shared SHAPE from
  its independently-resolved BOUNDS, since its body called continuity "the SAME predicate the
  online anchor gate uses".
- [x] 6.5 Re-correct the doc comments round 1 had corrected the other way — the wedge is now
  measured as healed, and the round-1 trace is kept as D4's evidence base.
- [x] 6.6 Pin the bound in the unit suite. Before this, 3 → 4 was a no-op for all 795 tests
  (every discontinuity in the file fails on scale or time), so the bound's only evidence was a
  live A/B CI cannot run. Fixture scaled from the real measurement, with IoU, area ratio and
  elapsed all held far from their bounds so the speed term is provably what decides; asserts the
  shipped default plus the counterfactual at 3. Verified to fail when the default is reverted.
- [x] 6.7 Record the D1-3 adjudication in design.md **underneath** the fired gate, leaving both the
  FAIL and the pre-registered criterion unedited.

## 7. Still open

- [ ] 7.1 **Do not archive.** Demo 1 reaches `segmentCount` 3–4, not 1 — the remaining three
  segments are phantom detections that #57's re-derived area floor demotes. Closing #52's headline
  criterion is still the joint #54 + #57 outcome recorded in the gate amendment.
- [x] 7.2 D1-3's one-frame miss — **adjudicated 2026-08-16: accepted as a fired gate.** The
  criterion imported a session-variable constant (the tail length) as an absolute; the property it
  proxied for is independently established by the relative moves (+6 frames, winner start
  4.36 → 0.08, `detectedFrames` +6). Neither the criterion nor the FAIL row was edited.
