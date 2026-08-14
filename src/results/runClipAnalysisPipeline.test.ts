import { describe, expect, it, vi, beforeEach } from 'vitest'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type { RobustKeypoint, RobustPoseFrame } from '../pose/robustness/types'
import type { FormHeuristicsResult } from '../heuristics/types'
import { DEFAULT_SAMPLING_ROBUSTNESS_CONFIG } from './samplingRobustnessConfig'

const { applyRobustnessMock, computeFormHeuristicsMock } = vi.hoisted(() => ({
  applyRobustnessMock: vi.fn(),
  computeFormHeuristicsMock: vi.fn(),
}))

vi.mock('../pose/robustness/interpolate', () => ({
  applyRobustness: applyRobustnessMock,
}))

vi.mock('../heuristics/index', () => ({
  computeFormHeuristics: computeFormHeuristicsMock,
}))

import { runClipAnalysisPipeline } from './runClipAnalysisPipeline'

function makeFakeKeypoints(): RobustKeypoint[] {
  return COMMON_KEYPOINT_NAMES.map((name) => ({
    name,
    status: 'detected',
    x: 1,
    y: 1,
    score: 0.9,
  }))
}

// At least presenceMinConsecutiveFrames (3, default) frames, all present, so
// trimToPresenceWindow (real, not mocked) is a no-op on this fixture.
const FAKE_ROBUST_FRAMES: RobustPoseFrame[] = [
  { timestamp: 0, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
  { timestamp: 0.1, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
  { timestamp: 0.2, keypoints: makeFakeKeypoints(), source: 'detected', pixelsPerMeter: null },
]

const FAKE_HEURISTICS: FormHeuristicsResult = {
  view: {
    view: 'side',
    confidence: 1,
    diagnostics: { bilateralSpreadRatio: null, sagittalExcursionRatio: null, frameCoverage: 1 },
  },
  verticalOscillation: {
    metric: 'verticalOscillation',
    value: 0.1,
    unit: 'ratio',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
    series: [],
    fit: null,
  },
  verticalRatio: {
    metric: 'verticalRatio',
    value: 0.08,
    unit: 'percent',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  verticalOscillationCm: {
    metric: 'verticalOscillationCm',
    value: null,
    unit: 'centimeters',
    confidence: 0,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat: 'No real-world scale could be measured for this clip.',
    calibration: null,
  },
  trunkLean: {
    metric: 'trunkLean',
    value: 5,
    unit: 'degrees',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  overstriding: {
    metric: 'overstriding',
    value: 0.1,
    unit: 'ratio',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  cadence: {
    metric: 'cadence',
    value: 170,
    unit: 'stepsPerMinute',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  kneeFlexion: {
    metric: 'kneeFlexion',
    value: 110,
    unit: 'degrees',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  armSwingSymmetry: {
    metric: 'armSwingSymmetry',
    value: 0.9,
    unit: 'percent',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
  },
  footStrikePattern: {
    metric: 'footStrikePattern',
    value: 0.01,
    unit: 'ratio',
    confidence: 1,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: 'Approximated from ankle position relative to the knee at footstrike.',
  },
}

beforeEach(() => {
  applyRobustnessMock.mockReset()
  computeFormHeuristicsMock.mockReset()
  applyRobustnessMock.mockReturnValue(FAKE_ROBUST_FRAMES)
  computeFormHeuristicsMock.mockReturnValue(FAKE_HEURISTICS)
})

describe('runClipAnalysisPipeline', () => {
  it('sorts samples by timestamp before calling applyRobustness', () => {
    const outOfOrder = [
      { timestamp: 0.3, frame: null },
      { timestamp: 0.1, frame: null },
      { timestamp: 0.2, frame: null },
    ]

    runClipAnalysisPipeline(outOfOrder, DEFAULT_SAMPLING_ROBUSTNESS_CONFIG)

    expect(applyRobustnessMock).toHaveBeenCalledWith(
      [
        { timestamp: 0.1, frame: null },
        { timestamp: 0.2, frame: null },
        { timestamp: 0.3, frame: null },
      ],
      DEFAULT_SAMPLING_ROBUSTNESS_CONFIG.robustness,
    )
  })

  it('calls computeFormHeuristics with the (real, unmocked) presence-trimmed robustness output', () => {
    runClipAnalysisPipeline([{ timestamp: 0, frame: null }], DEFAULT_SAMPLING_ROBUSTNESS_CONFIG)

    // FAKE_ROBUST_FRAMES is a no-op under the real trimToPresenceWindow (every frame present,
    // at least presenceMinConsecutiveFrames long), so heuristics receives it unchanged.
    expect(computeFormHeuristicsMock).toHaveBeenCalledWith(FAKE_ROBUST_FRAMES)
  })

  it('returns the untrimmed robustFrames, the computed heuristics, and diagnostics derived from them', () => {
    const samples = [{ timestamp: 0, frame: null }]
    const result = runClipAnalysisPipeline(samples, DEFAULT_SAMPLING_ROBUSTNESS_CONFIG)

    expect(result.robustFrames).toBe(FAKE_ROBUST_FRAMES)
    expect(result.heuristics).toBe(FAKE_HEURISTICS)
    expect(result.diagnostics.sampling.totalSamples).toBe(1)
    expect(result.diagnostics.metrics.trunkLean.value).toBe(5)
    // MoveNet-shaped fixture: no scale calibration measured, so the key is absent entirely.
    expect('scaleCalibration' in result.diagnostics).toBe(false)
  })

  it('trims to the presence window before computing heuristics, when robustness output has dead time', () => {
    const emptyKeypoints: RobustKeypoint[] = COMMON_KEYPOINT_NAMES.map((name) => ({
      name,
      status: 'unrecoverable',
      x: null,
      y: null,
      score: 0,
    }))
    const deadFrame: RobustPoseFrame = {
      timestamp: -0.1,
      keypoints: emptyKeypoints,
      source: 'missing',
      pixelsPerMeter: null,
    }
    applyRobustnessMock.mockReturnValue([deadFrame, ...FAKE_ROBUST_FRAMES])

    runClipAnalysisPipeline([{ timestamp: 0, frame: null }], DEFAULT_SAMPLING_ROBUSTNESS_CONFIG)

    // The dead (subject-absent) frame is excluded from what heuristics sees, even though it's
    // included in applyRobustness's own output.
    expect(computeFormHeuristicsMock).toHaveBeenCalledWith(FAKE_ROBUST_FRAMES)
  })
})
