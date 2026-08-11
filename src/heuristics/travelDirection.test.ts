import { describe, expect, it } from 'vitest'
import { estimateTravelDirection } from './travelDirection'
import { buildFrame } from './__fixtures__/testFrames'

const TORSO_LENGTH_PX = 100
const bodyScale = { torsoLengthPx: TORSO_LENGTH_PX }

function hipFrame(x: number, timestamp: number) {
  return buildFrame(
    { left_hip: { x, y: 0 }, right_hip: { x, y: 0 } },
    timestamp,
  )
}

describe('estimateTravelDirection', () => {
  it('returns 1 for net rightward displacement well above the noise floor', () => {
    const frames = [hipFrame(0, 0), hipFrame(50, 1), hipFrame(200, 2)]
    expect(estimateTravelDirection(frames, bodyScale)).toBe(1)
  })

  it('returns -1 for net leftward displacement well above the noise floor', () => {
    const frames = [hipFrame(200, 0), hipFrame(150, 1), hipFrame(0, 2)]
    expect(estimateTravelDirection(frames, bodyScale)).toBe(-1)
  })

  it('returns 0 when net displacement is below half a torso length', () => {
    // displacement is 40px, threshold is 0.5 * 100 = 50px
    const frames = [hipFrame(0, 0), hipFrame(40, 1)]
    expect(estimateTravelDirection(frames, bodyScale)).toBe(0)
  })

  it('returns 1 when net displacement exactly clears the threshold', () => {
    const frames = [hipFrame(0, 0), hipFrame(51, 1)]
    expect(estimateTravelDirection(frames, bodyScale)).toBe(1)
  })

  it('uses the first and last resolvable frame, ignoring unresolvable ones at the edges', () => {
    const unresolvable = buildFrame({ left_hip: null, right_hip: null }, 0)
    const frames = [unresolvable, hipFrame(0, 1), hipFrame(200, 2), unresolvable]
    expect(estimateTravelDirection(frames, bodyScale)).toBe(1)
  })

  it('returns 0 when no frame has a resolvable hip position', () => {
    const unresolvable = buildFrame({ left_hip: null, right_hip: null }, 0)
    expect(estimateTravelDirection([unresolvable, unresolvable], bodyScale)).toBe(0)
  })

  it('returns 0 for an empty frame list', () => {
    expect(estimateTravelDirection([], bodyScale)).toBe(0)
  })
})
