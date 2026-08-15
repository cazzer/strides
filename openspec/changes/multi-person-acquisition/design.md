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

### Create the MULTIPOSE_LIGHTNING detector eagerly, in parallel with the single-pose detector

**Superseded decision, kept for the record — see "Live-browser A/B found the original lazy-create
decision catastrophic" immediately below for why.** The original version of this decision created
the multi-pose detector lazily, on first actual use (the first acquisition call of the first run),
on the theory that its download/init cost should only be paid by a run that actually reaches an
acquisition moment — reasoning that turned out to be wrong: acquisition runs on the FIRST call of
literally every run (no prior anchor ever exists yet), so lazy creation was never actually
deferring a rare cost, it was relocating an unavoidable one to the single worst place to pay it —
synchronously, mid-frame-sampling, during real-time playback.

**Current decision**: create both the single-pose and multi-pose detectors eagerly, in parallel
(`Promise.all`-shaped, not sequential — so the wait is `max(singlePoseTime, multiPoseTime)`, not
their sum), inside `createMoveNetDetector`, both awaited before its returned promise resolves —
the same treatment the single-pose model has always gotten, which `usePoseDetector.ts` already
gates auto-analyze on. This moves the model-fetch cost from a silent mid-clip stall (real,
measured data loss — see below) to a visible, bounded "loading detector" wait before analysis
starts (no data loss).

**Skip the multi-pose fetch entirely when `personOfInterestConfig.enabled` is `false`.** The
kill-switch should kill this cost too, not just the runtime dispatch behavior — there is no
reason to pay for, or wait on, a model this detector instance will never invoke. `createDetector`
for `MULTIPOSE_LIGHTNING` is only even called when the config says to.

**A creation failure is caught locally**, inside `createMoveNetDetector`, so it degrades to
"multi-pose unavailable for this detector instance" (a `null` reference from then on, permanently
— no retry: there is no natural "try again" moment once creation has already been paid for, or
failed, up front for every run this cached, page-lifetime detector instance will ever serve)
rather than rejecting the whole `createMoveNetDetector` promise. Single-pose tracking must keep
working even if the multi-pose model never loads — task 2.2's "never regress below baseline"
guarantee, now enforced at construction time instead of per-call. This also means the lazy
accessor's own per-run failure-caching (`multiPoseCreationFailedThisRun`, `getMultiPoseDetector`)
is gone entirely, not just relocated: there is nothing left to cache across calls once creation
happens exactly once, synchronously-relative-to-construction, for the instance's whole lifetime.

#### Live-browser A/B found the original lazy-create decision catastrophic, not just costly

Real GPU, 3 trials per clip, `personOfInterest.enabled: true` (lazy creation) vs. `false`
(baseline): the park clip lost cadence/vertical-oscillation ENTIRELY (`null`, all 3 trials); the
track clip had 1 of 3 trials collapse to 0 detected frames, the other two lost 12-32% of samples.
The baseline was fine across all 6 trials. This is exactly the risk this section's original text
flagged as "a separate, larger question this fix does not attempt" (see the superseded decision's
now-rejected alternative above) — confirmed catastrophic by measurement, not theoretical. The
mechanism: `sampleClip.ts` samples via `requestVideoFrameCallback` during literal 1x playback;
every millisecond the multi-pose model's fetch/init takes on the (always-first-call) acquisition
attempt is a video frame that plays past and is never sampled, with no way to "catch up" after the
fact. A visible pre-analysis loading wait has no such failure mode — it costs wall-clock time
before sampling starts, not video frames during it.

**Alternative NOT taken: keep lazy creation, but kick off the fetch speculatively as soon as a
video is selected, ahead of `estimatePose` ever being called.** Considered and rejected as a
second-best option once the eager-at-construction fix above was confirmed with the user: it would
still leave a real (if usually smaller) race between the fetch finishing and analysis actually
reaching the first sampled frame, reintroducing exactly this class of bug under different timing
conditions (a fast machine sampling before a slow network finishes) rather than eliminating it, for
no benefit over the simpler, already-`usePoseDetector.ts`-gated eager-at-construction approach.

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

Fix: for `POST_ACQUISITION_SETTLE_FRAMES` calls immediately following a successful acquisition, or
a reacquisition/re-verification event that switches to a genuinely different (non-continuous)
person (a continuous reacquisition/re-verification confirms `rawDetector` was already tracking the
right person and does NOT re-trigger the window — see "Gate the settle-in window to genuine
identity changes only", below), force the SAME crop-mode call this backend already knows how to
make (`computeCropRect`/`cropCanvas`/`rawDetector.estimatePoses(cropCanvas, ...)`, entirely reused,
no new crop-geometry code) around the just-selected anchor — independent of
`trackingCropConfig.enabled`. `TrackingCropConfig.enabled` continues to gate only the continuous
optimization; the settle-in window is a no-op whenever it's already `true` (crop is already
engaged continuously, so there is nothing extra for the settle window to force).

**Why this still needs its own A/B, not the tracking-crop revival's verdict, and not a
self-correction argument either.** Each settle-in call re-derives `lastBoundingBox` from its own
fresh detection exactly like ordinary crop-mode steady-state already does, so staleness never
accumulates beyond one frame within the window — that claim is true, but it does NOT address the
mechanism the 2026-08-13 tracking-crop revival A/B actually measured a regression from on the
front-approach park clip (see `openspec/changes/archive/*movenet-tracking-crop/design.md`'s
"Revival note"): a lagging tracked box computed one frame ago mismatching the subject's on-screen
position/scale THIS frame, on a clip where that scale changes ~3× across its ~1.65s duration. That
mismatch is a property of a SINGLE crop-mode call relative to the ONE frame its box was computed
from — identical in size whether the window containing that call is 3 frames long or 3000 frames
long. Self-correction bounds how far staleness can accumulate ACROSS a window; it says nothing
about whether the first (or any) call INSIDE a settle-in window suffers the exact one-frame-lag
mismatch the revival A/B already found harmful. The real reason a separate A/B is still required
is duty cycle, not self-correction: a settle-in window that fires on every event exposes roughly
`POST_ACQUISITION_SETTLE_FRAMES / REVERIFICATION_INTERVAL_FRAMES` (≈ 3/45, ~6.5%) of otherwise-
steady-state frames to this per-call lag risk — a meaningfully different, and non-zero, exposure
than the revival A/B's baseline of zero (crop-disabled) for the shipped default. Gating the window
to genuine identity changes only (see below) reduces the CONTINUOUS-match share of that duty cycle
to near-zero, but acquisition and genuine reacquisition events still pay it, and the rate is
plausibly HIGHER, not lower, on exactly the clips most likely to need re-disambiguation in the
first place (a borderline-confidence clip like park, where the subject's rapidly-changing scale
that makes tracking hard in general also makes reacquisition/re-verification events more frequent)
— the clip class where the revival A/B measured its regression is not a coincidentally-unrelated
edge case, it is closer to a worst case for this exact duty-cycle argument. This is squarely an
empirical question the live-browser A/B (Migration Plan) needs to answer on both demo clips, not
something the self-correction property settles on its own.

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

### Gate the settle-in window to genuine identity changes only

A continuous reacquisition or periodic re-verification match confirms `rawDetector` was already
tracking the right person — no new identity information exists. Forcing a settle-in window in
that case fires crop-mode calls (and, worse, a `rawDetector.reset()`, since the original
implementation of this decision unconditionally reset alongside the window) that throw away
working smoothing continuity for no benefit, at real per-event duty-cycle cost every
`REVERIFICATION_INTERVAL_FRAMES` calls even when everything was already fine (see the duty-cycle
discussion above). The settle-in window and the identity-switch `rawDetector.reset()` (see NEW-1)
now only trigger when a selection carries NEW identity information: a fresh acquisition (no prior
anchor existed to compare against), or a reacquisition/re-verification whose winning candidate is
NOT continuous with the last known anchor (IoU and proximity both rejected it, so the selection
fell through to the acquisition heuristic). A continuous reacquisition/re-verification match
updates `lastBoundingBox` (the box may be slightly tightened) and resets the relevant loss/interval
counters, but does neither of those two disruptive things — this is the common case in a clip
where tracking is working, so gating it here is what keeps this extension's typical per-clip cost
close to the acquisition/reacquisition-only baseline rather than paying the full settle-in/reset
cost on every periodic tick regardless of whether anything was actually wrong.

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
still the same person," not "who's the most prominent person here." A continuous match resets the
interval counter and updates the tracked box, but (see "Gate the settle-in window to genuine
identity changes only", above) does NOT start a settle-in window or reset `rawDetector` — nothing
new was learned. A non-continuous match — the multi-pose pass disagrees with what `rawDetector`
has been tracking — gets the identical treatment a non-continuous confidence-triggered
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
Beyond leaving tracking STATE untouched, a failed periodic check must not drop the SAMPLED FRAME
either: it falls through to the ordinary, already-in-progress single-pose call for that same
frame instead of resolving `null` (review F2) — the extra multi-pose model invocation is paid only
on the rare failed check, never on every periodic tick, and the pipeline never loses a frame
purely because a speculative, safe-to-fail verification happened to land on it. Steady-state
tracking that was already working must never be made worse — in EITHER state or sampled output —
by a periodic check that happens not to find a clean match this one time.

**Alternative considered**: no periodic trigger at all, relying solely on the confidence-collapse
trigger plus the settle-in window above. Rejected — the settle-in window only re-centers tracking
immediately after an already-detected ambiguity; it does nothing for the "MoveNet's saliency
drifted without ever losing confidence" failure mode this section exists to catch, which the user's
stated goal ("track the POI so as much of the clip as possible" — not just "at the moments
identity was already known to be ambiguous") specifically calls for.

## Risks / Trade-offs

- **[Risk]** `MULTIPOSE_LIGHTNING` is mandatory on every run's opening frames (acquisition always
  runs once), so any latency or accuracy difference from the single-pose models applies to every
  clip, not just multi-person ones. → **Mitigation**: unlike the model-fetch/init cost (moved to
  eager, parallel `createMoveNetDetector`-time creation — see "Create the MULTIPOSE_LIGHTNING
  detector eagerly" above, which supersedes this risk's original lazy-creation mitigation after
  the live-browser A/B found it catastrophic, not just costly), the PER-INFERENCE-CALL accuracy/
  latency difference between the multi-pose and single-pose models on the one call acquisition
  actually runs is a separate, still-open question the A/B (Migration Plan) measures before this
  ships default-on, following the same practice already used for the MoveNet Thunder-vs-Lightning
  and tracking-crop revival changes in this repo's history.
- **[Risk]** Eager, parallel creation adds real cold-start latency to `createMoveNetDetector`
  itself — a genuinely new cost this change introduces, not a relocation of an existing one, since
  `personOfInterestConfig.enabled: true` is the shipped default. → **Mitigation**: bounded by
  `usePoseDetector.ts` already gating auto-analyze on this same promise (the same UX the
  single-pose model's own load time already produces — a "loading detector" wait, not a broken or
  silently-degraded page), and by running both detector creations in parallel rather than in
  sequence (`max`, not sum, of the two fetch times). A rough gut-check, not a live A/B: MoveNet
  `MULTIPOSE_LIGHTNING`'s published TF.js/TF Hub asset is on the same order of size as
  `SINGLEPOSE_LIGHTNING` (a few MB, float16 MobileNet-based backbone) — this repo's own
  `MODEL_INPUT_RESOLUTION`/`MOVENET_MULTIPOSE_LIGHTNING_URL` constants point at the same TF Hub
  distribution family as the already-shipped single-pose models, so the added wait is plausibly
  comparable to, not a multiple of, today's existing single-pose cold-start time — but this has
  not been measured end-to-end (task 10's live-browser A/B measures runtime accuracy/cost, not
  cold-start wall-clock time specifically) and should be spot-checked before this is treated as
  settled, not just assumed acceptable from the size estimate alone.
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
  shaped `estimatePoses` call) for `POST_ACQUISITION_SETTLE_FRAMES` calls after every acquisition
  and every reacquisition/re-verification event that switches to a non-continuous person (gated
  per "Gate the settle-in window to genuine identity changes only" above — a continuous match does
  NOT pay this) — under the shipped `trackingCropConfig.enabled: false` default this is genuinely
  new per-event cost that never existed before this extension, not a reuse of already-paid
  crop-mode cost. → **Mitigation**: bounded to a first-guess default of a few frames per event
  (not the whole clip), gated to the events that actually carry new identity information, and
  explicitly unmeasured — tasks.md's live-browser A/B (task 10, still not this implementer's job
  to run) must measure the actual per-event cost and real-world duty cycle (see the "Why this
  still needs its own A/B" discussion above) on both existing demo clips before any default-on
  call is reaffirmed for this extension specifically; the original acquisition/reacquisition
  default-on decision does not automatically cover these two new mechanisms.
- **[Risk]** Periodic re-verification adds a new, ongoing per-clip cost with no natural ceiling
  tied to how many people are ever in frame — unlike acquisition/reacquisition (bounded by how
  often identity is ambiguous), a long, entirely single-person, never-ambiguous clip still pays a
  `MULTIPOSE_LIGHTNING` call every `REVERIFICATION_INTERVAL_FRAMES` calls for its whole duration.
  → **Mitigation**: the interval is a first-guess default (`45`, roughly 1.5s of steady 30fps
  sampling) intentionally coarse enough that the amortized cost per tracked frame is small;
  bounded, not unlimited, per-call empty-check no-op behavior (see the Decisions section above)
  keeps a failed check from compounding into worse-than-periodic cost, and a failed check now also
  falls through to the ordinary single-pose call for that same frame (review F2) rather than
  dropping the sample outright; still needs the same A/B measurement as the settle-in window
  before the interval default is treated as final.
- **[Risk]** Periodic re-verification and the settle-in window inject STRUCTURED, PERIODIC
  contamination into the sampled keypoint series, not random noise — this is a materially
  different risk than raw throughput cost, and needs its own check in the A/B, not just tier/
  detected-frame-count comparisons. Two concrete mechanisms: (a) a re-verification cycle briefly
  substitutes `MULTIPOSE_LIGHTNING`'s output for `rawDetector`'s (model-heterogeneity frames —
  different model, different keypoint precision/bias, injected at a fixed cadence rather than
  randomly), and (b) a non-continuous identity switch's `rawDetector.reset()` introduces a
  smoothing-filter discontinuity at that same fixed cadence. CLAUDE.md's "MediaPipe metric
  calibration" section already documents this pipeline's cadence/vertical-oscillation spectral fit
  sitting close to its own quality gate on real footage (`sinusoidR2 ≈ 0.49` on the side-view track
  clip vs. a `0.30` gate) — a fit that marginal has little headroom to absorb a periodic,
  structured contamination source on top of ordinary GPU float non-associativity noise, and a
  period near a real stride frequency could in principle alias into the fitted frequency itself
  rather than just adding broadband noise. → **Mitigation**: not a code fix, a documentation
  flag — task 10.4's A/B must explicitly check `fit.sinusoidR2` (and, ideally, `fit.frequencyHz ×
  60` against `cadence.value`, the same free cross-check CLAUDE.md's VO section already uses) with
  these two mechanisms active vs. disabled, not only detected-frame-count/confidence-tier
  comparisons, which would not by themselves surface a spectral-fit-quality regression these
  mechanisms could plausibly cause.
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

**Superseding revision (eager, parallel multi-pose detector creation)**: the live-browser A/B
(task group 10) surfaced that the original lazy-creation design (see "Create the
MULTIPOSE_LIGHTNING detector eagerly, in parallel with the single-pose detector" in Decisions)
caused real, measured data loss under the shipped default -- not a tuning nit, a shipping blocker
that has now been fixed by creating both detectors eagerly, in parallel, inside
`createMoveNetDetector`, gated behind `personOfInterestConfig.enabled` (skipped entirely when
`false`). This DOES add real cold-start latency to detector creation itself, gated behind whether
that latency has been separately measured/deemed acceptable -- see the two new Risks entries
above for a rough gut-check estimate (not yet a live A/B) and what would settle it properly. This
supersedes only the CREATION-TIMING half of the original acquisition/reacquisition design; the
per-inference-call multi-pose accuracy/latency question the original Risks entry raised is still
open and still needs task 10's A/B, unrelated to this fix.

## Live-browser A/B results (2026-08-15)

Real GPU (`ANGLE Metal Renderer: Apple M4 Pro`, not SwiftShader), Playwright, both existing demo
clips, 3 trials per arm. Two runs: (1) `personOfInterest.enabled: false` baseline, measured once
(unaffected by every subsequent commit in this change, since the disabled path is untouched); (2)
`personOfInterest.enabled: true` measured twice — once at the lazy-creation commit (`1487db7`,
found the catastrophic regression that led to the eager-creation fix) and once at the fixed
commit (`457fa6e`, current). Numbers below are the fixed-commit run against the same baseline.

| | track, baseline (false) | track, fixed (true) | park, baseline (false) | park, fixed (true) |
|---|---|---|---|---|
| totalSamples | 221 / 221 / 221 | 211 / 213 / 213 | 81 / 81 / 81 | 60 / 61 / 61 |
| detectedFrames | 76 / 76 / 75 | 63 / 64 / 64 | 81 / 81 / 81 | 60 / 61 / 61 |
| view confidence | 0.761–0.778 | 0.755–0.782 | 0.070–0.103 | 0.017–0.117 |
| cadence value | 93.6 / 94.8 / 93.6 | 91.2 / 92.4 (×2) | 180 / 180 / 181.2 | 176.4 (all 3) |
| cadence tier | T1 (High), all 3 | T1 (High), all 3 | T2 (Medium), all 3 | 2× T2, 1× T1 |
| verticalOscillation | 0.170–0.184 | 0.162–0.174 | 0.232–0.237 | 0.223–0.231 |

**This is not "no meaningful regression" — it is a real, moderate, measured cost that the catastrophic
pre-fix failure was masking the shape of.** Detected-frame count and total-sample count both drop
under `enabled: true`: track loses ~16% of detected frames and ~4% of samples; park loses ~25% of
both (park's sample and detected-frame counts track together, meaning detection quality among what
gets sampled stays high — the cost is fewer real-time frames processed at all during the clip's fixed
wall-clock duration, not more failed detections). Metric *values* stay close (cadence within ~2-3%,
verticalOscillation within ~3-5%) and confidence *tiers* mostly hold (track stays T1 both ways; park
is T2 at baseline and T2-or-better after, never degrading). The mechanism is the acquisition dispatch
on frame 1 of every run plus periodic re-verification every `REVERIFICATION_INTERVAL_FRAMES` calls —
both do real inference work that competes with `sampleClip.ts`'s real-time sampling loop for
wall-clock budget, exactly the cost class the Risks section above already names, now quantified.

This was NOT isolated into settle-window-only vs. re-verification-only contributions (task 10.4's
full ask) — `POST_ACQUISITION_SETTLE_FRAMES`/`REVERIFICATION_INTERVAL_FRAMES` have no runtime
override point (Migration Plan, above), so isolating them would require a temporary code patch this
pass didn't make. The number above is the combined, real, ship-relevant cost.

**Default-on/off call**: ship default-**on**, per the Migration Plan's pre-registered rule (this is
a correctness fix for a live-confirmed bug, not a pure optimization) — confidence tiers hold and the
catastrophic failure mode is closed. The throughput cost above is real and should be weighed by
whoever makes the final ship call, not treated as zero. Task 10.3 (validating against the actual
reported multi-person bug clip) remains open — no such clip exists in this repo or environment yet.

## Open Questions

- Exact scoring constants (proximity-fallback distance multiple, any minimum IoU floor) — decided
  empirically during the A/B in Migration Plan; does not change the requirements or task
  breakdown, only the tuned values within them.
