import { describe, expect, it } from 'vitest'
import { FOCUS_AREAS, FOCUS_AREA_ORDER } from '../guidance/focusAreas'
import { CAMERA_PRESETS } from '../runner/camera'
import { KEY_LEG_PHASE } from '../runner/runnerAnnotations'
import { bindRunnerParams, paramForMetric } from '../runner/runnerParams'
import { makeHeuristics, makeVerticalOscillation } from './__fixtures__/metricResult'
import {
  FOCUS_AREA_CAMERA,
  NO_FOCUS_CAMERA,
  SLOW_MOTION_RATE,
  runnerFocusFor,
  runnerViewFor,
} from './focusAreaCamera'

describe('FOCUS_AREA_CAMERA', () => {
  it('maps every focus area to a real preset and a positive, at-most-normal rate', () => {
    expect(Object.keys(FOCUS_AREA_CAMERA).sort()).toEqual([...FOCUS_AREA_ORDER].sort())
    for (const area of FOCUS_AREA_ORDER) {
      const { camera, playbackRate } = FOCUS_AREA_CAMERA[area]
      expect(CAMERA_PRESETS[camera], area).toBeDefined()
      expect(playbackRate, area).toBeGreaterThan(0)
      expect(playbackRate, area).toBeLessThanOrEqual(1)
    }
  })

  it('frames the planned preset per area', () => {
    expect(FOCUS_AREA_CAMERA).toEqual({
      rhythm: { camera: 'wholeBodySide', playbackRate: 1 },
      arms: { camera: 'armsQuarter', playbackRate: 1 },
      posture: { camera: 'torsoSide', playbackRate: 1 },
      knees: { camera: 'legsSide', playbackRate: 0.4 },
      landing: { camera: 'landingSide', playbackRate: 0.4 },
      footPath: { camera: 'feetFront', playbackRate: 0.4 },
    })
    expect(NO_FOCUS_CAMERA).toEqual({ camera: 'wholeBodySide', playbackRate: 1 })
  })

  it('slows the knee-flexion area at the rate the other slowed areas use', () => {
    const kneeFlexionArea = FOCUS_AREA_ORDER.find((area) => FOCUS_AREAS[area].metricIds[0] === 'kneeFlexion')!
    expect(FOCUS_AREA_CAMERA[kneeFlexionArea].playbackRate).toBe(SLOW_MOTION_RATE)
    expect(FOCUS_AREA_CAMERA.landing.playbackRate).toBe(SLOW_MOTION_RATE)
    expect(FOCUS_AREA_CAMERA.footPath.playbackRate).toBe(SLOW_MOTION_RATE)
  })
})

describe('runnerViewFor', () => {
  const measured = bindRunnerParams(makeHeuristics())
  const noStride = bindRunnerParams(
    makeHeuristics({ verticalOscillation: makeVerticalOscillation({ viewFit: 'unsuitable' }) }),
  )

  it('takes the stride camera, at the area’s rate, when the focus draws vertical ratio’s stride', () => {
    const focus = runnerFocusFor(['cadence', 'verticalRatio'])
    expect(measured.strideLength.source).toBe('measured')
    expect(runnerViewFor('rhythm', focus, measured)).toEqual({ camera: 'strideSide', playbackRate: 1 })
  })

  it('keeps the area’s own camera without vertical ratio, or without a measured stride', () => {
    expect(runnerViewFor('rhythm', runnerFocusFor(['cadence']), measured)).toEqual(FOCUS_AREA_CAMERA.rhythm)
    expect(noStride.strideLength.source).toBe('neutral')
    expect(runnerViewFor('rhythm', runnerFocusFor(['cadence', 'verticalRatio']), noStride)).toEqual(
      FOCUS_AREA_CAMERA.rhythm,
    )
    expect(runnerViewFor('knees', runnerFocusFor(['kneeFlexion']), measured)).toEqual(FOCUS_AREA_CAMERA.knees)
    expect(runnerViewFor(null, undefined, measured)).toEqual(NO_FOCUS_CAMERA)
    expect(runnerViewFor(null, runnerFocusFor(['verticalRatio']), measured)).toEqual({
      camera: 'strideSide',
      playbackRate: 1,
    })
  })
})

describe('runnerFocusFor', () => {
  it('drops metrics that drive no parameter; vertical ratio drives the stride', () => {
    expect(runnerFocusFor(['stepWidthCm', 'verticalRatio']).metricIds).toEqual(['verticalRatio'])
  })

  it('keeps every phase-free parameter beside the first limb parameter', () => {
    expect(runnerFocusFor(['cadence', 'verticalOscillationCm']).metricIds).toEqual([
      'cadence',
      'verticalOscillationCm',
    ])
  })

  it('keeps one key phase: a second limb parameter keyed elsewhere is dropped', () => {
    // Knee flexion and knee drive peak at different phases; a still figure can mark only one.
    expect(runnerFocusFor(['kneeFlexion', 'kneeDrive']).metricIds).toEqual(['kneeFlexion'])
    expect(runnerFocusFor(['stepWidth', 'swingFootLateralExcursion']).metricIds).toEqual([
      'stepWidth',
    ])
  })

  it('keeps limb parameters that share the first one’s key phase', () => {
    const landing = runnerFocusFor(['overstriding', 'footStrikePattern']).metricIds
    expect(landing).toEqual(['overstriding', 'footStrikePattern'])
    const phases = landing.map((metric) => KEY_LEG_PHASE[paramForMetric(metric)!])
    expect(new Set(phases).size).toBe(1)
  })

  it('leaves at most one limb key phase for every area’s metric list', () => {
    for (const area of FOCUS_AREA_ORDER) {
      const phases = runnerFocusFor(FOCUS_AREAS[area].metricIds)
        .metricIds.map((metric) => KEY_LEG_PHASE[paramForMetric(metric)!])
        .filter((phase) => phase !== null)
      expect(new Set(phases).size, area).toBeLessThanOrEqual(1)
    }
  })
})
