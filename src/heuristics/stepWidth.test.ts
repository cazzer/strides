import { describe, expect, it } from 'vitest'
import { computeStepWidth } from './stepWidth'
import { detectFootstrikes } from './footstrikes'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildStrikeFrames, withStaticOppositeAnkle } from './__fixtures__/strikeFrames'
import { buildFrame } from './__fixtures__/testFrames'
import { median } from './mathUtils'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { KeypointName } from '../pose/types'

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

/**
 * Returns a copy of `frames` with the single named keypoint at `frameIndex` forced to
 * `'unrecoverable'` (null x/y), every other keypoint on that frame and every other frame left
 * untouched. Used to simulate "this frame's other-side hip briefly dropped out" without having to
 * re-derive a fixture's own position formulas.
 */
function withKeypointUnrecoverable(
  frames: RobustPoseFrame[],
  frameIndex: number,
  keypointName: KeypointName,
): RobustPoseFrame[] {
  return frames.map((frame, i) => {
    if (i !== frameIndex) return frame
    return {
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === keypointName
          ? { ...kp, x: null, y: null, score: 0, status: 'unrecoverable' as const }
          : kp,
      ),
    }
  })
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
    // At or above the metric's own minimum, which is what lets the confidence assertion below
    // read as "nothing is discounting this" rather than as a number with a sample-size haircut in
    // it. (It said 4 while the minimum was 4; both moved to 7 together.)
    expect(result.sampleSize).toBeGreaterThanOrEqual(7)
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
    // `toContain('ambiguous view')` passed for two years while the copy read "a ambiguous";
    // assert the article, which is the part that was wrong (`strides-7wq`).
    expect(result.caveat).toContain('an ambiguous view')
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

  it('a footstrike frame where only the candidate\'s own-side hip resolves: candidate excluded, not corrupted into a false crossover reading', () => {
    // Clean, all-own-side clip (same fixture/params as the first test) as the baseline: every
    // footstrike's hip pair resolves, so every candidate is usable.
    const cleanFrames = buildStepWidthFrames({ ...BASE_PARAMS, crossAmplitudePx: 20 })
    const cleanResult = computeStepWidth(cleanFrames, 'front')
    expect(cleanResult.frameCoverage).toBe(1) // sanity check: baseline has no discards yet

    const candidates = detectFootstrikes(cleanFrames, DEFAULT_HEURISTICS_CONFIG)
    expect(candidates.length).toBeGreaterThan(0)

    // Knock out the OTHER hip (not the candidate's own side) at exactly one footstrike frame --
    // the candidate's own-side hip, ankle, and shoulders are all still fully resolvable there.
    const target = candidates[0]
    const otherHip: KeypointName = target.side === 'left' ? 'right_hip' : 'left_hip'
    const corruptedFrames = withKeypointUnrecoverable(cleanFrames, target.frameIndex, otherHip)

    const result = computeStepWidth(corruptedFrames, 'front')

    // The corrupted candidate must be DISCARDED, not folded in as a false reading: exactly one
    // fewer usable strike than the clean baseline, and frameCoverage drops below 1 to reflect it.
    expect(result.sampleSize).toBe(cleanResult.sampleSize - 1)
    expect(result.frameCoverage).toBeLessThan(1)
    expect(result.frameCoverage).toBeCloseTo((cleanResult.sampleSize - 1) / candidates.length, 5)

    // The remaining, uncorrupted footstrikes should still read as own-side and close to the clean
    // median -- not dragged toward zero or flipped negative the way the pre-fix tolerant hip-mid
    // resolution (`resolveMidpoint`) corrupted this exact scenario into a false crossover data
    // point (see the module doc comment's numeric proof: true +0.483 computed as -0.017).
    expect(result.value as number).toBeGreaterThan(0)
    expect(result.value).toBeCloseTo(cleanResult.value as number, 1)
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
    expect(result.exemplars).toBeUndefined()
  })
})

describe('computeStepWidth exemplars', () => {
  const OFFSETS = [75, 75, 60, 75, 75, 90, 75]

  it('constructs an opposite-foot pair, which the footstrike list does not hand it', () => {
    // `detectFootstrikes` merges both legs into one timestamp-ordered list whose entries need not
    // alternate, and this metric measures each strike independently against the hip midline — so
    // "left plant next to right plant", which is what a width looks like, has to be built.
    const frames = buildStrikeFrames({ ankleOffsetsPx: OFFSETS, alternateFeet: true })

    const result = computeStepWidth(frames, 'front')
    const [evidence] = result.exemplars!

    expect(result.exemplars).toHaveLength(1)
    expect(evidence.kind).toBe('stepWidthStrike')
    expect(evidence.pairedTimestamp).not.toBeUndefined()
    // No single side: the two instants are deliberately opposite feet, so naming one would be
    // wrong about the other.
    expect(evidence).not.toHaveProperty('side')
    // The base is the LEFT plant at frame 5 and the ghost the right plant at frame 10. The right
    // foot's first plant sits on frame 0, which `detectFootstrikes` no longer emits (a candidate
    // with no frame before it has no reversal to confirm it), so the earliest opposite-foot pair
    // this clip offers now begins with the left foot. Which foot leads is incidental to the
    // property under test — that a pair is CONSTRUCTED from a list that does not hand one over —
    // and both instants' own feet are still asserted below.
    expect(evidence.cropKeypoints).toEqual(['left_ankle', 'left_hip', 'right_hip', 'right_ankle'])

    const sides = [evidence.timestamp, evidence.pairedTimestamp!].map(
      (t) => detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG).find((s) => s.timestamp === t)!.side,
    )
    expect(new Set(sides).size).toBe(2)

    // ...and each instant names its OWN foot, which is what `side` structurally cannot say here.
    // Without this a consumer has the two timestamps and no way to know which ankle either was
    // measured from — recoverable only by reading `cropKeypoints` order, which is not a contract.
    expect([evidence.measuredSide, evidence.pairedMeasuredSide]).toEqual(sides)
    expect(evidence.measuredSide).not.toBe(evidence.pairedMeasuredSide)

    // ...and each instant names the keypoints its OWN measurement was about, which the crop set
    // structurally cannot: the crop is the union because one photograph has to hold both plants.
    expect(evidence.annotationKeypoints).toEqual([
      `${evidence.measuredSide}_ankle`,
      'left_hip',
      'right_hip',
    ])
    expect(evidence.pairedAnnotationKeypoints).toEqual([
      `${evidence.pairedMeasuredSide}_ankle`,
      'left_hip',
      'right_hip',
    ])
    expect(evidence.cropKeypoints).toEqual(['left_ankle', 'left_hip', 'right_hip', 'right_ankle'])
    // Ankle-disjointness asserted DIRECTLY, not only through the two interpolations above: those
    // are both written off `measuredSide`, so a run where the pair's two feet coincided would
    // satisfy them while stating one ankle twice.
    expect(evidence.annotationKeypoints).toContain('left_ankle')
    expect(evidence.pairedAnnotationKeypoints).toContain('right_ankle')
    expect(evidence.annotationKeypoints).not.toContain('right_ankle')
    expect(evidence.pairedAnnotationKeypoints).not.toContain('left_ankle')
  })

  it('demotes to a single representative strike when every plant is the same foot', () => {
    // One strike against the hip midline is one whole measurement, so a single frame is still
    // honest here — unlike the range metrics, which have nothing to say from one instant.
    const frames = buildStrikeFrames({ ankleOffsetsPx: OFFSETS })

    const result = computeStepWidth(frames, 'front')
    const [evidence] = result.exemplars!

    expect(result.exemplars).toHaveLength(1)
    expect(evidence).not.toHaveProperty('pairedTimestamp')
    expect(evidence.side).toBe('left')
    expect(evidence.cropKeypoints).toEqual(['left_ankle', 'left_hip', 'right_hip'])
  })

  it('keeps the opposite ankle on the demoted single, and states no per-instant set', () => {
    // The pair and the single are NOT one expression. On the single, the opposite ankle is context
    // this one measurement genuinely is about — a width is read against the midline, which is only
    // legible with the other foot in frame — and there is no second instant for it to be
    // misattributed to. Flattening the two cases would strip it from the drawn set for no reason.
    const frames = withStaticOppositeAnkle(
      buildStrikeFrames({ ankleOffsetsPx: OFFSETS }),
    )

    const [evidence] = computeStepWidth(frames, 'front').exemplars!

    expect(evidence).not.toHaveProperty('pairedTimestamp')
    expect(evidence.side).toBe('left')
    expect(evidence.cropKeypoints).toEqual([
      'left_ankle',
      'left_hip',
      'right_hip',
      'right_ankle',
    ])
    expect(evidence).not.toHaveProperty('annotationKeypoints')
    expect(evidence).not.toHaveProperty('pairedAnnotationKeypoints')
  })

  it('gates out every strike whose outward polarity was invented by the sign fallback', () => {
    // Hips exactly coincident in x collapses hip-mid onto each hip, so `Math.sign(...) || 1`
    // silently picks a polarity. Fine for a median over many strikes; not something to caption a
    // picture "landed on its own side" with.
    const frames = buildStrikeFrames({ ankleOffsetsPx: OFFSETS, hipSpreadPx: 0 })

    const result = computeStepWidth(frames, 'front')

    expect(result.value).not.toBeNull() // the metric itself is unchanged
    expect(result.exemplars).toBeUndefined()
  })
})

/**
 * The arithmetic `MIN_STEP_WIDTH_SAMPLE_SIZE` is derived from, pinned against the numbers that
 * produced it. The constant is module-private, so these read it through the only two things it
 * changes that anyone can observe: the confidence factor and the caveat, both asserted in the
 * metric-level test below. This block is the derivation itself.
 *
 * The ratios are the real ones — Demo 2's background scale pass, five strikes, measured by
 * `strides-87x` and recorded on `strides-h6r`. Two of the five sit on contaminated frames (one on
 * the clip's final sampled frame, one at the edge of the contaminated clip-opening window
 * `strides-boc` measured), and both are HIGH, which is the shape contamination takes here: a
 * degenerate or unconfirmable strike inflates the offset, it does not scatter it. Contaminants
 * biased one way occupy the top ranks, so the median is untouched by them exactly when the middle
 * of the sorted array still lies strictly inside the clean subsample:
 *
 *   odd  n:  (n + 1) / 2  <  n − k   ->  n >= 2k + 2
 *   even n:  n / 2 + 1    <  n − k   ->  n >= 2k + 3     <- binds
 */
describe('the sample-size minimum: n >= 2k + 3', () => {
  /** Demo 2's scale pass, three uncontaminated strikes, ascending. */
  const CLEAN_3 = [-0.00793, 0.16306, 0.40424]
  /** ...and two more, to reach a clean subsample of five. */
  const CLEAN_5 = [-0.00793, 0.1, 0.16306, 0.3, 0.40424]
  /** The two contaminated strikes, both high. `1.38051` is the one on the clip's final frame. */
  const HIGH = [0.84934, 1.38051]

  it('n = 4, k = 1: half the reported number IS the clean sample maximum — why 4 was wrong', () => {
    // The previous constant claimed to be the point where a SINGLE noisy detection stops
    // dominating. At n = 4 the median averages ranks 2 and 3, which are the clean median and the
    // clean MAX: the contaminant is pushed off the top and takes the clean median's partner with
    // it. Four is dominated by one bad strike, which is a correctness defect on its own terms.
    const median4 = median([...CLEAN_3, HIGH[1]])

    expect(median4).toBeCloseTo((CLEAN_3[1] + CLEAN_3[2]) / 2, 12)
    expect(median4).toBeCloseTo(0.28365, 5)
    expect(median4).toBeGreaterThan(median(CLEAN_3))
  })

  it('n = 5, k = 2: the median IS the clean maximum — the measured failure this change is for', () => {
    // At n = 5 the median is simply the third-largest value, so two high contaminants promote the
    // third-smallest into the middle slot. This is the 2.48x that made Demo 2's scale pass read
    // 0.40424 where the clean strikes say 0.16306.
    const median5 = median([...CLEAN_3, ...HIGH])

    expect(median5).toBe(CLEAN_3[2])
    expect(median5).toBeCloseTo(0.40424, 12)
    expect(median5 / median(CLEAN_3)).toBeCloseTo(2.479, 3)
  })

  it('n = 7, k = 2: the median lands strictly inside the clean sample', () => {
    // `2 * 2 + 3 = 7`, and this is what clearing the bound buys: not a better estimate of the clean
    // median, but a reported number that is a clean sample rather than a clean extreme.
    const median7 = median([...CLEAN_5, ...HIGH])

    expect(CLEAN_5).toContain(median7)
    expect(median7).toBeGreaterThan(Math.min(...CLEAN_5))
    expect(median7).toBeLessThan(Math.max(...CLEAN_5))

    // The bound does NOT promise the clean median — `2k + 3` is exactly the point at which the
    // contaminants stop reaching the middle slot, not the point at which they stop shifting it.
    // Claiming otherwise would be claiming a robustness the arithmetic does not deliver.
    expect(median7).not.toBe(median(CLEAN_5))
  })

  it('n = 6, k = 2 is NOT enough — the even case is what binds', () => {
    // `2k + 2 = 6` satisfies the odd inequality and fails the even one, which is why the bound is
    // stated as `2k + 3` rather than as the tighter-looking `2k + 2`.
    const median6 = median([...CLEAN_5.slice(0, 4), ...HIGH])

    expect(median6).toBeGreaterThan(median(CLEAN_5.slice(0, 4)))
  })
})

describe('computeStepWidth — how few strikes are priced', () => {
  it('five strikes report at 5/7 of what the other factors allow, and say so', () => {
    // Five same-offset plants of one foot, none of them on a boundary frame: a front view, full
    // frame coverage, nothing interpolated, so every confidence factor except the sample-size one
    // is provably 1.0 and the reported number is that factor alone.
    const frames = buildStrikeFrames({ ankleOffsetsPx: [-75, -75, -75, -75, -75] })

    const result = computeStepWidth(frames, 'front')

    expect(result.sampleSize).toBe(5)
    expect(result.viewFit).toBe('primary')
    expect(result.frameCoverage).toBe(1)
    expect(result.interpolatedFraction).toBe(0)
    expect(result.confidence).toBeCloseTo(5 / 7, 12)
    expect(result.caveat).toContain('Only 5 footstrike(s) detected (recommend at least 7)')

    // Discounted, never withheld — the shared contract. A thin sample is reported with its price
    // attached rather than replaced by a null the reader cannot interrogate.
    expect(result.value).not.toBeNull()
    expect(result.value as number).toBeGreaterThan(0)
  })

  it('a clip with enough strikes carries neither the discount nor the caveat', () => {
    const frames = buildStrikeFrames({
      ankleOffsetsPx: [-75, -75, -75, -75, -75, -75, -75],
    })

    const result = computeStepWidth(frames, 'front')

    expect(result.sampleSize).toBe(7)
    expect(result.confidence).toBeCloseTo(1, 12)
    expect(result.caveat).toBeNull()
  })
})
