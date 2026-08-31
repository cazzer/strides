# Tasks

## 1. Measure the defect before changing anything

- [x] 1.1 Re-take the baseline on the current `main` (`73ab5b8`), after `strides-3a1` moved every
      grafted metric's crop side — an earlier baseline straddles that commit and is not comparable.
- [x] 1.2 Capture a pixel-aligned annotation-free reference of every image, so "the photograph
      beneath a mark" is the actual pixel rather than an estimate.
- [x] 1.3 Confirm the arithmetic that makes the halo the only available answer: relative luminance
      of both mark colours, and the background luminance above which each drops below 3:1.
- [x] 1.4 Resolve every fraction against the real 144 CSS px display side and identify which are
      sub-pixel there.

## 2. Floor the halo in display pixels

- [x] 2.1 Add `EVIDENCE_INLINE_DISPLAY_SIDE_PX`, and make `evidenceAnnotationMetrics` take the
      display side as an argument defaulting to it.
- [x] 2.2 Add `MIN_HALO_DISPLAY_PX` and floor the halo against it, keeping the existing canvas-pixel
      floor so a degenerate canvas still gets a halo.
- [x] 2.3 Verify the floor is proportional to the canvas side, so halving the canvas still halves
      every weight.

## 3. Stop the halo carrying emphasis

- [x] 3.1 Add `MIN_HALO_MARK_OPACITY` and `haloOpacityFor`, so a ghost's or an interpolated mark's
      halo is not scaled down by the mark's own opacity.
- [x] 3.2 Move the joint dot's ring outside the dot rather than straddling its rim, so widening it
      outlines the dot instead of consuming it.

## 4. Keep a dashed construction dashed

- [x] 4.1 Establish that the visible gap is `gap − (constructionWidth + 2·haloWidth)`, not `gap`,
      and that it was already only 0.65 display px before this change.
- [x] 4.2 Add `MIN_DASH_GAP_DISPLAY_PX` and floor the *visible* gap against it.

## 5. Stop marks erasing each other

- [x] 5.1 Split the painter into a halo pass and a mark pass over the whole annotation, keeping
      painter order within each pass.
- [x] 5.2 Confirm the existing ordering tests (joint dots over segments, markers over joint dots)
      still hold unmodified.

## 6. Choose the width by measurement

- [x] 6.1 Sweep `MIN_HALO_DISPLAY_PX` over 1.0 / 1.5 / 2.0, all three clips, all 21 images, fresh
      Chromium process per clip, real GPU.
- [x] 6.2 Record the result: 1.5 is a peak, not a ramp — 2.0 fixes nothing further and breaks Demo 1
      `overstriding`.

## 7. Tests

- [x] 7.1 Assert the halo clears the display-pixel floor on every canvas side the planner produces.
- [x] 7.2 Assert the visible dash gap clears its floor on the same canvas sides.
- [x] 7.3 Assert proportional sizing survives: halving the canvas halves the halo and the dash
      pattern.
- [x] 7.4 Assert a larger display surface relaxes the floors rather than inheriting them.
- [x] 7.5 Assert the canvas-pixel floor still applies when the display floor cannot.
- [x] 7.6 Assert every halo is painted before any mark colour.
- [x] 7.7 Assert a ghost mark's halo is as strong as a base mark's while the marks themselves keep
      differing opacities, and that no halo exceeds a full-opacity mark's.

## 8. Verify live

- [x] 8.1 Re-capture all three clips and read contrast on the rendered 144 CSS px pixels.
- [x] 8.2 Look at all 21 images at full resolution and at 144 px; record what got worse.
- [x] 8.3 Confirm Demo 1 `kneeFlexion` did not degrade.
- [x] 8.4 Confirm coverage: 8/7, 5/4, 8/7, zero `extraction-failed`.
- [x] 8.5 Confirm the regression anchor and `subjectAgreement`.
- [x] 8.6 Confirm the annotation-free references are bit-identical before and after, proving this
      change touches nothing but the annotation layer.
- [x] 8.7 `npx tsc -b`, `npx eslint src/`, full `npm test`.

## 9. Adjudicate the two beads

- [x] 9.1 `strides-dt1` — closed on its acceptance criterion.
- [x] 9.2 `strides-60w` — **not** closed. Record why this change structurally cannot close it, and
      what would.
- [x] 9.3 Record the two Demo 2 `armSwingSymmetry` cells that remain short of 100%, and why forcing
      them was declined.

## 10. Housekeeping

- [x] 10.1 Remove the temporary annotation-skip probe used to capture the references.
- [x] 10.2 Delete the scratch harness; leave nothing untracked behind.
