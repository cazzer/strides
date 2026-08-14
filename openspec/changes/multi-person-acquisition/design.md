## Context

See proposal.md - Why. Two facts from reading `src/pose/backends/movenet.ts` shape this design:

1. `estimatePose` currently has an early-return branch for `!trackingCropConfig.enabled` (today's
   default) that calls `rawDetector.estimatePoses(source.image)` and returns, with a comment
   explicitly framing it as a "total kill-switch: no tracking state read or written". This is the
   exact branch the live-tested bug reproduced under — it has no bounding-box/loss state to hook
   an acquisition or reacquisition trigger onto today.
2. The crop-enabled branch already tracks `lastBoundingBox`, `consecutiveLowConfidence`, and
   `reacquisitionLossThreshold`, but only to decide crop-vs-full-frame framing for inference, not
   who the tracked person is. `registerTrackingLoss` is a no-op when `usingCrop` is false, so
   loss is never counted for a full-frame call even in today's crop-enabled configuration.

## Goals / Non-Goals

**Goals:**
- Give MoveNet a person-of-interest concept that exists independent of the crop-canvas
  optimization, so the acquisition/reacquisition path works under the shipped default
  (`trackingCropConfig.enabled: false`) as well as when crop is on.
- Keep the multi-pose pass off the hot path — steady-state tracking costs exactly what it costs
  today.

**Non-Goals:**
- Re-architecting the crop-vs-full-frame framing decision itself (untouched).
- MediaPipe backend changes (see proposal.md - Impact).
- Landing a specific default-on/off decision or specific scoring constants in this document —
  those are validated empirically (see Migration Plan) before shipping default-on.

## Decisions

### Unify anchor-tracking state across the crop-enabled and crop-disabled branches

Lift `lastBoundingBox` and a consecutive-low-confidence counter out of being conceptually
"crop-mode state" into an always-present "tracked anchor" the whole `estimatePose` closure
maintains, regardless of `trackingCropConfig.enabled`. `trackingCropConfig.enabled` continues to
control only whether that anchor is used to build a cropped canvas for inference; it no longer
controls whether an anchor exists at all.

**Alternative considered**: keep the two branches fully separate, duplicating a lightweight
bbox/loss-counter pair inside the disabled branch. Rejected — two independent copies of loss-
counting logic drift out of sync over time (already a known risk pattern in this codebase; see
CLAUDE.md's repeated preference for one config/override surface over parallel ones), and the
unified version is what the MODIFIED spec's new scenario ("Disabling tracking-crop is a
kill-switch for the cropped-canvas optimization only") describes directly.

### Lazy-create the MULTIPOSE_LIGHTNING detector

Create the multi-pose detector on first actual use (the first acquisition call of the first run),
not unconditionally inside `createMoveNetDetector`. `createMoveNetDetector`'s returned promise
continues to resolve as soon as the single-pose detector is ready, matching today's cold-start
experience; the first acquisition call pays the multi-pose model's own download/init cost
in-line, and the created instance is memoized for the page lifetime (same pattern as the existing
scale-pass detector accessor).

**Alternative considered**: create both detectors eagerly, in parallel, inside
`createMoveNetDetector`. Rejected — adds the multi-pose model's download to every page load's
cold-start even though it is only actually needed once inference starts, for no benefit (the
first acquisition call already happens well after `createMoveNetDetector` resolves, since it
requires a loaded video frame).

### One shared loss threshold, not two

The existing `reacquisitionLossThreshold` continues to gate crop-vs-full-frame fallback when
crop is enabled, and the same value drives the reacquisition trigger for the multi-pose path in
both crop-enabled and crop-disabled configurations — one number to tune, not two independently-
drifting ones. `TrackingCropConfig` keeps its name and existing fields; nothing here requires
splitting it into a separate config object.

### Person-of-interest scoring

- **Acquisition** (no prior anchor): score each `MULTIPOSE_LIGHTNING` candidate by bounding-box
  area (via the existing `deriveBoundingBox`, reused as-is — same head/foot-keypoint exclusions
  as today's crop-bbox math, for consistency) weighted by mean keypoint confidence across the
  same non-excluded keypoint set. Highest score wins.
- **Reacquisition** (a prior anchor exists): score each candidate by IoU against the last known
  bounding box. If every candidate has zero IoU (the subject moved far enough that boxes no
  longer overlap — plausible during real occlusion/reacquisition), fall back to proximity: the
  candidate whose bbox center is closest to the last known bbox's center, only if within a
  distance threshold expressed as a multiple of the last known bbox's own side length (so it
  scales with how close/far the subject was from the camera). If no candidate is within that
  threshold either, treat the call as a fresh acquisition (apply the acquisition heuristic
  instead) rather than force a match to an unrelated person — this is the MODIFIED spec's "No
  candidate matches the last known position" scenario.
- Exact constants (the proximity distance multiple, any minimum IoU floor) are left as tunable
  values validated by the A/B in Migration Plan, not fixed here.

**Alternative considered for reacquisition**: score by acquisition heuristic (area × confidence)
alone, ignoring continuity entirely. Rejected — this is exactly today's bug (the reported clip's
background bystander could easily out-score a partially-occluded runner on raw area × confidence
alone); continuity to the last known position is the whole point of a reacquisition-specific
heuristic.

## Risks / Trade-offs

- **[Risk]** `MULTIPOSE_LIGHTNING` is mandatory on every run's opening frames (acquisition always
  runs once), so any latency or accuracy difference from the single-pose models applies to every
  clip, not just multi-person ones. → **Mitigation**: lazy creation keeps this off the
  `createMoveNetDetector` cold-start path; the A/B (Migration Plan) measures the actual per-run
  cost before this ships default-on, following the same practice already used for the MoveNet
  Thunder-vs-Lightning and tracking-crop revival changes in this repo's history.
- **[Risk]** The IoU/proximity heuristic can still mis-reacquire in a genuinely ambiguous scene
  (two similar-looking people crossing paths near the last known position). → **Mitigation**:
  none is claimed to be perfect; this is an accepted, documented limitation, not a blocking bug —
  consistent with how this repo documents other backend limitations (e.g. BlazePose/PoseNet in
  CLAUDE.md's "Known issues").
- **[Risk]** No multi-person ground-truth clip exists in this repo's demo-clip set today, so the
  acquisition/reacquisition heuristic can only be validated against the one reported clip plus
  the two existing (single-person) demo clips as regression controls. → **Mitigation**: tasks.md
  includes adding the reported clip as a checked-in test fixture (with permission), and the A/B
  explicitly reports this as a validation gap rather than silently treating one clip as sufficient
  evidence, matching this repo's established practice (see CLAUDE.md's slow-motion and dynamic-
  valgus spikes' "no real-device sample" caveats).
- **[Risk]** Unifying anchor state touches the disabled branch every existing run exercises today
  under the shipped default config. → **Mitigation**: the MODIFIED spec's scenarios pin the
  boundary explicitly; tasks.md includes a regression check that both existing (single-person)
  demo clips produce behavior-equivalent tracking before/after this change.

## Migration Plan

No data migration. Ship behind the same dev-only `window.__STRIDES_POSE_BACKEND_OVERRIDE__`
surface this backend already uses for tracking-crop, adding a sibling field (e.g. a
`personOfInterest.enabled` boolean) so the A/B harness can compare the new path against baseline
on demand, the same pattern `trackingCrop.enabled` already establishes. Unlike tracking-crop
(a performance optimization that measured a real regression on one clip and shipped default-off),
this is a correctness fix for a live-confirmed bug, so the default-on/off call should default
toward **on** unless the A/B turns up a comparable regression — final call is made after running
this repo's live-browser A/B harness (CLAUDE.md's Playwright + real-GPU pattern, 3+ trials per
clip) across the two existing demo clips (regression controls — expect no meaningful change,
since MODIFIED requirement scenario "Exactly one person present at first detection" specifies
value-equivalent behavior) and the reported multi-person clip once added as a fixture.

## Open Questions

- Exact scoring constants (proximity-fallback distance multiple, any minimum IoU floor) — decided
  empirically during the A/B in Migration Plan; does not change the requirements or task
  breakdown, only the tuned values within them.
