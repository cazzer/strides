import { describe, expect, it } from 'vitest'
import { classifyFootStrike, computeFootStrikePattern } from './footStrikePattern'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  verticalBouncePx: 20,
  trunkLeanDeg: 5,
}

const BAND = DEFAULT_HEURISTICS_CONFIG.footStrikeMidfootBandRatio // 0.05

/**
 * Rewrites every frame's knee x-position so that `ankle.x - knee.x === offsetPx` exactly, on both
 * legs, at every frame — not just at footstrikes. This is the simplest way to pin the
 * ankle-relative-to-knee classification signal to a known value while leaving everything else the
 * synthetic clip provides (footstrike timing via ankle-y, torso scale via shoulders/hips, travel
 * direction via hip-x) untouched and realistic.
 */
function withKneeAnkleOffset(frames: RobustPoseFrame[], offsetPx: number): RobustPoseFrame[] {
  return frames.map((frame) => ({
    ...frame,
    keypoints: frame.keypoints.map((kp) => {
      if (kp.name !== 'left_knee' && kp.name !== 'right_knee') return kp
      const ankleName = kp.name === 'left_knee' ? 'left_ankle' : 'right_ankle'
      const ankle = frame.keypoints.find((k) => k.name === ankleName)
      const ankleX = ankle?.x ?? 0
      return { ...kp, x: ankleX - offsetPx }
    }),
  }))
}

describe('computeFootStrikePattern', () => {
  it('a clean side-view clip with the ankle notably ahead of the knee classifies as heel', () => {
    // By the fixture's own construction (syntheticGait.ts's doc comment), the knee sits at the
    // ankle/hip midpoint, so at each footstrike ankle.x - knee.x = strideAmplitudePx / 2 -- the
    // expected ratio is hand-computable as strideAmplitudePx / (2 * torsoLengthPx) = 80/300.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'side' })

    const result = computeFootStrikePattern(frames, 'side')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(80 / 300, 1)
    expect(classifyFootStrike(result.value!, BAND)).toBe('heel')
    expect(result.sampleSize).toBeGreaterThanOrEqual(4)
    expect(result.viewFit).toBe('primary')
    expect(result.confidence).toBeGreaterThan(0.9)
  })

  it('an ankle landing roughly under the knee classifies as midfoot', () => {
    const base = generateSyntheticGait({ ...BASE_PARAMS, view: 'side' })
    const frames = withKneeAnkleOffset(base, 0) // ankle.x - knee.x === 0 at every frame

    const result = computeFootStrikePattern(frames, 'side')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(0, 2)
    expect(classifyFootStrike(result.value!, BAND)).toBe('midfoot')
  })

  it('an ankle landing behind the knee classifies as forefoot', () => {
    const base = generateSyntheticGait({ ...BASE_PARAMS, view: 'side' })
    // -0.15 * torsoLengthPx(150) = -22.5px offset -> ratio -0.15, well past the -0.05 band edge.
    const frames = withKneeAnkleOffset(base, -0.15 * 150)

    const result = computeFootStrikePattern(frames, 'side')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(-0.15, 2)
    expect(classifyFootStrike(result.value!, BAND)).toBe('forefoot')
  })

  it('a front-view clip: viewFit unsuitable, confidence discounted to the 0.1 multiplier', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'front' })

    const result = computeFootStrikePattern(frames, 'front')

    expect(result.value).not.toBeNull() // still computed, per "never a silent wrong number"
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toContain('front view')
  })

  it('too few footstrikes: null value, 0 confidence, non-null caveat, no crash', () => {
    // A flat, unchanging ankle trace -- no prominence-confirmed extrema, so no footstrike
    // candidates at all.
    const frame = buildFrame({
      left_hip: { x: 200, y: 400 },
      right_hip: { x: 200, y: 400 },
      left_shoulder: { x: 200, y: 250 },
      right_shoulder: { x: 200, y: 250 },
      left_knee: { x: 195, y: 475 },
      right_knee: { x: 205, y: 475 },
      left_ankle: { x: 190, y: 550 },
      right_ankle: { x: 210, y: 550 },
    })
    const frames = Array.from({ length: 10 }, () => frame)

    expect(() => computeFootStrikePattern(frames, 'side')).not.toThrow()
    const result = computeFootStrikePattern(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).not.toBeNull()
  })

  it('returns a null value and 0 confidence when there is no body-scale reference at all', () => {
    const frame = buildFrame({})
    const result = computeFootStrikePattern([frame, frame], 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).not.toBeNull()
  })

  // Guardrail for the ticket's hard requirement: `caveat` must be non-null on EVERY returned
  // result from this metric, including the clean/high-confidence case -- unlike every other
  // metric in this package, where `caveat` is only populated for degraded/low-confidence results.
  // This is a deliberate exception (see PROXY_CAVEAT in footStrikePattern.ts), not something a
  // future cleanup pass should "fix" to match the other metrics' pattern.
  it('caveat is non-null on every returned result, including the clean/high-confidence case', () => {
    const clean = computeFootStrikePattern(
      generateSyntheticGait({ ...BASE_PARAMS, view: 'side' }),
      'side',
    )
    expect(clean.value).not.toBeNull()
    expect(clean.confidence).toBeGreaterThan(0.8)
    expect(clean.caveat).not.toBeNull()
    expect(clean.caveat).toMatch(/approximation|proxy/i)

    const frontView = computeFootStrikePattern(
      generateSyntheticGait({ ...BASE_PARAMS, view: 'front' }),
      'front',
    )
    expect(frontView.caveat).not.toBeNull()
    expect(frontView.caveat).toMatch(/approximation|proxy/i)

    const flatFrame = buildFrame({
      left_hip: { x: 200, y: 400 },
      right_hip: { x: 200, y: 400 },
      left_shoulder: { x: 200, y: 250 },
      right_shoulder: { x: 200, y: 250 },
      left_ankle: { x: 190, y: 550 },
      right_ankle: { x: 210, y: 550 },
    })
    const noFootstrikes = computeFootStrikePattern(
      Array.from({ length: 10 }, () => flatFrame),
      'side',
    )
    expect(noFootstrikes.value).toBeNull()
    expect(noFootstrikes.caveat).not.toBeNull()
    expect(noFootstrikes.caveat).toMatch(/approximation|proxy/i)

    const noBodyScale = computeFootStrikePattern([buildFrame({}), buildFrame({})], 'side')
    expect(noBodyScale.value).toBeNull()
    expect(noBodyScale.caveat).not.toBeNull()
    expect(noBodyScale.caveat).toMatch(/approximation|proxy/i)
  })
})

describe('classifyFootStrike', () => {
  it('classifies a ratio past the positive band edge as heel', () => {
    expect(classifyFootStrike(0.06, 0.05)).toBe('heel')
  })

  it('classifies a ratio past the negative band edge as forefoot', () => {
    expect(classifyFootStrike(-0.06, 0.05)).toBe('forefoot')
  })

  it('classifies zero, and both band edges themselves, as midfoot', () => {
    expect(classifyFootStrike(0, 0.05)).toBe('midfoot')
    expect(classifyFootStrike(0.05, 0.05)).toBe('midfoot')
    expect(classifyFootStrike(-0.05, 0.05)).toBe('midfoot')
  })
})
