# Tasks

## 1. The evidenced-interior rule

- [x] 1.1 Add `rejectedOutsideEvidence: number` to `PersonSelectionDiagnostics`, documented as
  counting exactly the detections nulled inside the winner's partition but outside its evidenced
  interior — kept separate from `rejectedOtherSegment`, which keeps meaning "lost its segment".
- [x] 1.2 Emit `rejectedOutsideEvidence: 0` on every skip path (`skipped()`'s literal).
  Non-optional, uniform with every other field.
- [x] 1.3 In the scoring pass, record each segment's `evidenceFrom`/`evidenceTo` — the first and
  last index at which it pushed an area — in the same loop that collects the areas. No second scan.
- [x] 1.4 Rewrite the final map's test from `inWinner && !belowFloor[i]` to
  `inEvidence && !belowFloor[i]`, with the losing-segment check taken first so bucket attribution
  is unchanged for every frame that was already being nulled.
- [x] 1.5 Subtract the new bucket in `detectedSamplesOut` and emit the counter in the returned
  diagnostics.
- [x] 1.6 Do NOT touch `src/pose/backends/movenetCrop.ts`, the splice-tolerance rule, or any
  continuity bound. This change only decides what to do with a frame `deriveBoundingBox` already
  declined to box.

## 2. Documentation in the same file

- [x] 2.1 `PersonSelectionSegmentDiagnostics.startTimestamp`/`endTimestamp`: say explicitly that
  the reported span is the PARTITION span and that survival is governed by a different, narrower
  window, because the two can now differ (D5).
- [x] 2.2 `medianAreaPx`'s "impossible today: every segment starts at one" note — confirm it still
  holds after #54 and record that the evidenced interior depends on it (D6).
- [x] 2.3 Step 5 of the function doc's method list: "null every frame outside the winner" becomes
  the two-part rule, with the partition/evidence distinction stated.
- [x] 2.4 The `enabled: true` override record: append that epic #52's item 2 has landed. Do not
  erase what was accepted in the interim.

## 3. Fixtures outside this module

- [x] 3.1 `src/results/analysisDiagnostics.test.ts` — add `rejectedOutsideEvidence: 0` to
  `makePersonSelection`'s literal body (explicit return type, so a missing property is a type
  error).
- [x] 3.2 `src/results/runClipAnalysisPipeline.test.ts` — add `rejectedOutsideEvidence: 0` to the
  whole-object `toEqual` on the disabled-stage `personSelection` block.
- [x] 3.3 Confirm `src/results/analysisDiagnostics.ts` needs no edit (type-level, by-reference
  pass-through) and that no other construction of `PersonSelectionDiagnostics` exists in `src/` or
  `e2e/`.
- [x] 3.4 Confirm `scripts/ab-person-selection.mjs` needs no edit — since #53 it flattens
  `personSelection` from whatever keys are present rather than an enumerated list.

## 4. Tests

- [x] 4.1 The documented inversion: the same intruding detection outside the winner's evidenced
  interior, once with enough confident keypoints to yield a below-floor box and once with too few
  to yield any box — **both** nulled now, where the second was previously kept.
- [x] 4.2 A boxless frame **inside** the winner's evidenced interior still rides with its segment,
  by reference, contributing no area and counting no rejection (the existing case, preserved).
- [x] 4.3 A boxless frame inside the winner's partition but beyond its last surviving detection is
  nulled and counted in `rejectedOutsideEvidence`, not `rejectedOtherSegment`.
- [x] 4.4 The leading case: a boxless frame before the winner's first surviving detection, inside
  segment 0's back-extended partition span, is nulled.
- [x] 4.5 A winner with exactly one surviving detection has a single-index interior — boxless
  neighbours on both sides are nulled.
- [x] 4.6 A boxless frame in a LOSING segment is still counted in `rejectedOtherSegment` and not in
  the new bucket (bucket attribution unchanged).
- [x] 4.7 The arithmetic identity holds:
  `detectedSamplesOut == detectedSamplesIn - rejectedBelowFloor - rejectedOtherSegment -
  rejectedOutsideEvidence`.
- [x] 4.8 Confirm which pre-existing assertions in `retroactivePersonSelection.test.ts` change and
  why — the only legitimate change is a scenario whose boxless frame sits outside the evidenced
  interior. **Answer: none.** All 38 pre-existing cases passed unedited against the new
  implementation before a single new test was added; the file's two boxless fixtures both sit
  between surviving detections. The one pre-existing case rewritten
  (`detectedSamplesOut equals detectedSamplesIn minus …`) was extended to the third bucket by
  choice, not by failure — it passed as written, because its fixture has no boxless frames at all
  and so never exercised the new term.
- [x] 4.9 Counterfactual: the new cases must FAIL against the pre-change implementation, or they
  pin nothing. Verified by restoring `f665303`'s blob with a zero-valued shim for the new field (so
  the file still type-checks and behaviour, not compilation, is what is measured): 4 of the new
  assertions fail, 40 pass.

## 5. Verification

- [x] 5.1 `openspec validate restrict-boxless-survival --strict`
- [x] 5.2 `npm test`, `npm run build`, `npm run lint` — all green.
- [ ] 5.3 3-trial A/B on all three clips via `scripts/ab-person-selection.mjs --port 5199`, against
  the criteria pre-registered in design.md, results recorded there as tables. Numbers reported as
  measured.

## 6. Still open

- [ ] 6.1 **Do not archive.** Report first. Archive ordering matters: this change's
  `analysis-diagnostics` MODIFIED text is a superset of `splice-tolerant-segmentation`'s, so this
  one must archive **last**.
