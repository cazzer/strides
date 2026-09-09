import { describe, expect, it } from 'vitest'
import { MAX_RETIMING_FACTOR, fitBounceSpectrum } from './bounceSpectrum'
import { fitSpectralSinusoid } from './spectralFit'
import type { SpectralSample } from './spectralFit'
import { DEFAULT_HEURISTICS_CONFIG } from './types'

const CONFIG = DEFAULT_HEURISTICS_CONFIG

/** Deterministic, seedable, and dependency-free — the negative controls need noise that is the
 * same on every run, since the whole claim being tested is that noise does NOT clear the gate. */
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

function sinusoid(
  frequencyHz: number,
  { fps, durationSec, amplitude = 20, noise = 0, seed = 1 } = {} as {
    fps: number
    durationSec: number
    amplitude?: number
    noise?: number
    seed?: number
  },
): SpectralSample[] {
  const random = mulberry32(seed)
  const count = Math.round(fps * durationSec)
  const samples: SpectralSample[] = []
  for (let i = 0; i < count; i += 1) {
    const t = i / fps
    samples.push({
      t,
      v: amplitude * Math.sin(2 * Math.PI * frequencyHz * t) + noise * (random() - 0.5),
    })
  }
  return samples
}

describe('fitBounceSpectrum', () => {
  it('an in-band rhythm returns the SHIPPED single-pass fit, bit for bit', () => {
    // The bit-identity proof, and the reason a clip whose ordinary fit succeeds cannot be
    // destabilised by this module: on that path it does exactly what `analyzeBounceSignal` did
    // before, with the same options, and never forms a sub-floor candidate at all.
    const samples = sinusoid(2.5, { fps: 60, durationSec: 4 })

    const result = fitBounceSpectrum(samples, CONFIG)

    expect(result.subFloor).toBe(false)
    expect(result.fit).toEqual(
      fitSpectralSinusoid(samples, {
        minFrequencyHz: CONFIG.spectralFitMinFrequencyHz,
        maxFrequencyHz: CONFIG.spectralFitMaxFrequencyHz,
        frequencyStepHz: CONFIG.spectralFitFrequencyStepHz,
      }),
    )
  })

  it('a sub-floor rhythm is found on the second pass and reported as retimed', () => {
    // 0.433 Hz is 26 steps/min on screen — roughly what a 180 spm runner filmed at 7x and played
    // back at 30 fps looks like, which is the case this module exists for.
    const samples = sinusoid(0.433, { fps: 30, durationSec: 12 })

    const result = fitBounceSpectrum(samples, CONFIG)

    expect(result.subFloor).toBe(true)
    expect(result.fit.ok).toBe(true)
    if (!result.fit.ok) return
    expect(Math.abs(result.fit.frequencyHz - 0.433)).toBeLessThanOrEqual(
      CONFIG.spectralFitFrequencyStepHz,
    )
  })

  it('negative control A: pure noise is not retimed', () => {
    // Nothing periodic at any frequency, in band or below it. A pass-2 adoption here would mean
    // the gate is not protective at this sample count, which is the failure mode
    // `verticalOscillationMinFitR2`'s own doc warns is n-dependent.
    const random = mulberry32(7)
    const samples: SpectralSample[] = []
    for (let i = 0; i < 360; i += 1) samples.push({ t: i / 30, v: 100 * (random() - 0.5) })

    expect(fitBounceSpectrum(samples, CONFIG).subFloor).toBe(false)
  })

  it('negative control B: pure quadratic drift is not retimed', () => {
    // The fit's own `c + d·t + e·t²` terms absorb this exactly, so there is no residual for any
    // sinusoid to explain and the sub-floor pass must not claim one. A slow camera pan is the real
    // signal this stands for.
    const samples: SpectralSample[] = []
    for (let i = 0; i < 360; i += 1) {
      const t = i / 30
      samples.push({ t, v: 400 - 8 * t + 0.9 * t * t })
    }

    expect(fitBounceSpectrum(samples, CONFIG).subFloor).toBe(false)
  })

  it('when NEITHER pass clears the gate, pass 1"s result is returned untouched', () => {
    // The adoption rule is two-sided: consulting the sub-floor grid must not change what a clip
    // reports unless the sub-floor fit is itself trustworthy. Noise clears neither gate, so the
    // returned object has to be the in-band one — the same result the caller saw before.
    const random = mulberry32(11)
    const samples: SpectralSample[] = []
    for (let i = 0; i < 200; i += 1) samples.push({ t: i / 30, v: 50 * (random() - 0.5) })

    const result = fitBounceSpectrum(samples, CONFIG)
    const inBandOnly = fitSpectralSinusoid(samples, {
      minFrequencyHz: CONFIG.spectralFitMinFrequencyHz,
      maxFrequencyHz: CONFIG.spectralFitMaxFrequencyHz,
      frequencyStepHz: CONFIG.spectralFitFrequencyStepHz,
    })

    expect(result.subFloor).toBe(false)
    expect(result.fit).toEqual(inBandOnly)
    // Guards the premise of the assertion above: if noise DID clear the gate this test would pass
    // vacuously while proving nothing about the adoption rule.
    expect(inBandOnly.ok && inBandOnly.sinusoidR2 < CONFIG.verticalOscillationMinFitR2).toBe(true)
  })

  it('disjointness: an adopted sub-floor fit is never at or above the shipped floor', () => {
    // The safety property, asserted across the whole reachable band rather than on one clip: a
    // sub-floor candidate cannot displace an in-band peak, because it is never even formed unless
    // the in-band grid has already failed, and it can never BE an in-band frequency.
    for (let hz = 0.16; hz <= 3.9; hz += 0.07) {
      const result = fitBounceSpectrum(sinusoid(hz, { fps: 30, durationSec: 14 }), CONFIG)
      if (!result.subFloor) continue
      expect(result.fit.ok).toBe(true)
      if (!result.fit.ok) continue
      expect(result.fit.frequencyHz).toBeLessThan(CONFIG.spectralFitMinFrequencyHz)
    }
  })

  it('KNOWN DEFECT: a rhythmless random walk is adopted as a sub-floor rhythm (strides-b4f)', () => {
    // ⚠️ This test asserts a DEFECT, deliberately, so that it is executable rather than folklore.
    // If a future change fixes the adoption rule this test will fail — that failure is the fix
    // landing, and the assertion should be inverted then, not deleted.
    //
    // A random walk has no rhythm at any frequency. But its power is concentrated at the LOW end
    // (integrated white noise is red noise, ~1/f²), which is exactly where the sub-floor grid
    // looks — and `verticalOscillationMinFitR2`'s calibration is explicitly a WHITE-noise floor
    // ("2000-seed pure-noise floor, p95 ≈ 0.22 at n=50", that key's doc), so it offers no
    // protection here. Measured over 300 seeds at this corpus's own sample counts: adopted on
    // 75–92% of walks at a median sinusoidR2 of ~0.52.
    //
    // It bites hardest on `verticalOscillationCm.calibrate`, whose series is a CUMULATIVE INTEGRAL
    // of per-frame deltas — a random walk by construction. Measured live on
    // `park-side-portrait.mp4`: the background scale pass adopts 0.15 Hz at R² 0.398 and reports
    // 46.4 cm of vertical oscillation against a ~0.49 m torso.
    const random = mulberry32(3)
    let v = 0
    const walk: SpectralSample[] = []
    for (let i = 0; i < 288; i += 1) {
      v += random() - 0.5
      walk.push({ t: i / 30, v })
    }

    expect(fitBounceSpectrum(walk, CONFIG).subFloor).toBe(true)
  })

  it('the sub-floor grid bottoms out at the shipped floor divided by MAX_RETIMING_FACTOR', () => {
    // Retiming slower than the declared factor keeps today's behaviour — an honest failure — rather
    // than being fitted onto the nearest representable candidate and reported as a slower gait.
    const belowReach = CONFIG.spectralFitMinFrequencyHz / (MAX_RETIMING_FACTOR * 3)
    const samples = sinusoid(belowReach, { fps: 30, durationSec: 60 })

    const result = fitBounceSpectrum(samples, CONFIG)

    if (result.subFloor) {
      expect(result.fit.ok).toBe(true)
      if (!result.fit.ok) return
      expect(result.fit.frequencyHz).toBeGreaterThanOrEqual(
        CONFIG.spectralFitMinFrequencyHz / MAX_RETIMING_FACTOR,
      )
    }
  })
})
