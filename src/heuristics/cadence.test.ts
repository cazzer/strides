import { describe, expect, it } from 'vitest'
import { computeCadence } from './cadence'
import { analyzeHipBounce } from './hipBounce'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'
import { framesFromHipTrace, seededNormals } from './__fixtures__/hipTraceFrames'
import { detectFootstrikes } from './footstrikes'
import { median } from './mathUtils'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { RobustPoseFrame } from '../pose/robustness/types'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  verticalBouncePx: 20,
  trunkLeanDeg: 5,
}

/** Sets a frame's hip keypoints to unrecoverable — the same technique
 * `verticalOscillation.test.ts` uses to simulate a tracking gap, reused here so cadence's fit
 * (which reads the identical hip signal) can be tested against the same kind of gap. */
function stripHips(frame: RobustPoseFrame): RobustPoseFrame {
  return {
    ...frame,
    keypoints: frame.keypoints.map((kp) =>
      kp.name === 'left_hip' || kp.name === 'right_hip'
        ? { ...kp, x: null, y: null, score: 0, status: 'unrecoverable' as const }
        : kp,
    ),
  }
}

describe('computeCadence', () => {
  it('1. a clean side-view clip: value from the fitted step frequency, high confidence, no caveat', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'side' })

    const result = computeCadence(frames, 'side')

    expect(result.value).not.toBeNull()
    expect(Math.abs(result.value! - 170)).toBeLessThan(1.2)
    expect(result.sampleSize).toBe(11)
    expect(result.viewFit).toBe('primary')
    expect(result.interpolatedFraction).toBe(0)
    expect(result.confidence).toBeGreaterThan(0.9)
    expect(result.caveat).toBeNull()
  })

  it('2. recovers the true cadence across a range of speeds', () => {
    for (const cadenceStepsPerMin of [120, 170, 200]) {
      const frames = generateSyntheticGait({ ...BASE_PARAMS, cadenceStepsPerMin, view: 'side' })
      const result = computeCadence(frames, 'side')

      expect(result.value).not.toBeNull()
      expect(Math.abs(result.value! - cadenceStepsPerMin)).toBeLessThan(1.2)
    }
  })

  it('3. on the clean fixture, the old footstrike-interval formula agrees with the new spectral value within a couple spm', () => {
    // Documents that the two approaches diverge only on the real, noisier footage the old
    // estimator over-triggered on (see cadence.ts's module doc) — on a clean, geometrically
    // perfect synthetic clip with no spurious footstrikes, they should land close together.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'side' })
    const result = computeCadence(frames, 'side')

    const candidates = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)
    const intervals = candidates.slice(1).map((c, i) => c.timestamp - candidates[i].timestamp)
    const oldPathValue = 60 / median(intervals)

    expect(result.value).not.toBeNull()
    expect(Math.abs(result.value! - oldPathValue)).toBeLessThan(3)
  })

  it('4. mid-clip gaps (a contiguous hole and a scattered dropout) are fitted without resampling', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'side' })
    const gapped = frames.map((frame, i) => {
      const inContiguousHole = i >= 40 && i < 49 // ~0.3s at 30fps
      const inScatteredDropout = i % 3 === 0
      return inContiguousHole || inScatteredDropout ? stripHips(frame) : frame
    })

    const baseline = computeCadence(frames, 'side')
    const withGaps = computeCadence(gapped, 'side')

    expect(baseline.value).not.toBeNull()
    expect(withGaps.value).not.toBeNull()
    expect(Math.abs(withGaps.value! - baseline.value!)).toBeLessThan(3)
    expect(withGaps.frameCoverage).toBeLessThan(1)
  })

  it('5. dead time before the first or after the last observation does not shift cadence', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'side' })
    const unresolvedFrame = buildFrame({})
    const fps = BASE_PARAMS.fps
    const padSeconds = 3
    const padCount = padSeconds * fps

    const leadingPad = Array.from({ length: padCount }, (_, i) => ({
      ...unresolvedFrame,
      timestamp: -padSeconds + i / fps,
    }))
    const trailingPad = Array.from({ length: padCount }, (_, i) => ({
      ...unresolvedFrame,
      timestamp: frames[frames.length - 1].timestamp + (i + 1) / fps,
    }))
    const padded = [...leadingPad, ...frames, ...trailingPad]

    const baseline = computeCadence(frames, 'side')
    const withDeadTime = computeCadence(padded, 'side')

    expect(withDeadTime.value).not.toBeNull()
    expect(withDeadTime.value).toBeCloseTo(baseline.value!, 5)
  })

  it('6. a clip too short to contain one complete step reports no value', () => {
    // 1.4 Hz bounce over 0.6 s is 0.84 cycles — under one complete step.
    const shortFrames = framesFromHipTrace(
      Array.from({ length: 25 }, (_, i) => {
        const t = (i * 0.6) / 24
        return { t, y: 400 + 10 * Math.sin(2 * Math.PI * 1.4 * t) }
      }),
    )

    const result = computeCadence(shortFrames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toMatch(/too short to contain a complete step/i)
  })

  it('7. a noise-only trace reports no value, saying the step rhythm was too irregular to measure', () => {
    const noise = seededNormals(3, 90)
    const frames = framesFromHipTrace(noise.map((n, i) => ({ t: i / 30, y: 400 + 12 * n })))

    const result = computeCadence(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toBe(
      'Hip position was tracked, but the step rhythm was too irregular to measure.',
    )
  })

  it('8. a marginal-but-usable fit reports a value whose confidence is exactly the fit-quality ramp', () => {
    // A real 2.6 Hz step rhythm buried in noise of 0.6x its own half-amplitude — the same fixture
    // shape verticalOscillation.test.ts uses for its own marginal-fit case.
    const noise = seededNormals(7, 90)
    const frames = framesFromHipTrace(
      Array.from({ length: 90 }, (_, i) => {
        const t = i / 30
        return { t, y: 400 + 10 * Math.sin(2 * Math.PI * 2.6 * t) + 6 * noise[i] }
      }),
    )

    const result = computeCadence(frames, 'side')
    const hipBounce = analyzeHipBounce(frames, DEFAULT_HEURISTICS_CONFIG)
    if (!hipBounce.fit.ok) throw new Error('expected a successful fit for this fixture')
    const sinusoidR2 = hipBounce.fit.sinusoidR2

    expect(result.value).not.toBeNull()
    expect(sinusoidR2).toBeGreaterThan(0.3)
    expect(sinusoidR2).toBeLessThan(0.8)
    // Every other factor is 1 here (side view, full coverage, no interpolation, ample steps), so
    // confidence is the fit-quality ramp on its own.
    expect(result.confidence).toBeCloseTo((sinusoidR2 - 0.3) / (0.8 - 0.3), 5)
    expect(result.confidence).toBeLessThan(1)
    expect(result.caveat).toMatch(/step rhythm in this clip was too irregular to read confidently/i)
  })

  it('9. a clip covering only 2.25 steps reports sampleSize 2 and confidence from the unrounded count', () => {
    // 2.5 Hz over 0.9 s = 2.25 steps, against a default minimum of 4 -- locks unrounded-vs-floored
    // the same way verticalOscillation.test.ts's analogous case does for its own (lower) minimum.
    const frames = framesFromHipTrace(
      Array.from({ length: 28 }, (_, i) => {
        const t = i / 30
        return { t, y: 400 + 10 * Math.sin(2 * Math.PI * 2.5 * t) }
      }),
    )

    const result = computeCadence(frames, 'side')

    expect(result.value).not.toBeNull()
    expect(result.sampleSize).toBe(2)
    // 2.25 / 4 = 0.5625, not 2/4 -- flooring first would understate confidence.
    expect(result.confidence).toBeCloseTo(0.5625, 4)
    expect(result.caveat).toMatch(/only 2 step/i)
    expect(result.caveat).toMatch(/recommend at least 4/i)
  })

  it('10. a clip fitting at either edge of the searched frequency band is caveated', () => {
    const highFrames = framesFromHipTrace(
      Array.from({ length: 60 }, (_, i) => {
        const t = i / 30
        return { t, y: 400 + 15 * Math.sin(2 * Math.PI * 4.0 * t) }
      }),
    )
    const lowFrames = framesFromHipTrace(
      Array.from({ length: 60 }, (_, i) => {
        const t = i / 30
        return { t, y: 400 + 15 * Math.sin(2 * Math.PI * 1.2 * t) }
      }),
    )

    const high = computeCadence(highFrames, 'side')
    const low = computeCadence(lowFrames, 'side')

    expect(high.value).not.toBeNull()
    expect(high.value).toBeCloseTo(240, 0)
    expect(high.caveat).toMatch(/edge of what this analysis can measure/i)
    expect(high.caveat).toMatch(/true value may fall outside it/i)

    expect(low.value).not.toBeNull()
    expect(low.value).toBeCloseTo(72, 0)
    expect(low.caveat).toMatch(/edge of what this analysis can measure/i)
  })

  it('11. view tolerance: front reproduces the side value exactly; multipliers are 0.85/0.6', () => {
    const sideFrames = generateSyntheticGait({ ...BASE_PARAMS, view: 'side' })
    const frontFrames = generateSyntheticGait({ ...BASE_PARAMS, view: 'front' })

    const side = computeCadence(sideFrames, 'side')
    const front = computeCadence(frontFrames, 'front')
    const ambiguous = computeCadence(sideFrames, 'ambiguous')

    expect(side.viewFit).toBe('primary')
    expect(front.value).not.toBeNull()
    expect(front.viewFit).toBe('tolerated')
    // The hip-mid trace is identical between the side and front fixtures (only x-geometry
    // differs, which cadence's hip-y signal never reads) -- so the fitted frequency, and
    // therefore the reported value, is byte-identical.
    expect(front.value).toBe(side.value)
    expect(front.confidence).toBeCloseTo(side.confidence * 0.85, 10)

    expect(ambiguous.value).not.toBeNull()
    expect(ambiguous.viewFit).toBe('tolerated')
    expect(ambiguous.value).toBe(side.value)
    expect(ambiguous.confidence).toBeCloseTo(side.confidence * 0.6, 10)
  })

  it('12. never throws and never produces NaN, across every shape of input and every view', () => {
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
        expect(() => computeCadence(frames, view)).not.toThrow()
        const result = computeCadence(frames, view)
        expect(Number.isNaN(result.value ?? 0)).toBe(false)
        expect(Number.isNaN(result.confidence)).toBe(false)
        expect(Number.isNaN(result.sampleSize)).toBe(false)
        if (result.value === null) expect(result.confidence).toBe(0)
      }
    }
  })

  it('13. returns a null value and 0 confidence when no hip position is resolvable at all', () => {
    const frame = buildFrame({})
    const result = computeCadence([frame, { ...frame, timestamp: 1 }], 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toMatch(/hip position/i)
  })
})
