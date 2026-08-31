// The `module hygiene` block at the bottom reads this module's own source off disk, so it opts
// into Node's ambient types locally the same way `evidenceAnnotations.test.ts` does —
// `tsconfig.app.json`'s `types` is deliberately just `vite/client`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { KeypointName } from '../pose/types'
import type { CropRectPx } from '../pose/backends/movenetCrop'
import {
  DETECTED_OPACITY,
  INTERPOLATED_OPACITY,
} from '../results/skeletonGeometry'
import {
  EVIDENCE_BASE_OPACITY,
  EVIDENCE_GHOST_BLEND_ALPHA,
  EVIDENCE_GHOST_MARK_OPACITY,
} from '../results/evidenceFrames'
import type {
  EvidenceFramePlan,
  EvidenceInstantPlan,
  EvidenceKeypointPosition,
} from '../results/evidenceFrames'
import { planEvidenceAnnotations } from '../results/evidenceAnnotations'
import type { EvidenceAnnotation } from '../results/evidenceAnnotations'
import {
  EVIDENCE_ANNOTATION_HALO_COLOR,
  EVIDENCE_INLINE_DISPLAY_SIDE_PX,
  EVIDENCE_JOINT_COLOR,
  EVIDENCE_MEASUREMENT_COLOR,
  MIN_DASH_GAP_DISPLAY_PX,
  MIN_HALO_DISPLAY_PX,
  drawEvidenceAnnotation,
  evidenceAnnotationMetrics,
  haloOpacityFor,
} from './drawEvidenceAnnotations'

/**
 * Canvas sides the crop planner actually produced across the three test clips, measured live rather
 * than invented: the `EVIDENCE_CROP_MIN_SIDE_PX` floor at 320, the `EVIDENCE_OUTPUT_MAX_SIDE_PX` cap
 * at 640, and three intermediate crops in between. A floor stated in display pixels has to hold at
 * every one of them, not only at the cap.
 */
const OBSERVED_OUTPUT_SIDES = [320, 364, 377, 463, 640] as const

const MAX_OUTPUT_SIDE = 640
const IDENTITY_CROP: CropRectPx = { x: 0, y: 0, side: MAX_OUTPUT_SIDE }

/**
 * One painted pass — the state as it stood when `stroke()`/`fill()` was called. `globalAlpha` is
 * the field every assertion below turns on: the whole point of this layer's contract is that it
 * SETS that value rather than inheriting whatever the photographic pass left behind.
 */
interface PaintRecord {
  op: 'stroke' | 'fill'
  alpha: number
  color: string
  lineWidth: number
  dashed: boolean
}

interface RecordingContext {
  ctx: CanvasRenderingContext2D
  paints: PaintRecord[]
}

/**
 * A fake 2D context that records the paint state at each `stroke`/`fill`. jsdom ships no canvas and
 * this repo refuses the native `canvas` package (`src/test/canvasTestUtils.ts`), so a recording stub
 * is the only way to assert what this module does at all. It records STATE, not pixels — whether the
 * picture reads is a live-browser question and is answered there, not here.
 */
function recordingContext(initialAlpha: number): RecordingContext {
  const paints: PaintRecord[] = []
  const state = {
    globalAlpha: initialAlpha,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    dash: [] as number[],
  }
  const ctx = {
    get globalAlpha() {
      return state.globalAlpha
    },
    set globalAlpha(value: number) {
      state.globalAlpha = value
    },
    get strokeStyle() {
      return state.strokeStyle
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value
    },
    get fillStyle() {
      return state.fillStyle
    },
    set fillStyle(value: string) {
      state.fillStyle = value
    },
    get lineWidth() {
      return state.lineWidth
    },
    set lineWidth(value: number) {
      state.lineWidth = value
    },
    lineCap: state.lineCap,
    lineJoin: state.lineJoin,
    setLineDash: (dash: number[]) => {
      state.dash = dash
    },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    stroke: () => {
      paints.push({
        op: 'stroke',
        alpha: state.globalAlpha,
        color: state.strokeStyle,
        lineWidth: state.lineWidth,
        dashed: state.dash.length > 0,
      })
    },
    fill: () => {
      paints.push({
        op: 'fill',
        alpha: state.globalAlpha,
        color: state.fillStyle,
        lineWidth: state.lineWidth,
        dashed: state.dash.length > 0,
      })
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, paints }
}

function pos(
  name: KeypointName,
  x: number,
  y: number,
  status: 'detected' | 'interpolated' = 'detected',
): EvidenceKeypointPosition {
  return { name, status, x, y }
}

function instant(
  keypoints: EvidenceKeypointPosition[],
  opacity: number,
): EvidenceInstantPlan {
  return {
    timestamp: 0,
    opacity,
    keypoints,
    outwardSign: null,
    side: null,
  }
}

/**
 * A ghosted `trunkLeanRange` pair. The base carries one INTERPOLATED shoulder so all three of the
 * composed opacities the pure layer can produce are present in one fixture: base-detected (1.0),
 * base-interpolated (0.35) and ghost-detected (0.5). That 0.35 is `INTERPOLATED_OPACITY` and shares
 * a value with `EVIDENCE_GHOST_BLEND_ALPHA` by coincidence — the two are unrelated quantities.
 */
function ghostedPairAnnotation(): EvidenceAnnotation {
  const base = instant(
    [
      pos('left_hip', 300, 400),
      pos('right_hip', 340, 400),
      pos('left_shoulder', 300, 250),
      pos('right_shoulder', 340, 250, 'interpolated'),
    ],
    EVIDENCE_BASE_OPACITY,
  )
  const ghost = instant(
    [
      pos('left_hip', 320, 402),
      pos('right_hip', 360, 402),
      pos('left_shoulder', 330, 252),
      pos('right_shoulder', 370, 252),
    ],
    EVIDENCE_GHOST_BLEND_ALPHA,
  )
  const plan: EvidenceFramePlan = {
    metric: 'trunkLean',
    kind: 'trunkLeanRange',
    quality: 0.9,
    label: 'fixture',
    base,
    ghost,
    crop: IDENTITY_CROP,
    travelDirection: 1,
    demotedFromPair: false,
    cropGrowth: 1.4,
  }
  return planEvidenceAnnotations(plan, MAX_OUTPUT_SIDE)
}

/**
 * A `bounceCycle`, which is the only kind that emits a derived-position MARKER (the bilateral
 * midpoint the bounce signal tracks) alongside the joint layer.
 */
function bounceAnnotation(): EvidenceAnnotation {
  const keypoints = [
    pos('left_hip', 300, 400),
    pos('right_hip', 306, 401),
    pos('left_shoulder', 300, 250),
    pos('right_shoulder', 306, 251),
  ]
  return planEvidenceAnnotations(
    {
      metric: 'verticalOscillation',
      kind: 'bounceCycle',
      quality: 0.9,
      label: 'fixture',
      base: instant(keypoints, EVIDENCE_BASE_OPACITY),
      ghost: null,
      crop: IDENTITY_CROP,
      travelDirection: 1,
      demotedFromPair: false,
      cropGrowth: null,
    },
    MAX_OUTPUT_SIDE,
  )
}

function coloredPaints(paints: PaintRecord[]): PaintRecord[] {
  return paints.filter((paint) => paint.color !== EVIDENCE_ANNOTATION_HALO_COLOR)
}

function indicesWhere(
  paints: PaintRecord[],
  predicate: (paint: PaintRecord) => boolean,
): number[] {
  return paints
    .map((paint, index) => ({ paint, index }))
    .filter(({ paint }) => predicate(paint))
    .map(({ index }) => index)
}

describe('drawEvidenceAnnotation', () => {
  it('draws every op, halo pass included', () => {
    const annotation = ghostedPairAnnotation()
    const { ctx, paints } = recordingContext(1)
    drawEvidenceAnnotation(ctx, annotation)

    expect(annotation.ops.length).toBeGreaterThan(0)
    // Two paints per op: a halo underneath and the mark on top. A joint is a fill plus a ring
    // stroke, which is the same two passes in the other order.
    expect(paints).toHaveLength(annotation.ops.length * 2)
    expect(coloredPaints(paints)).toHaveLength(annotation.ops.length)
  })

  describe('the globalAlpha trap', () => {
    // `extractFrame` never resets `ctx.globalAlpha`, so on a ghosted pair this module is handed a
    // context sitting at the ghost's PHOTOGRAPHIC blend alpha — a different number from the ghost's
    // mark opacity. Inheriting it would weaken the BASE marks too.
    it('is unaffected by the alpha the context arrives carrying', () => {
      const annotation = ghostedPairAnnotation()
      const clean = recordingContext(1)
      const afterGhost = recordingContext(EVIDENCE_GHOST_BLEND_ALPHA)
      const arbitrary = recordingContext(0.17)

      drawEvidenceAnnotation(clean.ctx, annotation)
      drawEvidenceAnnotation(afterGhost.ctx, annotation)
      drawEvidenceAnnotation(arbitrary.ctx, annotation)

      expect(afterGhost.paints).toEqual(clean.paints)
      expect(arbitrary.paints).toEqual(clean.paints)
    })

    it("draws the base instant's detected marks at full opacity after a ghost", () => {
      const annotation = ghostedPairAnnotation()
      const { ctx, paints } = recordingContext(EVIDENCE_GHOST_BLEND_ALPHA)
      drawEvidenceAnnotation(ctx, annotation)

      const baseDetectedOps = annotation.ops.filter(
        (op) => op.instant === 'base' && op.opacity === DETECTED_OPACITY,
      )
      expect(baseDetectedOps.length).toBeGreaterThan(0)
      const atFullOpacity = coloredPaints(paints).filter(
        (paint) => paint.alpha === DETECTED_OPACITY,
      )
      expect(atFullOpacity).toHaveLength(baseDetectedOps.length)
      // The weakened reading this test exists to reject: had the leaked blend alpha applied, every
      // one of those marks would have painted at it and none at 1.
      expect(Math.max(...paints.map((paint) => paint.alpha))).toBe(
        DETECTED_OPACITY,
      )
    })

    it('carries the three composed opacities through unchanged', () => {
      const annotation = ghostedPairAnnotation()
      const { ctx, paints } = recordingContext(EVIDENCE_GHOST_BLEND_ALPHA)
      drawEvidenceAnnotation(ctx, annotation)

      const painted = new Set(coloredPaints(paints).map((paint) => paint.alpha))
      // base detected, ghost detected (also base interpolated × nothing), base interpolated.
      expect(painted).toContain(DETECTED_OPACITY)
      expect(painted).toContain(
        DETECTED_OPACITY * EVIDENCE_GHOST_MARK_OPACITY,
      )
      expect(painted).toContain(INTERPOLATED_OPACITY * EVIDENCE_BASE_OPACITY)
      expect([...painted].sort()).toEqual(
        [...new Set(annotation.ops.map((op) => op.opacity))].sort(),
      )
    })

    it("leaves the context reset rather than at the last mark's opacity", () => {
      const annotation = ghostedPairAnnotation()
      const { ctx } = recordingContext(EVIDENCE_GHOST_BLEND_ALPHA)
      drawEvidenceAnnotation(ctx, annotation)
      expect(ctx.globalAlpha).toBe(1)
    })

    it('resets nothing and paints nothing when there is nothing to draw', () => {
      const { ctx, paints } = recordingContext(EVIDENCE_GHOST_BLEND_ALPHA)
      drawEvidenceAnnotation(ctx, {
        metric: 'cadence',
        kind: 'bounceCycle',
        outputSide: MAX_OUTPUT_SIDE,
        base: { timestamp: 0, valueMeasuredAtInstant: false },
        ghost: null,
        ops: [],
      })
      expect(paints).toHaveLength(0)
    })
  })

  describe('the two layers are separable', () => {
    it('paints the joint layer and the measurement layer in different colours', () => {
      const annotation = ghostedPairAnnotation()
      const { ctx, paints } = recordingContext(1)
      drawEvidenceAnnotation(ctx, annotation)

      const jointOps = annotation.ops.filter((op) => op.layer === 'joint')
      const measurementOps = annotation.ops.filter(
        (op) => op.layer === 'measurement',
      )
      expect(jointOps.length).toBeGreaterThan(0)
      expect(measurementOps.length).toBeGreaterThan(0)

      const colored = coloredPaints(paints)
      expect(
        colored.filter((paint) => paint.color === EVIDENCE_JOINT_COLOR),
      ).toHaveLength(jointOps.length)
      expect(
        colored.filter((paint) => paint.color === EVIDENCE_MEASUREMENT_COLOR),
      ).toHaveLength(measurementOps.length)
      expect(EVIDENCE_JOINT_COLOR).not.toBe(EVIDENCE_MEASUREMENT_COLOR)
    })

    it('strokes measured segments heavier than joint-layer bones', () => {
      const metrics = evidenceAnnotationMetrics(MAX_OUTPUT_SIDE)
      expect(metrics.measurementWidth).toBeGreaterThan(metrics.jointBoneWidth)
    })

    it('dashes the constructed reference ray and not the measured torso segment', () => {
      const annotation = ghostedPairAnnotation()
      const { ctx, paints } = recordingContext(1)
      drawEvidenceAnnotation(ctx, annotation)

      // `trunkLean` emits exactly one `verticalReference` (constructed, dashed) and one
      // `torsoVector` (a measured segment, solid) per instant.
      const dashed = coloredPaints(paints).filter((paint) => paint.dashed)
      expect(dashed).toHaveLength(
        annotation.ops.filter(
          (op) => op.kind === 'line' && op.role === 'verticalReference',
        ).length,
      )
      expect(dashed.length).toBeGreaterThan(0)
      expect(
        dashed.every((paint) => paint.color === EVIDENCE_MEASUREMENT_COLOR),
      ).toBe(true)
    })

    it('draws the joint dots over every measured segment, so nothing buries them', () => {
      const annotation = ghostedPairAnnotation()
      const { ctx, paints } = recordingContext(1)
      drawEvidenceAnnotation(ctx, annotation)

      const jointFills = indicesWhere(paints, (paint) => paint.op === 'fill')
      const measurementPaints = indicesWhere(
        paints,
        (paint) => paint.color === EVIDENCE_MEASUREMENT_COLOR,
      )
      expect(jointFills.length).toBeGreaterThan(0)
      expect(measurementPaints.length).toBeGreaterThan(0)
      expect(Math.min(...jointFills)).toBeGreaterThan(
        Math.max(...measurementPaints),
      )
    })

    it('draws a derived-position cross over the joint dots, not under them', () => {
      // A bilateral midpoint is a position the calculation formed, not one the detector found. On a
      // side view the two hips nearly coincide, so a hip-mid cross painted under the joint layer is
      // hidden by the dots it must not be confused with — measured live on Demo 1.
      const annotation = bounceAnnotation()
      const { ctx, paints } = recordingContext(1)
      drawEvidenceAnnotation(ctx, annotation)

      const markerOps = annotation.ops.filter((op) => op.kind === 'marker')
      expect(markerOps.length).toBeGreaterThan(0)
      const jointFills = indicesWhere(paints, (paint) => paint.op === 'fill')
      expect(jointFills.length).toBeGreaterThan(0)
      // Markers are the only measurement marks painted after the joint layer, so the last
      // measurement-coloured paints are exactly them.
      const measurementPaints = indicesWhere(
        paints,
        (paint) => paint.color === EVIDENCE_MEASUREMENT_COLOR,
      )
      expect(Math.max(...measurementPaints)).toBeGreaterThan(
        Math.max(...jointFills),
      )
    })
  })

  describe('sizing is against the output canvas, not a pixel constant', () => {
    it('halves every weight when the canvas halves', () => {
      const large = evidenceAnnotationMetrics(640)
      const small = evidenceAnnotationMetrics(320)
      expect(small.jointDotRadius).toBeCloseTo(large.jointDotRadius / 2, 6)
      expect(small.measurementWidth).toBeCloseTo(large.measurementWidth / 2, 6)
      expect(small.jointBoneWidth).toBeCloseTo(large.jointBoneWidth / 2, 6)
      expect(small.caliperCap).toBeCloseTo(large.caliperCap / 2, 6)
    })

    it('floors every weight above zero on a degenerate canvas', () => {
      const metrics = evidenceAnnotationMetrics(1)
      for (const value of [
        metrics.jointDotRadius,
        metrics.jointBoneWidth,
        metrics.measurementWidth,
        metrics.constructionWidth,
        metrics.haloWidth,
        metrics.caliperCap,
        metrics.arrowhead,
        metrics.markerArm,
        ...metrics.constructionDash,
      ]) {
        expect(value).toBeGreaterThan(0)
      }
    })

    it('reads the size off the annotation, not off a module constant', () => {
      const annotation = ghostedPairAnnotation()
      const wide = recordingContext(1)
      drawEvidenceAnnotation(wide.ctx, annotation)
      const narrow = recordingContext(1)
      drawEvidenceAnnotation(narrow.ctx, {
        ...annotation,
        outputSide: annotation.outputSide / 2,
      })
      expect(Math.max(...narrow.paints.map((paint) => paint.lineWidth))).toBeLessThan(
        Math.max(...wide.paints.map((paint) => paint.lineWidth)),
      )
    })
  })

  /**
   * The defect these cover is invisible to every assertion above, because every assertion above is
   * in CANVAS pixels and the failure is a canvas-correct weight that the compositor averages out of
   * the delivered image. At the shipped fractions the halo resolved to 0.72 display px and a
   * construction line's visible dash gap to 0.65 — both under one pixel of what the reader is
   * served (`strides-dt1`, `strides-60w`).
   */
  describe('legibility floors are stated in display pixels', () => {
    const displayPxOn = (outputSide: number): number =>
      outputSide / EVIDENCE_INLINE_DISPLAY_SIDE_PX
    /** The floors are reached by dividing back out exactly what was multiplied in, so a canvas side
     * that is not a clean multiple of the display side lands a few ulps under. The tolerance is for
     * that and nothing else — it is far below one part in a million of a display pixel. */
    const EPS = 1e-9

    it('keeps the halo at least the display-pixel floor on every canvas the planner produces', () => {
      for (const side of OBSERVED_OUTPUT_SIDES) {
        const metrics = evidenceAnnotationMetrics(side)
        expect(metrics.haloWidth / displayPxOn(side)).toBeGreaterThanOrEqual(
          MIN_HALO_DISPLAY_PX - EPS,
        )
      }
    })

    it('leaves a visible dash gap after the halo has extended every dash', () => {
      // A dashed construction is one path stroked twice, so the halo pass draws the same dashes at
      // `constructionWidth + 2·haloWidth` with round caps — which grow each dash by half that width
      // at BOTH ends. The gap the reader sees is what is left over, and it is that quantity, not
      // the dash pattern handed to the canvas, that has to clear the floor.
      for (const side of OBSERVED_OUTPUT_SIDES) {
        const metrics = evidenceAnnotationMetrics(side)
        const haloStroke = metrics.constructionWidth + metrics.haloWidth * 2
        const visibleGap = metrics.constructionDash[1] - haloStroke
        expect(visibleGap / displayPxOn(side)).toBeGreaterThanOrEqual(
          MIN_DASH_GAP_DISPLAY_PX - EPS,
        )
      }
    })

    it('still halves the halo and the dash pattern when the canvas halves', () => {
      // The display floors are themselves proportional to the canvas side, so adding them must not
      // cost the proportional sizing the fractions exist to provide.
      const large = evidenceAnnotationMetrics(640)
      const small = evidenceAnnotationMetrics(320)
      expect(small.haloWidth).toBeCloseTo(large.haloWidth / 2, 6)
      expect(small.constructionDash[0]).toBeCloseTo(
        large.constructionDash[0] / 2,
        6,
      )
      expect(small.constructionDash[1]).toBeCloseTo(
        large.constructionDash[1] / 2,
        6,
      )
    })

    it('relaxes the floors for a surface larger than the card thumbnail', () => {
      // The floors answer one surface's smallness. A bigger surface must fall back to the canvas
      // fractions rather than inherit a width only a 144 px box ever needed.
      const inline = evidenceAnnotationMetrics(640)
      const large = evidenceAnnotationMetrics(640, 640)
      expect(large.haloWidth).toBeLessThan(inline.haloWidth)
      expect(large.constructionDash[1]).toBeLessThan(inline.constructionDash[1])
    })

    it('floors the halo in canvas pixels too, so a degenerate canvas still gets one', () => {
      // `displaySide` larger than the canvas makes the display floor vanish; the canvas floor is
      // what is left, and it must still be positive.
      const metrics = evidenceAnnotationMetrics(1, 10_000)
      expect(metrics.haloWidth).toBeGreaterThan(0)
      expect(metrics.constructionDash[1]).toBeGreaterThan(0)
    })
  })

  /**
   * The halo answers "can this mark be told apart from an unknown photograph", which is a different
   * question from "how far should this mark be trusted". Only the second is the mark's opacity.
   */
  describe('the halo carries separability, not emphasis', () => {
    it('draws every halo before any mark colour', () => {
      // Interleaved, op N+1's halo lands on top of op N's colour — survivable at a hairline, not at
      // a width the reader can see, where neighbouring marks bury each other.
      const { ctx, paints } = recordingContext(EVIDENCE_GHOST_BLEND_ALPHA)
      drawEvidenceAnnotation(ctx, ghostedPairAnnotation())

      const haloIndices = indicesWhere(
        paints,
        (paint) => paint.color === EVIDENCE_ANNOTATION_HALO_COLOR,
      )
      const colorIndices = indicesWhere(
        paints,
        (paint) => paint.color !== EVIDENCE_ANNOTATION_HALO_COLOR,
      )
      expect(haloIndices.length).toBeGreaterThan(0)
      expect(colorIndices.length).toBeGreaterThan(0)
      expect(Math.max(...haloIndices)).toBeLessThan(Math.min(...colorIndices))
    })

    it('gives a ghost mark the same halo strength as a base mark', () => {
      const annotation = ghostedPairAnnotation()
      const { ctx, paints } = recordingContext(EVIDENCE_GHOST_BLEND_ALPHA)
      drawEvidenceAnnotation(ctx, annotation)

      const haloAlphas = new Set(
        paints
          .filter((paint) => paint.color === EVIDENCE_ANNOTATION_HALO_COLOR)
          .map((paint) => paint.alpha),
      )
      // The marks themselves still differ — that is the emphasis the ghost split exists to create.
      const markAlphas = new Set(coloredPaints(paints).map((paint) => paint.alpha))
      expect(markAlphas.size).toBeGreaterThan(1)
      expect([...haloAlphas]).toEqual([haloOpacityFor(DETECTED_OPACITY)])
    })

    it('never draws a halo stronger than a full-opacity mark gets', () => {
      for (const opacity of [
        INTERPOLATED_OPACITY * EVIDENCE_GHOST_MARK_OPACITY,
        EVIDENCE_GHOST_MARK_OPACITY,
        INTERPOLATED_OPACITY,
        DETECTED_OPACITY,
      ]) {
        expect(haloOpacityFor(opacity)).toBeGreaterThanOrEqual(opacity)
        expect(haloOpacityFor(opacity)).toBeLessThanOrEqual(
          haloOpacityFor(DETECTED_OPACITY),
        )
      }
    })
  })

  describe('module hygiene', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/video/drawEvidenceAnnotations.ts'),
      'utf8',
    )

    it('writes no text onto the image', () => {
      // The honesty rule, enforced structurally: no op carries a label and this layer must not
      // invent one. A number stroked here would be a claim the calculation never made.
      expect(source).not.toContain('fillText')
      expect(source).not.toContain('strokeText')
    })

    it('introduces no serialization or download path', () => {
      expect(source).not.toContain('toDataURL')
      expect(source).not.toContain('toBlob')
      expect(source).not.toContain('createObjectURL')
      expect(source).not.toContain('download')
    })

    it('computes no geometry from a metric id', () => {
      // Styling reads `layer` and `role`; deriving a position or a mark from the metric would put
      // geometry back in the impure half, which is exactly what design D3 forbids.
      expect(source).not.toContain('annotation.metric')
      expect(source).not.toContain('op.metric')
    })
  })
})
