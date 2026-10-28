import { describe, expect, it } from 'vitest'
import { FOCUS_AREAS, FOCUS_AREA_ORDER } from '../guidance/focusAreas'
import { CAMERA_PRESETS } from '../runner/camera'
import { KEY_LEG_PHASE } from '../runner/runnerAnnotations'
import { paramForMetric } from '../runner/runnerParams'
import { FOCUS_AREA_CAMERA, NO_FOCUS_CAMERA, runnerFocusFor } from './focusAreaCamera'

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
      knees: { camera: 'legsSide', playbackRate: 1 },
      landing: { camera: 'landingSide', playbackRate: 0.4 },
      footPath: { camera: 'feetFront', playbackRate: 0.4 },
    })
    expect(NO_FOCUS_CAMERA).toEqual({ camera: 'wholeBodySide', playbackRate: 1 })
  })
})

describe('runnerFocusFor', () => {
  it('drops metrics that drive no parameter', () => {
    expect(runnerFocusFor(['stepWidthCm', 'verticalRatio']).metricIds).toEqual([])
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
