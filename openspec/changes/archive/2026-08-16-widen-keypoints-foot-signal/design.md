# Design — widen keypoints, foot signal

## Context

Issue #44 (child of epic #43), same shape of gap #30 already solved once for `nose`/`left_ear`/
`right_ear`: `COMMON_KEYPOINT_NAMES` is missing 4 names MediaPipe already computes and
`toPoseFrame` already discards. #30's design.md (D1, archived at
`openspec/changes/archive/2026-08-12-widen-keypoints-selectable-vo-signal/design.md`) already
verified every consumer of `COMMON_KEYPOINT_NAMES` is name-driven, not count-driven, except one:
`syntheticGait.ts`'s exhaustive `switch (name)`, which fails to compile on any unhandled name by
design (a `never`-typed exhaustiveness check, not a runtime surprise). That verification is not
re-derived here — `npx tsc -b` was run against the widened 19-entry type as this change's own
confirmation, and the only fallout was exactly that switch, matching #30's finding.

This document records two decisions specific to this change: the synthetic-gait foot geometry
(D1), and the tracking-crop bounding-box exclusion call (D2) the issue explicitly flagged as
needing to be "a stated decision with a regression test, not silent reliance."

## D1 — Synthetic-gait foot model: rigid fore-aft offset from the ankle

**Decision.** `left_heel`/`right_heel`/`left_foot_index`/`right_foot_index` are each placed at a
fixed pixel offset from their own side's ankle, along the fore-aft (sagittal) axis, at the
ankle's own y:

```ts
const footOffsetScale = view === 'side' ? 1 : FRONT_VIEW_ANKLE_SWAY_FACTOR
case 'left_heel':
  return detectedKeypoint(name, leftAnkleX - HEEL_BEHIND_ANKLE_PX * footOffsetScale, leftAnkleY)
case 'right_heel':
  return detectedKeypoint(name, rightAnkleX - HEEL_BEHIND_ANKLE_PX * footOffsetScale, rightAnkleY)
case 'left_foot_index':
  return detectedKeypoint(name, leftAnkleX + FOOT_INDEX_AHEAD_ANKLE_PX * footOffsetScale, leftAnkleY)
case 'right_foot_index':
  return detectedKeypoint(name, rightAnkleX + FOOT_INDEX_AHEAD_ANKLE_PX * footOffsetScale, rightAnkleY)
```

`HEEL_BEHIND_ANKLE_PX = 15`, `FOOT_INDEX_AHEAD_ANKLE_PX = 22` — plausible foot proportions (heel
sits closer to the ankle than the toe does), not measurements from footage. No new
`SyntheticGaitParams` field: nothing downstream consumes these points yet (no metric reads
heel/foot_index), so there's nothing that needs to be independently tunable per test the way
`headBounceDamping` was for the head model — the bar here is "geometrically plausible for
skeleton-overlay/robustness tests," not "hand-computable expected value."

**Why reuse `FRONT_VIEW_ANKLE_SWAY_FACTOR` rather than a new front-view damping constant.** The
same physical reasoning ankle sway itself already encodes applies identically to the foot points
rigidly attached to that ankle: a fore-aft (sagittal) quantity is highly visible from the side and
nearly disappears face-on, because the camera is looking down the axis the motion happens along.
Introducing a second, independently-tuned front-view damping constant for the foot offset would
duplicate that same judgment call under a different name for no reason — the foot points move
with the ankle, so they should damp with the ankle's own established factor.

**Why not build heel/foot_index off the ankle's own moving position with independent phase.** The
head model (#30) has independent phase/amplitude because heads and hips are different rigid
bodies connected by a flexible spine — the head genuinely can bounce differently than the hip.
Feet, by contrast, are rigidly attached to the ankle at the geometry this fixture already computes
per frame (`leftAnkleX`/`leftAnkleY` etc. already vary with stride phase and vertical lift) — the
heel and toe simply ride along with whatever the ankle is doing that frame. A rigid, ankle-relative
offset is the correct model, not a second oscillator.

## D2 — `movenetCrop.ts`: foot keypoints explicitly excluded from the bounding box

**Decision.** `BBOX_EXCLUDED_KEYPOINT_NAMES` gains the 4 new foot names, listed explicitly
alongside the existing head exclusions, rather than relying on MoveNet's structural inability to
produce them (every foot keypoint resolves to `{x:0,y:0,score:0}` on MoveNet via `toPoseFrame`'s
missing-subset-keypoint default, which would incidentally exclude them from `deriveBoundingBox`'s
confidence filter on every real call regardless).

**Why explicit, when incidental exclusion would work identically today.** Two reasons, both
already true of this codebase before this change touched it:

1. **No reference between the two contracts.** `deriveBoundingBox`'s confidence filter and
   `toPoseFrame`'s zero-default are two unrelated modules that happen to compose into the right
   behavior by coincidence, not by any dependency one has on the other. A future change to either
   module in isolation (e.g. a MoveNet variant that DOES emit foot-shaped keypoints, or a
   `toPoseFrame` refactor that changes the missing-keypoint default) would silently change
   `movenetCrop.ts`'s behavior with no compiler error, no test failure pointing at the actual
   cause, and no comment anywhere connecting the two files.
2. **The zero-score default is runtime-overridable to a false positive.** `minKeypointConfidence`
   is configurable via `window.__STRIDES_POSE_BACKEND_OVERRIDE__`'s `trackingCrop` field (see
   CLAUDE.md's "Config overrides" section) down to `0`. At `minKeypointConfidence: 0`, a
   zero-score foot keypoint would newly qualify as "confident" and incidental exclusion would
   silently break — an explicit name-based exclusion is immune to any confidence-threshold value.

This mirrors the head-keypoint exclusion already in this file (added 2026-08-11, revised
2026-08-13 with live A/B evidence) but for a different kind of reason: the head exclusion is
justified by measured A/B regressions (padded-box inflation, frame-to-frame jitter — see the
existing doc comment, unchanged by this decision). The foot exclusion has no such evidence behind
it — no backend in this app ever produces non-zero foot keypoints through the tracking-crop path
today (MoveNet is the only backend `movenetCrop.ts` runs against, and MoveNet is COCO-17). The
justification is topological (COCO-17 has no foot keypoints, so this function's box was designed
and tuned entirely around COCO-17-shaped points) and defensive (the two reasons above), not
empirical. The doc comment in `movenetCrop.ts` is split into two paragraphs to keep these two
different kinds of justification from reading as one undifferentiated rationale.

**Regression test.** `movenetCrop.test.ts` gains `'excludes foot keypoints from the box even when
they are confident'` and `'does not count excluded foot keypoints toward minConfidentKeypoints'`,
mirroring the existing head-keypoint pair of tests exactly — hand-constructed `Keypoint[]` with
confident foot points positioned to shift the box if they were counted (below the hips, where a
real heel/toe would sit), asserting the derived box is unaffected.

## Note — a third, unplanned stale count found during implementation

While updating the two count-bearing requirements the plan identified (`Requirement: Pose frame
type contract`'s "Fixed-length, fixed-order keypoints" scenario, and `Requirement: Common keypoint
subset restricts backend surface`), a third literal `15` was found in this same spec file:
`Requirement: MoveNet tracking-crop preprocessing` also cites "the 15 `COMMON_KEYPOINT_NAMES`" in
its usable-detection threshold description (inherited from the 2026-08-13 tracking-crop-revival
change, written when the count was 15). This is now stale the same way the other two were, so it's
included as a third MODIFIED requirement in this change's spec delta rather than left inconsistent
— the plan didn't anticipate it (it wasn't part of #30's original two), but the fix is the same
in kind: an accurate keypoint-count reference, no behavior change.
