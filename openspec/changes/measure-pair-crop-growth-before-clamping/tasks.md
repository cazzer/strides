# Tasks

## 1. Make the measure see separation

- [x] 1.1 Add `evidenceCropSideDemand(box)` to `src/results/evidenceFrames.ts` — padding and the
      degenerate-box floor, no frame cap — documented as the deliberate divergence from
      `computeCropRect` that it is.
- [x] 1.2 Rewrite `evidencePairCropGrowth` to read demands on both sides. `computeCropRect` itself,
      and the crop that is actually drawn, are untouched.
- [x] 1.3 Confirm `EVIDENCE_MAX_PAIR_CROP_GROWTH`, `EVIDENCE_CROP_MIN_SIDE_PX`,
      `EVIDENCE_CROP_PADDING_MULTIPLIER` and `MIN_EXEMPLAR_QUALITY` are byte-identical.

## 2. Correct the documentation the bug hid behind

- [x] 2.1 Replace `EVIDENCE_MAX_PAIR_CROP_GROWTH`'s "self-cancelling under both of
      `computeCropRect`'s clamps" claim with the floor/cap asymmetry that actually holds, quoting
      the old sentence so its removal is legible.
- [x] 2.2 State why a demand ratio is not the "did the crop hit the cap" test the same doc
      correctly rejects, including the `D ≥ 500` bound that makes a small source safe.
- [x] 2.3 Annotate the calibration bracket with what moves under the new formula and what does not.
- [x] 2.4 Restate `evidencePairCropGrowth`'s `max`-not-`min` argument against the threshold, since
      the value it used to be argued against has moved.

## 3. Give the bracket an instrument

- [x] 3.1 Add `cropGrowth: number | null` to `EvidenceFramePlan`, set in `planExemplarFrames` from
      the two boxes actually drawn; `null` wherever no ghost is drawn.
- [x] 3.2 Carry it onto `EvidenceCoverageExemplar` and `summarizeEvidenceCoverage`, beside
      `cropSidePx`. DEV-gated and JSON-parseable as before; nothing image-shaped added.
- [x] 3.3 Update the five `EvidenceFramePlan` fixture literals in the four test files that build
      them.

## 4. Tests

- [x] 4.1 Pin the three 4K saturation geometries: distinct, strictly increasing, opposite-edge over
      the threshold — and the old formula recomputed inline, giving one number for two of them.
- [x] 4.2 Pin `evidenceCropSideDemand` against `computeCropRect(...).side` wherever the cap does not
      bind.
- [x] 4.3 Replace the "cannot fire on a source too small to crop, where the cap binds on both sides"
      test with a 320×240 small-source test covering adjacent, opposite-edge and large-subject
      pairs, all kept.
- [x] 4.4 Update the three live-measured pair readings and the `min`-vs-`max` assertion.
- [x] 4.5 Cover `cropGrowth` on a pair, on a single, on a demoted pair, and in the coverage payload.

## 5. Gates

- [x] 5.1 `npx tsc -b` clean.
- [x] 5.2 `npx eslint` clean on every touched file.
- [x] 5.3 `npm test` green.
- [ ] 5.4 **Live, by the ticket owner:** re-measure the 2.190 calibration pair on
      `e2e/fixtures/multiperson-track.mp4` via `cropGrowth` on `[evidence-coverage]`, and confirm
      Demo 1's `trunkLean` no longer renders a runner-free image. Predicted unchanged at 2.190; if
      it lands at or above 2.5, stop and report rather than moving the threshold.
