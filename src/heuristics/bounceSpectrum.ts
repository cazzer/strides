import type { HeuristicsConfig } from './types'
import { testPeakAgainstRedNoiseNull } from './redNoiseNull'
import { fitSpectralSinusoid, fitSpectralSinusoidWithBandPower } from './spectralFit'
import type { SpectralFitResult, SpectralSample } from './spectralFit'

/**
 * Two-pass hip-bounce spectral fit: the shipped human-gait band first, and — only when that band
 * yields nothing trustworthy — a second, DISJOINT grid below it, whose adoption is itself the
 * evidence that the footage was retimed.
 *
 * ## Why this is a layer of its own
 *
 * It sits above `spectralFit.ts` and below `hipBounce.ts` deliberately. `fitSpectralSinusoid`'s own
 * module doc reserves that file for WELL-POSEDNESS ("a sample floor, a cycle rule, detection of
 * signals with nothing to fit") and pushes everything else to its callers; "human gait does not
 * happen below 1.2 Hz, so a fit that does means the clock is wrong" is gait policy, not
 * well-posedness, and folding it in there would silently change `armSwing.ts`, which fits a
 * different signal for a different reason. Nor can it live inline in `analyzeBounceSignal`:
 * `verticalOscillationCm.calibrate` fits its own per-run METRE series through the same grid, so a
 * rule reaching only the pixel path would leave the metre path with no sub-floor rule at all — and
 * that is precisely the path on which this defect reached a rendered card (`design.md` D4.4).
 *
 * ⚠️ **This does NOT buy the family a common verdict, and this doc used to claim it did.** The two
 * consumers fit DIFFERENT series, so they can still disagree about whether a clip has a measurable
 * rhythm — and on `park-side-portrait.mp4` they do: the pixel path adopts 0.39 Hz while the metre
 * path adopts nothing at all. That is fail-safe rather than a defect, and the mechanism is worth
 * naming, because it is not obvious from the adoption rule: the peak handed to the null is the
 * argmax of RAW explained power, never of FLATTENED power, so a genuine sub-floor peak sitting
 * under a larger raw red-noise peak is never offered to the null in the first place and the pass
 * fails outright. What this module's position guarantees is that both consumers are governed by the
 * same RULE, not that they reach the same answer.
 *
 * ## The two grids are disjoint, and that is the safety property
 *
 * Pass 1 is today's grid, unchanged: `[spectralFitMinFrequencyHz, spectralFitMaxFrequencyHz]`.
 * Pass 2 spans `[spectralFitMinFrequencyHz / MAX_RETIMING_FACTOR, spectralFitMinFrequencyHz −
 * spectralFitFrequencyStepHz]`. Every pass-2 candidate is therefore strictly below every pass-1
 * candidate, by construction rather than by arithmetic that happens to work out at the shipped
 * defaults — the grid's last point cannot exceed its own stated maximum, and that maximum is one
 * grid step below pass 1's minimum.
 *
 * **This is why there are two grids rather than one widened union.** A union grid lets a
 * low-frequency candidate WIN outright on a clip whose in-band rhythm is perfectly real, and
 * nothing about a residual-sum-of-squares comparison bounds how often that happens on footage
 * nobody has measured. Measured under `strides-aha`: with the floor simply dropped to 0.30 Hz the
 * retimed clip reports a confidently-displayed 26 spm, which is worse than an honest null, and it
 * would silence `verticalOscillationCm`'s `fit.frequencyHz × 60 == cadence.value` tripwire by
 * making the two agree on the wrong answer. Under the disjoint arrangement a sub-floor candidate is
 * never even formed unless the in-band band has already failed on its own terms, so it is
 * STRUCTURALLY INCAPABLE of displacing a winning in-band peak. A clip whose normal fit succeeds
 * cannot be destabilised by this module at all.
 *
 * ## The gate is read here as ARBITRATION, not as publish/withhold policy
 *
 * `hipBounce.ts`'s doc places quality gates in the callers, and that division is intact: every
 * caller still applies its own threshold to whatever fit comes back, and this module never decides
 * whether a number reaches a card. What it decides is narrower — WHICH OF TWO FITS OF THE SAME
 * SERIES to hand over — and that question has no caller-specific answer, because both candidates
 * describe the identical samples. `verticalOscillationMinFitR2` is the value used because it is
 * already the shared family gate (`verticalOscillation`, `verticalRatio` and
 * `verticalOscillationCm` all read it, and `cadenceMinFitR2` is documented as deliberately the same
 * number for the same series). Using anything else would let this module prefer a fit that every
 * downstream consumer then rejects, or reject one they would all have taken.
 *
 * ## Adopting a sub-floor fit takes a SIGNIFICANCE test, because that band is where red noise lives
 *
 * `verticalOscillationMinFitR2` decides pass 1 alone. It is necessary but nowhere near sufficient
 * for pass 2, and the reason is a regime change rather than a calibration slip: integrated white
 * noise is RED noise (~1/f²), so its power concentrates in exactly the band pass 2 searches, while
 * that key's calibration is explicitly a WHITE-noise floor. Measured (`strides-mc1`): a rhythmless
 * random walk clears 0.30 below the floor on **75–92%** of 300 seeds at this corpus's sample
 * counts, and the shipped pipeline already fell for it on real footage — `park-side-portrait`'s
 * background MediaPipe scale pass fitting 0.150 Hz at R² 0.398 against a keyframe truth of
 * 0.40 Hz. **No threshold on any field `SpectralFitSuccess` reports separates the two**; the
 * genuine detection sits at the noise distribution's own p95 on all three candidates. So pass 2's
 * peak is additionally tested against an AR(1) red-noise null fitted to its own band
 * (`redNoiseNull.ts`), at a conventional 95%.
 *
 * **Both conditions are required, and the R² one is not redundant.** The null answers "is this peak
 * distinguishable from this series' own noise"; the family gate answers "will the consumers of this
 * fit actually take it". Dropping the second would let this module return a sub-floor fit that
 * every downstream metric then rejects, leaving a clip reported as retimed while showing no
 * numbers — which is worse than today's honest failure, and would break the arbitration argument
 * above. Pass 1 is untouched by any of this: a clip whose in-band fit clears the gate never reaches
 * the null, so nothing that works today can be moved by it.
 *
 * ## `subFloor` needs no threshold of its own
 *
 * A rhythm is reported as retimed exactly when pass 2 was consulted, cleared the gate, and was
 * adopted. There is no new constant: the human-gait floor IS `spectralFitMinFrequencyHz`, whose own
 * doc already states that 1.2 Hz is "comfortably below any running cadence", and the frequency
 * comparison that would otherwise need writing is a structural consequence of the disjoint grid —
 * an adopted pass-2 fit is below the floor because pass 2 contains no other kind of candidate.
 *
 * ## Reading an adopted pass-2 fit
 *
 * ⚠️ `secondPeakRatio` on an adopted pass-2 fit is measured against SUB-FLOOR COMPETITORS ONLY.
 * `fitSpectralSinusoid` computes it over the grid it was handed, so a low ratio there says the
 * sub-floor rhythm is unambiguous AMONG SUB-FLOOR CANDIDATES; it says nothing about whether an
 * in-band rhythm also explains the series. What bounds that is the adoption rule itself: pass 2 is
 * only reachable because the whole in-band grid already failed the same gate.
 */

/**
 * Slowest playback this module will look for, as a multiple of real time — so the sub-floor grid
 * bottoms out at `spectralFitMinFrequencyHz / 8` = 0.15 Hz, a 9 steps/min shuffle on screen.
 *
 * 8 is iPhone's 240 fps against a 30 fps timeline, which is the device class this exists for: iOS
 * bakes the retiming into `stts` when a clip leaves Photos, so an upload from the camera roll
 * arrives at 30 nominal fps with no capture rate recorded anywhere and no container signal to read
 * (`slowMotionDetection.ts`).
 *
 * **What 8 misses, deliberately**: Android's 960 fps tier is 32×, and a clip retimed that far keeps
 * exactly the behaviour it has today — an honest `null` with a caveat about an unmeasurable rhythm.
 *
 * **The binding constraint on 32 is SPAN, not grid density.** At 32× the floor is 0.0375 Hz, and
 * `fitSpectralSinusoid` requires the winning frequency to complete a full cycle inside the observed
 * span — 26.7 s of footage for one cycle, against a 12.2 s longest clip here. So the tier the wider
 * grid is *for* stays out of reach whatever the grid says. What the extra points would actually
 * serve is the range in between: of the six they add below 0.15 Hz, three (0.0975, 0.1175 and
 * 0.1375 Hz) do complete a cycle inside 12.17 s and would be live rather than decorative — and they
 * correspond to retiming factors of roughly 9–12×, which is no device tier at all.
 *
 * ⚠️ Two arguments this block used to make for 8 are measurably FALSE and are not to be revived.
 * 32 does not "triple the grid": at the shipped defaults the sub-floor grid goes from **52 points to
 * 58**, +12%. And `observedCycles >= 1` does not prune the added points to inertness — measured
 * under `strides-mc1` (`design.md` D4.1), a 0.15 Hz winner completes 1.515 cycles over a 10.1 s
 * window and clears that rule comfortably. The honest cost of widening is smaller than "six more
 * chances" too: `redNoiseNull.ts` corrects for INDEPENDENT frequencies rather than grid points, and
 * at this corpus's measured ~9.8 s span that count goes 10 → 11. One extra chance for a tier that
 * still cannot be reached is a bad trade, which is the whole argument.
 *
 * ⚠️ **The declared reach to 0.15 Hz is nominal, and the bottom third of it is not usable in
 * practice** — see "the price of the asymmetry" in `redNoiseNull.ts`. A genuine rhythm below about
 * 0.25 Hz is mostly refused at this corpus's noise level, by design; a 150–240 spm runner filmed at
 * 8× lands at 0.31–0.5 Hz, well clear of that.
 */
export const MAX_RETIMING_FACTOR = 8

export interface BounceSpectrumResult {
  /** The adopted fit: pass 1's whenever it cleared the gate, otherwise pass 2's if THAT cleared
   * both the gate and the red-noise null, otherwise pass 1's result untouched (success or failure)
   * exactly as it was before this module existed. */
  fit: SpectralFitResult
  /** `true` only when a sub-floor fit was adopted — i.e. the in-band band failed the gate, the
   * sub-floor band cleared both the gate and the red-noise null, and the returned `fit` is the
   * sub-floor one. Since the two grids are disjoint, this is equivalent to "`fit.frequencyHz` is
   * below `spectralFitMinFrequencyHz`" without anyone having to compare two numbers. */
  subFloor: boolean
}

/**
 * Fits the shared bounce sinusoid over `samples`, retrying below the human-gait floor when the
 * shipped band yields nothing that clears `config.verticalOscillationMinFitR2`, and adopting that
 * retry only when its peak ALSO clears an AR(1) red-noise null fitted to its own band. See the
 * module doc for the disjointness argument, the adoption rule, and what an adopted sub-floor fit
 * does and does not license a reader to conclude.
 *
 * A pass-1 FAILURE (too few samples, a degenerate signal, too short a span) counts as "did not
 * clear the gate" and pass 2 runs — which costs a grid search and can never change the answer,
 * since all three failure modes are properties of the samples rather than of the band, and the one
 * that is band-dependent (`insufficient-cycles`) can only get worse on a grid of lower frequencies.
 * Stating the condition that way keeps it a single predicate rather than two.
 */
export function fitBounceSpectrum(
  samples: ReadonlyArray<SpectralSample>,
  config: HeuristicsConfig,
): BounceSpectrumResult {
  const inBand = fitSpectralSinusoid(samples, {
    minFrequencyHz: config.spectralFitMinFrequencyHz,
    maxFrequencyHz: config.spectralFitMaxFrequencyHz,
    frequencyStepHz: config.spectralFitFrequencyStepHz,
  })

  const gate = config.verticalOscillationMinFitR2
  if (inBand.ok && inBand.sinusoidR2 >= gate) return { fit: inBand, subFloor: false }

  // Strictly below pass 1's own minimum, by construction — a grid never emits a candidate above
  // the maximum it was given. A configuration whose sub-floor minimum meets or exceeds this
  // maximum yields an empty band, which `fitSpectralSinusoid` reports as a failure and which is
  // therefore never adopted; no special case is needed for it.
  const { fit: subFloorFit, bandPower } = fitSpectralSinusoidWithBandPower(samples, {
    minFrequencyHz: config.spectralFitMinFrequencyHz / MAX_RETIMING_FACTOR,
    maxFrequencyHz: config.spectralFitMinFrequencyHz - config.spectralFitFrequencyStepHz,
    frequencyStepHz: config.spectralFitFrequencyStepHz,
  })
  if (subFloorFit.ok && subFloorFit.sinusoidR2 >= gate && bandPower !== null) {
    const verdict = testPeakAgainstRedNoiseNull(
      subFloorFit.frequencyHz,
      subFloorFit.spanSeconds,
      bandPower,
    )
    if (verdict?.cleared === true) return { fit: subFloorFit, subFloor: true }
  }

  return { fit: inBand, subFloor: false }
}
