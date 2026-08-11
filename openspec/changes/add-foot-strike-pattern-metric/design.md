## Context

Issue #21 (parent: #16, partial; labeled `plan:architect`, no separate planning pass — this
document is that design decision) asks for a foot strike pattern indicator: heel / midfoot /
forefoot. The `form-heuristics` capability (`openspec/specs/form-heuristics/spec.md`) already
established the shape every metric here follows — `RobustPoseFrame[]` in, a view-gated
`MetricResult` out, `estimateBodyScale`'s torso length as the universal normalizer, and
`detectFootstrikes` (extracted from `overstriding.ts` in #17) as the shared "when did a foot
plant" primitive. `overstriding.ts`'s `extractFootstrikes`/footstrike-detection doc comment is
explicit about the relevant gap: **there is no foot/toe keypoint and no ground-plane calibration
anywhere in this pipeline** — the 12-keypoint set from #3 stops at the ankle. That doc comment
already treats "ankle lowest on screen" as a bounded, explicitly-flagged proxy for ground contact,
not a real measurement of it. This change inherits exactly that same gap, one level up: a true
foot-strike-pattern classification needs the foot's angle relative to the ground at the instant of
contact, and nothing in this pipeline can see that.

## Goals / Non-Goals

**Goals:**

- Decide and document one concrete, reasoned proxy for foot strike pattern from the keypoints this
  pipeline actually has (shoulders, hips, knees, ankles — no feet, no toes, no ground plane).
- Reuse `detectFootstrikes`, `estimateBodyScale`, and `estimateTravelDirection` as-is — this change
  adds no new footstrike-timing or body-scale logic, only a new per-footstrike measurement and
  classification on top of the existing shared primitives.
- Make the proxy's limitation impossible to miss: a `caveat` that is non-null on every returned
  `MetricResult` from this metric, including the cleanest, highest-confidence one — not just the
  degraded-case pattern every other metric in this package uses.
- Surface that same caveat in the UI (`MetricsPanel`), not just in code comments or the spec.

**Non-Goals:**

- A real, validated heel/midfoot/forefoot classification — explicitly out of reach without a
  foot/toe keypoint and ground-plane calibration, both out of scope for this pipeline entirely
  (same non-goal `form-heuristics`'s own design.md already recorded for ground-plane calibration
  generally).
- Empirically validating `footStrikeMidfootBandRatio` (or any other constant introduced here)
  against real running footage or a clinical gait-lab reference — a reasoned default, explicitly
  flagged as needing that validation later, matching every other threshold in this package.
- Stance-phase duration, toe-off detection, or any gait event beyond the footstrike instant
  `detectFootstrikes` already locates.
- Changing `detectFootstrikes`, `estimateBodyScale`, `estimateTravelDirection`, or any existing
  metric's behavior.

## Decisions

### The proxy: ankle position relative to the knee, at each footstrike, signed by travel direction

At each footstrike candidate from `detectFootstrikes` (same-side ankle-y local maximum, already
deduped by `footstrikeMinIntervalSeconds`), resolve that side's ankle and knee position in the
same frame. Compute:

```
dx = ankle.x - knee.x
signedOffsetPx = travelDirectionKnown ? dx * travelDirection : dx
ratio = signedOffsetPx / torsoLengthPx
```

`ratio` is positive when the ankle sits ahead of the knee in the direction of travel (heel-strike-
like: the shank is angled forward, foot reaching out ahead of the body), near zero when the ankle
is roughly under the knee (midfoot-like), and negative when the ankle sits behind the knee
(forefoot-like: greater plantarflexion/knee flexion tends to land the foot closer to, or slightly
behind, the knee's vertical). The reported `MetricResult.value` is the **median** `ratio` across
all usable footstrikes — median, not mean, for the same single-noisy-strike robustness reason
`overstriding.ts` already uses. This is a continuous, signed, torso-normalized ratio — structurally
identical in shape to `overstriding`'s own value, not a special encoding.

### Why the knee, not the hip

The issue text offers both ("ankle position relative to the knee (or hip)"). `overstriding.ts`
already measures ankle-relative-to-**hip** for a related but distinct purpose (how far the foot
reaches out ahead of the body's center of mass — a braking-force proxy). Reusing hip-relative
offset here would make foot strike pattern almost linearly redundant with overstriding: both would
be dominated by the same "how far forward is the leg swinging" signal, just scaled differently.

Ankle-relative-to-**knee** is a materially different, and biomechanically closer, signal: it
approximates **shank angle** at footstrike — how vertical or angled the lower leg is at the
instant of ground contact — which is a much closer analog to what a real heel/midfoot/forefoot
classification actually depends on (foot-ground angle is highly correlated with shank angle, since
the ankle joint's range of motion is bounded). The trade-off is that knee tracking is noisier than
hip tracking in most pose estimators (a smaller, more articulated joint, more prone to occlusion by
the swinging leg itself) — accepted here the same way `overstriding.ts` already accepts noisier
ankle tracking than hip tracking for its own footstrike-prominence threshold, and reflected
honestly through the same `interpolatedFraction`/`frameCoverage` confidence machinery every metric
here uses.

Torso length (not shank length) remains the normalizer, for the same circularity reason
`form-heuristics`'s own design.md already gives for rejecting leg length generally: shank length is
itself modulated by knee flexion during the same gait cycle being measured, so normalizing by it
would be quietly circular. Torso length stays a stable, independent reference.

### Classification bands: symmetric, `footStrikeMidfootBandRatio = 0.05`

```
ratio >  +footStrikeMidfootBandRatio  ->  'heel'
ratio <  -footStrikeMidfootBandRatio  ->  'forefoot'
otherwise (|ratio| <= footStrikeMidfootBandRatio)  ->  'midfoot'
```

`footStrikeMidfootBandRatio` defaults to `0.05` (5% of torso length) and is exposed on
`HeuristicsConfig`, matching every other threshold in this package. Two choices worth calling out:

- **Symmetric around zero**, rather than an asymmetric split (e.g. a wider "heel" zone and a
  narrower "forefoot" zone, which could arguably better match real gait-lab distributions). There
  is no empirical or clinical reference available anywhere in this pipeline to justify a particular
  asymmetry — inventing one would be false precision dressed up as biomechanical nuance. A
  symmetric band around "ankle vertically under the knee" is the simplest, most defensible reading
  of "notably ahead" vs. "roughly under" vs. "notably behind" available from first principles, and
  it's honest about being a first-principles guess rather than a fitted threshold.
- **`0.05`, not smaller or larger.** A typical adult torso length (shoulder-mid to hip-mid) is
  roughly 45-55cm, of which 5% is roughly 2-3cm — small enough that a genuinely near-vertical shank
  at footstrike reads as midfoot rather than needing to land exactly at zero, but large enough to
  sit comfortably outside plausible knee-tracking jitter for a keypoint noisier than the hip
  (consistent with `footstrikeMinProminenceRatio` being set higher than
  `verticalOscillationMinProminenceRatio` for the same "ankle-family keypoints are noisier"
  reason). Like every other threshold in this package, this is a judgment call, not a value derived
  from or validated against real running footage — see Risks below.

### `value` stays `MetricResult`'s existing numeric shape; classification lives in a separate pure function

`MetricResult.value` remains `number | null` — the same continuous ratio described above, `unit:
'ratio'` — rather than inventing a `-1/0/1` encoding or a new result type with a categorical field.
Reusing the existing shape keeps every metric in `FormHeuristicsResult` structurally uniform (same
contract every consumer — confidence display, the results panel, future export/comparison
features — already knows how to handle), consistent with how `overstriding`'s own ratio doubles as
both a display value and, via `overstrideFlagRatio`, a threshold-driven qualitative read.

The heel/midfoot/forefoot label itself is a pure derived function, `classifyFootStrike(ratio,
midfootBandRatio)`, exported from `footStrikePattern.ts` rather than computed only internally.
`computeFootStrikePattern` doesn't need the label for anything (it works entirely in `ratio`
space); the results view does, to render a plain-language "Heel strike (proxy)" string. Exporting
the classification function means the UI never re-derives or duplicates the threshold logic — it
calls the same function the metric's own design is built around.

### Hard-gated to side view, same reasoning and multipliers as overstriding/trunkLean

`footStrikePattern` uses the same `viewFitTable` entry shape as `overstriding` and `trunkLean`:
`side: primary (1.0)`, `front: unsuitable (0.1)`, `ambiguous: unsuitable (0.2)`. This measures a
fore-aft (sagittal-plane) quantity — ankle-x relative to knee-x, in the direction of travel — which
a front-facing camera cannot see; front view doesn't just add noise, a front-view ankle-x-relative-
to-knee reflects mediolateral foot placement, a different physical quantity that happens to occupy
the same image axis. That's the same "confidently wrong, not just noisier" failure mode
`overstriding.ts` and `trunkLean.ts` are already hard-gated against, so it gets the same treatment:
still computed and returned (never `null` purely for view-unsuitability), confidence capped low,
caveat stating the view is unsuitable — appended after, not instead of, the proxy caveat below.

### The caveat is unconditionally non-null — a deliberate, single exception in this package

Every other metric in `form-heuristics` builds its `caveats: string[]` starting from `[]` and only
pushes situational messages (indeterminate travel direction, unsuitable view, low sample size),
joining to `caveats.length > 0 ? caveats.join(' ') : null` — so a clean, high-confidence result has
`caveat: null`. `footStrikePattern` starts its `caveats` array from `[PROXY_CAVEAT]` instead of
`[]`, and returns `caveats.join(' ')` unconditionally (never `null`), including from its
`nullResult` helper (which prepends `PROXY_CAVEAT` to whatever situational reason it's already
reporting). This is not an oversight to "clean up" later — it's the direct implementation of the
issue's explicit hard requirement: this metric is a proxy in every case, including its cleanest
one, and the UI must never be able to render a foot-strike-pattern number without its
disclaimer attached. `MetricResult.caveat`'s doc comment in `types.ts` now calls this out as the
one deliberate exception to the field's general "non-null only when degraded" convention.

## Risks / Trade-offs

- **This proxy can be wrong in a specific, documented way**: shank angle at footstrike correlates
  with, but is not identical to, actual foot-ground angle — a runner with unusual ankle mobility or
  an atypical gait could show a shank angle that doesn't match their true strike pattern. This is
  exactly why the caveat is unconditional rather than confidence-gated: a high `confidence` score
  here only means "the ankle-knee offset was measured cleanly," never "this is a reliable
  heel/midfoot/forefoot classification" — those are different claims, and only the first one is
  something this pipeline can actually back up.
- **`footStrikeMidfootBandRatio = 0.05`, like every threshold in `form-heuristics`, is a reasoned
  default, not one validated against real footage or a gait-lab reference.** It's on
  `HeuristicsConfig` specifically so it's cheap to retune once real data is available, without
  touching the algorithm.
- **Knee tracking noise.** Knees are a more occluded, more articulated keypoint than hips, so
  `interpolatedFraction` and `frameCoverage` are expected to run somewhat worse here than for
  `overstriding`'s hip-based offset on the same clip. This is surfaced honestly through the
  existing `computeMetricConfidence` machinery (no new confidence logic introduced), not silently
  absorbed.
- **Redundancy with overstriding.** Both metrics derive from the same footstrike events and the
  same general "how far forward is the leg" signal; a reviewer or future maintainer might ask why
  both exist. They answer different questions (overstriding: braking-force risk via ankle-vs-hip;
  foot strike pattern: shank-angle-proxied strike classification via ankle-vs-knee) and were
  explicitly scoped as separate tickets (#16's children), but the correlation between their values
  is expected and not a bug.

## Migration / Rollout

Purely additive to `form-heuristics` — no existing metric's computation or output changes, no new
runtime dependencies. `computeFormHeuristics`'s return shape grows by one field
(`footStrikePattern`), which is why every existing hand-built `FormHeuristicsResult` test fixture
in `src/results/**` needs that field added to keep compiling; none of those fixtures' existing
assertions about the other three metrics change.
