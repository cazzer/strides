# Tasks — compare view confidence across labels

## 1. Establish the baseline and the blast radius

- [x] 1.1 Grep every read of `ViewDetectionResult.confidence` in `src/`, on the commit carrying
      `propagate-view-confidence-to-metric-gating`. Record what it still drives (design.md D9).
- [x] 1.2 Measure all three clips live (headless Chromium, real GPU asserted via
      `WEBGL_debug_renderer_info`, 3 trials each), capturing `view.confidence`, `view.diagnostics`
      and every metric's `value`/`confidence`/`viewFit` off `[analysis-diagnostics]`.

## 2. Derive the numbers from anatomy, before looking at any clip

- [x] 2.1 Derive the bilateral spread ratio a dead-on front view produces, per body build, from
      biacromial and hip-JOINT-CENTRE separations over this repo's own measured torso lengths.
- [x] 2.2 Derive the sagittal excursion ratio a dead-on side view produces from a running stride's
      ankle fore-aft range, and check it against both side clips' measured SER.
- [x] 2.3 Pre-register the criteria a threshold and a full-support value must satisfy (design.md
      D4, P1–P5), then adjudicate against them.
- [x] 2.4 Cross-check the projection model against the clips' own signals — two independent
      estimates of camera yaw per clip — and record the agreement.
- [x] 2.5 Sweep the threshold to show the outcome is flat across a plateau rather than balanced on
      one digit (design.md D6).

## 3. Implement

- [x] 3.1 Replace `marginTowardZero`/`marginAwayFromZero` with one `signalMargin(value, threshold,
      fullSupport)`, and name the two exact projection limits as module constants.
- [x] 3.2 Add `frontViewFullBilateralSpreadRatio` and `sideViewFullSagittalExcursionRatio` to
      `HeuristicsConfig`, documenting each one's derivation at its declaration.
- [x] 3.3 Move `frontViewMinBilateralSpreadRatio` 0.55 → 0.45.
- [x] 3.4 Update the `ViewDetectionResult.confidence` doc comment, which asserted the scalar was
      NOT comparable across labels, and the `viewPlausibility.ts` cross-reference to the deleted
      helper.

## 4. Test

- [x] 4.1 Add a fixture builder that hits an exact (BSR, SER) pair, so tests state camera geometry
      directly.
- [x] 4.2 Pin the anatomy: dead-on front and dead-on side both reach 1; the front full-support
      value lies inside the anatomical band and is not twice the threshold; the front bar sits
      below the narrowest build's dead-on value; the side full-support value is bracketed by this
      repo's own measured side-view SER.
- [x] 4.3 Pin all three clips' measured signals and their resulting confidences, including the
      before-numbers in the comment so the regression is legible.
- [x] 4.4 Re-express the fixtures in `index.test.ts` and `viewPlausibility.test.ts` that encoded
      the 0.55 bar, preserving each test's intent (same position within the undecided band, not the
      same raw number).
- [x] 4.5 `npx tsc -b`, `npx eslint` on every touched file, full `npm test`.

## 5. Verify live

- [x] 5.1 Re-measure all three clips, 3 trials each, same harness and same GPU assertion.
- [x] 5.2 Confirm both side clips are unchanged to every reported digit.
- [x] 5.3 Confirm no metric changed `value`, `confidence` or `viewFit` on any clip, so no card and
      no evidence exemplar moved.
- [x] 5.4 Check the regression anchor: Demo 1 `verticalOscillationCm` 4.421467928439415 cm with
      `fit.frequencyHz * 60 == cadence.value == 91.2`.
