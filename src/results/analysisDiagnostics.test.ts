import { describe, expect, it } from 'vitest'
import { computeAnalysisDiagnostics } from './analysisDiagnostics'
import type { PoseSample } from '../pose/robustness/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { FormHeuristicsResult, MetricResult } from '../heuristics/types'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'

function makeMetric(overrides: Partial<MetricResult> = {}): MetricResult {
  return {
    metric: 'trunkLean',
    value: 5,
    unit: 'degrees',
    confidence: 0.9,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 10,
    caveat: null,
    ...overrides,
  }
}

function makeHeuristics(overrides: Partial<FormHeuristicsResult> = {}): FormHeuristicsResult {
  return {
    view: {
      view: 'side',
      confidence: 0.9,
      diagnostics: {
        bilateralSpreadRatio: 0.2,
        sagittalExcursionRatio: 0.9,
        frameCoverage: 1,
      },
    },
    verticalOscillation: {
      metric: 'verticalOscillation',
      value: 0.1,
      unit: 'ratio',
      confidence: 0.9,
      viewFit: 'primary',
      interpolatedFraction: 0,
      frameCoverage: 1,
      sampleSize: 10,
      caveat: null,
      series: [],
    },
    trunkLean: makeMetric({ metric: 'trunkLean' }),
    overstriding: makeMetric({ metric: 'overstriding', unit: 'ratio' }),
    cadence: makeMetric({ metric: 'cadence', unit: 'stepsPerMinute', value: 170 }),
    kneeFlexion: makeMetric({ metric: 'kneeFlexion' }),
    armSwingSymmetry: makeMetric({ metric: 'armSwingSymmetry', unit: 'percent', value: 0.9 }),
    footStrikePattern: makeMetric({ metric: 'footStrikePattern', unit: 'ratio' }),
    ...overrides,
  }
}

function makeRobustFrame(
  overrides: Partial<Record<(typeof COMMON_KEYPOINT_NAMES)[number], 'detected' | 'interpolated' | 'unrecoverable'>> = {},
): RobustPoseFrame {
  return {
    timestamp: 0,
    source: 'detected',
    keypoints: COMMON_KEYPOINT_NAMES.map((name) => {
      const status = overrides[name] ?? 'detected'
      return {
        name,
        status,
        x: status === 'unrecoverable' ? null : 1,
        y: status === 'unrecoverable' ? null : 1,
        score: status === 'unrecoverable' ? 0 : 0.9,
      }
    }),
  }
}

describe('computeAnalysisDiagnostics', () => {
  it('aggregates keypoint resolution counts across all frames', () => {
    const frames = [
      makeRobustFrame(),
      makeRobustFrame({ left_ankle: 'interpolated' }),
      makeRobustFrame({ left_ankle: 'unrecoverable', right_ankle: 'unrecoverable' }),
    ]
    const diagnostics = computeAnalysisDiagnostics([], frames, makeHeuristics())

    expect(diagnostics.keypoints.left_ankle).toEqual({
      detected: 1,
      interpolated: 1,
      unrecoverable: 1,
    })
    expect(diagnostics.keypoints.right_ankle).toEqual({
      detected: 2,
      interpolated: 0,
      unrecoverable: 1,
    })
    // A keypoint untouched by any override is 'detected' in every frame.
    expect(diagnostics.keypoints.left_shoulder).toEqual({
      detected: 3,
      interpolated: 0,
      unrecoverable: 0,
    })
  })

  it('surfaces view diagnostics verbatim, not recomputed', () => {
    const heuristics = makeHeuristics()
    const diagnostics = computeAnalysisDiagnostics([], [], heuristics)
    expect(diagnostics.view).toBe(heuristics.view)
  })

  it('counts detected vs missing samples', () => {
    const samples: PoseSample[] = [
      { timestamp: 0, frame: { keypoints: [], timestamp: 0 } },
      { timestamp: 1, frame: null },
      { timestamp: 2, frame: { keypoints: [], timestamp: 2 } },
    ]
    const diagnostics = computeAnalysisDiagnostics(samples, [], makeHeuristics())
    expect(diagnostics.sampling).toEqual({
      totalSamples: 3,
      detectedFrames: 2,
      missingFrames: 1,
    })
  })

  it('collects every metric\'s confidence-relevant fields, keyed by metric id', () => {
    const heuristics = makeHeuristics({
      trunkLean: makeMetric({
        metric: 'trunkLean',
        value: null,
        confidence: 0,
        viewFit: 'unsuitable',
        caveat: 'No resolvable body-scale reference.',
      }),
    })
    const diagnostics = computeAnalysisDiagnostics([], [], heuristics)

    expect(diagnostics.metrics.trunkLean).toEqual({
      value: null,
      confidence: 0,
      viewFit: 'unsuitable',
      frameCoverage: 1,
      interpolatedFraction: 0,
      sampleSize: 10,
      caveat: 'No resolvable body-scale reference.',
    })
    expect(diagnostics.metrics.cadence.value).toBe(170)
    expect(Object.keys(diagnostics.metrics).sort()).toEqual(
      [
        'armSwingSymmetry',
        'cadence',
        'footStrikePattern',
        'kneeFlexion',
        'overstriding',
        'trunkLean',
        'verticalOscillation',
      ].sort(),
    )
    // 'view' is not a metric -- must not leak into the metrics map.
    expect('view' in diagnostics.metrics).toBe(false)
  })

  it('handles empty samples and frames without throwing', () => {
    expect(() =>
      computeAnalysisDiagnostics([], [], makeHeuristics()),
    ).not.toThrow()
    const diagnostics = computeAnalysisDiagnostics([], [], makeHeuristics())
    expect(diagnostics.sampling).toEqual({
      totalSamples: 0,
      detectedFrames: 0,
      missingFrames: 0,
    })
    expect(diagnostics.keypoints.left_hip).toEqual({
      detected: 0,
      interpolated: 0,
      unrecoverable: 0,
    })
  })
})
