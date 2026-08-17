import { describe, expect, it } from 'vitest'
import { computeArmSwingSymmetry } from './armSwingSymmetry'
import { buildFrame } from './__fixtures__/testFrames'
import type { RobustPoseFrame } from '../pose/robustness/types'

/**
 * Fixed torso length matching syntheticGait.ts's own convention (shoulder-mid to hip-mid = 150px)
 * so amplitude-vs-prominence-threshold math stays consistent with the rest of this codebase's
 * fixtures.
 */
const TORSO_LENGTH_PX = 150
const SHOULDER_Y = 250
const HIP_Y = SHOULDER_Y + TORSO_LENGTH_PX
const LEFT_SHOULDER_X = 170
const RIGHT_SHOULDER_X = 230
const LEFT_HIP_X = 175
const RIGHT_HIP_X = 225
/** Resting wrist-below-shoulder offset — an arbitrary but plausible carried-arm position; only
 * the OSCILLATION around it (see below) is what the metric measures. */
const BASE_WRIST_OFFSET_Y = 80

/**
 * Builds a `RobustPoseFrame[]` with a resolvable torso (shoulders+hips) and each wrist
 * sinusoidally oscillating in y relative to its own shoulder — the exact signal
 * `computeArmSwingSymmetry` reads. Left and right swing in opposite phase (natural contralateral
 * arm swing), each with its own configurable amplitude so symmetric and asymmetric cases are both
 * constructible from the same generator.
 *
 * By construction, consecutive extrema of one side's wrist-relative-to-shoulder-y series differ by
 * exactly that side's `amplitudePx` (peak-to-trough) — mirroring `syntheticGait.ts`'s own
 * `verticalBouncePx` construction — so the expected torso-normalized per-side value is
 * hand-computable as `amplitudePx / TORSO_LENGTH_PX`.
 */
function buildArmSwingFrames(params: {
  durationSec: number
  fps: number
  swingFreqHz: number
  leftAmplitudePx: number
  rightAmplitudePx: number
}): RobustPoseFrame[] {
  const { durationSec, fps, swingFreqHz, leftAmplitudePx, rightAmplitudePx } =
    params
  const frameCount = Math.round(durationSec * fps)

  const frames: RobustPoseFrame[] = []
  for (let i = 0; i < frameCount; i += 1) {
    const t = i / fps
    const phase = 2 * Math.PI * swingFreqHz * t
    const leftWristY =
      SHOULDER_Y + BASE_WRIST_OFFSET_Y - (leftAmplitudePx / 2) * Math.sin(phase)
    const rightWristY =
      SHOULDER_Y +
      BASE_WRIST_OFFSET_Y -
      (rightAmplitudePx / 2) * Math.sin(phase + Math.PI)

    frames.push(
      buildFrame(
        {
          left_shoulder: { x: LEFT_SHOULDER_X, y: SHOULDER_Y },
          right_shoulder: { x: RIGHT_SHOULDER_X, y: SHOULDER_Y },
          left_hip: { x: LEFT_HIP_X, y: HIP_Y },
          right_hip: { x: RIGHT_HIP_X, y: HIP_Y },
          left_wrist: { x: LEFT_SHOULDER_X, y: leftWristY },
          right_wrist: { x: RIGHT_SHOULDER_X, y: rightWristY },
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
  swingFreqHz: 1.5,
}

describe('computeArmSwingSymmetry', () => {
  it('a clean front-view clip with symmetric swing: ratio close to 1, primary view, high confidence', () => {
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
    })

    const result = computeArmSwingSymmetry(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(1, 1)
    expect(result.unit).toBe('percent')
    expect(result.viewFit).toBe('primary')
    expect(result.sampleSize).toBeGreaterThanOrEqual(4)
    expect(result.frameCoverage).toBe(1)
    // viewFitMultiplier 1, frameCoverage 1, interpolatedFraction 0, sampleSize well over the
    // minimum (capped at 1) -> confidence at or very near 1.
    expect(result.confidence).toBeGreaterThan(0.9)
    expect(result.caveat).toBeNull()
  })

  it('a genuinely asymmetric clip scores meaningfully lower than an otherwise-identical symmetric one', () => {
    const symmetric = computeArmSwingSymmetry(
      buildArmSwingFrames({
        ...BASE_PARAMS,
        leftAmplitudePx: 40,
        rightAmplitudePx: 40,
      }),
      'front',
    )
    const asymmetric = computeArmSwingSymmetry(
      buildArmSwingFrames({
        ...BASE_PARAMS,
        leftAmplitudePx: 40,
        rightAmplitudePx: 10,
      }),
      'front',
    )

    expect(symmetric.value).not.toBeNull()
    expect(asymmetric.value).not.toBeNull()
    // Expected: symmetric ~= 1, asymmetric ~= 10/40 = 0.25.
    expect(asymmetric.value as number).toBeLessThan(symmetric.value as number)
    expect(asymmetric.value).toBeCloseTo(0.25, 1)
    expect(asymmetric.value as number).toBeLessThan(0.5)
  })

  it('a side-view clip: still computed (never withheld), viewFit unsuitable, confidence capped near the 0.1 multiplier', () => {
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
    })

    const result = computeArmSwingSymmetry(frames, 'side')

    expect(result.value).not.toBeNull() // still computed, per "never a silent wrong number"
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toContain('side view')
  })

  it('an ambiguous-view clip: still computed, viewFit unsuitable, confidence capped near the 0.2 multiplier', () => {
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
    })

    const result = computeArmSwingSymmetry(frames, 'ambiguous')

    expect(result.value).not.toBeNull()
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.25)
    expect(result.caveat).toContain('ambiguous view')
  })

  it('no resolvable wrist position: null value, 0 confidence, no crash', () => {
    // Shoulders/hips resolve (body scale is fine) but wrists never do.
    const frame = buildFrame({
      left_shoulder: { x: LEFT_SHOULDER_X, y: SHOULDER_Y },
      right_shoulder: { x: RIGHT_SHOULDER_X, y: SHOULDER_Y },
      left_hip: { x: LEFT_HIP_X, y: HIP_Y },
      right_hip: { x: RIGHT_HIP_X, y: HIP_Y },
    })
    const frames = Array.from({ length: 10 }, () => frame)

    expect(() => computeArmSwingSymmetry(frames, 'front')).not.toThrow()
    const result = computeArmSwingSymmetry(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toContain('No resolvable shoulder/wrist position')
  })

  it('tracked but motionless arms: no complete swing cycle detected, null value, no crash', () => {
    // Wrists resolve every frame but never move relative to the shoulder -- no prominence-
    // clearing extremum, so there is no computable amplitude on either side.
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 0,
      rightAmplitudePx: 0,
    })

    expect(() => computeArmSwingSymmetry(frames, 'front')).not.toThrow()
    const result = computeArmSwingSymmetry(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toContain('no complete arm-swing cycle')
  })

  it('returns a null value and 0 confidence when there is no body-scale reference at all', () => {
    const frame = buildFrame({})
    const result = computeArmSwingSymmetry([frame, frame], 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).not.toBeNull()
  })
})

/**
 * Reads the exact series `computeSideSwing` reads — `wrist.y − shoulder.y` in image-y — at the
 * frame carrying `timestamp`. Image-y grows downward, so a SMALLER value is the wrist higher on
 * screen. The direction assertions below depend on this and on nothing else.
 */
function wristBelowShoulderPx(
  frames: RobustPoseFrame[],
  timestamp: number,
  side: 'left' | 'right',
): number {
  const frame = frames.find((candidate) => candidate.timestamp === timestamp)!
  const at = (name: string) => frame.keypoints.find((kp) => kp.name === name)!.y!
  return at(`${side}_wrist`) - at(`${side}_shoulder`)
}

describe('computeArmSwingSymmetry — exemplars', () => {
  const frames = buildArmSwingFrames({
    ...BASE_PARAMS,
    leftAmplitudePx: 40,
    rightAmplitudePx: 24,
  })

  it('emits one pair per side — the comparison is what makes an asymmetry metric legible', () => {
    const exemplars = computeArmSwingSymmetry(frames, 'front').exemplars!

    expect(exemplars).toHaveLength(2)
    expect(exemplars.map((exemplar) => exemplar.kind)).toEqual([
      'armSwingCycle',
      'armSwingCycle',
    ])
    // One per arm, never two of the same one.
    expect([...exemplars.map((exemplar) => exemplar.side)].sort()).toEqual(['left', 'right'])
    for (const exemplar of exemplars) {
      expect(exemplar.quality).toBeGreaterThanOrEqual(0.5)
      expect(frames.map((frame) => frame.timestamp)).toContain(exemplar.timestamp)
      expect(frames.map((frame) => frame.timestamp)).toContain(exemplar.pairedTimestamp)
    }
  })

  it('the base instant is the wrist HIGH frame, on both sides — the image-y sign trap', () => {
    // `wrist.y − shoulder.y` grows downward, so the series MINIMUM is the wrist at its highest.
    // Reading the extremum kind straight through would caption every one of these backwards while
    // passing every other assertion in this file.
    for (const exemplar of computeArmSwingSymmetry(frames, 'front').exemplars!) {
      const side = exemplar.side!
      expect(wristBelowShoulderPx(frames, exemplar.timestamp, side)).toBeLessThan(
        wristBelowShoulderPx(frames, exemplar.pairedTimestamp!, side),
      )
    }
  })

  it('the pair spans that side’s full swing amplitude, not some smaller excursion', () => {
    for (const exemplar of computeArmSwingSymmetry(frames, 'front').exemplars!) {
      const side = exemplar.side!
      const spanned =
        wristBelowShoulderPx(frames, exemplar.pairedTimestamp!, side) -
        wristBelowShoulderPx(frames, exemplar.timestamp, side)
      // The fixture builds each side's peak-to-trough excursion as exactly `amplitudePx`; discrete
      // 30fps sampling can only land at or just inside that.
      const amplitudePx = side === 'left' ? 40 : 24
      expect(spanned).toBeGreaterThan(amplitudePx * 0.9)
      expect(spanned).toBeLessThanOrEqual(amplitudePx)
    }
  })

  it('seeds the crop on that side’s own shoulder and wrist, dropping context that resolves nowhere', () => {
    for (const exemplar of computeArmSwingSymmetry(frames, 'front').exemplars!) {
      const side = exemplar.side!
      // The elbow is context (design D2) and this fixture never resolves one, so it is omitted
      // rather than anchoring the crop at a keypoint with no position.
      expect(exemplar.cropKeypoints).toEqual([`${side}_shoulder`, `${side}_wrist`])
    }
  })

  it('adds the elbow to the crop when it actually resolves', () => {
    const withElbows = frames.map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === 'left_elbow' || kp.name === 'right_elbow'
          ? { ...kp, x: 200, y: 300, score: 0.9, status: 'detected' as const }
          : kp,
      ),
    }))

    for (const exemplar of computeArmSwingSymmetry(withElbows, 'front').exemplars!) {
      const side = exemplar.side!
      expect(exemplar.cropKeypoints).toEqual([
        `${side}_shoulder`,
        `${side}_wrist`,
        `${side}_elbow`,
      ])
    }
  })

  it('emits nothing when the metric reports no value', () => {
    const flat = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 0,
      rightAmplitudePx: 0,
    })

    const result = computeArmSwingSymmetry(flat, 'front')

    expect(result.value).toBeNull()
    expect(result.exemplars).toBeUndefined()
  })
})
