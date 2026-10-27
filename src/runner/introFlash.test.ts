import { describe, expect, it } from 'vitest'
import { bindAll } from './__fixtures__/boundParams'
import { CAMERA_PRESETS } from './camera'
import { GAIT_PHASES, poseAt } from './gaitModel'
import { flashAlign, flashAnchor, labelBox, placeFlash, pointsBox } from './introFlash'
import { footFloor } from './runnerAnnotations'
import { runnerParamValues } from './runnerParams'
import { LABEL_LINE_HEIGHT, RUNNER_PARAM_IDS } from './runnerScene'

const VALUES = runnerParamValues(bindAll())
const FLOOR = footFloor(VALUES)
const HELD = GAIT_PHASES.midStance

describe('flashAnchor', () => {
  it('puts cadence above the head, landing and the feet on the floor, lean between hip and shoulders', () => {
    const pose = poseAt(HELD, VALUES)
    const headTop = Math.max(...pose.filter((j) => j.name === 'nose' || j.name.endsWith('_ear')).map((j) => j.y))
    expect(flashAnchor('cadence', VALUES, HELD, 0, FLOOR).y).toBeGreaterThan(headTop)
    expect(flashAnchor('landingOffset', VALUES, HELD, 0, FLOOR).y).toBe(FLOOR)
    const hip = flashAnchor('pelvisBounce', VALUES, HELD, 0, FLOOR)
    const lean = flashAnchor('torsoPitch', VALUES, HELD, 0, FLOOR)
    const shoulder = flashAnchor('armSwing', VALUES, HELD, 0, FLOOR)
    expect(lean.y).toBeGreaterThan(hip.y)
    expect(lean.y).toBeLessThan(shoulder.y)
  })

  it('is a fixed point for every parameter: the same inputs give the same anchor', () => {
    for (const id of RUNNER_PARAM_IDS) {
      const a = flashAnchor(id, VALUES, HELD, 0, FLOOR)
      expect(Object.values(a).every(Number.isFinite)).toBe(true)
      expect(flashAnchor(id, VALUES, HELD, 0, FLOOR)).toEqual(a)
    }
  })

  it('takes the near knee: right from the right side, left from the left', () => {
    const pose = poseAt(HELD, VALUES)
    const knee = (name: string) => {
      const j = pose.find((joint) => joint.name === name)
      return j && { x: j.x, y: j.y, z: j.z }
    }
    expect(flashAnchor('peakThighAngle', VALUES, HELD, 0, FLOOR)).toEqual(knee('right_knee'))
    expect(flashAnchor('peakThighAngle', VALUES, HELD, 180, FLOOR)).toEqual(knee('left_knee'))
    // Foot strike and swing arc sit on the near ankle, at ankle height.
    expect(flashAnchor('contactShankOffset', VALUES, HELD, 0, FLOOR)).toEqual(knee('right_ankle'))
    expect(flashAnchor('swingFootArc', VALUES, HELD, 180, FLOOR)).toEqual(knee('left_ankle'))
  })

  it('puts the lean flash on the back side of the torso, every other flash after its anchor', () => {
    // Side view: travel projects to the right, so the back is to the left.
    expect(flashAlign('torsoPitch', CAMERA_PRESETS.wholeBodySide)).toBe('end')
    expect(flashAlign('torsoPitch', { ...CAMERA_PRESETS.wholeBodySide, yawDeg: 180 })).toBe('start')
    expect(flashAlign('peakSwingKneeBend', CAMERA_PRESETS.wholeBodySide)).toBe('start')
  })
})

describe('placeFlash', () => {
  const font = 0.1
  const line = font * LABEL_LINE_HEIGHT

  it('sits a gap to the right of its anchor when nothing is in the way', () => {
    expect(placeFlash({ x: 0, y: 0 }, 'start', 5, font, 0.05, [])).toEqual({ x: 0.05, y: 0 })
    expect(placeFlash({ x: 0, y: 0 }, 'end', 5, font, 0.05, [])).toEqual({ x: -0.05, y: 0 })
  })

  it('moves clear of a label box it would cover', () => {
    const box = labelBox(0, 'start', [0, line], 12, font)
    const at = placeFlash({ x: 0, y: 0 }, 'start', 5, font, 0.05, [box])
    const flash = labelBox(at.x, 'start', [at.y], 5, font)
    // At least half a line of clearance.
    expect(flash.top).toBeGreaterThanOrEqual(box.bottom + line / 2 - 1e-12)
  })

  it('moves clear of an annotation mark’s bounding box', () => {
    const mark = pointsBox([
      { x: 0.02, y: -0.1 },
      { x: 0.3, y: 0.1 },
    ])
    if (!mark) throw new Error('box')
    const at = placeFlash({ x: 0, y: 0 }, 'start', 5, font, 0.05, [mark])
    expect(labelBox(at.x, 'start', [at.y], 5, font).top).toBeGreaterThanOrEqual(mark.bottom)
  })

  it('goes above a box at the foot of the frame', () => {
    const box = labelBox(0, 'start', [1.9], 12, font)
    const at = placeFlash({ x: 0, y: 1.9 }, 'start', 5, font, 0.05, [box])
    expect(labelBox(at.x, 'start', [at.y], 5, font).bottom).toBeLessThanOrEqual(box.top)
  })
})
