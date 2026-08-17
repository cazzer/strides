## Context

`stepWidth` reports, at each footstrike, how far laterally the landing foot sits from the body's
midline (hip-mid), as a fraction of hip width. The entire point of the metric is to surface
crossover gait — a foot landing at or past the midline instead of under its own hip — as a
negative number, distinguishable from a wide-but-symmetric stance (positive, still own-side).
Getting the sign wrong doesn't just produce a cosmetically-flipped number: it can silently erase
the one signal the metric exists to report.

## Decision: sign is resolved per-footstrike from that frame's own-side hip, not a clip-wide constant

**The naive approach** — `dx = ankle.x - hipMid.x`, taken as-is and combined (e.g. medianed) across
both legs' footstrikes — fails for a structural reason, not an edge case:

In ordinary (non-crossover) running, the left ankle lands to the LEFT of hip-mid (`dx < 0`) and the
right ankle lands to the RIGHT of hip-mid (`dx > 0`). Both are equally "correct, own-side"
footstrikes, but their raw `dx` values have opposite sign. Combining them directly — a median
across all footstrikes regardless of leg — averages a negative number with a positive number of
similar magnitude, landing near zero **for any symmetric gait, wide or narrow**. The metric would
report "no width" (0%) as its steady-state answer regardless of how wide or narrow the runner
actually strides, and a genuine crossover on one leg would be invisible, swamped by the other leg's
opposite-sign, non-crossover footstrikes.

**The fix**: normalize sign per-footstrike using that same frame's own-side hip position relative
to hip-mid:

```
outwardSign = sign(sideHip.x - hipMid.x)   // which side of the midline this leg's OWN hip sits on
offsetRatio = (ankle.x - hipMid.x) * outwardSign / hipWidthPx
```

For the left leg, `sideHip.x - hipMid.x` is negative (the left hip sits left of the midline), so
`outwardSign = -1`; an ankle that also lands left of the midline (`dx < 0`) yields `dx *
outwardSign > 0` — positive, "own side." For the right leg, the sign of `sideHip.x - hipMid.x` is
positive, so an ankle landing right of the midline (`dx > 0`) also yields positive. Both legs'
ordinary footstrikes now read as positive, and only an ankle that crosses to the OPPOSITE side of
its own hip's baseline reads negative — the actual crossover signal, with a consistent sign
regardless of which leg produced it.

## Proof the naive approach isn't merely biased, but structurally invariant to the crossover input

Before settling on the fix, the naive approach's failure was verified analytically and then
empirically, using the existing `generateSyntheticGait` front-view fixture as a worked example
(hip half-width 65px in that fixture's front-view geometry, ankle lateral sway
`strideAmplitudePx * FRONT_VIEW_ANKLE_SWAY_FACTOR` at footstrike):

- Left leg's own footstrike always coincides with `sin(leftPhase) = 1` (that fixture's "ankle-y
  maximal exactly at peak forward/lateral sway" construction), giving a raw offset of
  `ankleSwayAmplitude - 65`.
- Right leg's own footstrike always coincides with `sin(rightPhase) = 1` too (opposite contralateral
  phase, same construction), giving a raw offset of `ankleSwayAmplitude + 65`.
- Averaging the two (roughly equal candidate counts from both legs, by construction): `((A - 65) +
  (A + 65)) / 2 = A` — but taking the SIGNED sign-flip into account (see below) the un-flipped
  median of the two raw ratios is `((A-65) + (A+65)) / (2 * 130) = A / 130`, which is *positive for
  every A ≥ 0*, including values of `A` far past the 65px crossing threshold.

This means no amount of "exaggerating `strideAmplitudePx`" in the shared fixture can ever push a
naively-combined median negative — the two legs' opposite raw signs always average back toward the
same positive quantity, invariant to the amplitude that was supposed to trigger crossover. This was
confirmed numerically (a small Node script reproducing the fixture's geometry) before being ruled
out as this metric's implementation, and is why `stepWidth.test.ts`'s crossover-gait test case does
NOT reuse `generateSyntheticGait` with an exaggerated `strideAmplitudePx` — that fixture's shared
contralateral-phase model structurally cannot produce a negative combined value regardless of
amplitude, for the same reason the naive computation itself cannot. The test instead uses a small
bespoke frame generator (`buildStepWidthFrames`, in `stepWidth.test.ts`) with an *independent* sign
convention per leg — `+crossAmplitudePx * sin(leftPhase)` for the left ankle,
`-crossAmplitudePx * sin(rightPhase)` for the right — so that both legs can be pushed toward
crossover by the same scalar parameter, which is what an exaggerated real crossover gait actually
looks like (both feet swinging toward, not away from, the midline).

## Alternatives considered

- **Sign from a clip-wide `travelDirection`-style constant** (as `overstriding.ts` uses for its
  own fore-aft sign). Rejected: `travelDirection` resolves a fore-aft (direction-of-travel)
  ambiguity, a different axis entirely from the mediolateral (side-to-side) axis this metric reads.
  A travel-direction sign has no defined relationship to "which side of the midline is this leg's
  own side" — reusing it would be a category error, not just an inferior heuristic. `stepWidth.ts`
  has no dependency on `travelDirection.ts` for exactly this reason (also called out directly in
  the issue text).
- **Report unsigned magnitude only** (`abs(dx) / hipWidthPx`), leaving crossover detection to a
  separate boolean. Rejected: this is the issue's stated purpose inverted — the acceptance
  criteria explicitly want the crossover read as sign, and computing the correctly-signed value is
  no harder than computing the magnitude once the per-footstrike own-side hip is already being
  resolved (it's already needed to compute `hipWidthPx`'s bilateral pair, and resolving one
  additional single-side point per footstrike is cheap).
- **A "crossed midline" boolean/caveat as a fully separate computation.** The issue's own notes
  call this "nearly free once the signed offset exists (just a sign check)" — implemented as a
  caveat line (`value < 0` → crossover-gait caveat text) rather than a second computed field, since
  a boolean derivable in one line from an already-returned signed value doesn't earn a new
  `MetricResult`-shaped output of its own.

## View-fit gating: mirrors `armSwingSymmetry`, not `verticalOscillation`

`stepWidth` is a mediolateral measurement — the opposite view-tolerance from every sagittal-plane
metric in this package (`trunkLean`, `overstriding`, `kneeFlexion`). A side-on camera looks
straight along the axis this metric reads (foot offset from the hip midline), collapsing it toward
a degenerate reading — the same failure mode `armSwingSymmetry` has (a side view occludes/
superimposes the far arm), even though the underlying reason differs (occlusion for arm swing vs.
axis-collapse for step width). Both land on identical numbers: front/rear primary (`1.0`), side
unsuitable (`0.1`), ambiguous unsuitable (`0.2`) — reused verbatim from `armSwingSymmetry`'s row
rather than re-derived, per the issue's explicit instruction to mirror that row and not
`verticalOscillation`'s.

## Unit: `'percent'`, not `'ratio'`

`MetricsPanel.tsx`'s `formatValue` hard-codes a "% of torso length" suffix for the `'ratio'` unit.
Step width's denominator is hip width, not torso length — reusing `'ratio'` would render a
correct number with an incorrect, misleading unit label. `verticalRatio` established the
`'percent'` precedent for exactly this situation (a dimensionless ratio whose denominator isn't
torso length); `stepWidth` follows it. Since `'percent'`'s formatting is a bare `NN.N%` with no
denominator named at all, `METRIC_DESCRIPTIONS.stepWidth` is the only place either the hip-width
denominator or the sign convention is stated to the user.
