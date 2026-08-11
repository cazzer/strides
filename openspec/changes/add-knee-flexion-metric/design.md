## Context

Issue #19 (parent: #16, partial) asks for a fourth `form-heuristics` metric: hip-knee-ankle joint
angle ("knee flexion"), both legs, from the existing `left_hip`/`left_knee`/`left_ankle` and
right-side keypoints — already present in every `RobustPoseFrame` via `COMMON_KEYPOINT_NAMES`, no
pipeline changes needed. The issue is explicitly labeled `plan:architect` and calls out that this
metric needs a design decision the other three didn't: vertical oscillation's amplitude and trunk
lean's angle are already single per-clip numbers by construction (a bounce amplitude, a rigid
torso-vector angle), but a hip-knee-ankle angle is defined *per frame*, and the knee angle changes
continuously through a gait cycle — from near-full-extension at footstrike/midstance to
maximally-bent during swing. Reporting "the angle" without picking a representative statistic
would be reporting whatever frame happened to be sampled, which isn't a meaningful clip-level
number. This document makes that decision and states why, per the issue's request.

This change is purely additive to the existing `form-heuristics` capability (see
`openspec/specs/form-heuristics/spec.md` and its originating design doc, archived at
`openspec/changes/archive/2026-08-10-form-heuristics/design.md`, for the shared primitives and
conventions this reuses: `resolvePoint`, `findLocalExtrema`, `computeMetricConfidence`, the
median-based aggregation trunk lean/overstriding already use, and the "never a silent wrong
number" view-gating policy).

## Goals / Non-Goals

**Goals:**

- Pick one defensible, documented representative statistic for "knee flexion" per clip, reusing
  the existing extrema-finding and confidence machinery rather than inventing new per-metric
  infrastructure.
- Match the existing metric-module shape (`compute<Metric>(frames, view, config) => MetricResult`)
  exactly, so it's wired into `computeFormHeuristics`/`MetricsPanel` the same way the other three
  are.
- Report a value that reads correctly against its own name: "knee flexion" should get *larger* as
  the knee bends *more*.

**Non-Goals:**

- Explicit stance/swing-phase segmentation (e.g. via footstrike detection). Overstriding already
  does footstrike detection for its own purposes; duplicating or importing that machinery here is
  out of scope — see Decisions below for why a simpler prominence-threshold approach avoids needing
  it.
- Per-leg left/right asymmetry reporting. `MetricResult` carries one `value`; a future
  arm-swing-symmetry-style "per-leg breakdown" metric is a distinct, separate concern (and
  explicitly parallel/out of scope per the ticket's boundaries).
- Any change to the pipeline, keypoint set, or robustness layer — all three keypoints per leg
  already flow through unchanged.

## Decisions

### Reported value: median swing-phase peak flexion, pooled across both legs

**The decision:** for each leg independently, convert the per-frame hip-knee-ankle interior angle
into "degrees of flexion from full extension" (`180° - interior angle`), run the same
gap-aware, prominence-thresholded extrema scan (`findLocalExtrema`) overstriding already uses for
footstrike detection over that per-leg flexion-degrees series, keep only the local **maxima**
(each one a leg's most-bent instant for one stride), pool the maxima from both legs into one list,
and report the clip's `value` as their **median**.

**Why peak flexion, not average-over-the-clip or stance-phase flexion:**

- A running-form assessment of "knee flexion" colloquially means "how much does the knee fold up
  during the leg's recovery" — the number physios and coaches actually reference (e.g. "adequate
  peak knee flexion during swing" as a heel-whip/hip-flexor/stride-efficiency signal). A plain
  time-average over the whole gait cycle would dilute that meaningful peak with the much longer
  stance-phase portion of the cycle where the knee stays close to extension, producing a number
  that under-represents the swing motion runners and coaches actually care about.
- Stance-phase flexion (the small bend during weight-acceptance/loading response) is a real, but
  much smaller and physiologically different, signal — shock absorption, not limb recovery. Mixing
  the two into one number would conflate two different biomechanical events.

**Why this doesn't need explicit footstrike/phase detection, unlike overstriding:**

Overstriding needs to know precisely *when* the foot strikes to measure the ankle-hip offset at
that instant. Knee flexion doesn't need that precision: swing-phase peak flexion is, by a wide
margin, the single largest excursion in the per-leg flexion-degrees series over a full gait cycle
(recreational-runner peak swing flexion is commonly cited in the 90-130° range, versus a
stance-phase loading-response dip of roughly 15-20°). Choosing
`kneeFlexionMinProminenceDegrees` (default `20°`) comfortably above the stance-phase ripple but
well below the swing-phase excursion means the zig-zag prominence scan absorbs the small
stance-phase wiggle as noise and reports exactly one confirmed maximum per leg per stride — the
swing-phase peak — without any separate phase-boundary logic. This is the same kind of
"prominence threshold does the phase-isolation work implicitly" trick vertical oscillation and
overstriding already rely on, just tuned to a different (and here, scale-free) signal.

**Why median, not mean, and why pooled across both legs into one number rather than reported per
leg:**

- Median-of-samples is the aggregation convention this codebase already uses for trunk lean
  (median lean angle) and overstriding (median overstride ratio), for the same reason each time: a
  single badly-tracked cycle shouldn't drag a mean-based estimate away from the runner's typical
  value.
- `MetricResult` is a single-value contract (matching every other metric here); a left/right
  breakdown is a legitimate future metric in its own right (symmetric to how arm-swing-symmetry is
  already a separate, parallel ticket rather than folded into an existing metric) but is
  out-of-scope here. Pooling both legs' peaks into one median is the simplest choice that still
  produces one honest clip-level number without inventing a left/right-averaging policy that isn't
  asked for.

**Why "degrees of flexion from full extension" rather than the raw interior joint angle:**

The raw hip-knee-ankle interior angle is ~180° for a straight leg and *decreases* as the knee
bends — so reporting it directly would mean a metric named "knee flexion" reads as *smaller* when
there's *more* flexion, an inverted scale relative to the metric's own name. Subtracting from 180°
(`flexionDeg = 180 - interiorAngleDeg`) flips this so `0°` means straight and larger values mean
more bent, matching both the metric's name and the common biomechanics convention for reporting
"degrees of flexion."

**Alternatives considered:**

- *Report the raw interior angle instead of `180 - angle`.* Rejected: correct geometry, but an
  inverted, confusing scale for a metric literally named "flexion" (see above).
- *Detect stance phase via footstrike extrema (like overstriding) and report the flexion trough at
  midstance, or report both a stance and a swing number.* Rejected as unnecessary complexity: it
  would require importing/duplicating footstrike-detection logic for a distinction the prominence
  threshold already resolves implicitly (see above), and the issue asks for one representative
  value, not a stance/swing pair.
- *Report per-leg values (left/right) instead of pooling.* Rejected for this ticket: doubles the
  `MetricId`/`MetricResult` surface for a breakdown nobody asked for yet; left as a natural future
  extension (see Non-Goals).
- *Simple time-average (mean) of the raw per-frame angle across the whole clip.* Rejected: dilutes
  the swing-phase signal with the much longer near-straight stance/mid-swing portions of the cycle,
  producing a number that doesn't track what "peak knee flexion" means in practice.

### No `estimateBodyScale`/torso-length normalization for the value itself

Unlike overstriding (a ratio: offset ÷ torso length) or vertical oscillation (a ratio: bounce ÷
torso length), the angle *value* knee flexion reports is already scale- and camera-distance-
independent — three points' interior angle doesn't change if the whole skeleton is scaled up or
down in the image. `computeKneeFlexion` therefore does not call `estimateBodyScale` at all: the
`kneeFlexionMinProminenceDegrees` prominence threshold is expressed directly in degrees (already
scale-free), rather than as a torso-length-relative ratio like `verticalOscillationMinProminenceRatio`
or `footstrikeMinProminenceRatio`. View detection still runs exactly as it does for every other
metric (`computeFormHeuristics` calls `detectView` once, upstream, and passes the result in) —
because the *view* still determines whether the angle is trustworthy (a front view foreshortens
the hip-knee-ankle plane toward a degenerate reading) even though the *value* itself needs no
px-to-ratio conversion.

### No travel-direction dependency

Trunk lean and overstriding are directional quantities (forward lean vs. backward, foot ahead of
vs. behind the hip) and need `estimateTravelDirection` to assign a correct sign; an indeterminate
direction degrades their confidence. Knee flexion is not directional — a bent knee reads the same
magnitude regardless of which way the runner is moving across the frame — so
`computeKneeFlexion` never calls `estimateTravelDirection` and omits `travelDirectionKnown` from
its `computeMetricConfidence` call (defaulting to the irrelevant/`1` case), the same way
`computeVerticalOscillation` already does for the same reason.

### View gating: hard-gated to side view, matching trunk lean/overstriding

`viewFitTable.kneeFlexion` uses the same `{ side: primary/1.0, front: unsuitable/0.1, ambiguous:
unsuitable/0.2 }` shape as trunk lean and overstriding, not vertical oscillation's tolerant
`0.85`/`0.6`. The hip-knee-ankle angle is a sagittal-plane quantity: viewed face-on, the leg's
fore-aft swing collapses toward the camera axis and the apparent 2D angle no longer reflects the
true 3D joint angle — the same foreshortening problem that makes trunk lean and overstriding
unreliable front-on, not the milder "same quantity, noisier" case vertical oscillation tolerates.
Per the capability's existing "never a silent wrong number" policy, the value is still computed
and returned in `'front'`/`'ambiguous'` views — never substituted with `null` purely for view
unsuitability — with confidence capped low by the multiplier and a caveat attached instead.

### New shared primitive: `angleBetweenVectorsDeg` in `mathUtils.ts`

`mathUtils.ts` had no existing angle helper (`median`, `mean`, `percentile`, `distance`,
`clamp01` only). A three-point joint-angle formula is a generic geometry primitive, not specific
to knee flexion — a plausible future joint-angle metric (elbow, hip) would need the identical
computation — so it's added to the shared file rather than inlined in `kneeFlexion.ts` or
duplicated per future metric. It's atan2-based (two `atan2` calls plus a wrapped subtraction)
rather than the law-of-cosines/`acos` form, matching the atan2 style `trunkLean.ts` already uses
for its own angle computation, and avoiding `acos`'s precision loss near ±1 — exactly where a
near-straight or near-fully-folded joint would need it most.

## Risks / Trade-offs

- **`kneeFlexionMinProminenceDegrees = 20°` is a reasoned default, not validated against real
  running footage** — same caveat the original `form-heuristics` design doc attaches to every
  other threshold it introduced (`footstrikeMinProminenceRatio`, `verticalOscillationMinProminenceRatio`,
  etc.). It is exposed on `HeuristicsConfig` specifically so it's cheap to retune once real footage
  is available, without touching the algorithm. If real swing-phase excursions turn out smaller
  than assumed here (e.g. a very short, shuffling stride), this threshold could under-detect
  peaks — reflected honestly in a low `sampleSize` and discounted confidence, not a crash or a
  fabricated value, consistent with the capability's existing "bounded but real approximation"
  pattern for `footstrikeMinProminenceRatio`.
- **No stance/swing-phase ground truth.** As discussed in Decisions, the prominence threshold is a
  proxy for phase isolation, not an explicit footstrike-anchored phase boundary. A pathological
  gait with an unusually large stance-phase ripple, or an unusually small swing-phase excursion,
  could in principle be misclassified — this is the same class of bounded approximation the
  original design doc already accepts for the ankle-extremum footstrike proxy.
- **Pooling both legs into one median** hides left/right asymmetry, which could itself be
  clinically relevant (e.g. an injury-compensating gait). Explicitly deferred — see Non-Goals — as
  a distinct future metric rather than smuggled into this one's aggregation.

## Migration / Rollout

Purely additive to the existing `form-heuristics` capability — one new metric module, one new
shared math primitive, and the corresponding `MetricId`/`FormHeuristicsResult`/`viewFitTable`
extensions. No existing metric's behavior changes; existing `FormHeuristicsResult` consumers
(tests, `MetricsPanel`) need their fixtures extended with the new required field, but nothing
about the other three metrics' computation or output changes.
