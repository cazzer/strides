import { describe, expect, it } from 'vitest'
import { computeVerticalOscillation } from './verticalOscillation'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { applyRobustness } from '../pose/robustness/interpolate'
import type { PoseSample } from '../pose/robustness/types'
import type { RobustKeypoint, RobustPoseFrame } from '../pose/robustness/types'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type { Keypoint, PoseFrame } from '../pose/types'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  trunkLeanDeg: 5,
}

/** Fixed torso length, matching the synthetic-gait fixture's own constant. */
const TORSO_LENGTH_PX = 150

/**
 * Minimal fully-detected frames carrying an arbitrary hip-y trace, with shoulders held a rigid
 * TORSO_LENGTH_PX above the hips so `estimateBodyScale` always resolves to exactly that. Used where
 * the point of the test is the shape of the hip signal itself (noise, a sub-cycle clip), which the
 * parametric gait fixture can't express.
 */
function framesFromHipTrace(
  samples: Array<{ t: number; y: number }>,
): RobustPoseFrame[] {
  return samples.map(({ t, y }) => {
    const keypoints: RobustKeypoint[] = COMMON_KEYPOINT_NAMES.map((name) => {
      const isHip = name === 'left_hip' || name === 'right_hip'
      const isShoulder = name === 'left_shoulder' || name === 'right_shoulder'
      return {
        name,
        x: 200,
        y: isHip ? y : isShoulder ? y - TORSO_LENGTH_PX : y + 50,
        score: 0.9,
        status: 'detected' as const,
      }
    })
    return { timestamp: t, keypoints, source: 'detected' as const, pixelsPerMeter: null }
  })
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

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

describe('computeVerticalOscillation', () => {
  it('a clean side-view clip: value close to verticalBouncePx / torsoLengthPx, confidence 1', () => {
    // TORSO_LENGTH_PX = 150 (fixed in the fixture generator), verticalBouncePx = 20 peak-to-peak,
    // so the expected torso-normalized value is 20/150 = 0.1333. The spectral fit recovers this to
    // ~3 decimals — its only error is that the fixture's true 2.8333 Hz bounce falls between the
    // 2.82 and 2.84 grid points, worth about 0.1% of amplitude. (The old extrema estimator could
    // only be asserted to 1 decimal, since it reported whichever raw sample happened to land
    // nearest each peak.)
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 20, view: 'side' })

    const result = computeVerticalOscillation(frames, 'side')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(20 / 150, 3)
    expect(result.frameCoverage).toBe(1)
    expect(result.interpolatedFraction).toBe(0)
    // 4 s at 170 steps/min bounces twice per gait cycle -> ~11 complete cycles observed.
    expect(result.sampleSize).toBe(11)
    // side view multiplier 1.0, full coverage, no interpolation, sampleSize capped at 1, and a
    // near-perfect fit -> every confidence factor is exactly 1.
    expect(result.confidence).toBeCloseTo(1)
    expect(result.viewFit).toBe('primary')
    expect(result.caveat).toBeNull()
    expect(result.series).toHaveLength(frames.length)
    expect(result.series.every((point) => point.value !== null)).toBe(true)
    expect(result.series.map((point) => point.timestamp)).toEqual(
      frames.map((frame) => frame.timestamp),
    )
    expect(result.fit).not.toBeNull()
    expect(result.fit?.frequencyHz).toBeCloseTo(2.83, 1)
    expect(result.fit?.sinusoidR2).toBeGreaterThan(0.99)
    expect(result.fit?.peakToPeakAmplitudePx).toBeCloseTo(20, 1)
  })

  it('a front-view clip: still a reasonable value, confidence discounted by the 0.85 multiplier', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 20, view: 'front' })

    const result = computeVerticalOscillation(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(20 / 150, 3)
    // Same reasoning as the side-view case, but viewFitMultiplier is 0.85 instead of 1.0.
    expect(result.confidence).toBeCloseTo(0.85)
    expect(result.viewFit).toBe('tolerated')
    expect(result.series).toHaveLength(frames.length)
  })

  it('a heavily-interpolated/unrecoverable stream: reduced confidence, no crash, a non-null value', () => {
    const strideFreqHz = 170 / 120
    const fps = 30
    const frameCount = 120 // 4 seconds

    function rawFrame(t: number): PoseFrame {
      const hipY = 400 + 20 * Math.sin(2 * Math.PI * 2 * strideFreqHz * t)
      const shoulderY = hipY - 150
      const keypoints: Keypoint[] = COMMON_KEYPOINT_NAMES.map((name) => {
        if (name === 'left_hip' || name === 'right_hip') {
          return { name, x: 200, y: hipY, score: 0.9 }
        }
        if (name === 'left_shoulder' || name === 'right_shoulder') {
          return { name, x: 200, y: shoulderY, score: 0.9 }
        }
        return { name, x: 200, y: 400, score: 0.9 }
      })
      return { keypoints, timestamp: t }
    }

    // Two 1-second gaps (indices [20,50) and [70,100), 30 samples each at 30fps) -- well beyond
    // the robustness layer's default 0.5s maxGapSeconds, so these become genuinely
    // 'unrecoverable', not merely 'interpolated'. ~50% of frames remain resolvable.
    const samples: PoseSample[] = Array.from({ length: frameCount }, (_, i) => {
      const t = i / fps
      const inGap = (i >= 20 && i < 50) || (i >= 70 && i < 100)
      return { timestamp: t, frame: inGap ? null : rawFrame(t) }
    })

    const robustFrames = applyRobustness(samples)

    expect(() => computeVerticalOscillation(robustFrames, 'side')).not.toThrow()
    const result = computeVerticalOscillation(robustFrames, 'side')

    expect(result.frameCoverage).toBeCloseTo(0.5, 1)
    expect(result.value).not.toBeNull()
    expect(result.sampleSize).toBeGreaterThan(0)
    // Visibly reduced from the ~1.0 a clean, fully-resolvable clip would get.
    expect(result.confidence).toBeLessThan(0.9)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.series).toHaveLength(robustFrames.length)
    // The two gapped stretches were unrecoverable — a real gap, not interpolated for charting.
    expect(result.series.some((point) => point.value === null)).toBe(true)
    // Gaps cost coverage, not accuracy: the fit spans them without resampling.
    expect(result.value).toBeCloseTo(40 / 150, 2)
  })

  it('returns a null value and 0 confidence when no hip position is resolvable at all', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 20, view: 'side' })
    // Strip every frame's hip keypoints down to unrecoverable.
    const stripped = frames.map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === 'left_hip' || kp.name === 'right_hip'
          ? { ...kp, x: null, y: null, score: 0, status: 'unrecoverable' as const }
          : kp,
      ),
    }))

    const result = computeVerticalOscillation(stripped, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).not.toBeNull()
    expect(result.fit).toBeNull()
    // Stripping hips also makes bodyScale unresolvable (it needs hip+shoulder together in the
    // same frame) — per the `series` contract, empty only when bodyScale is null, which is
    // exactly the case here.
    expect(result.series).toEqual([])
  })

  it('populates series even when the hip trace has no oscillation to fit', () => {
    // Zero bounce amplitude: hip position is fully tracked (body scale resolves), but the trace is
    // a pure trend the fit's polynomial terms explain exactly, leaving nothing for a sinusoid.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 0, view: 'side' })

    const result = computeVerticalOscillation(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.sampleSize).toBe(0)
    expect(result.fit).toBeNull()
    expect(result.caveat).toMatch(/no oscillating vertical motion/i)
    expect(result.series).toHaveLength(frames.length)
    expect(result.series.every((point) => point.value !== null)).toBe(true)
  })

  it('reports no value for a clip too short to contain one complete bounce cycle', () => {
    // 1.4 Hz bounce over 0.6 s is 0.84 cycles. Reporting an amplitude here would be reporting a
    // number extrapolated from less than one oscillation.
    const shortFrames = framesFromHipTrace(
      Array.from({ length: 25 }, (_, i) => {
        const t = (i * 0.6) / 24
        return { t, y: 400 + 10 * Math.sin(2 * Math.PI * 1.4 * t) }
      }),
    )

    const result = computeVerticalOscillation(shortFrames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.fit).toBeNull()
    expect(result.caveat).toMatch(/too short to contain a complete bounce cycle/i)
    expect(result.series).toHaveLength(shortFrames.length)
  })

  it('reports no value, naming both the measured fit quality and the threshold, for a noise-only trace', () => {
    const noise = seededNormals(3, 90)
    const frames = framesFromHipTrace(
      noise.map((n, i) => ({ t: i / 30, y: 400 + 12 * n })),
    )

    const result = computeVerticalOscillation(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.fit).toBeNull()
    expect(result.caveat).toMatch(/no consistent bounce rhythm could be fit/i)
    // Both numbers, so a reader can see how far short the fit fell rather than just that it did.
    expect(result.caveat).toMatch(/fit quality 0\.\d\d/)
    expect(result.caveat).toMatch(/below the 0\.30 minimum/)
    expect(result.series).toHaveLength(frames.length)
  })

  it('a marginal-but-usable fit reports a value with reduced confidence and a fit-quality caveat', () => {
    // A real 2.6 Hz bounce buried in noise of 0.6x its own half-amplitude: enough structure to
    // clear the 0.30 gate comfortably, not enough to reach the 0.80 saturation point.
    const noise = seededNormals(7, 90)
    const frames = framesFromHipTrace(
      Array.from({ length: 90 }, (_, i) => {
        const t = i / 30
        return { t, y: 400 + 10 * Math.sin(2 * Math.PI * 2.6 * t) + 6 * noise[i] }
      }),
    )

    const result = computeVerticalOscillation(frames, 'side')

    expect(result.value).not.toBeNull()
    expect(result.fit).not.toBeNull()
    const sinusoidR2 = result.fit?.sinusoidR2 ?? 0
    expect(sinusoidR2).toBeGreaterThan(0.3)
    expect(sinusoidR2).toBeLessThan(0.8)
    // Every other factor is 1 here (side view, full coverage, no interpolation, ample cycles), so
    // confidence is the fit-quality ramp on its own.
    expect(result.confidence).toBeCloseTo((sinusoidR2 - 0.3) / (0.8 - 0.3), 5)
    expect(result.confidence).toBeLessThan(1)
    expect(result.caveat).toMatch(/fit quality is 0\.\d\d/i)
  })

  it('a clip covering only two cycles reports sampleSize 2 and the corresponding confidence penalty', () => {
    // 2.5 Hz over 0.9 s = 2.25 cycles, against a default minimum of 3.
    const frames = framesFromHipTrace(
      Array.from({ length: 28 }, (_, i) => {
        const t = i / 30
        return { t, y: 400 + 10 * Math.sin(2 * Math.PI * 2.5 * t) }
      }),
    )

    const result = computeVerticalOscillation(frames, 'side')

    expect(result.value).toBeCloseTo(20 / 150, 3)
    expect(result.sampleSize).toBe(2)
    // Only the sample-size factor is below 1, and it uses the UNROUNDED cycle count: the clip spans
    // 0.9 s at 2.5 Hz = 2.25 cycles, so 2.25/3 = 0.75 — not 2/3. Flooring here would make 2.99
    // cycles and 2.01 cycles score identically, a cliff smaller than the fit's own frequency
    // resolution.
    expect(result.fit?.observedCycles).toBeCloseTo(2.25, 6)
    expect(result.confidence).toBeCloseTo(0.75, 5)
    expect(result.caveat).toMatch(/only 2 complete bounce cycle/i)
    expect(result.caveat).toMatch(/recommend at least 3/i)
  })

  it('holds the fit/value invariant and never produces NaN, across every shape of input', () => {
    const noise = seededNormals(5, 60)
    const fixtures: RobustPoseFrame[][] = [
      [],
      generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 20, view: 'side' }),
      generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 0, view: 'side' }),
      generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 20, view: 'front' }),
      framesFromHipTrace(noise.map((n, i) => ({ t: i / 30, y: 400 + 12 * n }))),
      // Fewer samples than the fit's floor, and a pure ramp at that.
      framesFromHipTrace([400, 401, 402, 403, 404].map((y, i) => ({ t: i / 30, y }))),
    ]

    for (const frames of fixtures) {
      for (const view of ['side', 'front', 'ambiguous'] as const) {
        const result = computeVerticalOscillation(frames, view)
        expect(result.fit === null).toBe(result.value === null)
        expect(Number.isNaN(result.value ?? 0)).toBe(false)
        expect(Number.isNaN(result.confidence)).toBe(false)
        expect(Number.isNaN(result.sampleSize)).toBe(false)
        if (result.value === null) expect(result.confidence).toBe(0)
        for (const point of result.series) {
          expect(Number.isNaN(point.value ?? 0)).toBe(false)
        }
      }
    }
  })
})
