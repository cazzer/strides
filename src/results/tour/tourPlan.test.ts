import { describe, expect, it } from 'vitest'
import type { MetricId } from '../../heuristics/types'
import { FOCUS_AREA_ORDER } from '../../guidance/focusAreas'
import { makeHeuristics, makeMetric, makeVerticalOscillationCm } from '../__fixtures__/metricResult'
import { bindRunnerParams } from '../../runner/runnerParams'
import { FOCUS_AREA_CAMERA, KNEES_DWELL_MS, NO_FOCUS_CAMERA, runnerFocusFor } from '../focusAreaCamera'
import type { SessionCoverage } from '../sessionCoverage'
import {
  BOTH_VIEWS_HINT,
  STEADY_RUNNING_HINT,
  introCamera,
  stopCamera,
  stopFocusMetrics,
  stopView,
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
    expect(rhythm(null).bounce?.figures).not.toBeNull()
    const oneClip = Object.fromEntries(Object.keys(makeHeuristics()).map((key) => [key, 0])) as Record<MetricId, number>
    expect(rhythm({ ...oneClip, verticalOscillation: 1 }).bounce).toEqual({ figures: null, strideCount: 7 })
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

  it('plays the knee-flexion stop slowed, at the slowed stops’ one rate', () => {
    const plan = tourPlan(makeHeuristics(), 'done', NO_NEEDS)
    const kneeStop = plan.areaStops.find((stop) => stop.entries[0].metric.metric === 'kneeFlexion')!
    expect(kneeStop.view.area).toBe('knees')
    const params = bindRunnerParams(makeHeuristics())
    const view = stopView('knees', runnerFocusFor(stopFocusMetrics(kneeStop)), params)
    expect(view).toEqual({ camera: 'legsSide', playbackRate: 0.4, keyPhaseDwellMs: KNEES_DWELL_MS })
    expect(view.playbackRate).toBe(stopCamera('landing').playbackRate)
    for (const area of FOCUS_AREA_ORDER) {
      expect([1, 0.4], area).toContain(stopCamera(area).playbackRate)
    }
  })
})

describe('stopFocusMetrics and stopView', () => {
  const rhythmOf = (overrides: Parameters<typeof makeHeuristics>[0] = {}) =>
    tourPlan(makeHeuristics(overrides), 'done', NO_NEEDS).areaStops.find((stop) => stop.view.area === 'rhythm')!

  it('is the headline, plus vertical ratio where the rhythm stop states it as its secondary value', () => {
    expect(stopFocusMetrics(rhythmOf())).toEqual(['cadence', 'verticalRatio'])
    const noCadence = rhythmOf({ cadence: makeMetric('cadence', { value: null, confidence: 0 }) })
    expect(stopFocusMetrics(noCadence)).toEqual(['verticalOscillationCm', 'verticalRatio'])
  })

  it('is vertical ratio alone where it is the headline, and the headline alone without it', () => {
    const ratioHeadline = rhythmOf({
      cadence: makeMetric('cadence', { value: null, confidence: 0 }),
      verticalOscillationCm: makeVerticalOscillationCm({ value: null, calibration: null }),
    })
    expect(stopFocusMetrics(ratioHeadline)).toEqual(['verticalRatio'])
    const noRatio = rhythmOf({ verticalRatio: makeMetric('verticalRatio', { value: null, confidence: 0 }) })
    expect(stopFocusMetrics(noRatio)).toEqual(['cadence'])
    for (const stop of tourPlan(makeHeuristics(), 'done', NO_NEEDS).areaStops) {
      if (stop.view.area !== 'rhythm') expect(stopFocusMetrics(stop)).toEqual([stop.entries[0].metric.metric])
    }
  })

  it('takes the stride camera where the focus draws vertical ratio’s stride', () => {
    const params = bindRunnerParams(makeHeuristics())
    expect(stopView('rhythm', runnerFocusFor(stopFocusMetrics(rhythmOf())), params)).toEqual({
      camera: 'strideSide',
      playbackRate: 1,
    })
    expect(stopView('rhythm', runnerFocusFor(['cadence']), params)).toEqual(FOCUS_AREA_CAMERA.rhythm)
    // The one-thing stop sees the whole figure, unless its cue is vertical ratio with a stride.
    expect(stopView('oneThing', runnerFocusFor(['verticalRatio']), params)).toEqual({
      camera: 'strideSide',
      playbackRate: NO_FOCUS_CAMERA.playbackRate,
    })
    expect(stopView('oneThing', runnerFocusFor(['trunkLean']), params)).toEqual(NO_FOCUS_CAMERA)
    expect(stopView('oneThing', undefined, params)).toEqual(NO_FOCUS_CAMERA)
  })
})

describe('tourStopDomId', () => {
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
