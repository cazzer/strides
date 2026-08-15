## Why

The MoveNet backend has no way to tell people apart. `SINGLEPOSE_LIGHTNING`/`SINGLEPOSE_THUNDER`
return whichever single person the model's own internal saliency picks, per call, with no
person-of-interest concept anywhere in this app's code. This was confirmed live against a
user-supplied clip (real browser, Playwright + headless Chromium): before the runner ever
entered frame, the tracked skeleton locked onto a small, distant bystander near a bench in the
background, not the more prominent bystander also in view. The model did correctly snap onto the
runner once they became prominent — MoveNet's own raw detector keeps an internal cropRegion
across calls once it has a confident anchor, independent of this app's own tracking-crop plane —
but as the runner receded and got partially occluded, keypoints went stale (frozen at the last
confident position) and `cadence`/`verticalOscillation` both ended up unmeasurable in that run's
diagnostics. This is a real metric-quality bug, not a cosmetic overlay glitch, and it is not
specific to that one clip: any clip with more than one person in frame is exposed to it,
especially at the moments identity is genuinely ambiguous — the opening frames of a run (no
anchor yet) and reacquisition after the current anchor's confidence drops (occlusion, subject
exiting/re-entering frame).

## What Changes

- Add a multi-pose detection pass (MoveNet `MULTIPOSE_LIGHTNING`, same
  `@tensorflow-models/pose-detection` package already installed — no new dependency) to the
  MoveNet backend, run only at the two moments identity is ambiguous: initial acquisition (the
  first successful detection of a run, no prior anchor) and reacquisition (the anchor's
  confidence has dropped enough that the single-pose path may no longer be tracking the same
  person).
- Add a "lost confidence" signal for the reacquisition trigger that fires even when
  `trackingCropConfig.enabled` is `false` (today's default, and the mode the reported bug
  reproduced under) — today `reacquisitionLossThreshold` only counts consecutive not-usable
  frames in crop mode, so the default full-frame path currently has no loss signal at all to
  extend.
- Add a person-of-interest heuristic that scores the multi-pose candidates: on initial
  acquisition (no prior anchor), score by bbox area weighted by mean keypoint confidence; on
  reacquisition (a prior anchor exists), score by IoU/proximity continuity against the last known
  bounding box. The chosen candidate's keypoints are returned for that call.
- **Selecting the right person at an acquisition/reacquisition moment does not, by itself, keep
  tracking them.** The single-pose detector (`rawDetector`) and the multi-pose selection pass
  (`multiPoseDet`) are separate model instances sharing zero internal state — nothing carries the
  selected person's identity forward into `rawDetector`'s own saliency once the acquisition/
  reacquisition call resolves. Under the shipped default (`trackingCropConfig.enabled: false`),
  `rawDetector`'s very next call is a plain, unbiased full-frame call with no mechanism to prefer
  the just-selected region, and separately, MoveNet can smoothly drift onto a different person
  over many frames without its confidence ever dropping below the usability gate that would
  trigger a confidence-based reacquisition. Two additive mechanisms close this gap (design.md's
  Decisions has the full rationale, including a naive-seed approach that was tried and rejected):
  - A bounded settle-in window: for `postAcquisitionSettleFrames` calls immediately following a
    successful acquisition, reacquisition, or periodic re-verification event, force crop-mode
    framing around the just-selected/reconfirmed anchor — independent of
    `trackingCropConfig.enabled`, which continues to gate only the continuous whole-clip
    optimization — so the single-pose detector's next few calls are actually centered on the
    right person instead of running full-frame and unbiased.
  - Periodic re-verification: every `reverificationIntervalFrames` calls since the last
    (re)acquisition or re-verification event, re-run the multi-pose selection pass against the
    current anchor even though confidence hasn't dropped, to catch MoveNet's own saliency
    smoothly drifting onto a different person without ever tripping the confidence-based
    reacquisition trigger.
- Steady-state tracking (a confident anchor exists, the loss signal has not fired, and no
  periodic re-verification is due) still runs the existing single-pose call, optionally wrapped
  by tracking-crop, exactly as before — but this is no longer the entire steady-state story: the
  multi-pose pass is still deliberately not run on every call, just no longer confined to
  acquisition/reacquisition moments alone.
- Out of scope: the MediaPipe Pose Landmarker backend's `numPoses: 1` has the same theoretical
  gap but a different runtime (MediaPipe Tasks Vision, not `@tensorflow-models/pose-detection`)
  with no multi-pose variant already wired into this app, and no live repro against it yet —
  left as a follow-up.
- Out of scope: no dedicated multi-person ground-truth clip exists in this repo's demo-clip set
  today, so the acquisition/reacquisition heuristic's default-on choice (and its scoring weights)
  need validation against this repo's existing live-browser A/B harness before shipping, the same
  way the MoveNet Thunder-vs-Lightning and tracking-crop revival changes were both validated —
  this is design-phase work, not resolved by this proposal.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pose-detection`: adds a multi-pose acquisition/reacquisition pass and a person-of-interest
  selection heuristic to the MoveNet backend, a full-frame "lost confidence" signal that today
  only exists when tracking-crop is enabled, and two additive continuity mechanisms (a bounded
  post-selection settle-in window and periodic re-verification) that keep the single-pose
  detector actually tracking the selected person for as much of the clip as possible, not just at
  the moment they were selected.

## Impact

- `src/pose/backends/movenet.ts`: the stateful wrapper around the raw MoveNet detector
  (`lastBoundingBox`, `registerTrackingLoss`, the crop/no-crop branches) gains the multi-pose
  acquisition/reacquisition path, the person-of-interest heuristic, the settle-in-window crop
  trigger (independent of `trackingCropConfig.enabled`), and the periodic re-verification
  dispatch.
- `src/pose/backends/movenetCrop.ts`: candidate scoring (bbox area, IoU/proximity) reuses or
  extends the existing `deriveBoundingBox`/`computeCropRect` primitives; the settle-in window and
  periodic re-verification reuse `computeCropRect`/the crop canvas as-is, no new crop-geometry
  code.
- `src/pose/backends/personOfInterestConfig.ts`: gains two new named constants,
  `POST_ACQUISITION_SETTLE_FRAMES`/`REVERIFICATION_INTERVAL_FRAMES`, alongside the existing
  `REACQUISITION_PROXIMITY_DISTANCE_MULTIPLE` — first-guess defaults, tuned by the same
  live-browser A/B this change's Migration Plan already calls for, not fixed by this proposal.
- `src/pose/backends/trackingCropConfig.ts`: unchanged by this extension — `TrackingCropConfig`
  keeps gating only the continuous whole-clip crop optimization; the settle-in window is this
  capability's own mechanism, not a `TrackingCropConfig` field.
- No API change to `PoseDetector`/`PoseFrame` — this is purely an internal MoveNet-backend
  behavior change, invisible to `usePoseDetector.ts` and everything downstream of it.
- New model asset: MoveNet `MULTIPOSE_LIGHTNING`, fetched lazily (only if the acquisition/
  reacquisition/re-verification path actually runs) via the same
  `@tensorflow-models/pose-detection` model-URL mechanism the existing single-pose models use.
