import { describe, expect, it } from 'vitest'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import {
  MIN_FOOTAGE_SEGMENT_SUM,
  fitFootagePlate,
  footageKeyPhase,
  heldLegFor,
  mapFootageName,
  type FootageFitInput,
  type FootagePoint,
  type PlateTransform,
} from './footagePlate'
import { GAIT_PHASES } from './gaitModel'
import { phaseForLeg } from './runnerAnnotations'
import type { ProjectedJoint } from './types'

/** A drawn side-view leg pair: hips together at (0, 0), right knee and ankle forward, left behind. */
const DRAWN_AT: Partial<Record<KeypointName, { x: number; y: number }>> = {
  left_hip: { x: 0, y: 0 },
  right_hip: { x: 0, y: 0 },
  right_knee: { x: 0.3, y: 0.4 },
  right_ankle: { x: 0.3, y: 0.9 },
  left_knee: { x: -0.2, y: 0.45 },
  left_ankle: { x: -0.5, y: 0.8 },
}

function drawn(at = DRAWN_AT): ProjectedJoint[] {
  return COMMON_KEYPOINT_NAMES.map((name) => ({ name, ...(at[name] ?? { x: 0, y: -1 }), depth: 0 }))
}

/** The inverse of a transform: where a drawn point sits in the image's unit square. */
function toFootage(t: PlateTransform, name: KeypointName, at = DRAWN_AT): FootagePoint {
  const p = at[name] as { x: number; y: number }
  return { name, u: (p.x - t.e) / t.a, v: (p.y - t.f) / t.d }
}

function apply(t: PlateTransform, p: FootagePoint): { x: number; y: number } {
  return { x: t.a * p.u + t.e, y: t.d * p.v + t.f }
}

const KNOWN: PlateTransform = { a: 2.5, d: 2.5, e: -1.1, f: -0.6 }

function input(points: FootagePoint[], overrides: Partial<FootageFitInput> = {}): FootageFitInput {
  return { points, measuredSide: 'right', mirror: false, ...overrides }
}

describe('fitFootagePlate', () => {
  it('recovers a known scale and translation exactly when the footage is the drawn pose', () => {
    const names: KeypointName[] = ['left_hip', 'right_hip', 'right_knee', 'right_ankle']
    const fit = fitFootagePlate(input(names.map((n) => toFootage(KNOWN, n))), drawn(), 'right')
    expect(fit).not.toBeNull()
    expect(fit?.a).toBeCloseTo(KNOWN.a, 12)
    expect(fit?.d).toBeCloseTo(KNOWN.d, 12)
    expect(fit?.e).toBeCloseTo(KNOWN.e, 12)
    expect(fit?.f).toBeCloseTo(KNOWN.f, 12)
  })

  it('mirrors a right-to-left clip: negative a, the hips still meet', () => {
    const mirrored: PlateTransform = { a: -KNOWN.a, d: KNOWN.d, e: 3.4, f: KNOWN.f }
    const names: KeypointName[] = ['left_hip', 'right_hip', 'right_knee', 'right_ankle']
    const points = names.map((n) => toFootage(mirrored, n))
    const fit = fitFootagePlate(input(points, { mirror: true }), drawn(), 'right') as PlateTransform
    expect(fit.a).toBeCloseTo(-KNOWN.a, 12)
    expect(fit.d).toBeCloseTo(KNOWN.d, 12)
    expect(fit.e).toBeCloseTo(3.4, 12)
    const knee = apply(fit, points[2])
    expect(knee.x).toBeCloseTo(0.3, 12)
    expect(knee.y).toBeCloseTo(0.4, 12)
  })

  it('draws the measured leg on the held leg: a left-measured footage fits the right model leg', () => {
    const points = (['left_hip', 'right_knee', 'right_ankle'] as KeypointName[]).map((n) => {
      const p = toFootage(KNOWN, n)
      return { ...p, name: mapFootageName(n, 'right', 'left') }
    })
    expect(points.map((p) => p.name)).toEqual(['right_hip', 'left_knee', 'left_ankle'])
    const fit = fitFootagePlate(input(points, { measuredSide: 'left' }), drawn(), 'right') as PlateTransform
    expect(fit.a).toBeCloseTo(KNOWN.a, 12)
    expect(fit.e).toBeCloseTo(KNOWN.e, 12)
  })

  it('reads the scale from segment lengths, so a different knee angle leaves it unchanged', () => {
    const names: KeypointName[] = ['left_hip', 'right_hip', 'right_knee', 'right_ankle']
    const straight = fitFootagePlate(input(names.map((n) => toFootage(KNOWN, n))), drawn(), 'right') as PlateTransform
    // The same thigh and shank lengths, the shank swung back to a much deeper knee bend.
    const shank = Math.hypot(0, 0.5)
    const bent = { ...DRAWN_AT, right_ankle: { x: 0.3 - shank * Math.sin(1.2), y: 0.4 + shank * Math.cos(1.2) } }
    const points = names.map((n) => toFootage(KNOWN, n, bent))
    const fit = fitFootagePlate(input(points), drawn(), 'right') as PlateTransform
    expect(fit.a).toBeCloseTo(straight.a, 12)
    expect(fit.e).toBeCloseTo(straight.e, 12)
    expect(fit.f).toBeCloseTo(straight.f, 12)
    // The footage ankle is NOT pulled onto the model's: the difference stays visible.
    const ankle = apply(fit, points[3])
    expect(Math.hypot(ankle.x - 0.3, ankle.y - 0.9)).toBeGreaterThan(0.2)
  })

  it('uses hip → ankle when the footage has no knee', () => {
    const names: KeypointName[] = ['right_hip', 'right_ankle']
    const fit = fitFootagePlate(input(names.map((n) => toFootage(KNOWN, n))), drawn(), 'right') as PlateTransform
    // Both sides measure hip-mid → ankle, the one segment the footage has.
    expect(fit.a).toBeCloseTo(KNOWN.a, 12)
  })

  it('is null without a hip, with only hips, with degenerate lengths, or with non-finite input', () => {
    const at = (names: KeypointName[]) => names.map((n) => toFootage(KNOWN, n))
    expect(fitFootagePlate(input(at(['right_knee', 'right_ankle'])), drawn(), 'right')).toBeNull()
    expect(fitFootagePlate(input(at(['left_hip', 'right_hip'])), drawn(), 'right')).toBeNull()
    const tiny = MIN_FOOTAGE_SEGMENT_SUM / 4
    const degenerate: FootagePoint[] = [
      { name: 'right_hip', u: 0.5, v: 0.5 },
      { name: 'right_knee', u: 0.5 + tiny, v: 0.5 },
    ]
    expect(fitFootagePlate(input(degenerate), drawn(), 'right')).toBeNull()
    const nan: FootagePoint[] = [...at(['right_hip', 'right_knee']), { name: 'right_ankle', u: Number.NaN, v: 0.5 }]
    expect(fitFootagePlate(input(nan), drawn(), 'right')).toBeNull()
    const collapsed = drawn({ ...DRAWN_AT, right_knee: { x: 0, y: 0 }, right_ankle: { x: 0, y: 0 } })
    expect(fitFootagePlate(input(at(['right_hip', 'right_knee', 'right_ankle'])), collapsed, 'right')).toBeNull()
  })

  it('is deterministic', () => {
    const names: KeypointName[] = ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'right_ankle']
    const points = names.map((n) => toFootage(KNOWN, n))
    const first = fitFootagePlate(input(points), drawn(), 'right')
    expect(fitFootagePlate(input(points), drawn(), 'right')).toEqual(first)
  })
})

describe('footage plate helpers', () => {
  it('maps the measured side to the held leg and the other side to the other leg', () => {
    expect(mapFootageName('left_knee', 'left', 'right')).toBe('right_knee')
    expect(mapFootageName('right_ankle', 'left', 'right')).toBe('left_ankle')
    expect(mapFootageName('right_hip', 'right', 'right')).toBe('right_hip')
    expect(mapFootageName('nose', 'left', 'right')).toBe('nose')
  })

  it('holds the near leg: right from the runner’s right, left from the other side', () => {
    expect(heldLegFor(0)).toBe('right')
    expect(heldLegFor(180)).toBe('left')
  })

  it('keys the plate to the metric’s own leg phase, and to nothing for a metric without one', () => {
    expect(footageKeyPhase('kneeFlexion', 'right')).toBe(phaseForLeg('right', GAIT_PHASES.peakSwingKneeBend))
    expect(footageKeyPhase('overstriding', 'right')).toBe(phaseForLeg('right', GAIT_PHASES.leftContact))
    expect(footageKeyPhase('kneeDrive', 'right')).toBe(phaseForLeg('right', GAIT_PHASES.peakThigh))
    expect(footageKeyPhase('trunkLean', 'right')).toBeNull()
    expect(footageKeyPhase('verticalRatio', 'right')).toBeNull()
  })
})
