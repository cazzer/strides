import { describe, expect, it } from 'vitest'
import { computeKneeFlexion } from './kneeFlexion'
import { buildFrame } from './__fixtures__/testFrames'
import type { RobustPoseFrame } from '../pose/robustness/types'

const LEFT_HIP = { x: 190, y: 400 }
const RIGHT_HIP = { x: 210, y: 400 }
const LEFT_ANKLE = { x: 190, y: 600 }
const RIGHT_ANKLE = { x: 210, y: 600 }

/**
 * One flexion/extension cycle's horizontal knee offset from the hip, sampled at 20 steps: ramps
 * 0->100 (5 steps), holds at 100 for 3 steps, ramps 100->0 (5 steps), holds at 0 for 7 steps. With
 * hip and ankle 200px apart vertically and the knee held at the vertical midpoint between them
 * (see `kneeAt`), offset=0 puts hip/knee/ankle exactly collinear (interior angle 180°, i.e. 0°
 * flexion) and offset=100 is an exact analytic right angle at the knee (interior angle 90°, i.e.
 * 90° flexion) -- verified independently via the law of cosines, not just the atan2 implementation
 * under test. The hold plateaus guarantee the true peak/trough value is actually sampled, not just
 * approached, so expected values are exact rather than "close to".
 */
const CYCLE_OFFSETS = [
  0, 20, 40, 60, 80, 100, 100, 100, 80, 60, 40, 20, 0, 0, 0, 0, 0, 0, 0, 0,
]

function kneeAt(hipX: number, offset: number): { x: number; y: number } {
  return { x: hipX + offset, y: 500 }
}

/** `cycles` repeats of `CYCLE_OFFSETS`, both legs bending in sync (gait realism isn't the point --
 * isolating the metric's per-leg extrema detection and pooled-median aggregation is). */
function buildKneeFlexionFrames(cycles: number): RobustPoseFrame[] {
  const period = CYCLE_OFFSETS.length
  const frames: RobustPoseFrame[] = []
  for (let i = 0; i < period * cycles; i += 1) {
    const offset = CYCLE_OFFSETS[i % period]
    frames.push(
      buildFrame(
        {
          left_hip: LEFT_HIP,
          right_hip: RIGHT_HIP,
          left_knee: kneeAt(LEFT_HIP.x, offset),
          right_knee: kneeAt(RIGHT_HIP.x, offset),
          left_ankle: LEFT_ANKLE,
          right_ankle: RIGHT_ANKLE,
        },
        i / 30,
      ),
    )
  }
  return frames
}

describe('computeKneeFlexion', () => {
  it('a clean side-view clip: median peak flexion is exactly 90°, high confidence', () => {
    const frames = buildKneeFlexionFrames(3)

    const result = computeKneeFlexion(frames, 'side')

    expect(result.value).toBeCloseTo(90, 5)
    expect(result.unit).toBe('degrees')
    expect(result.viewFit).toBe('primary')
    // 3 cycles * 2 legs = 6 pooled peaks, well over MIN_KNEE_FLEXION_SAMPLE_SIZE (4).
    expect(result.sampleSize).toBe(6)
    expect(result.frameCoverage).toBe(1)
    expect(result.interpolatedFraction).toBe(0)
    expect(result.confidence).toBeCloseTo(1, 5)
    expect(result.caveat).toBeNull()
  })

  it('a front-view clip: value still computed, viewFit unsuitable, confidence discounted to the 0.1 multiplier', () => {
    const frames = buildKneeFlexionFrames(3)

    const result = computeKneeFlexion(frames, 'front')

    expect(result.value).not.toBeNull() // still computed, per "never a silent wrong number"
    expect(result.value).toBeCloseTo(90, 5)
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toContain('front view')
  })

  it('resolvable but never bends: no detectable swing-phase peak, null value, no crash', () => {
    // Knee held exactly collinear with hip/ankle (offset 0) on every frame -- a flat 0°-flexion
    // trace with no prominence-confirmed extrema at all.
    const frame = buildFrame({
      left_hip: LEFT_HIP,
      right_hip: RIGHT_HIP,
      left_knee: kneeAt(LEFT_HIP.x, 0),
      right_knee: kneeAt(RIGHT_HIP.x, 0),
      left_ankle: LEFT_ANKLE,
      right_ankle: RIGHT_ANKLE,
    })
    const frames = Array.from({ length: 20 }, () => frame)

    expect(() => computeKneeFlexion(frames, 'side')).not.toThrow()
    const result = computeKneeFlexion(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).not.toBeNull()
  })

  it('returns a null value and 0 confidence when no leg position is resolvable at all', () => {
    const frame = buildFrame({})
    const result = computeKneeFlexion([frame, frame], 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).not.toBeNull()
  })
})
