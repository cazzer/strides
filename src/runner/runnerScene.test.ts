import { describe, expect, it } from 'vitest'
import { makeMetric } from '../results/__fixtures__/metricResult'
import { METRIC_LABELS } from '../results/metricConfidence'
import { SKELETON_EDGES } from '../results/skeletonGeometry'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import { bindAll, bindOnly } from './__fixtures__/boundParams'
import {
  CAMERA_PRESETS,
  LANDING_CONTACT_HOLD_MS,
  LANDING_END_HOLD_MS,
  LANDING_PHASE_WINDOW,
  type PhaseWindow,
} from './camera'
import { GAIT_PHASES, cyclesPerSecond } from './gaitModel'
import { NEUTRAL_RUNNER_PARAMS, runnerParamValues, segmentSource } from './runnerParams'
import {
  FRAME_MS,
  advancePhase,
  stepPlayback,
  RUNNER_PARAM_IDS,
  VIEW_HALF_HEIGHT,
  VIEW_HALF_WIDTH,
  FAR_OPACITY,
  LABEL_CHAR_WIDTH_EM,
  UNFOCUSED_OPACITY,
  cameraFromKey,
  cameraKey,
  clampLabelX,
  describeRunner,
  drawOrder,
  easeInOutCubic,
  effectiveSources,
  focusParamsOf,
  jointStyles,
  labelAlign,
  mixValues,
  neutralEdgeInFrame,
  partOpacity,
  placeLabel,
  sanitizeRate,
  segmentStyle,
  type PlaybackState,
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
    const width = chars * font * LABEL_CHAR_WIDTH_EM
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

  it('stacks a label block offsetLines line pitches further out, before keeping it in frame', () => {
    const font = 0.1
    const lines = ['Heel strike']
    const plain = placeLabel({ x: 0, y: 0 }, 'below', lines, font, 0.05)
    const stacked = placeLabel({ x: 0, y: 0 }, 'below', lines, font, 0.05, 2)
    expect(stacked.ys[0] - plain.ys[0]).toBeCloseTo(2 * font * 1.2, 12)
    const up = placeLabel({ x: 0, y: 0 }, 'above', lines, font, 0.05, 1)
    expect(up.ys[0] - placeLabel({ x: 0, y: 0 }, 'above', lines, font, 0.05).ys[0]).toBeCloseTo(
      -font * 1.2,
      12,
    )
    const clamped = placeLabel({ x: 0, y: VIEW_HALF_HEIGHT - 0.1 }, 'below', lines, font, 0.05, 3)
    expect(clamped.ys[0] + font * 0.6).toBeLessThanOrEqual(VIEW_HALF_HEIGHT + 1e-12)
  })
})

describe('advancePhase', () => {
  const window: PhaseWindow = LANDING_PHASE_WINDOW
  const end = window.start + window.length
  const inside = (phase: number) =>
    phase >= window.start - 1e-9 && phase <= end + 1e-9

  it('runs round the whole cycle without a window', () => {
    expect(advancePhase(0.9, 0.2, null)).toBeCloseTo(0.1, 12)
    expect(advancePhase(0.2, 0.05, null)).toBeCloseTo(0.25, 12)
  })

  it('loops inside the window: past its end it starts again from its start', () => {
    expect(advancePhase(0.5, 0.05, window)).toBeCloseTo(0.55, 12)
    expect(advancePhase(end - 0.01, 0.03, window)).toBeCloseTo(window.start + 0.02, 12)
    expect(advancePhase(end, 0, window)).toBeCloseTo(end, 12)
  })

  it('a window wrapping past the cycle end loops across it', () => {
    const wrapping: PhaseWindow = { start: 0.9, length: 0.2 }
    expect(advancePhase(0.95, 0.1, wrapping)).toBeCloseTo(0.05, 12)
    expect(advancePhase(0.08, 0.04, wrapping)).toBeCloseTo(0.92, 12)
  })

  it('plays on from outside the window into it, without a jump', () => {
    expect(advancePhase(0.1, 0.05, window)).toBeCloseTo(0.15, 12)
    const entered = advancePhase(window.start - 0.01, 0.03, window)
    expect(entered).toBeCloseTo(window.start + 0.02, 12)
    expect(advancePhase(entered, 0.03, window)).toBeCloseTo(window.start + 0.05, 12)
  })

  it('once inside, never leaves over ten seconds of 30 fps at cadence 170 and 0.4×', () => {
    const delta = (FRAME_MS / 1000) * cyclesPerSecond({ ...NEUTRAL_RUNNER_PARAMS, cadence: 170 }) * 0.4
    let phase = 0.5
    let passedContact = 0
    for (let i = 0; i < 300; i += 1) {
      const next = advancePhase(phase, delta, window)
      expect(inside(next), `frame ${i}: ${next}`).toBe(true)
      if (phase < 0.5 && next >= 0.5) passedContact += 1
      phase = next
    }
    // The window holds contact, and the loop keeps passing through it.
    expect(passedContact).toBeGreaterThan(2)
  })
})

describe('render helpers', () => {
  it('never dims a neutral part, and dims measured ones no further than the floor', () => {
    expect(partOpacity('neutral', true, true)).toBe(1)
    expect(partOpacity('measured', false, false)).toBe(1)
    expect(partOpacity('measured', true, false)).toBe(FAR_OPACITY)
    expect(partOpacity('measured', false, true)).toBe(UNFOCUSED_OPACITY)
    expect(partOpacity('measured', true, true)).toBe(Math.min(FAR_OPACITY, UNFOCUSED_OPACITY))
    expect(partOpacity('focus', false, true)).toBe(1)
    expect(partOpacity('focus', true, true)).toBe(FAR_OPACITY)
  })

  it('round-trips a camera through its key', () => {
    expect(cameraFromKey(cameraKey('legsSide'))).toBe(CAMERA_PRESETS.legsSide)
    const state = { yawDeg: 30, pitchDeg: 5, zoom: 1.25, target: { x: 0.1, y: 1.2, z: -0.05 } }
    expect(cameraFromKey(cameraKey(state))).toEqual(state)
  })

  it('mixes tween values linearly, exactly `to` at the end, base elsewhere', () => {
    const base = runnerParamValues(bindAll())
    const half = mixValues(base, { torsoPitch: 0 }, { torsoPitch: 20, cadence: 200 }, 0.5)
    expect(half.torsoPitch).toBe(10)
    expect(half.cadence).toBe((base.cadence + 200) / 2)
    expect(half.armSwing).toBe(base.armSwing)
    const end = mixValues(base, { torsoPitch: 0 }, { torsoPitch: 20 }, 1)
    expect(end.torsoPitch).toBe(20)
    expect(mixValues(base, { torsoPitch: 0 }, { torsoPitch: 20 }, 0).torsoPitch).toBe(0)
  })

  it('finds a neutral edge in frame only when one is', () => {
    const values = runnerParamValues(bindAll())
    const styles = SKELETON_EDGES.map((edge) =>
      segmentStyle(edge, effectiveSources(bindAll()), []),
    )
    expect(neutralEdgeInFrame(styles, values, 0.19, 'wholeBodySide')).toBe(true)
    expect(neutralEdgeInFrame(styles, values, 0.19, 'feetFront')).toBe(false)
  })
})

describe('stepPlayback', () => {
  const window = LANDING_PHASE_WINDOW
  const end = window.start + window.length
  const cps = cyclesPerSecond({ ...NEUTRAL_RUNNER_PARAMS, cadence: 170 }) * 0.4

  it('without a window, or outside one, is advancePhase with no hold', () => {
    expect(stepPlayback({ phase: 0.49, holdLeftMs: 0 }, 100, 1, null)).toEqual({
      phase: advancePhase(0.49, 0.1, null),
      holdLeftMs: 0,
    })
    expect(stepPlayback({ phase: 0.1, holdLeftMs: 0 }, 100, 1, window)).toEqual({
      phase: advancePhase(0.1, 0.1, window),
      holdLeftMs: 0,
    })
  })

  it('stops exactly on the contact and rests there for the hold, in wall-clock time, then plays on', () => {
    let state = stepPlayback({ phase: 0.49, holdLeftMs: 0 }, 100, 1, window)
    expect(state).toEqual({ phase: GAIT_PHASES.rightContact, holdLeftMs: LANDING_CONTACT_HOLD_MS })
    // The rate does not stretch the hold.
    state = stepPlayback(state, 200, 50, window)
    expect(state).toEqual({ phase: GAIT_PHASES.rightContact, holdLeftMs: LANDING_CONTACT_HOLD_MS - 200 })
    // The rest of a step that outlasts the hold plays on from the contact.
    state = stepPlayback(state, LANDING_CONTACT_HOLD_MS - 200 + 10, 1, window)
    expect(state.holdLeftMs).toBe(0)
    expect(state.phase).toBeCloseTo(GAIT_PHASES.rightContact + 0.01, 12)
  })

  it('rests briefly on the window’s last frame before starting again, never playing backwards', () => {
    let state = stepPlayback({ phase: end - 0.005, holdLeftMs: 0 }, 100, 1, window)
    expect(state).toEqual({ phase: end, holdLeftMs: LANDING_END_HOLD_MS })
    state = stepPlayback(state, LANDING_END_HOLD_MS, 1, window)
    expect(state).toEqual({ phase: end, holdLeftMs: 0 })
    state = stepPlayback(state, 20, 1, window)
    expect(state.phase).toBeCloseTo(window.start + 0.02, 12)
    expect(state.holdLeftMs).toBe(0)
  })

  it('holds once per loop at the contact and once at the end, over ten seconds at 30 fps', () => {
    let state: PlaybackState = { phase: window.start, holdLeftMs: 0 }
    let contactHolds = 0
    let endHolds = 0
    let restarts = 0
    let contactFrames = 0
    for (let i = 0; i < 300; i += 1) {
      const next = stepPlayback(state, FRAME_MS, cps, window)
      if (next.holdLeftMs > 0 && state.holdLeftMs === 0) {
        if (next.phase === GAIT_PHASES.rightContact) contactHolds += 1
        else if (next.phase === end) endHolds += 1
        else throw new Error(`unexpected hold at ${next.phase}`)
      }
      if (next.phase === GAIT_PHASES.rightContact) contactFrames += 1
      if (next.phase < state.phase) restarts += 1
      state = next
    }
    expect(contactHolds).toBeGreaterThan(3)
    // One contact hold and one end hold per restart (give or take the pass in progress).
    expect(Math.abs(contactHolds - restarts)).toBeLessThanOrEqual(1)
    expect(Math.abs(endHolds - restarts)).toBeLessThanOrEqual(1)
    // Each contact hold shows the exact contact frame for about the hold's length.
    expect(contactFrames / contactHolds).toBeGreaterThanOrEqual(Math.floor(LANDING_CONTACT_HOLD_MS / FRAME_MS))
  })
})
