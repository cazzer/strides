import { median } from './mathUtils'
import type { SpectralBandPower } from './spectralFit'

/**
 * Significance test for a spectral peak against an AR(1) RED-NOISE null, rather than against a
 * fixed R² calibrated on white noise.
 *
 * ## Why a fixed R² cannot do this job below the gait floor
 *
 * `verticalOscillationMinFitR2`'s calibration is, in its own doc's words, a "2000-seed pure-noise
 * floor, p95 ≈ 0.22 at n=50" — a WHITE-noise floor, one number for every frequency. That is a fair
 * description of the in-band grid and a wrong one below it, because integrated white noise is RED
 * noise (~1/f²) and its power piles up at exactly the low frequencies the sub-floor grid searches.
 * Measured (`strides-mc1`): a rhythmless random walk — no rhythm at any frequency, by construction
 * — clears 0.30 on **75–92%** of 300 seeds at this corpus's own sample counts, at a median
 * `sinusoidR2` of ~0.52. And no other field the fit reports separates it: the one genuine
 * sub-floor detection in the corpus sits at the noise distribution's own p95 on `sinusoidR2`
 * (0.756 vs 0.788), on `observedCycles` (3.81 vs 3.81) and on `secondPeakRatio` (0.0354 vs p05
 * 0.037). Picking a bigger number is therefore not available — the distributions overlap, the same
 * shape of result as the 4K area floor.
 *
 * What separates them is not a threshold on the peak but a model of the BACKGROUND the peak stands
 * on. A red background is steeply sloped, so "how big is this peak" is meaningless until you ask
 * "compared with what this band looks like where there is no peak".
 *
 * ## The test
 *
 * 1. Fit an AR(1) spectrum shape to the band's own periodogram (`bandPower`), robustly.
 * 2. Divide every grid point's power by that shape, which flattens the background to a constant
 *    if the model is right.
 * 3. Estimate that constant by the MEDIAN of the flattened values — robust, so one real peak (or
 *    a handful of leaked shoulder points) cannot inflate it.
 * 4. A peak clears the null when its flattened power stands above what χ²₂ noise reaches, at
 *    `RED_NOISE_CONFIDENCE`, across the number of independent frequencies actually searched.
 *
 * This is standard red-noise significance testing (Gilman 1963; Mann & Lees 1996; Torrence & Compo
 * 1998), with Mann & Lees' robust background estimate rather than a variance-normalized theoretical
 * one. **The robust background is not a refinement, it is required here**: the theoretical
 * normalization ties the null's level to the series' TOTAL variance, and `fitSpectralSinusoid`
 * removes a `c + d·t + e·t²` trend first, which guts precisely the f→0 end that dominates a red
 * series' variance. Measured with the variance-normalized form the same random walks still cleared
 * the test on **33.7%** of seeds; estimating the level from the band itself takes that to **3.5%**,
 * at the nominal 5%.
 *
 * ## Why it discriminates, and the asymmetry it depends on
 *
 * The AR(1) null is HIGHER at low frequency than at high, so a peak at the grid's bottom edge faces
 * a HIGHER bar than one a few tenths of a Hz up. That is the whole mechanism, and it is a property
 * of the model rather than of any clip: at the φ values these series actually exhibit the null at
 * 0.15 Hz sits 1.5× (φ = 0.9) to 6.2× (φ = 0.99) above its own value at 0.39 Hz. Noise piles at the
 * grid floor — measured, 0 of 93 false adoptions landed within ±0.04 Hz of the real rhythm — so the
 * two populations are separated by the one axis the null is steep in.
 *
 * ## What this module is NOT
 *
 * Not a replacement for any caller's quality gate. It answers "is this peak distinguishable from
 * this series' own noise", never "is the resulting amplitude worth showing a reader" — those are
 * different questions and the second one still belongs to each metric.
 */

/**
 * Conventional two-sided-equivalent confidence for a spectral peak. 0.95 is the level the
 * red-noise-significance literature states its results at; it is NOT calibrated against this
 * repo's footage, and the whole point of using a significance test rather than a fixed R² is that
 * it does not need to be. **Do not tune it to make a clip pass** — if 0.95 rejects a detection,
 * that detection is not separable from its own series' noise, which is a finding rather than a
 * number to adjust.
 */
export const RED_NOISE_CONFIDENCE = 0.95

/**
 * Median of a χ²₂ variate, `2·ln2`. Converts a median-estimated background into the mean-level a
 * χ² quantile is stated against; a mathematical constant, not a tuning knob.
 */
const CHI_SQUARED_2_MEDIAN = 2 * Math.LN2

/** Resolution of the φ search, not a threshold — the objective is scanned rather than solved in
 * closed form because it is an L1 fit, and 0.002 resolves the AR(1) shape far finer than the
 * ~10 independent frequencies a 10-second clip can distinguish. */
const PHI_GRID_STEP = 0.002

/**
 * φ is searched over `[0, PHI_MAX]`, and both ends are deliberate.
 *
 * **The floor at 0** models any series that is not red as WHITE. Allowing φ < 0 (a blue background,
 * rising with frequency) would let the null DROP at the grid's low end and make a sub-floor peak
 * easier to adopt — the wrong direction to be generous in, for a test whose entire purpose is to
 * refuse low-frequency noise. Clamping instead over-states the null at low f for a blue series,
 * which is the conservative error.
 *
 * **The ceiling below 1** is arithmetic: at φ = 1 the normalized AR(1) spectrum is identically
 * zero away from f = 0, so every division by it explodes.
 */
const PHI_MAX = 0.998

export interface RedNoiseVerdict {
  /** `statistic > threshold`. */
  cleared: boolean
  /** The peak's power divided by the fitted background at its own frequency, scaled so that it is
   * distributed as χ²₂ under the null. */
  statistic: number
  /** The χ²₂ quantile at `RED_NOISE_CONFIDENCE`, corrected for having taken a maximum over
   * `independentFrequencies` of them. */
  threshold: number
  /** The fitted AR(1) lag-1 coefficient — how red this series' own background is. */
  phi: number
  /** `bandWidthHz × spanSeconds`, floored at 1: frequency resolution is bounded by observation
   * length, so a grid finer than `1 / span` supplies no further independent chances. */
  independentFrequencies: number
}

/**
 * Discrete AR(1) power spectrum, normalized so that its mean over `[0, f_nyquist]` is exactly 1
 * (the Poisson-kernel identity). Only the SHAPE is used here — the level is estimated from the data
 * — but normalizing keeps the returned numbers on a comparable footing across φ, which is what
 * makes the L1 fit's free offset meaningful.
 *
 * `2π·f·Δt` is the discrete angular frequency; it reaches π at Nyquist, where the spectrum is at
 * its minimum for a red process.
 */
export function ar1NormalizedPower(
  phi: number,
  frequencyHz: number,
  meanSampleIntervalSeconds: number,
): number {
  const theta = 2 * Math.PI * frequencyHz * meanSampleIntervalSeconds
  return (1 - phi * phi) / (1 + phi * phi - 2 * phi * Math.cos(theta))
}

/**
 * Robust L1-in-log fit of the AR(1) shape to an observed periodogram: for each candidate φ the
 * residuals `ln(power) − ln(shape)` are centred on their own median (which absorbs the unknown
 * noise level) and scored by summed absolute deviation. L1 rather than least squares because a
 * genuine peak is an outlier by construction, and a squared loss would let it drag the fitted
 * slope toward itself — the peak must not be allowed to help set the bar it is judged against.
 */
function fitAr1Phi(
  frequencies: readonly number[],
  explained: readonly number[],
  meanSampleIntervalSeconds: number,
): number {
  const logPower = explained.map((p) => Math.log(p))
  let bestPhi = 0
  let bestScore = Number.POSITIVE_INFINITY

  for (let phi = 0; phi <= PHI_MAX; phi += PHI_GRID_STEP) {
    const residuals = frequencies.map(
      (f, i) => logPower[i] - Math.log(ar1NormalizedPower(phi, f, meanSampleIntervalSeconds)),
    )
    const centre = median(residuals)
    let score = 0
    for (const r of residuals) score += Math.abs(r - centre)
    if (score < bestScore) {
      bestScore = score
      bestPhi = phi
    }
  }
  return bestPhi
}

/**
 * Tests the winning peak of a spectral fit against an AR(1) red-noise null fitted to the same
 * band. Returns `null` when the band carries no positive power to model at all, which a caller
 * should read as "not cleared" — there is nothing here to be significant against.
 *
 * **No minimum grid size is imposed, and none is needed**: the background is the median of the same
 * values the peak is drawn from, so on a one-point band the statistic is exactly
 * `CHI_SQUARED_2_MEDIAN` and on a two-point band at most twice it — both far below any threshold
 * this function can produce. A band too small to model self-rejects rather than needing a rule.
 */
export function testPeakAgainstRedNoiseNull(
  peakFrequencyHz: number,
  spanSeconds: number,
  bandPower: SpectralBandPower,
): RedNoiseVerdict | null {
  const { frequencies, explained, meanSampleIntervalSeconds } = bandPower
  if (frequencies.length === 0 || !(meanSampleIntervalSeconds > 0) || !(spanSeconds > 0)) return null

  let peakIndex = -1
  let peakDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < frequencies.length; i += 1) {
    const d = Math.abs(frequencies[i] - peakFrequencyHz)
    if (d < peakDistance) {
      peakDistance = d
      peakIndex = i
    }
  }
  if (peakIndex < 0 || !(explained[peakIndex] > 0)) return null

  // A grid point the sinusoid pair could not improve on carries no information about the noise
  // level and has no logarithm, so it is dropped rather than floored.
  const modelledFrequencies: number[] = []
  const modelledPower: number[] = []
  for (let i = 0; i < frequencies.length; i += 1) {
    if (explained[i] > 0) {
      modelledFrequencies.push(frequencies[i])
      modelledPower.push(explained[i])
    }
  }

  const phi = fitAr1Phi(modelledFrequencies, modelledPower, meanSampleIntervalSeconds)
  const flattened = modelledFrequencies.map(
    (f, i) => modelledPower[i] / ar1NormalizedPower(phi, f, meanSampleIntervalSeconds),
  )
  const background = median(flattened)
  if (!(background > 0) || !Number.isFinite(background)) return null

  const peakFlattened =
    explained[peakIndex] /
    ar1NormalizedPower(phi, frequencies[peakIndex], meanSampleIntervalSeconds)
  const statistic = (CHI_SQUARED_2_MEDIAN * peakFlattened) / background
  if (!Number.isFinite(statistic)) return null

  const bandWidthHz = frequencies[frequencies.length - 1] - frequencies[0]
  const independentFrequencies = Math.max(1, Math.round(bandWidthHz * spanSeconds))
  // The peak was selected by maximization, so the null distribution is that of a MAXIMUM over the
  // independent chances the band offered — the point-wise χ²₂ quantile would be the wrong
  // reference and measures ~5× the nominal false-positive rate (21.7% against 4.3%, 300 seeds).
  const threshold = -2 * Math.log(1 - RED_NOISE_CONFIDENCE ** (1 / independentFrequencies))

  return { cleared: statistic > threshold, statistic, threshold, phi, independentFrequencies }
}
