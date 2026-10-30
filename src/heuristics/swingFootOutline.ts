import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { analyzeHipBounce } from './hipBounce'
import { detectFootstrikes } from './footstrikes'
import { resolvePoint } from './keypoints'
import { median, percentile } from './mathUtils'
import { computeMetricConfidence } from './confidence'
import {
  MIN_EXEMPLAR_QUALITY,
  attachPairAlternates,
  detectionFactor,
  pairQuality,
  selectExemplars,
} from './exemplars'
import { viewPhrase } from './viewDetection'
import type {
  HeuristicsConfig,
  MetricExemplar,
  OutlineMarks,
  OutlinePoint,
  SwingFootLateralExcursionResult,
  SwingFootOutlineFrameMeasurement,
  SwingFootOutlineFramePlan,
  SwingFootOutlinePlan,
  SwingFootOutlineReading,
  SwingFootOutlineSideMeasurement,
  SwingFootOutlineWindowPlan,
  SwingFootOutlineWindowReading,
  View,
  ViewFitEntry,
} from './types'

/**
 * The swing-foot outline check (`strides-uz48`): in each early swing of a FRONT clip, does
 * anything below the swing knee stick out past the outer edge of that leg's thigh in MediaPipe's
 * person mask, and by how much, as a fraction of hip width?
 *
 * A port of the `strides-uz48.1` spike (`docs/agent-notes/swing-foot-travel.md`), method and
 * constants unchanged. Every constant below was tuned on park-approach and is validated by
 * strides-uz48.2 — treat each as a hypothesis until a second front clip exists.
 *
 * Pure: the mask arrives as per-row runs (`OutlineMaskRuns`), never as pixels, so this module
 * never holds a float mask and is testable on synthetic run masks.
 */

type Side = 'left' | 'right'
const SIDES: readonly Side[] = ['left', 'right']

// tuned on park-approach; validated by strides-uz48.2
export const OUTLINE_CROP_WIDTH_HIP_WIDTHS = 7
// tuned on park-approach; validated by strides-uz48.2
export const OUTLINE_CROP_HEIGHT_HIP_WIDTHS = 12
// tuned on park-approach; validated by strides-uz48.2 — a far runner's crop is never narrower
// than 7 × 60 px, so MediaPipe always sees the whole lower body.
export const OUTLINE_CROP_MIN_HIP_WIDTH_PX = 60
// tuned on park-approach; validated by strides-uz48.2
export const OUTLINE_MASK_THRESHOLD = 0.5
// tuned on park-approach; validated by strides-uz48.2 — thigh band rows, as fractions of thigh
// length L ABOVE the knee.
export const OUTLINE_THIGH_BAND_TOP = 0.4
// tuned on park-approach; validated by strides-uz48.2
export const OUTLINE_THIGH_BAND_BOTTOM = 0.1
// tuned on park-approach; validated by strides-uz48.2
export const OUTLINE_THIGH_SEARCH_HIP_WIDTHS = 0.3
// tuned on park-approach; validated by strides-uz48.2
export const OUTLINE_MIN_THIGH_ROW_FRACTION = 0.5
// tuned on park-approach; validated by strides-uz48.2 — below knee + 0.3L, so the knee's own
// lateral contour (wider than the thigh band) is never read as protrusion.
export const OUTLINE_LOWER_BAND_START = 0.3
// tuned on park-approach; validated by strides-uz48.2 — MediaPipe's hips/knees farther than this
// from MoveNet's mean the mask came from a pose ROI of unknown provenance.
export const OUTLINE_MASK_TRUST_HIP_WIDTHS = 0.5
// tuned on park-approach; validated by strides-uz48.2
export const OUTLINE_MIN_HIP_WIDTH_FRACTION_OF_MEDIAN = 0.5
// tuned on park-approach; validated by strides-uz48.2
export const OUTLINE_MIN_WINDOW_FRAMES = 6
// tuned on park-approach; validated by strides-uz48.2
export const OUTLINE_MIN_WINDOW_COVERAGE = 0.7
// tuned on park-approach; validated by strides-uz48.2
export const OUTLINE_WINDOW_QUANTILE = 0.8
// tuned on park-approach; validated by strides-uz48.2
export const OUTLINE_MIN_STANCE_FRAMES = 6
const MIN_WINDOWS_FOR_CONFIDENCE = 3
const MAX_CONTOUR_POINTS = 64
/** Same tolerance the spike used for "this window ends inside the clip". */
const IN_CLIP_EPSILON_SECONDS = 1e-6

export const OUTLINE_CHECKING_CAVEAT = 'Checking sideways foot travel with a closer look at the clip…'

/** A crop in source pixels; integers once clamped. */
export interface OutlineCropRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A thresholded person mask over one crop, reduced to runs. Rows above `firstRow` were never
 * stored and read as empty, which is exact for every row this module reads.
 */
export interface OutlineMaskRuns {
  /** Crop origin in source pixels (integers). */
  originX: number
  originY: number
  width: number
  height: number
  /** Crop-local index of `rows[0]`. */
  firstRow: number
  /** `rows[k]` holds inclusive crop-local `[start, end, start, end, …]` for row `firstRow + k`. */
  rows: number[][]
}

/** MediaPipe's own hips and knees for the frame, in source pixels. */
export interface OutlineAgreementPoints {
  left_hip: { x: number; y: number }
  right_hip: { x: number; y: number }
  left_knee: { x: number; y: number }
  right_knee: { x: number; y: number }
}

type OutlineJoint = keyof SwingFootOutlineFramePlan['keypoints']

function kneeName(side: Side): OutlineJoint {
  return side === 'left' ? 'left_knee' : 'right_knee'
}
function hipName(side: Side): OutlineJoint {
  return side === 'left' ? 'left_hip' : 'right_hip'
}
function ankleName(side: Side): KeypointName {
  return side === 'left' ? 'left_ankle' : 'right_ankle'
}

/**
 * The MoveNet-guided crop MediaPipe segments: centred on hip-mid, 7 × 12 hip widths at native
 * pixels, hip width floored at 60 px. Unclamped — the frame size is only known to the reader;
 * see `clampOutlineCrop`. Null when either hip is unresolved.
 */
export function cropRectFor(frame: Pick<SwingFootOutlineFramePlan, 'keypoints'>): OutlineCropRect | null {
  const { left_hip: leftHip, right_hip: rightHip } = frame.keypoints
  if (leftHip === null || rightHip === null) return null
  const hipWidth = Math.max(Math.abs(leftHip.x - rightHip.x), OUTLINE_CROP_MIN_HIP_WIDTH_PX)
  const width = Math.round(OUTLINE_CROP_WIDTH_HIP_WIDTHS * hipWidth)
  const height = Math.round(OUTLINE_CROP_HEIGHT_HIP_WIDTHS * hipWidth)
  const centreX = (leftHip.x + rightHip.x) / 2
  const centreY = (leftHip.y + rightHip.y) / 2
  return {
    x: Math.round(centreX - width / 2),
    y: Math.round(centreY - height / 2),
    width,
    height,
  }
}

/** Clamps a crop to the frame; null when nothing of it is inside. */
export function clampOutlineCrop(
  crop: OutlineCropRect,
  frameWidth: number,
  frameHeight: number,
): OutlineCropRect | null {
  const x0 = Math.max(0, crop.x)
  const y0 = Math.max(0, crop.y)
  const x1 = Math.min(frameWidth, crop.x + crop.width)
  const y1 = Math.min(frameHeight, crop.y + crop.height)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

function thighLength(frame: SwingFootOutlineFramePlan, side: Side): number | null {
  const hip = frame.keypoints[hipName(side)]
  const knee = frame.keypoints[kneeName(side)]
  if (hip === null || knee === null) return null
  return knee.y - hip.y
}

/**
 * Crop-local first mask row any planned side reads (the higher thigh band's top), clamped to the
 * crop. A reader stores runs from here down, and nothing above.
 */
export function outlineFirstMaskRow(frame: SwingFootOutlineFramePlan, cropY: number): number {
  let top = Number.POSITIVE_INFINITY
  for (const side of frame.sides) {
    const knee = frame.keypoints[kneeName(side)]
    const length = thighLength(frame, side)
    if (knee === null || length === null) continue
    top = Math.min(top, Math.round(knee.y - OUTLINE_THIGH_BAND_TOP * length))
  }
  if (!Number.isFinite(top)) return 0
  return Math.max(0, top - cropY)
}

/** Inclusive runs of `value > threshold` along one mask row. */
export function rowRuns(values: ArrayLike<number>, offset: number, width: number, threshold = OUTLINE_MASK_THRESHOLD): number[] {
  const runs: number[] = []
  let start = -1
  for (let x = 0; x < width; x += 1) {
    const on = values[offset + x] > threshold
    if (on && start < 0) start = x
    else if (!on && start >= 0) {
      runs.push(start, x - 1)
      start = -1
    }
  }
  if (start >= 0) runs.push(start, width - 1)
  return runs
}

/** Pre-mask gates the spike applies after the trust gate: these depend only on MoveNet. */
function keypointGate(
  frame: SwingFootOutlineFramePlan,
  side: Side,
  hipWidthMedianPx: number,
): SwingFootOutlineSideMeasurement | null {
  const { left_hip: leftHip, right_hip: rightHip } = frame.keypoints
  const knee = frame.keypoints[kneeName(side)]
  if (leftHip === null || rightHip === null || knee === null) return { ok: false, reason: 'kp-missing' }
  if (leftHip.interpolated || rightHip.interpolated || knee.interpolated) {
    return { ok: false, reason: 'kp-interpolated' }
  }
  if (Math.abs(leftHip.x - rightHip.x) < OUTLINE_MIN_HIP_WIDTH_FRACTION_OF_MEDIAN * hipWidthMedianPx) {
    return { ok: false, reason: 'hip-floor' }
  }
  const length = thighLength(frame, side)
  if (length === null || !(length > 0)) return { ok: false, reason: 'thigh-len' }
  return null
}

/**
 * Largest MediaPipe-vs-MoveNet distance over both hips and (where MoveNet has them) both knees,
 * in this frame's hip widths. Null when either MoveNet hip is unresolved.
 */
export function mediaPipeDisagreement(
  frame: SwingFootOutlineFramePlan,
  mediaPipe: OutlineAgreementPoints,
): number | null {
  const { left_hip: leftHip, right_hip: rightHip } = frame.keypoints
  if (leftHip === null || rightHip === null) return null
  const hipWidth = Math.abs(leftHip.x - rightHip.x)
  let worst = 0
  for (const name of ['left_hip', 'right_hip', 'left_knee', 'right_knee'] as const) {
    const moveNet = frame.keypoints[name]
    if (moveNet === null) continue
    const point = mediaPipe[name]
    worst = Math.max(worst, Math.hypot(point.x - moveNet.x, point.y - moveNet.y))
  }
  return worst / hipWidth
}

function runsAt(mask: OutlineMaskRuns, sourceRow: number): number[] {
  const local = sourceRow - mask.originY - mask.firstRow
  if (local < 0 || local >= mask.rows.length) return []
  return mask.rows[local]
}

/** The run containing source column `x`, as `[start, end]` in source px, or null. */
function runContaining(runs: number[], originX: number, x: number): [number, number] | null {
  const local = x - originX
  for (let k = 0; k < runs.length; k += 2) {
    if (runs[k] <= local && local <= runs[k + 1]) return [runs[k] + originX, runs[k + 1] + originX]
  }
  return null
}

interface ComponentRun {
  row: number
  start: number
  end: number
}

/**
 * The 8-connected component(s) of the mask rows from `topRow` down that contain the seed pixels,
 * as source-px runs in row order — the spike's `component_runs`.
 */
function componentRuns(mask: OutlineMaskRuns, topRow: number, seeds: Array<[number, number]>): ComponentRun[] {
  const lastRow = mask.originY + mask.firstRow + mask.rows.length - 1
  if (topRow > lastRow) return []
  const runs: ComponentRun[] = []
  const rowStart: number[] = []
  for (let row = topRow; row <= lastRow; row += 1) {
    rowStart.push(runs.length)
    const local = runsAt(mask, row)
    for (let k = 0; k < local.length; k += 2) {
      runs.push({ row, start: local[k] + mask.originX, end: local[k + 1] + mask.originX })
    }
  }
  rowStart.push(runs.length)
  const parent = runs.map((_, index) => index)
  const find = (index: number): number => {
    let x = index
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  for (let r = 1; r < rowStart.length - 1; r += 1) {
    for (let j = rowStart[r]; j < rowStart[r + 1]; j += 1) {
      for (let p = rowStart[r - 1]; p < rowStart[r]; p += 1) {
        if (runs[p].start <= runs[j].end + 1 && runs[p].end >= runs[j].start - 1) {
          const a = find(j)
          const b = find(p)
          if (a !== b) parent[a] = b
        }
      }
    }
  }
  const roots = new Set<number>()
  for (const [row, x] of seeds) {
    const r = row - topRow
    if (r < 0 || r >= rowStart.length - 1) continue
    for (let j = rowStart[r]; j < rowStart[r + 1]; j += 1) {
      if (runs[j].start <= x && x <= runs[j].end) roots.add(find(j))
    }
  }
  return runs.filter((_, index) => roots.has(find(index)))
}

function downsample(points: OutlinePoint[], max: number): OutlinePoint[] {
  if (points.length <= max) return points
  const out: OutlinePoint[] = []
  for (let k = 0; k < max; k += 1) {
    out.push(points[Math.round((k * (points.length - 1)) / (max - 1))])
  }
  return out
}

/**
 * One side of one frame — the spike's `measure`, gate order included. `mask` null means no mask;
 * `mediaPipe` null means no MediaPipe pose.
 */
export function measureSideOutline(
  mask: OutlineMaskRuns | null,
  mediaPipe: OutlineAgreementPoints | null,
  frame: SwingFootOutlineFramePlan,
  side: Side,
  hipWidthMedianPx: number,
): SwingFootOutlineSideMeasurement {
  if (mask === null) return { ok: false, reason: 'no-mask' }
  const disagreement = mediaPipe === null ? null : mediaPipeDisagreement(frame, mediaPipe)
  if (disagreement === null || disagreement > OUTLINE_MASK_TRUST_HIP_WIDTHS) {
    return { ok: false, reason: 'mask-untrusted' }
  }
  const gated = keypointGate(frame, side, hipWidthMedianPx)
  if (gated !== null) return gated

  const leftHip = frame.keypoints.left_hip!
  const rightHip = frame.keypoints.right_hip!
  const hip = frame.keypoints[hipName(side)]!
  const knee = frame.keypoints[kneeName(side)]!
  const hipWidth = Math.abs(leftHip.x - rightHip.x)
  const midX = (leftHip.x + rightHip.x) / 2
  const sign = hip.x > midX ? 1 : -1
  const length = knee.y - hip.y
  const frameBottom = mask.originY + mask.height - 1

  const bandTop = Math.round(knee.y - OUTLINE_THIGH_BAND_TOP * length)
  const bandBottom = Math.round(knee.y - OUTLINE_THIGH_BAND_BOTTOM * length)
  const search = Math.round(OUTLINE_THIGH_SEARCH_HIP_WIDTHS * hipWidth)
  const edges: number[] = []
  const seeds: Array<[number, number]> = []
  for (let row = Math.max(bandTop, 0); row <= Math.min(bandBottom, frameBottom); row += 1) {
    const runs = runsAt(mask, row)
    if (runs.length === 0) continue
    const fraction = (row - hip.y) / length
    const lineX = Math.round(hip.x + fraction * (knee.x - hip.x))
    let run = runContaining(runs, mask.originX, lineX)
    for (let d = 1; run === null && d <= search; d += 1) {
      run = runContaining(runs, mask.originX, lineX + d) ?? runContaining(runs, mask.originX, lineX - d)
    }
    if (run === null) continue
    const edge = sign > 0 ? run[1] : run[0]
    edges.push(edge)
    seeds.push([row, edge])
  }
  const bandRows = bandBottom - bandTop + 1
  if (edges.length < OUTLINE_MIN_THIGH_ROW_FRACTION * bandRows) return { ok: false, reason: 'thigh-band' }
  const thighEdgeX = median(edges)

  const component = componentRuns(mask, Math.max(bandTop, 0), seeds)
  if (component.length === 0) return { ok: false, reason: 'no-component' }
  const bottom = component.reduce((max, run) => Math.max(max, run.row), component[0].row)
  const lowerTop = Math.ceil(knee.y + OUTLINE_LOWER_BAND_START * length)
  let outermost: OutlinePoint | null = null
  const contourByRow = new Map<number, number>()
  for (const run of component) {
    const x = sign > 0 ? run.end : run.start
    const previous = contourByRow.get(run.row)
    if (previous === undefined || sign * x > sign * previous) contourByRow.set(run.row, x)
    if (run.row < lowerTop) continue
    if (sign * (x - midX) <= 0) continue
    if (outermost === null || sign * x > sign * outermost.x) outermost = { x, y: run.row }
  }
  const residual = outermost === null ? null : (sign * (outermost.x - thighEdgeX)) / hipWidth
  const contour = downsample(
    [...contourByRow.entries()].sort((a, b) => a[0] - b[0]).map(([y, x]) => ({ x, y })),
    MAX_CONTOUR_POINTS,
  )
  return {
    ok: true,
    residual,
    protrusion: residual === null ? 0 : Math.max(0, residual),
    marks: {
      thighEdge: [{ x: thighEdgeX, y: bandTop }, { x: thighEdgeX, y: bottom }],
      contour,
      outermost,
      midlineX: midX,
    },
  }
}

function placeholderResult(
  viewFit: ViewFitEntry['fit'],
  caveat: string,
  outlinePlan: SwingFootOutlinePlan | null,
  frameCoverage = 0,
): SwingFootLateralExcursionResult {
  return {
    metric: 'swingFootLateralExcursion',
    value: null,
    unit: 'percent',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage,
    sampleSize: 0,
    caveat,
    outlinePlan,
    outline: null,
  }
}

function timestampsIn(frames: RobustPoseFrame[], start: number, end: number): number[] {
  return frames.filter((frame) => start <= frame.timestamp && frame.timestamp <= end).map((frame) => frame.timestamp)
}

function framePointsOf(frame: RobustPoseFrame): SwingFootOutlineFramePlan['keypoints'] {
  const point = (name: KeypointName) => {
    const resolved = resolvePoint(frame, name)
    return resolved === null ? null : { x: resolved.x, y: resolved.y, interpolated: resolved.interpolated }
  }
  return {
    left_hip: point('left_hip'),
    right_hip: point('right_hip'),
    left_knee: point('left_knee'),
    right_knee: point('right_knee'),
  }
}

/**
 * The primary pass's half of the check: on a front clip, decide which frames need a mask and for
 * which side. The value itself waits for the outline pass; the result carries `value: null` and a
 * "checking…" caveat until `summarizeSwingFootOutline` replaces it.
 */
export function planSwingFootOutline(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig,
): SwingFootLateralExcursionResult {
  const viewFit = config.viewFitTable.swingFootLateralExcursion[view]
  if (view !== 'front') {
    return placeholderResult(viewFit.fit, `Sideways foot travel is not reliable from ${viewPhrase(view)}.`, null)
  }
  const hipWidths: number[] = []
  for (const frame of frames) {
    const leftHip = resolvePoint(frame, 'left_hip')
    const rightHip = resolvePoint(frame, 'right_hip')
    if (leftHip !== null && rightHip !== null) hipWidths.push(Math.abs(leftHip.x - rightHip.x))
  }
  if (hipWidths.length === 0) {
    return placeholderResult(viewFit.fit, 'No resolvable bilateral-hip scale in this clip.', null)
  }
  const hipWidthMedianPx = median(hipWidths)
  const rhythm = analyzeHipBounce(frames, config).fit
  if (!rhythm.ok || rhythm.sinusoidR2 < config.cadenceMinFitR2) {
    return placeholderResult(viewFit.fit, 'No trustworthy step rhythm was measured to place early swing.', null)
  }
  const periodSeconds = 1 / rhythm.frequencyHz
  const strikes = detectFootstrikes(frames, config)
  const lastFrameTimestamp = frames[frames.length - 1].timestamp

  const windows: SwingFootOutlineWindowPlan[] = strikes.map((strike) => {
    const swingStart = strike.timestamp + periodSeconds / 2
    const swingEnd = strike.timestamp + (5 * periodSeconds) / 4
    const stanceEnd = strike.timestamp + periodSeconds / 4
    return {
      side: strike.side,
      strikeTimestamp: strike.timestamp,
      swingStart,
      swingEnd,
      stanceStart: strike.timestamp,
      stanceEnd,
      inClip: swingEnd <= lastFrameTimestamp + IN_CLIP_EPSILON_SECONDS,
      swingTimestamps: timestampsIn(frames, swingStart, swingEnd),
      stanceTimestamps: timestampsIn(frames, strike.timestamp, stanceEnd),
    }
  })
  if (!windows.some((window) => window.inClip)) {
    return placeholderResult(viewFit.fit, 'No complete early swing fits inside this clip.', null)
  }

  const wanted = new Map<number, Set<Side>>()
  const want = (timestamp: number, side: Side) => {
    const sides = wanted.get(timestamp) ?? new Set<Side>()
    sides.add(side)
    wanted.set(timestamp, sides)
  }
  for (const window of windows) {
    // Swing frames past the clip end can never make a window usable; stance frames always feed
    // the floor (the spike pooled every strike's stance).
    if (window.inClip) for (const t of window.swingTimestamps) want(t, window.side)
    for (const t of window.stanceTimestamps) want(t, window.side)
  }
  const plannedFrames: SwingFootOutlineFramePlan[] = []
  for (const frame of frames) {
    const sides = wanted.get(frame.timestamp)
    if (sides === undefined) continue
    const keypoints = framePointsOf(frame)
    const candidate: SwingFootOutlineFramePlan = {
      timestamp: frame.timestamp,
      keypoints,
      sides: [],
      crop: { x: 0, y: 0, width: 0, height: 0 },
      quality: {
        left: detectionFactor(frame, ['left_hip', 'left_knee', 'left_ankle']),
        right: detectionFactor(frame, ['right_hip', 'right_knee', 'right_ankle']),
      },
    }
    const crop = cropRectFor(candidate)
    if (crop === null) continue
    // A side that fails a MoveNet-only gate fails with or without a mask: no inference for it.
    const measurable = SIDES.filter((side) => sides.has(side) && keypointGate(candidate, side, hipWidthMedianPx) === null)
    if (measurable.length === 0) continue
    plannedFrames.push({ ...candidate, crop, sides: measurable })
  }
  if (plannedFrames.length === 0) {
    return placeholderResult(viewFit.fit, 'No early-swing frame had clear hips and knees to check.', null)
  }

  return placeholderResult(viewFit.fit, OUTLINE_CHECKING_CAVEAT, {
    viewFit,
    periodSeconds,
    hipWidthMedianPx,
    lastFrameTimestamp,
    windows,
    frames: plannedFrames,
  })
}

/** The reader's half for one frame: every planned side measured against the frame's mask runs. */
export function measureFrameOutline(
  frame: SwingFootOutlineFramePlan,
  mask: OutlineMaskRuns | null,
  mediaPipe: OutlineAgreementPoints | null,
  hipWidthMedianPx: number,
): SwingFootOutlineFrameMeasurement {
  const sides: SwingFootOutlineFrameMeasurement['sides'] = {}
  for (const side of frame.sides) {
    sides[side] = measureSideOutline(mask, mediaPipe, frame, side, hipWidthMedianPx)
  }
  return {
    timestamp: frame.timestamp,
    mediaPipeDisagreement: mediaPipe === null ? null : mediaPipeDisagreement(frame, mediaPipe),
    sides,
  }
}

type OkMeasurement = Extract<SwingFootOutlineSideMeasurement, { ok: true }>

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/**
 * The value-0 sentence (`strides-uz48` review). "In all N swings" only when no usable window went
 * past the floor; a 0 can also come from one foot's few outside windows sitting under its
 * median, and then the remainder is named rather than hidden in the count.
 */
function insideCaveat(insideCount: number, usableCount: number): string {
  if (insideCount === usableCount) {
    return usableCount === 1
      ? "No sideways foot travel past your leg's outline in the 1 swing checked."
      : `No sideways foot travel past your leg's outline in all ${usableCount} swings.`
  }
  const others = usableCount - insideCount
  return (
    `No sideways foot travel past your leg's outline in ${insideCount} of ${usableCount} swings; ` +
    `${others === 1 ? 'the other one' : `the other ${others}`} went past it, ` +
    'but not on most swings of either foot.'
  )
}

/** The value > 0 sentence: counts the REPORTED foot's swings only, and shows the floor the value
 * cleared. */
function outsideCaveat(side: Side, value: number, floor: number, outside: number, checked: number): string {
  return (
    `Your ${side} foot stuck out past its leg's outline by ${formatPercent(value)} of hip width ` +
    `in ${outside} of ${checked} ${side}-foot ${checked === 1 ? 'swing' : 'swings'}, ` +
    `above this clip's noise floor of ${formatPercent(floor)}.`
  )
}

/**
 * The outline pass's result for the metric: per early-swing window P80 protrusion, a floor from
 * stance, and the larger side's value — exactly 0 when inside the floor.
 */
export function summarizeSwingFootOutline(
  plan: SwingFootOutlinePlan,
  measurements: SwingFootOutlineFrameMeasurement[],
  config: HeuristicsConfig,
): SwingFootLateralExcursionResult {
  const byTimestamp = new Map(measurements.map((m) => [m.timestamp, m]))
  const lookup = (timestamp: number, side: Side): SwingFootOutlineSideMeasurement =>
    byTimestamp.get(timestamp)?.sides[side] ?? { ok: false, reason: 'not-measured' }

  const stanceProtrusions: number[] = []
  for (const window of plan.windows) {
    for (const t of window.stanceTimestamps) {
      const m = lookup(t, window.side)
      if (m.ok) stanceProtrusions.push(m.protrusion)
    }
  }
  const floor = stanceProtrusions.length >= OUTLINE_MIN_STANCE_FRAMES
    ? percentile(stanceProtrusions, OUTLINE_WINDOW_QUANTILE)
    : null

  let swingFrames = 0
  let swingOkFrames = 0
  const windows: SwingFootOutlineWindowReading[] = plan.windows.map((window) => {
    const ok = window.swingTimestamps
      .map((t) => ({ t, m: lookup(t, window.side) }))
      .filter((entry): entry is { t: number; m: OkMeasurement } => entry.m.ok)
    if (window.inClip) {
      swingFrames += window.swingTimestamps.length
      swingOkFrames += ok.length
    }
    const usable = window.inClip &&
      ok.length >= OUTLINE_MIN_WINDOW_FRAMES &&
      ok.length >= OUTLINE_MIN_WINDOW_COVERAGE * window.swingTimestamps.length
    const protrusionP80 = ok.length > 0
      ? percentile(ok.map((entry) => entry.m.protrusion), OUTLINE_WINDOW_QUANTILE)
      : null
    const residuals = ok.flatMap((entry) => (entry.m.residual === null ? [] : [entry.m.residual]))
    return {
      side: window.side,
      strikeTimestamp: window.strikeTimestamp,
      swingStart: window.swingStart,
      swingEnd: window.swingEnd,
      inClip: window.inClip,
      frames: window.swingTimestamps.length,
      okFrames: ok.length,
      usable,
      protrusionP80,
      residualMax: residuals.length > 0 ? Math.max(...residuals) : null,
      outside: usable && floor !== null && protrusionP80 !== null && protrusionP80 > floor,
    }
  })

  const usableWindows = windows.filter((window) => window.usable)
  const perSideOf = (side: Side): number | null => {
    const values = usableWindows.filter((w) => w.side === side).map((w) => w.protrusionP80!)
    return values.length > 0 ? median(values) : null
  }
  const perSide = { left: perSideOf('left'), right: perSideOf('right') }
  const reportedSide: Side | null = perSide.left === null && perSide.right === null
    ? null
    : perSide.right === null || (perSide.left !== null && perSide.left >= perSide.right) ? 'left' : 'right'
  const protrusion = reportedSide === null ? null : perSide[reportedSide]
  const outsideCount = usableWindows.filter((w) => w.outside).length
  const reading: SwingFootOutlineReading = {
    windows,
    floor,
    stanceFrames: stanceProtrusions.length,
    perSide,
    reportedSide,
    protrusion,
    insideCount: usableWindows.length - outsideCount,
    outsideCount,
    usableCount: usableWindows.length,
  }

  const frameCoverage = swingFrames === 0 ? 0 : swingOkFrames / swingFrames
  const base = {
    metric: 'swingFootLateralExcursion' as const,
    unit: 'percent' as const,
    viewFit: plan.viewFit.fit,
    interpolatedFraction: 0,
    frameCoverage,
    outlinePlan: plan,
    outline: reading,
  }
  if (usableWindows.length === 0 || protrusion === null || reportedSide === null) {
    return {
      ...base,
      value: null,
      confidence: 0,
      sampleSize: 0,
      caveat: 'No early swing had enough clear outline frames to check sideways foot travel.',
    }
  }
  if (floor === null) {
    return {
      ...base,
      value: null,
      confidence: 0,
      sampleSize: usableWindows.length,
      caveat: "Too few clear stance frames to set this clip's outline noise floor.",
    }
  }
  const value = protrusion > floor ? protrusion : 0
  const confidence = computeMetricConfidence({
    viewFitMultiplier: plan.viewFit.multiplier,
    frameCoverage,
    interpolatedFraction: 0,
    sampleSize: usableWindows.length,
    minRequiredSampleSize: MIN_WINDOWS_FOR_CONFIDENCE,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })
  const reportedWindows = usableWindows.filter((w) => w.side === reportedSide)
  const caveat = value === 0
    ? insideCaveat(reading.insideCount, reading.usableCount)
    : outsideCaveat(
        reportedSide,
        value,
        floor,
        reportedWindows.filter((w) => w.outside).length,
        reportedWindows.length,
      )
  const exemplars = outlineExemplars(plan, byTimestamp, windows, reportedSide, protrusion)
  return {
    ...base,
    value,
    confidence,
    sampleSize: usableWindows.length,
    caveat,
    ...(exemplars && { exemplars }),
  }
}

function outlineExemplars(
  plan: SwingFootOutlinePlan,
  byTimestamp: Map<number, SwingFootOutlineFrameMeasurement>,
  windows: SwingFootOutlineWindowReading[],
  reportedSide: Side,
  reportedValue: number,
): MetricExemplar[] | undefined {
  const framePlans = new Map(plan.frames.map((frame) => [frame.timestamp, frame]))
  const ranked = windows
    .map((window, index) => ({ window, plan: plan.windows[index] }))
    .filter(({ window }) => window.usable)
    .sort((a, b) => {
      const sideOrder = Number(a.window.side !== reportedSide) - Number(b.window.side !== reportedSide)
      if (sideOrder !== 0) return sideOrder
      return Math.abs(a.window.protrusionP80! - reportedValue) - Math.abs(b.window.protrusionP80! - reportedValue)
    })
  const pairs: MetricExemplar[] = []
  for (const { window, plan: windowPlan } of ranked) {
    const side = window.side
    const swing = windowPlan.swingTimestamps.flatMap((t) => {
      const m = byTimestamp.get(t)?.sides[side]
      return m?.ok ? [{ t, m }] : []
    })
    const stance = windowPlan.stanceTimestamps.flatMap((t) => {
      const m = byTimestamp.get(t)?.sides[side]
      return m?.ok ? [{ t, m }] : []
    })
    if (swing.length === 0 || stance.length === 0) continue
    const withResidual = swing.filter((entry) => entry.m.residual !== null)
    const baseEntry = withResidual.length > 0
      ? withResidual.reduce((best, entry) => (entry.m.residual! > best.m.residual! ? entry : best))
      : swing[Math.floor(swing.length / 2)]
    const stanceMiddle = (windowPlan.stanceStart + windowPlan.stanceEnd) / 2
    const ghostEntry = stance.reduce((best, entry) =>
      Math.abs(entry.t - stanceMiddle) < Math.abs(best.t - stanceMiddle) ? entry : best,
    )
    const baseFrame = framePlans.get(baseEntry.t)
    const ghostFrame = framePlans.get(ghostEntry.t)
    if (baseFrame === undefined || ghostFrame === undefined) continue
    const marks: OutlineMarks = { base: baseEntry.m.marks, ghost: ghostEntry.m.marks }
    const seed = [hipName(side), kneeName(side), ankleName(side)]
    pairs.push({
      kind: 'swingFootOutline',
      timestamp: baseEntry.t,
      pairedTimestamp: ghostEntry.t,
      side,
      quality: pairQuality(baseFrame.quality[side], ghostFrame.quality[side]),
      label: `The ${side} leg's outline in early swing, ghosted against its outline in stance`,
      cropKeypoints: [...new Set<KeypointName>([...seed, 'left_hip', 'right_hip'])],
      outlineMarks: marks,
    })
  }
  // Ranked by representativeness, not quality, so the gate goes first: an undrawable-quality
  // representative must not hide a drawable alternate.
  return selectExemplars(attachPairAlternates(pairs.filter((pair) => pair.quality >= MIN_EXEMPLAR_QUALITY)))
}
