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
 * never resets it, so this function is handed a context sitting at the ghost's PHOTOGRAPHIC blend
 * alpha (`EVIDENCE_GHOST_BLEND_ALPHA`) on every ghosted pair — which is neither the ghost's mark
 * opacity nor a half. Inheriting it would scale the BASE marks by it too — a silent,
 * plausible-looking defect, which is why it is a spec scenario rather than a comment. Every draw below sets
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
 * ### Why a fraction is not enough, and where the display size enters
 *
 * A fraction of the canvas is also a fraction of the BOX the canvas is drawn into, so it fixes
 * apparent size — but it fixes it at whatever the fraction was worth when it was chosen, and these
 * fractions were chosen by judging images at full canvas resolution. Resolved against the size a
 * reader actually sees they are all small and one of them is sub-pixel: at
 * `EVIDENCE_INLINE_DISPLAY_SIDE_PX` the halo is 0.72 display px, thinner than every mark it exists
 * to protect. A sub-pixel halo does not survive the compositor's downscale — its dark contribution
 * is averaged into the mark on one side and the photograph on the other, so the boundary it is
 * supposed to create is not in the delivered image at all. That is a rendering-SCALE failure, not a
 * colour one, and it is why the floors below are stated in DISPLAY pixels: a canvas-pixel floor
 * scales with the canvas and therefore cannot see it (`strides-dt1`, `strides-60w`).
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
 *
 * This is the ONLY mechanism in the vocabulary that can answer a bright background, and the reason
 * is arithmetic rather than taste. `EVIDENCE_MEASUREMENT_COLOR` has a relative luminance of 0.5790,
 * so it reaches 3:1 only against a background darker than 0.1597; against the 0.50-luminance path
 * measured under Demo 2's `stepWidth` it is 1.14:1. No amber, at any width or any opacity, reaches
 * 3:1 there, because none of those knobs changes the colour. `EVIDENCE_JOINT_COLOR` sits at 0.5310
 * and has the identical ceiling, so this one edge is what carries both layers.
 *
 * What does reach it is the dark edge this colour puts between the mark and the photograph —
 * composited at the 0.6 alpha below, 3.0:1 to 4.6:1 over those same backgrounds — which is also what
 * WCAG 1.4.11 means by an "adjacent colour". So the halo has to be present in the DELIVERED pixels,
 * not merely in the canvas: see the module note on display size.
 */
export const EVIDENCE_ANNOTATION_HALO_COLOR = 'rgba(2, 6, 23, 0.6)'

/**
 * The CSS side the metric card renders one of these thumbnails at — `MetricsPanel`'s `w-36`, 144 px
 * nominal. Every display-pixel floor below resolves against it.
 *
 * It is a default rather than a parameter because there is exactly one surface: the extractor caps
 * its canvas at `EVIDENCE_OUTPUT_MAX_SIDE_PX` and the card draws that one canvas at one width, so
 * threading a size through `extractFrames` would add a channel with a single possible value. It is
 * still an ARGUMENT, so the floors relax on their own if a second, larger surface ever appears — a
 * mark that is comfortably above the floor at 400 px must not be inflated to the size a 144 px box
 * needs.
 */
export const EVIDENCE_INLINE_DISPLAY_SIDE_PX = 144

/**
 * The narrowest the halo may render, in DISPLAY pixels, on each side of a mark.
 *
 * 1.5 rather than 1.0 because the downscale's phase is not controllable: a 1.0 px halo landing
 * across a destination-pixel boundary contributes half its darkness to each of two pixels and neither
 * one reads as a boundary. At 1.5 the worst phase still leaves one destination pixel at least
 * three-quarters halo. The value itself was then CHOSEN by measurement rather than by that argument:
 * a 1.0 / 1.5 / 2.0 sweep across all three test clips, read on the rendered thumbnails at the real
 * inline size, puts 1.5 at a peak rather than on a ramp — 2.0 clears no further cell and starts
 * consuming the marks it protects, taking Demo 1's `overstriding` below the floor. That sweep is the
 * change's design.md D4.
 */
export const MIN_HALO_DISPLAY_PX = 1.5

/**
 * The floor the halo pass applies to a mark's own opacity.
 *
 * A mark's opacity says how much a reader should TRUST it — a ghost instant's marks are drawn weaker
 * than the base's, an interpolated joint weaker than a detected one — and the halo is not part of
 * that statement. Its job is to keep the mark separable from an unknown photograph, which does not
 * become less necessary as the mark becomes fainter; it becomes more necessary, because a faint mark
 * has less of its own contrast to spend. Scaling the halo by the mark's opacity inverted that: a
 * ghost's detected mark carried a halo at 0.6 x 0.5 = 0.30 effective alpha and a ghost's
 * interpolated mark at 0.105, so exactly the marks that most needed an edge had almost none
 * (`strides-60w`).
 *
 * At its shipped value of 1 this floor binds on every mark, so in practice the halo is drawn at one
 * strength throughout. It is written as a floor rather than as that constant because the floor is
 * the actual rule — a halo must never render STRONGER than a full-opacity mark's does — and stating
 * it that way keeps the invariant true, and testable, if the value is ever lowered. Either way the
 * emphasis ordering the ghost/base split exists to create is carried by the mark's own colour, not
 * by its edge.
 */
export const MIN_HALO_MARK_OPACITY = 1

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
/** Dash and gap of a construction line. The gap is a starting point rather than the final value —
 * see `MIN_DASH_GAP_DISPLAY_PX` for what widens it. */
export const CONSTRUCTION_DASH_FRACTION: readonly [number, number] = [0.03, 0.022]

/**
 * The narrowest a construction line's dash gap may render, in DISPLAY pixels, measured on the gap a
 * reader actually sees rather than on the dash pattern handed to the canvas.
 *
 * The two are not the same number, and the difference is the halo. A dashed construction is one path
 * stroked twice, so the halo pass draws the SAME dashes at `constructionWidth + 2·haloWidth` with
 * round caps — which extend every dash by half that width at each end. The gap a reader sees is
 * therefore `gap − (constructionWidth + 2·haloWidth)`, not `gap`, and once the halo is wide enough
 * to survive the downscale that quantity goes NEGATIVE: the halo closes over the gaps and renders as
 * one continuous dark bar with amber dashes inside it, retiring the cue that separates a construction
 * from a measured segment.
 *
 * It was already failing before the halo widened, in the same sub-pixel way and for the same reason
 * the halo itself was: at the shipped fractions the visible gap resolves to **0.65 display px** on
 * every canvas size the planner produces, which the compositor averages away exactly as it averaged
 * away a 0.72 px halo. So this floor is not compensation for the halo — it is the same defect,
 * found in the same place, and fixed by the same rule (`strides-dt1`).
 *
 * 1.5 for the reason `MIN_HALO_DISPLAY_PX` is 1.5: the downscale's phase is not controllable, and at
 * 1.0 a gap straddling a destination-pixel boundary lightens two pixels by half each instead of
 * clearing one.
 */
export const MIN_DASH_GAP_DISPLAY_PX = 1.5

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
 *
 * Those floors are in CANVAS pixels and answer a small canvas. Two weights need the OTHER kind of
 * floor — `MIN_HALO_DISPLAY_PX` and `MIN_DASH_GAP_DISPLAY_PX`, both in DISPLAY pixels — because
 * their failure is the same one at the other end of the pipeline: not a stroke too thin for the
 * canvas it is drawn on, but a stroke too thin for the box that canvas is drawn INTO. Every floor is
 * a `Math.max` against `outputSide * fraction`, so the proportional sizing above still holds; the
 * display floors are proportional to `outputSide` too (`outputSide / displaySide`), which is why
 * halving the canvas still halves every weight.
 */
export function evidenceAnnotationMetrics(
  outputSide: number,
  displaySide: number = EVIDENCE_INLINE_DISPLAY_SIDE_PX,
): EvidenceAnnotationMetrics {
  const scale = (fraction: number, floor: number): number =>
    Math.max(floor, outputSide * fraction)
  /** One display pixel, expressed in this canvas's own pixels. */
  const displayPx = displaySide > 0 ? outputSide / displaySide : 0
  const constructionWidth = scale(CONSTRUCTION_WIDTH_FRACTION, 1)
  const haloWidth = Math.max(
    scale(HALO_WIDTH_FRACTION, 0.75),
    MIN_HALO_DISPLAY_PX * displayPx,
  )
  return {
    jointDotRadius: scale(JOINT_DOT_RADIUS_FRACTION, 1.5),
    jointBoneWidth: scale(JOINT_BONE_WIDTH_FRACTION, 1),
    measurementWidth: scale(MEASUREMENT_WIDTH_FRACTION, 1.25),
    constructionWidth,
    haloWidth,
    caliperCap: scale(CALIPER_CAP_FRACTION, 3),
    arrowhead: scale(ARROWHEAD_FRACTION, 4),
    markerArm: scale(MARKER_ARM_FRACTION, 3),
    constructionDash: [
      scale(CONSTRUCTION_DASH_FRACTION[0], 2),
      // The gap the canvas is told, so that the gap the reader SEES clears the floor once the halo's
      // round caps have grown each dash by half the halo stroke at both ends.
      Math.max(
        scale(CONSTRUCTION_DASH_FRACTION[1], 2),
        constructionWidth + haloWidth * 2 + MIN_DASH_GAP_DISPLAY_PX * displayPx,
      ),
    ],
  }
}

/** A path built once and stroked twice — halo underneath, colour on top — so the two passes can
 * never disagree about the geometry. */
type PathBuilder = (ctx: CanvasRenderingContext2D) => void

/**
 * Which of the two whole-annotation passes is running. See `drawEvidenceAnnotation`: every op is
 * visited once per pass, rather than each op laying down its own halo and colour together.
 */
type AnnotationPass = 'halo' | 'mark'

const PASSES: readonly AnnotationPass[] = ['halo', 'mark']

/**
 * The alpha the halo pass runs at for a mark drawn at `opacity`. See `MIN_HALO_MARK_OPACITY`: the
 * halo carries separability, not emphasis, so it is floored rather than scaled — but never raised
 * above what a full-opacity mark's halo gets, so no mark's edge is stronger than the strongest
 * mark's.
 */
export function haloOpacityFor(opacity: number): number {
  return Math.max(opacity, MIN_HALO_MARK_OPACITY)
}

/**
 * The one stroking primitive. Called twice for the same op — once in each pass — and the pass
 * decides colour, width and alpha; the PATH is identical either way, so the halo can never sit
 * anywhere but exactly under its own mark.
 *
 * `globalAlpha` is SET, never read: this is where the ghost's leaked blend value is overwritten.
 * The two passes set it to different things because they answer different questions —
 * `haloOpacityFor(opacity)` for separability, `opacity` for how far to trust the mark.
 */
function strokeMark(
  ctx: CanvasRenderingContext2D,
  pass: AnnotationPass,
  build: PathBuilder,
  color: string,
  width: number,
  haloWidth: number,
  opacity: number,
  dash: readonly number[],
): void {
  ctx.setLineDash(dash as number[])
  if (pass === 'halo') {
    ctx.globalAlpha = haloOpacityFor(opacity)
    ctx.strokeStyle = EVIDENCE_ANNOTATION_HALO_COLOR
    ctx.lineWidth = width + haloWidth * 2
  } else {
    ctx.globalAlpha = opacity
    ctx.strokeStyle = color
    ctx.lineWidth = width
  }
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
  pass: AnnotationPass,
  op: EvidenceGuideOp,
  metrics: EvidenceAnnotationMetrics,
): void {
  const path: PathBuilder =
    op.orientation === 'vertical'
      ? segment(op.position, op.from, op.position, op.to)
      : segment(op.from, op.position, op.to, op.position)
  strokeMark(
    ctx,
    pass,
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
  pass: AnnotationPass,
  op: EvidenceLineOp,
  metrics: EvidenceAnnotationMetrics,
): void {
  const { width, dash } = measurementStyleFor(op.role, metrics)
  strokeMark(
    ctx,
    pass,
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
  pass: AnnotationPass,
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

  strokeMark(
    ctx,
    pass,
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
  pass: AnnotationPass,
  op: EvidenceArcOp,
  metrics: EvidenceAnnotationMetrics,
): void {
  const counterclockwise = op.endAngleRadians < op.startAngleRadians
  strokeMark(
    ctx,
    pass,
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
  pass: AnnotationPass,
  op: EvidenceMarkerOp,
  metrics: EvidenceAnnotationMetrics,
): void {
  const arm = metrics.markerArm
  strokeMark(
    ctx,
    pass,
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
  pass: AnnotationPass,
  op: EvidenceBoneOp,
  metrics: EvidenceAnnotationMetrics,
): void {
  strokeMark(
    ctx,
    pass,
    segment(op.x1, op.y1, op.x2, op.y2),
    EVIDENCE_JOINT_COLOR,
    metrics.jointBoneWidth,
    metrics.haloWidth,
    op.opacity,
    [],
  )
}

/**
 * A filled dot with a dark ring. The ring is the halo in circular form — same reason, same weight,
 * and the same floored opacity, so a ghost's joint keeps an edge to be found by.
 *
 * The ring sits OUTSIDE the dot: centred on `jointDotRadius + haloWidth / 2` at `haloWidth`, which
 * puts exactly `haloWidth` of halo beyond the rim, the way `strokeMark` puts exactly `haloWidth`
 * beyond each side of a stroke. It was previously centred ON the rim at twice the width, which
 * spent half the halo INSIDE the dot — invisible at the old sub-pixel width, and at a width that
 * survives the downscale it would have eaten the dot instead of outlining it.
 *
 * The ring belongs to the halo pass and the dot to the mark pass, so a joint's own ring can never
 * cover a measurement mark that the painter order puts underneath it.
 */
function drawJoint(
  ctx: CanvasRenderingContext2D,
  pass: AnnotationPass,
  op: EvidenceJointOp,
  metrics: EvidenceAnnotationMetrics,
): void {
  ctx.setLineDash([])
  if (pass === 'halo') {
    ctx.globalAlpha = haloOpacityFor(op.opacity)
    ctx.strokeStyle = EVIDENCE_ANNOTATION_HALO_COLOR
    ctx.lineWidth = metrics.haloWidth
    ctx.beginPath()
    ctx.arc(
      op.x,
      op.y,
      metrics.jointDotRadius + metrics.haloWidth / 2,
      0,
      Math.PI * 2,
    )
    ctx.stroke()
    return
  }
  ctx.globalAlpha = op.opacity
  ctx.fillStyle = EVIDENCE_JOINT_COLOR
  ctx.beginPath()
  ctx.arc(op.x, op.y, metrics.jointDotRadius, 0, Math.PI * 2)
  ctx.fill()
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
 *
 * ### Why every halo goes down before any colour
 *
 * The whole annotation is traversed TWICE — every halo in painter order, then every mark in the same
 * painter order — rather than each op laying its own halo and colour down together.
 *
 * Interleaved, a halo is drawn after the previous op's colour, so op N+1's halo paints OVER op N's
 * mark. That was survivable while the halo was a hairline. It is not survivable at a width that
 * reaches the reader: the marks of one exemplar are neighbours by construction — a torso vector, the
 * vertical reference beside it, and the joint dots at both ends of both — and at that width each
 * one's halo is wide enough to bury the one before it. Measured on the multiperson clip's
 * `trunkLean`, where the subject is smallest relative to its crop: interleaved, the amber
 * measurement layer was almost entirely covered by the halos of the marks drawn after it, leaving an
 * image that carried joints and no visible measurement — the exact collapse the two-layer
 * requirement exists to prevent.
 *
 * Separating the passes makes that structurally impossible: no mark's halo can ever cover another
 * mark's colour, because every halo is already down before the first colour is laid. Painter order
 * within each pass is unchanged, so the ordering decisions above still hold.
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

  for (const pass of PASSES) {
    for (const kind of OP_ORDER) {
      for (const op of annotation.ops) {
        if (op.kind !== kind) continue
        switch (op.kind) {
          case 'guide':
            drawGuide(ctx, pass, op, metrics)
            break
          case 'line':
            drawLine(ctx, pass, op, metrics)
            break
          case 'caliper':
            drawCaliper(ctx, pass, op, metrics)
            break
          case 'arc':
            drawArc(ctx, pass, op, metrics)
            break
          case 'marker':
            drawMarker(ctx, pass, op, metrics)
            break
          case 'bone':
            drawBone(ctx, pass, op, metrics)
            break
          case 'joint':
            drawJoint(ctx, pass, op, metrics)
            break
        }
      }
    }
  }

  ctx.globalAlpha = 1
  ctx.setLineDash([])
}
