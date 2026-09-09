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

/** Integrated white noise — the shape `verticalOscillationCm.calibrate` produces by construction,
 * and the one with no rhythm at any frequency. */
function randomWalk(seed: number, count: number, fps: number): SpectralSample[] {
  const random = mulberry32(seed)
  const samples: SpectralSample[] = []
  let v = 0
  for (let i = 0; i < count; i += 1) {
    v += random() - 0.5
    samples.push({ t: i / fps, v })
  }
  return samples
}

/** Noise of a chosen COLOUR and no rhythm: `φ = 0` is white, `φ → 1` approaches a random walk. */
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

/** A real sub-floor rhythm riding on red noise, at an irregular-but-realistic sample spacing. */
function retimedRhythmInRedNoise({
  seed,
  count,
  spanSec,
  hz,
  walk,
}: {
  seed: number
  count: number
  spanSec: number
  hz: number
  walk: number
}): SpectralSample[] {
  const random = mulberry32(seed)
  const samples: SpectralSample[] = []
  let drift = 0
  for (let i = 0; i < count; i += 1) {
    const t = (i * spanSec) / (count - 1)
    drift += walk * (random() - 0.5)
    samples.push({ t, v: 20 * Math.sin(2 * Math.PI * hz * t) + drift })
  }
  return samples
}

/** What the adoption rule saw BEFORE the red-noise null: the sub-floor fit and whether the shared
 * family gate alone would have taken it. Used to guard the premise of the negative controls — a
 * series the R² gate already rejects proves nothing about the null. */
function subFloorFitOf(samples: SpectralSample[]) {
  const fit = fitSpectralSinusoid(samples, {
    minFrequencyHz: CONFIG.spectralFitMinFrequencyHz / MAX_RETIMING_FACTOR,
    maxFrequencyHz: CONFIG.spectralFitMinFrequencyHz - CONFIG.spectralFitFrequencyStepHz,
    frequencyStepHz: CONFIG.spectralFitFrequencyStepHz,
  })
  return {
    fit,
    clearsR2Gate: fit.ok && fit.sinusoidR2 >= CONFIG.verticalOscillationMinFitR2,
  }
}

/** Seed counts are a measurement budget, not a threshold: enough that a rate near the null's own
 * 5% is distinguishable from the 75–92% the defect produced, while the whole file stays a unit
 * test. Each seed runs both grids over ~288 samples. */
const LONG_CLIP_SEEDS = 300
const COLOUR_SWEEP_SEEDS = 100

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

  it('in-band bit-identity holds across the whole shipped band, on clean and on noisy signals', () => {
    // Stated across the band rather than at one frequency, because the blast radius of anything
    // this module does is exactly "every clip whose ordinary fit succeeds" — the two demo clips
    // that work today included. Noise varied too, so the claim covers marginal fits and not only
    // textbook ones.
    for (let hz = 1.3; hz <= 3.9; hz += 0.31) {
      for (const noise of [0, 8, 25]) {
        const samples = sinusoid(hz, { fps: 60, durationSec: 4, noise, seed: 5 })
        const direct = fitSpectralSinusoid(samples, {
          minFrequencyHz: CONFIG.spectralFitMinFrequencyHz,
          maxFrequencyHz: CONFIG.spectralFitMaxFrequencyHz,
          frequencyStepHz: CONFIG.spectralFitFrequencyStepHz,
        })
        if (!direct.ok || direct.sinusoidR2 < CONFIG.verticalOscillationMinFitR2) continue

        const result = fitBounceSpectrum(samples, CONFIG)
        expect(result.subFloor, `${hz} Hz, noise ${noise}`).toBe(false)
        expect(result.fit, `${hz} Hz, noise ${noise}`).toEqual(direct)
      }
    }
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

  it('a rhythmless random walk is NOT adopted as a sub-floor rhythm (strides-mc1)', () => {
    // ⚠️ This assertion used to read `.toBe(true)` and was titled "KNOWN DEFECT", deliberately, so
    // that the defect was executable rather than folklore. `strides-mc1` is that fix landing, and
    // the explanation below is why the case matters — it is not a hypothetical.
    //
    // A random walk has no rhythm at any frequency. But its power is concentrated at the LOW end
    // (integrated white noise is red noise, ~1/f²), which is exactly where the sub-floor grid
    // looks — and `verticalOscillationMinFitR2`'s calibration is explicitly a WHITE-noise floor
    // ("2000-seed pure-noise floor, p95 ≈ 0.22 at n=50", that key's doc), so it offers no
    // protection here. Measured over 300 seeds at this corpus's own sample counts: adopted on
    // 75–92% of walks at a median sinusoidR2 of ~0.52, which is why the adoption rule now also
    // requires the peak to clear an AR(1) red-noise null (`redNoiseNull.ts`).
    //
    // It bit hardest on `verticalOscillationCm.calibrate`, whose series is a CUMULATIVE INTEGRAL
    // of per-frame deltas — a random walk by construction. Measured live on
    // `park-side-portrait.mp4`: the background scale pass adopted 0.15 Hz at R² 0.398 and would
    // have reported 46.4 cm of vertical oscillation against a ~0.49 m torso.
    const result = fitBounceSpectrum(randomWalk(3, 288, 30), CONFIG)

    expect(result.subFloor).toBe(false)
    // Guards the premise: this seed must still be one the R² gate alone waves through, or the test
    // would pass for the wrong reason and stop witnessing the defect it was written for.
    expect(subFloorFitOf(randomWalk(3, 288, 30)).clearsR2Gate).toBe(true)
  })

  it('the genuine sub-floor detection survives the red-noise null (strides-mc1)', () => {
    // The other half of `strides-mc1`: killing the false positives is only a fix if the true
    // positive lives. Modelled on `park-side-portrait.mp4`'s measured primary series — 280 samples
    // over 9.77 s, a 0.39 Hz on-screen rhythm, red noise added until sinusoidR2 lands near that
    // clip's own 0.7561 — because a clean sinusoid would not exercise the null at all.
    const samples = retimedRhythmInRedNoise({ seed: 42, count: 280, spanSec: 9.77, hz: 0.39, walk: 8 })

    const result = fitBounceSpectrum(samples, CONFIG)

    expect(result.subFloor).toBe(true)
    expect(result.fit.ok).toBe(true)
    if (!result.fit.ok) return
    expect(result.fit.frequencyHz).toBeCloseTo(0.39, 10)
    // The clip this stands for fits at 0.7561; a fixture that drifted far from that would stop
    // being evidence about the real case.
    expect(result.fit.sinusoidR2).toBeGreaterThan(0.7)
    expect(result.fit.sinusoidR2).toBeLessThan(0.85)
  })

  it('rhythmless noise is rejected across the whole colour range, not just at φ = 1', () => {
    // The failure mode is temporal correlation, so the fix has to hold for every degree of it —
    // white through near-unit-root — rather than only for the random walk that exposed it. An
    // AR(1) series has no rhythm at any frequency by construction, so every adoption here is a
    // false positive and the rate should sit at or below the 5% the null is stated at.
    for (const phi of [0, 0.3, 0.6, 0.9, 0.99]) {
      let adopted = 0
      for (let seed = 1; seed <= COLOUR_SWEEP_SEEDS; seed += 1) {
        if (fitBounceSpectrum(ar1Series(seed, 288, 30, phi), CONFIG).subFloor) adopted += 1
      }
      expect(
        adopted / COLOUR_SWEEP_SEEDS,
        `AR(1) φ=${phi}: ${adopted}/${COLOUR_SWEEP_SEEDS} adopted`,
      ).toBeLessThanOrEqual(0.08)
    }
  })

  it('long-clip red noise: the adoption rate collapses from 89.7% to near zero', () => {
    // The headline number `strides-mc1` was filed on, at the sample count that produced it. A clip
    // shorter than 1/0.15 = 6.67 s structurally cannot complete a sub-floor cycle, so the two short
    // demo clips are protected by SPAN and are blind to this defect — only a long clip witnesses
    // it, which is why the corpus A/B alone could never have caught it.
    let adopted = 0
    let clearedR2Gate = 0
    for (let seed = 1; seed <= LONG_CLIP_SEEDS; seed += 1) {
      const walk = randomWalk(seed, 288, 30)
      if (fitBounceSpectrum(walk, CONFIG).subFloor) adopted += 1
      if (subFloorFitOf(walk).clearsR2Gate) clearedR2Gate += 1
    }

    // The premise: without the null these walks are adopted en masse. If this ever drops, the
    // assertion below has stopped measuring anything.
    expect(clearedR2Gate / LONG_CLIP_SEEDS).toBeGreaterThan(0.75)
    expect(adopted / LONG_CLIP_SEEDS, `${adopted}/${LONG_CLIP_SEEDS} adopted`).toBeLessThanOrEqual(
      0.08,
    )
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
