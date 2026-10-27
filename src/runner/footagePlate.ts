/**
 * The footage plate's geometry (`strides-zba4`, `openspec/changes/add-runner-footage-plate`): where
 * a faint copy of the headline metric's evidence image sits behind a still model runner, so the
 * reader can see the measured moment and the figure built from it in one place.
 *
 * **Footage, never a target.** The plate is the metric's evidence image exactly as its card shows
 * it: the reader's own clip at the moment the metric measured, and, for a paired metric, a fainter
 * second moment ghosted over it (the ghosting is the point: it is the card's picture brought to the
 * runner). The fit is read from the measured (base) moment's joints only. It is placed by a
 * SIMILARITY transform only: one uniform scale, a translation and (for a right-to-left runner) a
 * horizontal mirror. Never a rotation, a shear or a
 * per-joint warp, so the photograph is never reshaped to agree with the model, and any difference
 * between the two (a straighter knee, a longer reach) stays visible.
 *
 * **Hip-anchored, scaled from segment lengths, NOT a least-squares fit.** Least squares over the
 * joints would turn an angle difference into a scale and offset that hide it: a footage knee bent
 * further than the model's would pull the plate up and shrink it until the two "agree". Instead the
 * hip-mid points are pinned together and the scale is the ratio of summed thigh and shank lengths,
 * which an angle difference leaves unchanged (`footagePlate.test.ts` pins exactly that).
 *
 * Pure: no DOM, no React. The renderer calls `placeFootagePlate` (the fit, refused past a clutter
 * cap) on every still draw with the pose as it is drawn, and writes the result as an SVG `matrix(a 0 0 d e f)` on an `<image>` laid over the
 * unit square.
 */
import type { KeypointName } from '../pose/types'
import { CAMERA_FRAME_HALF_WIDTH } from './camera'
import { KEY_LEG_PHASE, phaseForLeg, type RunnerSide } from './runnerAnnotations'
import { paramForMetric } from './runnerParams'
import type { MetricId, ProjectedJoint } from './types'

/** One joint of the footage's measured instant, in the evidence image's unit square (0..1 each way,
 * y down), as `crop`-relative native pixels divided by the crop's side. */
export interface FootagePoint {
  name: KeypointName
  u: number
  v: number
}

/** What the fit needs from the footage, independent of how it was planned or extracted. */
export interface FootageFitInput {
  points: readonly FootagePoint[]
  /** The leg the metric measured at this instant. It is drawn onto the model's held (near) leg. */
  measuredSide: RunnerSide
  /** The runner travels right to left in the clip; the model always travels left to right. */
  mirror: boolean
}

/** SVG `matrix(a 0 0 d e f)`: (u, v) → (a·u + e, d·v + f), in viewBox units. `|a| === d`. */
export interface PlateTransform {
  a: number
  d: number
  e: number
  f: number
}

/**
 * The smallest summed footage segment length (in image widths) the scale may be read from. Below
 * it the joints are within a few percent of the image of each other: a degenerate detection, and
 * a scale read from it would blow the plate up past the frame.
 */
export const MIN_FOOTAGE_SEGMENT_SUM = 0.02

/**
 * The largest the placed evidence image may be, as a multiple of the drawing's width (the camera
 * frame, in viewBox units). Past it the subject was small in its crop, so fitting its leg to the
 * model's magnifies the photograph until it is a blur and its baked-in annotation marks (drawn at
 * a fixed canvas size) become fat blobs and bars that dominate the figure. Measured live
 * (`strides-zba4`, design.md): readable at 1.55–1.64 drawing widths (both side clips' knee-flexion
 * images), cluttered at 4.18 (`park-side-portrait.mp4`'s far-apart overstride pair). 2.5 sits
 * between them, about their geometric mean. Not a constant of any measurement: it only decides
 * whether a picture is shown.
 */
export const MAX_PLATE_SIDE_IN_FRAME_WIDTHS = 2.5

const LEGS: readonly RunnerSide[] = ['left', 'right']

function otherSide(side: RunnerSide): RunnerSide {
  return side === 'left' ? 'right' : 'left'
}

/**
 * The model joint a footage joint is drawn against: the measured side's joints go to the model's
 * held leg, the other side's to the other leg. Unsided names (nose) are unchanged.
 */
export function mapFootageName(name: KeypointName, measuredSide: RunnerSide, heldLeg: RunnerSide): KeypointName {
  for (const side of LEGS) {
    const prefix = `${side}_`
    if (name.startsWith(prefix)) {
      const target = side === measuredSide ? heldLeg : otherSide(heldLeg)
      return `${target}_${name.slice(prefix.length)}` as KeypointName
    }
  }
  return name
}

/**
 * The leg a side camera calls near, which the still figure holds at its key phase: the right one
 * from the runner's right (cos yaw >= 0), as `planAnnotations` takes it.
 */
export function heldLegFor(cameraYawDeg: number): RunnerSide {
  return Math.cos((cameraYawDeg * Math.PI) / 180) >= 0 ? 'right' : 'left'
}

/**
 * The cycle phase at which the model shows what `metric` measured on the held leg, or null for a
 * metric with no key leg phase (posture, rhythm). The plate shows only when the still figure
 * stands exactly here: a footage instant beside a different phase of the stride would invite a
 * comparison of two different moments.
 */
export function footageKeyPhase(metric: MetricId, heldLeg: RunnerSide): number | null {
  const param = paramForMetric(metric)
  const q = param === null ? null : KEY_LEG_PHASE[param]
  return q === null ? null : phaseForLeg(heldLeg, q)
}

interface Point2 {
  x: number
  y: number
}

function mean(points: readonly Point2[]): Point2 | null {
  if (points.length === 0) return null
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  }
}

function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * The similarity transform that lays the footage under the drawn figure, or null when the footage
 * cannot be placed honestly: no hip, no knee or ankle, a degenerate or non-finite length.
 *
 * 1. Anchor: the footage's hip-mid (the mean of whichever hips it has) onto the drawn hip-mid (the
 *    mean of both projected hips; in a side view they coincide on screen anyway).
 * 2. Segments, per leg present in the footage (after `mapFootageName`): hip-mid → knee and knee →
 *    ankle when the knee is there, else hip-mid → ankle. Feet are left out: their keypoints are the
 *    least reliable and the shortest, so they would add noise to the scale and nothing else.
 * 3. Scale: the model's summed lengths over the footage's, over the same segments.
 * 4. Mirror for a right-to-left clip, then translate so the anchors meet.
 *
 * `drawn` is the pose as the renderer draws it (lift and live camera included), in viewBox units.
 */
export function fitFootagePlate(
  input: FootageFitInput,
  drawn: readonly ProjectedJoint[],
  heldLeg: RunnerSide,
): PlateTransform | null {
  const footage = new Map<KeypointName, Point2>()
  for (const point of input.points) {
    if (!Number.isFinite(point.u) || !Number.isFinite(point.v)) return null
    footage.set(mapFootageName(point.name, input.measuredSide, heldLeg), { x: point.u, y: point.v })
  }
  const model = new Map<KeypointName, Point2>(drawn.map((j) => [j.name, { x: j.x, y: j.y }]))

  const footageHip = mean(LEGS.flatMap((side) => footage.get(`${side}_hip`) ?? []))
  const modelHip = mean(LEGS.flatMap((side) => model.get(`${side}_hip`) ?? []))
  if (footageHip === null || modelHip === null) return null

  let footageSum = 0
  let modelSum = 0
  let legJoints = 0
  for (const side of LEGS) {
    const chain: KeypointName[] = []
    const knee = `${side}_knee` as const
    const ankle = `${side}_ankle` as const
    if (footage.has(knee)) chain.push(knee)
    if (footage.has(ankle)) chain.push(ankle)
    let footageFrom = footageHip
    let modelFrom = modelHip
    for (const name of chain) {
      const footageTo = footage.get(name) as Point2
      const modelTo = model.get(name)
      if (!modelTo) return null
      footageSum += distance(footageFrom, footageTo)
      modelSum += distance(modelFrom, modelTo)
      footageFrom = footageTo
      modelFrom = modelTo
      legJoints += 1
    }
  }
  if (legJoints === 0 || !(footageSum > MIN_FOOTAGE_SEGMENT_SUM)) return null
  const s = modelSum / footageSum
  if (!Number.isFinite(s) || s <= 0) return null
  const a = input.mirror ? -s : s
  const transform = { a, d: s, e: modelHip.x - a * footageHip.x, f: modelHip.y - s * footageHip.y }
  return Object.values(transform).every(Number.isFinite) ? transform : null
}

/** How many drawing widths the placed evidence image spans. */
export function plateSideInFrameWidths(transform: PlateTransform): number {
  return Math.abs(transform.a) / (2 * CAMERA_FRAME_HALF_WIDTH)
}

/**
 * `fitFootagePlate`, refusing a placement past `MAX_PLATE_SIDE_IN_FRAME_WIDTHS`: what the renderer
 * draws, both when it decides at render whether the plate (and its label) is on offer and on every
 * still draw.
 */
export function placeFootagePlate(
  input: FootageFitInput,
  drawn: readonly ProjectedJoint[],
  heldLeg: RunnerSide,
): PlateTransform | null {
  const transform = fitFootagePlate(input, drawn, heldLeg)
  return transform !== null && plateSideInFrameWidths(transform) <= MAX_PLATE_SIDE_IN_FRAME_WIDTHS
    ? transform
    : null
}
