import { describe, expect, it } from 'vitest'
import { computeStepWidth } from './stepWidth'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'
import type { RobustPoseFrame } from '../pose/robustness/types'

const HIP_MID_X = 200
const HIP_MID_Y = 400
const TORSO_LENGTH_PX = 150
const HIP_HALF_WIDTH_PX = 60
const SHOULDER_HALF_WIDTH_PX = 30
const SHOULDER_MID_Y = HIP_MID_Y - TORSO_LENGTH_PX
const ANKLE_LIFT_PX = 50
const GROUND_Y = HIP_MID_Y + TORSO_LENGTH_PX

/**
 * Builds a front-view `RobustPoseFrame[]` with fixed hip/shoulder geometry (torso length 150px,
 * hip half-width 60px, so `hipWidthPx` = 120) and each ankle's lateral (x) position swinging past
 * its OWN hip toward the opposite side by `crossAmplitudePx`, at the exact instant that leg's
 * ankle-y is at its footstrike peak — mirroring `syntheticGait.ts`'s "monotone in sin(phase)"
 * construction for footstrike timing, but with an INDEPENDENT sign convention for x per leg
 * (`+crossAmplitudePx * sin(leftPhase)` for the left ankle, `-crossAmplitudePx * sin(rightPhase)`
 * for the right) so both legs can be pushed toward crossover by the same scalar parameter.
 *
 * This is deliberately NOT built from the shared `generateSyntheticGait` fixture: that generator
 * couples both legs' lateral sway to a single contralateral-phase sine sharing one sign
 * convention, which means each leg's OWN footstrike (`sin(ownPhase) = 1`) always swings it the
 * SAME absolute direction (+x) regardless of amplitude — exaggerating `strideAmplitudePx` there
 * pushes the left leg toward crossover but the right leg further onto its own side by an equal
 * and opposite amount, so the combined median is invariant at +0.5 and can structurally never go
 * negative. Verified analytically and numerically before writing this fixture.
 *
 * By construction, every footstrike's expected signed offset ratio is exactly
 * `(HIP_HALF_WIDTH_PX - crossAmplitudePx) / (2 * HIP_HALF_WIDTH_PX)` — positive (own side) when
 * `crossAmplitudePx < HIP_HALF_WIDTH_PX`, negative (crossover) when it's greater.
 */
function buildStepWidthFrames(params: {
  durationSec: number
  fps: number
  cadenceStepsPerMin: number
  crossAmplitudePx: number
}): RobustPoseFrame[] {
  const { durationSec, fps, cadenceStepsPerMin, crossAmplitudePx } = params
  const strideFreqHz = cadenceStepsPerMin / 120
  const frameCount = Math.round(durationSec * fps)

  const frames: RobustPoseFrame[] = []
  for (let i = 0; i < frameCount; i += 1) {
    const t = i / fps
    const leftPhase = 2 * Math.PI * strideFreqHz * t
    const rightPhase = leftPhase + Math.PI

    const leftHipX = HIP_MID_X - HIP_HALF_WIDTH_PX
    const rightHipX = HIP_MID_X + HIP_HALF_WIDTH_PX
    // Monotone in sin(phase), same construction as syntheticGait.ts: ankle-y is maximal (ground
    // contact / footstrike) exactly when sin(ownPhase) = 1.
    const leftAnkleY = GROUND_Y - (ANKLE_LIFT_PX * (1 - Math.sin(leftPhase))) / 2
    const rightAnkleY = GROUND_Y - (ANKLE_LIFT_PX * (1 - Math.sin(rightPhase))) / 2
    const leftAnkleX = leftHipX + crossAmplitudePx * Math.sin(leftPhase)
    const rightAnkleX = rightHipX - crossAmplitudePx * Math.sin(rightPhase)

    frames.push(
      buildFrame(
        {
          left_shoulder: { x: HIP_MID_X - SHOULDER_HALF_WIDTH_PX, y: SHOULDER_MID_Y },
          right_shoulder: { x: HIP_MID_X + SHOULDER_HALF_WIDTH_PX, y: SHOULDER_MID_Y },
          left_hip: { x: leftHipX, y: HIP_MID_Y },
          right_hip: { x: rightHipX, y: HIP_MID_Y },
          left_ankle: { x: leftAnkleX, y: leftAnkleY },
          right_ankle: { x: rightAnkleX, y: rightAnkleY },
        },
        t,
      ),
    )
  }
  return frames
}

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
}

describe('computeStepWidth', () => {
  it('a clean front-view clip: positive value (own-side, not crossover), primary view-fit', () => {
    const frames = buildStepWidthFrames({ ...BASE_PARAMS, crossAmplitudePx: 20 })

    const result = computeStepWidth(frames, 'front')

    expect(result.value).not.toBeNull()
    // Expected: (60 - 20) / 120 = 0.333...
    expect(result.value).toBeCloseTo(40 / 120, 1)
    expect(result.value as number).toBeGreaterThan(0)
    expect(result.unit).toBe('percent')
    expect(result.viewFit).toBe('primary')
    expect(result.sampleSize).toBeGreaterThanOrEqual(4)
    expect(result.frameCoverage).toBe(1)
    expect(result.confidence).toBeGreaterThan(0.9)
    expect(result.caveat).toBeNull()
  })

  it('a side-view clip: still computed (never withheld), viewFit unsuitable, confidence discounted', () => {
    const frames = generateSyntheticGait({
      durationSec: 4,
      fps: 30,
      cadenceStepsPerMin: 170,
      strideAmplitudePx: 80,
      verticalBouncePx: 20,
      trunkLeanDeg: 5,
      view: 'side',
    })

    const result = computeStepWidth(frames, 'side')

    expect(result.value).not.toBeNull() // still computed, per "never a silent wrong number"
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toContain('side view')
  })

  it('an ambiguous-view clip: still computed, viewFit unsuitable, confidence capped near the 0.2 multiplier', () => {
    const frames = buildStepWidthFrames({ ...BASE_PARAMS, crossAmplitudePx: 20 })

    const result = computeStepWidth(frames, 'ambiguous')

    expect(result.value).not.toBeNull()
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.25)
    expect(result.caveat).toContain('ambiguous view')
  })

  it('a crossover-gait clip: negative value, crossover caveat fires', () => {
    // Same fixture, amplitude exaggerated past HIP_HALF_WIDTH_PX so every footstrike's ankle
    // crosses the body midline instead of landing on its own side.
    const frames = buildStepWidthFrames({ ...BASE_PARAMS, crossAmplitudePx: 90 })

    const result = computeStepWidth(frames, 'front')

    expect(result.value).not.toBeNull()
    // Expected: (60 - 90) / 120 = -0.25
    expect(result.value).toBeCloseTo(-30 / 120, 1)
    expect(result.value as number).toBeLessThan(0)
    expect(result.viewFit).toBe('primary')
    expect(result.caveat).toContain('crossover gait')
  })

  it('too few footstrikes: null value, 0 confidence, no crash', () => {
    // A flat, unchanging ankle trace -- no prominence-confirmed extrema, so no footstrike
    // candidates at all, even though hips/shoulders resolve fine.
    const frame = buildFrame({
      left_hip: { x: 200, y: 400 },
      right_hip: { x: 260, y: 400 },
      left_shoulder: { x: 200, y: 250 },
      right_shoulder: { x: 260, y: 250 },
      left_ankle: { x: 190, y: 550 },
      right_ankle: { x: 270, y: 550 },
    })
    const frames = Array.from({ length: 10 }, () => frame)

    expect(() => computeStepWidth(frames, 'front')).not.toThrow()
    const result = computeStepWidth(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toContain('No footstrikes')
  })

  it('returns a null value and 0 confidence when there is no resolvable hip-width reference at all', () => {
    const frame = buildFrame({})
    const result = computeStepWidth([frame, frame], 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toContain('hip-width reference')
  })

  it('empty frames: no throw, null value', () => {
    expect(() => computeStepWidth([], 'front')).not.toThrow()
    const result = computeStepWidth([], 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
  })
})
