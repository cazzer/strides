import { describe, expect, it } from 'vitest'
import { computeVerticalRatio } from './verticalRatio'
import { detectFootstrikes } from './footstrikes'
import { estimateStrideLength } from './strideLength'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { framesFromHipTrace, seededNormals } from './__fixtures__/hipTraceFrames'
import type { RobustPoseFrame } from '../pose/robustness/types'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  trunkLeanDeg: 5,
}

// Same derivation as strideLength.test.ts: at the fixture defaults (170 spm, 100px/s travel),
// true stride length is 100 * 120/170 = 70.588...px, with up to one frame of travel (100/30 =
// 3.33px) of discretization error either way.
const EXPECTED_STRIDE_PX = (100 * 120) / 170
const ONE_FRAME_TRAVEL_TOLERANCE = 100 / 30
const MIN_STRIDE_PX = EXPECTED_STRIDE_PX - ONE_FRAME_TRAVEL_TOLERANCE
const MAX_STRIDE_PX = EXPECTED_STRIDE_PX + ONE_FRAME_TRAVEL_TOLERANCE

describe('computeVerticalRatio', () => {
  it('a clean side-view clip: value close to verticalBouncePx / strideLengthPx, high confidence', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 6, view: 'side' })

    const result = computeVerticalRatio(frames, 'side')

    expect(result.value).not.toBeNull()
    // fit.peakToPeakAmplitude recovers verticalBouncePx to within ~0.1% (see
    // verticalOscillation.test.ts's identical fit), so the dominant source of uncertainty in the
    // bounds is stride length's one-frame-of-travel quantization, not the bounce fit.
    expect(result.value).toBeGreaterThan(6 / MAX_STRIDE_PX)
    expect(result.value).toBeLessThan(6 / MIN_STRIDE_PX)
    expect(result.unit).toBe('percent')
    expect(result.viewFit).toBe('primary')
    expect(result.confidence).toBeGreaterThan(0.9)
    expect(result.caveat).toBeNull()
  })

  it('indeterminate travel direction reports null with the exact caveat prefix', () => {
    const frames = generateSyntheticGait({
      ...BASE_PARAMS,
      verticalBouncePx: 6,
      view: 'side',
      travelSpeedPxPerSec: 0,
    })

    const result = computeVerticalRatio(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).not.toBeNull()
    expect(result.caveat).toContain(
      'Direction of travel could not be determined (no net horizontal displacement)',
    )
  })

  it('a front-view clip that still travels: non-null value, heavily discounted, view-unsuitable caveat', () => {
    // syntheticGait's hip-x advances by travelSpeedPxPerSec regardless of `view` -- front-view
    // clips are NOT automatically indeterminate the way real approach footage tends to be (see
    // design.md D4's narrower case: a runner crossing the frame at a shallow angle still has a
    // resolvable travel direction even face-on).
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 6, view: 'front' })

    const result = computeVerticalRatio(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toMatch(/not reliable from a front view/i)
  })

  it('degenerate zero bounce reports null ahead of the stride-length check (numerator gate first)', () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 0, view: 'side' })

    const result = computeVerticalRatio(frames, 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    // A bounce-shaped caveat, not a stride-length-shaped one, even though this clip's stride
    // length would otherwise resolve fine (it has the same travel/footstrike geometry as the
    // clean case above).
    expect(result.caveat).toMatch(/no oscillating vertical motion/i)
  })

  it('never produces NaN or Infinity, across every shape of input and every view', () => {
    const noise = seededNormals(7, 60)
    const fixtures: RobustPoseFrame[][] = [
      [],
      generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 6, view: 'side' }),
      generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 0, view: 'side' }),
      generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 6, view: 'front' }),
      framesFromHipTrace(noise.map((n, i) => ({ t: i / 30, y: 400 + 12 * n }))),
      // Fewer samples than the fit's floor, and a pure ramp at that.
      framesFromHipTrace([400, 401, 402, 403, 404].map((y, i) => ({ t: i / 30, y }))),
      generateSyntheticGait({
        ...BASE_PARAMS,
        verticalBouncePx: 6,
        view: 'side',
        travelSpeedPxPerSec: 0,
      }),
    ]

    for (const frames of fixtures) {
      for (const view of ['side', 'front', 'ambiguous'] as const) {
        expect(() => computeVerticalRatio(frames, view)).not.toThrow()
        const result = computeVerticalRatio(frames, view)
        expect(Number.isFinite(result.value ?? 0)).toBe(true)
        expect(Number.isFinite(result.confidence)).toBe(true)
        expect(Number.isFinite(result.sampleSize)).toBe(true)
        if (result.value === null) expect(result.confidence).toBe(0)
      }
    }
  })
})

describe('computeVerticalRatio — numerator exemplar', () => {
  const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 6, view: 'side' })

  it('emits the bounce pair its numerator was fitted from, hip-seeded', () => {
    const exemplars = computeVerticalRatio(frames, 'side').exemplars!

    // Selected by `kind`, not by position: this metric also emits a denominator exemplar (see the
    // block below), and `selectExemplars` ranks by quality, so which of the two comes first is not
    // this test's business.
    const bounce = exemplars.filter((candidate) => candidate.kind === 'bounceCycle')
    expect(bounce).toHaveLength(1)
    const [exemplar] = bounce
    // Hip-pinned, exactly as the numerator's own fit is — never `verticalOscillationSignal`'s pair.
    expect(exemplar.cropKeypoints.slice(0, 2)).toEqual(['left_hip', 'right_hip'])
    expect(frames.map((frame) => frame.timestamp)).toContain(exemplar.timestamp)
    expect(frames.map((frame) => frame.timestamp)).toContain(exemplar.pairedTimestamp)
  })

  it('emits nothing when the metric reports no value', () => {
    const flat = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 0, view: 'side' })
    const result = computeVerticalRatio(flat, 'side')

    expect(result.value).toBeNull()
    expect(result.exemplars).toBeUndefined()
  })
})

describe('computeVerticalRatio — denominator exemplar', () => {
  const frames = generateSyntheticGait({ ...BASE_PARAMS, verticalBouncePx: 6, view: 'side' })

  it('emits the median stride pair as a second, kind-distinguished exemplar', () => {
    const exemplars = computeVerticalRatio(frames, 'side').exemplars!

    // Numerator and denominator both survive: two candidates against a per-metric budget of two,
    // so neither crowds the other out.
    expect(exemplars).toHaveLength(2)
    expect([...exemplars.map((exemplar) => exemplar.kind)].sort()).toEqual([
      'bounceCycle',
      'stridePair',
    ])
  })

  it('its two instants are consecutive same-side footstrikes of one stride', () => {
    const [stride] = computeVerticalRatio(frames, 'side').exemplars!.filter(
      (exemplar) => exemplar.kind === 'stridePair',
    )

    const sameSideStrikes = detectFootstrikes(frames, DEFAULT_HEURISTICS_CONFIG)
      .filter((candidate) => candidate.side === stride.side)
      .map((candidate) => frames[candidate.frameIndex].timestamp)

    const start = sameSideStrikes.indexOf(stride.timestamp)
    expect(start).toBeGreaterThanOrEqual(0)
    // Consecutive, and forward in time — the stride started at `timestamp` and ended at
    // `pairedTimestamp`, never the other way round.
    expect(sameSideStrikes[start + 1]).toBe(stride.pairedTimestamp)
    expect(stride.pairedTimestamp!).toBeGreaterThan(stride.timestamp)
  })

  it('is the pair whose displacement is nearest the reported denominator', () => {
    const [stride] = computeVerticalRatio(frames, 'side').exemplars!.filter(
      (exemplar) => exemplar.kind === 'stridePair',
    )
    const result = estimateStrideLength(frames, DEFAULT_HEURISTICS_CONFIG)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const selected = result.pairs.find(
      (pair) => pair.startFrame.timestamp === stride.timestamp,
    )!
    const nearest = Math.min(
      ...result.pairs.map((pair) => Math.abs(pair.displacementPx - result.strideLengthPx)),
    )
    expect(Math.abs(selected.displacementPx - result.strideLengthPx)).toBe(nearest)
  })

  it('seeds the crop on the hips it measured, and spans the stride with the ankles', () => {
    const [stride] = computeVerticalRatio(frames, 'side').exemplars!.filter(
      (exemplar) => exemplar.kind === 'stridePair',
    )

    // Hips are the seed — the hip-mid horizontal displacement IS the stride length. The ankles are
    // context (design D2): a stride is a horizontal displacement, so the crop has to span it.
    expect(stride.cropKeypoints).toEqual([
      'left_hip',
      'right_hip',
      'left_ankle',
      'right_ankle',
    ])
  })

  it('emits nothing when the stride length could not be measured', () => {
    // A treadmill clip: the hip never advances, so `estimateTravelDirection` is indeterminate and
    // the metric reports no value at all.
    const treadmill = generateSyntheticGait({
      ...BASE_PARAMS,
      verticalBouncePx: 6,
      view: 'side',
      travelSpeedPxPerSec: 0,
    })
    const result = computeVerticalRatio(treadmill, 'side')

    expect(result.value).toBeNull()
    expect(result.exemplars).toBeUndefined()
  })
})
