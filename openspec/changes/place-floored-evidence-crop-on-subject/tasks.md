# Tasks — place a floored evidence crop on the subject

## 1. Measure before designing

- [x] 1.1 Confirm the corrected mechanism against the code: `selectRetroactivePersonOfInterest`
      discards its per-frame boxes and returns only `PersonSelectionDiagnostics`; neither module
      imports the other; `RobustPoseFrame` carries no bounding box. There is no bystander to look up.
- [x] 1.2 Add a temporary `[crop-geometry]` probe (`cropGeometryProbe.experimental.ts` plus one call
      in `planExemplarFrames`) dumping ROI box, padded side, crop rect and the box over all 19
      keypoint names, per planned exemplar.
- [x] 1.3 Capture the baseline on all three clips — headless Chromium, `--headless=new --enable-gpu
      --ignore-gpu-blocklist`, renderer asserted not SwiftShader, **fresh Chromium process per clip**
      (`strides-9wp`), dev server on the derived port with `assertServesThisCheckout` (`strides-zpb`).
      Save every rendered evidence canvas out of the DOM plus the last `[evidence-coverage]` line.
- [x] 1.4 Read the geometry: six floor-inflated crops across two clips, two of which are the defect
      and four of which are the shapes the previous attempt broke. Table in `design.md` D2.

## 2. Implement

- [x] 2.1 Split `evidenceCropPaddedSide` out of `evidenceCropSideDemand`, so "the side the metric
      asked for" has one definition.
- [x] 2.2 Add `frameSubjectExtentBox` — the box over every `COMMON_KEYPOINT_NAMES` entry that
      resolves, unioned across the drawn frames. Document it as a **lower bound**, and name the
      MoveNet foot-keypoint truncation at the definition site.
- [x] 2.3 Add `subjectCentredCropRect` with the two conditions from `design.md` D3, changing only
      `x`/`y` and never `side`, re-clamping to the frame by shifting.
- [x] 2.4 Place `computeEvidenceCropRect`'s result through it.
- [x] 2.5 Confirm no constant moved: `EVIDENCE_CROP_MIN_SIDE_PX` 320,
      `EVIDENCE_CROP_PADDING_MULTIPLIER` 1.6, `EVIDENCE_MAX_PAIR_CROP_GROWTH` 2.5,
      `EVIDENCE_NEAR_IDENTICAL_IOU` 0.98, `EVIDENCE_GHOST_BLEND_ALPHA` 0.35,
      `EVIDENCE_GHOST_MARK_OPACITY` 0.5, `MIN_EXEMPLAR_QUALITY` 0.5, the 3-MAD bound. No new tunable
      constant introduced.

## 3. Unit coverage

- [x] 3.1 `frameSubjectExtentBox`: spans every resolving name; unions across frames; null when
      nothing resolves; contains the crop box; stops 30 px higher on the MoveNet shape than on the
      MediaPipe one.
- [x] 3.2 Fires: a floor-inflated limb crop over a narrower-but-taller subject is centred on the
      subject, the unqualifying axis does not move, and the measured region stays inside.
- [x] 3.3 Declines, with the measured shape in each case: the multiperson `kneeFlexion` shape (crop
      larger than the subject on both axes); the multiperson `footStrikePattern` shape, asserted
      **identical on both backend shapes**; the Demo 2 `verticalOscillation` shape (padding, not the
      floor, made it wider); a frame-capped crop.
- [x] 3.4 `side` is never changed, so the growth ratio and `cropSidePx` cannot observe this.
- [x] 3.5 Frame edge: shifts rather than shrinks, stays in bounds, and equals `computeCropRect`'s own
      clamp for the same centre — the scenario "A subject near the frame edge yields a valid crop".
- [x] 3.6 The wider-than-tall corner in which the foot truncation could bias a vertical placement:
      constructed, and the surviving guarantee (the measured region stays in the picture) asserted.
- [x] 3.7 Verify the new cases are load-bearing — with the rule disabled the suite fails.

## 4. Verify live and by looking

- [x] 4.1 Re-run the same harness on all three clips with the change in, and diff every extracted
      image against the baseline byte for byte.
- [x] 4.2 **Look at every image**, on all three clips, at full resolution and at the real 144 CSS px
      inline size — not only the acceptance target. Report anything that got worse.
- [x] 4.3 Check coverage from the last `[evidence-coverage]` line per clip against CLAUDE.md's table.
- [x] 4.4 Check the regression anchor: Demo 1 `verticalOscillationCm` 4.421467928439415 cm with
      `fit.frequencyHz × 60 == cadence.value == 91.2`.
- [x] 4.5 Revert the probe: delete `cropGeometryProbe.experimental.ts` and its call site.

## 5. Spec and gates

- [x] 5.1 Delta on `results-view`'s "Evidence frames are planned purely, then extracted from a
      detached video element", reusing the exact requirement and scenario titles and reproducing the
      whole body, since a MODIFIED block replaces it.
- [x] 5.2 Check the bead's staleness claim about that requirement before acting on it.
- [x] 5.3 `openspec validate --strict`.
- [x] 5.4 `npx tsc -b`, `npx eslint src/`, full `npx vitest run`.
- [ ] 5.5 Archive — **deliberately not done here**; archiving is handled centrally.
