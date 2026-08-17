// The `module hygiene` block at the bottom reads this module's own source off disk, so it opts
// into Node's ambient types locally the same way `evidenceFrames.test.ts` does —
// `tsconfig.app.json`'s `types` is deliberately just `vite/client`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { KeypointName } from '../pose/types'
import type { CropRectPx } from '../pose/backends/movenetCrop'
import type { MetricExemplar, MetricExemplarKind } from '../heuristics/types'
import { buildFrame } from '../heuristics/__fixtures__/testFrames'
import {
  DETECTED_OPACITY,
  INTERPOLATED_OPACITY,
} from './skeletonGeometry'
import {
  EVIDENCE_BASE_OPACITY,
  EVIDENCE_GHOST_OPACITY,
  evidenceOutputSide,
  evidenceSnapToleranceSeconds,
  planExemplarFrames,
} from './evidenceFrames'
import type {
  EvidenceFramePlan,
  EvidenceInstantPlan,
  EvidenceKeypointPosition,
  EvidenceOutwardSigns,
  EvidenceTravelDirection,
} from './evidenceFrames'
import {
  GRAFTED_METRICS,
  planEvidenceAnnotations,
} from './evidenceAnnotations'
import type {
  EvidenceAnnotationOp,
  EvidenceArcOp,
  EvidenceBoneOp,
  EvidenceCaliperOp,
  EvidenceGuideOp,
  EvidenceJointOp,
  EvidenceLineOp,
  EvidenceMarkerOp,
  EvidenceMarkRole,
} from './evidenceAnnotations'

const MAX_OUTPUT_SIDE = 640
/** Origin-anchored and exactly at the cap, so the transform is the identity and every geometry
 * assertion below reads in the same numbers the fixture was written in. The transform itself is
 * exercised separately, with a fractional side, in its own block. */
const IDENTITY_CROP: CropRectPx = { x: 0, y: 0, side: MAX_OUTPUT_SIDE }

function pos(
  name: KeypointName,
  x: number,
  y: number,
  status: 'detected' | 'interpolated' = 'detected',
): EvidenceKeypointPosition {
  return { name, status, x, y }
}

function lost(name: KeypointName): EvidenceKeypointPosition {
  return { name, status: 'unrecoverable' }
}

function instant(
  keypoints: EvidenceKeypointPosition[],
  options: {
    opacity?: number
    outwardSign?: EvidenceOutwardSigns | null
    timestamp?: number
  } = {},
): EvidenceInstantPlan {
  return {
    timestamp: options.timestamp ?? 0,
    opacity: options.opacity ?? EVIDENCE_BASE_OPACITY,
    keypoints,
    outwardSign: options.outwardSign ?? null,
  }
}

function plan(
  overrides: Partial<EvidenceFramePlan> &
    Pick<EvidenceFramePlan, 'metric' | 'kind' | 'base'>,
): EvidenceFramePlan {
  return {
    quality: 0.9,
    label: 'fixture',
    ghost: null,
    crop: IDENTITY_CROP,
    travelDirection: 1,
    demotedFromPair: false,
    ...overrides,
  }
}

function roles(ops: EvidenceAnnotationOp[]): EvidenceMarkRole[] {
  return ops
    .filter(
      (
        op,
      ): op is
        | EvidenceMarkerOp
        | EvidenceLineOp
        | EvidenceGuideOp
        | EvidenceCaliperOp
        | EvidenceArcOp => op.layer === 'measurement',
    )
    .map((op) => op.role)
}

function only<T extends EvidenceAnnotationOp>(
  ops: EvidenceAnnotationOp[],
  predicate: (op: EvidenceAnnotationOp) => op is T,
): T {
  const matches = ops.filter(predicate)
  expect(matches).toHaveLength(1)
  return matches[0]
}

function byRole(
  ops: EvidenceAnnotationOp[],
  role: EvidenceMarkRole,
  instantRole: 'base' | 'ghost' | 'pair' = 'base',
): EvidenceAnnotationOp[] {
  return ops.filter(
    (op) =>
      op.layer === 'measurement' &&
      op.role === role &&
      op.instant === instantRole,
  )
}

function isJoint(op: EvidenceAnnotationOp): op is EvidenceJointOp {
  return op.kind === 'joint'
}
function isBone(op: EvidenceAnnotationOp): op is EvidenceBoneOp {
  return op.kind === 'bone'
}

/** Every canvas coordinate an op carries, flattened — a guide's single axis position included. */
function opCoordinates(op: EvidenceAnnotationOp): number[] {
  switch (op.kind) {
    case 'joint':
    case 'marker':
    case 'arc':
      return [op.x, op.y]
    case 'bone':
    case 'line':
    case 'caliper':
      return [op.x1, op.y1, op.x2, op.y2]
    case 'guide':
      return [op.position]
  }
}

/** Every (x, y) pair an op anchors on. */
function opPoints(op: EvidenceAnnotationOp): Array<[number, number]> {
  switch (op.kind) {
    case 'joint':
    case 'marker':
    case 'arc':
      return [[op.x, op.y]]
    case 'bone':
    case 'line':
    case 'caliper':
      return [
        [op.x1, op.y1],
        [op.x2, op.y2],
      ]
    case 'guide':
      return []
  }
}

const TORSO = [
  pos('left_shoulder', 330, 200),
  pos('right_shoulder', 370, 200),
  pos('left_hip', 300, 400),
  pos('right_hip', 340, 400),
]

describe('the video→canvas transform', () => {
  it('scales by outputSide/crop.side, with a fractional side under the cap', () => {
    // round(min(321.7, 640)) = 322, over a side of 321.7 — the rounding is in the NUMERATOR only,
    // so the scale is not 1 even though the crop never reaches the cap.
    const crop: CropRectPx = { x: 40.25, y: 90.75, side: 321.7 }
    const outputSide = evidenceOutputSide(crop.side, MAX_OUTPUT_SIDE)
    expect(outputSide).toBe(322)
    const scale = outputSide / crop.side
    expect(scale).not.toBe(1)

    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'trunkLean',
        kind: 'trunkLeanRange',
        crop,
        base: instant(TORSO),
      }),
      MAX_OUTPUT_SIDE,
    )

    expect(annotation.outputSide).toBe(322)
    const hip = annotation.ops
      .filter(isJoint)
      .find((op) => op.name === 'left_hip')
    expect(hip).toBeDefined()
    expect(hip?.x).toBeCloseTo((300 - crop.x) * scale, 10)
    expect(hip?.y).toBeCloseTo((400 - crop.y) * scale, 10)
    // The naive `640 / crop.side` reading, which is the one to guard against.
    expect(hip?.x).not.toBeCloseTo((300 - crop.x) * (640 / crop.side), 6)
  })

  it('scales by outputSide/crop.side with a fractional side ABOVE the cap', () => {
    const crop: CropRectPx = { x: 1500.5, y: 700.25, side: 1200.5 }
    const outputSide = evidenceOutputSide(crop.side, MAX_OUTPUT_SIDE)
    expect(outputSide).toBe(640)
    const scale = 640 / 1200.5

    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'trunkLean',
        kind: 'trunkLeanRange',
        crop,
        base: instant([
          pos('left_shoulder', 1800, 900),
          pos('right_shoulder', 1900, 900),
          pos('left_hip', 1820, 1300),
          pos('right_hip', 1880, 1300),
        ]),
      }),
      MAX_OUTPUT_SIDE,
    )

    const hip = annotation.ops
      .filter(isJoint)
      .find((op) => op.name === 'left_hip')
    expect(hip?.x).toBeCloseTo((1820 - crop.x) * scale, 10)
    // The D3 trap: taking the plan's positions as canvas coordinates would put this at 1820 on a
    // 640-wide canvas — every mark off the image, and the thumbnail still looks fine.
    expect(hip?.x).toBeLessThan(640)
    expect(hip?.x).toBeGreaterThan(0)
  })

  it('never upscales a crop smaller than the cap', () => {
    const crop: CropRectPx = { x: 0, y: 0, side: 200 }
    expect(evidenceOutputSide(crop.side, MAX_OUTPUT_SIDE)).toBe(200)
  })
})

describe('per-metric mark sets', () => {
  it('trunkLean draws the torso vector, a vertical reference and the arc between them', () => {
    const annotation = planEvidenceAnnotations(
      plan({ metric: 'trunkLean', kind: 'trunkLeanRange', base: instant(TORSO) }),
      MAX_OUTPUT_SIDE,
    )

    expect(new Set(roles(annotation.ops))).toEqual(
      new Set(['torsoVector', 'verticalReference', 'trunkLeanArc']),
    )

    const torso = byRole(annotation.ops, 'torsoVector')[0] as EvidenceLineOp
    // hip-mid (320,400) → shoulder-mid (350,200): `trunkLean.ts:164-165` verbatim.
    expect([torso.x1, torso.y1, torso.x2, torso.y2]).toEqual([320, 400, 350, 200])

    const reference = byRole(
      annotation.ops,
      'verticalReference',
    )[0] as EvidenceLineOp
    const torsoLength = Math.hypot(30, 200)
    expect(reference.x2).toBeCloseTo(320, 10)
    expect(reference.y2).toBeCloseTo(400 - torsoLength, 10)

    const arc = byRole(annotation.ops, 'trunkLeanArc')[0] as EvidenceArcOp
    expect(arc.x).toBe(320)
    expect(arc.y).toBe(400)
    expect(arc.startAngleRadians).toBeCloseTo(-Math.PI / 2, 10)
    // The sweep is exactly `atan2(dx, -dy)` — the quantity `trunkLean.ts:170` measures.
    expect(arc.endAngleRadians - arc.startAngleRadians).toBeCloseTo(
      Math.atan2(30, 200),
      10,
    )
    expect(arc.reportedValueIsSupplement).toBe(false)
    expect(arc.radius).toBeCloseTo(0.3 * torsoLength, 10)
  })

  it('kneeFlexion draws the chain, the thigh extension and the INTERIOR arc, flagged as the supplement', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'kneeFlexion',
        kind: 'kneeFlexionPeak',
        side: 'left',
        base: instant([
          pos('left_hip', 300, 300),
          pos('left_knee', 300, 450),
          pos('left_ankle', 350, 570),
        ]),
      }),
      MAX_OUTPUT_SIDE,
    )

    expect(new Set(roles(annotation.ops))).toEqual(
      new Set(['thigh', 'shank', 'thighExtensionRay', 'kneeInteriorArc']),
    )

    const extension = byRole(
      annotation.ops,
      'thighExtensionRay',
    )[0] as EvidenceLineOp
    // knee + (knee−hip)/|knee−hip| × |ankle−knee| = (300,450) + (0,1)×130.
    expect(extension.x2).toBeCloseTo(300, 10)
    expect(extension.y2).toBeCloseTo(580, 10)

    const arc = byRole(annotation.ops, 'kneeInteriorArc')[0] as EvidenceArcOp
    expect(arc.reportedValueIsSupplement).toBe(true)
    const interiorRad = Math.abs(arc.endAngleRadians - arc.startAngleRadians)
    const interiorDeg = (interiorRad * 180) / Math.PI
    // The arc spans the INTERIOR angle; `kneeFlexion.ts:198` reports `180 − interiorAngle`.
    expect(interiorDeg).toBeGreaterThan(90)
    expect(180 - interiorDeg).toBeGreaterThan(0)
  })

  it("kneeFlexion's extension trough gets the chain but no arc, and is flagged unmeasured", () => {
    const leg = (kneeX: number, ankleX: number): EvidenceKeypointPosition[] => [
      pos('left_hip', 300, 300),
      pos('left_knee', kneeX, 450),
      pos('left_ankle', ankleX, 570),
    ]
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'kneeFlexion',
        kind: 'kneeFlexionPeak',
        side: 'left',
        base: instant(leg(300, 350)),
        ghost: instant(leg(302, 304), { opacity: EVIDENCE_GHOST_OPACITY }),
      }),
      MAX_OUTPUT_SIDE,
    )

    expect(new Set(roles(annotation.ops.filter((op) => op.instant === 'ghost')))).toEqual(
      new Set(['thigh', 'shank']),
    )
    expect(byRole(annotation.ops, 'kneeInteriorArc', 'ghost')).toHaveLength(0)
    expect(annotation.base.valueMeasuredAtInstant).toBe(true)
    expect(annotation.ghost?.valueMeasuredAtInstant).toBe(false)
  })

  it('overstriding draws a hip-midline plumb and a horizontal caliper, and no arc', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'overstriding',
        kind: 'overstrideRange',
        side: 'right',
        base: instant([
          pos('left_hip', 300, 400),
          pos('right_hip', 340, 400),
          pos('right_ankle', 420, 560),
        ]),
      }),
      MAX_OUTPUT_SIDE,
    )

    expect(new Set(roles(annotation.ops))).toEqual(
      new Set(['hipMidlinePlumb', 'ankleOffsetCaliper']),
    )
    const plumb = byRole(
      annotation.ops,
      'hipMidlinePlumb',
    )[0] as EvidenceGuideOp
    expect(plumb.orientation).toBe('vertical')
    expect(plumb.position).toBe(320)
    expect([plumb.from, plumb.to]).toEqual([0, MAX_OUTPUT_SIDE])

    const caliper = byRole(
      annotation.ops,
      'ankleOffsetCaliper',
    )[0] as EvidenceCaliperOp
    expect(caliper.axis).toBe('horizontal')
    // From the plumb to the ankle, at the ankle's own height — `overstriding.ts:174` is a purely
    // horizontal `ankle.x − hipMid.x`.
    expect([caliper.x1, caliper.y1, caliper.x2, caliper.y2]).toEqual([
      320, 560, 420, 560,
    ])
    expect(caliper.polarity).toBe(1)
  })

  it('footStrikePattern draws a knee plumb, the shank and a horizontal caliper — never an angle arc', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'footStrikePattern',
        kind: 'footStrike',
        side: 'right',
        base: instant([
          pos('right_knee', 400, 400),
          pos('right_ankle', 430, 560),
        ]),
      }),
      MAX_OUTPUT_SIDE,
    )

    expect(new Set(roles(annotation.ops))).toEqual(
      new Set(['kneePlumb', 'shank', 'ankleOffsetCaliper']),
    )
    expect(annotation.ops.some((op) => op.kind === 'arc')).toBe(false)
    const caliper = byRole(
      annotation.ops,
      'ankleOffsetCaliper',
    )[0] as EvidenceCaliperOp
    expect([caliper.x1, caliper.y1, caliper.x2, caliper.y2]).toEqual([
      400, 560, 430, 560,
    ])
  })

  it('stepWidth draws THIS frame’s hip-width segment, a per-frame midline, and a signed caliper', () => {
    const hips = (y: number): EvidenceKeypointPosition[] => [
      pos('left_hip', 300, y),
      pos('right_hip', 340, y),
    ]
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'stepWidth',
        kind: 'stepWidthStrike',
        side: 'left',
        base: instant([...hips(400), pos('left_ankle', 290, 560)], {
          outwardSign: { left: -1, right: 1 },
        }),
        ghost: instant([...hips(410), pos('left_ankle', 296, 566)], {
          opacity: EVIDENCE_GHOST_OPACITY,
          outwardSign: { left: -1, right: 1 },
        }),
      }),
      MAX_OUTPUT_SIDE,
    )

    // A ghosted pair carries TWO midlines, one per frame — never one shared line.
    const midlines = annotation.ops.filter(
      (op) => op.layer === 'measurement' && op.role === 'hipMidlinePlumb',
    ) as EvidenceGuideOp[]
    expect(midlines).toHaveLength(2)
    expect(midlines.map((op) => op.instant)).toEqual(['base', 'ghost'])

    const segment = byRole(
      annotation.ops,
      'hipWidthSegment',
    )[0] as EvidenceLineOp
    expect([segment.from, segment.to]).toEqual(['left_hip', 'right_hip'])

    const caliper = byRole(
      annotation.ops,
      'ankleOffsetCaliper',
    )[0] as EvidenceCaliperOp
    // ankle 290 is left of the midline 320, and the left hip is the left-of-midline side, so this
    // strike landed on its own side: `sign(−30) × outwardSign.left(−1)` = +1.
    expect(caliper.polarity).toBe(1)
  })

  it('armSwingSymmetry draws the arm chain, a shoulder horizontal and a vertical wrist bar', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'armSwingSymmetry',
        kind: 'armSwingCycle',
        side: 'right',
        base: instant([
          pos('right_shoulder', 350, 250),
          pos('right_elbow', 380, 330),
          pos('right_wrist', 400, 420),
        ]),
      }),
      MAX_OUTPUT_SIDE,
    )

    expect(new Set(roles(annotation.ops))).toEqual(
      new Set(['shoulderHorizontal', 'upperArm', 'forearm', 'armSwingCaliper']),
    )
    const bar = byRole(annotation.ops, 'armSwingCaliper')[0] as EvidenceCaliperOp
    expect(bar.axis).toBe('vertical')
    // `wrist.y − shoulder.y` at the wrist's own x — `armSwingSymmetry.ts:117`.
    expect([bar.x1, bar.y1, bar.x2, bar.y2]).toEqual([400, 250, 400, 420])
    expect(bar.polarity).toBeNull()
  })

  it('the arm chain is not drawn through a missing elbow', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'armSwingSymmetry',
        kind: 'armSwingCycle',
        side: 'right',
        base: instant([
          pos('right_shoulder', 350, 250),
          lost('right_elbow'),
          pos('right_wrist', 400, 420),
        ]),
      }),
      MAX_OUTPUT_SIDE,
    )

    expect(roles(annotation.ops)).not.toContain('upperArm')
    expect(roles(annotation.ops)).not.toContain('forearm')
    // The measurement the metric actually took survives the missing context joint.
    expect(roles(annotation.ops)).toContain('armSwingCaliper')
  })

  it('the bounce cycle draws a midpoint and a horizontal per instant, and no caliper across them', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'verticalOscillation',
        kind: 'bounceCycle',
        base: instant([pos('left_hip', 300, 400), pos('right_hip', 340, 400)]),
        ghost: instant([pos('left_hip', 300, 430), pos('right_hip', 340, 430)], {
          opacity: EVIDENCE_GHOST_OPACITY,
        }),
      }),
      MAX_OUTPUT_SIDE,
    )

    expect(new Set(roles(annotation.ops))).toEqual(
      new Set(['bounceMidpoint', 'bounceHorizontal']),
    )
    const marker = byRole(annotation.ops, 'bounceMidpoint')[0] as EvidenceMarkerOp
    expect([marker.x, marker.y]).toEqual([320, 400])
    const ghostLine = byRole(
      annotation.ops,
      'bounceHorizontal',
      'ghost',
    )[0] as EvidenceGuideOp
    expect(ghostLine.orientation).toBe('horizontal')
    expect(ghostLine.position).toBe(430)
    // The gap between the two horizontals is a two-sample pixel difference; the reported amplitude
    // is a whole-clip spectral fit. No caliper equates them.
    expect(annotation.ops.some((op) => op.kind === 'caliper')).toBe(false)
    expect(annotation.base.valueMeasuredAtInstant).toBe(false)
    expect(annotation.ghost?.valueMeasuredAtInstant).toBe(false)
  })

  it('the bounce cycle follows an ear-mid seed when that is the signal', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'verticalOscillation',
        kind: 'bounceCycle',
        base: instant([
          pos('left_ear', 300, 120),
          pos('right_ear', 340, 120),
          pos('left_shoulder', 300, 200),
          pos('right_shoulder', 340, 200),
        ]),
      }),
      MAX_OUTPUT_SIDE,
    )
    const marker = byRole(annotation.ops, 'bounceMidpoint')[0] as EvidenceMarkerOp
    expect([marker.x, marker.y]).toEqual([320, 120])
  })

  it('the stride pair draws a tick per endpoint and one caliper spanning the pair', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'verticalRatio',
        kind: 'stridePair',
        side: 'left',
        base: instant([pos('left_hip', 280, 400), pos('right_hip', 320, 400)]),
        ghost: instant([pos('left_hip', 480, 410), pos('right_hip', 520, 400)], {
          opacity: EVIDENCE_GHOST_OPACITY,
        }),
      }),
      MAX_OUTPUT_SIDE,
    )

    const ticks = annotation.ops.filter(
      (op) => op.layer === 'measurement' && op.role === 'strideTick',
    ) as EvidenceGuideOp[]
    expect(ticks.map((op) => op.position)).toEqual([300, 500])

    const caliper = only(
      annotation.ops,
      (op): op is EvidenceCaliperOp => op.kind === 'caliper',
    )
    expect(caliper.instant).toBe('pair')
    expect([caliper.x1, caliper.x2]).toEqual([300, 500])
    // Drawn at the mean of the two hip-mid heights, so it reads as the horizontal displacement
    // `strideLength.ts:181` measures and not as a diagonal.
    expect(caliper.y1).toBe(caliper.y2)
    expect(caliper.y1).toBeCloseTo(402.5, 10)
    expect(caliper.polarity).toBe(1)
    // A pair-spanning mark belongs to neither half, so it is not dimmed by the ghost multiplier.
    expect(caliper.opacity).toBe(EVIDENCE_BASE_OPACITY)
  })
})

describe('polarity', () => {
  it('flips a travel-direction caliper on a right-to-left runner', () => {
    const build = (travelDirection: EvidenceTravelDirection) =>
      planEvidenceAnnotations(
        plan({
          metric: 'footStrikePattern',
          kind: 'footStrike',
          side: 'right',
          travelDirection,
          base: instant([
            pos('right_knee', 400, 400),
            pos('right_ankle', 430, 560),
          ]),
        }),
        MAX_OUTPUT_SIDE,
      )

    const forward = byRole(
      build(1).ops,
      'ankleOffsetCaliper',
    )[0] as EvidenceCaliperOp
    const backward = byRole(
      build(-1).ops,
      'ankleOffsetCaliper',
    )[0] as EvidenceCaliperOp
    expect(forward.polarity).toBe(1)
    expect(backward.polarity).toBe(-1)
    // The GEOMETRY is screen-relative and identical either way; only the polarity flips.
    expect([backward.x1, backward.x2]).toEqual([forward.x1, forward.x2])
  })

  it('withholds polarity when the travel direction is indeterminate', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'footStrikePattern',
        kind: 'footStrike',
        side: 'right',
        travelDirection: 0,
        base: instant([
          pos('right_knee', 400, 400),
          pos('right_ankle', 430, 560),
        ]),
      }),
      MAX_OUTPUT_SIDE,
    )
    const caliper = byRole(
      annotation.ops,
      'ankleOffsetCaliper',
    )[0] as EvidenceCaliperOp
    expect(caliper.polarity).toBeNull()
  })

  it('withholds polarity when stepWidth’s hip pair is degenerate', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'stepWidth',
        kind: 'stepWidthStrike',
        side: 'left',
        base: instant(
          [
            pos('left_hip', 300, 400),
            pos('right_hip', 340, 400),
            pos('left_ankle', 290, 560),
          ],
          { outwardSign: null },
        ),
      }),
      MAX_OUTPUT_SIDE,
    )
    const caliper = byRole(
      annotation.ops,
      'ankleOffsetCaliper',
    )[0] as EvidenceCaliperOp
    expect(caliper.polarity).toBeNull()
  })

  it('draws no caliper for an opposite-foot pair, whose per-instant side is not derivable', () => {
    // `stepWidth.ts:91-93` omits `side` because the two instants are deliberately opposite feet,
    // and the plan records no per-instant side, so which ankle this instant's strike was is not
    // recoverable here. The midline and the hip segment are still per-instant truths.
    const hips: EvidenceKeypointPosition[] = [
      pos('left_hip', 300, 400),
      pos('right_hip', 340, 400),
    ]
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'stepWidth',
        kind: 'stepWidthStrike',
        base: instant(
          [...hips, pos('left_ankle', 290, 560), pos('right_ankle', 355, 545)],
          { outwardSign: { left: -1, right: 1 } },
        ),
      }),
      MAX_OUTPUT_SIDE,
    )
    expect(roles(annotation.ops)).not.toContain('ankleOffsetCaliper')
    expect(new Set(roles(annotation.ops))).toEqual(
      new Set(['hipWidthSegment', 'hipMidlinePlumb']),
    )
  })
})

describe('grafted metrics resolve annotation off the primary pass’s frames', () => {
  it('names exactly the two metrics the scale pass grafts', () => {
    expect([...GRAFTED_METRICS].sort()).toEqual([
      'stepWidthCm',
      'verticalOscillationCm',
    ])
  })

  it('withholds stepWidthCm’s caliper polarity while stepWidth keeps it on identical geometry', () => {
    const base = instant(
      [
        pos('left_hip', 300, 400),
        pos('right_hip', 340, 400),
        pos('left_ankle', 290, 560),
      ],
      { outwardSign: { left: -1, right: 1 } },
    )
    const caliperFor = (metric: 'stepWidth' | 'stepWidthCm') =>
      byRole(
        planEvidenceAnnotations(
          plan({ metric, kind: 'stepWidthStrike', side: 'left', base }),
          MAX_OUTPUT_SIDE,
        ).ops,
        'ankleOffsetCaliper',
      )[0] as EvidenceCaliperOp

    expect(caliperFor('stepWidth').polarity).toBe(1)
    expect(caliperFor('stepWidthCm').polarity).toBeNull()
    // The span itself is unchanged — it is the polarity, a semantic claim, that is withheld.
    expect(caliperFor('stepWidthCm').x1).toBe(caliperFor('stepWidth').x1)
    expect(caliperFor('stepWidthCm').x2).toBe(caliperFor('stepWidth').x2)
  })

  it('costs verticalOscillationCm nothing, because none of its marks carry a polarity', () => {
    const base = instant([pos('left_hip', 300, 400), pos('right_hip', 340, 400)])
    const cm = planEvidenceAnnotations(
      plan({ metric: 'verticalOscillationCm', kind: 'bounceCycle', base }),
      MAX_OUTPUT_SIDE,
    )
    const px = planEvidenceAnnotations(
      plan({ metric: 'verticalOscillation', kind: 'bounceCycle', base }),
      MAX_OUTPUT_SIDE,
    )
    expect(roles(cm.ops)).toEqual(roles(px.ops))
    expect(cm.ops.map((op) => op.opacity)).toEqual(px.ops.map((op) => op.opacity))
  })
})

describe('the joint layer', () => {
  it('composes the ghost multiplier with each point’s own detected/interpolated opacity', () => {
    const points: EvidenceKeypointPosition[] = [
      pos('left_hip', 300, 400),
      pos('right_hip', 340, 400, 'interpolated'),
    ]
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'verticalOscillation',
        kind: 'bounceCycle',
        base: instant(points),
        ghost: instant(points, { opacity: EVIDENCE_GHOST_OPACITY }),
      }),
      MAX_OUTPUT_SIDE,
    )

    const jointOpacity = (name: KeypointName, half: 'base' | 'ghost') =>
      annotation.ops
        .filter(isJoint)
        .find((op) => op.name === name && op.instant === half)?.opacity

    expect(jointOpacity('left_hip', 'base')).toBe(DETECTED_OPACITY)
    expect(jointOpacity('right_hip', 'base')).toBe(INTERPOLATED_OPACITY)
    expect(jointOpacity('left_hip', 'ghost')).toBe(
      DETECTED_OPACITY * EVIDENCE_GHOST_OPACITY,
    )
    expect(jointOpacity('right_hip', 'ghost')).toBe(
      INTERPOLATED_OPACITY * EVIDENCE_GHOST_OPACITY,
    )

    // An edge takes the weaker of its endpoints, then the frame multiplier — the `Math.min` rule
    // `skeletonGeometry.ts:159` already uses.
    const ghostBone = annotation.ops
      .filter(isBone)
      .find((op) => op.instant === 'ghost')
    expect(ghostBone?.opacity).toBe(INTERPOLATED_OPACITY * EVIDENCE_GHOST_OPACITY)

    // ...and so does a measurement mark built from a tolerant midpoint of the two.
    const ghostMarker = byRole(
      annotation.ops,
      'bounceMidpoint',
      'ghost',
    )[0] as EvidenceMarkerOp
    expect(ghostMarker.opacity).toBe(
      INTERPOLATED_OPACITY * EVIDENCE_GHOST_OPACITY,
    )
  })

  it('flags a single-side midpoint fallback as interpolated, exactly as resolveMidpoint does', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'verticalOscillation',
        kind: 'bounceCycle',
        base: instant([pos('left_hip', 300, 400), lost('right_hip')]),
      }),
      MAX_OUTPUT_SIDE,
    )
    const marker = byRole(annotation.ops, 'bounceMidpoint')[0] as EvidenceMarkerOp
    // Standing one side in for the bilateral average is itself an approximation
    // (`keypoints.ts:39-43`), so the mark reads as one even though the point was detected.
    expect(marker.opacity).toBe(INTERPOLATED_OPACITY)
    expect([marker.x, marker.y]).toEqual([300, 400])
  })

  it('drops an unrecoverable keypoint’s mark rather than moving it to the origin', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'kneeFlexion',
        kind: 'kneeFlexionPeak',
        side: 'left',
        base: instant([
          pos('left_hip', 300, 300),
          pos('left_knee', 300, 450),
          lost('left_ankle'),
        ]),
      }),
      MAX_OUTPUT_SIDE,
    )

    expect(annotation.ops.filter(isJoint).map((op) => op.name)).toEqual([
      'left_hip',
      'left_knee',
    ])
    expect(
      annotation.ops.filter(isBone).some((op) => op.to === 'left_ankle'),
    ).toBe(false)
    // The whole measurement set depends on the ankle, so it is absent — not anchored at (0,0).
    expect(roles(annotation.ops)).toEqual([])
    const anchored = annotation.ops
      .flatMap(opPoints)
      .filter(([x, y]) => x === 0 && y === 0)
    expect(anchored).toEqual([])
  })

  it('draws only the exemplar’s own keypoints, never the whole skeleton', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'kneeFlexion',
        kind: 'kneeFlexionPeak',
        side: 'left',
        base: instant([
          pos('left_hip', 300, 300),
          pos('left_knee', 300, 450),
          pos('left_ankle', 350, 570),
        ]),
      }),
      MAX_OUTPUT_SIDE,
    )
    expect(annotation.ops.filter(isJoint)).toHaveLength(3)
    expect(
      annotation.ops
        .filter(isJoint)
        .every((op) => op.name.startsWith('left_')),
    ).toBe(true)
  })

  it('never restates a segment the measurement layer already drew', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'kneeFlexion',
        kind: 'kneeFlexionPeak',
        side: 'left',
        base: instant([
          pos('left_hip', 300, 300),
          pos('left_knee', 300, 450),
          pos('left_ankle', 350, 570),
        ]),
      }),
      MAX_OUTPUT_SIDE,
    )
    // thigh and shank are measurement lines here, so the joint layer emits neither as a bone —
    // one segment stroked twice in two styles is one muddy layer, not two separable ones.
    expect(annotation.ops.filter(isBone)).toHaveLength(0)
    const measured = annotation.ops.filter(
      (op): op is EvidenceLineOp => op.kind === 'line' && op.from !== undefined,
    )
    expect(measured.map((op) => [op.from, op.to])).toEqual([
      ['left_hip', 'left_knee'],
      ['left_knee', 'left_ankle'],
    ])
  })

  it('still draws the torso quad for trunkLean, whose measured lines are derived midpoints', () => {
    const annotation = planEvidenceAnnotations(
      plan({ metric: 'trunkLean', kind: 'trunkLeanRange', base: instant(TORSO) }),
      MAX_OUTPUT_SIDE,
    )
    const bones = annotation.ops.filter(isBone).map((op) => [op.from, op.to])
    expect(bones).toContainEqual(['left_shoulder', 'right_shoulder'])
    expect(bones).toContainEqual(['left_hip', 'right_hip'])
    expect(bones).toContainEqual(['left_shoulder', 'left_hip'])
    expect(bones).toContainEqual(['right_shoulder', 'right_hip'])
  })
})

describe('the honesty rule', () => {
  const FIXTURES: Array<{
    kind: MetricExemplarKind
    plan: EvidenceFramePlan
  }> = [
    {
      kind: 'trunkLeanRange',
      plan: plan({
        metric: 'trunkLean',
        kind: 'trunkLeanRange',
        base: instant(TORSO),
        ghost: instant(TORSO, { opacity: EVIDENCE_GHOST_OPACITY }),
      }),
    },
    {
      kind: 'kneeFlexionPeak',
      plan: plan({
        metric: 'kneeFlexion',
        kind: 'kneeFlexionPeak',
        side: 'left',
        base: instant([
          pos('left_hip', 300, 300),
          pos('left_knee', 300, 450),
          pos('left_ankle', 350, 570),
        ]),
      }),
    },
    {
      kind: 'overstrideRange',
      plan: plan({
        metric: 'overstriding',
        kind: 'overstrideRange',
        side: 'right',
        base: instant([
          pos('left_hip', 300, 400),
          pos('right_hip', 340, 400),
          pos('right_ankle', 420, 560),
        ]),
      }),
    },
    {
      kind: 'footStrike',
      plan: plan({
        metric: 'footStrikePattern',
        kind: 'footStrike',
        side: 'right',
        base: instant([
          pos('right_knee', 400, 400),
          pos('right_ankle', 430, 560),
        ]),
      }),
    },
    {
      kind: 'stepWidthStrike',
      plan: plan({
        metric: 'stepWidth',
        kind: 'stepWidthStrike',
        side: 'left',
        base: instant(
          [
            pos('left_hip', 300, 400),
            pos('right_hip', 340, 400),
            pos('left_ankle', 290, 560),
          ],
          { outwardSign: { left: -1, right: 1 } },
        ),
      }),
    },
    {
      kind: 'armSwingCycle',
      plan: plan({
        metric: 'armSwingSymmetry',
        kind: 'armSwingCycle',
        side: 'right',
        base: instant([
          pos('right_shoulder', 350, 250),
          pos('right_elbow', 380, 330),
          pos('right_wrist', 400, 420),
        ]),
      }),
    },
    {
      kind: 'bounceCycle',
      plan: plan({
        metric: 'verticalOscillation',
        kind: 'bounceCycle',
        base: instant([pos('left_hip', 300, 400), pos('right_hip', 340, 400)]),
        ghost: instant(
          [pos('left_hip', 300, 430), pos('right_hip', 340, 430)],
          { opacity: EVIDENCE_GHOST_OPACITY },
        ),
      }),
    },
    {
      kind: 'stridePair',
      plan: plan({
        metric: 'verticalRatio',
        kind: 'stridePair',
        side: 'left',
        base: instant([pos('left_hip', 280, 400), pos('right_hip', 320, 400)]),
        ghost: instant(
          [pos('left_hip', 480, 400), pos('right_hip', 520, 400)],
          { opacity: EVIDENCE_GHOST_OPACITY },
        ),
      }),
    },
  ]

  it('covers every exemplar kind, so a new kind cannot slip past this block', () => {
    const kinds: MetricExemplarKind[] = [
      'kneeFlexionPeak',
      'overstrideRange',
      'footStrike',
      'stepWidthStrike',
      'trunkLeanRange',
      'bounceCycle',
      'armSwingCycle',
      'stridePair',
    ]
    expect(FIXTURES.map((fixture) => fixture.kind).sort()).toEqual(
      [...kinds].sort(),
    )
  })

  it('emits no numeric or textual label on any mark, for any metric', () => {
    // An allowlist rather than a "does this look like a label" pattern: design D11 rule 3 is that
    // NO mark ships with a numeric label, and the way that decays is somebody adding a field, not
    // somebody naming one `label`. Every key an op may carry is enumerated here — geometry,
    // discriminators the drawing layer styles by, and two flags that are relationships rather than
    // renderable text. Adding a field to the union fails this test until it is justified here.
    const ALLOWED_KEYS = new Set([
      // discriminators
      'kind',
      'layer',
      'instant',
      'role',
      'name',
      'orientation',
      'axis',
      // geometry
      'x',
      'y',
      'x1',
      'y1',
      'x2',
      'y2',
      'from',
      'to',
      'position',
      'radius',
      'startAngleRadians',
      'endAngleRadians',
      'opacity',
      // orientation of a directional mark, never a number to render
      'polarity',
      // `kneeFlexion`'s supplement relationship, a boolean about the CARD's value, not a label
      'reportedValueIsSupplement',
    ])
    const STRING_VALUED_KEYS = new Set([
      'kind',
      'layer',
      'instant',
      'role',
      'name',
      'from',
      'to',
      'orientation',
      'axis',
    ])

    for (const fixture of FIXTURES) {
      const annotation = planEvidenceAnnotations(fixture.plan, MAX_OUTPUT_SIDE)
      expect(annotation.ops.length).toBeGreaterThan(0)
      for (const op of annotation.ops) {
        for (const [key, value] of Object.entries(op)) {
          expect(ALLOWED_KEYS).toContain(key)
          // Nothing string-valued beyond the discriminators — a caption would have to arrive as
          // one, and there is nowhere for it to go.
          if (typeof value === 'string') expect(STRING_VALUED_KEYS).toContain(key)
        }
      }
    }
  })

  it('emits marks for every kind, so no metric silently degrades to joints-only', () => {
    for (const fixture of FIXTURES) {
      const annotation = planEvidenceAnnotations(fixture.plan, MAX_OUTPUT_SIDE)
      expect(
        annotation.ops.filter((op) => op.layer === 'measurement').length,
      ).toBeGreaterThan(0)
    }
  })

  it('flags exactly the instants at which no per-instance value was measured', () => {
    const measured = FIXTURES.map((fixture) => {
      const annotation = planEvidenceAnnotations(fixture.plan, MAX_OUTPUT_SIDE)
      return [
        fixture.kind,
        annotation.base.valueMeasuredAtInstant,
        annotation.ghost?.valueMeasuredAtInstant ?? null,
      ]
    })
    expect(measured).toEqual([
      ['trunkLeanRange', true, true],
      ['kneeFlexionPeak', true, null],
      ['overstrideRange', true, null],
      ['footStrike', true, null],
      ['stepWidthStrike', true, null],
      ['armSwingCycle', true, null],
      // A fitted amplitude has no per-instance values, so neither instant was measured.
      ['bounceCycle', false, false],
      ['stridePair', true, true],
    ])
  })

  it('cadence is unreachable and yields nothing even if a plan is forced', () => {
    const annotation = planEvidenceAnnotations(
      plan({
        metric: 'cadence',
        kind: 'bounceCycle',
        base: instant([pos('left_hip', 300, 400), pos('right_hip', 340, 400)]),
      }),
      MAX_OUTPUT_SIDE,
    )
    expect(annotation.ops).toEqual([])
  })
})

describe('against a plan built by the real planner', () => {
  it('lands every mark inside the output canvas on a 4K-scale clip', () => {
    // Native coordinates far from the origin and a crop far wider than the cap: exactly the shape
    // design D3's Revision block warns about, where treating plan positions as canvas coordinates
    // strokes every mark off the image and no existing test notices.
    const legAt = (kneeX: number, timestamp: number) =>
      buildFrame(
        {
          left_hip: { x: 1800, y: 900 },
          left_knee: { x: kneeX, y: 1300 },
          left_ankle: { x: kneeX + 120, y: 1650 },
        },
        timestamp,
      )
    const frames = [legAt(1810, 0), legAt(1900, 0.04), legAt(1980, 0.08)]
    const exemplar: MetricExemplar = {
      kind: 'kneeFlexionPeak',
      timestamp: 0,
      pairedTimestamp: 0.08,
      side: 'left',
      quality: 0.9,
      label: 'fixture',
      cropKeypoints: ['left_hip', 'left_knee', 'left_ankle'],
    }
    const tolerance = evidenceSnapToleranceSeconds(frames)
    expect(tolerance).not.toBeNull()

    const framePlan = planExemplarFrames(
      'kneeFlexion',
      exemplar,
      frames,
      { width: 3840, height: 2160 },
      tolerance as number,
      1,
    )
    expect(framePlan).not.toBeNull()
    const resolved = framePlan as EvidenceFramePlan
    expect(resolved.crop.side).toBeGreaterThan(MAX_OUTPUT_SIDE)

    const annotation = planEvidenceAnnotations(resolved, MAX_OUTPUT_SIDE)
    expect(annotation.outputSide).toBe(MAX_OUTPUT_SIDE)
    expect(annotation.ops.length).toBeGreaterThan(0)

    const coordinates = annotation.ops.flatMap(opCoordinates)
    for (const value of coordinates) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(MAX_OUTPUT_SIDE)
    }
    // ...and the naive reading would not have: the hip alone sits at native x = 1800.
    expect(Math.max(...coordinates)).toBeLessThan(1800)
  })
})

describe('module hygiene', () => {
  // Resolved off `process.cwd()`, not `import.meta.url`: under vitest's jsdom environment the
  // latter is a simulated `http://localhost` document URL, not a `file://` one.
  const source = readFileSync(
    join(process.cwd(), 'src/results/evidenceAnnotations.ts'),
    'utf8',
  )
  // Comments are stripped before scanning, same as `evidenceFrames.test.ts`: the module's doc
  // NAMES the things it must not touch, so scanning prose would make every explanation a failure.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('touches no DOM or canvas global, so it is importable outside a browser', () => {
    for (const global of [
      'document',
      'window',
      'HTMLVideoElement',
      'HTMLCanvasElement',
      'ImageBitmap',
      'createObjectURL',
      'getContext',
      'drawImage',
    ]) {
      expect(code).not.toContain(global)
    }
    // ...and the prose does mention `getContext`, so the stripper is not silently blanking it.
    expect(source).toContain('getContext')
    expect(code).toContain('toEvidenceOutputSpace')
  })

  it('routes every coordinate through the transform rather than baking one in', () => {
    // One call site, inside `MarkBuilder.toCanvas`. A second one is a place a caller could skip.
    expect(code.match(/toEvidenceOutputSpace\(/g)).toHaveLength(1)
  })
})
