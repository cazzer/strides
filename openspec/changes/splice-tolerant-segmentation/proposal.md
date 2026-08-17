# Splice-tolerant segmentation (issue #54, epic #52 item 1)

## Why

On the side-view track demo, **one** collapsed detection at t=4.32 wedges the runner's own
continuous 55-detection track into 5 + 1 + 49 segments, and the 5-frame prefix loses. The measured
cost is **13–16 detected frames lost per run on the most common footage type this app sees**. It is
the reason the retroactive person-selection stage shipped by overriding its own pre-registered ship
rule, and it is epic #52's blocker.

The cause is established frame by frame (archived `retroactive-person-selection/design.md`, D7) and
is not re-derived here:

| t | bbox area px² | centre |
|---|---|---|
| 4.24 | 167,867 | (574, 849) |
| **4.32** | **24,473** | **(896, 606)** |
| 4.36 | 108,121 | (824, 738) |

The 4.24 → 4.32 cut is a **position** failure — the boxes are disjoint in x, so IoU is 0, and ~403px
of centre travel in 0.08s is ~12 sides/s against a 3 sides/s bound. **No `maxAreaRatio` value can
heal it**; override experiments at 12 and 30 confirmed that empirically. Structurally,
`deriveBoundingBox` hulls *confidence-gated* keypoints, so one dropout shrinks the box **and**
translates its centroid, perturbing the scale and position terms simultaneously and in correlated
directions.

The predicate itself is not wrong. It was designed as a per-frame anchor validator, where a false
reject costs one frame and the next frame gets another try. Reused as a **partition** criterion, the
identical false reject costs an entire prefix. The asymmetry is in the *use*, not the geometry — so
the fix belongs in the offline stage's cut loop, not in the shared predicate.

## What Changes

- **A bridge rule in the cut loop** (`src/results/retroactivePersonSelection.ts`): do not cut at a
  surviving detection when the surviving detections immediately before and after it are continuous
  **with each other** — same predicate, same bounds, time-gap term included. The bridge changes the
  *operands*, never the predicate, so it can only merge a pair the unmodified
  `isBoundingBoxContinuous` already accepts.
- **The reference does not advance across a bridged frame.** One bridge decision is meant to heal
  *both* of Demo 1's cuts: the position failure in front declined, and the failure behind it never
  asked, because the wedge frame never becomes the reference.
- **Tolerance is bounded to exactly one detection by construction**, not by a counter — after a
  bridge the next comparison is against the same reference the bridge just verified, so it cannot
  bridge again. Two consecutive bad detections still cut.
- **Bridge-and-keep**: the bridged frame stays in its segment and contributes its area. The derived
  box reaches no metric (it is a segmentation/scoring artifact); what reaches the metric stream is
  the pose, whose keypoints pass the identical 0.3 confidence gate downstream.
- **One new diagnostics field, `bridgedCuts: number`** on `PersonSelectionDiagnostics`. Without an
  observable, a healed clip and a clip that never had a wedge both just report a smaller
  `segmentCount` — indistinguishable from any other tuning effect, which makes the A/B unreadable.

## Measured outcome — the wedge is healed, and it took two changes

3 trials × 3 clips × 2 arms, real GPU, 2026-08-16, measured twice.

**Round 1 (bridge rule alone) was a complete no-op on Demo 1** — `bridgedCuts: 0`, every field
bit-identical. Do-not-ship condition 3 fired; per its own instruction the cause was re-traced and
nothing was tuned. The trace refuted the ticket's premise on one half: the wedge's neighbours have
an area ratio of **1.553** (as claimed, and passing) but an IoU of **exactly 0**, not ≈0.13 — the
boxes are disjoint in x by 0.49 px — and the centre-speed fallback then misses by **7.6%**
(273.2 px travelled against a 253.9 px budget at 3 sides/s). **The binding constraint was the
bound, not the rule's shape.**

**Round 2 adds D4** (`maxCenterSpeedSidesPerSecond` 3 → 4 offline, the same 4/3 loosening
`maxAreaRatio` already carries against the online gate) and the wedge heals:

- Demo 1's winner becomes **one segment spanning [0.08, 6.32] with 53 detections** — the 5-frame
  prefix, the wedge frame, and the 47-frame tail merged by a **single** bridge event, both
  boundaries removed at once. Was the 47-frame tail alone starting at 4.36.
- `segmentCount` 5–6 → **3–4**, `rejectedOtherSegment` 13–16 → **7–10**, detected frames 52 → **58**.
  Every remaining segment is a phantom on a visibly empty frame, and all three lie **outside** the
  winner's span.
- **Demo 2 stays a bit-identical no-op** under both changes (`bridgedCuts: 0`) — the real risk of
  widening a bound that also governs the adjacent check.
- **No bystander merged**: multi-person is bit-identical between rounds (winner `medianAreaPx`
  −0.84%, `separationRatio` 33.5, span [1.75, 3.90]), so the widened bound was never the binding
  term there.

**11 of 12 pre-registered gates pass. D1-3 (winner `frameCount` ≥ 54) fails by one frame at 53**,
recorded as a failure rather than reinterpreted. Its threshold derived from a 49-frame tail measured
in an earlier session; this session's tail is 47 in *both* arms, and 47 + 5 + 1 = 53, so every
surviving runner detection is inside the winner and the gap is cross-session sampling variance.

Demo 1 still does not reach `segmentCount === 1` with zero rejections — that remains the joint
**#54 + #57** outcome recorded in the gate amendment below.

## Impact

- Affected specs: `person-selection` (MODIFIED ×1), `analysis-diagnostics` (MODIFIED ×1).
- Affected code: `src/results/retroactivePersonSelection.ts`, plus two test fixtures that construct
  a whole `PersonSelectionDiagnostics` literal (`src/results/analysisDiagnostics.test.ts`,
  `src/results/runClipAnalysisPipeline.test.ts`). `src/results/analysisDiagnostics.ts` needs **no**
  edit — the block is type-level and by-reference pass-through.
- **`src/pose/backends/movenetCrop.ts` is NOT touched.** `isBoundingBoxContinuous` is shared with
  the live online anchor gate (`movenet.ts:472`, invoked `:1017`); the bridge is a second call to
  the existing pure function on a different pair. No signature change, no new export, no change to
  the online tracker.
- **Not a no-op only where it should not be.** Every one of the 32 pre-existing test cases in
  `retroactivePersonSelection.test.ts` passes with no assertion edited — verified by running that
  file's pre-change revision verbatim against the new implementation. Every discontinuity in that
  suite is either far outside the scale bound, time-driven, or terminal with no lookahead target,
  so none can bridge.
- Out of scope, deliberately: #55 (boxless survival inside the winner's span), #56 (scale-pass
  divergence), #57 (the 4K area floor), and #52's item 5 (Stage 2). Epic #52's headline
  `segmentCount === 1` on Demo 1 is a **joint #54 + #57** outcome — see design.md's gate
  amendment — so this change is measured on its own replacement criteria.
