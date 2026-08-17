import type { KeypointName } from '../pose/types'
import type { MetricExemplarKind, MetricId } from '../heuristics/types'
import type { CropRectPx } from '../pose/backends/movenetCrop'
import {
  DETECTED_OPACITY,
  INTERPOLATED_OPACITY,
  SKELETON_EDGES,
} from './skeletonGeometry'
import {
  EVIDENCE_BASE_OPACITY,
  EVIDENCE_GHOST_OPACITY,
  evidenceOutputSide,
  toEvidenceOutputSpace,
} from './evidenceFrames'
import type {
  EvidenceFramePlan,
  EvidenceInstantPlan,
  EvidenceKeypointPosition,
  EvidenceTravelDirection,
} from './evidenceFrames'

/**
 * The PURE per-metric annotation-geometry layer: one `EvidenceFramePlan` in, a canvas-free
 * description of what to draw out. Nothing here strokes anything — `extractFrames.ts` consumes
 * this and issues the draw calls.
 *
 * **Zero DOM, zero canvas, deliberately**, on exactly the terms `evidenceFrames.ts` states:
 * jsdom's `getContext('2d')` returns `null` and this repo refuses the `canvas` npm package
 * (`src/test/canvasTestUtils.ts`), so geometry decided inside a draw call is geometry no unit
 * test can reach. Every position, orientation and extent below is asserted by
 * `evidenceAnnotations.test.ts`; the only untested step downstream is the sequence of strokes.
 *
 * **Coordinates are OUTPUT-CANVAS coordinates.** `EvidenceFramePlan` carries positions in NATIVE
 * VIDEO pixels — the space `crop` is in. Every op below has been through
 * `toEvidenceOutputSpace(point, crop, outputSide)`. Taking the plan's positions as canvas
 * coordinates is the trap design D3's Revision block names: on a 4K clip with `crop.side = 1200`
 * capped to a 640 px canvas, a hip at native `x = 1900` strokes clean off a 640-wide image, and
 * the result is a silently unannotated but otherwise correct-looking thumbnail.
 *
 * **No op in this module's union carries a numeric or textual label, by construction** — there is
 * no field for one. That is design D11 rule 3 expressed in the type system rather than in review:
 * the drawn quantity is not the card's reported value for any metric in this application (design
 * D2's table, every row verified), so a mark that restated the card's number would be a false
 * statement about the runner. Marks depict what was measured at the depicted instant; captions
 * are the card's business and `EvidenceAnnotation.instants` carries the one fact a caption needs
 * that it cannot see from the geometry — whether a per-instance value was measured at that
 * instant at all.
 */

/**
 * Metrics whose exemplars arrive by GRAFT from the background MediaPipe scale pass, while the only
 * `RobustPoseFrame[]` any consumer holds is the PRIMARY pass's (`scalePassGraft.ts:43-50`;
 * `EvidenceGallery` hands `planClipEvidence` `clip.analysis.robustFrames`, MoveNet's). Their joint
 * positions AND their hip polarity are therefore resolved off a primary-pass frame snapped within
 * tolerance — never the MediaPipe frame the metric actually measured.
 *
 * **Decision (a): no signed or oriented mark for a grafted metric.** The positions are still
 * honest — they are the primary detector's own estimate of the same body at the same instant, and
 * they land on the image the extractor draws — but a POLARITY is a semantic claim, and at a
 * near-frontal step-width strike the two hips sit a few pixels apart, which is precisely where the
 * two detectors' orderings become a coin flip. A caliper carrying the inverse polarity would label
 * a crossover strike as landing on its own side, contradicting `stepWidth.ts:273-277`'s crossover
 * caveat in the same viewport. Option (c) — accept it — has no argument available: the mechanism is
 * confirmed and the failure lands exactly where the metric lives. Option (b) — joints only — pays
 * for that with `verticalOscillationCm`, whose marks carry no polarity at all and which is the one
 * grafted metric measured as reaching the gallery on all three test clips.
 *
 * Concretely this suppresses `stepWidthCm`'s caliper POLARITY (the caliper still draws, as the
 * unsigned lateral span it honestly is) and costs `verticalOscillationCm` nothing. It is written
 * as a set rather than inlined so a future grafted metric is covered without a second reading of
 * `scalePassGraft.ts`.
 */
export const GRAFTED_METRICS: ReadonlySet<MetricId> = new Set([
  'verticalOscillationCm',
  'stepWidthCm',
])

/**
 * Radius of an angle arc, as a fraction of the shorter of its two rays. Geometry, so it lives
 * here; stroke weights and mark radii are NOT here, because design D5 requires them sized against
 * the output canvas and verified by looking at the result, which is `strides-ac9.8`'s job.
 */
export const ANNOTATION_ARC_RADIUS_FRACTION = 0.3

/** Which of a ghosted pair's two frames a mark belongs to. `'pair'` is a mark that spans both and
 * belongs to neither — `stridePair`'s caliper between the two hip-midline ticks is the only one. */
export type EvidenceAnnotationInstant = 'base' | 'ghost' | 'pair'

/**
 * `'joint'` is "these are the joints the pipeline found"; `'measurement'` is "this is the thing
 * that was measured". Design D5: two layers in one colour is one layer, so the distinction has to
 * reach the drawing layer as data rather than as a convention.
 */
export type EvidenceAnnotationLayer = 'joint' | 'measurement'

/**
 * What a measurement mark MEANS, in the terms of the calculation that formed it. The drawing layer
 * styles by role; it never re-derives what a mark is from the metric id.
 */
export type EvidenceMarkRole =
  /** hip-mid → shoulder-mid. `trunkLean.ts:164-165` measures exactly this vector. */
  | 'torsoVector'
  /** Straight up from the torso vector's own origin — the `-dy` in `atan2(dx, -dy)`. */
  | 'verticalReference'
  /** The angle `atan2(dx, -dy)` spans, at hip-mid. SCREEN-relative: `trunkLean.ts:171-173`
   * multiplies it by `travelDirection`, so on a right-to-left runner this arc opens the opposite
   * way from the sign the card reports. */
  | 'trunkLeanArc'
  | 'thigh'
  | 'shank'
  /** hip→knee continued past the knee — where the thigh's own line goes if the leg straightens.
   * Derived entirely from this runner's two keypoints; it is a construction line, not a target. */
  | 'thighExtensionRay'
  /** The INTERIOR angle at the knee, between knee→hip and knee→ankle. The card reports
   * `180 − interiorAngle` (`kneeFlexion.ts:198`), so this arc is the SUPPLEMENT of the reported
   * quantity — carried on the op as `reportedValueIsSupplement`. */
  | 'kneeInteriorArc'
  /** Vertical line at hip-mid x. `overstriding.ts:174` and `stepWidth.ts:220` both measure from
   * it; drawn PER FRAME, so a ghosted pair carries two. */
  | 'hipMidlinePlumb'
  /** Vertical line at the knee's x — `footStrikePattern.ts:191` measures the ankle against it. */
  | 'kneePlumb'
  /** left_hip → right_hip. `stepWidth`'s normalizer is a clip-MEDIAN hip width
   * (`stepWidth.ts:224`, `bodyScale.ts:56-68`); this segment is THIS frame's, which is why it is
   * drawn and why no quotient is labelled on it. */
  | 'hipWidthSegment'
  /** Vertical line at one stride endpoint's hip-mid x (`strideLength.ts:178-182`). */
  | 'strideTick'
  /** Horizontal line through the shoulder — the origin `armSwingSymmetry.ts:117` measures the
   * wrist against. */
  | 'shoulderHorizontal'
  /** Horizontal line at the bounce signal's midpoint y. */
  | 'bounceHorizontal'
  | 'upperArm'
  | 'forearm'
  /** The bilateral midpoint the bounce signal tracks (hip-mid, or ear-mid under the non-default
   * `verticalOscillationSignal: 'earMid'`). */
  | 'bounceMidpoint'
  /** hip-mid at one stride endpoint. */
  | 'hipMidMarker'
  /** Horizontal span from a plumb/midline to the ankle — the raw pixel NUMERATOR of
   * `overstriding`, `footStrikePattern` and `stepWidth`. Their denominators are clip medians and
   * exist in no single frame, which is why nothing is labelled. */
  | 'ankleOffsetCaliper'
  /** Vertical span `wrist.y − shoulder.y` (`armSwingSymmetry.ts:117`). */
  | 'armSwingCaliper'
  /** Horizontal span between the two stride ticks. */
  | 'strideCaliper'

interface AnnotationOpBase {
  layer: EvidenceAnnotationLayer
  instant: EvidenceAnnotationInstant
  /** The point's own detected/interpolated weight, already multiplied by the frame-level
   * base/ghost multiplier. See `frameOpacityFor`. */
  opacity: number
}

/** One detected or interpolated keypoint the exemplar itself named. */
export interface EvidenceJointOp extends AnnotationOpBase {
  kind: 'joint'
  layer: 'joint'
  name: KeypointName
  x: number
  y: number
}

/** A `SKELETON_EDGES` edge both of whose endpoints the exemplar named and both of which resolved.
 * Never an edge the measurement layer already draws — the same segment stroked twice in two
 * styles is one muddy layer, not two separable ones. */
export interface EvidenceBoneOp extends AnnotationOpBase {
  kind: 'bone'
  layer: 'joint'
  from: KeypointName
  to: KeypointName
  x1: number
  y1: number
  x2: number
  y2: number
}

/** A derived position the calculation formed — a bilateral midpoint, never a raw keypoint. */
export interface EvidenceMarkerOp extends AnnotationOpBase {
  kind: 'marker'
  layer: 'measurement'
  role: EvidenceMarkRole
  x: number
  y: number
}

/** A finite measured segment. `from`/`to` are present only when both endpoints are named
 * keypoints, so the joint layer can skip the duplicate edge. */
export interface EvidenceLineOp extends AnnotationOpBase {
  kind: 'line'
  layer: 'measurement'
  role: EvidenceMarkRole
  x1: number
  y1: number
  x2: number
  y2: number
  from?: KeypointName
  to?: KeypointName
}

/** An axis-aligned reference line spanning the whole output canvas. `position` is x for a
 * vertical guide and y for a horizontal one. */
export interface EvidenceGuideOp extends AnnotationOpBase {
  kind: 'guide'
  layer: 'measurement'
  role: EvidenceMarkRole
  orientation: 'vertical' | 'horizontal'
  position: number
  from: number
  to: number
}

/**
 * A measured span between a reference and a body point.
 *
 * `polarity` is `+1` when the drawn span runs the way the calculation counts as positive, `-1`
 * when it runs the other way, and `null` when the polarity is not derivable (`travelDirection`
 * indeterminate, `outwardSign` degenerate) or is deliberately withheld (a grafted metric, see
 * `GRAFTED_METRICS`). It is NOT a number to render — it is the orientation a directional mark's
 * arrowhead or tick needs, and `null` means "draw this unoriented" rather than "guess".
 */
export interface EvidenceCaliperOp extends AnnotationOpBase {
  kind: 'caliper'
  layer: 'measurement'
  role: EvidenceMarkRole
  axis: 'horizontal' | 'vertical'
  x1: number
  y1: number
  x2: number
  y2: number
  polarity: 1 | -1 | null
}

/**
 * An angle arc at a vertex. `startAngleRadians` → `endAngleRadians` in canvas convention (x right,
 * y DOWN, so straight up is `-π/2`), already normalized so the signed sweep `end − start` lies in
 * `(−π, π]` and the drawing layer can stroke it directly without choosing a direction.
 *
 * `reportedValueIsSupplement` is `kneeFlexion`'s supplement relationship made explicit rather than
 * left in a comment: the arc spans the interior angle and the card reports `180 − interiorAngle`.
 */
export interface EvidenceArcOp extends AnnotationOpBase {
  kind: 'arc'
  layer: 'measurement'
  role: EvidenceMarkRole
  x: number
  y: number
  radius: number
  startAngleRadians: number
  endAngleRadians: number
  reportedValueIsSupplement: boolean
}

export type EvidenceAnnotationOp =
  | EvidenceJointOp
  | EvidenceBoneOp
  | EvidenceMarkerOp
  | EvidenceLineOp
  | EvidenceGuideOp
  | EvidenceCaliperOp
  | EvidenceArcOp

/** Per-instant facts a caption needs and the geometry cannot show. */
export interface EvidenceInstantAnnotation {
  timestamp: number
  /**
   * Whether the metric took a per-instance measurement at THIS instant.
   *
   * `false` for `kneeFlexion`'s extension trough, which `kneeFlexion.ts:104-108` scores with the
   * `value` field absent precisely because "the trough is not itself a measurement… A caption must
   * not imply the trough was measured" (`:74-77`); and `false` for BOTH instants of a
   * `bounceCycle`, whose exemplar carries no `value` either because "a fitted amplitude has no
   * per-instance values" (`bounceInstants.ts:193-200`). The spec's "a legibility-only instant is
   * not captioned as measured" is unenforceable downstream without this flag.
   */
  valueMeasuredAtInstant: boolean
}

export interface EvidenceAnnotation {
  metric: MetricId
  kind: MetricExemplarKind
  /** The square canvas side these coordinates are in, `evidenceOutputSide(crop.side, max)`. */
  outputSide: number
  base: EvidenceInstantAnnotation
  ghost: EvidenceInstantAnnotation | null
  ops: EvidenceAnnotationOp[]
}

const HIP_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_hip',
  right: 'right_hip',
}
const KNEE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_knee',
  right: 'right_knee',
}
const ANKLE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_ankle',
  right: 'right_ankle',
}
const SHOULDER_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_shoulder',
  right: 'right_shoulder',
}
const ELBOW_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_elbow',
  right: 'right_elbow',
}
const WRIST_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_wrist',
  right: 'right_wrist',
}

/**
 * The bilateral pairs a `bounceCycle` seed can be, in the order
 * `verticalOscillation.ts`'s `SIGNAL_KEYPOINTS` offers them. Matched by NAME against the
 * exemplar's own keypoint list rather than read off its first two entries: an exemplar's crop set
 * is `[...seed, ...resolvable context]` (`exemplars.ts:240-245`), and a positional read would
 * silently pick a context keypoint the day a seed changes. Ears and hips never co-occur in a
 * bounce crop set — the seed is one or the other and the context is shoulders and knees
 * (`bounceInstants.ts:56-61`) — so the first match is unambiguous.
 */
const BOUNCE_SIGNAL_PAIRS: ReadonlyArray<[KeypointName, KeypointName]> = [
  ['left_hip', 'right_hip'],
  ['left_ear', 'right_ear'],
]

/** A position resolved for annotation: canvas-space coordinates plus the weight its
 * detected/interpolated status earns it. */
interface ResolvedMarkPoint {
  x: number
  y: number
  opacity: number
}

function opacityForStatus(
  status: EvidenceKeypointPosition['status'],
): number | null {
  switch (status) {
    case 'detected':
      return DETECTED_OPACITY
    case 'interpolated':
      return INTERPOLATED_OPACITY
    case 'unrecoverable':
      return null
  }
}

/**
 * The frame-level multiplier every mark on that frame is scaled by: `EVIDENCE_BASE_OPACITY` for
 * the base, `EVIDENCE_GHOST_OPACITY` for the ghost, and the base's value for a `'pair'` mark,
 * which belongs to neither half.
 *
 * This is the DELIBERATE composition design D5 requires (base skeleton at 1.0, ghost at 0.5,
 * composed with each point's own detected/interpolated opacity) — not the accidental one the spec
 * forbids. Those are different mechanisms: `extractFrames.ts:326` leaves `ctx.globalAlpha` at the
 * ghost's blend value and never resets it, so annotation drawn afterwards inherits 0.5 for the
 * BASE marks too, silently halving the whole layer. `strides-ac9.8` resets `globalAlpha`
 * explicitly and applies the number below; the base's marks then come out as solid as a single
 * frame's, which is what the spec sentence is protecting.
 */
function frameOpacityFor(instant: EvidenceAnnotationInstant): number {
  return instant === 'ghost' ? EVIDENCE_GHOST_OPACITY : EVIDENCE_BASE_OPACITY
}

type PositionIndex = ReadonlyMap<KeypointName, EvidenceKeypointPosition>

function positionIndex(instant: EvidenceInstantPlan): PositionIndex {
  return new Map(instant.keypoints.map((kp) => [kp.name, kp]))
}

/**
 * Normalizes a signed angle difference into `(−π, π]`, so an arc's stored sweep is always the
 * short way round. Without it a 10° trunk lean either side of vertical can serialize as a 350°
 * arc, which strokes as a near-complete circle.
 */
function normalizeSignedAngle(radians: number): number {
  const twoPi = Math.PI * 2
  let value = radians % twoPi
  if (value <= -Math.PI) value += twoPi
  if (value > Math.PI) value -= twoPi
  return value
}

/**
 * Builds the ops for one plan. Everything is emitted in OUTPUT-CANVAS coordinates: the emitters
 * below take native-video positions and push them through `toEvidenceOutputSpace`, so no caller
 * can forget the transform and no op can be half-converted.
 */
class MarkBuilder {
  readonly ops: EvidenceAnnotationOp[] = []
  /** `"a|b"` for every keypoint-to-keypoint segment the MEASUREMENT layer drew, so the joint
   * layer can skip the duplicate bone. */
  private readonly measuredEdges = new Set<string>()
  private readonly crop: CropRectPx
  private readonly outputSide: number
  private readonly instant: EvidenceAnnotationInstant

  // Explicit fields rather than constructor parameter properties: `tsconfig`'s
  // `erasableSyntaxOnly` rejects the shorthand.
  constructor(
    crop: CropRectPx,
    outputSide: number,
    instant: EvidenceAnnotationInstant,
  ) {
    this.crop = crop
    this.outputSide = outputSide
    this.instant = instant
  }

  private get frameOpacity(): number {
    return frameOpacityFor(this.instant)
  }

  private toCanvas(point: { x: number; y: number }): { x: number; y: number } {
    return toEvidenceOutputSpace(point, this.crop, this.outputSide)
  }

  /** A named keypoint of this instant, in canvas space. `null` when the exemplar never named it,
   * or named it and the robustness layer could not recover it — an `'unrecoverable'` keypoint
   * drops its mark, and the type carries no coordinates for it to be anchored at the origin
   * with. */
  point(index: PositionIndex, name: KeypointName): ResolvedMarkPoint | null {
    const entry = index.get(name)
    if (entry === undefined || entry.status === 'unrecoverable') return null
    const opacity = opacityForStatus(entry.status)
    if (opacity === null) return null
    const { x, y } = this.toCanvas(entry)
    return { x, y, opacity }
  }

  /**
   * The TOLERANT bilateral midpoint — `keypoints.ts:45-63`'s `resolveMidpoint`, reproduced in this
   * module's own coordinate space, including the part that matters for annotation: a single-side
   * fallback is flagged interpolated regardless of that point's own status, so a hip-mid standing
   * in for a missing side reads as the approximation it is. `trunkLean`, `overstriding`,
   * `strideLength` and the bounce signal all use this one.
   */
  tolerantMidpoint(
    index: PositionIndex,
    left: KeypointName,
    right: KeypointName,
  ): ResolvedMarkPoint | null {
    const a = this.point(index, left)
    const b = this.point(index, right)
    if (a !== null && b !== null) {
      return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        opacity: Math.min(a.opacity, b.opacity),
      }
    }
    const single = a ?? b
    if (single === null) return null
    return { x: single.x, y: single.y, opacity: INTERPOLATED_OPACITY }
  }

  /**
   * The STRICT bilateral midpoint — `keypoints.ts:72-84`'s `resolveBilateralPair`. `stepWidth`
   * uses this one and not the tolerant version, because the left/right separation IS its measured
   * signal: a hip-mid collapsed onto one side makes `sideHip.x − hipMid.x` identically zero and
   * the polarity meaningless (`stepWidth.ts:148-160`). Drawing its midline through a tolerant
   * midpoint would put the line somewhere the metric never measured from.
   */
  strictMidpoint(
    index: PositionIndex,
    left: KeypointName,
    right: KeypointName,
  ): ResolvedMarkPoint | null {
    const a = this.point(index, left)
    const b = this.point(index, right)
    if (a === null || b === null) return null
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      opacity: Math.min(a.opacity, b.opacity),
    }
  }

  marker(role: EvidenceMarkRole, at: ResolvedMarkPoint): void {
    this.ops.push({
      kind: 'marker',
      layer: 'measurement',
      instant: this.instant,
      role,
      x: at.x,
      y: at.y,
      opacity: at.opacity * this.frameOpacity,
    })
  }

  line(
    role: EvidenceMarkRole,
    a: ResolvedMarkPoint,
    b: ResolvedMarkPoint,
    names?: [KeypointName, KeypointName],
  ): void {
    if (names !== undefined) this.measuredEdges.add(edgeKey(names[0], names[1]))
    this.ops.push({
      kind: 'line',
      layer: 'measurement',
      instant: this.instant,
      role,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      ...(names === undefined ? {} : { from: names[0], to: names[1] }),
      opacity: Math.min(a.opacity, b.opacity) * this.frameOpacity,
    })
  }

  /** A reference line spanning the whole canvas, anchored on a resolved point's own x or y. */
  guide(
    role: EvidenceMarkRole,
    orientation: 'vertical' | 'horizontal',
    anchor: ResolvedMarkPoint,
  ): void {
    this.ops.push({
      kind: 'guide',
      layer: 'measurement',
      instant: this.instant,
      role,
      orientation,
      position: orientation === 'vertical' ? anchor.x : anchor.y,
      from: 0,
      to: this.outputSide,
      opacity: anchor.opacity * this.frameOpacity,
    })
  }

  caliper(
    role: EvidenceMarkRole,
    axis: 'horizontal' | 'vertical',
    a: ResolvedMarkPoint,
    b: ResolvedMarkPoint,
    polarity: 1 | -1 | null,
  ): void {
    this.ops.push({
      kind: 'caliper',
      layer: 'measurement',
      instant: this.instant,
      role,
      axis,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      polarity,
      opacity: Math.min(a.opacity, b.opacity) * this.frameOpacity,
    })
  }

  /** An arc at `vertex`, from the direction of `fromRay` round to the direction of `toRay`. */
  arc(
    role: EvidenceMarkRole,
    vertex: ResolvedMarkPoint,
    fromRay: { x: number; y: number },
    toRay: { x: number; y: number },
    reportedValueIsSupplement: boolean,
  ): void {
    const start = Math.atan2(fromRay.y - vertex.y, fromRay.x - vertex.x)
    const end = Math.atan2(toRay.y - vertex.y, toRay.x - vertex.x)
    const fromLength = Math.hypot(fromRay.x - vertex.x, fromRay.y - vertex.y)
    const toLength = Math.hypot(toRay.x - vertex.x, toRay.y - vertex.y)
    const radius =
      Math.min(fromLength, toLength) * ANNOTATION_ARC_RADIUS_FRACTION
    if (!(radius > 0)) return
    this.ops.push({
      kind: 'arc',
      layer: 'measurement',
      instant: this.instant,
      role,
      x: vertex.x,
      y: vertex.y,
      radius,
      startAngleRadians: start,
      endAngleRadians: start + normalizeSignedAngle(end - start),
      reportedValueIsSupplement,
      opacity: vertex.opacity * this.frameOpacity,
    })
  }

  /**
   * The joint layer. Only the exemplar's OWN keypoints — never all 22 `SKELETON_EDGES`, which on a
   * `kneeFlexion` crop would be a whole skeleton with nearly all of it outside the frame (design
   * D5 reason 2). An edge draws only when the exemplar named both endpoints AND both resolved,
   * carries `Math.min` of their opacities, and is skipped entirely when the measurement layer
   * already drew that exact segment.
   */
  joints(index: PositionIndex): void {
    for (const entry of index.values()) {
      const at = this.point(index, entry.name)
      if (at === null) continue
      this.ops.push({
        kind: 'joint',
        layer: 'joint',
        instant: this.instant,
        name: entry.name,
        x: at.x,
        y: at.y,
        opacity: at.opacity * this.frameOpacity,
      })
    }

    for (const [from, to] of SKELETON_EDGES) {
      if (!index.has(from) || !index.has(to)) continue
      if (this.measuredEdges.has(edgeKey(from, to))) continue
      const a = this.point(index, from)
      const b = this.point(index, to)
      if (a === null || b === null) continue
      this.ops.push({
        kind: 'bone',
        layer: 'joint',
        instant: this.instant,
        from,
        to,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        opacity: Math.min(a.opacity, b.opacity) * this.frameOpacity,
      })
    }
  }
}

function edgeKey(a: KeypointName, b: KeypointName): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * The polarity of a horizontal span, in the terms of a calculation that multiplies its raw
 * `dx` by a direction. `null` where the direction is unknown (`travelDirection` is `0` below a
 * half-torso net displacement, and `outwardSign` is `null` on a degenerate hip pair) or where the
 * span itself is degenerate — never a guess. `direction: null` is how a grafted metric's mark asks
 * for no polarity at all.
 */
function horizontalPolarity(
  fromX: number,
  toX: number,
  direction: EvidenceTravelDirection | null,
): 1 | -1 | null {
  if (direction === null || direction === 0) return null
  const sign = Math.sign(toX - fromX)
  if (sign === 0) return null
  return (sign * direction) as 1 | -1
}

/** A point at an arbitrary canvas position that inherits another point's certainty — used for the
 * reference end of a plumb or caliper, which is a construction, not an observation. */
function derived(at: ResolvedMarkPoint, x: number, y: number): ResolvedMarkPoint {
  return { x, y, opacity: at.opacity }
}

interface InstantContext {
  builder: MarkBuilder
  index: PositionIndex
  plan: EvidenceFramePlan
  role: 'base' | 'ghost'
  instant: EvidenceInstantPlan
  travelDirection: EvidenceTravelDirection
  /**
   * `false` for a grafted metric — see `GRAFTED_METRICS`. One flag rather than a per-builder
   * reminder: the two directional sources (`plan.travelDirection` and
   * `EvidenceInstantPlan.outwardSign`) are both resolved from the same wrong pass's frames, so
   * they are suppressed together or not at all.
   */
  polarityAllowed: boolean
}

/** The direction a polarity is read from, or `0`/`null` when there is none to read. */
function polaritySource(
  ctx: InstantContext,
  direction: EvidenceTravelDirection | null,
): EvidenceTravelDirection | null {
  return ctx.polarityAllowed ? direction : null
}

function buildTrunkLeanMarks(ctx: InstantContext): void {
  const { builder, index } = ctx
  const hipMid = builder.tolerantMidpoint(index, 'left_hip', 'right_hip')
  const shoulderMid = builder.tolerantMidpoint(
    index,
    'left_shoulder',
    'right_shoulder',
  )
  if (hipMid === null || shoulderMid === null) return

  builder.line('torsoVector', hipMid, shoulderMid)
  const torsoLength = Math.hypot(
    shoulderMid.x - hipMid.x,
    shoulderMid.y - hipMid.y,
  )
  if (!(torsoLength > 0)) return
  // Canvas y grows downward, so "up" is −y — the same `-dy` `trunkLean.ts:170` feeds atan2. The
  // reference ray is given the torso's own length so the arc has two rays of equal reach.
  const up = derived(hipMid, hipMid.x, hipMid.y - torsoLength)
  builder.line('verticalReference', hipMid, up)
  builder.arc('trunkLeanArc', hipMid, up, shoulderMid, false)
}

function buildKneeFlexionMarks(ctx: InstantContext): void {
  const { builder, index, plan, role } = ctx
  const side = plan.side
  if (side === undefined) return
  const hip = builder.point(index, HIP_NAME[side])
  const knee = builder.point(index, KNEE_NAME[side])
  const ankle = builder.point(index, ANKLE_NAME[side])
  if (hip === null || knee === null || ankle === null) return

  builder.line('thigh', hip, knee, [HIP_NAME[side], KNEE_NAME[side]])
  builder.line('shank', knee, ankle, [KNEE_NAME[side], ANKLE_NAME[side]])

  // The ghost is the extension trough: `kneeFlexion.ts:74-77` says outright that it "is not itself
  // a measurement — it is what makes the flexion angle legible". It gets the chain, so the reader
  // can see a straight leg to read the bent one against, and NOT the arc — an angle arc is the
  // strongest "this was measured here" mark in the vocabulary, and no angle was taken at it.
  if (role === 'ghost') return

  const thighLength = Math.hypot(knee.x - hip.x, knee.y - hip.y)
  const shankLength = Math.hypot(ankle.x - knee.x, ankle.y - knee.y)
  if (thighLength > 0) {
    const extension = derived(
      knee,
      knee.x + ((knee.x - hip.x) / thighLength) * shankLength,
      knee.y + ((knee.y - hip.y) / thighLength) * shankLength,
    )
    builder.line('thighExtensionRay', knee, extension)
  }
  // The INTERIOR angle, knee→hip round to knee→ankle. `kneeFlexion.ts:198` reports
  // `180 − angleBetweenVectorsDeg(knee, hip, ankle)`, so this arc is that value's supplement —
  // recorded on the op rather than left for a reader to notice.
  builder.arc('kneeInteriorArc', knee, hip, ankle, true)
}

function buildOverstrideMarks(ctx: InstantContext): void {
  const { builder, index, instant } = ctx
  const hipMid = builder.tolerantMidpoint(index, 'left_hip', 'right_hip')
  if (hipMid === null) return
  builder.guide('hipMidlinePlumb', 'vertical', hipMid)

  // The instant's OWN foot, not the frame-level `plan.side`. `overstriding.ts` omits `side`
  // whenever its two strikes are different feet — the usual case, since the pair is the
  // furthest-reaching strike against the closest-landing one and nothing constrains them to one
  // foot — so reading `plan.side` here dropped the caliper on the majority path. The per-instant
  // side is stated by the metric and resolved in the plan (`resolveInstantSide`); `null` still
  // means no caliper, because a caliper drawn to the other foot's ankle would be a measurement
  // that was never taken.
  const side = instant.side
  if (side === null) return
  const ankle = builder.point(index, ANKLE_NAME[side])
  if (ankle === null) return
  const foot = derived(ankle, hipMid.x, ankle.y)
  builder.caliper(
    'ankleOffsetCaliper',
    'horizontal',
    foot,
    ankle,
    horizontalPolarity(hipMid.x, ankle.x, polaritySource(ctx, ctx.travelDirection)),
  )
}

function buildFootStrikeMarks(ctx: InstantContext): void {
  const { builder, index, plan } = ctx
  const side = plan.side
  if (side === undefined) return
  const knee = builder.point(index, KNEE_NAME[side])
  const ankle = builder.point(index, ANKLE_NAME[side])
  if (knee === null) return
  builder.guide('kneePlumb', 'vertical', knee)
  if (ankle === null) return

  builder.line('shank', knee, ankle, [KNEE_NAME[side], ANKLE_NAME[side]])
  // Deliberately NOT a shank-versus-vertical arc: `footStrikePattern.ts:191-193` measures a
  // HORIZONTAL offset, not an angle, and an arc would depict a quantity the metric never formed.
  builder.caliper(
    'ankleOffsetCaliper',
    'horizontal',
    derived(ankle, knee.x, ankle.y),
    ankle,
    horizontalPolarity(knee.x, ankle.x, polaritySource(ctx, ctx.travelDirection)),
  )
}

function buildStepWidthMarks(ctx: InstantContext): void {
  const { builder, index, instant } = ctx
  const left = builder.point(index, 'left_hip')
  const right = builder.point(index, 'right_hip')
  const hipMid = builder.strictMidpoint(index, 'left_hip', 'right_hip')
  if (left === null || right === null || hipMid === null) return

  // THIS frame's hip width. `stepWidth.ts:224` divides by `estimateHipWidth`'s CLIP-MEDIAN
  // `hipWidthPx` (`bodyScale.ts:56-68`), not by this segment — so the segment is drawn as the
  // per-instant geometry it is and no quotient is labelled on it. A drawable-looking denominator
  // that is not the denominator used is worse than an invisible one, because it invites the
  // reader to check the arithmetic and get a different answer (design D2).
  builder.line('hipWidthSegment', left, right, ['left_hip', 'right_hip'])
  builder.guide('hipMidlinePlumb', 'vertical', hipMid)

  // The instant's OWN foot, for the same reason as `overstriding`: `stepWidth.ts` omits the
  // frame-level `side` on the pair because "the two instants are deliberately opposite feet, so
  // naming one would be wrong about the other" — and that pair is this metric's common case. Each
  // instant names its own foot, so both halves of the ghost get their caliper, each measured from
  // the ankle its own strike was measured from.
  const side = instant.side
  if (side === null) return
  const ankle = builder.point(index, ANKLE_NAME[side])
  if (ankle === null) return
  // `stepWidth`'s polarity is `outwardSign`, per-INSTANT (`stepWidth.ts:222-223`), never the
  // clip-wide `travelDirection` — that solves a different, fore-aft problem. `null` outwardSign is
  // the degenerate hip pair the metric records and hard-rejects (`:230`).
  builder.caliper(
    'ankleOffsetCaliper',
    'horizontal',
    derived(ankle, hipMid.x, ankle.y),
    ankle,
    horizontalPolarity(
      hipMid.x,
      ankle.x,
      polaritySource(ctx, instant.outwardSign?.[side] ?? null),
    ),
  )
}

function buildArmSwingMarks(ctx: InstantContext): void {
  const { builder, index, plan } = ctx
  const side = plan.side
  if (side === undefined) return
  const shoulder = builder.point(index, SHOULDER_NAME[side])
  const elbow = builder.point(index, ELBOW_NAME[side])
  const wrist = builder.point(index, WRIST_NAME[side])
  if (shoulder === null) return

  builder.guide('shoulderHorizontal', 'horizontal', shoulder)
  // Chained through the elbow or not at all — a shoulder-to-wrist line with the elbow missing
  // would draw an arm segment that does not exist.
  if (elbow !== null) {
    builder.line('upperArm', shoulder, elbow, [
      SHOULDER_NAME[side],
      ELBOW_NAME[side],
    ])
    if (wrist !== null) {
      builder.line('forearm', elbow, wrist, [ELBOW_NAME[side], WRIST_NAME[side]])
    }
  }
  if (wrist === null) return
  // `wrist.y − shoulder.y` — `armSwingSymmetry.ts:117`'s per-side series, the drawable half. The
  // card's value is `min/max` of two per-side MEDIANS (`:264-271`), a ratio BETWEEN the two
  // images, so it belongs to neither and no polarity convention applies to one bar.
  builder.caliper(
    'armSwingCaliper',
    'vertical',
    derived(wrist, wrist.x, shoulder.y),
    wrist,
    null,
  )
}

function buildBounceMarks(ctx: InstantContext): void {
  const { builder, index } = ctx
  const pair = BOUNCE_SIGNAL_PAIRS.find(
    ([left, right]) => index.has(left) && index.has(right),
  )
  if (pair === undefined) return
  const mid = builder.tolerantMidpoint(index, pair[0], pair[1])
  if (mid === null) return
  builder.marker('bounceMidpoint', mid)
  // A horizontal at each instant's midpoint-y, and deliberately no caliper between the two. The
  // gap between the two lines is a two-sample pixel difference that still contains the whole-body
  // translation the fit subtracts as `c + d·t + e·t²`; the reported amplitude is a whole-clip
  // least-squares spectral fit (design D2). A caliper spanning that gap would read as the
  // amplitude, which is exactly the equation the honesty rule forbids.
  builder.guide('bounceHorizontal', 'horizontal', mid)
}

function buildStrideInstantMarks(ctx: InstantContext): void {
  const { builder, index } = ctx
  const hipMid = builder.tolerantMidpoint(index, 'left_hip', 'right_hip')
  if (hipMid === null) return
  builder.marker('hipMidMarker', hipMid)
  builder.guide('strideTick', 'vertical', hipMid)
}

const INSTANT_MARK_BUILDERS: Record<
  MetricExemplarKind,
  (ctx: InstantContext) => void
> = {
  trunkLeanRange: buildTrunkLeanMarks,
  kneeFlexionPeak: buildKneeFlexionMarks,
  overstrideRange: buildOverstrideMarks,
  footStrike: buildFootStrikeMarks,
  stepWidthStrike: buildStepWidthMarks,
  armSwingCycle: buildArmSwingMarks,
  bounceCycle: buildBounceMarks,
  stridePair: buildStrideInstantMarks,
}

/**
 * Whether the metric took a per-instance measurement at each instant of an exemplar of this kind.
 * Sourced from the metric modules, not from what looks measured:
 *
 * - `bounceCycle` scores on `detectionFactor` alone and carries no `value` on EITHER instant,
 *   "precisely because a fitted amplitude has no per-instance values" (`bounceInstants.ts:193-200`).
 * - `kneeFlexionPeak`'s ghost is the extension trough, scored with `value` absent
 *   (`kneeFlexion.ts:104-108`) and documented as not a measurement (`:74-77`).
 * - Every other kind measures at both instants: the two trunk-lean extremes, the two footstrikes
 *   of an overstride range, the two opposite-foot plants, the two wrist extrema, the two strikes
 *   bounding a stride.
 */
function measuredAtInstant(
  kind: MetricExemplarKind,
  role: 'base' | 'ghost',
): boolean {
  if (kind === 'bounceCycle') return false
  if (kind === 'kneeFlexionPeak' && role === 'ghost') return false
  return true
}

/**
 * One `EvidenceFramePlan` → everything to draw over its extracted image, in that image's own
 * coordinate space.
 *
 * `maxOutputSidePx` is the extractor's cap (`EVIDENCE_OUTPUT_MAX_SIDE_PX`, 640 by default, and
 * overridable per call), passed in rather than imported so this module stays free of the impure
 * one. Pass the same number the extraction used, or every mark lands at the wrong scale.
 */
export function planEvidenceAnnotations(
  plan: EvidenceFramePlan,
  maxOutputSidePx: number,
): EvidenceAnnotation {
  const outputSide = evidenceOutputSide(plan.crop.side, maxOutputSidePx)
  const base: EvidenceInstantAnnotation = {
    timestamp: plan.base.timestamp,
    valueMeasuredAtInstant: measuredAtInstant(plan.kind, 'base'),
  }
  const ghost: EvidenceInstantAnnotation | null =
    plan.ghost === null
      ? null
      : {
          timestamp: plan.ghost.timestamp,
          valueMeasuredAtInstant: measuredAtInstant(plan.kind, 'ghost'),
        }
  const annotation: EvidenceAnnotation = {
    metric: plan.metric,
    kind: plan.kind,
    outputSide,
    base,
    ghost,
    ops: [],
  }

  // `cadence` emits no exemplars (`cadence.ts`) and is refused again at planning
  // (`METRICS_WITHOUT_EVIDENCE`, `evidenceFrames.ts`), so no plan for it can exist. This is not a
  // third guard the spec relies on — it relies on exactly those two, independently — it is a
  // statement that a rate has no still depiction, kept next to the code that would otherwise have
  // to invent one.
  if (plan.metric === 'cadence') return annotation

  // Decision (a): a grafted metric's positions come from the PRIMARY detector's frames while its
  // value came from the scale pass's, so no polarity derived from those positions is trustworthy.
  // One flag, checked once, rather than each mark builder remembering.
  const polarityAllowed = !GRAFTED_METRICS.has(plan.metric)

  const buildInstant = INSTANT_MARK_BUILDERS[plan.kind]
  const halves: Array<['base' | 'ghost', EvidenceInstantPlan]> =
    plan.ghost === null
      ? [['base', plan.base]]
      : [
          ['base', plan.base],
          ['ghost', plan.ghost],
        ]

  for (const [role, instant] of halves) {
    const builder = new MarkBuilder(plan.crop, outputSide, role)
    const index = positionIndex(instant)
    // Measurement first, joints second: the joint layer skips any bone the measurement layer
    // already drew as a named segment, and it can only know that once the measurement marks exist.
    buildInstant({
      builder,
      index,
      plan,
      role,
      instant,
      travelDirection: plan.travelDirection,
      polarityAllowed,
    })
    builder.joints(index)
    annotation.ops.push(...builder.ops)
  }

  // The one mark that belongs to the pair rather than to either half.
  if (plan.kind === 'stridePair' && plan.ghost !== null) {
    const pairBuilder = new MarkBuilder(plan.crop, outputSide, 'pair')
    const a = pairBuilder.tolerantMidpoint(
      positionIndex(plan.base),
      'left_hip',
      'right_hip',
    )
    const b = pairBuilder.tolerantMidpoint(
      positionIndex(plan.ghost),
      'left_hip',
      'right_hip',
    )
    if (a !== null && b !== null) {
      // At the mean of the two hip-mid heights, so the span reads as the horizontal displacement
      // `strideLength.ts:181` measures rather than as a diagonal between two body positions.
      const y = (a.y + b.y) / 2
      pairBuilder.caliper(
        'strideCaliper',
        'horizontal',
        derived(a, a.x, y),
        derived(b, b.x, y),
        horizontalPolarity(
          a.x,
          b.x,
          polarityAllowed ? plan.travelDirection : null,
        ),
      )
      annotation.ops.push(...pairBuilder.ops)
    }
  }

  return annotation
}
