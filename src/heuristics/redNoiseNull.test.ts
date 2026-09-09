import { describe, expect, it } from 'vitest'
import {
  RED_NOISE_CONFIDENCE,
  ar1NormalizedPower,
  testPeakAgainstRedNoiseNull,
} from './redNoiseNull'
import { fitSpectralSinusoidWithBandPower } from './spectralFit'
import type { SpectralBandPower, SpectralSample } from './spectralFit'

const DT = 1 / 30
const BAND_MIN_HZ = 0.15
const BAND_MAX_HZ = 1.18
const BAND_STEP_HZ = 0.02
/** ~9.6 s at 288 samples and 30 fps — the sample count and span `strides-mc1` was measured at. */
const SPAN_SECONDS = 9.6

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function bandFrequencies(): number[] {
  const out: number[] = []
  for (let f = BAND_MIN_HZ; f <= BAND_MAX_HZ + 1e-9; f += BAND_STEP_HZ) out.push(f)
  return out
}

/**
 * A periodogram drawn from the null itself: the AR(1) level times a χ²₂/2 (i.e. Exp(1)) draw, which
 * is what a periodogram of coloured noise looks like. `peakAt`/`peakFactor` inject a real rhythm on
 * top of that background.
 *
 * ⚠️ **The draws are shared across each `1 / spanSeconds` window, on purpose.** Frequency
 * resolution is bounded by observation length, so a real fit's neighbouring grid points are the
 * same peak sampled repeatedly rather than independent trials — 52 grid points over this band carry
 * about 10 independent values. Drawing 52 independent ones instead would hand the maximum five
 * times as many chances as the multiple-comparison correction accounts for, and the calibration
 * test below would read 13.5% against a nominal 5% for a reason that is an artifact of the fixture
 * and not a property of the test.
 */
function syntheticBand(
  seed: number,
  truePhi: number,
  { peakAt, peakFactor = 1 }: { peakAt?: number; peakFactor?: number } = {},
): SpectralBandPower {
  const random = mulberry32(seed)
  const frequencies = bandFrequencies()
  const resolutionHz = 1 / SPAN_SECONDS
  const draws = new Map<number, number>()
  const explained = frequencies.map((f) => {
    const window = Math.round((f - BAND_MIN_HZ) / resolutionHz)
    let exponential = draws.get(window)
    if (exponential === undefined) {
      exponential = -Math.log(1 - random())
      draws.set(window, exponential)
    }
    const level = 100 * ar1NormalizedPower(truePhi, f, DT) * exponential
    return peakAt !== undefined && Math.abs(f - peakAt) < BAND_STEP_HZ / 2
      ? level * peakFactor
      : level
  })
  return { frequencies, explained, meanSampleIntervalSeconds: DT }
}

function argmax(values: readonly number[]): number {
  let best = 0
  for (let i = 1; i < values.length; i += 1) if (values[i] > values[best]) best = i
  return best
}

/** Rhythmless noise of a chosen COLOUR: `φ = 0` is white, `φ = 1` is the random walk
 * `verticalOscillationCm.calibrate` produces by construction. Fed through the REAL fit below, so
 * the pointwise calibration is measured on the periodogram the shipped code actually hands over —
 * quadratic detrend included — rather than on the synthetic band above. */
function ar1Series(seed: number, count: number, fps: number, phi: number): SpectralSample[] {
  const random = mulberry32(seed)
  const samples: SpectralSample[] = []
  let v = 0
  for (let i = 0; i < count; i += 1) {
    v = phi * v + (random() - 0.5)
    samples.push({ t: i / fps, v })
  }
  return samples
}

/** The sub-floor band at the shipped defaults, fitted for real. */
function realBandPowerOf(samples: SpectralSample[]): SpectralBandPower | null {
  return fitSpectralSinusoidWithBandPower(samples, {
    minFrequencyHz: BAND_MIN_HZ,
    maxFrequencyHz: BAND_MAX_HZ,
    frequencyStepHz: BAND_STEP_HZ,
  }).bandPower
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

describe('ar1NormalizedPower', () => {
  it('is normalized to a mean of 1 over the whole band up to Nyquist', () => {
    // The Poisson-kernel identity the module's doc relies on. It is what makes the shape
    // comparable across candidate φ, which is what gives the L1 fit's free offset a meaning.
    const nyquist = 1 / (2 * DT)
    for (const phi of [0, 0.3, 0.6, 0.9, 0.99]) {
      const steps = 20000
      let sum = 0
      for (let i = 0; i < steps; i += 1) {
        sum += ar1NormalizedPower(phi, ((i + 0.5) / steps) * nyquist, DT)
      }
      expect(sum / steps, `φ=${phi}`).toBeCloseTo(1, 2)
    }
  })

  it('THE ASYMMETRY THE DESIGN DEPENDS ON: the null sits higher at 0.15 Hz than at 0.39 Hz', () => {
    // This is the whole mechanism. False sub-floor adoptions pile up at the grid's bottom edge
    // (measured: 0 of 93 landed within ±0.04 Hz of the real 0.39 Hz rhythm), so the genuine peak
    // must face a LOWER bar than the noise does. A red null delivers that for free — it is ~1/f²
    // — but only if the fitted φ is actually red, so this is asserted rather than assumed.
    let previousRatio = 0
    for (const phi of [0.7, 0.8, 0.9, 0.95, 0.99]) {
      const atGridFloor = ar1NormalizedPower(phi, 0.15, DT)
      const atRealRhythm = ar1NormalizedPower(phi, 0.39, DT)
      expect(atGridFloor, `φ=${phi}`).toBeGreaterThan(atRealRhythm)
      // And it sharpens monotonically with redness, so the redder the series the more strongly the
      // test discriminates in the direction it needs to.
      const ratio = atGridFloor / atRealRhythm
      expect(ratio, `φ=${phi}`).toBeGreaterThan(previousRatio)
      previousRatio = ratio
    }
    expect(previousRatio).toBeGreaterThan(6)
  })

  it('is flat for white noise, so a non-red series is judged against a flat background', () => {
    for (const f of [0.15, 0.4, 0.8, 1.18]) expect(ar1NormalizedPower(0, f, DT)).toBeCloseTo(1, 12)
  })
})

describe('testPeakAgainstRedNoiseNull', () => {
  it('rejects the maximum of a purely red band, within a small factor of the stated rate', () => {
    // No rhythm anywhere: every clearance is a false positive. Measured 42/400 = 10.5%, against a
    // nominal 5%.
    //
    // ⚠️ **The excess is in the MULTIPLE-COMPARISON step, not in the noise model or the level
    // estimator.** The maximum is taken over 52 CORRELATED grid points and corrected as if over the
    // ~10 independent frequencies the span resolves; how many of the 52 genuinely compete depends on
    // the background, and a flat one lets all of them compete while a steep one pins the peak to the
    // bottom edge. That is why the excess is a function of φ — measured through the real fit, 12.8%
    // at φ = 0 falling to 4.0% at φ = 1 — which is the observation that rules the level estimator
    // out: a sampling-noise story in the median would not predict a φ dependence, and the median IS
    // essentially unbiased (measured 1.382 against the χ²₂ median of 1.386 at φ = 0, pinned
    // pointwise by the calibration test below).
    //
    // It is bounded here rather than pinned, because the operative number is the one
    // measured through the real fit in `bounceSpectrum.test.ts` — where a quadratic detrend has
    // already removed part of the f→0 power the AR(1) model predicts, pushing the rate back to
    // 3–5%. Both are a different order of thing from the 75–92% the R² gate alone allowed.
    const seeds = 400
    let cleared = 0
    for (let seed = 1; seed <= seeds; seed += 1) {
      const band = syntheticBand(seed, 0.95)
      const peak = band.frequencies[argmax(band.explained)]
      if (testPeakAgainstRedNoiseNull(peak, SPAN_SECONDS, band)?.cleared === true) cleared += 1
    }
    expect(cleared / seeds, `${cleared}/${seeds} cleared`).toBeLessThanOrEqual(
      3 * (1 - RED_NOISE_CONFIDENCE),
    )
  })

  it('POINTWISE CALIBRATION: the statistic is χ²₂ at a fixed, non-selected frequency', () => {
    // ⚠️ Every other test in this file and in `bounceSpectrum.test.ts` measures the clearance rate
    // of the MAXIMUM, which conflates the noise model with the multiple-comparison correction — and
    // that conflation hides an error in exactly one direction. Measured: doubling
    // `CHI_SQUARED_2_MEDIAN` WOULD be caught by the existing bounds (27% adoption against an 8%
    // ceiling), but HALVING it would not — 0.7% adoption, power still 95.3%, every existing bound
    // green, and the only symptom a quietly reduced sensitivity at the band's low end that nothing
    // measures. So the statistic is pinned here directly, at a FIXED mid-band frequency chosen
    // before the data rather than by argmax, where no correction applies and the raw χ²₂ properties
    // must hold: median `2·ln2` ≈ 1.386 and P(> the 95% quantile) ≈ 5%.
    //
    // Reference values through this same real fit, 3000 seeds per colour:
    //
    // | φ | median | mean | P(> 5.991) |
    // |---|---|---|---|
    // | 1    | 1.336 | 1.847 | 4.3% |
    // | 0.99 | 1.323 | 1.855 | 4.1% |
    // | 0.9  | 1.412 | 2.061 | 5.3% |
    // | 0.6  | 1.386 | 1.953 | 4.2% |
    // | 0    | 1.382 | 1.920 | 4.2% |
    //
    // The seed count below is a budget, not a threshold — 400 costs ~4 s across the five colours and
    // reproduces the table to within its own sampling noise. Bounds are stated as RATIOS against the
    // mathematical values so the failure they exist to catch is legible: a 0.5× or 2× error in the
    // constant moves the median to 0.5× or 2× of `2·ln2` and the tail rate to ~0% or ~16%, and both
    // land outside every bound here. Nothing is random at run time (the generator is seeded), so
    // these are pinned against future drift rather than against flakiness — which is also why the
    // explicit timeout below is generous rather than tuned: 2000 real spectral fits take ~4 s alone
    // and past the 5 s default when the suite runs them alongside everything else.
    const CALIBRATION_SEEDS = 400
    const PROBE_HZ = 0.61 // mid-band, on the grid, and never the winner by construction
    const chiSquared2Median = 2 * Math.LN2
    const pointwiseQuantile = -2 * Math.log(1 - RED_NOISE_CONFIDENCE) // 5.991

    for (const phi of [1, 0.99, 0.9, 0.6, 0]) {
      const statistics: number[] = []
      for (let seed = 1; seed <= CALIBRATION_SEEDS; seed += 1) {
        const band = realBandPowerOf(ar1Series(seed, 288, 30, phi))
        expect(band, `φ=${phi} seed ${seed}`).not.toBeNull()
        const verdict = testPeakAgainstRedNoiseNull(PROBE_HZ, SPAN_SECONDS, band!)
        expect(verdict, `φ=${phi} seed ${seed}`).not.toBeNull()
        statistics.push(verdict!.statistic)
      }

      const medianRatio = medianOf(statistics) / chiSquared2Median
      expect(medianRatio, `φ=${phi} median ratio`).toBeGreaterThan(0.8)
      expect(medianRatio, `φ=${phi} median ratio`).toBeLessThan(1.25)

      const tail =
        statistics.filter((s) => s > pointwiseQuantile).length / CALIBRATION_SEEDS
      expect(tail, `φ=${phi} P(> ${pointwiseQuantile.toFixed(3)})`).toBeGreaterThan(0.015)
      expect(tail, `φ=${phi} P(> ${pointwiseQuantile.toFixed(3)})`).toBeLessThan(0.08)
    }
  }, 30_000)

  it('clears a genuine rhythm standing above a red background', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const band = syntheticBand(seed, 0.95, { peakAt: 0.39, peakFactor: 400 })
      const verdict = testPeakAgainstRedNoiseNull(0.39, SPAN_SECONDS, band)
      expect(verdict?.cleared, `seed ${seed}`).toBe(true)
    }
  })

  it('recovers roughly the colour the background was drawn with', () => {
    // Not a precision claim — the fit sees ~10 independent frequencies. But a φ estimate that
    // landed near zero on a genuinely red band would silently disable the asymmetry above.
    const band = syntheticBand(7, 0.95)
    const verdict = testPeakAgainstRedNoiseNull(band.frequencies[argmax(band.explained)], SPAN_SECONDS, band)
    expect(verdict).not.toBeNull()
    expect(verdict!.phi).toBeGreaterThan(0.8)
  })

  it('corrects for the number of independent frequencies, not the number of grid points', () => {
    // Frequency resolution is bounded by observation length, so a finer grid over the same span
    // offers no extra chances and must not raise the bar.
    const band = syntheticBand(3, 0.9)
    const fine: SpectralBandPower = {
      ...band,
      frequencies: band.frequencies,
      explained: band.explained,
    }
    const verdict = testPeakAgainstRedNoiseNull(0.39, SPAN_SECONDS, fine)
    expect(verdict?.independentFrequencies).toBe(
      Math.round((BAND_MAX_HZ - BAND_MIN_HZ) * SPAN_SECONDS),
    )
    // Sanity: the corrected threshold is above the point-wise χ²₂ 95% quantile of 5.99, because
    // the peak was chosen by maximization over that many chances.
    expect(verdict!.threshold).toBeGreaterThan(5.99)
  })

  it('self-limits on a band too small to model, without needing a minimum-size rule', () => {
    // One point makes the peak its own background; two make it at most twice it. Both land far
    // below any reachable threshold, so a degenerate band rejects itself.
    const one: SpectralBandPower = {
      frequencies: [0.15],
      explained: [1e9],
      meanSampleIntervalSeconds: DT,
    }
    expect(testPeakAgainstRedNoiseNull(0.15, SPAN_SECONDS, one)?.cleared).toBe(false)

    const two: SpectralBandPower = {
      frequencies: [0.15, 0.17],
      explained: [1e9, 1],
      meanSampleIntervalSeconds: DT,
    }
    expect(testPeakAgainstRedNoiseNull(0.15, SPAN_SECONDS, two)?.cleared).toBe(false)
  })

  it('returns null when there is nothing to be significant against', () => {
    const empty: SpectralBandPower = {
      frequencies: [],
      explained: [],
      meanSampleIntervalSeconds: DT,
    }
    expect(testPeakAgainstRedNoiseNull(0.15, SPAN_SECONDS, empty)).toBeNull()

    const noPower: SpectralBandPower = {
      frequencies: [0.15, 0.17, 0.19],
      explained: [0, 0, 0],
      meanSampleIntervalSeconds: DT,
    }
    expect(testPeakAgainstRedNoiseNull(0.15, SPAN_SECONDS, noPower)).toBeNull()
  })
})
