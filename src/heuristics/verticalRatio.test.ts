import { describe, expect, it } from 'vitest'
import { computeVerticalRatio } from './verticalRatio'
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
