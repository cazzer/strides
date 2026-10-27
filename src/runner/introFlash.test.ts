import { describe, expect, it } from 'vitest'
import { bindAll } from './__fixtures__/boundParams'
import { GAIT_PHASES, poseAt } from './gaitModel'
import { flashAnchor, labelBox, placeFlash } from './introFlash'
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
    expect(flashAnchor('contactShankOffset', VALUES, HELD, 0, FLOOR).y).toBe(FLOOR)
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
  })
})

describe('placeFlash', () => {
  const font = 0.1
  const line = font * LABEL_LINE_HEIGHT

  it('sits a gap to the right of its anchor when nothing is in the way', () => {
    expect(placeFlash({ x: 0, y: 0 }, 5, font, 0.05, [])).toEqual({ x: 0.05, y: 0 })
  })

  it('moves clear of a label box it would cover', () => {
    const box = labelBox(0, 'start', [0, line], 12, font)
    const at = placeFlash({ x: 0, y: 0 }, 5, font, 0.05, [box])
    const flash = labelBox(at.x, 'start', [at.y], 5, font)
    expect(flash.top).toBeGreaterThanOrEqual(box.bottom)
  })

  it('goes above a box at the foot of the frame', () => {
    const box = labelBox(0, 'start', [1.9], 12, font)
    const at = placeFlash({ x: 0, y: 1.9 }, 5, font, 0.05, [box])
    expect(labelBox(at.x, 'start', [at.y], 5, font).bottom).toBeLessThanOrEqual(box.top)
  })
})
