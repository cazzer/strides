import { describe, expect, it } from 'vitest'
import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { computeOverstriding } from './overstriding'
import { MIN_EXEMPLAR_QUALITY } from './exemplars'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildStrikeFrames } from './__fixtures__/strikeFrames'
import { buildFrame } from './__fixtures__/testFrames'
import {
  withAnkleSeparationScaled,
  withCollapsedAnklesAt,
} from './__fixtures__/collapsedAnkles'
import { resolveMidpoint, resolvePoint } from './keypoints'

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
    // Same reasoning, same coverage boundary, for the per-instant ANNOTATION sets: they are stated
    // unconditionally here, and the mixed-foot case where they diverge from `cropKeypoints` is
    // asserted at the plan layer (`evidenceFrames.test.ts`) and the annotation layer
    // (`evidenceAnnotations.test.ts`) with a hand-built exemplar, for the reason above.
    expect(evidence.annotationKeypoints).toBeDefined()
    expect(evidence.pairedAnnotationKeypoints).toBeDefined()
  })

  it('crops around the striking foot and the hip midline, with the knee as context', () => {
    const frames = buildStrikeFrames({ ankleOffsetsPx: [75, 75, 60, 75, 75, 90, 75] })

    const [evidence] = computeOverstriding(frames, 'side').exemplars!

    expect(evidence.cropKeypoints).toEqual(['left_ankle', 'left_hip', 'right_hip', 'left_knee'])
    // On a SAME-side pair the annotation set and the crop set coincide — both instants measured the
    // same foot, so the union names nothing extra. Asserted rather than assumed, so a future
    // divergence here surfaces as a failure instead of as a quietly different picture.
    expect(evidence.annotationKeypoints).toEqual(evidence.cropKeypoints)
    expect(evidence.pairedAnnotationKeypoints).toEqual(evidence.annotationKeypoints)
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

  it('derives each alternate pair\'s foot identity from that pair, not from the winner', () => {
    // The alternates exist so the evidence layer can fall back when the winner cannot be drawn —
    // which means every one of them has to be a complete, independently renderable exemplar. Foot
    // identity is the field most easily got wrong by copying the winner's: `side` is present only
    // when a pair's two strikes happen to share a foot, and that is a property of the pair.
    const frames = buildStrikeFrames({ ankleOffsetsPx: [75, 75, 60, 75, 75, 90, 75] })

    const [evidence] = computeOverstriding(frames, 'side').exemplars!

    // Head unchanged: still the 0.6 strike ghosted against the 0.4 one.
    expect(evidence.timestamp).toBeCloseTo(55 / 30, 10)
    expect(evidence.alternates!.length).toBeGreaterThan(0)
    for (const alternate of evidence.alternates!) {
      expect(alternate.kind).toBe('overstrideRange')
      expect(alternate.quality).toBeLessThanOrEqual(evidence.quality)
      expect(alternate.quality).toBeGreaterThanOrEqual(MIN_EXEMPLAR_QUALITY)
      expect(alternate.pairedTimestamp).toBeDefined()
      expect(alternate.measuredSide).toBeDefined()
      expect(alternate.pairedMeasuredSide).toBeDefined()
      // Same obligation for the per-instant annotation sets, and for the same reason: an alternate
      // is rendered in the winner's place, so it has to be independently drawable — and each set
      // is built from its OWN instant's frame, so a strike shared with another pairing carries the
      // same one rather than one shaped by whichever partner it happened to draw.
      expect(alternate.annotationKeypoints).toBeDefined()
      expect(alternate.pairedAnnotationKeypoints).toBeDefined()
      expect(alternate.annotationKeypoints).toContain(
        `${alternate.measuredSide}_ankle`,
      )
      expect(alternate.pairedAnnotationKeypoints).toContain(
        `${alternate.pairedMeasuredSide}_ankle`,
      )
      // `side` is a PAIR-level claim, so it may only be present when the pair's two feet agree.
      if (alternate.side !== undefined) {
        expect(alternate.side).toBe(alternate.measuredSide)
        expect(alternate.measuredSide).toBe(alternate.pairedMeasuredSide)
      }
      expect(alternate.alternates).toBeUndefined()
      // A pair really is a pair: an alternate that ghosted an instant against itself would depict
      // no range at all.
      expect(alternate.pairedTimestamp).not.toBe(alternate.timestamp)
    }
  })

  it('emits nothing on a clip whose strikes all land in the same place', () => {
    const frames = buildStrikeFrames({ ankleOffsetsPx: [75, 75, 75, 75, 75] })

    expect(computeOverstriding(frames, 'side').exemplars).toBeUndefined()
  })
})

describe('computeOverstriding — strikes whose two ankles have collapsed onto one point', () => {
  /** 1.6s at 170spm emits exactly four strikes, at frames 5 / 16 / 26 / 37. */
  const FOUR_STRIKE_PARAMS = {
    ...BASE_PARAMS,
    durationSec: 1.6,
    strideAmplitudePx: 80,
    view: 'side' as const,
  }
  /** The outer two — the shape `strides-1mt` measured on Demo 1, where the first and the last of
   * four strikes were the collapsed ones and happened to be the median's discarded extremes. */
  const COLLAPSED_FRAMES = [5, 37]

  /** What this metric measures at one strike, computed here rather than taken from the metric. */
  function ratioAt(frames: RobustPoseFrame[], frameIndex: number, side: 'left' | 'right') {
    const frame = frames[frameIndex]
    const ankle = resolvePoint(frame, side === 'left' ? 'left_ankle' : 'right_ankle')!
    const hip = resolveMidpoint(frame, 'left_hip', 'right_hip')!
    return (ankle.x - hip.x) / 150
  }

  it('drops them from the sample, keeps them in the coverage denominator, and prices both', () => {
    const clean = generateSyntheticGait(FOUR_STRIKE_PARAMS)
    const baseline = computeOverstriding(clean, 'side')
    expect(baseline.sampleSize).toBe(4)
    expect(baseline.frameCoverage).toBe(1)

    const frames = withCollapsedAnklesAt(clean, COLLAPSED_FRAMES)
    const result = computeOverstriding(frames, 'side')

    // Two of four strikes survive, and the other two are still counted as candidates: a collapsed
    // ankle pair IS an ankle that failed to resolve, which is exactly what this denominator has
    // always measured. The thinning is therefore priced twice — once through coverage and once
    // through the sample-size factor — the same way a strike with no resolvable hip already is.
    expect(result.sampleSize).toBe(2)
    expect(result.frameCoverage).toBe(0.5)
    expect(result.interpolatedFraction).toBe(0)
    // 1 (side) x 0.5 (coverage) x 1 (nothing interpolated) x min(1, 2/4) x 1 (direction known).
    expect(result.confidence).toBeCloseTo(0.25, 10)

    // The reported number is the median of the SURVIVORS, computed independently here.
    const survivors = [ratioAt(frames, 16, 'right'), ratioAt(frames, 26, 'left')]
    expect(result.value).toBeCloseTo((survivors[0] + survivors[1]) / 2, 10)
  })

  it('draws its exemplar only from surviving strikes', () => {
    const clean = generateSyntheticGait(FOUR_STRIKE_PARAMS)
    const frames = withCollapsedAnklesAt(clean, COLLAPSED_FRAMES)
    const result = computeOverstriding(frames, 'side')

    const survivingTimestamps = [frames[16].timestamp, frames[26].timestamp]
    for (const exemplar of result.exemplars ?? []) {
      expect(survivingTimestamps).toContain(exemplar.timestamp)
      if (exemplar.pairedTimestamp !== undefined) {
        expect(survivingTimestamps).toContain(exemplar.pairedTimestamp)
      }
    }
  })

  it('still recommends four strikes, because the minimum is a gait cycle and not a noise budget', () => {
    // Pins the decision NOT to raise MIN_OVERSTRIDE_SAMPLE_SIZE alongside this gate. `stepWidth`'s
    // derived `n >= 2k + 3` minimum takes `k = 2` from two contamination mechanisms, and this gate
    // removes the second of them at source — so post-gate `k = 0`, `n >= 3`, and 4 already clears
    // it. Raising it to 7 would charge the same thinning twice.
    const frames = withCollapsedAnklesAt(
      generateSyntheticGait(FOUR_STRIKE_PARAMS),
      COLLAPSED_FRAMES,
    )
    expect(computeOverstriding(frames, 'side').caveat).toContain('at least 4')
  })
})

describe('computeOverstriding — a clip whose every strike has collapsed ankles', () => {
  it('names the ankles as the cause, not the hips', () => {
    // Reachable, not hypothetical: `withAnkleSeparationScaled` squeezes every pair below the floor
    // while leaving the hips (and therefore the fit, the timing and the hip-mid this metric reads)
    // completely intact. The old single caveat would have blamed hip resolution for a failure the
    // hips had no part in — in a change whose whole value is that the discount stops misdescribing
    // the sample.
    const frames = withAnkleSeparationScaled(
      generateSyntheticGait({
        ...BASE_PARAMS,
        durationSec: 1.6,
        strideAmplitudePx: 80,
        view: 'side',
      }),
      0.2,
    )

    const result = computeOverstriding(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.sampleSize).toBe(0)
    expect(result.frameCoverage).toBe(0)
    expect(result.caveat).toContain('the two ankles were too close together')
    expect(result.caveat).not.toContain('hip position')
  })
})
