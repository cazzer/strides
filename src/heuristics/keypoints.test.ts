import { describe, expect, it } from 'vitest'
import { resolveBilateralPair, resolveMidpoint, resolvePoint } from './keypoints'
import { buildFrame } from './__fixtures__/testFrames'

describe('resolvePoint', () => {
  it('resolves a detected keypoint', () => {
    const frame = buildFrame({ left_hip: { x: 10, y: 20, status: 'detected' } })
    expect(resolvePoint(frame, 'left_hip')).toEqual({
      x: 10,
      y: 20,
      interpolated: false,
    })
  })

  it('resolves an interpolated keypoint and flags it', () => {
    const frame = buildFrame({ left_hip: { x: 10, y: 20, status: 'interpolated' } })
    expect(resolvePoint(frame, 'left_hip')).toEqual({
      x: 10,
      y: 20,
      interpolated: true,
    })
  })

  it('returns null for an unrecoverable keypoint', () => {
    const frame = buildFrame({ left_hip: { x: 10, y: 20, status: 'unrecoverable' } })
    expect(resolvePoint(frame, 'left_hip')).toBeNull()
  })

  it('returns null for a keypoint never specified (defaults to unrecoverable)', () => {
    const frame = buildFrame({})
    expect(resolvePoint(frame, 'left_hip')).toBeNull()
  })
})

describe('resolveMidpoint', () => {
  it('averages both sides when both are resolvable', () => {
    const frame = buildFrame({
      left_hip: { x: 0, y: 0 },
      right_hip: { x: 10, y: 20 },
    })
    const mid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    expect(mid).toEqual({ x: 5, y: 10, interpolated: false })
  })

  it('flags interpolated:true when either side was interpolated, even after averaging', () => {
    const frame = buildFrame({
      left_hip: { x: 0, y: 0, status: 'detected' },
      right_hip: { x: 10, y: 20, status: 'interpolated' },
    })
    const mid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    expect(mid?.interpolated).toBe(true)
  })

  it('falls back to the single resolvable side, flagged interpolated regardless of its own status', () => {
    const frame = buildFrame({
      left_hip: { x: 4, y: 8, status: 'detected' },
      right_hip: null,
    })
    const mid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    expect(mid).toEqual({ x: 4, y: 8, interpolated: true })
  })

  it('falls back to the right side when only it is resolvable', () => {
    const frame = buildFrame({
      left_hip: null,
      right_hip: { x: 4, y: 8, status: 'detected' },
    })
    const mid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    expect(mid).toEqual({ x: 4, y: 8, interpolated: true })
  })

  it('returns null when neither side is resolvable', () => {
    const frame = buildFrame({ left_hip: null, right_hip: null })
    expect(resolveMidpoint(frame, 'left_hip', 'right_hip')).toBeNull()
  })
})

describe('resolveBilateralPair', () => {
  it('returns both points when both sides are resolvable', () => {
    const frame = buildFrame({
      left_hip: { x: 0, y: 0 },
      right_hip: { x: 10, y: 20 },
    })
    expect(resolveBilateralPair(frame, 'left_hip', 'right_hip')).toEqual({
      left: { x: 0, y: 0 },
      right: { x: 10, y: 20 },
    })
  })

  it('returns null when only one side is resolvable (no tolerant fallback)', () => {
    const frame = buildFrame({
      left_hip: { x: 0, y: 0 },
      right_hip: null,
    })
    expect(resolveBilateralPair(frame, 'left_hip', 'right_hip')).toBeNull()
  })

  it('returns null when neither side is resolvable', () => {
    const frame = buildFrame({ left_hip: null, right_hip: null })
    expect(resolveBilateralPair(frame, 'left_hip', 'right_hip')).toBeNull()
  })
})
