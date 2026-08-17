import { describe, expect, it } from 'vitest'
import { fitSpectralSinusoid } from './spectralFit'
import type { SpectralFitSuccess, SpectralSample } from './spectralFit'

/** The same grid `DEFAULT_HEURISTICS_CONFIG` gives vertical oscillation: 1.2-4.0 Hz, 141 candidates. */
const GRID = { minFrequencyHz: 1.2, maxFrequencyHz: 4.0, frequencyStepHz: 0.02 }

const HALF_AMPLITUDE = 10
const PEAK_TO_PEAK = 2 * HALF_AMPLITUDE

/**
 * Deterministic PRNG (mulberry32). Every noisy fixture in this file is seeded — a bare
 * `Math.random()` would make a threshold assertion pass or fail at random across CI runs, which is
 * exactly the kind of flake that erodes trust in a numeric test suite.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box-Muller over the seeded uniform stream — unit-variance normals. */
function seededNormals(seed: number, count: number): number[] {
  const random = mulberry32(seed)
  const out: number[] = []
  while (out.length < count) {
    const u1 = Math.max(random(), 1e-12)
    const u2 = random()
    const radius = Math.sqrt(-2 * Math.log(u1))
    out.push(radius * Math.cos(2 * Math.PI * u2))
    out.push(radius * Math.sin(2 * Math.PI * u2))
  }
  return out.slice(0, count)
}

interface SineOptions {
  frequencyHz: number
  sampleRateHz: number
  sampleCount: number
  phase?: number
  halfAmplitude?: number
  offset?: number
  timeOffset?: number
}

function sineSamples(options: SineOptions): SpectralSample[] {
  const {
    frequencyHz,
    sampleRateHz,
    sampleCount,
    phase = 0,
    halfAmplitude = HALF_AMPLITUDE,
    offset = 0,
    timeOffset = 0,
  } = options
  return Array.from({ length: sampleCount }, (_, i) => {
    const t = i / sampleRateHz
    return {
      t: t + timeOffset,
      v: offset + halfAmplitude * Math.sin(2 * Math.PI * frequencyHz * t + phase),
    }
  })
}

function expectSuccess(
  result: ReturnType<typeof fitSpectralSinusoid>,
): SpectralFitSuccess {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('unreachable — narrowed by the assertion above')
  return result
}

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected)
}

describe('fitSpectralSinusoid — amplitude and frequency recovery', () => {
  it('recovers a clean on-grid sine exactly', () => {
    // 81 samples at 50 Hz spans exactly 1.6 s; 3 Hz * 1.6 s = 4.8 cycles.
    const fit = expectSuccess(
      fitSpectralSinusoid(
        sineSamples({ frequencyHz: 3, sampleRateHz: 50, sampleCount: 81, phase: 0.7 }),
        GRID,
      ),
    )

    expect(fit.frequencyHz).toBeCloseTo(3, 10)
    expect(relativeError(fit.peakToPeakAmplitude, PEAK_TO_PEAK)).toBeLessThan(0.01)
    expect(fit.sinusoidR2).toBeGreaterThan(0.99)
    expect(fit.observedCycles).toBeCloseTo(4.8, 6)
    expect(fit.spanSeconds).toBeCloseTo(1.6, 6)
    expect(fit.sampleCount).toBe(81)
  })

  it('recovers an off-grid frequency to the nearest grid neighbour without losing amplitude', () => {
    // 2.8333 Hz is the synthetic gait fixture's real bounce rate (170 steps/min); it falls between
    // the 2.82 and 2.84 grid points, which is the normal case for real footage.
    const fit = expectSuccess(
      fitSpectralSinusoid(
        sineSamples({ frequencyHz: (170 / 120) * 2, sampleRateHz: 30, sampleCount: 120 }),
        GRID,
      ),
    )

    expect([2.82, 2.84]).toContainEqual(Number(fit.frequencyHz.toFixed(2)))
    expect(relativeError(fit.peakToPeakAmplitude, PEAK_TO_PEAK)).toBeLessThan(0.01)
  })

  it('is unmoved by linear and quadratic drift far larger than the oscillation itself', () => {
    const clean = sineSamples({
      frequencyHz: 2.5,
      sampleRateHz: 50,
      sampleCount: 100,
      phase: 0.3,
    })
    // Drift dominates the trace by roughly 70x its peak-to-peak — the camera-approach case.
    const drifted = clean.map(({ t, v }) => ({
      t,
      v: v + 500 + 300 * t + 200 * t * t,
    }))

    const cleanFit = expectSuccess(fitSpectralSinusoid(clean, GRID))
    const driftedFit = expectSuccess(fitSpectralSinusoid(drifted, GRID))

    expect(driftedFit.frequencyHz).toBeCloseTo(cleanFit.frequencyHz, 10)
    expect(
      relativeError(driftedFit.peakToPeakAmplitude, cleanFit.peakToPeakAmplitude),
    ).toBeLessThan(0.02)
  })

  it('recovers amplitude and frequency through noise at 15% of the signal amplitude', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const noise = seededNormals(seed, 100)
      const samples = sineSamples({
        frequencyHz: 2.5,
        sampleRateHz: 50,
        sampleCount: 100,
      }).map((sample, i) => ({
        t: sample.t,
        v: sample.v + 0.15 * HALF_AMPLITUDE * noise[i],
      }))

      const fit = expectSuccess(fitSpectralSinusoid(samples, GRID))
      expect(relativeError(fit.peakToPeakAmplitude, PEAK_TO_PEAK)).toBeLessThan(0.1)
      expect(Math.abs(fit.frequencyHz - 2.5)).toBeLessThanOrEqual(0.04)
    }
  })
})

describe('fitSpectralSinusoid — invariance', () => {
  const base = sineSamples({
    frequencyHz: 2.6,
    sampleRateHz: 50,
    sampleCount: 120,
    phase: 0.4,
  })
  const baseline = expectSuccess(fitSpectralSinusoid(base, GRID))

  it('is invariant to a large absolute time offset', () => {
    // A real clip's timestamps are video-relative, but nothing in the contract promises they start
    // near zero — internal centering has to make a 600 s offset a no-op.
    const shifted = base.map(({ t, v }) => ({ t: t + 600, v }))
    const fit = expectSuccess(fitSpectralSinusoid(shifted, GRID))

    expect(fit.frequencyHz).toBeCloseTo(baseline.frequencyHz, 10)
    expect(fit.peakToPeakAmplitude).toBeCloseTo(baseline.peakToPeakAmplitude, 6)
  })

  it('is invariant to a constant offset in the values', () => {
    const shifted = base.map(({ t, v }) => ({ t, v: v + 12345 }))
    const fit = expectSuccess(fitSpectralSinusoid(shifted, GRID))

    expect(fit.frequencyHz).toBeCloseTo(baseline.frequencyHz, 10)
    expect(fit.peakToPeakAmplitude).toBeCloseTo(baseline.peakToPeakAmplitude, 6)
  })

  it('is invariant to sample order', () => {
    const random = mulberry32(42)
    const shuffled = [...base]
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1))
      const swap = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = swap
    }

    expect(fitSpectralSinusoid(shuffled, GRID)).toEqual(baseline)
  })
})

describe('fitSpectralSinusoid — gaps and irregular sampling', () => {
  const TRUE_FREQUENCY = 2.6

  function gappySine(keep: (t: number) => boolean): SpectralSample[] {
    return sineSamples({
      frequencyHz: TRUE_FREQUENCY,
      sampleRateHz: 50,
      sampleCount: 150,
      phase: 0.4,
    }).filter((sample) => keep(sample.t))
  }

  it('tolerates a 0.4 s gap in the middle of the clip', () => {
    const fit = expectSuccess(
      fitSpectralSinusoid(gappySine((t) => t < 1.2 || t > 1.6), GRID),
    )
    expect(fit.frequencyHz).toBeCloseTo(TRUE_FREQUENCY, 10)
    expect(relativeError(fit.peakToPeakAmplitude, PEAK_TO_PEAK)).toBeLessThan(0.03)
  })

  it('tolerates a 0.42 s leading gap', () => {
    const fit = expectSuccess(fitSpectralSinusoid(gappySine((t) => t > 0.42), GRID))
    expect(fit.frequencyHz).toBeCloseTo(TRUE_FREQUENCY, 10)
    expect(relativeError(fit.peakToPeakAmplitude, PEAK_TO_PEAK)).toBeLessThan(0.03)
  })

  it('tolerates 40% of samples dropping out at random', () => {
    const random = mulberry32(9)
    const fit = expectSuccess(
      fitSpectralSinusoid(gappySine(() => random() > 0.4), GRID),
    )
    expect(fit.frequencyHz).toBeCloseTo(TRUE_FREQUENCY, 10)
    expect(relativeError(fit.peakToPeakAmplitude, PEAK_TO_PEAK)).toBeLessThan(0.03)
  })

  it('recovers from wildly uneven sample intervals (5 ms alternating with 60 ms)', () => {
    const samples: SpectralSample[] = []
    let t = 0
    for (let i = 0; i < 120; i += 1) {
      samples.push({
        t,
        v: HALF_AMPLITUDE * Math.sin(2 * Math.PI * TRUE_FREQUENCY * t + 0.4),
      })
      t += i % 2 === 0 ? 0.005 : 0.06
    }

    const fit = expectSuccess(fitSpectralSinusoid(samples, GRID))
    expect(fit.frequencyHz).toBeCloseTo(TRUE_FREQUENCY, 10)
    expect(relativeError(fit.peakToPeakAmplitude, PEAK_TO_PEAK)).toBeLessThan(0.03)
  })

  it('drops non-finite samples before the sample-count check', () => {
    const clean = sineSamples({ frequencyHz: 3, sampleRateHz: 50, sampleCount: 81 })
    const polluted: SpectralSample[] = [
      ...clean,
      { t: Number.NaN, v: 5 },
      { t: 0.5, v: Number.NaN },
      { t: Number.POSITIVE_INFINITY, v: 1 },
    ]

    const fit = expectSuccess(fitSpectralSinusoid(polluted, GRID))
    expect(fit.sampleCount).toBe(clean.length)
    expect(fit.spanSeconds).toBeCloseTo(1.6, 6)

    // ...and the same drop happens on the failure side: 10 real samples plus junk is still
    // too few, and the reported count reflects only what was usable.
    const mostlyJunk = fitSpectralSinusoid(
      [
        ...clean.slice(0, 10),
        ...Array.from({ length: 20 }, () => ({ t: Number.NaN, v: Number.NaN })),
      ],
      GRID,
    )
    expect(mostlyJunk).toEqual({
      ok: false,
      reason: 'too-few-samples',
      sampleCount: 10,
      spanSeconds: clean[9].t - clean[0].t,
    })
  })
})

describe('fitSpectralSinusoid — degenerate inputs return typed failures, never NaN', () => {
  function expectFailure(
    result: ReturnType<typeof fitSpectralSinusoid>,
    reason: string,
  ) {
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable — narrowed by the assertion above')
    expect(result.reason).toBe(reason)
    expect(Number.isFinite(result.spanSeconds)).toBe(true)
    expect(Number.isNaN(result.sampleCount)).toBe(false)
  }

  it('empty input is too-few-samples, not a crash', () => {
    expectFailure(fitSpectralSinusoid([], GRID), 'too-few-samples')
  })

  it('5 samples is too-few-samples', () => {
    // Load-bearing, not a formality: 5 samples and 5 free parameters means the model can
    // interpolate the data exactly, which yields R2 = 1 alongside an absurd amplitude — measured
    // at 422 peak-to-peak for a +/-1 signal. No downstream quality gate can catch that.
    expectFailure(
      fitSpectralSinusoid(
        sineSamples({ frequencyHz: 3, sampleRateHz: 10, sampleCount: 5 }),
        GRID,
      ),
      'too-few-samples',
    )
  })

  it('11 samples fails but 12 succeeds — the floor is exactly where it is documented', () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const t = (i * 0.66) / (n - 1)
        return { t, v: HALF_AMPLITUDE * Math.sin(2 * Math.PI * 3 * t) }
      })

    expectFailure(fitSpectralSinusoid(make(11), GRID), 'too-few-samples')
    expect(expectSuccess(fitSpectralSinusoid(make(12), GRID)).sampleCount).toBe(12)
  })

  it('a constant trace is degenerate-signal', () => {
    expectFailure(
      fitSpectralSinusoid(
        Array.from({ length: 40 }, (_, i) => ({ t: i / 30, v: 400 })),
        GRID,
      ),
      'degenerate-signal',
    )
  })

  it('a pure linear ramp is degenerate-signal', () => {
    expectFailure(
      fitSpectralSinusoid(
        Array.from({ length: 40 }, (_, i) => ({ t: i / 30, v: 3 * (i / 30) - 7 })),
        GRID,
      ),
      'degenerate-signal',
    )
  })

  it('a pure quadratic is degenerate-signal', () => {
    expectFailure(
      fitSpectralSinusoid(
        Array.from({ length: 40 }, (_, i) => {
          const t = i / 30
          return { t, v: 3 * t * t - 2 * t + 5 }
        }),
        GRID,
      ),
      'degenerate-signal',
    )
  })

  it('identical timestamps are degenerate-signal', () => {
    expectFailure(
      fitSpectralSinusoid(
        Array.from({ length: 40 }, (_, i) => ({ t: 1, v: i })),
        GRID,
      ),
      'degenerate-signal',
    )
  })

  it('a clip spanning under one cycle is insufficient-cycles, not a fabricated amplitude', () => {
    // 2 Hz over 0.36 s = 0.72 cycles. Every grid candidate slow enough to match the data is too
    // slow to complete a cycle inside the span.
    const samples = Array.from({ length: 20 }, (_, i) => {
      const t = (i * 0.36) / 19
      return { t, v: HALF_AMPLITUDE * Math.sin(2 * Math.PI * 2 * t) }
    })
    expectFailure(fitSpectralSinusoid(samples, GRID), 'insufficient-cycles')
  })

  it('never returns NaN in any reported field, across every fixture above', () => {
    const fixtures: SpectralSample[][] = [
      [],
      sineSamples({ frequencyHz: 3, sampleRateHz: 10, sampleCount: 5 }),
      Array.from({ length: 40 }, (_, i) => ({ t: i / 30, v: 400 })),
      Array.from({ length: 40 }, (_, i) => ({ t: 1, v: i })),
      sineSamples({ frequencyHz: 3, sampleRateHz: 50, sampleCount: 81 }),
    ]

    for (const fixture of fixtures) {
      const result = fitSpectralSinusoid(fixture, GRID)
      for (const value of Object.values(result)) {
        if (typeof value === 'number') expect(Number.isNaN(value)).toBe(false)
      }
    }
  })
})

describe('fitSpectralSinusoid — quality diagnostics', () => {
  it('scores pure noise well below the 0.30 partial-R2 gate for every fixed seed', () => {
    // Measured over 2000 seeds at n = 50: median 0.115, p95 0.217, p99 0.283. The gate at 0.30
    // therefore rejects roughly 99.4% of pure-noise traces — a filter, not a guarantee (12 of
    // those 2000 seeds did clear 0.30). These eight are fixed so the assertion is deterministic.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const noise = seededNormals(seed, 50)
      const fit = expectSuccess(
        fitSpectralSinusoid(
          noise.map((v, i) => ({ t: i / 30, v })),
          GRID,
        ),
      )
      expect(fit.sinusoidR2).toBeLessThan(0.3)
    }
  })

  it('reports a secondPeakRatio in [0, 1] that is higher for a two-tone signal', () => {
    const single = sineSamples({
      frequencyHz: 3,
      sampleRateHz: 50,
      sampleCount: 150,
    })
    const dual = single.map(({ t, v }) => ({
      t,
      v: v + (HALF_AMPLITUDE / 2) * Math.sin(2 * Math.PI * 1.6 * t + 1),
    }))

    const singleFit = expectSuccess(fitSpectralSinusoid(single, GRID))
    const dualFit = expectSuccess(fitSpectralSinusoid(dual, GRID))

    for (const fit of [singleFit, dualFit]) {
      expect(fit.secondPeakRatio).toBeGreaterThanOrEqual(0)
      expect(fit.secondPeakRatio).toBeLessThanOrEqual(1)
    }
    expect(dualFit.secondPeakRatio).toBeGreaterThan(singleFit.secondPeakRatio)
    // The dominant tone still wins outright.
    expect(dualFit.frequencyHz).toBeCloseTo(3, 10)
  })

  it('never invents an amplitude far beyond the observed spread of the values', () => {
    const random = mulberry32(9)
    const noise = seededNormals(4, 100)
    const fixtures: Array<[string, SpectralSample[]]> = [
      ['clean', sineSamples({ frequencyHz: 3, sampleRateHz: 50, sampleCount: 81, phase: 0.7 })],
      [
        'noisy',
        sineSamples({ frequencyHz: 2.5, sampleRateHz: 50, sampleCount: 100 }).map(
          (sample, i) => ({ t: sample.t, v: sample.v + 1.5 * noise[i] }),
        ),
      ],
      [
        'drifted',
        sineSamples({ frequencyHz: 2.5, sampleRateHz: 50, sampleCount: 100 }).map(
          ({ t, v }) => ({ t, v: v + 500 + 300 * t + 200 * t * t }),
        ),
      ],
      [
        'dropout',
        sineSamples({ frequencyHz: 2.6, sampleRateHz: 50, sampleCount: 150 }).filter(
          () => random() > 0.4,
        ),
      ],
    ]

    for (const [label, samples] of fixtures) {
      const fit = expectSuccess(fitSpectralSinusoid(samples, GRID))
      const values = samples.map((s) => s.v)
      const observedSpread = Math.max(...values) - Math.min(...values)
      // Deliberately a ratio bound rather than a hard <=: a least-squares fit recovers the TRUE
      // amplitude even when no sample lands exactly on a peak, so on a discretely-sampled sine the
      // fitted peak-to-peak legitimately exceeds the observed spread. The worst case is analytic —
      // the nearest sample to a peak can sit up to half a sample interval away, so the ratio ceiling
      // is 1 / cos(pi * f / fs): 1.00004x for these 50 Hz fixtures, but ~1.09x in this app's actual
      // production regime (a 3 Hz bounce sampled at 30 fps). 1.15x covers that with headroom while
      // still catching an under-determined blowup, which runs two orders of magnitude past it.
      expect(fit.peakToPeakAmplitude, label).toBeLessThanOrEqual(observedSpread * 1.15)
    }
  })
})

describe('fitSpectralSinusoid — phase', () => {
  /** Where the fitted sinusoid peaks, as a continuous time: `A·sin(ω(t − tMean) + φ)` is maximal
   * where its argument is `π/2`. This is the reconstruction every caller of `phaseRadians`
   * performs, so testing it here tests the field's contract rather than its arithmetic. */
  function reconstructedMaximum(fit: SpectralFitSuccess): number {
    const omega = 2 * Math.PI * fit.frequencyHz
    return fit.tMeanSeconds + (Math.PI / 2 - fit.phaseRadians) / omega
  }

  /** Distance between two instants on a circle of one period — a maximum recurs every period, so
   * "the same peak" and "the peak one cycle later" must compare equal. */
  function circularDistance(a: number, b: number, period: number): number {
    const wrapped = (((a - b) % period) + period) % period
    return Math.min(wrapped, period - wrapped)
  }

  it('reconstructs the input sinusoid’s own peaks, at every phase', () => {
    const frequencyHz = 2
    for (const phase of [0, 0.7, Math.PI / 2, 2.5, -1.3, Math.PI]) {
      const samples = sineSamples({
        frequencyHz,
        sampleRateHz: 60,
        sampleCount: 120,
        phase,
      })
      const fit = expectSuccess(fitSpectralSinusoid(samples, GRID))
      // `halfAmplitude·sin(2πf·t + phase)` peaks where `2πf·t + phase = π/2`.
      const trueMaximum = (Math.PI / 2 - phase) / (2 * Math.PI * frequencyHz)
      expect(
        circularDistance(reconstructedMaximum(fit), trueMaximum, 1 / frequencyHz),
        `phase ${phase}`,
      ).toBeLessThan(1e-6)
    }
  })

  it('measures phase from tMeanSeconds, which is the mean of the USABLE sample times', () => {
    const clean = sineSamples({ frequencyHz: 2, sampleRateHz: 60, sampleCount: 120 })
    const polluted = [
      ...clean,
      ...Array.from({ length: 8 }, () => ({ t: Number.NaN, v: 3 })),
      { t: 500, v: Number.POSITIVE_INFINITY },
    ]
    const expectedMean = clean.reduce((sum, s) => sum + s.t, 0) / clean.length

    for (const samples of [clean, polluted]) {
      const fit = expectSuccess(fitSpectralSinusoid(samples, GRID))
      expect(fit.tMeanSeconds).toBeCloseTo(expectedMean, 12)
    }
  })

  it('shifts phase, not frequency or amplitude, when the whole series is delayed', () => {
    const base = expectSuccess(
      fitSpectralSinusoid(
        sineSamples({ frequencyHz: 2, sampleRateHz: 60, sampleCount: 120 }),
        GRID,
      ),
    )
    const delay = 0.37
    const delayed = expectSuccess(
      fitSpectralSinusoid(
        sineSamples({
          frequencyHz: 2,
          sampleRateHz: 60,
          sampleCount: 120,
          timeOffset: delay,
        }),
        GRID,
      ),
    )

    expect(delayed.frequencyHz).toBe(base.frequencyHz)
    expect(delayed.peakToPeakAmplitude).toBeCloseTo(base.peakToPeakAmplitude, 9)
    expect(delayed.tMeanSeconds).toBeCloseTo(base.tMeanSeconds + delay, 9)
    // Centring absorbs the delay entirely: same waveform, same phase relative to the new centre.
    expect(delayed.phaseRadians).toBeCloseTo(base.phaseRadians, 9)
    expect(reconstructedMaximum(delayed)).toBeCloseTo(reconstructedMaximum(base) + delay, 9)
  })

  /**
   * Frozen regression anchor. Every constant below was MEASURED on the tree immediately before
   * `phaseRadians`/`tMeanSeconds` were added, then pinned with exact equality — this primitive is
   * read by `cadence` and all three vertical-oscillation metrics, so a refactor that perturbs its
   * return path by one ulp changes four user-visible numbers at once. `toBe`, not `toBeCloseTo`:
   * the point is bit-identity, and a tolerance here would hide exactly what it exists to catch.
   */
  it('holds every pre-existing field bit-identical on a fixed noisy input', () => {
    const noise = seededNormals(20260817, 60)
    const samples: SpectralSample[] = Array.from({ length: 60 }, (_, i) => {
      const t = i / 25
      return {
        t,
        v: 640 + 21 * Math.sin(2 * Math.PI * 1.52 * t + 0.7) + 4 * t + 2.5 * noise[i],
      }
    })

    const fit = expectSuccess(fitSpectralSinusoid(samples, GRID))
    expect(fit.peakToPeakAmplitude).toBe(44.01056838073015)
    expect(fit.frequencyHz).toBe(1.52)
    expect(fit.sinusoidR2).toBe(0.9786118881581739)
    expect(fit.totalR2).toBe(0.9789921953138012)
    expect(fit.secondPeakRatio).toBe(0.03840339414971118)
    expect(fit.sampleCount).toBe(60)
    expect(fit.spanSeconds).toBe(2.36)
    expect(fit.observedCycles).toBe(3.5871999999999997)

    // The two new fields, pinned alongside so their own drift is caught too — and cross-checked
    // against the fixture's KNOWN phase of 0.7 rad, which is the only independent evidence that
    // `atan2(b, a)` was read off the right two coefficients in the right order.
    expect(fit.phaseRadians).toBe(-0.6016749041829399)
    expect(fit.tMeanSeconds).toBe(1.1799999999999997)
    const omega = 2 * Math.PI * fit.frequencyHz
    const phaseAtOrigin = fit.phaseRadians - omega * fit.tMeanSeconds
    const wrapped = (((phaseAtOrigin - 0.7) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    expect(Math.min(wrapped, 2 * Math.PI - wrapped)).toBeLessThan(0.02)
  })
})
