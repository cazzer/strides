import type { MetricId, View } from '../heuristics/types'
import type { RunnerFocus, RunnerFootage } from '../runner/ModelRunner'
import type { RunnerSide } from '../runner/runnerAnnotations'
import type { FootagePoint } from '../runner/footagePlate'
import type { CameraPreset } from '../runner/types'
import type { ExtractedEvidenceFrame } from '../video/extractFrames'
import { METRIC_LABELS } from './metricConfidence'
import type { MetricCardEvidence } from './MetricsPanel'

/**
 * The metrics whose evidence frame can sit behind the model runner (`strides-zba4`): the leg
 * metrics of the knees and landing stops, each read at one key leg phase the still figure can
 * stand at. Posture and rhythm have no such phase, so a footage instant beside them would be a
 * picture of a different moment than the figure. Foot strike is listed but never qualifies today:
 * its frame names no hip to anchor the plate on (a follow-up, not a threshold).
 */
export const PLATE_METRICS: ReadonlySet<MetricId> = new Set<MetricId>([
  'overstriding',
  'footStrikePattern',
  'kneeFlexion',
  'kneeDrive',
])

/** The side cameras the plate can be laid under: the landing and knees stops' own framings. */
export const PLATE_CAMERAS: ReadonlySet<CameraPreset> = new Set<CameraPreset>(['landingSide', 'legsSide'])

export interface RunnerFootageInput {
  focus: RunnerFocus | undefined
  camera: CameraPreset
  evidence: readonly MetricCardEvidence[]
  sourceIndices: Record<MetricId, number> | null
  /** Each clip's view classification, by session clip index; null where not yet known. */
  clipViewKinds: readonly (View | null)[]
}

const SIDE_PREFIX = /^(left|right)_/
/** A joint the fit reads a segment length to: a hip alone gives it nothing to scale from. */
const LEG_JOINT = /^(left|right)_(knee|ankle)$/

/**
 * The text alternative's sentence for the plate. The picture is the card's evidence image as it
 * is: the measured moment and, for a paired metric, a fainter second moment ghosted over it (the
 * plate brings that ghosting to the runner deliberately), so the sentence says both, and says when
 * the picture is flipped to face the model's way.
 */
export function plateNote(metric: MetricId, ghosted: boolean, mirror: boolean): string {
  const second = ghosted ? ', with a fainter second moment over it' : ''
  const flipped = mirror ? ', flipped to face the way the model runs' : ''
  return (
    `Faint behind the still model: your clip's ${METRIC_LABELS[metric].toLowerCase()} evidence image, ` +
    `the measured moment${second}${flipped}, scaled to fit. Your footage, not a target.`
  )
}

/**
 * The leg the frame's measurement was about: the plan's own per-instant side, else the one side
 * every sided non-hip joint it names shares. Mixed or none: null, never a guess (a plate drawn on
 * the wrong leg would compare the reader's stance knee against the model's swing knee).
 */
function measuredSideOf(item: ExtractedEvidenceFrame, points: readonly FootagePoint[]): RunnerSide | null {
  if (item.plan.base.side !== null) return item.plan.base.side
  const sides = new Set(
    points.flatMap(({ name }) => {
      const match = SIDE_PREFIX.exec(name)
      return match && !name.endsWith('_hip') ? [match[1] as RunnerSide] : []
    }),
  )
  return sides.size === 1 ? [...sides][0] : null
}

/** The base instant's resolved joints, in the image's unit square (the crop is square). */
function unitSquarePoints(item: ExtractedEvidenceFrame): FootagePoint[] {
  const { crop, base } = item.plan
  return base.keypoints.flatMap((point) =>
    point.status === 'unrecoverable'
      ? []
      : [{ name: point.name, u: (point.x - crop.x) / crop.side, v: (point.y - crop.y) / crop.side }],
  )
}

/**
 * The footage plate for the runner's current focus, or null. Pure: every gate that does not need
 * the figure drawn is applied here, so `ModelRunner` only has to decide WHEN (still, at the held
 * phase, nothing tweening).
 *
 * - The headline is the first focus metric whose evidence from its winning clip
 *   (`sourceIndices`) has arrived; it must be a plate metric, or there is no plate (never the next
 *   one down: the figure's focus and the footage must be the same metric).
 * - The camera is a side stop's, and the winning clip was classified a side view. An ambiguous or
 *   unknown view is not a side view.
 * - The travel direction is known (0 is indeterminate: no mirror can be chosen), the frame has a
 *   hip, and the measured leg resolves.
 */
export function runnerFootageFor({
  focus,
  camera,
  evidence,
  sourceIndices,
  clipViewKinds,
}: RunnerFootageInput): RunnerFootage | null {
  if (focus === undefined || sourceIndices === null || !PLATE_CAMERAS.has(camera)) return null
  for (const metric of focus.metricIds) {
    const clipIndex = sourceIndices[metric]
    const section = evidence.find(
      (entry) => entry.metric === metric && entry.clipIndex === clipIndex && entry.pending !== true,
    )
    const item = section?.items[0]
    if (item === undefined) continue
    if (!PLATE_METRICS.has(metric) || clipViewKinds[clipIndex] !== 'side') return null
    const { travelDirection } = item.plan
    if (travelDirection === 0) return null
    const points = unitSquarePoints(item)
    if (!points.some(({ name }) => name.endsWith('_hip'))) return null
    if (!points.some(({ name }) => LEG_JOINT.test(name))) return null
    const measuredSide = measuredSideOf(item, points)
    if (measuredSide === null) return null
    const mirror = travelDirection === -1
    return {
      metric,
      image: item.canvas,
      note: plateNote(metric, item.plan.ghost !== null, mirror),
      points,
      measuredSide,
      mirror,
    }
  }
  return null
}
