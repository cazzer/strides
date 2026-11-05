## Context

`bounceSpectrum.ts` fits the shared hip-bounce sinusoid in two passes: the in-band grid, then — only
on failure — a disjoint sub-floor grid guarded by an AR(1) red-noise null. Both passes fit the raw
pixel hip-mid series. On a runner approaching a handheld camera that series breaks the fit's model
twice over: the bounce amplitude scales with the runner, and the perspective descent is not
quadratic in time. `IMG_9349` (private) fits 3.08 Hz — the right answer — at partial R² 0.100.

## Goals / Non-Goals

**Goals:** recover cadence and VO on approach clips like `IMG_9349`; leave every clip whose fit is
adopted today bit-identical.

**Non-Goals:** changing `verticalOscillationMinFitR2`, `cadenceMinFitR2`, the frequency grid, the
sub-floor pass, or any caveat; normalizing the metre path; normalizing the charted trace.

## Decisions

1. **A third pass, last.** It runs only when neither prior pass is adopted, so pass 1 is untouched
   (bit-identity for every clip that works today) and pass 2 keeps priority (a retimed clip is
   still reported as retimed rather than "recovered" at some in-band alias). The series is a thunk,
   so it is never built for a clip that does not reach this point.
2. **In-band grid only, same gate.** The pass answers "is there a human-gait rhythm under a
   perspective-distorted trace", not "is the clock wrong". The sub-floor band is where red noise
   lives and has its own null; normalization does not need to be rechecked there. Holding the pass
   to the pass-1 grid and gate means it can only turn a withheld rhythm into one clearing the same
   bar as every other clip.
3. **Integrate normalized deltas, don't divide samples.** Dividing each sample by its local torso
   would rescale the runner's absolute image position: a hip 1000 px down the frame under a doubling
   torso sweeps 500 "normalized" px with no motion at all. A delta divided by the scale at that delta
   carries only the motion. The running sum is multiplied by the clip-median torso so the amplitude
   reads in pixels at the clip's typical scale, which `verticalOscillation` then divides by that same
   median — giving the torso-relative bounce.
4. **Image-y sign kept.** `y[b] − y[a]`, not flipped, so the fitted phase means what it means on the
   raw series and `footstrikes.ts` / `bounceInstants.ts` read it unchanged.
5. **No reset across gaps.** A step spanning missing frames is one normalized delta like any other;
   resetting would inject a step discontinuity the fit would read as trend error.
6. **Local torso = `estimateLocalTorsoLengths` at ±0.5 s.** The constant moves to `bodyScale.ts`;
   a 1 s window covers at least one full bounce cycle at the 1.2 Hz band floor, so within-stride
   torso flex averages out while an approach is still followed.
7. **Declines rather than throws.** Out-of-order timestamps (which `estimateLocalTorsoLengths` would
   throw on) or no resolvable torso → the thunk returns `null` and pass 1's result stands.
8. **Metre path omitted.** `verticalOscillationCm` builds its series by integrating per-frame deltas
   divided by per-frame scale already; a fallback there would refit what it already fits.
9. **Units are flagged, not converted.** When adopted, `fit.peakToPeakAmplitude` is px at the
   clip-median torso scale and `sampleCount` may be below `resolvedCount`; `scaleNormalized` on
   `HipBounceAnalysis` and `VerticalOscillationFit` says so.

10. **Vertical ratio withholds.** Its denominator is a raw-pixel stride length measured wherever
    the strides fell; a median-scale amplitude over it would be off by however much the runner
    grew. Cadence and footstrike timing read only frequency and phase, which normalization leaves
    in place (the approach test pins the fitted maximum within 1/20 period of the true one).

## Scale divisor: windowed median vs log-quadratic trend

Decision: keep the ±0.5 s windowed median of torso length (`estimateLocalTorsoLengths`) as the
per-frame divisor; do not switch to a log-quadratic trend fitted to torso length.

The windowed median has a known edge bias. At either end of the clip its window is truncated, never
shifted, so on a monotonic approach it lags: at the end of the synthetic fixture the local/true torso
ratio is ~0.67. Dividing by a torso that is too small there inflates the late normalized steps,
which biases VO HIGH (+10% on the fixture) and R² LOW. The VO unit test's ±15% band absorbs that
+10% deterministically (the fixture is seeded and the pipeline is pure).

A log-quadratic trend (fit `log s(t)` with `c + d·t + e·t²`, the shape `armSwing.ts`'s
`resolveScaleStabilizer` uses) removes most of that bias. Measured offline on real probe dumps, with
an exact replica of the pipeline fit (R² is the normalized fit's partial R²; cadence in spm):

| clip / pass | raw | median: R² / spm / VO | log-quad: R² / spm / VO |
|---|---|---|---|
| `IMG_9349` primary | fails | 0.379 / 184.8 / 0.171 | 0.476 / 183.6 / 0.167 |
| `IMG_9349` scale pass | fails | 0.357 / 184.8 | 0.474 / 183.6 |
| `front-approach` scale pass | 0.279 (fails) | 0.298 — not adopted | 0.337 — WOULD adopt, 188.4 spm |
| `IMG_9348` scale pass | passes | 0.372 | 0.308 |
| `multiperson` primary | passes | 0.312 | 0.269 |

The last two clear the gate on the raw pass, so the fallback is never consulted for them; their
rows only show how the two divisors score the same series.

Rationale: across the 9-clip set the median changes only `IMG_9349`. Log-quad would ALSO flip
`front-approach`'s scale pass — a public anchor clip — to an adopted fit, moving that pass's
footstrikes and every footstrike-derived metric grafted from it. That is a separate behaviour change
needing its own A/B, so it is a follow-up bead (evaluate log-quad via `resolveScaleStabilizer`) rather
than part of this change.

## Risks / Trade-offs

- A third chance at the same gate raises the false-adoption rate on rhythmless clips that also
  have a resolvable torso. Bounded by the in-band grid and the white-noise-calibrated gate, which
  is the regime that gate was calibrated for; the offline 9-clip replica moved only `IMG_9349`.
- The approach clip's confidence stays low (partial R² ≈ 0.38 on `IMG_9349`), so values publish
  with the existing fit-quality discount and caveat — intended.
- `verticalOscillation.series` remains raw pixels over the clip-median torso, so on an approach clip
  the chart still shows the growing raw bounce while the value comes from the normalized fit.
