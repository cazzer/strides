import { describe, expect, it } from 'vitest'
import type { MetricId, View } from '../heuristics/types'
import type { KeypointName } from '../pose/types'
import type { ExtractedEvidenceFrame } from '../video/extractFrames'
import type { EvidenceFramePlan, EvidenceInstantPlan, EvidenceKeypointPosition } from './evidenceFrames'
import type { MetricCardEvidence } from './MetricsPanel'
import { runnerFootageFor, type RunnerFootageInput } from './runnerFootagePlate'

const CROP = { x: 100, y: 200, side: 400 }

function at(name: KeypointName, x: number, y: number): EvidenceKeypointPosition {
  return { name, status: 'detected', x, y }
}

const KNEE_POINTS: EvidenceKeypointPosition[] = [
  at('left_hip', 300, 300),
  at('left_knee', 320, 400),
  at('left_ankle', 280, 500),
]

function item(
  metric: MetricId,
  {
    keypoints = KNEE_POINTS,
    side = 'left',
    travelDirection = 1,
  }: {
    keypoints?: EvidenceKeypointPosition[]
    side?: EvidenceInstantPlan['side']
    travelDirection?: EvidenceFramePlan['travelDirection']
  } = {},
): ExtractedEvidenceFrame {
  const base: EvidenceInstantPlan = { timestamp: 1, opacity: 1, keypoints, outwardSign: null, side }
  const plan = {
    metric,
    kind: 'kneeFlexionPeak',
    quality: 1,
    label: '',
    base,
    ghost: null,
    crop: CROP,
    travelDirection,
    demotion: null,
    cropGrowth: null,
    focusOffset: null,
  } as EvidenceFramePlan
  return { plan, canvas: document.createElement('canvas') }
}

const SOURCES = { kneeFlexion: 0, kneeDrive: 0, overstriding: 1, footStrikePattern: 1 } as Record<MetricId, number>

function section(metric: MetricId, entry: ExtractedEvidenceFrame, clipIndex = SOURCES[metric]): MetricCardEvidence {
  return { metric, clipIndex, items: [entry] }
}

function input(overrides: Partial<RunnerFootageInput> = {}): RunnerFootageInput {
  return {
    focus: { metricIds: ['kneeFlexion'] },
    camera: 'legsSide',
    evidence: [section('kneeFlexion', item('kneeFlexion'))],
    sourceIndices: SOURCES,
    clipViewKinds: ['side', 'side'],
    ...overrides,
  }
}

describe('runnerFootageFor', () => {
  it('turns a side clip’s knee-flexion frame into unit-square points on its measured leg', () => {
    const entry = item('kneeFlexion')
    const footage = runnerFootageFor(input({ evidence: [section('kneeFlexion', entry)] }))
    expect(footage).toEqual({
      metric: 'kneeFlexion',
      image: entry.canvas,
      note: "Faint behind the model: your clip's knee flexion evidence frame, scaled to fit. Footage, not a target.",
      points: [
        { name: 'left_hip', u: 0.5, v: 0.25 },
        { name: 'left_knee', u: 0.55, v: 0.5 },
        { name: 'left_ankle', u: 0.45, v: 0.75 },
      ],
      measuredSide: 'left',
      mirror: false,
    })
  })

  it('mirrors a right-to-left clip and refuses an indeterminate direction', () => {
    const mirrored = item('kneeFlexion', { travelDirection: -1 })
    expect(runnerFootageFor(input({ evidence: [section('kneeFlexion', mirrored)] }))?.mirror).toBe(true)
    const unknown = item('kneeFlexion', { travelDirection: 0 })
    expect(runnerFootageFor(input({ evidence: [section('kneeFlexion', unknown)] }))).toBeNull()
  })

  it('needs the winning clip to be a side view: front, ambiguous and unknown views get none', () => {
    for (const view of ['front', 'ambiguous', null] as (View | null)[]) {
      expect(runnerFootageFor(input({ clipViewKinds: [view, 'side'] }))).toBeNull()
    }
  })

  it('needs a side camera: a front or whole-body camera gets none', () => {
    for (const camera of ['feetFront', 'upperFrontQuarter', 'wholeBodySide', 'torsoSide'] as const) {
      expect(runnerFootageFor(input({ camera }))).toBeNull()
    }
    expect(runnerFootageFor(input({ camera: 'landingSide' }))).not.toBeNull()
  })

  it('gets none without a focus, without source indices, while pending, or with no item', () => {
    expect(runnerFootageFor(input({ focus: undefined }))).toBeNull()
    expect(runnerFootageFor(input({ sourceIndices: null }))).toBeNull()
    const pending: MetricCardEvidence = { metric: 'kneeFlexion', clipIndex: 0, items: [], pending: true }
    expect(runnerFootageFor(input({ evidence: [pending] }))).toBeNull()
    expect(runnerFootageFor(input({ evidence: [{ metric: 'kneeFlexion', clipIndex: 0, items: [] }] }))).toBeNull()
    expect(runnerFootageFor(input({ evidence: [] }))).toBeNull()
  })

  it('reads only the winning clip’s evidence', () => {
    expect(runnerFootageFor(input({ evidence: [section('kneeFlexion', item('kneeFlexion'), 1)] }))).toBeNull()
  })

  it('resolves the measured leg from the joints when the plan names none, and refuses mixed sides', () => {
    const unsided = item('kneeFlexion', { side: null })
    expect(runnerFootageFor(input({ evidence: [section('kneeFlexion', unsided)] }))?.measuredSide).toBe('left')
    const mixed = item('kneeFlexion', {
      side: null,
      keypoints: [at('left_hip', 300, 300), at('left_knee', 320, 400), at('right_ankle', 280, 500)],
    })
    expect(runnerFootageFor(input({ evidence: [section('kneeFlexion', mixed)] }))).toBeNull()
  })

  it('needs a hip, so foot strike (ankle, knee, heel, toe) never gets a plate', () => {
    const strike = item('footStrikePattern', {
      keypoints: [at('left_ankle', 280, 500), at('left_knee', 320, 400), at('left_heel', 270, 510)],
    })
    const footage = runnerFootageFor(
      input({
        focus: { metricIds: ['footStrikePattern'] },
        camera: 'landingSide',
        evidence: [section('footStrikePattern', strike)],
      }),
    )
    expect(footage).toBeNull()
  })

  it('drops unrecoverable joints', () => {
    const partial = item('kneeFlexion', {
      keypoints: [...KNEE_POINTS.slice(0, 2), { name: 'left_ankle', status: 'unrecoverable' }],
    })
    const footage = runnerFootageFor(input({ evidence: [section('kneeFlexion', partial)] }))
    expect(footage?.points.map((p) => p.name)).toEqual(['left_hip', 'left_knee'])
  })

  it('takes the first focus metric with evidence as the headline, and never falls past it', () => {
    const overstride = item('overstriding', {
      keypoints: [at('left_hip', 300, 300), at('right_hip', 302, 300), at('left_ankle', 380, 500)],
    })
    const both = input({
      focus: { metricIds: ['overstriding', 'footStrikePattern'] },
      camera: 'landingSide',
      evidence: [section('footStrikePattern', item('footStrikePattern')), section('overstriding', overstride)],
    })
    expect(runnerFootageFor(both)?.metric).toBe('overstriding')
    // A headline with a frame that is not a plate metric ends the search: the later knee frame
    // would be footage of a metric the figure is not labelling.
    const nonPlateFirst = input({
      focus: { metricIds: ['trunkLean', 'kneeFlexion'] },
      evidence: [section('trunkLean', item('trunkLean'), 0), section('kneeFlexion', item('kneeFlexion'))],
      sourceIndices: { ...SOURCES, trunkLean: 0 },
    })
    expect(runnerFootageFor(nonPlateFirst)).toBeNull()
  })
})
