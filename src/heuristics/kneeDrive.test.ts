import { describe, expect, it } from 'vitest'
import { computeKneeDrive } from './kneeDrive'
import { buildFrame } from './__fixtures__/testFrames'
import type { RobustPoseFrame } from '../pose/robustness/types'

const THIGH_LENGTH_PX = 200
const HIP_Y = 400
const SHOULDER_Y = 200 // 200px torso, so estimateBodyScale reads a stable scale reference.
const FRAME_STEP_X = 5 // 5px/frame of hip travel: 60 frames = 300px, well past the half-torso bar.

/**
 * One lift/trail cycle's thigh angle in degrees from the down-vertical (positive = toward
 * +screen-x), sampled at 20 steps: ramps 0→50 (5 steps), holds at 50 for 3, ramps back down
 * through 0 to −20 (7 steps), holds at −20 for 3, returns to 0 (2 steps). The hold plateaus
 * guarantee the true peak/trough value is actually sampled, not just approached, so expected
 * values are exact rather than "close to" — the same trick `kneeFlexion.test.ts`'s cycle uses.
 *
 * Deliberately NOT the shared syntheticGait fixture: that fixture derives each knee from the
 * hip–ankle midpoint, which makes the thigh angle fore-aft symmetric — useless for asserting
 * that forward lift, specifically, is what gets measured.
 */
const CYCLE_ANGLES_DEG = [
  0, 10, 20, 30, 40, 50, 50, 50, 40, 30, 20, 10, 0, -10, -20, -20, -20, -10, -5, 0,
]

/**
 * A rotating fixed-length thigh about a hip that TRAVELS across the frame (so
 * `estimateTravelDirection` resolves), both legs rotating in sync — gait realism isn't the
 * point; isolating the per-leg extrema detection and pooled-median aggregation is.
 *
 * `direction` flips both the hip travel and the screen-x sign of the lift, modeling the same
 * runner crossing the screen the other way: the reported (travel-relative) angles must not
 * change.
 */
function buildKneeDriveFrames(cycles: number, direction: 1 | -1 = 1): RobustPoseFrame[] {
  const period = CYCLE_ANGLES_DEG.length
  const frames: RobustPoseFrame[] = []
  for (let i = 0; i < period * cycles; i += 1) {
    const angleRad =
      (CYCLE_ANGLES_DEG[i % period] * direction * Math.PI) / 180
    const baseX = 400 + i * FRAME_STEP_X * direction
    const kneeOffsetX = THIGH_LENGTH_PX * Math.sin(angleRad)
    const kneeY = HIP_Y + THIGH_LENGTH_PX * Math.cos(angleRad)
    frames.push(
      buildFrame(
        {
          left_shoulder: { x: baseX - 10, y: SHOULDER_Y },
          right_shoulder: { x: baseX + 10, y: SHOULDER_Y },
          left_hip: { x: baseX - 10, y: HIP_Y },
          right_hip: { x: baseX + 10, y: HIP_Y },
          left_knee: { x: baseX - 10 + kneeOffsetX, y: kneeY },
          right_knee: { x: baseX + 10 + kneeOffsetX, y: kneeY },
        },
        i / 30,
      ),
    )
  }
  return frames
}

describe('computeKneeDrive', () => {
  it('a clean side-view clip: median peak thigh lift is exactly 50°, high confidence', () => {
    const frames = buildKneeDriveFrames(3)

    const result = computeKneeDrive(frames, 'side')

    expect(result.value).toBeCloseTo(50, 5)
    expect(result.unit).toBe('degrees')
    expect(result.viewFit).toBe('primary')
    // 3 cycles * 2 legs = 6 pooled forward peaks, over MIN_KNEE_DRIVE_SAMPLE_SIZE (4).
    expect(result.sampleSize).toBe(6)
    expect(result.frameCoverage).toBe(1)
    expect(result.interpolatedFraction).toBe(0)
    expect(result.confidence).toBeCloseTo(1, 5)
    expect(result.caveat).toBeNull()
  })

  it('a runner crossing the screen the other way reads the identical positive lift', () => {
    const result = computeKneeDrive(buildKneeDriveFrames(3, -1), 'side')

    // Screen-x lift is negative on a right-to-left runner; travel-direction signing folds it
    // back to the same travel-relative +50°.
    expect(result.value).toBeCloseTo(50, 5)
    expect(result.sampleSize).toBe(6)
  })

  it('a front-view clip: value still computed, viewFit unsuitable, confidence discounted to the 0.1 multiplier', () => {
    const frames = buildKneeDriveFrames(3)

    const result = computeKneeDrive(frames, 'front')

    expect(result.value).not.toBeNull() // still computed, per "never a silent wrong number"
    expect(result.value).toBeCloseTo(50, 5)
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toContain('front view')
  })

  it('indeterminate travel direction: null value with a caveat naming the direction, not a guessed sign', () => {
    // Same rotating thigh, but the hip never travels — `estimateTravelDirection` returns 0, and
    // without it forward lift cannot be told apart from trailing swing.
    const period = CYCLE_ANGLES_DEG.length
    const frames: RobustPoseFrame[] = []
    for (let i = 0; i < period * 3; i += 1) {
      const angleRad = (CYCLE_ANGLES_DEG[i % period] * Math.PI) / 180
      frames.push(
        buildFrame(
          {
            left_shoulder: { x: 390, y: SHOULDER_Y },
            right_shoulder: { x: 410, y: SHOULDER_Y },
            left_hip: { x: 390, y: HIP_Y },
            right_hip: { x: 410, y: HIP_Y },
            left_knee: { x: 390 + THIGH_LENGTH_PX * Math.sin(angleRad), y: HIP_Y + THIGH_LENGTH_PX * Math.cos(angleRad) },
            right_knee: { x: 410 + THIGH_LENGTH_PX * Math.sin(angleRad), y: HIP_Y + THIGH_LENGTH_PX * Math.cos(angleRad) },
          },
          i / 30,
        ),
      )
    }

    const result = computeKneeDrive(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toContain('Direction of travel could not be determined')
    // Coverage is reported honestly even on the null path — positions resolved fine.
    expect(result.frameCoverage).toBe(1)
  })

  it('resolvable but never lifts: no detectable forward peak, null value, no crash', () => {
    // Thigh held straight down (0°) on every frame while the hip travels — a flat trace with no
    // prominence-confirmed extrema at all.
    const frames: RobustPoseFrame[] = []
    for (let i = 0; i < 60; i += 1) {
      const baseX = 400 + i * FRAME_STEP_X
      frames.push(
        buildFrame(
          {
            left_shoulder: { x: baseX - 10, y: SHOULDER_Y },
            right_shoulder: { x: baseX + 10, y: SHOULDER_Y },
            left_hip: { x: baseX - 10, y: HIP_Y },
            right_hip: { x: baseX + 10, y: HIP_Y },
            left_knee: { x: baseX - 10, y: HIP_Y + THIGH_LENGTH_PX },
            right_knee: { x: baseX + 10, y: HIP_Y + THIGH_LENGTH_PX },
          },
          i / 30,
        ),
      )
    }

    expect(() => computeKneeDrive(frames, 'side')).not.toThrow()
    const result = computeKneeDrive(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toContain('No forward thigh-lift peaks')
  })

  it('excludes a non-positive trailing maximum: a thigh that never crossed the vertical is not a lift peak', () => {
    // One genuine 50° lift, then a descent into trail (−20°) that recovers only to −5° before the
    // clip ends. `findLocalExtrema`'s trailing-pivot emission reports that −5° as a confirmed
    // 'max' (it rose ≥ the 10° floor off the −20° minimum) — the boundary artifact the design
    // probe measured on Demo 1 — and the positive-maxima filter must drop it: without the filter
    // each leg would pool 2 peaks and the median would read (50 + −5) / 2.
    const angles = [0, 25, 50, 25, 0, -10, -20, -20, -15, -5]
    const frames: RobustPoseFrame[] = angles.map((angleDeg, i) => {
      const angleRad = (angleDeg * Math.PI) / 180
      const baseX = 400 + i * FRAME_STEP_X * 4 // fewer frames, so travel faster to clear the bar
      return buildFrame(
        {
          left_shoulder: { x: baseX - 10, y: SHOULDER_Y },
          right_shoulder: { x: baseX + 10, y: SHOULDER_Y },
          left_hip: { x: baseX - 10, y: HIP_Y },
          right_hip: { x: baseX + 10, y: HIP_Y },
          left_knee: { x: baseX - 10 + THIGH_LENGTH_PX * Math.sin(angleRad), y: HIP_Y + THIGH_LENGTH_PX * Math.cos(angleRad) },
          right_knee: { x: baseX + 10 + THIGH_LENGTH_PX * Math.sin(angleRad), y: HIP_Y + THIGH_LENGTH_PX * Math.cos(angleRad) },
        },
        i / 30,
      )
    })

    const result = computeKneeDrive(frames, 'side')

    // Only the one genuine lift peak per leg survives — the −5° trailing maximum is excluded
    // from the pool entirely, not merely outvoted by the median.
    expect(result.sampleSize).toBe(2)
    expect(result.value).toBeCloseTo(50, 5)
  })

  it('a resolvable clip with no body-scale reference names the missing reference, not displacement', () => {
    // Hips and knees resolve every frame; shoulders never do, so `estimateBodyScale` returns null
    // and the direction of travel is never estimated at all — blaming "no net horizontal
    // displacement" here would name a measurement that never happened.
    const frames: RobustPoseFrame[] = Array.from({ length: 20 }, (_, i) =>
      buildFrame(
        {
          left_hip: { x: 390 + i * FRAME_STEP_X, y: HIP_Y },
          right_hip: { x: 410 + i * FRAME_STEP_X, y: HIP_Y },
          left_knee: { x: 390 + i * FRAME_STEP_X, y: HIP_Y + THIGH_LENGTH_PX },
          right_knee: { x: 410 + i * FRAME_STEP_X, y: HIP_Y + THIGH_LENGTH_PX },
        },
        i / 30,
      ),
    )

    const result = computeKneeDrive(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toContain('No resolvable body-scale reference')
    expect(result.caveat).not.toContain('horizontal displacement')
  })

  it('returns a null value and 0 confidence when no leg position is resolvable at all', () => {
    const frame = buildFrame({})
    const result = computeKneeDrive([frame, frame], 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toContain('No resolvable hip-knee position')
    expect(result.exemplars).toBeUndefined()
  })

  it('never returns NaN or Infinity across degenerate inputs', () => {
    for (const frames of [
      [] as RobustPoseFrame[],
      [buildFrame({})],
      buildKneeDriveFrames(1),
    ]) {
      for (const view of ['side', 'front', 'ambiguous'] as const) {
        const result = computeKneeDrive(frames, view)
        if (result.value !== null) expect(Number.isFinite(result.value)).toBe(true)
        expect(Number.isFinite(result.confidence)).toBe(true)
        if (result.value === null) expect(result.confidence).toBe(0)
      }
    }
  })
})

describe('computeKneeDrive exemplars', () => {
  it('ghosts a lift peak against the adjacent trailing trough on the same leg', () => {
    const frames = buildKneeDriveFrames(3)

    const result = computeKneeDrive(frames, 'side')
    const [evidence] = result.exemplars!

    // One pair, not two: a second near-median peak would be the same picture of the same runner.
    expect(result.exemplars).toHaveLength(1)
    expect(evidence.kind).toBe('kneeDrivePeak')
    expect(evidence.side).toBe('left')
    // Frame 6 is the middle of the first 50° hold; frame 15 is the middle of the following
    // −20° trailing hold — the trough `findLocalExtrema` computes and the ghost reads against.
    expect(evidence.timestamp).toBeCloseTo(6 / 30, 10)
    expect(evidence.pairedTimestamp).toBeCloseTo(15 / 30, 10)
    // Every peak is exactly 50°, so there is no spread to judge typicality against and the
    // score is the detection factor alone.
    expect(evidence.quality).toBe(1)
    expect(evidence.cropKeypoints).toEqual(['left_hip', 'left_knee'])
    expect(evidence.label).toBe(
      "Peak knee drive (left leg), ghosted against the same leg's thigh swept back",
    )
  })

  it('names the knee as the joint the crop should be aimed at', () => {
    // The knee is the end of the thigh whose lift IS this card's number, and it sits at one end of
    // a two-point seed box rather than at its centre.
    const [evidence] = computeKneeDrive(buildKneeDriveFrames(3), 'side').exemplars!

    expect(evidence.cropFocus).toBe('left_knee')
  })

  it('offers every other scored peak as a ranked alternative', () => {
    // kneeFlexion's contract, clause for clause and for the same reason: nearness to the median is
    // the whole ranking, so it cannot separate two peaks equidistant from it.
    const result = computeKneeDrive(buildKneeDriveFrames(3), 'side')
    const [evidence] = result.exemplars!

    expect(result.exemplars).toHaveLength(1)
    expect(evidence.alternates!.length).toBeGreaterThan(0)
    for (const [i, alternate] of evidence.alternates!.entries()) {
      expect(alternate.kind).toBe('kneeDrivePeak')
      expect(alternate.cropFocus).toBe(`${alternate.side}_knee`)
      expect(alternate.quality).toBeLessThanOrEqual(
        i === 0 ? evidence.quality : evidence.alternates![i - 1].quality,
      )
      expect(alternate.alternates).toBeUndefined()
    }
  })
})
