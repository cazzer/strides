# Design — measure-arm-swing-travel-at-stride-rate

Three serialized fixes to the shared arm-swing measurement (`armSwing.ts`) and its one consumer
(`armSwingAmplitude.ts`), `strides-eiil.1` → `.2` → `.3`. Each is independently measurable; the
live readings after each are recorded in "Measurement" below and in
`docs/agent-notes/mediapipe-front-view.md`.

## D1 — Search the arm swing around the clip's stride rate (`strides-eiil.1`)

**Anchor.** `strideHz = analyzeHipBounce(frames, config).fit.frequencyHz / 2`, valid only when the
fit is `ok` and its `sinusoidR2 ≥ config.cadenceMinFitR2` — the same gate cadence reads the same fit
with, so the arm swing is timed against a rhythm exactly when cadence would trust one. Arm swing
runs once per stride, and the hip bounce once per step, so half the bounce frequency is the stride
rate by construction.

**Grid.** `[0.8 · strideHz, 1.2 · strideHz]`, step `0.02 · strideHz` — 21 candidates at any
playback rate. `ARM_SWING_BAND_HALF_WIDTH = 0.2` is wider than every measured arm-vs-stride gap
(side-landscape 1.40 vs 1.45 Hz, front 1.50 vs 1.51, multiperson left 1.48 vs 1.45) and far below a
2× confusion, so a step-rate component is structurally outside the grid.

**Retimed clips.** `analyzeHipBounce` already runs `fitBounceSpectrum`'s sub-floor pass with its
red-noise null; on `park-side-portrait.mp4` (~7× slow-mo) the bounce is adopted at 0.39 Hz, so the
arm is searched around ~0.195 Hz. The bounce frequency is CLIP time, which is what an amplitude fit
over clip-time samples needs: cadence withholds on `subFloorRhythm` because it reports a real-time
RATE, a reason that does not apply to a spatial amplitude. `slowMotionDetection.ts` stays unwired.

**No anchor → honest null.** "No steady running rhythm was found in this clip, so the arm swing could
not be timed against it." There is deliberately no fallback to the 1.2–4 Hz grid: that grid is the
defect. No demo clip lacks an anchor; a clip with arms but no fittable hip bounce loses a reading it
had before, and that is the accepted cost.

**This is not the rejected "halved band" re-litigated.** `armSwing.ts` recorded (2026-08-29) that a
FIXED halved band (0.6–2.0 Hz) was measured and rejected: both side clips landed on its 0.60 Hz
floor, a grid-edge artifact. That band was fixed; this one is anchored. An anchored ±20% band
around a 1.45 Hz stride cannot offer 0.6 Hz at all. The other half of that record —
`secondPeakRatio` worsening in the halved band — does not transfer either: nothing on the arm path
reads `secondPeakRatio`, and inside a ±20% band it collapses toward 0 by construction (the
exclusion band covers most of the grid).

## D2 — Report per-stride wrist travel, not the fundamental's peak-to-peak (`strides-eiil.2`)

Per side, over the scale-stabilized series and the fit at its winning frequency `f*`:

1. Subtract the quadratic trend fitted JOINTLY with the sinusoid at `f*` (new
   `fitTrendAtFrequency`, the grid loop's own 5-column solve at one frequency) — the same drift the
   fit already refused to charge to the swing.
2. 3-point running median over consecutive usable samples — a spike guard against single-frame
   glitches and left/right label swaps, which a max−min statistic would otherwise report in full.
3. Tile complete windows of length `T = 1/f*` from the first usable sample: `floor(observedCycles)`
   windows (≥ 1 whenever the fit is `ok`).
4. `travelPx` = median over windows of `max − min`; a window with fewer than 3 samples is skipped;
   no window left → `null`.

Gating is unchanged: it stays on the fundamental's partial R², which answers "is there a stride
rhythm here", the question a gate should ask. Only the published SIZE changes.

**The window is one stride, and 2nd-harmonic content inside it is counted on purpose.** D1
guarantees `T` is a stride period. Wrist-minus-shoulder cancels the torso's own step-rate bounce,
so step-rate content left in a stride window is real wrist travel relative to the shoulder. The
retired spec scenario that treated a 2f component as contamination to be fitted around is replaced
by one asserting its travel is counted.

**Known estimator bias, stated rather than corrected.** The 3-point median clips a sampled extremum
to its higher neighbour: for a sinusoid the travel reads low by at most `1 − cos(2π f*/fs)` (fs =
sample rate; 4.9% at 20 samples per cycle, 0.55% at 60), and for a cusp-shaped (triangle) swing by
at most `4 f*/fs`. Tracking jitter biases a range the other way, upward; the per-window median
partially averages both. Neither is corrected for — there is no reference to correct toward.
`buildSideExemplar` still picks its pair from the fundamental's fitted extremes, so the ghosted pair
spans slightly less than the reported travel.

**`spectralFit.ts` stays behaviorally frozen.** `fitTrendAtFrequency(samples, frequencyHz)` is
additive: same filtering/sorting/centering/solver as the grid loop, returning
`{ tMeanSeconds, offset, linear, quadratic }` with `offset = vMean + c`. No field is added to
`SpectralFitSuccess` — `verticalOscillation.ts` passes the whole fit object into diagnostics, so a
new field there would move a non-arm diagnostics row.

**Rejected: a multi-harmonic fit.** A triangle needs harmonics to ~7–9 to come within 5% of its
range — 17–21 parameters over ~100 samples, near Nyquist; three harmonics cap at ~90% on cusp-like
waveforms. A windowed range over the trend-removed series has no such ceiling.

**No cap on travel/fundamental.** The ratio is logged in the agent note per clip instead.

## D3 — Side view reads the near arm (`strides-eiil.3`)

Applies to `view === 'side'` only.

- **Near arm = strictly more directly-detected frames**, `resolvedCount − interpolatedCount` on
  `SideSwing`. The near arm is the one the detector sees; occlusion shows up as interpolation and
  missing frames on the far one. A tie falls back to the both-arms rule (mean, worse-side gates,
  cross-side check) over the same torso-stabilized fits.
- **Gates**: the near arm's R² against `armSwingMinFitR2` and the body-scale reference. The far arm
  can no longer null the reading. No cross-side frequency check — the anchored band (D1) already
  does that job for one arm.
- **Confidence inputs** (coverage, interpolation, observed cycles, fit quality) are the near arm's.
- **Caveat**: "Measured from the near arm only — from the side the far arm is hidden behind the
  body." plus the cycles/steadiness caveats; no disparity caveat (there is no second arm).
  Exemplars: the near arm's only.
- **Scale proxy = per-frame torso length** (`torsoLengthAt`, `bodyScale.ts`), not shoulder span.
  Side-on, the shoulders superimpose: median span 37 px / p5 5 px on side-landscape, 14 px / p5
  3.4 px on side-portrait, where the shoulder-stabilized series' range inflated to 171 px against a
  33 px detrended raw range. Torso length is the pipeline's own side-view-safe normalizer (see
  `estimateBodyScale`'s doc). `torsoLengthAt` resolves midpoints tolerantly; side-on the
  single-shoulder stand-in sits where the midpoint would. The log-quadratic trend, evaluation-time
  clamp and exact-no-op fallback ladder are unchanged and shared by both proxies.
- **View fit**: `side → { fit: 'tolerated', multiplier: 0.6 }` (was `unsuitable`, 0.1) — D6 of the
  original arm-swing design reversed for side only, user approval 2026-10-27. Front stays primary;
  ambiguous stays unsuitable at 0.2 with the both-arms rule and shoulder-span proxy. Fusion code is
  unchanged; at 0.6 the side clip is expected to win the 3-clip demo.

**Rejected:** picking the near arm by `travelDirection` + camera side (MoveNet swaps L/R side-on, so
the label is the unreliable part); picking by R² (selects on the outcome being measured).

**Trade-off stated:** a side-on near-arm reading measures one arm. An asymmetric runner's far arm is
not represented, and nothing in a side clip can say whether it differs.

## Risks

1. Non-arm drift → the live A/B gate requires every non-arm field bit-identical.
2. The user-visible number roughly doubles on the fused demo, sourced from a side clip;
   presentation follows in `strides-eiil.4`.
3. The same runner reads differently front (~0.3) vs side (~0.5): different projections of one
   swing. The view multiplier decides which one the fused session shows.
4. Side-portrait's arm fit spans ~2 cycles of a red-noise-prone low frequency; if its near-arm R²
   lands just above the 0.3 gate it is treated as suspect until keyframes confirm the swing.
5. Near-arm misidentification under L/R swaps → keyframe check.

## Measurement

Filled in from the live A/B (Phase E): see `docs/agent-notes/mediapipe-front-view.md`
"Arm swing at stride rate, per-stride travel, near arm side-on".
