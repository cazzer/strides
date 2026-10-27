import { describe, expect, it } from 'vitest'
import { FOCUS_AREA_ORDER } from '../../guidance/focusAreas'
import { makeHeuristics, makeMetric, makeVerticalOscillationCm } from '../__fixtures__/metricResult'
import { FOCUS_AREA_CAMERA, NO_FOCUS_CAMERA } from '../focusAreaCamera'
import type { SessionCoverage } from '../sessionCoverage'
import {
  BOTH_VIEWS_HINT,
  STEADY_RUNNING_HINT,
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
    ).toBe('Add a front-view clip.')
    expect(
      tourCaptureHint(['posture'], {
        present: { side: false, front: true },
        needs: [{ view: 'side', metrics: ['trunkLean'] }],
      }),
    ).toBe('Add a side-view clip.')
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
    ).toBe(BOTH_VIEWS_HINT)
  })

  it('ignores a view need that only touches measured areas', () => {
    expect(
      tourCaptureHint(['arms'], {
        present: { side: true, front: false },
        needs: [{ view: 'side', metrics: ['trunkLean'] }],
      }),
    ).toBe(STEADY_RUNNING_HINT)
  })

  it('asks for steadier footage when no angle is to blame, or coverage is unknown', () => {
    expect(tourCaptureHint(['knees'], NO_NEEDS)).toBe(STEADY_RUNNING_HINT)
    expect(tourCaptureHint(['knees'], null)).toBe(STEADY_RUNNING_HINT)
  })
})

describe('stopCamera and tourStopDomId', () => {
  it('maps each area to its preset, and the one-thing stop to the whole figure', () => {
    for (const area of FOCUS_AREA_ORDER) expect(stopCamera(area)).toBe(FOCUS_AREA_CAMERA[area])
    expect(stopCamera('oneThing')).toBe(NO_FOCUS_CAMERA)
    expect(stopCamera('landing')).toEqual({ camera: 'footSide', playbackRate: 0.4 })
    expect(stopCamera('footPath')).toEqual({ camera: 'feetFront', playbackRate: 0.4 })
  })

  it('ids a stop as tour-<id>', () => {
    expect(tourStopDomId('knees')).toBe('tour-knees')
    expect(tourStopDomId('oneThing')).toBe('tour-oneThing')
  })
})
