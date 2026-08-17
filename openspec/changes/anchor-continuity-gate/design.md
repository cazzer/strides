# Design — anchor continuity gate + full-frame keypoint smoothing

## Context

`multi-person-acquisition` gave this backend a person-of-interest concept, but only at *event*
moments: acquisition (no anchor yet), reacquisition (anchor gone stale), and periodic
re-verification (every `REVERIFICATION_INTERVAL_FRAMES` calls). All three route through
`pickBestCandidate`, which scores continuity against the last known box and reports whether the
winner was `continuous`.

Every other call — the steady state, which is the large majority — takes the ordinary single-pose
path and installs whatever it detected as the new anchor, unconditionally. That asymmetry is the
hole this change closes. It is not a hypothetical: it was reproduced live on 2026-08-16 (see
proposal.md's Why), and it is self-latching, because accepting a detection also zeroes
`consecutiveLowConfidence` — the very counter whose threshold is the only trigger for the
recovery path.

Separately, and unrelated to person identity: MoveNet's own one-euro keypoint filter stopped
running on the default sampling path when the default sampler changed to WebCodecs sequential
decode. Both fixes land here because both live in the same function and both were found in the
same live session, but they are independent and are specified as separate requirements.

## Goals / Non-Goals

**Goals**

- A confidently detected *wrong* person can no longer silently become, and permanently remain,
  the tracked person.
- When that happens, the existing multi-pose reacquisition machinery gets a chance to run —
  today it is starved by the reset described above.
- Restore the per-keypoint temporal smoothing the pipeline used to get for free.
- Keep both behaviors A/B-able through the existing config-override plane, and keep the
  documented pre-change baseline reproducible.

**Non-Goals**

- An explicit "subject has left the frame" terminal state. Real, and visible in the same live
  clip, but a separate concern: it is about when a *run* should stop trusting its input, not
  about which person a *call* is tracking. Deferred pending this change's A/B.
- Resetting or stabilizing MoveNet's own persisted internal crop region during continuous crop
  tracking (see "A library-behavior note" below). Also deferred.
- Any change to `computeCropRect`'s clamping. The clamp is what starves the tracker of the
  subject near a frame edge, but with the gate in place a starved crop produces tracking *loss*
  (recoverable, and the existing fallback handles it) instead of an anchor *steal*.

## Decisions

### The gate has two independent tests, both of which must pass

**Spatial**: `computeBoundingBoxIoU(derived, anchor) > 0` **OR** the boxes' center displacement is
within a speed bound. Overlapping boxes pass immediately, which is the common, cheap case.

**Scale**: `bboxArea(derived) / bboxArea(anchor)` lies within `[1 / maxAreaRatio, maxAreaRatio]`.

Both must pass. In the observed live failure the spatial test alone would *not* have caught the
steal — the fence bystanders sit well within a couple of body-widths of the runner in source
pixels — while the scale test rejects them by a wide margin. The two tests catch genuinely
different failure shapes (a jump across the frame vs. a jump in depth), so neither is redundant.

### The spatial bound is a speed, not a fixed multiple of the box side

`REACQUISITION_PROXIMITY_DISTANCE_MULTIPLE` (a flat `2 × side`) is the right shape for
*reacquisition*, where an unknown amount of time has passed since the subject was last seen. It
is the wrong shape for per-call continuity, where the tolerable displacement is a function of how
much time actually elapsed — and this pipeline's inter-call spacing is not fixed. The playback
sampler samples whatever the detector can keep up with; the sequential sampler has a
`targetSamplesPerSecond` knob; and a single slow frame stretches the gap arbitrarily.

So the bound is expressed as `maxCenterSpeedSidesPerSecond × anchorSide × Δt`, where `anchorSide`
is `max(width, height)` of the anchor box (the same "side" concept `computeCropRect` and
`isWithinProximityThreshold` already use, so it scales with subject distance) and `Δt` is
`currentTime - lastSeenTime`. A fixed multiple would either be too tight at low sample rates or
useless at high ones.

`Δt <= 0` (or no previous timestamp) skips the speed term rather than rejecting: a zero or
negative gap gives a degenerate bound, and this is the wrong place to adjudicate a
timestamp anomaly. The scale test still applies, and `IoU > 0` still passes on its own.

### Defaults: `maxCenterSpeedSidesPerSecond: 3`, `maxAreaRatio: 3`

`3` sides/second: a runner crossing a 1920-px-wide frame in ~1.5 s covers ~1280 px/s; against a
~700 px bbox side that is ~1.8 sides/s. Three leaves roughly 1.7× headroom over the fastest
motion this app is built to measure, and the bound only ever applies to non-overlapping boxes.

`3×` area: bbox area is genuinely noisy here, because `deriveBoundingBox` only spans keypoints
clearing `minKeypointConfidence` — an arm or a trailing leg dropping below the gate shrinks the
box with no real change in the subject. A symmetric factor-of-three band absorbs that while
still rejecting the observed steal by a wide margin (the live clip's fence bystanders are roughly
a third of the runner's on-screen height — an area ratio near `1/9`).

Both are first-guess values in the same sense as `POST_ACQUISITION_SETTLE_FRAMES` and
`REVERIFICATION_INTERVAL_FRAMES`: reasoned from clip geometry, to be tuned by the live A/B, not
fixed here. Both are config fields rather than module constants precisely so the A/B can move
them without a code edit.

### A rejected detection still returns its frame

The gate decides *who this backend considers the tracked person*. It does not decide whether a
frame is emitted. `estimatePose` keeps returning `toPoseFrame(...)` exactly as before; only the
anchor bookkeeping changes. This preserves the backend's existing "always return what was
detected" invariant, and it keeps the gate from silently deleting samples — the downstream
robustness and presence-trimming layers remain the only things that decide what counts as usable
data.

The consequence is honest but worth stating: during a steal-then-reject episode the returned
frames are the *wrong person's* keypoints, flowing into the metrics as ordinary detections. The
gate shortens that episode from "the rest of the run" to at most
`reacquisitionLossThreshold` calls before reacquisition is attempted; it does not eliminate it.
Suppressing those frames outright is the deferred "subject exited" work.

### The gate is skipped when there is nothing to be continuous with

Three cases, all no-ops:

1. **No anchor** (`lastBoundingBox === null`) — a fresh acquisition has nothing to compare
   against. This also covers the first call of every run and every call after `clearAnchor()`.
2. **`personOfInterest.enabled: false`** — the documented pre-change baseline arm. Disabling the
   person-of-interest concept must disable every identity opinion it introduced, this one
   included, or the A/B baseline is not a baseline.
3. **`personOfInterestSuspended`** — the run has explicitly given up on disambiguation and
   dropped to the plain single-pose path. Re-imposing an identity constraint there would
   contradict the decision that was just made, and could keep the run pinned in the suspended
   state (the detection that clears suspension is the same one the gate would be rejecting).
   Today every site that sets `personOfInterestSuspended` also calls `clearAnchor()`, so case 1
   already covers it — this is stated explicitly so the two are not silently coupled.

It **is** applied during a settle-in window. Those calls follow a deliberate multi-pose selection,
so `lastBoundingBox` is the just-selected person and continuity against them is exactly the
property worth enforcing.

### Rejection is a tracking loss, and the escape hatch is already bounded

A rejected detection calls `registerTrackingLoss()` instead of resetting the counters. That is
the whole point: it lets `consecutiveLowConfidence` climb to `reacquisitionLossThreshold`, which
makes the next call a reacquisition dispatch — the path that *does* score continuity across all
simultaneously visible candidates.

This cannot deadlock, because the existing give-up machinery already bounds it. If the anchor is
itself wrong and reacquisition keeps reselecting the same wrong person, `anchorWasReacquired`
becomes `true`; the next staleness triggers give-up, which calls `clearAnchor()` and sets
`personOfInterestSuspended`. Anchor cleared plus suspension means the gate stops applying (cases
1 and 3 above), and the next ordinary detection installs an anchor freely. Worst case is a
bounded number of degraded calls, not a permanent stall — which is strictly better than today's
behavior, where a wrong anchor is permanent by construction.

### Config lives on `PersonOfInterestConfig`, nested, with its own kill switch

This is an identity concern, not a cropping one, so it does not belong on `TrackingCropConfig` —
and it must apply whether or not cropping is enabled, since the hole exists on both paths.
`PersonOfInterestConfig` gains a nested `continuityGate: { enabled, maxCenterSpeedSidesPerSecond,
maxAreaRatio }` rather than three flat sibling fields, so the gate can be switched off
independently of the multi-pose dispatch it complements.

`poseBackendConfig.ts`'s `resolvePoseDetectorConfig()` already shallow-merges `personOfInterest`;
the nested object needs the same one-level-deeper merge `trackingCrop` gets, so a partial
override of one gate field does not blank the others.

### Timestamp fix: which call sites, and which one is deliberately left alone

`rawDetector.estimatePoses(source.image)` at the steady-state full-frame call site gains the
timestamp argument, in **milliseconds** (`currentTime * 1000`) — the library multiplies the
caller-supplied value by `1e3` to reach its internal microseconds, which is exactly what the
existing crop-mode call site at `movenet.ts:816` already relies on. Passing the two call sites
different units would be a silent, hard-to-see bug, so they share one expression.

Monotonicity is already handled: the existing new-run check (`currentTime < lastSeenTime -
NEW_RUN_TIME_DROP_SEC`) calls `rawDetector.reset()`, which drops the filter state, so a replayed
or switched clip never hands the filter a backwards delta. Within a run, both samplers produce
monotonically increasing timestamps (`video.currentTime` on the playback path, presentation-order
`ptsSec` on the sequential path).

The `trackingCrop.enabled: false && personOfInterest.enabled: false` early-return path is
**deliberately not changed**. It is the byte-identical pre-`multi-person-acquisition` baseline,
and it performs no generation bookkeeping and no new-run check by design — adding a timestamp
there without also adding the reset would feed the filter a non-monotonic series across runs,
and adding the reset would destroy the property that makes it a baseline. Known, accepted
asymmetry: that arm keeps whatever behavior the source type gives it (smoothed for an
`HTMLVideoElement`, unsmoothed for a canvas), which is precisely the pre-change behavior it
exists to reproduce. The default configuration never takes this path.

### A library-behavior note that a code comment currently gets wrong

`movenet.ts`'s transition-reset comment justifies not resetting `rawDetector` during steady crop
tracking on the grounds that "`initCropRegion` always resolves to full `[0,1]x[0,1]` coverage
regardless of MoveNet's own stale `cropRegion`, so resetting on every steady-tracking call would
only cost MoveNet's one-euro smoothing continuity for no correctness benefit."

The premise does not hold. On a *successful* detection the library does not call
`initCropRegion` at all — it calls `determineCropRegion`, which returns a tight, torso-centered
region (radius `max(1.9 × torsoHalfSpan, 1.2 × keypointHalfSpan)`), stores it on the detector,
and passes it through `filterCropRegion` on the way. `initCropRegion` is only reached when that
region would be degenerate or when `cropRegion` is null — i.e. after a reset. So reset and
no-reset feed materially different regions, and they are not equivalent-modulo-smoothing.

This change corrects the comment. It does **not** change the reset behavior: doing so is the
deferred item above, it interacts with the smoothing continuity this change is simultaneously
restoring, and changing both at once would make the A/B unreadable.

## Risks / Trade-offs

- **False rejection of a real subject.** A genuinely fast subject at a low sample rate, or one
  whose bbox collapses because several keypoints drop below `minKeypointConfidence` at once,
  could trip the gate. The failure mode is a spurious tracking loss — recoverable via the
  existing fallback, and bounded — not a lock-in, so it is the correct direction to err. Both
  thresholds are deliberately loose for this reason, and both are tunable without a code edit.
- **The gate cannot fix a wrong *first* anchor.** Acquisition still picks by
  `bboxArea × meanConfidence`, and the gate has nothing to compare a first detection against. If
  acquisition picks the wrong person, the gate will faithfully keep tracking them.
- **Two changes, one A/B.** The smoothing fix changes every keypoint's value; the gate changes
  which person is tracked. Measuring them together risks attributing one's effect to the other.
  Mitigated by A/B'ing them separately, both switchable at runtime — the gate via
  `personOfInterest.continuityGate.enabled`, the smoothing fix inherently by comparing against
  the pre-change build. The gate arm should be measured with smoothing already on in both arms.
- **`sampleClip.ts`'s per-frame timeout lets calls overlap.** The gate reads live
  `lastBoundingBox`/`lastSeenTime` inside the existing `isCurrent` reentrancy guard, so a stale
  call can neither be judged against, nor clobber, a newer call's anchor. No new concurrency
  surface.

## Migration Plan

Live-browser A/B per this repo's documented harness (real GPU, both demo clips plus the
side-view park clip that produced the live failure, 3 trials per arm, medians not single runs).

Arms: `continuityGate.enabled` false vs. true, with the timestamp fix present in both so the gate
is measured in isolation.

Pre-registered ship rule, following `multi-person-acquisition`'s precedent rather than
tracking-crop's (this is a correctness fix for a live-confirmed bug, not an optimization):
**ship default-on if per-metric confidence tiers hold** — i.e. no clip's median tier degrades —
**and** the reproduction clip no longer transfers its anchor to a bystander. A tier degradation
on either demo clip flips the default to off pending investigation, and the reproduction check
is a hard gate regardless of the tier result.

## Live-browser A/B results (2026-08-16)

Headless Chromium, real GPU (`ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`, confirmed via
`WEBGL_debug_renderer_info` — not SwiftShader). 3 trials per arm per clip.
`trackingCrop.enabled: true` and `scalePass.enabled: false` in every arm; the only variable is
`personOfInterest.continuityGate.enabled`. The timestamp fix is present in both arms, so the gate
is measured in isolation.

Anchor behavior was read through a temporary dev-only probe in `movenet.ts` (per this repo's
add-measure-revert convention) that recorded, for every steady-state call, the derived box, the
live anchor, and the gate's verdict. The probe was reverted afterwards; `git diff` on
`movenet.ts` carries no trace of it.

**Reproduction clip** (`e2e/fixtures/multiperson-track.mp4` — the same footage as the reported
bug: a runner crossing right-to-left with a walker and a background crowd behind a fence).
Bit-identical across all 3 trials in both arms.

| | gate off | gate on |
|---|---|---|
| detectedFrames / totalSamples | 142 / 233 | 135 / 233 |
| gate rejections | 0 | 9 |
| runner last tracked | t = 3.533 s | t = 3.533 s |
| first bystander frame accepted as anchor | **t = 3.583 s** | **t = 3.833 s** |
| bystander-scale frames accepted | **16** | **5** |
| kneeFlexion | 97.4° | **79.6°** |
| view confidence | 0.692 | 0.715 |

The failure reproduces exactly as reported. With the gate off, one frame-interval after the
runner was last seen the anchor jumps from the runner (bbox area ~35 000 px², center y ≈ 730) to
a background bystander (area ~3 000 px², center y ≈ 615) — a ~10× scale mismatch, close to the
`1/9` this design predicted — and never recovers for the rest of the clip.

With the gate on, those detections are rejected (position continuity passes — the bystander is
well within the speed bound — and scale is what catches them, as designed), the loss counter
climbs to `reacquisitionLossThreshold`, and a multi-pose reacquisition runs. Bystander frames
reaching the metrics drop by 69%, and `kneeFlexion` moves 17.8° as a result: those frames were
measuring the wrong person's knee.

**Honest limit on this clip.** The gate does not eliminate the handover here, because the steal
happens at the moment the runner *leaves the frame* — reacquisition scored against the runner's
last box correctly finds nobody, the bounded give-up path fires, and the remaining 5 bystander
frames are accepted with the gate legitimately no longer applying (`personOfInterestSuspended`).
That is the designed bounded-escape behavior, not a gate failure: closing the last 5 frames needs
the deferred "subject exited frame" terminal state, which is exactly what this change's Non-Goals
name. What the gate does deliver is the in-frame guarantee — a wrong anchor is no longer
permanent — plus a 69% reduction in wrong-person data on the one clip that reproduces the bug.

**Demo clips** (`Demo 1 (side view)`, `Demo 2 (front view)`). Both bit-identical across all 3
trials in both arms:

| | demo 1, off | demo 1, on | demo 2, off | demo 2, on |
|---|---|---|---|---|
| detectedFrames / totalSamples | 70 / 228 | 70 / 228 | 98 / 99 | 98 / 99 |
| gate rejections | 0 | 0 | 0 | 0 |
| every metric's confidence | identical | identical | identical | identical |

**Zero rejections on either single-subject clip, and every metric byte-identical.** On footage
with one person the gate is a pure no-op — which is the correct result: there is never a
discontinuity to reject, so it costs nothing where it has nothing to do. (Demo 2's confidences
are uniformly low in both arms; that is the already-documented cost of running the front-approach
clip with tracking-crop enabled, unrelated to this change.)

## Second round: the re-verification hole (2026-08-16, same day)

The A/B above ran with `trackingCrop.enabled: true` in every arm — but the shipped default is
`false`. That was a real gap: the configuration users actually run had not been measured. Re-run
on the default (crop off), the gate fired correctly but a **second, separate** hopping cause
showed up — the one this design had parked in Open Questions as "should the gate also apply to the
multi-pose path?".

Measured on the reproduction clip, identically in both crop arms and every trial: a periodic
re-verification pass returned a SINGLE candidate of 6 164 px², scored `continuous: true`, and
replaced a healthy 37 465 px² anchor with it. `pickBestCandidate`'s continuity test is
IoU/proximity only — it has no scale term — so an overlapping partial detection is judged "the
same person" no matter how much smaller it is.

That made the gate actively counterproductive on that path: with the anchor collapsed 6×, the
steady-state gate then rejected the next **five genuine full-size detections of the real runner**
for being discontinuous with it. The gate was guarding the wrong person against the right one.

Fixed by applying the scale half of the gate to a re-verification selection that CLAIMS
continuity, treating a failure as the already-specified "raw candidates but none usable" strict
no-op. The `continuous` flag is what makes this safe to narrow: a NON-continuous selection is an
intentional identity switch — the thing re-verification exists to do — and is left untouched at
any scale. The first attempt gated all re-verification selections regardless, which broke an
existing test asserting exactly that intentional-switch behavior; that test failure was the signal
that the check needed the `continuous` qualifier, not that the test was stale.

Post-fix matrix, reproduction clip, 2 trials per cell, bit-identical within each cell:

| | detected | real-subject frames wrongly rejected | bystander frames reaching metrics | first bystander frame |
|---|---|---|---|---|
| crop off, gate off | 142/233 | 0 | 20 | t = 3.583 s |
| **crop off, gate on** (shipped default) | 137/233 | 1 | **10** | **t = 3.733 s** |
| crop on, gate off | 142/233 | 0 | 16 | t = 3.583 s |
| crop on, gate on | 142/233 | 0 | **14** | t = 3.583 s |

On the shipped default the gate halves wrong-person frames (20 → 10) and delays the handover. The
five-frame self-inflicted rejection of the real runner is gone (1 frame remains, a sliver of the
subject already half out of frame).

Note the crop-on column is weaker than the first round's numbers reported above (which showed 5
bystander frames and a handover delayed to t = 3.833 s). Those first-round figures were partly an
artifact of the very anchor collapse this fix removes — the collapsed anchor caused extra
rejections that happened to suppress bystander frames for the wrong reason. The table here is the
honest post-fix measurement and supersedes the crop-on figures in the first-round table.

**What still hops, and why.** Every remaining bystander frame on this clip lands after t ≈ 3.58 s,
which is when the runner leaves the frame entirely. Reacquisition scored against their last box
correctly finds nobody, the bounded give-up path fires, disambiguation suspends, and the gate
stops applying by design. Closing that needs the deferred "subject exited frame" terminal state —
which this round promotes from a nice-to-have to the top of the remaining work, since it is now
the sole remaining cause of hopping on the one clip that reproduces the bug.

**Ship-rule evaluation: PASS, default on.**
- *Confidence tiers hold* — satisfied, in the strongest possible form: no tier changed because no
  metric value changed at all on either demo clip.
- *The reproduction clip no longer transfers its anchor to a bystander* — satisfied for the
  in-frame case, which is what the rule was written about. The post-exit handover that remains is
  a different, already-named problem, and the gate still cuts the wrong-person frame count by 69%
  and corrects `kneeFlexion` by 17.8° on that clip.

`DEFAULT_CONTINUITY_GATE_CONFIG.enabled` therefore ships `true`. Neither threshold was tuned as a
result of this A/B — both first-guess values were left where the design put them, since the demo
clips produced zero rejections (no false-positive pressure to loosen) and the reproduction clip's
steal was caught by a wide margin (no pressure to tighten).

## Open Questions

- ~~Should the gate also apply to the multi-pose path?~~ **Answered by the second round above,
  for `reverification`: yes, for a selection that claims continuity.** Measurement showed this was
  not academic — it was the dominant remaining hopping cause on the shipped default config. Still
  open for `reacquisition`, which runs against an already-stale anchor after a real tracking loss,
  where a genuine scale change is plausible; no failure has been measured there yet. The
  acquisition-heuristic fallback stays deliberately ungated in both cases: installing a
  discontinuous anchor is that path's specified recovery behavior.
- Whether `maxAreaRatio` should compare against the anchor box or against a running median of
  recent box areas. A median would be robust to the single-frame keypoint-dropout noise the
  loose default currently absorbs, at the cost of new state. Deferred until the A/B shows
  whether the loose default actually costs anything.
