import type {
  EvidenceAnnotation,
  EvidenceAnnotationOp,
  EvidenceArcOp,
  EvidenceBoneOp,
  EvidenceCaliperOp,
  EvidenceGuideOp,
  EvidenceJointOp,
  EvidenceLineOp,
  EvidenceMarkRole,
  EvidenceMarkerOp,
} from '../results/evidenceAnnotations'

/**
 * The IMPURE half of evidence annotation: take the canvas-free op list `evidenceAnnotations.ts`
 * produced and stroke it onto the extracted image.
 *
 * **This module decides no geometry.** Every coordinate, radius, angle and opacity arrives on the
 * op, already in OUTPUT-CANVAS space and already composed. What is decided here is exactly what
 * design D5 says cannot be decided anywhere else — colour, weight, dash and cap — because those are
 * legibility questions that can only be settled by looking at a rendered image, and no unit test can
 * look. If a change here starts computing a position, it belongs in `evidenceAnnotations.ts`.
 *
 * ### The `globalAlpha` trap
 *
 * `drawInstant` sets `ctx.globalAlpha = instant.opacity` (`extractFrames.ts`) and `extractFrame`
 * never resets it, so this function is handed a context sitting at the GHOST's blend value (0.5) on
 * every ghosted pair. Inheriting that would halve the BASE marks too — a silent, plausible-looking
 * defect, which is why it is a spec scenario rather than a comment. Every draw below sets
 * `globalAlpha` from its own op's already-composed opacity, and the pass brackets itself with an
 * explicit reset at both ends. The current value is never read.
 *
 * ### The two layers
 *
 * Design D5: "two layers in one colour is one layer". They are separated three ways at once, so no
 * single failure of one channel collapses them — hue (cyan joints / amber measurement), weight
 * (measurement strokes are heavier than bones), and shape vocabulary (joints are filled dots and
 * plain bones; measurement marks carry end ticks, arcs, crosses and dashes). Reference lines the
 * calculation constructed rather than observed — a plumb, a vertical reference, a thigh extension —
 * are dashed, so a construction is separable from a measured segment inside the measurement layer
 * too.
 *
 * ### Sizing
 *
 * Every weight below is a FRACTION OF THE OUTPUT CANVAS SIDE, not a pixel constant.
 * `SkeletonOverlay`'s `POINT_RADIUS_PX 6` / `STROKE_WIDTH_PX 3` were sized for a full-frame video
 * overlay and are deliberately not reused: the same 6 px dot is a bold marker on a 320 px crop and
 * a speck on a 640 px one, and these images are displayed smaller again. Fractions hold their
 * apparent size across every crop the planner produces.
 *
 * ### No labels, by construction
 *
 * Nothing here writes text onto the image, and no op carries any. That is design D11 rule 3 and the
 * spec's honesty requirement: the drawn quantity is not the card's reported value for any metric in
 * this application, so a number stroked onto the image would be a false statement about the runner.
 * Captions are the card's business. The `module hygiene` block in this module's test asserts the
 * absence by scanning this source, which is why the two text-drawing calls are not named here.
 */

/** The joint layer's hue — `SkeletonOverlay`'s colour, deliberately, so a reader who watched the
 * live overlay recognises "these are the joints the pipeline found". Only the COLOUR is shared; the
 * sizing is not (see the module note). */
export const EVIDENCE_JOINT_COLOR = '#22d3ee'

/** The measurement layer's hue. Far from the joint layer in both hue and luminance, so the two
 * separate on a greyscale print and for a reader with a red-green deficiency alike. */
export const EVIDENCE_MEASUREMENT_COLOR = '#fbbf24'

/**
 * Drawn under every mark at a wider stroke, so annotation survives a light track, a dark shirt and
 * a blown-out sky without a per-clip colour decision. Semi-transparent rather than opaque: it has to
 * read as a shadow of the mark, not as a second mark.
 */
export const EVIDENCE_ANNOTATION_HALO_COLOR = 'rgba(2, 6, 23, 0.6)'

/** Radius of a joint dot. */
export const JOINT_DOT_RADIUS_FRACTION = 0.0125
/** Stroke of a joint-layer bone — deliberately the thinnest weight in the vocabulary. */
export const JOINT_BONE_WIDTH_FRACTION = 0.0065
/** Stroke of a measured segment, caliper or arc. Heavier than a bone, so weight alone separates the
 * layers even where they overlap. */
export const MEASUREMENT_WIDTH_FRACTION = 0.0105
/** Stroke of a construction line (a guide, a vertical reference, a thigh extension). */
export const CONSTRUCTION_WIDTH_FRACTION = 0.0075
/** Half-width of the dark halo added to each side of every stroke. */
export const HALO_WIDTH_FRACTION = 0.005
/** Half-length of the perpendicular tick that caps each end of a caliper. */
export const CALIPER_CAP_FRACTION = 0.024
/** Length of the arrowhead marking a caliper's positive end, when the plan derived a polarity. */
export const ARROWHEAD_FRACTION = 0.03
/** Half-length of each arm of a derived-position cross. */
export const MARKER_ARM_FRACTION = 0.022
/** Dash and gap of a construction line. */
export const CONSTRUCTION_DASH_FRACTION: readonly [number, number] = [0.03, 0.022]

/**
 * Roles the calculation CONSTRUCTED rather than observed — a straight-up reference from the torso's
 * own origin, and the thigh's own line continued past the knee. Both are derived entirely from this
 * runner's keypoints (they are not targets — see D12.3 on why the midfoot band is absent), but
 * neither is a segment of the body, so both are dashed like the full-canvas guides they behave as.
 */
const CONSTRUCTION_ROLES: ReadonlySet<EvidenceMarkRole> = new Set([
  'verticalReference',
  'thighExtensionRay',
])

/** The resolved pixel weights for one output canvas. Exported so a test can assert the sizing scales
 * with the canvas rather than re-deriving the fractions. */
export interface EvidenceAnnotationMetrics {
  jointDotRadius: number
  jointBoneWidth: number
  measurementWidth: number
  constructionWidth: number
  haloWidth: number
  caliperCap: number
  arrowhead: number
  markerArm: number
  constructionDash: [number, number]
}

/**
 * Resolves the fractions above against one canvas side. The `Math.max` floors are not cosmetic: a
 * sub-pixel stroke renders as a barely-visible grey smear rather than a thin line, so a mark on a
 * small crop degrades to "thin" rather than to "absent".
 */
export function evidenceAnnotationMetrics(
  outputSide: number,
): EvidenceAnnotationMetrics {
  const scale = (fraction: number, floor: number): number =>
    Math.max(floor, outputSide * fraction)
  return {
    jointDotRadius: scale(JOINT_DOT_RADIUS_FRACTION, 1.5),
    jointBoneWidth: scale(JOINT_BONE_WIDTH_FRACTION, 1),
    measurementWidth: scale(MEASUREMENT_WIDTH_FRACTION, 1.25),
    constructionWidth: scale(CONSTRUCTION_WIDTH_FRACTION, 1),
    haloWidth: scale(HALO_WIDTH_FRACTION, 0.75),
    caliperCap: scale(CALIPER_CAP_FRACTION, 3),
    arrowhead: scale(ARROWHEAD_FRACTION, 4),
    markerArm: scale(MARKER_ARM_FRACTION, 3),
    constructionDash: [
      scale(CONSTRUCTION_DASH_FRACTION[0], 2),
      scale(CONSTRUCTION_DASH_FRACTION[1], 2),
    ],
  }
}

/** A path built once and stroked twice — halo underneath, colour on top — so the two passes can
 * never disagree about the geometry. */
type PathBuilder = (ctx: CanvasRenderingContext2D) => void

/**
 * The one stroking primitive. Halo first at `width + 2·haloWidth`, then the mark at `width`.
 * `globalAlpha` is SET, never read: this is where the ghost's leaked blend value is overwritten.
 */
function strokeWithHalo(
  ctx: CanvasRenderingContext2D,
  build: PathBuilder,
  color: string,
  width: number,
  haloWidth: number,
  opacity: number,
  dash: readonly number[],
): void {
  ctx.globalAlpha = opacity
  ctx.setLineDash(dash as number[])
  ctx.strokeStyle = EVIDENCE_ANNOTATION_HALO_COLOR
  ctx.lineWidth = width + haloWidth * 2
  ctx.beginPath()
  build(ctx)
  ctx.stroke()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  build(ctx)
  ctx.stroke()
}

function segment(x1: number, y1: number, x2: number, y2: number): PathBuilder {
  return (ctx) => {
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
  }
}

function measurementStyleFor(
  role: EvidenceMarkRole,
  metrics: EvidenceAnnotationMetrics,
): { width: number; dash: readonly number[] } {
  return CONSTRUCTION_ROLES.has(role)
    ? { width: metrics.constructionWidth, dash: metrics.constructionDash }
    : { width: metrics.measurementWidth, dash: [] }
}

function drawGuide(
  ctx: CanvasRenderingContext2D,
  op: EvidenceGuideOp,
  metrics: EvidenceAnnotationMetrics,
): void {
  const path: PathBuilder =
    op.orientation === 'vertical'
      ? segment(op.position, op.from, op.position, op.to)
      : segment(op.from, op.position, op.to, op.position)
  strokeWithHalo(
    ctx,
    path,
    EVIDENCE_MEASUREMENT_COLOR,
    metrics.constructionWidth,
    metrics.haloWidth,
    op.opacity,
    metrics.constructionDash,
  )
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  op: EvidenceLineOp,
  metrics: EvidenceAnnotationMetrics,
): void {
  const { width, dash } = measurementStyleFor(op.role, metrics)
  strokeWithHalo(
    ctx,
    segment(op.x1, op.y1, op.x2, op.y2),
    EVIDENCE_MEASUREMENT_COLOR,
    width,
    metrics.haloWidth,
    op.opacity,
    dash,
  )
}

/**
 * A caliper is a span with perpendicular end ticks — the shape that reads as "this distance was
 * measured" rather than as another body segment. The whole thing is one path so the halo traces the
 * ticks too.
 *
 * `polarity` adds an arrowhead at the end the calculation counts as positive (`+1` → the `(x2,y2)`
 * end). It is an ORIENTATION, not a magnitude: it says which way the offset runs, and there is no
 * number anywhere near it. `null` — an indeterminate travel direction, a degenerate hip pair, or a
 * grafted metric whose polarity was deliberately withheld — draws the span unoriented rather than
 * guessing.
 */
function drawCaliper(
  ctx: CanvasRenderingContext2D,
  op: EvidenceCaliperOp,
  metrics: EvidenceAnnotationMetrics,
): void {
  const dx = op.x2 - op.x1
  const dy = op.y2 - op.y1
  const length = Math.hypot(dx, dy)
  // A zero-length span has no direction to place ticks along; the joint layer still shows where it
  // was, and a degenerate caliper would render as a lone dot claiming to be a measurement.
  if (!(length > 0)) return
  const ux = dx / length
  const uy = dy / length
  // Perpendicular, for the end ticks.
  const px = -uy * metrics.caliperCap
  const py = ux * metrics.caliperCap

  const build: PathBuilder = (target) => {
    target.moveTo(op.x1, op.y1)
    target.lineTo(op.x2, op.y2)
    target.moveTo(op.x1 - px, op.y1 - py)
    target.lineTo(op.x1 + px, op.y1 + py)
    target.moveTo(op.x2 - px, op.y2 - py)
    target.lineTo(op.x2 + px, op.y2 + py)
    if (op.polarity !== null) {
      // The arrowhead sits at the positive end and points outward along the span.
      const tipX = op.polarity === 1 ? op.x2 : op.x1
      const tipY = op.polarity === 1 ? op.y2 : op.y1
      const backX = op.polarity === 1 ? -ux : ux
      const backY = op.polarity === 1 ? -uy : uy
      const head = Math.min(metrics.arrowhead, length)
      const spread = head * 0.45
      target.moveTo(
        tipX + backX * head - backY * spread,
        tipY + backY * head + backX * spread,
      )
      target.lineTo(tipX, tipY)
      target.lineTo(
        tipX + backX * head + backY * spread,
        tipY + backY * head - backX * spread,
      )
    }
  }

  strokeWithHalo(
    ctx,
    build,
    EVIDENCE_MEASUREMENT_COLOR,
    metrics.measurementWidth,
    metrics.haloWidth,
    op.opacity,
    [],
  )
}

/**
 * The arc the plan already normalized: `endAngleRadians − startAngleRadians` is the signed short way
 * round, so the sweep direction follows straight from its sign and this layer never re-chooses it.
 */
function drawArc(
  ctx: CanvasRenderingContext2D,
  op: EvidenceArcOp,
  metrics: EvidenceAnnotationMetrics,
): void {
  const counterclockwise = op.endAngleRadians < op.startAngleRadians
  strokeWithHalo(
    ctx,
    (target) => {
      target.arc(
        op.x,
        op.y,
        op.radius,
        op.startAngleRadians,
        op.endAngleRadians,
        counterclockwise,
      )
    },
    EVIDENCE_MEASUREMENT_COLOR,
    metrics.measurementWidth,
    metrics.haloWidth,
    op.opacity,
    [],
  )
}

/** A derived position — a bilateral midpoint the calculation formed, never a raw keypoint. Drawn as
 * a cross precisely so it cannot be mistaken for the joint layer's filled dots. */
function drawMarker(
  ctx: CanvasRenderingContext2D,
  op: EvidenceMarkerOp,
  metrics: EvidenceAnnotationMetrics,
): void {
  const arm = metrics.markerArm
  strokeWithHalo(
    ctx,
    (target) => {
      target.moveTo(op.x - arm, op.y)
      target.lineTo(op.x + arm, op.y)
      target.moveTo(op.x, op.y - arm)
      target.lineTo(op.x, op.y + arm)
    },
    EVIDENCE_MEASUREMENT_COLOR,
    metrics.measurementWidth,
    metrics.haloWidth,
    op.opacity,
    [],
  )
}

function drawBone(
  ctx: CanvasRenderingContext2D,
  op: EvidenceBoneOp,
  metrics: EvidenceAnnotationMetrics,
): void {
  strokeWithHalo(
    ctx,
    segment(op.x1, op.y1, op.x2, op.y2),
    EVIDENCE_JOINT_COLOR,
    metrics.jointBoneWidth,
    metrics.haloWidth,
    op.opacity,
    [],
  )
}

/** A filled dot with a dark ring. The ring is the halo in circular form — same reason, same weight. */
function drawJoint(
  ctx: CanvasRenderingContext2D,
  op: EvidenceJointOp,
  metrics: EvidenceAnnotationMetrics,
): void {
  ctx.globalAlpha = op.opacity
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.arc(op.x, op.y, metrics.jointDotRadius, 0, Math.PI * 2)
  ctx.fillStyle = EVIDENCE_JOINT_COLOR
  ctx.fill()
  ctx.strokeStyle = EVIDENCE_ANNOTATION_HALO_COLOR
  ctx.lineWidth = metrics.haloWidth * 2
  ctx.stroke()
}

/**
 * Painter order, and it is load-bearing rather than incidental.
 *
 * Full-canvas construction guides go down first so they never sit over a body mark, then measured
 * segments, then the oriented marks that carry the metric's meaning, then the joint layer's bones,
 * then the joint dots — the smallest marks late, so nothing buries them.
 *
 * **`marker` is last, above the joint dots, and that is deliberate.** A marker is a position the
 * CALCULATION formed — a bilateral midpoint — not a keypoint the detector found. On a side view the
 * two hips project almost on top of each other, so a hip-mid cross drawn under the joint layer is
 * covered by the very dots it must not be mistaken for. Measured live on Demo 1
 * (`verticalOscillation`, `verticalRatio`): under the joints it vanished entirely.
 */
const OP_ORDER: ReadonlyArray<EvidenceAnnotationOp['kind']> = [
  'guide',
  'line',
  'caliper',
  'arc',
  'bone',
  'joint',
  'marker',
]

/**
 * Strokes one exemplar's annotation over its already-composited image.
 *
 * The context is expected to arrive dirty — `extractFrame` leaves `globalAlpha` at the last
 * instant's blend value — so the pass opens by resetting every piece of state it depends on and
 * closes by leaving the context in that same clean state for whoever holds it next. Nothing here
 * reads a value it did not set.
 */
export function drawEvidenceAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: EvidenceAnnotation,
): void {
  if (annotation.ops.length === 0) return
  const metrics = evidenceAnnotationMetrics(annotation.outputSide)

  // The explicit reset. `globalAlpha` in particular: every op below sets its own, but leaving the
  // reset implicit would make that a property of the loop body rather than of this function.
  ctx.globalAlpha = 1
  ctx.setLineDash([])
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const kind of OP_ORDER) {
    for (const op of annotation.ops) {
      if (op.kind !== kind) continue
      switch (op.kind) {
        case 'guide':
          drawGuide(ctx, op, metrics)
          break
        case 'line':
          drawLine(ctx, op, metrics)
          break
        case 'caliper':
          drawCaliper(ctx, op, metrics)
          break
        case 'arc':
          drawArc(ctx, op, metrics)
          break
        case 'marker':
          drawMarker(ctx, op, metrics)
          break
        case 'bone':
          drawBone(ctx, op, metrics)
          break
        case 'joint':
          drawJoint(ctx, op, metrics)
          break
      }
    }
  }

  ctx.globalAlpha = 1
  ctx.setLineDash([])
}
