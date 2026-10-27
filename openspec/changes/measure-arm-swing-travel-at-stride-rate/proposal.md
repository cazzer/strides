# Measure arm swing as per-stride travel, at the stride rate, from the near arm side-on

## Why

`armSwingAmplitude` reads lowballed (user report, 2026-10-27; RCA on `strides-eiil`). The RCA
refuted the obvious suspect — "it only measures the vertical component" (the front clip's
horizontal fit is SMALLER, 0.089/0.094 torso, than its vertical one) — and found three independent
measurement defects instead, each of which the user approved fixing:

1. **The search band is the hip-bounce band, not the arm-swing band** (`strides-eiil.1`). The
   per-side fit searches `spectralFitMin/MaxFrequencyHz` = 1.2–4.0 Hz — the STEP band. Arm swing runs
   once per STRIDE, at half the step rate, so any runner below 144 spm swings their arms below the
   grid floor, and a retimed (slow-motion) clip — `park-side-portrait.mp4`, ~7× — puts the swing at
   ~0.2 Hz where no candidate exists. A 2× step-rate component is also always a candidate.
2. **The reported number is the fundamental's peak-to-peak, not the wrist's travel**
   (`strides-eiil.2`). A real arm-swing trace is not a sinusoid; the fundamental of a
   cusp-or-plateau-shaped swing carries ~55–75% of the visible range (front clip right arm:
   fitted 0.159 torso vs a detrended visible range of 0.218–0.300 torso). The fit is the right tool
   for finding the rhythm and gating on it; it is the wrong statistic to publish as "how far your
   wrists travel".
3. **Side view is hard-gated away** (`strides-eiil.3`). Side footage shows the sagittal swing best,
   but the both-arms mean requires the far arm, which is occluded side-on: `park-side-landscape`
   nulls because the far arm fits at R² 0.185 while the near arm fits at R² 0.728. And the
   inter-shoulder scale proxy is foreshortened side-on (median 37 px, p5 5 px on side-landscape),
   so it cannot stabilize a side clip's scale.

## What Changes

- **Stride-rate search band.** Each side's fit searches `[0.8, 1.2] × strideHz` in steps of
  `0.02 × strideHz`, where `strideHz` is half the clip's hip-bounce frequency (`analyzeHipBounce`,
  including its sub-floor retimed-clip pass), trusted only when that fit clears `cadenceMinFitR2`.
  No such anchor → `null` with a caveat naming the missing running rhythm.
- **Per-stride travel.** The reported per-side size is the median, over complete stride-length
  windows, of the max−min of the trend-removed, 3-point-median-filtered scale-stabilized series.
  Gating stays on the fundamental's R². `spectralFit.ts` gains one additive helper,
  `fitTrendAtFrequency`; no existing function or return type changes.
- **Side view reads the near arm.** On a `'side'` clip the arm with strictly more directly-detected
  frames is the measured arm; its series is scale-stabilized by per-frame torso length rather than
  shoulder span; the far arm cannot null the reading. `viewFitTable.armSwingAmplitude.side` becomes
  `{ fit: 'tolerated', multiplier: 0.6 }` (was `unsuitable`, 0.1). A detected-count tie falls back to
  the both-arms rule. Front/ambiguous keep the both-arms mean, the cross-side rhythm check and the
  shoulder-span stabilizer.
- `metricDescriptions.ts` copy: "averaged across both arms when filmed from the front, or the near
  arm alone when filmed from the side".

## Capabilities

### Modified Capabilities

- `form-heuristics`: arm swing amplitude's value definition, search band, side-view policy and
  scale proxy.

## Impact

- `src/heuristics/spectralFit.ts` (additive helper), `armSwing.ts`, `armSwingAmplitude.ts`,
  `types.ts` (view-fit row + docs), `src/results/metricDescriptions.ts`, their tests.
- User-visible: the fused 3-clip demo's arm-swing reading is expected to move from the front clip's
  0.234 to a side clip's ~0.5–0.6 (side wins the fusion at 0.6 vs front's lower confidence). The
  runner-tour presentation of that number is `strides-eiil.4`, out of scope here.
- Not touched: `fuseHeuristics.ts`, `focusAreas.ts`, `src/results/tour|summary`, `src/runner/**`,
  the vertical-oscillation family, `bounceSpectrum.ts`, `hipBounce.ts`, and the behavior of every
  existing `spectralFit.ts` export. Every non-arm metric is required to be bit-identical.
