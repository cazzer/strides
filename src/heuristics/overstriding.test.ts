import { describe, expect, it } from 'vitest'
import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { computeOverstriding } from './overstriding'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildStrikeFrames } from './__fixtures__/strikeFrames'
import { buildFrame } from './__fixtures__/testFrames'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  verticalBouncePx: 20,
  trunkLeanDeg: 5,
}

describe('computeOverstriding', () => {
  it('a clean side-view clip: value close to strideAmplitudePx / torsoLengthPx, sane sample size', () => {
    // By the fixture's construction (see syntheticGait.ts's doc comment), each footstrike's
    // ankle-x sits exactly strideAmplitudePx ahead of the hip at the instant ankle-y peaks, for
    // both legs -- so every overstrideRatio_i should be close to 80/150 = 0.5333. "Close to" not
    // exact: the footstrike index is the discretely-sampled point nearest the continuous phase
    // peak, which a ~30fps grid against a ~1.4Hz stride won't land on exactly.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, strideAmplitudePx: 80, view: 'side' })

    const result = computeOverstriding(frames, 'side')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(80 / 150, 1)
    expect(result.value).toBeGreaterThan(0) // foot lands ahead of the hip, in travel direction
    expect(result.sampleSize).toBeGreaterThanOrEqual(4)
    expect(result.frameCoverage).toBe(1) // hip is resolvable at every candidate footstrike
    expect(result.viewFit).toBe('primary')
    // viewFitMultiplier 1, frameCoverage 1, interpolatedFraction 0, sampleSize well over the
    // minimum (capped at 1), travelDirectionKnown true -> confidence at or very near 1.
    expect(result.confidence).toBeGreaterThan(0.9)
  })

  it('a front-view clip: viewFit unsuitable, confidence discounted to the 0.1 multiplier', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, strideAmplitudePx: 80, view: 'front' })

    const result = computeOverstriding(frames, 'front')

    expect(result.value).not.toBeNull() // still computed, per "never a silent wrong number"
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toContain('front view')
  })

  it('too few footstrikes: null value, 0 confidence, no crash', () => {
    // A flat, unchanging ankle trace -- no prominence-confirmed extrema, so no footstrike
    // candidates at all.
    const frame = buildFrame({
      left_hip: { x: 200, y: 400 },
      right_hip: { x: 200, y: 400 },
      left_shoulder: { x: 200, y: 250 },
      right_shoulder: { x: 200, y: 250 },
      left_ankle: { x: 190, y: 550 },
      right_ankle: { x: 210, y: 550 },
    })
    const frames = Array.from({ length: 10 }, () => frame)

    expect(() => computeOverstriding(frames, 'side')).not.toThrow()
    const result = computeOverstriding(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).not.toBeNull()
  })

  it('returns a null value and 0 confidence when there is no body-scale reference at all', () => {
    const frame = buildFrame({})
    const result = computeOverstriding([frame, frame], 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.exemplars).toBeUndefined()
  })
})

/**
 * Marks the seed keypoints of strike `index`'s own frame `'interpolated'` — coordinates, and so
 * the measured ratio at that strike, untouched. `buildStrikeFrames` peaks each strike on the
 * middle frame of its 10-frame block.
 */
function withInterpolatedStrike(frames: RobustPoseFrame[], index: number): RobustPoseFrame[] {
  const seed: KeypointName[] = ['left_ankle', 'left_hip', 'right_hip']
  return frames.map((frame, i) =>
    i === index * 10 + 5
      ? {
          ...frame,
          keypoints: frame.keypoints.map((keypoint) =>
            seed.includes(keypoint.name) && keypoint.status === 'detected'
              ? { ...keypoint, status: 'interpolated' as const, score: 0.5 }
              : keypoint,
          ),
        }
      : frame,
  )
}

describe('computeOverstriding exemplars', () => {
  it('ghosts the furthest-reaching strike against the closest-landing one', () => {
    // Offsets / 150px torso -> ratios 0.5, 0.5, 0.4, 0.5, 0.5, 0.6, 0.5. Strikes land on the
    // middle frame of each 10-frame block, so strike k is at t = (10k + 5) / 30.
    const frames = buildStrikeFrames({ ankleOffsetsPx: [75, 75, 60, 75, 75, 90, 75] })

    const result = computeOverstriding(frames, 'side')
    const [evidence] = result.exemplars!

    expect(result.value).toBeCloseTo(0.5, 10)
    expect(result.exemplars).toHaveLength(1)
    expect(evidence.kind).toBe('overstrideRange')
    expect(evidence.timestamp).toBeCloseTo(55 / 30, 10) // the 0.6 strike
    expect(evidence.pairedTimestamp).toBeCloseTo(25 / 30, 10) // the 0.4 strike
    // Five of the seven ratios are identical, so the MAD is 0 and there is no spread to judge an
    // extreme against — neutral rather than confident.
    expect(evidence.quality).toBe(0.5)
    expect(evidence.side).toBe('left') // both instants happen to be the same foot here
    // Stated per instant regardless, because this metric always knows it — unlike `side`, whose
    // presence is a property of how the pair happened to fall rather than of what was measured.
    // The mixed-foot pair, where `side` is absent and these two are the ONLY carriers of foot
    // identity, is asserted at the plan layer (`evidenceFrames.test.ts`) rather than here: on an
    // alternating-foot clip this metric's most/least strikes are always opposite-signed about a
    // near-zero median, which puts them under the 1.5-MAD typicality ramp — and any fixture wide
    // enough to clear the ramp trips `isOutlier`'s 3-MAD reject instead. Both squeeze from the
    // same MAD, so no offset series reaches a mixed-foot exemplar through `selectExemplars`;
    // reaching one here would mean tuning numbers against a gate rather than testing the emission.
    expect(evidence.measuredSide).toBe('left')
    expect(evidence.pairedMeasuredSide).toBe('left')
  })

  it('crops around the striking foot and the hip midline, with the knee as context', () => {
    const frames = buildStrikeFrames({ ankleOffsetsPx: [75, 75, 60, 75, 75, 90, 75] })

    const [evidence] = computeOverstriding(frames, 'side').exemplars!

    expect(evidence.cropKeypoints).toEqual(['left_ankle', 'left_hip', 'right_hip', 'left_knee'])
  })

  it('falls back to the next-furthest strike when the furthest one is interpolated', () => {
    // Ratios 0.4, 0.45, 0.5, 0.5, 0.55, 0.6, 0.64 -> median 0.5, MAD 0.05, outlier bound 0.15.
    // The 0.64 strike survives the bound and is the value argmax, but its ankle and hips are
    // interpolated, so it scores 0 and would take the whole pair to zero under rank-by-value.
    const frames = withInterpolatedStrike(
      buildStrikeFrames({ ankleOffsetsPx: [60, 67.5, 75, 75, 82.5, 90, 96] }),
      6,
    )

    const result = computeOverstriding(frames, 'side')
    const [evidence] = result.exemplars!

    expect(result.exemplars).toHaveLength(1)
    expect(evidence.timestamp).toBeCloseTo(55 / 30, 10) // the 0.6 strike, detected
    expect(evidence.pairedTimestamp).toBeCloseTo(5 / 30, 10) // the 0.4 strike
    expect(evidence.quality).toBeCloseTo(0.1 / 0.15, 6)
  })

  it('emits nothing on a clip whose strikes all land in the same place', () => {
    const frames = buildStrikeFrames({ ankleOffsetsPx: [75, 75, 75, 75, 75] })

    expect(computeOverstriding(frames, 'side').exemplars).toBeUndefined()
  })
})
