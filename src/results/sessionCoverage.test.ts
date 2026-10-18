import { describe, expect, it } from 'vitest'
import type { FormHeuristicsResult, MetricId, MetricResult, ViewFit } from '../heuristics/types'
import { sessionCoverage } from './sessionCoverage'

const IDS: MetricId[] = [
  'verticalOscillation',
  'verticalRatio',
  'verticalOscillationCm',
  'trunkLean',
  'overstriding',
  'cadence',
  'kneeFlexion',
  'footStrikePattern',
  'stepWidth',
  'stepWidthCm',
  'kneeDrive',
  'armSwingAmplitude',
  'swingFootLateralExcursion',
]

function metric(id: MetricId, viewFit: ViewFit, value: number | null = 1): MetricResult {
  return {
    metric: id,
    value,
    unit: 'ratio',
    confidence: value === null ? 0 : 0.9,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 10,
    caveat: null,
  } as MetricResult
}

/** Every metric measured (`primary`), except the overrides given. */
function heuristics(overrides: Partial<Record<MetricId, MetricResult>> = {}): FormHeuristicsResult {
  const result: Record<string, unknown> = {
    view: { view: 'side', confidence: 0.8 },
  }
  for (const id of IDS) result[id] = overrides[id] ?? metric(id, 'primary')
  return result as unknown as FormHeuristicsResult
}

const SAGITTAL: MetricId[] = [
  'verticalRatio',
  'trunkLean',
  'overstriding',
  'kneeFlexion',
  'footStrikePattern',
  'kneeDrive',
]
const FRONTAL: MetricId[] = ['stepWidth', 'stepWidthCm', 'armSwingAmplitude', 'swingFootLateralExcursion']

function unsuitable(ids: MetricId[]): Partial<Record<MetricId, MetricResult>> {
  return Object.fromEntries(ids.map((id) => [id, metric(id, 'unsuitable')]))
}

describe('sessionCoverage', () => {
  it('a side-only session needs a front clip for the front-primary metrics it lost', () => {
    const coverage = sessionCoverage(['side'], heuristics(unsuitable(FRONTAL)))
    expect(coverage.present).toEqual({ side: true, front: false })
    expect(coverage.needs).toEqual([{ view: 'front', metrics: FRONTAL }])
  })

  it('a front-only session needs a side clip, in panel order', () => {
    const coverage = sessionCoverage(['front', 'front'], heuristics(unsuitable(SAGITTAL)))
    expect(coverage.needs).toEqual([{ view: 'side', metrics: SAGITTAL }])
  })

  it('says nothing when both views are present', () => {
    const coverage = sessionCoverage(['side', 'front'], heuristics(unsuitable(FRONTAL)))
    expect(coverage.needs).toEqual([])
  })

  it('never blames the camera for an exclusion with another cause', () => {
    // Excluded (null value) but its angle was tolerated: too little data, not the wrong view.
    const coverage = sessionCoverage(
      ['side'],
      heuristics({ stepWidthCm: metric('stepWidthCm', 'tolerated', null) }),
    )
    expect(coverage.needs).toEqual([])
  })

  it('an ambiguous-only session can need both views', () => {
    const coverage = sessionCoverage(['ambiguous'], heuristics(unsuitable([...SAGITTAL, ...FRONTAL])))
    expect(coverage.present).toEqual({ side: false, front: false })
    expect(coverage.needs.map((need) => need.view)).toEqual(['side', 'front'])
    expect(coverage.needs[0].metrics).toEqual(SAGITTAL)
    expect(coverage.needs[1].metrics).toEqual(FRONTAL)
  })

  it('does not ask for a view whose primary metrics were all measured anyway', () => {
    expect(sessionCoverage(['side'], heuristics()).needs).toEqual([])
  })
})
