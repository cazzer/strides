/**
 * The model runner's scene rules, kept out of the React component so they can be tested on their
 * own: which segments draw measured, neutral or accented, the draw order, the screen-reader text,
 * and the renderer's timing and stroke constants. Pure: no React, no DOM.
 */
import type { MetricId } from '../heuristics/types'
import { METRIC_LABELS } from '../results/metricConfidence'
import { SKELETON_EDGES } from '../results/skeletonGeometry'
import { COMMON_KEYPOINT_NAMES, type KeypointName } from '../pose/types'
import {
  CAMERA_FRAME_HALF_HEIGHT,
  CAMERA_FRAME_HALF_WIDTH,
  CAMERA_PRESETS,
  VIEWBOX_FRAME,
  projectPose,
  resolveCamera,
  type DrawingFrame,
  type FramePad,
  type PhaseWindow,
} from './camera'
import { GAIT_PHASES, poseAt } from './gaitModel'
import { formatRunnerValue, type LabelSide, type RunnerSide } from './runnerAnnotations'
import { RUNNER_PARAM_SEGMENTS, RUNNER_PARAM_SPECS, paramForMetric } from './runnerParams'
import type {
  BoundRunnerParams,
  CameraPreset,
  CameraState,
  RunnerParamId,
  RunnerParams,
  SkeletonEdge,
} from './types'

/** The draw cap: at most thirty frames a second. */
export const FRAME_MS = 1000 / 30
/** A frame may land this early and still count, so a 60 Hz display draws every other frame. */
export const FRAME_TOLERANCE_MS = 1.5
/** The longest step the phase integrates in one frame, so a stalled tab never jumps. */
export const MAX_FRAME_STEP_MS = 100
export const CAMERA_TWEEN_MS = 600

/** viewBox half-extents: ±`CAMERA_FRAME_HALF_WIDTH` (1.5) wide, ±`CAMERA_FRAME_HALF_HEIGHT` (2) high. */
export const VIEW_HALF_WIDTH = CAMERA_FRAME_HALF_WIDTH
export const VIEW_HALF_HEIGHT = CAMERA_FRAME_HALF_HEIGHT

/** CSS-pixel sizes, divided by the live pixels-per-viewBox-unit before they are drawn. */
export const RUNNER_PX = {
  measuredStroke: 3,
  focusStroke: 6,
  neutralStroke: 2.5,
  neutralDash: 5,
  joint: 3.5,
  focusJoint: 5,
  markStroke: 2,
  guideStroke: 1,
  /** A dashed reference line (knee flexion's straight leg): heavier than a ray, so its dashes read. */
  referenceStroke: 2,
  referenceDash: 5,
  groundStroke: 1,
  label: 13,
  labelHalo: 3,
  labelGap: 6,
  /** Left-side labels end at their anchor: a little more room clears a bracket's tick. */
  labelGapLeft: 10,
  /**
   * A footfall ring's radius: `beatRingMax` at contact, opaque, shrinking to `beatRingMin` as it
   * fades. Kept small: far below WCAG 2.3.1's flash-area threshold at any runner size (design D20).
   */
  beatRingMin: 6,
  beatRingMax: 15,
  beatRingStroke: 2.5,
} as const

/** Label line pitch, in font sizes. */
export const LABEL_LINE_HEIGHT = 1.2
/** Estimated advance of an Inter semibold character, in font sizes (measured ~0.46 in Chromium). */
export const LABEL_CHAR_WIDTH_EM = 0.5

/**
 * Opacity of measured parts on the far side of the body: dimmed for depth, never so far that a
 * solid part reads as the neutral grey.
 */
export const FAR_OPACITY = 0.75
/**
 * Opacity of measured parts outside the focus while a focus is shown: with the wider focus
 * stroke, a cue that does not rely on the accent hue.
 */
export const UNFOCUSED_OPACITY = 0.7
/** How far behind hip-mid (torso lengths) a part must sit to count as far. */
export const FAR_DEPTH = 0.05

/**
 * A part's opacity. Neutral parts are never dimmed: their dashes must keep their contrast against
 * either background.
 */
export function partOpacity(style: SegmentStyle, far: boolean, focusShown: boolean): number {
  if (style === 'neutral') return 1
  const dims = [far ? FAR_OPACITY : 1, style === 'measured' && focusShown ? UNFOCUSED_OPACITY : 1]
  return Math.min(...dims)
}

export type RunnerSource = 'measured' | 'neutral'
export type RunnerSources = Readonly<Record<RunnerParamId, RunnerSource>>
export type SegmentStyle = 'focus' | 'measured' | 'neutral'

export const RUNNER_PARAM_IDS = Object.keys(RUNNER_PARAM_SPECS) as RunnerParamId[]

const HEAD_JOINTS: ReadonlySet<KeypointName> = new Set(['nose', 'left_ear', 'right_ear'])
const JOINT_INDEX = new Map(COMMON_KEYPOINT_NAMES.map((name, index) => [name, index]))

/** Each skeleton edge as a pair of indices into `poseAt`'s joint order. */
export const EDGE_JOINT_INDICES: readonly (readonly [number, number])[] = SKELETON_EDGES.map(
  ([a, b]) => [JOINT_INDEX.get(a) as number, JOINT_INDEX.get(b) as number] as const,
)

export function edgeKey([a, b]: SkeletonEdge): string {
  return `${a}-${b}`
}

/** Each parameter's source after the intro's overrides (ps19.3); exactly the bound ones without. */
export function effectiveSources(
  bound: BoundRunnerParams,
  overrides?: Partial<Record<RunnerParamId, RunnerSource>>,
): RunnerSources {
  return Object.fromEntries(
    RUNNER_PARAM_IDS.map((id) => [id, overrides?.[id] ?? bound[id].source]),
  ) as Record<RunnerParamId, RunnerSource>
}

/** The parameters the focus metrics drive, de-duplicated, in focus order. */
export function focusParamsOf(metricIds: readonly MetricId[]): RunnerParamId[] {
  const params: RunnerParamId[] = []
  for (const metric of metricIds) {
    const param = paramForMetric(metric)
    if (param !== null && !params.includes(param)) params.push(param)
  }
  return params
}

function sameEdge(a: SkeletonEdge, b: SkeletonEdge): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0])
}

/**
 * The knee parameters' accents, per leg: the segments that form the measured angle on the measured
 * leg. Knee flexion is the angle between thigh and shank, so both are accented; knee drive is the
 * thigh's angle, so the thigh alone. The other leg is not accented: it is not what the value reads.
 */
const SIDED_FOCUS_ACCENT: Partial<Record<RunnerParamId, readonly (readonly [string, string])[]>> = {
  peakSwingKneeBend: [
    ['hip', 'knee'],
    ['knee', 'ankle'],
  ],
  peakThighAngle: [['hip', 'knee']],
}

/**
 * The edges a focus parameter accents: on the leg it is annotated on (`side`) for the knee
 * parameters, every edge it shapes otherwise (or without a side).
 */
export function focusAccentEdges(paramId: RunnerParamId, side?: RunnerSide): readonly SkeletonEdge[] {
  const parts = SIDED_FOCUS_ACCENT[paramId]
  if (parts === undefined || side === undefined) return RUNNER_PARAM_SEGMENTS[paramId]
  return parts.map(([a, b]) => [`${side}_${a}` as KeypointName, `${side}_${b}` as KeypointName] as const)
}

/**
 * `'focus'` when a measured focus parameter accents the edge (`focusAccentEdges`, on the leg in
 * `focusSides`), else `'measured'` when any measured parameter shapes it, else `'neutral'`. An
 * accented edge that no measured parameter shapes stays neutral: a dashed part is never accented
 * as if measured. Head edges belong to no parameter, so are always neutral.
 */
export function segmentStyle(
  edge: SkeletonEdge,
  sources: RunnerSources,
  focusParams: readonly RunnerParamId[],
  focusSides: Partial<Record<RunnerParamId, RunnerSide>> = {},
): SegmentStyle {
  const shapes = (id: RunnerParamId) =>
    sources[id] === 'measured' && RUNNER_PARAM_SEGMENTS[id].some((e) => sameEdge(e, edge))
  const accents = (id: RunnerParamId) =>
    sources[id] === 'measured' && focusAccentEdges(id, focusSides[id]).some((e) => sameEdge(e, edge))
  const measured = RUNNER_PARAM_IDS.some(shapes)
  if (measured && focusParams.some(accents)) return 'focus'
  return measured ? 'measured' : 'neutral'
}

const STYLE_RANK: Readonly<Record<SegmentStyle, number>> = { neutral: 0, measured: 1, focus: 2 }

/** Each joint takes its strongest incident edge's style; head joints are always neutral. */
export function jointStyles(edgeStyles: readonly SegmentStyle[]): SegmentStyle[] {
  return COMMON_KEYPOINT_NAMES.map((name, j) => {
    if (HEAD_JOINTS.has(name)) return 'neutral'
    let best: SegmentStyle = 'neutral'
    EDGE_JOINT_INDICES.forEach(([a, b], i) => {
      if ((a === j || b === j) && STYLE_RANK[edgeStyles[i]] > STYLE_RANK[best]) best = edgeStyles[i]
    })
    return best
  })
}

export interface DrawOrder {
  /** Edge indices, farthest first. */
  edges: number[]
  /** Joint indices, farthest first. */
  joints: number[]
  farEdge: boolean[]
  farJoint: boolean[]
}

/**
 * Painter's order for the pose at `phase` (the held phase) seen through `camera`, far to near, and
 * which parts sit far enough behind hip-mid to draw dimmed. Fixed per camera and parameter set,
 * not per frame.
 */
export function drawOrder(
  values: RunnerParams,
  camera: CameraPreset | CameraState,
  phase: number = GAIT_PHASES.midStance,
): DrawOrder {
  const projected = projectPose(poseAt(phase, values), camera)
  const depth = projected.map((p) => p.depth)
  const hip = (depth[JOINT_INDEX.get('left_hip') as number] + depth[JOINT_INDEX.get('right_hip') as number]) / 2
  const edgeDepth = EDGE_JOINT_INDICES.map(([a, b]) => (depth[a] + depth[b]) / 2)
  const byDepth = (d: readonly number[]) =>
    d.map((_, i) => i).sort((i, k) => d[i] - d[k] || i - k)
  return {
    edges: byDepth(edgeDepth),
    joints: byDepth(depth),
    farEdge: edgeDepth.map((d) => d < hip - FAR_DEPTH),
    farJoint: depth.map((d) => d < hip - FAR_DEPTH),
  }
}

function paramLabel(bound: BoundRunnerParams, id: RunnerParamId): string {
  const param = bound[id]
  return METRIC_LABELS[param.source === 'measured' ? param.metricId : RUNNER_PARAM_SPECS[id].metrics[0].metric]
}

/**
 * The runner's text alternative: which parameters were measured from the clip, which are fixed
 * illustrative settings, and the value of each measured focus parameter. Static text, not live.
 */
export function describeRunner(
  bound: BoundRunnerParams,
  focusParams: readonly RunnerParamId[],
): string {
  const measured = RUNNER_PARAM_IDS.filter((id) => bound[id].source === 'measured')
  // A neutral parameter nothing draws (the stride) is no "fixed setting" the reader can see.
  const neutral = RUNNER_PARAM_IDS.filter(
    (id) => bound[id].source === 'neutral' && RUNNER_PARAM_SPECS[id].drawnWhenNeutral !== false,
  )
  const sentences = [
    measured.length > 0
      ? `Measured from your clip: ${measured.map((id) => paramLabel(bound, id)).join(', ')}.`
      : 'Nothing in this figure was measured from your clip.',
  ]
  if (neutral.length > 0) {
    sentences.push(
      `Fixed illustrative settings, not measured: ${neutral.map((id) => paramLabel(bound, id)).join(', ')}.`,
    )
  }
  const shown = focusParams.flatMap((id) => {
    const param = bound[id]
    if (param.source !== 'measured') return []
    const value = `${METRIC_LABELS[param.metricId]} ${formatRunnerValue(param.metricId, param.metricValue)}`
    return [
      param.clamped
        ? `${value}, drawn at a limit of the figure, not at the measured value`
        : value,
    ]
  })
  if (shown.length > 0) sentences.push(`Shown: ${shown.join('; ')}.`)
  return sentences.join(' ')
}

/** A stable identity for a camera prop, so an inline `CameraState` literal does not retarget. */
export function cameraKey(camera: CameraPreset | CameraState): string {
  if (typeof camera === 'string') return camera
  const { yawDeg, pitchDeg, zoom, target } = resolveCamera(camera)
  return [yawDeg, pitchDeg, zoom, target.x, target.y, target.z].join('|')
}

/** The camera a `cameraKey` names (inverse of `cameraKey`). */
export function cameraFromKey(key: string): CameraState {
  if (key in CAMERA_PRESETS) return CAMERA_PRESETS[key as CameraPreset]
  const [yawDeg, pitchDeg, zoom, x, y, z] = key.split('|').map(Number)
  return { yawDeg, pitchDeg, zoom, target: { x, y, z } }
}

/**
 * Whether any neutral edge has an endpoint inside the frame for this pose and camera: the
 * "Dashed: not measured" legend only explains dashes the reader can see.
 */
export function neutralEdgeInFrame(
  edgeStyles: readonly SegmentStyle[],
  values: RunnerParams,
  phase: number,
  camera: CameraPreset | CameraState,
): boolean {
  const projected = projectPose(poseAt(phase, values), camera)
  const inFrame = (j: number) =>
    Math.abs(projected[j].x) <= VIEW_HALF_WIDTH && Math.abs(projected[j].y) <= VIEW_HALF_HEIGHT
  return EDGE_JOINT_INDICES.some(
    ([a, b], i) => edgeStyles[i] === 'neutral' && (inFrame(a) || inFrame(b)),
  )
}

/**
 * A value tween's progress (0..1) at wall-clock `now`, from when its key first appeared. A
 * non-positive duration is already finished. Shared by the drawing and the cadence integration.
 */
export function valueTweenProgress(durationMs: number, startedAt: number, now: number): number {
  if (!(durationMs > 0)) return 1
  return Math.min(1, Math.max(0, (now - startedAt) / durationMs))
}

/**
 * The values a value tween draws at progress `t` (0..1, linear): each parameter named in `to`
 * runs from `from` (or `base`) to `to`; every other parameter stays at `base`. At t = 1 the
 * named parameters are exactly `to`.
 */
export function mixValues(
  base: RunnerParams,
  from: Partial<RunnerParams>,
  to: Partial<RunnerParams>,
  t: number,
): RunnerParams {
  const u = Math.min(1, Math.max(0, t))
  return Object.fromEntries(
    RUNNER_PARAM_IDS.map((id) => {
      const end = to[id]
      if (end === undefined || !Number.isFinite(end)) return [id, base[id]]
      if (u >= 1) return [id, end]
      const start = from[id] !== undefined && Number.isFinite(from[id]) ? (from[id] as number) : base[id]
      return [id, start + (end - start) * u]
    }),
  ) as Record<RunnerParamId, number>
}

export function easeInOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t))
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2
}

function fract(value: number): number {
  return value - Math.floor(value)
}

const PHASE_WINDOW_TOLERANCE = 1e-9

/**
 * The phase `delta` cycles on from `phase`. Without a window it runs round the whole cycle. With
 * one, a phase inside it loops inside it (past the end, it starts again from the window's start),
 * and a phase outside it plays on normally until it reaches the window: entering never jumps.
 */
export function advancePhase(phase: number, delta: number, window: PhaseWindow | null): number {
  if (!window) return fract(phase + delta)
  const offset = fract(phase - window.start)
  // The tolerance keeps a phase that rounding put a hair past the end looping, not leaving.
  if (offset > window.length + PHASE_WINDOW_TOLERANCE) return fract(phase + delta)
  const next = offset + delta
  return fract(window.start + (next > window.length ? (next - window.length) % window.length : next))
}

/** Where playback stands: its phase, and how much of a hold it still has to rest. */
export interface PlaybackState {
  phase: number
  holdLeftMs: number
}

/**
 * Playback `stepMs` of wall-clock time on, at `cyclesPerSecond` (cadence × rate). Outside a window,
 * or with none, this is `advancePhase`. Inside one, a step that would carry the phase past one of
 * the window's holds stops exactly on it and rests there for the hold's `ms` (wall-clock time, so
 * the rate does not stretch it), then plays on; a hold is taken once per pass because a phase
 * resting on it is no longer before it. Playback only ever moves forward.
 */
export function stepPlayback(
  state: PlaybackState,
  stepMs: number,
  cyclesPerSecond: number,
  window: PhaseWindow | null,
): PlaybackState {
  let ms = stepMs
  if (state.holdLeftMs > 0) {
    if (ms <= state.holdLeftMs) return { phase: state.phase, holdLeftMs: state.holdLeftMs - ms }
    ms -= state.holdLeftMs
  }
  const delta = (ms / 1000) * cyclesPerSecond
  if (window) {
    const offset = fract(state.phase - window.start)
    if (offset <= window.length + PHASE_WINDOW_TOLERANCE) {
      let first: { offset: number; hold: { phase: number; ms: number } } | null = null
      for (const hold of window.holds ?? []) {
        const at = fract(hold.phase - window.start)
        const ahead = at - PHASE_WINDOW_TOLERANCE > offset && at - PHASE_WINDOW_TOLERANCE <= offset + delta
        if (ahead && (first === null || at < first.offset)) first = { offset: at, hold }
      }
      if (first) return { phase: first.hold.phase, holdLeftMs: first.hold.ms }
    }
  }
  return { phase: advancePhase(state.phase, delta, window), holdLeftMs: 0 }
}

/** The playback rate the loop uses: non-finite or non-positive input plays at 1×. */
export function sanitizeRate(rate: number | undefined): number {
  return rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : 1
}

export type LabelAlign = 'start' | 'middle' | 'end'

export function labelAlign(side: LabelSide): LabelAlign {
  return side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle'
}

/**
 * A label's screen x kept inside the visible frame (default: the viewBox), from an estimated text
 * width (`chars` × a typical Inter advance), so a long value never runs off a narrow phone frame.
 */
export function clampLabelX(
  x: number,
  align: LabelAlign,
  chars: number,
  fontUnits: number,
  halfWidth: number = VIEW_HALF_WIDTH,
): number {
  const width = chars * fontUnits * LABEL_CHAR_WIDTH_EM
  const left = align === 'start' ? x : align === 'middle' ? x - width / 2 : x - width
  const pad = fontUnits * 0.4
  const min = -halfWidth + pad
  const max = halfWidth - pad - width
  const shift = max < min ? min - left : Math.min(max, Math.max(min, left)) - left
  return x + shift
}

export interface LabelLayout {
  x: number
  /** One baseline-centre y per line. */
  ys: number[]
}

/**
 * Where a label's lines go, in viewBox units: its block sits `gapUnits` beyond the projected
 * anchor on `side`, `offsetLines` line pitches further out above or below (a label stacked under
 * another in the same lane), then is kept inside the visible frame (default: the viewBox).
 */
export function placeLabel(
  anchor: { x: number; y: number },
  side: LabelSide,
  lines: readonly string[],
  fontUnits: number,
  gapUnits: number,
  offsetLines = 0,
  frame: DrawingFrame = VIEWBOX_FRAME,
): LabelLayout {
  const lineHeight = fontUnits * LABEL_LINE_HEIGHT
  const blockHeight = lines.length * lineHeight
  let x = anchor.x
  let centreY = anchor.y
  if (side === 'right') x += gapUnits
  else if (side === 'left') x -= gapUnits
  else if (side === 'below') centreY += gapUnits + blockHeight / 2 + offsetLines * lineHeight
  else centreY -= gapUnits + blockHeight / 2 + offsetLines * lineHeight
  const chars = Math.max(0, ...lines.map((line) => line.length))
  const limit = Math.max(0, frame.halfHeight - blockHeight / 2)
  centreY = Math.min(limit, Math.max(-limit, centreY))
  const first = centreY - ((lines.length - 1) * lineHeight) / 2
  return {
    x: clampLabelX(x, labelAlign(side), chars, fontUnits, frame.halfWidth),
    ys: lines.map((_, i) => first + i * lineHeight),
  }
}

/** A small clear margin the stride and whole-body frames keep round their outermost marks and labels, CSS px. */
export const STRIDE_FRAME_MARGIN_PX = 12
/** The bounce's own label beside its bracket: "of torso length" is its widest line. */
const BOUNCE_LABEL_CHARS = 'of torso length'.length

export interface StridePadInput {
  /** Projected units per label pixel (1 / the renderer's pixels per unit). */
  unitsPerPx: number
  /** The cadence label sits above the head. */
  headLabel: boolean
  /** The bounce's own bracket is drawn, labelled on its left. */
  bounceLabel: boolean
  /** Lines in vertical ratio's label under the stride (its value and caption, a clamp note). */
  strideLabelLines: number
}

/**
 * The stride frame's room for its labels, in projected units, sized as the renderer draws them
 * (`RUNNER_PX` over the live pixels per unit): one line and its gap above the head for cadence,
 * vertical ratio's label block under the stride, the bounce's label left of its bracket when that is
 * drawn, and a small margin everywhere. Nothing else is reserved.
 */
export function strideFramePad({ unitsPerPx, headLabel, bounceLabel, strideLabelLines }: StridePadInput): FramePad {
  const line = RUNNER_PX.label * LABEL_LINE_HEIGHT
  const margin = STRIDE_FRAME_MARGIN_PX
  const px = (value: number) => value * unitsPerPx
  return {
    left: px(margin + (bounceLabel ? RUNNER_PX.labelGapLeft + BOUNCE_LABEL_CHARS * RUNNER_PX.label * LABEL_CHAR_WIDTH_EM : 0)),
    right: px(margin),
    top: px(margin + (headLabel ? RUNNER_PX.labelGap + line : 0)),
    bottom: px(margin + RUNNER_PX.labelGap + strideLabelLines * line),
  }
}

export interface WholeBodyPadInput {
  /** Projected units per label pixel (1 / the renderer's pixels per unit). */
  unitsPerPx: number
  /** The cadence label sits above the head. */
  headLabel: boolean
  /** Footfall rings pulse at the feet (cadence): their largest radius below the ground. */
  beat: boolean
  /** Lines in the ground lane's labels under the ground (with their stacking gaps); 0: none. */
  groundLabelLines: number
}

/**
 * The whole-body frame's room, in projected units sized as the renderer draws its labels: the
 * cadence label over the head, the footfall rings or the ground lane's labels under the ground, and
 * a small margin everywhere.
 */
export function wholeBodyFramePad({ unitsPerPx, headLabel, beat, groundLabelLines }: WholeBodyPadInput): FramePad {
  const line = RUNNER_PX.label * LABEL_LINE_HEIGHT
  const margin = STRIDE_FRAME_MARGIN_PX
  const under = Math.max(
    beat ? RUNNER_PX.beatRingMax : 0,
    groundLabelLines > 0 ? RUNNER_PX.labelGap + groundLabelLines * line : 0,
  )
  return {
    left: margin * unitsPerPx,
    right: margin * unitsPerPx,
    top: (margin + (headLabel ? RUNNER_PX.labelGap + line : 0)) * unitsPerPx,
    bottom: (margin + under) * unitsPerPx,
  }
}
