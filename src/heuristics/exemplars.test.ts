import { describe, expect, it } from 'vitest'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { buildFrame } from './__fixtures__/testFrames'
import { findNearestFrame } from '../results/skeletonGeometry'
import { trimToPresenceWindow } from './presenceWindow'
import { computeTrunkLean } from './trunkLean'
import {
  MAX_EXEMPLARS_PER_METRIC,
  MIN_EXEMPLAR_QUALITY,
  cropDerivable,
  cropKeypoints,
  describeDistribution,
  detectionFactor,
  isOutlier,
  pairQuality,
  scoreExemplarInstant,
  selectExemplars,
  selectExtremePair,
  selectOppositeSidePair,
} from './exemplars'
import type { MetricExemplar } from './types'

const TORSO_PX = 150

/** A frame carrying a full torso, so crop-seed resolution is never the thing under test. */
function torsoFrame(
  timestamp = 0,
  overrides: Parameters<typeof buildFrame>[0] = {},
): RobustPoseFrame {
  return buildFrame(
    {
      left_shoulder: { x: 197, y: 250 },
      right_shoulder: { x: 203, y: 250 },
      left_hip: { x: 197, y: 400 },
      right_hip: { x: 203, y: 400 },
      ...overrides,
    },
    timestamp,
  )
}

/** Shoulders/hips positioned so `computeTrunkLean` reads back exactly `deg` (see trunkLean.ts's
 * `atan2(dx, -dy)`): a rigid torso rotated about the hip. */
function leanFrame(deg: number, timestamp: number): RobustPoseFrame {
  const rad = (deg * Math.PI) / 180
  const dx = TORSO_PX * Math.sin(rad)
  const dy = -TORSO_PX * Math.cos(rad)
  return buildFrame(
    {
      left_hip: { x: 197, y: 400 },
      right_hip: { x: 203, y: 400 },
      left_shoulder: { x: 197 + dx, y: 400 + dy },
      right_shoulder: { x: 203 + dx, y: 400 + dy },
    },
    timestamp,
  )
}

const SEED = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'] as const

function exemplar(quality: number, timestamp = 0): MetricExemplar {
  return {
    kind: 'trunkLeanRange',
    timestamp,
    quality,
    label: 'x',
    cropKeypoints: [...SEED],
  }
}

describe('describeDistribution', () => {
  it('reports the median and the median absolute deviation about it', () => {
    const distribution = describeDistribution([4, 4.5, 5, 5, 5.5, 6, 20])

    expect(distribution.median).toBe(5)
    // deviations sorted: 0, 0, 0.5, 0.5, 1, 1, 15 -> median 0.5.
    expect(distribution.mad).toBe(0.5)
    expect(distribution.sampleCount).toBe(7)
    expect(distribution.usable).toBe(true)
  })

  it('is unusable below five instances, or when every value is identical', () => {
    expect(describeDistribution([1, 2, 3, 4]).usable).toBe(false)
    expect(describeDistribution([7, 7, 7, 7, 7, 7]).usable).toBe(false)
    expect(describeDistribution([]).usable).toBe(false)
  })
})

describe('isOutlier', () => {
  const distribution = describeDistribution([4, 4.5, 5, 5, 5.5, 6, 20])

  it('rejects beyond three MADs of the median and keeps everything inside', () => {
    expect(isOutlier(20, distribution)).toBe(true) // 15 away, bound is 1.5
    expect(isOutlier(6, distribution)).toBe(false)
    expect(isOutlier(6.5, distribution)).toBe(false) // exactly on the bound
  })

  it('never rejects when there is no usable distribution', () => {
    // A bound derived from zero spread would reject everything that isn't exactly the median,
    // which is the opposite of the neutral fallback the score takes in that same case.
    expect(isOutlier(99, describeDistribution([7, 7, 7, 7, 7, 7]))).toBe(false)
  })
})

describe('detectionFactor', () => {
  it('is 1 when every input keypoint was directly detected', () => {
    expect(detectionFactor(torsoFrame(), [...SEED])).toBe(1)
  })

  it('penalises an interpolated or missing input partially, not totally', () => {
    // The correction that matters: `resolveMidpoint` flags a one-sided pair as interpolated even
    // when the resolved side was detected, so scoring per RESOLVED INPUT rather than per keypoint
    // would drive a two-midpoint metric to a flat 0 on any frame where both pairs were one-sided.
    const oneSidedShoulders = buildFrame(
      {
        left_shoulder: { x: 197, y: 250 },
        left_hip: { x: 197, y: 400 },
        right_hip: { x: 203, y: 400 },
      },
      0,
    )
    expect(detectionFactor(oneSidedShoulders, [...SEED])).toBe(0.75)

    const interpolatedHip = torsoFrame(0, {
      right_hip: { x: 203, y: 400, status: 'interpolated' },
    })
    expect(detectionFactor(interpolatedHip, [...SEED])).toBe(0.75)
  })
})

describe('cropDerivable', () => {
  it('needs one resolvable seed point, not all of them', () => {
    // Most seeds here are bilateral pairs that resolve from a single side; an all-must-resolve
    // rule would discard instants the metric successfully measured and can be cropped around.
    const oneHip = buildFrame({ left_hip: { x: 197, y: 400 } }, 0)
    expect(cropDerivable(oneHip, [...SEED])).toBe(true)
    expect(cropDerivable(buildFrame({}, 0), [...SEED])).toBe(false)
  })
})

describe('cropKeypoints', () => {
  it('keeps the seed, dedupes it, and drops context that resolves nowhere', () => {
    const frame = torsoFrame(0, { nose: { x: 200, y: 200 } })

    expect(
      cropKeypoints(
        ['left_hip', 'right_hip', 'left_hip'],
        ['nose', 'left_heel', 'right_hip'],
        [frame],
      ),
    ).toEqual(['left_hip', 'right_hip', 'nose'])
  })

  it('keeps context that resolves in either frame of a pair', () => {
    const withNose = torsoFrame(0, { nose: { x: 200, y: 200 } })
    const withoutNose = torsoFrame(1)

    expect(cropKeypoints(['left_hip'], ['nose'], [withoutNose, withNose])).toEqual([
      'left_hip',
      'nose',
    ])
  })
})

describe('scoreExemplarInstant', () => {
  const distribution = describeDistribution([4, 4.5, 5, 5, 5.5, 6, 20])

  it('scores a representative instant higher the closer it sits to the median', () => {
    const near = scoreExemplarInstant(
      { frame: torsoFrame(), seed: [...SEED], value: 5 },
      'representative',
      distribution,
    )
    const far = scoreExemplarInstant(
      { frame: torsoFrame(), seed: [...SEED], value: 6 },
      'representative',
      distribution,
    )

    expect(near).toBe(1)
    expect(far).toBeCloseTo(1 - 1 / 1.5, 10)
    expect(near!).toBeGreaterThan(far!)
  })

  it('inverts that ranking for an extreme instant', () => {
    const near = scoreExemplarInstant(
      { frame: torsoFrame(), seed: [...SEED], value: 5 },
      'extreme',
      distribution,
    )
    const far = scoreExemplarInstant(
      { frame: torsoFrame(), seed: [...SEED], value: 6 },
      'extreme',
      distribution,
    )

    expect(near).toBe(0)
    expect(far).toBeCloseTo(1 / 1.5, 10)
    expect(far!).toBeGreaterThan(near!)
  })

  it('prefers a detected instant over an interpolated one at the same distance', () => {
    const detected = scoreExemplarInstant(
      { frame: torsoFrame(), seed: [...SEED], value: 5 },
      'representative',
      distribution,
    )
    const interpolated = scoreExemplarInstant(
      {
        frame: torsoFrame(0, { right_hip: { x: 203, y: 400, status: 'interpolated' } }),
        seed: [...SEED],
        value: 5,
      },
      'representative',
      distribution,
    )

    expect(detected!).toBeGreaterThan(interpolated!)
    expect(interpolated).toBe(0.75)
  })

  it('hard-rejects an extreme instant beyond the outlier bound', () => {
    expect(
      scoreExemplarInstant(
        { frame: torsoFrame(), seed: [...SEED], value: 20 },
        'extreme',
        distribution,
      ),
    ).toBeNull()
    // The same instant is merely low-scoring, not rejected, in the representative role.
    expect(
      scoreExemplarInstant(
        { frame: torsoFrame(), seed: [...SEED], value: 20 },
        'representative',
        distribution,
      ),
    ).toBe(0)
  })

  it('hard-rejects an instant with no resolvable crop seed at all', () => {
    expect(
      scoreExemplarInstant(
        { frame: buildFrame({}, 0), seed: [...SEED], value: 5 },
        'representative',
        distribution,
      ),
    ).toBeNull()
  })

  it('scores a context instant on resolvability alone — it has no typicality to judge', () => {
    // kneeFlexion's extension trough is what makes the flexion angle legible; it is not itself a
    // measurement, so it never enters the metric's distribution.
    expect(
      scoreExemplarInstant({ frame: torsoFrame(), seed: [...SEED] }, 'representative', distribution),
    ).toBe(1)
    expect(
      scoreExemplarInstant(
        {
          frame: torsoFrame(0, { right_hip: { x: 203, y: 400, status: 'interpolated' } }),
          seed: [...SEED],
        },
        'representative',
        distribution,
      ),
    ).toBe(0.75)
  })

  it('falls back to neutral rather than confident when there is no distribution', () => {
    const flat = describeDistribution([7, 7, 7, 7, 7, 7])

    expect(
      scoreExemplarInstant(
        { frame: torsoFrame(), seed: [...SEED], value: 9 },
        'representative',
        flat,
      ),
    ).toBe(1)
    expect(
      scoreExemplarInstant({ frame: torsoFrame(), seed: [...SEED], value: 9 }, 'extreme', flat),
    ).toBe(0.5)
  })
})

describe('pairQuality', () => {
  it('takes the weaker instant — one unreadable half makes one unreadable image', () => {
    expect(pairQuality(0.9, 0.4)).toBe(0.4)
  })
})

describe('selectExtremePair', () => {
  /** Median 5, MAD 0.5, so the outlier bound is 1.5 and the typicality ramp is |v - 5| / 1.5.
   * 6.4 is the value argmax at 0.933 of the ramp; 6 and 4 sit one MAD out at 2/3. */
  const VALUES = [4, 4.5, 5, 5, 5.5, 6, 6.4]
  const DISTRIBUTION = describeDistribution(VALUES)

  interface Candidate {
    frame: RobustPoseFrame
    value: number
  }

  const toInstant = (candidate: Candidate) => ({
    frame: candidate.frame,
    seed: [...SEED],
    value: candidate.value,
  })

  /** A torso whose `interpolatedNames` resolve with real coordinates but `'interpolated'` status —
   * the shape that reads as a position the detector never actually saw. */
  function torsoFrameInterpolating(
    timestamp: number,
    interpolatedNames: readonly ('left_shoulder' | 'right_shoulder' | 'left_hip' | 'right_hip')[],
  ): RobustPoseFrame {
    const base = {
      left_shoulder: { x: 197, y: 250 },
      right_shoulder: { x: 203, y: 250 },
      left_hip: { x: 197, y: 400 },
      right_hip: { x: 203, y: 400 },
    }
    const overrides = Object.fromEntries(
      interpolatedNames.map((name) => [name, { ...base[name], status: 'interpolated' as const }]),
    )
    return torsoFrame(timestamp, overrides)
  }

  const WHOLE_TORSO = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'] as const

  /** Every candidate detected, except those named in `interpolated`, whose whole torso is. */
  function candidates(interpolated: Partial<Record<number, true>> = {}): Candidate[] {
    return VALUES.map((value, i) => ({
      frame: interpolated[value]
        ? torsoFrameInterpolating(i / 30, WHOLE_TORSO)
        : torsoFrame(i / 30),
      value,
    }))
  }

  it('prefers a well-tracked near-extreme over an interpolated value-extreme', () => {
    // 6.4 is the most extreme survivor and would win a rank-by-value selection, but its torso is
    // entirely interpolated, so it scores 0 x 0.933 = 0 and takes the whole pair to zero with it.
    const pair = selectExtremePair(candidates({ 6.4: true }), toInstant, DISTRIBUTION)

    expect(pair).not.toBeNull()
    expect(pair!.base.value).toBe(6)
    expect(pair!.ghost.value).toBe(4)
    expect(pair!.quality).toBeCloseTo(1 / 1.5, 10)
  })

  it('selects the value extremes when every candidate is tracked the same way', () => {
    // The generalisation this change rests on: ranking only diverges from the old rank-by-value
    // rule where tracking quality actually differs.
    const pair = selectExtremePair(candidates(), toInstant, DISTRIBUTION)

    expect(pair!.base.value).toBe(6.4)
    expect(pair!.ghost.value).toBe(4)
    expect(pair!.quality).toBeCloseTo(1 / 1.5, 10)
  })

  it('keeps one end either side of the median even when the two best scores share a side', () => {
    // Both below-median candidates are half-interpolated, so the two highest scores overall
    // (6.4 at 0.933 and 6 at 0.667) both sit above the median. An unconstrained ranking would
    // ghost those two together and depict no range at all.
    const withWeakLowSide = candidates().map((candidate) => {
      if (candidate.value >= 5) return candidate
      const frame = torsoFrameInterpolating(candidate.frame.timestamp, ['left_hip', 'right_hip'])
      return { ...candidate, frame }
    })

    const pair = selectExtremePair(withWeakLowSide, toInstant, DISTRIBUTION)

    expect(pair!.base.value).toBe(6.4)
    expect(pair!.ghost.value).toBe(4)
    expect(pair!.quality).toBeCloseTo(0.5 * (1 / 1.5), 10)
  })

  it('never selects an instant beyond the outlier bound, however extreme', () => {
    const withGlitch = [
      ...candidates(),
      { frame: torsoFrame(7 / 30), value: 20 },
    ]

    const pair = selectExtremePair(withGlitch, toInstant, DISTRIBUTION)

    expect(pair!.base.value).not.toBe(20)
    expect(pair!.ghost.value).not.toBe(20)
  })

  it('skips a candidate with no derivable crop, and one with no value at all', () => {
    const unusable = [
      ...candidates().filter((candidate) => candidate.value !== 6.4),
      // Extreme, but nothing to crop around.
      { frame: buildFrame({}, 7 / 30), value: 6.4 },
    ]

    expect(selectExtremePair(unusable, toInstant, DISTRIBUTION)!.base.value).toBe(6)

    // A context instant carries no value, so it is no end of a range.
    expect(
      selectExtremePair(
        candidates(),
        (candidate) =>
          candidate.value === 6.4
            ? { frame: candidate.frame, seed: [...SEED] }
            : toInstant(candidate),
        DISTRIBUTION,
      )!.base.value,
    ).toBe(6)
  })

  it('emits nothing when there is no range to show', () => {
    const flat = [5, 5, 5, 5, 5].map((value, i) => ({ frame: torsoFrame(i / 30), value }))

    expect(selectExtremePair(flat, toInstant, describeDistribution([5, 5, 5, 5, 5]))).toBeNull()
    expect(selectExtremePair([], toInstant, DISTRIBUTION)).toBeNull()
  })
})

describe('selectOppositeSidePair', () => {
  const distribution = describeDistribution([1, 2, 3, 4, 5])

  it('picks the adjacent opposite-side pair closest to the median', () => {
    const ordered = [
      { side: 'left' as const, value: 1 },
      { side: 'right' as const, value: 5 },
      { side: 'left' as const, value: 3 },
      { side: 'right' as const, value: 3 },
    ]

    expect(selectOppositeSidePair(ordered, distribution)).toEqual([ordered[2], ordered[3]])
  })

  it('returns null when no two adjacent entries are opposite feet', () => {
    const ordered = [
      { side: 'left' as const, value: 2 },
      { side: 'left' as const, value: 3 },
      { side: 'left' as const, value: 4 },
    ]

    expect(selectOppositeSidePair(ordered, distribution)).toBeNull()
  })
})

describe('selectExemplars', () => {
  it('keeps only candidates at or above the shared minimum quality', () => {
    expect(selectExemplars([exemplar(MIN_EXEMPLAR_QUALITY)])).toHaveLength(1)
    expect(selectExemplars([exemplar(MIN_EXEMPLAR_QUALITY - 0.001)])).toBeUndefined()
  })

  it('returns the highest-quality survivors, ranked, capped at the per-metric budget', () => {
    const kept = selectExemplars([
      exemplar(0.6, 1),
      exemplar(0.95, 2),
      exemplar(0.8, 3),
      exemplar(0.2, 4),
    ])

    expect(kept).toHaveLength(MAX_EXEMPLARS_PER_METRIC)
    expect(kept!.map((e) => e.timestamp)).toEqual([2, 3])
  })

  it('is undefined, never an empty array, when nothing clears the gate', () => {
    expect(selectExemplars([])).toBeUndefined()
    expect(selectExemplars([exemplar(0.1)])).toBeUndefined()
  })
})

/**
 * The epic's most likely silent-corruption bug, tested directly rather than incidentally:
 * heuristics run over the presence-TRIMMED array while the rest of the app holds the UNTRIMMED
 * one, so anything a metric emitted as an INDEX would be off by the number of leading frames the
 * trim removed — zero on a clip where the subject is present from frame one, and non-zero on
 * exactly the clips this evidence is most useful for.
 */
describe('the exemplar timestamp invariant across the presence trim', () => {
  /** Leading and trailing dead frames around a real, measurable stretch — so the trim is NOT a
   * no-op, which is the only shape of fixture that can prove anything here. */
  function clipWithLateEntry(): RobustPoseFrame[] {
    const leanValues = [4, 4.5, 5, 5, 5.5, 6, 20]
    const frames: RobustPoseFrame[] = []
    for (let i = 0; i < 4; i += 1) frames.push(buildFrame({}, i / 30))
    leanValues.forEach((deg, i) => frames.push(leanFrame(deg, (4 + i) / 30)))
    for (let i = 0; i < 2; i += 1) frames.push(buildFrame({}, (11 + i) / 30))
    return frames
  }

  it('resolves an exemplar against the untrimmed frames to the frame the metric saw', () => {
    const untrimmed = clipWithLateEntry()
    const trimmed = trimToPresenceWindow(untrimmed)

    const leadingRemoved = untrimmed.indexOf(trimmed[0])
    expect(leadingRemoved).toBe(4)
    expect(trimmed).toHaveLength(7)

    const result = computeTrunkLean(trimmed, 'side')
    const [evidence] = result.exemplars!

    for (const timestamp of [evidence.timestamp, evidence.pairedTimestamp!]) {
      // What the metric itself saw, in the array it actually ran over...
      const seenByMetric = trimmed.find((frame) => frame.timestamp === timestamp)!
      // ...and the same instant resolved the way the UI resolves it, against the untrimmed array.
      const resolvedByConsumer = findNearestFrame(untrimmed, timestamp)

      expect(resolvedByConsumer).toBe(seenByMetric) // same object, not merely equal

      // The hazard the rule exists to prevent: the two arrays' indices genuinely disagree here.
      expect(untrimmed.indexOf(seenByMetric) - trimmed.indexOf(seenByMetric)).toBe(leadingRemoved)
    }
  })

  it('carries no frame index of any kind', () => {
    const trimmed = trimToPresenceWindow(clipWithLateEntry())
    const [evidence] = computeTrunkLean(trimmed, 'side').exemplars!

    expect(Object.keys(evidence)).not.toContain('frameIndex')
    expect(Object.keys(evidence)).not.toContain('index')
  })
})
