# Tasks

## 1. Measure the baseline before changing anything

- [x] 1.1 Fast-forward the worktree branch to `main` (`c79d307`) — several agents have measured
      against dead code today.
- [x] 1.2 Start a dev server on the port derived for THIS checkout (5325) and verify identity by
      nonce (`assertServesThisCheckout`); confirm the renderer is `ANGLE Metal Renderer`, not
      SwiftShader.
- [x] 1.3 Add a temporary `[pair-geometry]` probe reporting, per surviving ghosted pair: elapsed
      time, box IoU, `cropGrowth`, crop side, per-joint displacement in native/output/CSS px, and
      head-keypoint clearance against the crop's top edge.
- [x] 1.4 Sweep all three clips, fresh Chromium process per clip, and record baseline coverage:
      Demo 1 8/7, Demo 2 5/4, multiperson 8/7.

## 2. `strides-ql0` — the bounce crop clips the base instant's head

- [x] 2.1 Confirm the mechanism: base head margin is tighter than ghost on every bounce pair on
      every clip (Demo 2: 35.5 px vs 87.5 px on a 720 px crop), and confirm by eye that the scalp is
      cut on the pre-change image.
- [x] 2.2 Add `nose`, `left_ear`, `right_ear` to `BOUNCE_CONTEXT_KEYPOINTS`.
- [x] 2.3 Re-measure `evidencePairCropGrowth` for **every** bounce-family pair on all three clips and
      confirm none approaches `EVIDENCE_MAX_PAIR_CROP_GROWTH`. Result: 7 of 8 fell, max reading
      1.104 vs 2.5.
- [x] 2.4 Confirm every non-bounce pair's growth and crop side are byte-identical.
- [x] 2.5 Confirm head clearance improved on every bounce pair, and verify by eye that the head is
      fully inside the crop.
- [x] 2.6 Pin the constant and the end-to-end wiring in `bounceInstants.test.ts`.

## 3. `strides-r41` — a two-frame pair survives the near-identical guard

- [x] 3.1 Re-measure the 3.52 / 3.55 pair after `strides-cjl`; confirm it is still present
      (t = 3.516667 / 3.55, 33 ms).
- [x] 3.2 Decide the guard with evidence: tabulate IoU, joint travel in output px, joint travel ÷ box
      diagonal, and elapsed time in sampled intervals for every surviving pair on all three clips.
      Result: all three spatial measures order the broken pair backwards; only elapsed time separates
      it, 2 intervals against a tightest-good 8.
- [x] 3.3 Leave `EVIDENCE_NEAR_IDENTICAL_IOU` at 0.98 and record on the constant why it cannot be
      moved.
- [x] 3.4 Add `EVIDENCE_MIN_PAIR_SEPARATION_INTERVALS = 3` and `isTooCloseInTimePair`, derived from
      half a bounce cycle at `spectralFitMaxFrequencyHz` and the ≥24 fps floor — not from what makes
      one clip pass.
- [x] 3.5 Fold it into `pairCollapsed` so it routes through the existing demote-or-drop logic.
- [x] 3.6 Move `kneeFlexionPeak` into `SINGLE_INSTANT_KINDS`, on the principle that its reported value
      is a single-instant angle — without it the guard deletes the metric's evidence rather than
      replacing a bad ghost with an honest still.
- [x] 3.7 Verify the demoted image by eye and read its caption.
- [x] 3.8 Unit-test the guard: threshold, symmetry, scaling with the sampler, degenerate tolerance,
      and the IoU-orders-backwards property.

## 4. Repair the test fixtures the new floor invalidates

- [x] 4.1 Widen every pair fixture's TIMESTAMPS only (0.1 → 0.4), leaving positions untouched so all
      geometric assertions stay valid.
- [x] 4.2 Rebuild `crossingFrames` at 80 px/sample over 7 frames so its drawable case sits four
      samples apart, above the near floor, while keeping the 2.5 boundary landing exactly on a sample.
- [x] 4.3 Split the near-identical drop test: `kneeFlexionPeak` demotes, the cycles and ranges drop.
      Keep it in the far-apart drop list, which is unchanged for every kind.

## 5. Verify

- [x] 5.1 `npx tsc -b` clean.
- [x] 5.2 `npx eslint src/` clean.
- [x] 5.3 `npx vitest run` — 1350 passed, 0 failed.
- [x] 5.4 Revert the probe and delete the experimental file; confirm the working tree carries only
      the four intended files.
- [x] 5.5 Re-sweep all three clips on the shipped code and confirm coverage is unchanged
      (8/7, 5/4, 8/7) and the DOM canvas count matches the coverage line.
- [x] 5.6 Pull EVERY rendered image out of the DOM on all three clips and look at each one at full
      resolution and at the real 142 CSS px size — not only the two under test.
- [x] 5.7 Confirm the regression anchor: Demo 1 `verticalOscillationCm` = 4.421467928439415 with
      `fit.frequencyHz × 60 == cadence.value == 91.2`.

## 6. Spec

- [x] 6.1 Write the `results-view` delta as a MODIFIED block that is a strict superset of the current
      requirement — all 12 existing scenarios preserved verbatim, 3 added.
- [x] 6.2 `openspec validate --strict`.
- [ ] 6.3 Archive. **Deliberately not done** — the brief says do not archive.
