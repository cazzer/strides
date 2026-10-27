import { describe, expect, it } from 'vitest'
import { makeMetric } from '../results/__fixtures__/metricResult'
import { METRIC_LABELS } from '../results/metricConfidence'
import { SKELETON_EDGES } from '../results/skeletonGeometry'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import { bindAll, bindOnly } from './__fixtures__/boundParams'
import { CAMERA_PRESETS } from './camera'
import { runnerParamValues, segmentSource } from './runnerParams'
import {
  RUNNER_PARAM_IDS,
  VIEW_HALF_HEIGHT,
  VIEW_HALF_WIDTH,
  cameraKey,
  clampLabelX,
  describeRunner,
  drawOrder,
  easeInOutCubic,
  effectiveSources,
  focusParamsOf,
  jointStyles,
  labelAlign,
  placeLabel,
  sanitizeRate,
  segmentStyle,
} from './runnerScene'
import type { BoundRunnerParams } from './types'

const BINDINGS: Record<string, BoundRunnerParams> = {
  allMeasured: bindAll(),
  onlyKneeDrive: bindOnly(['kneeDrive']),
  onlyFootStrike: bindOnly(['footStrikePattern']),
  noneMeasured: bindOnly([]),
  halfMeasured: bindOnly(['cadence', 'trunkLean', 'kneeFlexion', 'overstriding', 'stepWidth']),
}

describe('segmentStyle', () => {
  it.each(Object.entries(BINDINGS))(
    'agrees with the core segmentSource without overrides or focus (%s)',
    (_name, bound) => {
      const sources = effectiveSources(bound)
      for (const edge of SKELETON_EDGES) {
        expect(segmentStyle(edge, sources, [])).toBe(segmentSource(edge, bound))
      }
    },
  )

  it('accents the edges of a measured focus parameter only', () => {
    const bound = bindAll()
    const sources = effectiveSources(bound)
    expect(segmentStyle(['left_shoulder', 'left_hip'], sources, ['torsoPitch'])).toBe('focus')
    expect(segmentStyle(['left_hip', 'left_knee'], sources, ['torsoPitch'])).toBe('measured')
    const neutralLean = effectiveSources(bindOnly(['kneeDrive']))
    expect(segmentStyle(['left_shoulder', 'left_hip'], neutralLean, ['torsoPitch'])).toBe('neutral')
  })

  it('keeps head edges neutral even when everything is measured and in focus', () => {
    const sources = effectiveSources(bindAll())
    expect(segmentStyle(['left_ear', 'nose'], sources, RUNNER_PARAM_IDS)).toBe('neutral')
    expect(segmentStyle(['right_ear', 'right_shoulder'], sources, RUNNER_PARAM_IDS)).toBe('neutral')
  })

  it('follows overridden sources', () => {
    const bound = bindAll()
    const sources = effectiveSources(
      bound,
      Object.fromEntries(RUNNER_PARAM_IDS.map((id) => [id, 'neutral'])),
    )
    for (const edge of SKELETON_EDGES) expect(segmentStyle(edge, sources, ['torsoPitch'])).toBe('neutral')
  })
})

describe('effectiveSources', () => {
  it('is exactly the bound sources without overrides', () => {
    const bound = BINDINGS.halfMeasured
    const sources = effectiveSources(bound)
    for (const id of RUNNER_PARAM_IDS) expect(sources[id]).toBe(bound[id].source)
  })

  it('takes an override per parameter', () => {
    const sources = effectiveSources(bindAll(), { torsoPitch: 'neutral' })
    expect(sources.torsoPitch).toBe('neutral')
    expect(sources.cadence).toBe('measured')
    expect(effectiveSources(bindOnly([]), { cadence: 'measured' }).cadence).toBe('measured')
  })
})

describe('focusParamsOf', () => {
  it('maps metrics to parameters, de-duplicated, ignoring the two that drive nothing', () => {
    expect(
      focusParamsOf(['verticalOscillation', 'verticalOscillationCm', 'verticalRatio', 'stepWidthCm', 'trunkLean']),
    ).toEqual(['pelvisBounce', 'torsoPitch'])
    expect(focusParamsOf([])).toEqual([])
  })
})

describe('jointStyles', () => {
  it('takes the strongest incident style and keeps head joints neutral', () => {
    const sources = effectiveSources(bindAll())
    const edges = SKELETON_EDGES.map((edge) => segmentStyle(edge, sources, ['peakThighAngle']))
    const joints = jointStyles(edges)
    const style = (name: (typeof COMMON_KEYPOINT_NAMES)[number]) =>
      joints[COMMON_KEYPOINT_NAMES.indexOf(name)]
    expect(style('left_knee')).toBe('focus')
    expect(style('left_hip')).toBe('focus')
    expect(style('left_ankle')).toBe('measured')
    expect(style('nose')).toBe('neutral')
    expect(style('left_ear')).toBe('neutral')
  })
})

describe('drawOrder', () => {
  const values = runnerParamValues(bindAll())
  const edgeIndex = (a: string, b: string) =>
    SKELETON_EDGES.findIndex(([x, y]) => x === a && y === b)

  it('draws the far (left) side first and dimmed in the side view', () => {
    const order = drawOrder(values, CAMERA_PRESETS.wholeBodySide)
    const leftThigh = edgeIndex('left_hip', 'left_knee')
    const rightThigh = edgeIndex('right_hip', 'right_knee')
    expect(order.edges.indexOf(leftThigh)).toBeLessThan(order.edges.indexOf(rightThigh))
    expect(order.farEdge[leftThigh]).toBe(true)
    expect(order.farEdge[rightThigh]).toBe(false)
    expect(order.farEdge[edgeIndex('left_hip', 'right_hip')]).toBe(false)
    expect([...order.edges].sort((a, b) => a - b)).toEqual(SKELETON_EDGES.map((_, i) => i))
    expect([...order.joints].sort((a, b) => a - b)).toEqual(COMMON_KEYPOINT_NAMES.map((_, i) => i))
  })

  it('flips when viewed from the other side', () => {
    const order = drawOrder(values, { ...CAMERA_PRESETS.wholeBodySide, yawDeg: 180 })
    expect(order.farEdge[edgeIndex('right_hip', 'right_knee')]).toBe(true)
    expect(order.farEdge[edgeIndex('left_hip', 'left_knee')]).toBe(false)
  })
})

describe('describeRunner', () => {
  it('names exactly the measured parameters, then the illustrative ones', () => {
    const bound = bindOnly(['cadence', 'trunkLean'])
    const text = describeRunner(bound, [])
    expect(text).toContain('Measured from your clip: Cadence, Trunk lean.')
    expect(text).toContain('Fixed illustrative settings, not measured: ')
    expect(text).toContain(METRIC_LABELS.kneeDrive)
    expect(text).not.toContain('Shown:')
    const measuredPart = text.split('.')[0]
    expect(measuredPart).not.toContain(METRIC_LABELS.kneeDrive)
  })

  it('states the measured focus value, and a clamp, but not a neutral focus', () => {
    const bound = bindAll({
      overstriding: makeMetric('overstriding', { value: 0.05 }),
      footStrikePattern: makeMetric('footStrikePattern', { value: 0.1 }),
    })
    expect(bound.contactShankOffset.source === 'measured' && bound.contactShankOffset.clamped).toBe(true)
    const text = describeRunner(bound, ['torsoPitch', 'contactShankOffset'])
    expect(text).toContain('Shown: Trunk lean 5.0°; Foot strike pattern Heel strike (proxy), drawn at a limit of the figure, not at the measured value.')
    expect(describeRunner(bindOnly(['cadence']), ['torsoPitch'])).not.toContain('Shown:')
  })

  it('never frames the figure as a reference, an ideal or the reader’s body', () => {
    for (const bound of Object.values(BINDINGS)) {
      expect(describeRunner(bound, RUNNER_PARAM_IDS)).not.toMatch(/reference|ideal|your body/i)
    }
    expect(describeRunner(BINDINGS.noneMeasured, [])).toMatch(/^Nothing in this figure was measured/)
  })
})

describe('small helpers', () => {
  it('keys a camera by value, not identity', () => {
    expect(cameraKey('torsoSide')).toBe('torsoSide')
    expect(cameraKey({ ...CAMERA_PRESETS.feetFront })).toBe(cameraKey({ ...CAMERA_PRESETS.feetFront }))
    expect(cameraKey({ ...CAMERA_PRESETS.feetFront, zoom: 2 })).not.toBe(
      cameraKey({ ...CAMERA_PRESETS.feetFront }),
    )
  })

  it('eases from 0 to 1 monotonically', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12)
    for (let t = 0; t < 1; t += 0.05) expect(easeInOutCubic(t + 0.05)).toBeGreaterThan(easeInOutCubic(t))
  })

  it('plays a bad rate at 1×', () => {
    expect(sanitizeRate(undefined)).toBe(1)
    expect(sanitizeRate(Number.NaN)).toBe(1)
    expect(sanitizeRate(0)).toBe(1)
    expect(sanitizeRate(-2)).toBe(1)
    expect(sanitizeRate(Infinity)).toBe(1)
    expect(sanitizeRate(0.5)).toBe(0.5)
  })

  it('keeps a long label inside the frame', () => {
    const font = 0.1
    const chars = 30
    const width = chars * font * 0.56
    const startX = clampLabelX(1.4, 'start', chars, font)
    expect(startX + width).toBeLessThanOrEqual(VIEW_HALF_WIDTH)
    const endX = clampLabelX(-1.4, 'end', chars, font)
    expect(endX - width).toBeGreaterThanOrEqual(-VIEW_HALF_WIDTH)
    expect(clampLabelX(0, 'middle', 4, font)).toBe(0)
  })

  it('places a label block on its side of the anchor, inside the frame', () => {
    const font = 0.1
    const lines = ['15.0%', 'of torso length']
    const below = placeLabel({ x: 0, y: 0 }, 'below', lines, font, 0.05)
    expect(below.x).toBe(0)
    expect(below.ys[0] - font * 0.6).toBeCloseTo(0.05, 12)
    expect(below.ys[1] - below.ys[0]).toBeCloseTo(font * 1.2, 12)
    const above = placeLabel({ x: 0, y: 0 }, 'above', ['5.0°'], font, 0.05)
    expect(above.ys[0] + font * 0.6).toBeCloseTo(-0.05, 12)
    expect(placeLabel({ x: 0, y: 0 }, 'right', ['5.0°'], font, 0.05)).toEqual({ x: 0.05, ys: [0] })
    expect(placeLabel({ x: 0, y: 0 }, 'left', ['5.0°'], font, 0.05).x).toBe(-0.05)
    const offFrame = placeLabel({ x: 0, y: 5 }, 'below', lines, font, 0.05)
    expect(offFrame.ys[1] + font * 0.6).toBeLessThanOrEqual(VIEW_HALF_HEIGHT + 1e-12)
    expect(labelAlign('right')).toBe('start')
    expect(labelAlign('left')).toBe('end')
    expect(labelAlign('above')).toBe('middle')
  })
})
