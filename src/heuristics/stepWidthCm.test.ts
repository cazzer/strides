import { describe, expect, it } from 'vitest'
import { computeStepWidthCm } from './stepWidthCm'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'
import type { RobustPoseFrame } from '../pose/robustness/types'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  verticalBouncePx: 20,
  trunkLeanDeg: 5,
}

/**
 * Rewrites every frame's ankle x-position so that the sign-corrected own-side offset (the exact
 * quantity `computeStepWidthCm` now reports — `(ankle.x - hipMid.x) * sign(sideHip.x - hipMid.x)`)
 * is exactly `ownSideOffsetPx` on BOTH legs, at every frame — not just at footstrikes. Same
 * technique `footStrikePattern.test.ts`'s `withKneeAnkleOffset` uses: it pins the signal this
 * metric reads to a known value while leaving footstrike timing (still driven by the fixture's
 * own ankle-y) and everything else about the clip realistic.
 *
 * Deliberately NOT a single shared absolute x for both ankles (as an earlier version of this
 * fixture used): `generateSyntheticGait` places `left_hip.x` below hip-mid and `right_hip.x`
 * above it, so pinning both ankles to the same absolute x makes one leg's offset read as
 * "own side" and the other leg's the mirror-image "crossover" under the sign-corrected formula
 * — the two legs' sign-corrected offsets become structural negatives of each other and the
 * median collapses toward whichever side has more detected footstrikes, not toward the pinned
 * value. Mirroring each ankle's offset outward from ITS OWN hip (`-` for the left leg, whose own
 * side is the lower-x direction; `+` for the right) keeps both legs' sign-corrected offsets
 * identically `ownSideOffsetPx`, positive or negative, regardless of footstrike-side balance —
 * see `stepWidth.test.ts`'s (the ratio sibling, #46) `buildStepWidthFrames` for the same finding
 * verified independently on that metric.
 */
function withOwnSideAnkleHipOffset(
  frames: RobustPoseFrame[],
  ownSideOffsetPx: number,
): RobustPoseFrame[] {
  return frames.map((frame) => {
    const leftHip = frame.keypoints.find((k) => k.name === 'left_hip')
    const rightHip = frame.keypoints.find((k) => k.name === 'right_hip')
    const hipMidX = ((leftHip?.x ?? 0) + (rightHip?.x ?? 0)) / 2
    return {
      ...frame,
      keypoints: frame.keypoints.map((kp) => {
        if (kp.name === 'left_ankle') return { ...kp, x: hipMidX - ownSideOffsetPx }
        if (kp.name === 'right_ankle') return { ...kp, x: hipMidX + ownSideOffsetPx }
        return kp
      }),
    }
  })
}

describe('computeStepWidthCm', () => {
  it('a clean front-view clip with a pinned own-side offset: value close to offsetPx / scale in cm, sane sample size, high confidence', () => {
    const scale = 300 // px/m
    const base = generateSyntheticGait({ ...BASE_PARAMS, view: 'front', pixelsPerMeter: scale })
    const frames = withOwnSideAnkleHipOffset(base, 15) // 15px = 5cm at 300px/m

    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(5, 6)
    expect(result.value as number).toBeGreaterThan(0)
    expect(result.sampleSize).toBeGreaterThanOrEqual(4)
    expect(result.frameCoverage).toBe(1)
    expect(result.viewFit).toBe('primary')
    expect(result.unit).toBe('centimeters')
    expect(result.caveat).toBeNull()
    // viewFitMultiplier 1, frameCoverage 1, interpolatedFraction 0, sampleSize well over the
    // minimum (capped at 1) -> confidence at or very near 1.
    expect(result.confidence).toBeGreaterThan(0.9)
  })

  it('a crossover-gait clip (each foot lands on the OPPOSITE side of its own hip): negative value, crossover caveat fires', () => {
    // A negative `ownSideOffsetPx` pushes both legs' ankles past hip-mid onto the opposite side
    // from their own hip -- a genuine crossover, not merely "positive x" on an arbitrary axis.
    // Both legs land on the wrong side, so this isn't sensitive to detected-footstrike side
    // balance the way a single-absolute-x fixture would be -- see `withOwnSideAnkleHipOffset`'s
    // doc for why that construction was rejected.
    const scale = 300
    const base = generateSyntheticGait({ ...BASE_PARAMS, view: 'front', pixelsPerMeter: scale })
    const frames = withOwnSideAnkleHipOffset(base, -15) // -15px = -5cm at 300px/m

    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(-5, 6)
    expect(result.value as number).toBeLessThan(0)
    expect(result.viewFit).toBe('primary')
    expect(result.caveat).toContain('crossover gait')
  })

  it('a side-view clip: viewFit unsuitable, confidence discounted to the 0.1 multiplier', () => {
    const scale = 300
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'side', pixelsPerMeter: scale })

    const result = computeStepWidthCm(frames, 'side')

    expect(result.value).not.toBeNull() // still computed, per "never a silent wrong number"
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toContain('side view')
  })

  it("reports the backend-gate availability caveat, verbatim, when no frame carries a measured scale", () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'front' }) // no pixelsPerMeter
    const NO_SCALE_CAVEAT =
      "No real-world scale could be measured for this clip, so step width can't be reported in centimetres."

    expect(() => computeStepWidthCm(frames, 'front')).not.toThrow()
    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.unit).toBe('centimeters')
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toBe(NO_SCALE_CAVEAT)
  })

  it('behaves identically on an empty frame list', () => {
    expect(() => computeStepWidthCm([], 'front')).not.toThrow()
    const result = computeStepWidthCm([], 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toMatch(/no real-world scale could be measured/i)
  })

  it('excludes candidate footstrikes on frames with no usable scale, using only the scaled ones', () => {
    const scale = 300
    const base = generateSyntheticGait({ ...BASE_PARAMS, view: 'front', pixelsPerMeter: scale })
    const pinned = withOwnSideAnkleHipOffset(base, 15)
    // Null out the scale on every OTHER frame -- some footstrike candidates now sit on an
    // unscaled frame and must be excluded rather than crash or corrupt the median.
    const mixed = pinned.map((frame, i) => ({
      ...frame,
      pixelsPerMeter: i % 2 === 0 ? null : frame.pixelsPerMeter,
    }))

    const scaledOnly = computeStepWidthCm(pinned, 'front')
    const result = computeStepWidthCm(mixed, 'front')

    expect(result.value).not.toBeNull()
    // The pinned offset is identical on every frame, so which subset of footstrikes survives the
    // scale filter doesn't move the value -- only coverage/confidence should differ.
    expect(result.value).toBeCloseTo(scaledOnly.value ?? 0, 6)
    expect(result.frameCoverage).toBeLessThan(1)
    expect(result.sampleSize).toBeLessThan(scaledOnly.sampleSize)
  })

  it('too few footstrikes: null value, 0 confidence, no crash', () => {
    // A flat, unchanging ankle trace -- no prominence-confirmed extrema, so no footstrike
    // candidates at all. Carries a scale so this reaches the "no footstrikes" branch, not the
    // backend gate.
    const frame = buildFrame(
      {
        left_hip: { x: 200, y: 400 },
        right_hip: { x: 200, y: 400 },
        left_shoulder: { x: 70, y: 250 },
        right_shoulder: { x: 330, y: 250 },
        left_ankle: { x: 190, y: 550 },
        right_ankle: { x: 210, y: 550 },
      },
      0,
      300,
    )
    const frames = Array.from({ length: 10 }, () => frame)

    expect(() => computeStepWidthCm(frames, 'front')).not.toThrow()
    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toBe('No footstrikes could be detected in this clip.')
  })

  it('reports a below-minimum-sample caveat and reduced confidence with fewer than 4 footstrikes', () => {
    const scale = 300
    // A short clip at a slow cadence yields only a couple of footstrikes.
    const base = generateSyntheticGait({
      ...BASE_PARAMS,
      durationSec: 0.5,
      cadenceStepsPerMin: 170,
      view: 'front',
      pixelsPerMeter: scale,
    })
    const frames = withOwnSideAnkleHipOffset(base, 15)

    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.sampleSize).toBeLessThan(4)
    expect(result.sampleSize).toBeGreaterThan(0)
    expect(result.caveat).toMatch(/footstrike\(s\) detected/i)
    expect(result.confidence).toBeLessThan(1)
  })

  it('returns a null value and 0 confidence when there is no resolvable hip/ankle at any candidate (degenerate scale-only input)', () => {
    // A scale is present, but no keypoints resolve at all -- detectFootstrikes needs a body-scale
    // reference (shoulders/hips) to size its prominence threshold, so it returns no candidates,
    // landing this on the "no footstrikes" branch rather than crashing on missing points.
    const frame = buildFrame({}, 0, 300)
    const result = computeStepWidthCm([frame, frame], 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toBe('No footstrikes could be detected in this clip.')
  })
})
