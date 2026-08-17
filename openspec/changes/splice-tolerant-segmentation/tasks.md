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
- [ ] 5.3 3-trial A/B on all three clips via `scripts/ab-person-selection.mjs`, against the
  pre-registered criteria in design.md, results recorded there as a table. **Deferred — the single
  live-browser verification lane is held elsewhere.**
- [ ] 5.4 Archive once the A/B has run and passed.
