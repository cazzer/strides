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

### Carry POI identity forward via a bounded settle-in window

The acquisition/reacquisition path picks the right person for the one call it runs on, but does
nothing to keep `rawDetector` tracking them afterward — `rawDetector` (steady-state single-pose)
and `multiPoseDet` (selection) are separate `@tensorflow-models/pose-detection` model instances
with zero shared internal state, so nothing about a multi-pose selection carries into
`rawDetector`'s own saliency for its next call. Under the shipped default
(`trackingCropConfig.enabled: false`), that next call is `rawDetector.estimatePoses(source.image)`
against the full, unmodified frame — exactly as unbiased as the very first call of a run, with no
mechanism to prefer the region the multi-pose pass just identified.

Fix: for `POST_ACQUISITION_SETTLE_FRAMES` calls immediately following any successful acquisition,
reacquisition, or periodic re-verification event (see below), force the SAME crop-mode call this
backend already knows how to make (`computeCropRect`/`cropCanvas`/`rawDetector.estimatePoses(
cropCanvas, ...)`, entirely reused, no new crop-geometry code) around the just-selected anchor —
independent of `trackingCropConfig.enabled`. Each settle-in call re-derives `lastBoundingBox` from
its own fresh detection exactly like ordinary crop-mode steady-state already does, so this is a
self-correcting, bounded few-frame exposure, not the continuous whole-clip crop optimization the
2026-08-13 tracking-crop revival A/B measured a regression from on the front-approach clip (see
`openspec/changes/archive/*movenet-tracking-crop/design.md`'s "Revival note") — that finding does
not automatically transfer to a 3-ish-frame window immediately after a person is freshly
identified, and needs its own A/B (Migration Plan) rather than inheriting the earlier verdict.
`TrackingCropConfig.enabled` continues to gate only the continuous optimization; the settle-in
window is a no-op whenever it's already `true` (crop is already engaged continuously, so there is
nothing extra for the settle window to force).

**Alternative considered and rejected: seed `rawDetector`'s own internal `cropRegion` from the
acquisition/reacquisition crop call, instead of running extra crop-mode calls.** Verified against
the actual installed `@tensorflow-models/pose-detection@2.1.3` source
(`dist/movenet/crop_utils.js`, `dist/movenet/detector.js`): MoveNet's `cropRegion` is stored as
FRACTIONS of whatever `imageSize` produced it (`{height, width}` in image-fraction units, not
pixels) — a `cropRegion` computed from a tightly-zoomed acquisition/reacquisition crop canvas
(e.g. 192×192) and then reused as the seed for the NEXT call's full-frame `estimatePoses(video)`
invocation would be reinterpreted against the FULL FRAME's dimensions, degenerating to "crop
[0,1]×[0,1] of the full frame" — i.e. no bias at all, the same no-op this backend's own crop-mode
code already documents (`estimatePose`'s crop-mode comment: "a same-size square canvas... always
resolves to full `[0,1]x[0,1]` coverage"). Worse, the existing framing-transition reset
(`rawDetectorUsage !== previousRawDetectorUsage`) would fire on exactly this crop-canvas→full-frame
shape change anyway, clearing whatever was seeded before `rawDetector`'s next real call even ran.
There is no cropRegion-seeding trick that survives a shape change back to full-frame; an actual
crop-mode call (this decision) is the only mechanism that keeps `rawDetector` centered on the
right region without reinterpreting the seed against a different image size.

### Periodic re-verification

The confidence-collapse reacquisition trigger (existing `reacquisitionLossThreshold` mechanism)
cannot catch every way tracking can go wrong: MoveNet can smoothly, confidently drift its
saliency onto a different person over many frames — most plausibly during a crossing/occlusion
event with someone of similar prominence — without keypoint confidence ever dropping below the
usability gate. Nothing in the confidence-based trigger fires in that case; the anchor keeps
"looking" stale-free while quietly tracking the wrong person.

Fix: every `REVERIFICATION_INTERVAL_FRAMES` steady-state calls since the last (re)acquisition or
re-verification event, proactively re-run the exact same multi-pose selection pass and
reacquisition-scoring path (`selectByReacquisitionHeuristic`/`pickBestCandidate`, unchanged) this
backend already runs on a confidence-triggered reacquisition — scored by continuity against the
CURRENT anchor, not a fresh acquisition-heuristic pass, since a periodic check is asking "is this
still the same person," not "who's the most prominent person here." A continuous match just
resets the interval counter (and may as well kick off a fresh settle-in window too, since the box
was just reconfirmed/tightened — see tasks.md). A non-continuous match — the multi-pose pass
disagrees with what `rawDetector` has been tracking — gets the identical treatment a non-continuous
reacquisition already gets: `rawDetector.reset()` (clear its now-wrong internal state) and start a
fresh settle-in window around the newly-selected person.

**Critical asymmetry with confidence-triggered reacquisition**: an empty or not-usable periodic
check MUST be a strict no-op on every counter this backend tracks for the give-up budget
(`consecutiveEmptyReacquisitions`/`personOfInterestSuspended`) — it only resets the
re-verification interval counter itself, so the check is attempted again after a full interval
rather than either (a) spamming a multi-pose call on every subsequent frame (which would happen
if the interval counter were left untouched, since the trigger condition would stay satisfied) or
(b) treating an ambiguous periodic disagreement as evidence the anchor itself is going stale
(which would incorrectly start consuming the same one-shot give-up budget confidence-based
reacquisition uses, for a mechanism that exists specifically to be safe to fire speculatively).
Steady-state tracking that was already working must never be made worse by a periodic check that
happens not to find a clean match this one time.

**Alternative considered**: no periodic trigger at all, relying solely on the confidence-collapse
trigger plus the settle-in window above. Rejected — the settle-in window only re-centers tracking
immediately after an already-detected ambiguity; it does nothing for the "MoveNet's saliency
drifted without ever losing confidence" failure mode this section exists to catch, which the user's
stated goal ("track the POI so as much of the clip as possible" — not just "at the moments
identity was already known to be ambiguous") specifically calls for.

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
- **[Risk]** The settle-in window pays crop-mode inference cost (a canvas draw + a differently-
  shaped `estimatePoses` call) for `POST_ACQUISITION_SETTLE_FRAMES` calls after EVERY acquisition,
  reacquisition, and periodic re-verification event — under the shipped
  `trackingCropConfig.enabled: false` default this is genuinely new per-event cost that never
  existed before this extension, not a reuse of already-paid crop-mode cost. → **Mitigation**:
  bounded to a first-guess default of a few frames per event (not the whole clip), and explicitly
  unmeasured — tasks.md's live-browser A/B (task 7, still not this implementer's job to run) must
  measure the actual per-event cost on both existing demo clips before any default-on call is
  reaffirmed for this extension specifically; the original acquisition/reacquisition default-on
  decision does not automatically cover these two new mechanisms.
- **[Risk]** Periodic re-verification adds a new, ongoing per-clip cost with no natural ceiling
  tied to how many people are ever in frame — unlike acquisition/reacquisition (bounded by how
  often identity is ambiguous), a long, entirely single-person, never-ambiguous clip still pays a
  `MULTIPOSE_LIGHTNING` call every `REVERIFICATION_INTERVAL_FRAMES` calls for its whole duration.
  → **Mitigation**: the interval is a first-guess default (`45`, roughly 1.5s of steady 30fps
  sampling) intentionally coarse enough that the amortized cost per tracked frame is small;
  bounded, not unlimited, per-call empty-check no-op behavior (see the Decisions section above)
  keeps a failed check from compounding into worse-than-periodic cost; still needs the same A/B
  measurement as the settle-in window before the interval default is treated as final.
- **[Risk]** Both mechanisms add new closure state (`settleFramesRemaining`,
  `callsSinceLastVerification`) and a third multi-pose dispatch reason alongside acquisition and
  reacquisition, widening the reentrancy surface NEW-1/NEW-2 (see this change's implementation
  history) already had to account for once. → **Mitigation**: both new pieces of state are
  snapshotted/reset using the exact same synchronous-snapshot-before-`await`,
  `myGeneration === generation`-guarded-mutation discipline already established for
  `lastBoundingBox`/`anchorWasReacquired`/etc., not a parallel ad hoc mechanism; unit tests cover
  the new dispatch reason's interaction with the existing reset-timing and reentrancy tests.

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

**Extension (settle-in window + periodic re-verification)**: `POST_ACQUISITION_SETTLE_FRAMES`
(first-guess default `3`) and `REVERIFICATION_INTERVAL_FRAMES` (first-guess default `45`) are
plain module constants in `personOfInterestConfig.ts`, same convention as
`REACQUISITION_PROXIMITY_DISTANCE_MULTIPLE` — not part of `PersonOfInterestConfig` itself, not
independently overridable via `window.__STRIDES_POSE_BACKEND_OVERRIDE__`. The same live-browser
A/B this Migration Plan already calls for must additionally measure, on both existing demo clips:
detected-frame count and per-metric confidence tier with these two mechanisms active vs. an
otherwise-identical run with `POST_ACQUISITION_SETTLE_FRAMES`/`REVERIFICATION_INTERVAL_FRAMES`
effectively disabled (e.g. temporarily patched to `0`/`Infinity` for the A/B only — no override
point is being added for these two specific constants), and on the multi-person fixture once
added, whether the settle-in window/periodic re-verification measurably improve how much of the
clip stays correctly tracked on the intended subject (this change's actual goal, per the user's
own framing: "track the POI so as much of the clip as possible"), not just whether the initial
acquisition/reacquisition moment picks the right person.

## Open Questions

- Exact scoring constants (proximity-fallback distance multiple, any minimum IoU floor) — decided
  empirically during the A/B in Migration Plan; does not change the requirements or task
  breakdown, only the tuned values within them.
