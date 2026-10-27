import { describe, expect, it } from 'vitest'
import type { MetricId } from '../../heuristics/types'
import { FOCUS_AREA_ORDER } from '../../guidance/focusAreas'
import { makeHeuristics, makeMetric, makeVerticalOscillationCm } from '../__fixtures__/metricResult'
import { FOCUS_AREA_CAMERA, NO_FOCUS_CAMERA } from '../focusAreaCamera'
import type { SessionCoverage } from '../sessionCoverage'
import {
  BOTH_VIEWS_HINT,
  STEADY_RUNNING_HINT,
  introCamera,
  stopCamera,
  tourCaptureHint,
  tourPlan,
  tourStopDomId,
} from './tourPlan'

const NO_NEEDS: SessionCoverage = { present: { side: true, front: true }, needs: [] }

const FRONT_UNSUITABLE = {
  stepWidth: makeMetric('stepWidth', { viewFit: 'unsuitable' }),
  stepWidthCm: makeMetric('stepWidthCm', { viewFit: 'unsuitable' }),
  armSwingAmplitude: makeMetric('armSwingAmplitude', { viewFit: 'unsuitable' }),
  swingFootLateralExcursion: makeMetric('swingFootLateralExcursion', { viewFit: 'unsuitable' }),
}

describe('tourPlan', () => {
  it('has one stop per area in focus-area order when everything is measured', () => {
    const plan = tourPlan(makeHeuristics(), 'done', NO_NEEDS)
    expect(plan.areaStops.map((stop) => stop.view.area)).toEqual(FOCUS_AREA_ORDER)
    // Six areas and the one-thing stop: seven at most.
    expect(plan.areaStops.length + 1).toBeLessThanOrEqual(7)
    expect(plan.unmeasured).toEqual([])
    expect(plan.captureHint).toBeNull()
  })

  it('skips an area with nothing measured and lists it, in order', () => {
    const plan = tourPlan(makeHeuristics(FRONT_UNSUITABLE), 'done', null)
    expect(plan.areaStops.map((stop) => stop.view.area)).toEqual(['rhythm', 'posture', 'knees', 'landing'])
    expect(plan.unmeasured).toEqual(['arms', 'footPath'])
  })

  it('carries each stop’s feedback, keyed to its area', () => {
    const plan = tourPlan(makeHeuristics(), 'done', null)
    for (const stop of plan.areaStops) expect(stop.feedback.area).toBe(stop.view.area)
  })

  it('guards the rhythm stop’s bounce derivation to vertical ratio’s clip', () => {
    const rhythm = (sourceIndices: Record<MetricId, number> | null) =>
      tourPlan(makeHeuristics(), 'done', null, sourceIndices).areaStops.find((stop) => stop.view.area === 'rhythm')!
    expect(rhythm(null).bounce?.bounce?.metric).toBe('verticalOscillationCm')
    const oneClip = Object.fromEntries(Object.keys(makeHeuristics()).map((key) => [key, 0])) as Record<MetricId, number>
    expect(rhythm({ ...oneClip, verticalOscillationCm: 1, verticalOscillation: 1 }).bounce).toEqual({
      bounce: null,
      strideTorsoLengths: null,
      strideCount: 7,
    })
  })

  it('picks one thing from all six areas: a cue, nothing to change, or unclear', () => {
    expect(
      tourPlan(makeHeuristics({ cadence: makeMetric('cadence', { value: 150 }) }), 'done', null).oneThing,
    ).toMatchObject({ kind: 'cue', metric: 'cadence', area: 'rhythm' })
    expect(tourPlan(makeHeuristics({}, { confidence: 0.5 }), 'done', null).oneThing).toEqual({
      kind: 'unclear',
      reason: 'caveated',
    })
    const pending = makeHeuristics({ verticalOscillationCm: makeVerticalOscillationCm({ value: null }) })
    expect(tourPlan(pending, 'running', null).oneThing).toEqual({ kind: 'unclear', reason: 'pending' })
    expect(tourPlan(pending, 'failed', null).oneThing).toEqual({ kind: 'unclear', reason: 'unmeasured' })
  })
})

describe('tourCaptureHint', () => {
  it('is null when every area was measured', () => {
    expect(tourCaptureHint([], NO_NEEDS)).toBeNull()
  })

  it('names the one missing view that cost an unmeasured area', () => {
    expect(
      tourCaptureHint(['arms', 'footPath'], {
        present: { side: true, front: false },
        needs: [{ view: 'front', metrics: ['armSwingAmplitude', 'stepWidth'] }],
      }),
    ).toEqual({ text: 'Add a front-view clip', addsClip: true })
    expect(
      tourCaptureHint(['posture'], {
        present: { side: false, front: true },
        needs: [{ view: 'side', metrics: ['trunkLean'] }],
      }),
    ).toEqual({ text: 'Add a side-view clip', addsClip: true })
  })

  it('names both views when both cost an unmeasured area', () => {
    expect(
      tourCaptureHint(['arms', 'posture'], {
        present: { side: false, front: false },
        needs: [
          { view: 'side', metrics: ['trunkLean'] },
          { view: 'front', metrics: ['armSwingAmplitude'] },
        ],
      }),
    ).toEqual({ text: BOTH_VIEWS_HINT, addsClip: true })
  })

  it('ignores a view need that only touches measured areas', () => {
    expect(
      tourCaptureHint(['arms'], {
        present: { side: true, front: false },
        needs: [{ view: 'side', metrics: ['trunkLean'] }],
      }),
    ).toEqual({ text: STEADY_RUNNING_HINT, addsClip: false })
  })

  it('asks for steadier footage when no angle is to blame, or coverage is unknown', () => {
    const steady = { text: STEADY_RUNNING_HINT, addsClip: false }
    expect(tourCaptureHint(['knees'], NO_NEEDS)).toEqual(steady)
    expect(tourCaptureHint(['knees'], null)).toEqual(steady)
  })
})

describe('stopCamera and tourStopDomId', () => {
  it('maps each area to its preset, and the one-thing stop to the whole figure', () => {
    for (const area of FOCUS_AREA_ORDER) expect(stopCamera(area)).toBe(FOCUS_AREA_CAMERA[area])
    expect(stopCamera('oneThing')).toBe(NO_FOCUS_CAMERA)
    expect(stopCamera('landing')).toEqual({ camera: 'landingSide', playbackRate: 0.4 })
    expect(stopCamera('footPath')).toEqual({ camera: 'feetFront', playbackRate: 0.4 })
  })

  it('ids a stop as tour-<id>', () => {
    expect(tourStopDomId('knees')).toBe('tour-knees')
    expect(tourStopDomId('oneThing')).toBe('tour-oneThing')
  })
})

describe('introCamera', () => {
  it('introduces a front-only session from the front, every other from the side', () => {
    expect(introCamera({ present: { side: false, front: true }, needs: [] })).toBe('feetFront')
    expect(introCamera({ present: { side: true, front: true }, needs: [] })).toBe('wholeBodySide')
    expect(introCamera({ present: { side: true, front: false }, needs: [] })).toBe('wholeBodySide')
    expect(introCamera({ present: { side: false, front: false }, needs: [] })).toBe('wholeBodySide')
    expect(introCamera(null)).toBe('wholeBodySide')
  })
})
