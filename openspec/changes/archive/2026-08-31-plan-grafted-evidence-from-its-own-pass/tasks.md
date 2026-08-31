# Tasks

## 1. Establish the defect is reachable before fixing it

- [x] 1.1 Write a temporary probe reading both passes' hip ordering and hip-mid offset at matched
      timestamps, plus the same facts at the grafted exemplars' own instants
- [x] 1.2 Splice it dev-only into the scale-pass effect, where both frame arrays are in hand
- [x] 1.3 Drive all three clips live, real GPU, this checkout's own dev server
- [x] 1.4 Record the result: 15/57 (Demo 1), 0/98 (Demo 2), 15/87 (multiperson) instants ordered
      oppositely; 3 of 12 grafted exemplar instants affected; hip-mid median 31.5 px apart on Demo 1
- [x] 1.5 Revert the probe and delete the experimental module

## 2. Size the alternatives before choosing

- [x] 2.1 Trace whether fix (1) needs a second frame array threaded through the extractor — it does
      not; the plan is the last layer that holds frames
- [x] 2.2 Establish whether fix (2) addresses the polarity — it does not; a primary frame
      corroborates at gap exactly 0 on every instant of every clip and is still inverted 26% of
      the time
- [x] 2.3 Establish whether `scalePassSubjectAgreement.ts` already does the work — it does not; it
      compares hulls, which are invariant under a left/right relabelling
- [x] 2.4 Measure what fix (2) would cost in lost evidence before recommending it

## 3. Carry the grafting pass's frames

- [x] 3.1 `ScalePassState.robustFrames?: RobustPoseFrame[]`, documented as set only on `'done'`
- [x] 3.2 Store the scale pass's frames in the same `setState` literal that commits the graft
- [x] 3.3 Test: the frames are the scale pass's, and the analysis state's own stay the primary's
- [x] 3.4 Test: a failed pass carries no frames at all

## 4. Route grafted metrics to them

- [x] 4.1 Export `GRAFTED_METRIC_IDS` from `scalePassGraft.ts`
- [x] 4.2 Pin it by test against what `graftScalePassResult` and `dropGraftedExemplars` actually
      touch, derived rather than hand-listed
- [x] 4.3 `planClipEvidence` takes the grafting pass's frames and routes those metrics to them,
      with their own snap tolerance and travel direction
- [x] 4.4 Thread them through `useSessionEvidence`, including the input-identity comparison
- [x] 4.5 Test: polarity comes from the grafting pass on a fixture where the two order the hips
      oppositely
- [x] 4.6 Test: joint positions and crop come from the grafting pass
- [x] 4.7 Test: travel direction is derived per array, not shared
- [x] 4.8 Test: an instant only the grafting pass sampled still plans
- [x] 4.9 Test: every non-grafted metric is byte-identical to the un-routed plan
- [x] 4.10 Mutation-check the routing so the new tests are known to be load-bearing

## 5. Correct the docs this change owns

- [x] 5.1 `scalePassGraft.ts`'s seam bullet, with the measurement
- [x] 5.2 `evidenceFrames.ts`'s `resolveOutwardSigns` note
- [x] 5.3 Leave `evidenceAnnotations.ts` alone and say why; file the removal as its own bead

## 6. Verify

- [x] 6.1 `npx tsc -b`, `npx eslint src/`, full `npm test`
- [x] 6.2 Live, 3 trials per clip, fresh Chromium per trial, real GPU, identity-verified server
- [x] 6.3 Coverage unchanged: Demo 1 8/7, Demo 2 5/4, multiperson 8/7 on every trial
- [x] 6.4 Regression anchor unchanged to the last digit on every trial
- [x] 6.5 Confirm the routing is live: the grafted metric's crop side moved on all three clips
