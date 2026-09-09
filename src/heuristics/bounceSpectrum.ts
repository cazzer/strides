import type { HeuristicsConfig } from './types'
import { fitSpectralSinusoid } from './spectralFit'
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
 * `verticalOscillationCm.calibrate` fits its own per-run METRE series through the same grid, and a
 * rule that reached only the pixel path would let the vertical-oscillation family disagree with
 * itself about whether a clip has a measurable rhythm — the exact incoherence
 * `verticalOscillationMinFitR2`'s doc exists to prevent.
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
 * exactly the behaviour it has today — an honest `null` with a caveat about an unmeasurable
 * rhythm. Reaching for 32 buys those clips only on paper: it triples the sub-floor grid, and every
 * added point is another chance for noise to clear the gate on a clip that is not retimed at all.
 * The added points are also close to inert on this corpus, because `fitSpectralSinusoid` requires
 * the winning frequency to complete a full cycle inside the observed span — at 32× the floor is
 * 0.0375 Hz, which needs 26.7 s of footage, and the longest clip here is 12.2 s.
 */
export const MAX_RETIMING_FACTOR = 8

export interface BounceSpectrumResult {
  /** The adopted fit: pass 1's whenever it cleared the gate, otherwise pass 2's if THAT cleared it,
   * otherwise pass 1's result untouched (success or failure) exactly as it was before this module
   * existed. */
  fit: SpectralFitResult
  /** `true` only when a sub-floor fit was adopted — i.e. the in-band band failed the gate, the
   * sub-floor band cleared it, and the returned `fit` is the sub-floor one. Since the two grids are
   * disjoint, this is equivalent to "`fit.frequencyHz` is below `spectralFitMinFrequencyHz`"
   * without anyone having to compare two numbers. */
  subFloor: boolean
}

/**
 * Fits the shared bounce sinusoid over `samples`, retrying below the human-gait floor when the
 * shipped band yields nothing that clears `config.verticalOscillationMinFitR2`. See the module doc
 * for the disjointness argument, the adoption rule, and what an adopted sub-floor fit does and does
 * not license a reader to conclude.
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
  const subFloorFit = fitSpectralSinusoid(samples, {
    minFrequencyHz: config.spectralFitMinFrequencyHz / MAX_RETIMING_FACTOR,
    maxFrequencyHz: config.spectralFitMinFrequencyHz - config.spectralFitFrequencyStepHz,
    frequencyStepHz: config.spectralFitFrequencyStepHz,
  })
  if (subFloorFit.ok && subFloorFit.sinusoidR2 >= gate) {
    return { fit: subFloorFit, subFloor: true }
  }

  return { fit: inBand, subFloor: false }
}
