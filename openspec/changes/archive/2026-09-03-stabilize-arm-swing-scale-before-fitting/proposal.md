# Proposal — stabilize-arm-swing-scale-before-fitting

## Why

Beads `strides-egw` (scale-stabilize the arm-swing input series) and `strides-ax3` (reword the
fit-disparity caveat), both grounded in the `strides-101` root-cause probe.

`computeSideSwing` (`src/heuristics/armSwing.ts`) fits `fitSpectralSinusoid` to the raw
`wrist.y − shoulder.y` pixel series. The fit's model is a CONSTANT-amplitude sinusoid over a
polynomial trend — and the wrist-relative-to-shoulder excursion is a body-proportioned quantity,
so its pixel amplitude scales with the subject's on-screen size. On Demo 2, this metric family's
primary clip, the inter-shoulder span grows from ~120 px to ~358 px inside the fit window: the
raw-pixel least squares weights the late large-scale frames roughly 9:1 over the early ones, so
each side's "amplitude" is mostly a reading of the clip's end, and the residual amplitude mismatch
depresses both sides' R² — the weaker side (right, 0.497) sits just above the 0.30 gate for a
reason that is partly the estimator's own premise violation rather than the footage.

Separately (`strides-ax3`), the fit-disparity caveat says one arm was "tracked noticeably
better" — but the disparity trigger is a FIT-quality gap (`sinusoidR2` difference), not a
tracking-coverage gap. On Demo 2 the right wrist is detected in MORE frames than the left (98/99
vs 95/99); what differs is how cleanly each trace fits the swing rhythm. The caveat should say
what was actually measured.

## What Changes

- **`computeSideSwing` divides each sample by a per-frame scale factor before the fit**
  (`src/heuristics/armSwing.ts`, new private `resolveScaleStabilizer`): the factor is
  `exp(trend(t)) / referencePx`, where `trend` is a whole-window least-squares quadratic of
  `log(interShoulderSpanPx)` in time-centered coordinates and `referencePx` is the median of the
  measured per-frame spans. The proxy is resolved STRICTLY bilaterally (`resolveBilateralPair`,
  never `resolveMidpoint`'s single-side fallback — a fabricated length is this repo's recorded
  fabricated-scale bug class). The stabilized series stays in px, at the clip's reference scale.
- **Fallback ladder, every rung an EXACT no-op** (constant factor 1): fewer than
  `MIN_SCALE_TREND_SAMPLES` (12) frames with a usable bilateral proxy; an unsolvable trend
  system; a fitted trend flat to within a degeneracy floor (what keeps a constant-scale clip
  bit-identical to the raw-pixel computation — see design.md D3); a non-finite/non-positive
  factor at evaluation. No clamp on `f(t)` otherwise.
- **Invariants**: `seriesY`'s null pattern, `resolvedCount` and `interpolatedCount` are
  unchanged — the trend evaluates at every timestamp, so a missing proxy never drops a swing
  sample; only sample VALUES change. Sign convention preserved (positive divisor), so
  `maximumIs: 'lowest'` and every caption stay truthful.
- **No new config key, no gate changes**: the stabilization is unconditional estimator
  correctness. `MIN_ARM_SWING_CYCLES`, `FIT_QUALITY_SATURATION_R2`,
  `MAX_SIDE_FREQUENCY_DISAGREEMENT`, `SIDE_FIT_QUALITY_DISPARITY_R2`, `armSwingMinFitR2` and the
  shared-gate-policy structure are untouched. `spectralFit.ts`, `bounceInstants.ts`,
  `bodyScale.ts`, `keypoints.ts`, `types.ts` untouched.
- **`armSwingAmplitude` semantics unchanged**: the per-side amplitudes arrive at the clip's
  reference (median) scale, pairing naturally with the clip-MEDIAN torso normalizer — same
  `mean / (2·torsoLengthPx)` recipe, same `'ratio'` unit.
- **Caveat rewording (`strides-ax3`)**: both fit-disparity caveats now open with "One arm's
  swing rhythm fit its trace much less cleanly than the other's in this clip" — naming the fit
  disparity that actually fired the caveat, keeping each metric's own tail (difference-between-
  them vs overall-swing-size).

## Impact

- Affected specs: `form-heuristics` (MODIFIED ×4: the symmetry definition requirement gains the
  stabilization and a growth scenario; the worse-measured-arm confidence requirement and the
  amplitude metric requirement carry the reworded caveat; the exemplar-pair requirement's series
  description is now scale-stabilized).
- Affected code: `src/heuristics/armSwing.ts` (the stabilizer + docs),
  `src/heuristics/armSwingSymmetry.ts` (caveat string + doc), `src/heuristics/armSwingAmplitude.ts`
  (caveat string + doc), both metrics' test suites (growth fixture knob, mechanism/fallback/no-op
  cases, caveat substrings).
- Expected live drift (design.md D5): Demo 2 `armSwingSymmetry` 0.6066 → ~0.518 (verified
  offline against the strides-101 probe dump: 0.51834), `armSwingAmplitude` down ~7%,
  `armSwingCycle` exemplar instants may move a frame or two. Demo 1/multiperson arm-metric
  internals may drift but their tier-3 EXCLUDED status must not change; every non-arm metric on
  all three clips bit-identical; the standing anchors hold.
- Not in scope: any change to gates/thresholds, `spectralFit.ts`, evidence modules, view
  detection, or a config override plane for the stabilizer.
