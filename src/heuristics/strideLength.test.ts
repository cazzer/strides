import { describe, expect, it } from 'vitest'
import { estimateStrideLength, STRIDE_PERIOD_TOLERANCE } from './strideLength'
import { detectFootstrikes } from './footstrikes'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import { median } from './mathUtils'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'
import { withCollapsedAnklesAt } from './__fixtures__/collapsedAnkles'
import type { RobustPoseFrame } from '../pose/robustness/types'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  verticalBouncePx: 20,
  trunkLeanDeg: 5,
  view: 'side' as const,
}

// By the fixture's construction (syntheticGait.ts), hip-x advances at travelSpeedPxPerSec
// (default 100px/s), and the hip bounces at 2x STRIDE frequency, where strideFreqHz =
// cadenceStepsPerMin / 120 (two steps, both feet, per full stride). So the true stride PERIOD is
// 120 / cadenceStepsPerMin seconds, and the true stride LENGTH at a given travel speed is
// travelSpeedPxPerSec * (120 / cadenceStepsPerMin). At the defaults (170 spm, 100px/s):
// 100 * 120/170 = 12000/170 = 70.588...px.
const EXPECTED_STRIDE_PX = (100 * 120) / 170
// Footstrike frame indices are discretely sampled at 30fps, so two consecutive same-side
// footstrike timestamps can differ from the true continuous-phase stride period by up to one
// frame — translating into up to one frame's worth of travel distance as pixel error.
const ONE_FRAME_TRAVEL_TOLERANCE = 100 / 30

// Hand-built ankle-y trace for the doubled-interval and endpoint-drop tests below, where full
// control over exactly which frame each footstrike lands on (and exactly how far the hip
// advances between them) matters more than fidelity to a real gait. A "stride block" is 10
// frames wide, ankle-y tracing a triangle bump peaking at the block's 6th frame (offset 5) —
// `detectFootstrikes` keeps ankle-y MAXIMA, so each block contributes exactly one footstrike
// candidate. Hip-x advances by exactly `STRIDE_PX_PER_BLOCK` (70) over each 10-frame block
// (7px/frame), so consecutive same-side footstrike pairs measure exactly 70px apart — a fully
// deterministic expected stride length, no tolerance needed.
const STRIDE_BLOCK = [0, 10, 20, 30, 40, 50, 40, 30, 20, 10]
const STRIDE_PX_PER_BLOCK = 70
const HIP_X_PER_FRAME = STRIDE_PX_PER_BLOCK / STRIDE_BLOCK.length // 7px/frame

function normalAnkleTrace(numStrides: number): number[] {
  const values: number[] = []
  for (let s = 0; s < numStrides; s += 1) values.push(...STRIDE_BLOCK)
  return values
}

/** Same trace as `normalAnkleTrace`, except the stride block at `mergeAtStride` is replaced by a
 * single 20-frame-wide triangle bump spanning what would have been two blocks — simulating a
 * missed footstrike (the tracker only confirms one peak across two real stride cycles) without
 * ever introducing a `null`/gap in the series, so `findLocalExtrema`'s gap-boundary handling
 * (which itself manufactures a spurious extremum at a run edge — not the failure mode under test
 * here) never enters the picture. */
function mergedAnkleTrace(numStrides: number, mergeAtStride: number): number[] {
  const values: number[] = []
  let s = 0
  while (s < numStrides) {
    if (s === mergeAtStride) {
      for (let j = 0; j <= 10; j += 1) values.push(j * 5)
      for (let j = 1; j <= 10; j += 1) values.push(50 - j * 5)
      s += 2
    } else {
      values.push(...STRIDE_BLOCK)
      s += 1
    }
  }
  return values
}

function buildHandFrames(ankleY: number[]): RobustPoseFrame[] {
  return ankleY.map((y, i) => {
    const hipX = 200 + i * HIP_X_PER_FRAME
    return buildFrame(
      {
        left_shoulder: { x: hipX - 5, y: 0 },
        right_shoulder: { x: hipX + 5, y: 0 },
        left_hip: { x: hipX - 5, y: 100 },
        right_hip: { x: hipX + 5, y: 100 },
        left_ankle: { x: hipX, y },
        // The right ankle is left UNRESOLVABLE rather than flatlined, which is what isolates the
        // left side now that `detectFootstrikes` reads each ankle RELATIVE to the other one: a
        // flat-but-present right ankle would make the right side's contact series a mirror of the
        // left's and yield a full set of right-side candidates. With no right ankle at all there
        // is no contralateral reference, `buildContactSeries` falls back to raw left ankle-y, and
        // these hand-computed traces mean exactly what they did before.
      },
      i / 30,
    )
  })
}

/**
 * The `StridePair`s a clean `normalAnkleTrace` clip should have produced, derived independently
 * from `detectFootstrikes` rather than read back off the result under test — so the two
 * whole-object assertions below keep doing real work now that `StrideLengthResult` carries its
 * pairs. `buildHandFrames` leaves the right ankle unresolvable, so every candidate is a left-side
 * one.
 */
function expectedCleanPairs(frames: RobustPoseFrame[]) {
  const strikes = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG).filter(
    (candidate) => candidate.side === 'left',
  )
  return strikes.slice(0, -1).map((strike, i) => ({
    side: 'left' as const,
    displacementPx: STRIDE_PX_PER_BLOCK,
    startFrame: frames[strike.frameIndex],
    endFrame: frames[strikes[i + 1].frameIndex],
  }))
}

function blankHipPoint(frames: RobustPoseFrame[], indices: Set<number>) {
  return frames.map((frame, i) => {
    if (!indices.has(i)) return frame
    return {
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === 'left_hip' || kp.name === 'right_hip'
          ? { ...kp, x: null, y: null, score: 0, status: 'unrecoverable' as const }
          : kp,
      ),
    }
  })
}

describe('estimateStrideLength', () => {
  it('a clean side-view clip: value close to travelSpeed * strideDuration, sane pair count', () => {
    const frames = generateSyntheticGait(BASE_PARAMS)

    const result = estimateStrideLength(frames, DEFAULT_HEURISTICS_CONFIG)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.strideLengthPx).toBeGreaterThan(
      EXPECTED_STRIDE_PX - ONE_FRAME_TRAVEL_TOLERANCE,
    )
    expect(result.strideLengthPx).toBeLessThan(EXPECTED_STRIDE_PX + ONE_FRAME_TRAVEL_TOLERANCE)
    expect(result.pairCount).toBeGreaterThanOrEqual(3)
    expect(result.candidatePairCount).toBe(result.pairCount)
  })

  it('returns each kept pair whole, and reports exactly those pairs', () => {
    const frames = generateSyntheticGait(BASE_PARAMS)

    const result = estimateStrideLength(frames, DEFAULT_HEURISTICS_CONFIG)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pairs).toHaveLength(result.pairCount)
    // The reported stride length is the median of exactly these pairs -- not of some other set the
    // caller cannot see. `verticalRatio.ts` picks its denominator exemplar off this array, so the
    // two must describe the same measurement.
    expect(median(result.pairs.map((pair) => pair.displacementPx))).toBe(result.strideLengthPx)

    const strikeTimestamps: Record<'left' | 'right', number[]> = { left: [], right: [] }
    for (const candidate of detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)) {
      strikeTimestamps[candidate.side].push(frames[candidate.frameIndex].timestamp)
    }

    for (const pair of result.pairs) {
      expect(pair.displacementPx).toBeGreaterThan(0)
      // Both endpoints are real, CONSECUTIVE same-side footstrike frames -- never re-paired across
      // a dropped strike, which would span two strides and read as one.
      const strikes = strikeTimestamps[pair.side]
      const start = strikes.indexOf(pair.startFrame.timestamp)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(strikes[start + 1]).toBe(pair.endFrame.timestamp)
      expect(frames).toContain(pair.startFrame)
      expect(frames).toContain(pair.endFrame)
    }
  })

  it('parametric travelSpeedPxPerSec proves displacement is actually measured, not a fixture artifact', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, travelSpeedPxPerSec: 200 })

    const result = estimateStrideLength(frames, DEFAULT_HEURISTICS_CONFIG)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const expected = (200 * 120) / 170 // ~141.176px
    const tolerance = 200 / 30 // one frame of travel at the faster speed
    expect(result.strideLengthPx).toBeGreaterThan(expected - tolerance)
    expect(result.strideLengthPx).toBeLessThan(expected + tolerance)
  })

  it('a doubled interval (one missed footstrike) is absorbed by the median, exactly', () => {
    // 7 clean strides -> 7 left-side candidates, 6 consecutive pairs, every one measuring
    // exactly STRIDE_PX_PER_BLOCK (70px) apart by construction.
    const clean = buildHandFrames(normalAnkleTrace(7))
    // Merge the block at stride index 3 with its successor: the tracker only confirms ONE peak
    // across those two real stride cycles, so the pairs on either side of the merge measure
    // ~1.5x/1.6x a normal stride (105px, 112px) instead of doubling exactly -- still clear
    // outliers relative to the other 4 pairs, which stay exactly 70px.
    const merged = buildHandFrames(mergedAnkleTrace(7, 3))

    const cleanResult = estimateStrideLength(clean, DEFAULT_HEURISTICS_CONFIG)
    const mergedResult = estimateStrideLength(merged, DEFAULT_HEURISTICS_CONFIG)

    expect(cleanResult).toEqual({
      ok: true,
      strideLengthPx: STRIDE_PX_PER_BLOCK,
      pairCount: 6,
      candidatePairCount: 6,
      // No `stepFrequencyHz` reference is supplied here, so the period gate is inert.
      periodRejectedPairCount: 0,
      pairs: expectedCleanPairs(clean),
    })
    // The missed footstrike costs one candidate pair (one fewer left-side footstrike total).
    expect(mergedResult.ok).toBe(true)
    if (!mergedResult.ok) return
    expect(mergedResult.pairCount).toBe(5)
    expect(mergedResult.candidatePairCount).toBe(5)
    // The median is UNCHANGED, exactly -- 3 of the 5 pairs are still genuine 70px strides, so the
    // rank statistic ignores the two outlier-shaped pairs entirely. This is the whole point of
    // using a median rather than a mean (see strideLength.ts's module doc).
    expect(mergedResult.strideLengthPx).toBe(STRIDE_PX_PER_BLOCK)
  })

  it('an unresolvable hip at one interior footstrike drops exactly its two adjacent pairs, no re-pairing', () => {
    const clean = buildHandFrames(normalAnkleTrace(7))
    const candidates = detectFootstrikes(clean, DEFAULT_HEURISTICS_CONFIG)
    const leftStrikes = candidates.filter((c) => c.side === 'left')
    expect(leftStrikes).toHaveLength(7)
    // An interior strike (not the first or last for this side) is the endpoint of exactly two
    // candidate pairs (the one ending here, the one starting here) -- blanking hip position only
    // at this single frame should drop exactly those two pairs, without touching any other pair.
    const target = leftStrikes[3]

    const mutated = blankHipPoint(clean, new Set([target.frameIndex]))

    const cleanResult = estimateStrideLength(clean, DEFAULT_HEURISTICS_CONFIG)
    const mutatedResult = estimateStrideLength(mutated, DEFAULT_HEURISTICS_CONFIG)

    expect(cleanResult).toEqual({
      ok: true,
      strideLengthPx: STRIDE_PX_PER_BLOCK,
      pairCount: 6,
      candidatePairCount: 6,
      // No `stepFrequencyHz` reference is supplied here, so the period gate is inert.
      periodRejectedPairCount: 0,
      pairs: expectedCleanPairs(clean),
    })
    expect(mutatedResult.ok).toBe(true)
    if (!mutatedResult.ok) return
    // Footstrike DETECTION is unaffected (it only reads ankle-y) -- same candidate pair count.
    expect(mutatedResult.candidatePairCount).toBe(6)
    // But exactly 2 fewer pairs are USABLE: the pair ending at target and the pair starting at
    // target both lose a resolvable hip endpoint. No re-pairing across the gap.
    expect(mutatedResult.pairCount).toBe(4)
    // The remaining 4 pairs are still all exactly 70px, so the median is unchanged.
    expect(mutatedResult.strideLengthPx).toBe(STRIDE_PX_PER_BLOCK)
  })

  it('indeterminate travel direction (in-place clip) reports travel-direction-unknown', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, travelSpeedPxPerSec: 0 })

    const result = estimateStrideLength(frames, DEFAULT_HEURISTICS_CONFIG)

    expect(result).toEqual({ ok: false, reason: 'travel-direction-unknown' })
  })

  it('checks travel direction before footstrike detection: flat ankles but known travel direction reports too-few-footstrikes, not travel-direction-unknown', () => {
    // Hip-x advances well past half a torso length (150 * 0.5 = 75px) over the clip, so travel
    // direction IS resolvable -- but ankle-y is perfectly flat, so no footstrike extrema exist at
    // all, isolating the too-few-footstrikes path specifically.
    const frames = Array.from({ length: 10 }, (_, i) =>
      buildFrame(
        {
          left_hip: { x: 200 + i * 20, y: 400 },
          right_hip: { x: 200 + i * 20, y: 400 },
          left_shoulder: { x: 200 + i * 20, y: 250 },
          right_shoulder: { x: 200 + i * 20, y: 250 },
          left_ankle: { x: 190 + i * 20, y: 550 },
          right_ankle: { x: 210 + i * 20, y: 550 },
        },
        i / 30,
      ),
    )

    const result = estimateStrideLength(frames, DEFAULT_HEURISTICS_CONFIG)

    expect(result).toEqual({ ok: false, reason: 'too-few-footstrikes' })
  })

  it('no resolvable body-scale reference at all reports no-body-scale', () => {
    const frame = buildFrame({})
    const result = estimateStrideLength([frame, frame], DEFAULT_HEURISTICS_CONFIG)

    expect(result).toEqual({ ok: false, reason: 'no-body-scale' })
  })

  it('an empty frame list reports not-ok without throwing', () => {
    expect(() => estimateStrideLength([], DEFAULT_HEURISTICS_CONFIG)).not.toThrow()
    const result = estimateStrideLength([], DEFAULT_HEURISTICS_CONFIG)
    expect(result.ok).toBe(false)
  })
})

/**
 * The hand-built trace is what makes these assertions exact: every consecutive same-side pair is
 * exactly one 10-frame block apart at 30fps, so every candidate pair's interval is exactly
 * `10/30 = 1/3 s` with no quantization slop at all. Since the expected stride period is
 * `2 / stepFrequencyHz`, a supplied `stepFrequencyHz` of `f` puts every pair at ratio exactly
 * `f / 6` — which makes the reference a direct dial on the ratio under test.
 */
const MATCHING_STEP_FREQUENCY_HZ = 6 // 2/6 = 1/3 s expected stride period == the real interval

describe('estimateStrideLength — fitted-period gate', () => {
  const clean = buildHandFrames(normalAnkleTrace(7))
  const baseline = estimateStrideLength(clean, DEFAULT_HEURISTICS_CONFIG)

  it('keeps every pair whose interval matches the expected stride period', () => {
    const gated = estimateStrideLength(clean, DEFAULT_HEURISTICS_CONFIG, {
      stepFrequencyHz: MATCHING_STEP_FREQUENCY_HZ,
    })

    // Ratio is exactly 1.0 on every pair, so the gate is a no-op: same median, same pairs, and
    // nothing counted as rejected.
    expect(gated).toEqual({ ...baseline, periodRejectedPairCount: 0 })
  })

  it('rejects every pair spanning about half the expected stride period', () => {
    // Half the step frequency doubles the expected stride period, so the real (unchanged) interval
    // reads as ~half a stride -- the spurious-extra-strike signature this gate exists for.
    const gated = estimateStrideLength(clean, DEFAULT_HEURISTICS_CONFIG, {
      stepFrequencyHz: MATCHING_STEP_FREQUENCY_HZ / 2,
    })

    expect(gated).toEqual({ ok: false, reason: 'no-period-consistent-pairs' })
  })

  it('rejects every pair spanning about two strides', () => {
    // The mirror case: doubling the step frequency halves the expected period, so each real
    // interval reads as ~two strides -- the missed-footstrike signature.
    const gated = estimateStrideLength(clean, DEFAULT_HEURISTICS_CONFIG, {
      stepFrequencyHz: MATCHING_STEP_FREQUENCY_HZ * 2,
    })

    expect(gated).toEqual({ ok: false, reason: 'no-period-consistent-pairs' })
  })

  it('rejects only the inconsistent pairs when some are consistent, and still reports a value', () => {
    // The merged trace's missed footstrike leaves two pairs spanning 15 and 16 frames (ratio 1.5
    // and 1.6) among three genuine 10-frame ones. Before the gate, the median was what saved this
    // clip; now the two are rejected outright and counted.
    const merged = buildHandFrames(mergedAnkleTrace(7, 3))

    const gated = estimateStrideLength(merged, DEFAULT_HEURISTICS_CONFIG, {
      stepFrequencyHz: MATCHING_STEP_FREQUENCY_HZ,
    })

    expect(gated.ok).toBe(true)
    if (!gated.ok) return
    expect(gated.candidatePairCount).toBe(5)
    expect(gated.periodRejectedPairCount).toBe(2)
    expect(gated.pairCount).toBe(3)
    expect(gated.strideLengthPx).toBe(STRIDE_PX_PER_BLOCK)
    // The invariant the two counts have to satisfy together.
    expect(gated.pairCount + gated.periodRejectedPairCount).toBeLessThanOrEqual(
      gated.candidatePairCount,
    )
  })

  it('is log-symmetric: just inside both band edges accepts, just outside either rejects', () => {
    // ratio == stepFrequencyHz / 6 on this trace, so these frequencies put every pair just inside
    // and just outside each edge of the band. Deliberately not exactly ON an edge: at the boundary
    // the outcome is decided by float representation, which is not behaviour worth pinning.
    const upperEdge = MATCHING_STEP_FREQUENCY_HZ * (1 + STRIDE_PERIOD_TOLERANCE)
    const lowerEdge = MATCHING_STEP_FREQUENCY_HZ / (1 + STRIDE_PERIOD_TOLERANCE)

    for (const stepFrequencyHz of [upperEdge * 0.999, lowerEdge * 1.001]) {
      const gated = estimateStrideLength(clean, DEFAULT_HEURISTICS_CONFIG, { stepFrequencyHz })
      expect(gated.ok).toBe(true)
      if (!gated.ok) return
      expect(gated.periodRejectedPairCount).toBe(0)
    }

    for (const stepFrequencyHz of [upperEdge * 1.001, lowerEdge / 1.001]) {
      const gated = estimateStrideLength(clean, DEFAULT_HEURISTICS_CONFIG, { stepFrequencyHz })
      expect(gated).toEqual({ ok: false, reason: 'no-period-consistent-pairs' })
    }
  })

  it('is inert without a usable reference, down to every field of the result', () => {
    // Asserted against a same-frames baseline call rather than hardcoded numbers, so this keeps
    // holding if the extractor's other behaviour ever changes.
    const expected = { ...baseline, periodRejectedPairCount: 0 }

    expect(estimateStrideLength(clean, DEFAULT_HEURISTICS_CONFIG, {})).toEqual(expected)
    expect(
      estimateStrideLength(clean, DEFAULT_HEURISTICS_CONFIG, { stepFrequencyHz: undefined }),
    ).toEqual(expected)
    for (const stepFrequencyHz of [0, -6, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(estimateStrideLength(clean, DEFAULT_HEURISTICS_CONFIG, { stepFrequencyHz })).toEqual(
        expected,
      )
    }
  })

  it('keeps reporting no-usable-pairs when nothing was rejected on timing', () => {
    // The new reason is not a rename: a clip that loses every pair for a NON-timing reason must
    // still say so. Blanking the hip at every strike frame drops all pairs at the resolution step
    // while leaving body scale, travel direction and the (period-consistent) intervals intact.
    const strikeFrames = new Set(
      detectFootstrikes(clean, DEFAULT_HEURISTICS_CONFIG).map((candidate) => candidate.frameIndex),
    )
    const blanked = blankHipPoint(clean, strikeFrames)

    const gated = estimateStrideLength(blanked, DEFAULT_HEURISTICS_CONFIG, {
      stepFrequencyHz: MATCHING_STEP_FREQUENCY_HZ,
    })

    expect(gated).toEqual({ ok: false, reason: 'no-usable-pairs' })
  })
})

describe('estimateStrideLength — a pair with a collapsed-ankle endpoint', () => {
  /** 1.6s at 170spm emits exactly four strikes, at frames 5 / 16 / 26 / 37 — left, right, left,
   * right — so both same-side pairs (5→26 and 16→37) have a collapsed endpoint below. */
  const FOUR_STRIKE_PARAMS = { ...BASE_PARAMS, durationSec: 1.6 }

  it('still contributes, because a stride pair is made of timestamps and hips', () => {
    // This is the test that would have caught the naive fix. Dropping an unmeasurable strike
    // inside `detectFootstrikes` instead of annotating it leaves Demo 1 with `left@4.84` +
    // `right@5.52` — zero same-side pairs — and nulls `verticalRatio`, measured. Stride length
    // reads only `timestamp` and hip-mid, and an ankle-label collapse touches neither, so it
    // deliberately ignores `ankleMeasurable`.
    const clean = generateSyntheticGait(FOUR_STRIKE_PARAMS)
    const baseline = estimateStrideLength(clean, DEFAULT_HEURISTICS_CONFIG)
    expect(baseline.ok).toBe(true)
    if (!baseline.ok) return

    const collapsed = withCollapsedAnklesAt(clean, [5, 37])
    // Both endpoints really are marked unmeasurable, so the pairs really are the ones at risk.
    const candidates = detectFootstrikes(collapsed, DEFAULT_HEURISTICS_CONFIG)
    expect(candidates.filter((c) => !c.ankleMeasurable).map((c) => c.frameIndex)).toEqual([5, 37])

    const result = estimateStrideLength(collapsed, DEFAULT_HEURISTICS_CONFIG)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.strideLengthPx).toBe(baseline.strideLengthPx)
    expect(result.pairCount).toBe(baseline.pairCount)
    expect(result.candidatePairCount).toBe(baseline.candidatePairCount)
    expect(result.periodRejectedPairCount).toBe(baseline.periodRejectedPairCount)
    // Compared field-by-field rather than by deep equality: a pair carries its own start/end
    // FRAMES, and those really do differ — the fixture moved the ankles in them. What has to be
    // identical is the measurement, which is hip-mid displacement.
    expect(result.pairs.map((pair) => [pair.side, pair.displacementPx])).toEqual(
      baseline.pairs.map((pair) => [pair.side, pair.displacementPx]),
    )
  })
})
