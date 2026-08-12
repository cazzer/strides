import { describe, expect, it } from 'vitest'
import { detectView } from './viewDetection'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'
import { DEFAULT_HEURISTICS_CONFIG } from './types'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  verticalBouncePx: 20,
  trunkLeanDeg: 5,
}

describe('detectView', () => {
  it('classifies a clean side-view clip as side, with both signals in-band', () => {
    // TORSO_LENGTH_PX = 150 (fixed in the fixture generator).
    // BSR = (6 + 6) / (2 * 150) = 0.04 -- well under sideViewMaxBilateralSpreadRatio (0.30).
    // SER ~= 2 * strideAmplitudePx / 150 = 160/150 ~= 1.07 -- well over
    // sideViewMinSagittalExcursionRatio (0.8). Both signals vote side -> view: 'side'.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, strideAmplitudePx: 80, view: 'side' })

    const result = detectView(frames)

    expect(result.view).toBe('side')
    expect(result.diagnostics.bilateralSpreadRatio).toBeCloseTo(0.04, 1)
    expect(result.diagnostics.sagittalExcursionRatio).toBeGreaterThan(0.8)
    expect(result.diagnostics.frameCoverage).toBe(1)
    // Both signals land deep in-band (large margin from their thresholds), so confidence should
    // be well above the flat 0.3 "ambiguous" baseline.
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('classifies a clean front-view clip as front, with both signals in-band', () => {
    // BSR = (130 + 130) / (2 * 150) = 0.867 -- well over frontViewMinBilateralSpreadRatio (0.55).
    // SER ~= 2 * (80 * 0.15) / 150 = 24/150 = 0.16 -- well under
    // frontViewMaxSagittalExcursionRatio (0.4). Both signals vote front -> view: 'front'.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, strideAmplitudePx: 80, view: 'front' })

    const result = detectView(frames)

    expect(result.view).toBe('front')
    expect(result.diagnostics.bilateralSpreadRatio).toBeCloseTo(0.867, 1)
    expect(result.diagnostics.sagittalExcursionRatio).toBeLessThan(0.4)
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('returns ambiguous with confidence 0 when frame coverage is below the minimum', () => {
    // Only 2 of 10 frames have a resolvable body scale (0.2 coverage), under
    // minViewDetectionFrameCoverage (0.4).
    const resolvable = buildFrame({
      left_shoulder: { x: -5, y: 0 },
      right_shoulder: { x: 5, y: 0 },
      left_hip: { x: -5, y: 100 },
      right_hip: { x: 5, y: 100 },
    })
    const unresolvable = buildFrame({})
    const frames = [
      resolvable,
      unresolvable,
      unresolvable,
      unresolvable,
      unresolvable,
      resolvable,
      unresolvable,
      unresolvable,
      unresolvable,
      unresolvable,
    ]

    const result = detectView(frames)

    expect(result.view).toBe('ambiguous')
    expect(result.confidence).toBe(0)
    expect(result.diagnostics.bilateralSpreadRatio).toBeNull()
    expect(result.diagnostics.sagittalExcursionRatio).toBeNull()
    expect(result.diagnostics.frameCoverage).toBeCloseTo(0.2)
  })

  it('returns ambiguous when BSR and SER disagree', () => {
    // Side-view bilateral geometry (small offset -> BSR votes side) but a stride amplitude far
    // too small to read as side-view sagittal excursion: SER ~= 2*20/150 = 0.267, under
    // frontViewMaxSagittalExcursionRatio (0.4) -> SER votes front. One vote each -> ambiguous.
    const frames = generateSyntheticGait({
      ...BASE_PARAMS,
      strideAmplitudePx: 20,
      view: 'side',
    })

    const result = detectView(frames)

    expect(result.view).toBe('ambiguous')
    expect(result.diagnostics.bilateralSpreadRatio).toBeLessThanOrEqual(
      DEFAULT_HEURISTICS_CONFIG.sideViewMaxBilateralSpreadRatio,
    )
    expect(result.diagnostics.sagittalExcursionRatio).toBeLessThanOrEqual(
      DEFAULT_HEURISTICS_CONFIG.frontViewMaxSagittalExcursionRatio,
    )
    // Flat, coverage-scaled fallback confidence for the disagreement case.
    expect(result.confidence).toBeCloseTo(0.3, 1)
  })

  it('returns ambiguous when there are no frames at all', () => {
    const result = detectView([])
    expect(result.view).toBe('ambiguous')
    expect(result.confidence).toBe(0)
  })

  it('is a no-op with respect to head keypoints — identical output whether nose/ears are wildly placed or fully unrecoverable', () => {
    // detectView reads shoulders/hips (bilateral spread) and ankles/hips (sagittal excursion) by
    // name only — see viewDetection.ts's module doc. Widening COMMON_KEYPOINT_NAMES to include
    // nose/left_ear/right_ear must not change this function's output at all, regardless of what
    // those three keypoints' positions or resolvability are.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, strideAmplitudePx: 80, view: 'side' })
    const baseline = detectView(frames)

    const wildlyPlacedHead = frames.map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === 'nose' || kp.name === 'left_ear' || kp.name === 'right_ear'
          ? { ...kp, x: 999999, y: -999999 }
          : kp,
      ),
    }))
    const unrecoverableHead = frames.map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === 'nose' || kp.name === 'left_ear' || kp.name === 'right_ear'
          ? { ...kp, x: null, y: null, score: 0, status: 'unrecoverable' as const }
          : kp,
      ),
    }))

    expect(detectView(wildlyPlacedHead)).toEqual(baseline)
    expect(detectView(unrecoverableHead)).toEqual(baseline)
  })
})
