import { describe, expect, it } from 'vitest'
import { computeTrunkLean } from './trunkLean'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  verticalBouncePx: 20,
}

describe('computeTrunkLean', () => {
  it('a clean side-view clip: value equals the configured lean angle exactly, confidence 1', () => {
    // The fixture's torso is a rigid segment rotated by exactly trunkLeanDeg around the hip
    // (torsoOffset()), and travel direction is unambiguously forward (+1) since hip-x advances
    // steadily -- so atan2(dx, -dy) recovers trunkLeanDeg exactly on every single frame, and the
    // median of a constant series is that same constant.
    const frames = generateSyntheticGait({
      ...BASE_PARAMS,
      trunkLeanDeg: 8,
      view: 'side',
    })

    const result = computeTrunkLean(frames, 'side')

    expect(result.value).toBeCloseTo(8, 5)
    expect(result.viewFit).toBe('primary')
    expect(result.unit).toBe('degrees')
    // viewFitMultiplier 1, frameCoverage 1, interpolatedFraction 0, sampleSize well over the
    // minimum (capped at 1), travelDirectionKnown true -> every factor is exactly 1.
    expect(result.confidence).toBeCloseTo(1, 5)
    expect(result.caveat).toBeNull()
  })

  it('a front-view clip: value is 0 (shoulders/hips stay x-aligned), viewFit unsuitable, low confidence', () => {
    const frames = generateSyntheticGait({
      ...BASE_PARAMS,
      trunkLeanDeg: 8,
      view: 'front',
    })

    const result = computeTrunkLean(frames, 'front')

    expect(result.value).toBeCloseTo(0, 5)
    expect(result.viewFit).toBe('unsuitable')
    // viewFitMultiplier 0.1, every other factor 1 -> confidence exactly 0.1.
    expect(result.confidence).toBeCloseTo(0.1, 5)
    expect(result.caveat).toContain('front view')
  })

  it('indeterminate travel direction: value still reported (unsigned), caveat present, confidence penalized', () => {
    const leanDeg = 6
    const leanRad = (leanDeg * Math.PI) / 180
    const torsoLength = 150
    const dx = torsoLength * Math.sin(leanRad)
    const dy = -torsoLength * Math.cos(leanRad)

    // 12 identical frames -> zero net hip-x displacement -> travelDirection === 0.
    const frame = buildFrame({
      left_hip: { x: 200, y: 400 },
      right_hip: { x: 200, y: 400 },
      left_shoulder: { x: 200 + dx, y: 400 + dy },
      right_shoulder: { x: 200 + dx, y: 400 + dy },
    })
    const frames = Array.from({ length: 12 }, () => frame)

    const result = computeTrunkLean(frames, 'side')

    // travelDirection unknown -> forwardLeanDeg falls back to the raw (unsigned-by-direction)
    // screen-relative angle, which is exactly leanDeg here by construction.
    expect(result.value).toBeCloseTo(leanDeg, 5)
    expect(result.caveat).toContain('Direction of travel')
    // viewFitMultiplier 1, frameCoverage 1, interpolatedFraction 0, sampleSize factor 1,
    // travelDirectionKnown false -> the only active penalty is the 0.5 travel-direction factor.
    expect(result.confidence).toBeCloseTo(0.5, 5)
  })

  it('few resolvable frames: caveat names the shortfall, mirroring overstriding/verticalOscillation', () => {
    const leanDeg = 6
    const leanRad = (leanDeg * Math.PI) / 180
    const torsoLength = 150
    const dx = torsoLength * Math.sin(leanRad)
    const dy = -torsoLength * Math.cos(leanRad)

    // 5 frames (< MIN_TRUNK_LEAN_SAMPLE_SIZE), each shifted in x so net hip displacement clears
    // the travel-direction threshold -- isolates the sample-size caveat from the
    // travel-direction-unknown one, which is covered by a separate test above.
    const frames = Array.from({ length: 5 }, (_, i) => {
      const hipX = 200 + i * 20
      return buildFrame({
        left_hip: { x: hipX, y: 400 },
        right_hip: { x: hipX, y: 400 },
        left_shoulder: { x: hipX + dx, y: 400 + dy },
        right_shoulder: { x: hipX + dx, y: 400 + dy },
      })
    })

    const result = computeTrunkLean(frames, 'side')

    expect(result.sampleSize).toBe(5)
    expect(result.caveat).toContain('Only 5 resolvable frame(s)')
    expect(result.confidence).toBeLessThan(1)
  })

  it('returns a null value and 0 confidence when no torso position is resolvable', () => {
    const frame = buildFrame({})
    const result = computeTrunkLean([frame, frame], 'side')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).not.toBeNull()
    expect(result.exemplars).toBeUndefined()
  })
})

/**
 * A rigid torso rotated about the hip, so `computeTrunkLean` reads back exactly `deg`.
 * `status: 'interpolated'` keeps the same coordinates — and the same measured lean — while making
 * the frame one the detector never actually saw the torso in.
 */
function leanFrame(
  deg: number,
  timestamp: number,
  status: 'detected' | 'interpolated' = 'detected',
) {
  const rad = (deg * Math.PI) / 180
  const dx = 150 * Math.sin(rad)
  const dy = -150 * Math.cos(rad)
  return buildFrame(
    {
      left_hip: { x: 197, y: 400, status },
      right_hip: { x: 203, y: 400, status },
      left_shoulder: { x: 197 + dx, y: 400 + dy, status },
      right_shoulder: { x: 203 + dx, y: 400 + dy, status },
    },
    timestamp,
  )
}

describe('computeTrunkLean exemplars', () => {
  // Deviations from the median (5) are 1, 0.5, 0, 0, 0.5, 1, 15 -> MAD 0.5, outlier bound 1.5.
  const LEANS = [4, 4.5, 5, 5, 5.5, 6, 20]

  it('ghosts the most forward lean against the most upright one', () => {
    const frames = LEANS.map((deg, i) => leanFrame(deg, i / 30))

    const result = computeTrunkLean(frames, 'side')
    const [evidence] = result.exemplars!

    expect(result.exemplars).toHaveLength(1)
    expect(evidence.kind).toBe('trunkLeanRange')
    expect(evidence.timestamp).toBeCloseTo(5 / 30, 10) // the 6 deg frame
    expect(evidence.pairedTimestamp).toBeCloseTo(0, 10) // the 4 deg frame
    // Both surviving ends sit one MAD from the median, i.e. 1/1.5 of the outlier bound.
    expect(evidence.quality).toBeCloseTo(1 / 1.5, 6)
    expect(evidence.cropKeypoints).toEqual([
      'left_shoulder',
      'right_shoulder',
      'left_hip',
      'right_hip',
    ])
  })

  it('rejects the outlier outright rather than showing it as the extreme', () => {
    const frames = LEANS.map((deg, i) => leanFrame(deg, i / 30))

    const [evidence] = computeTrunkLean(frames, 'side').exemplars!

    // The 20 deg frame is the raw argmax and is 30 MADs out — a tracking glitch, not a lean.
    expect(evidence.timestamp).not.toBeCloseTo(6 / 30, 10)
    expect(evidence.pairedTimestamp).not.toBeCloseTo(6 / 30, 10)
  })

  it('falls back to the next-most-forward frame when the most forward one is interpolated', () => {
    // Median 5, MAD 0.5. 6.4deg is the most forward surviving lean and would win a rank-by-value
    // selection outright — but all four of its torso seeds are interpolated, so it scores
    // 0 x 0.933 = 0, and `pairQuality`'s minimum would take the whole exemplar to zero with it.
    // The measured Demo 1 failure this reproduces: coverage hinging on one frame's tracking.
    const leans = [4, 4.5, 5, 5, 5.5, 6, 6.4]
    const frames = leans.map((deg, i) =>
      leanFrame(deg, i / 30, deg === 6.4 ? 'interpolated' : 'detected'),
    )

    const result = computeTrunkLean(frames, 'side')
    const [evidence] = result.exemplars!

    expect(result.exemplars).toHaveLength(1)
    expect(evidence.timestamp).toBeCloseTo(5 / 30, 10) // the 6 deg frame, detected
    expect(evidence.pairedTimestamp).toBeCloseTo(0, 10) // the 4 deg frame
    expect(evidence.quality).toBeCloseTo(1 / 1.5, 6)
  })

  it('emits nothing when the lean never varies — there is no range to picture', () => {
    const frames = Array.from({ length: 12 }, (_, i) => leanFrame(6, i / 30))

    const result = computeTrunkLean(frames, 'side')

    expect(result.value).toBeCloseTo(6, 5)
    expect(result.exemplars).toBeUndefined()
  })
})
