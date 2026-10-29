/**
 * The model runner, drawn as SVG: a wireframe built from the reader's own numbers, measured parts
 * solid, unmeasured parts dashed grey, the focus area accented and annotated with its metric's
 * value (`openspec/changes/add-model-runner`, requirements on rendering).
 *
 * **React renders the element set; one rAF loop moves it.** A render happens only when props or
 * the play/visibility state change. Every frame, `draw` writes the projected pose straight onto
 * the rendered elements' attributes, so animation never re-renders React. The loop draws at most
 * thirty times a second, integrates phase (`phase += dt × cycles/s × rate`) so a cadence or rate
 * change never makes the figure jump, and runs only while there is something to move (playing, a
 * camera tween or a value tween), the tab is visible and the figure is on screen.
 *
 * **The still frame holds the focus's key phase.** Paused, under reduced motion, and on the first
 * frame, the figure stands at the first annotated focus parameter's key phase (`planAnnotations`),
 * so the annotated limb lies exactly on its mark; mid-stance without a keyed focus.
 *
 * **The landing camera follows the values, not a fixed point.** For `camera="landingSide"` the
 * renderer frames `landingCamera(values)` on the static values it draws (a bound change retargets
 * it, tweened like any camera change), holds the near leg's contact when still, and while playing
 * loops `LANDING_PHASE_WINDOW` around that contact, resting on its holds (`stepPlayback`). Entering
 * the window plays on into it; leaving the camera lets the phase run round the whole cycle again
 * from where it is. Paused on the landing camera, the figure stands at the held phase too. The
 * stride camera (`camera="strideSide"`) is framed the same way, on `strideCamera(values, vertical ratio)`, and
 * plays the whole cycle.
 *
 * **Cadence beats at the footfalls.** A cadence focus is labelled above the head with ground ticks
 * under the feet; while the figure plays (and motion is allowed) a ring flashes at each foot
 * as it lands, written by the loop from the live phase, so the rings beat at cadence × rate per
 * minute while the label keeps the real cadence. Still or under reduced motion there is no ring.
 *
 * **A still figure can show its measured moment's evidence image behind it, faintly** (`footage`,
 * `strides-zba4`). The headline metric's evidence image (the measured moment, with a paired
 * metric's fainter second moment ghosted over it, as its card shows it) is COPIED (never adopted:
 * the summary's card owns the canvas) to a blob URL and drawn greyscale as the svg's first child,
 * under everything, at 0.26 opacity. It shows only while the figure stands still at its held phase
 * with no camera or value tween running, only when that held phase is the footage metric's own key
 * leg phase (so the measured moment and the figure are the same point of the stride), and only
 * when the fit does not magnify the image past a clutter cap. The loop writes its transform
 * (`placeFootagePlate`: hip-anchored, uniformly scaled from segment lengths, mirrored for a
 * right-to-left clip) from the pose as drawn, so it follows the lift and the live camera. It is
 * the reader's footage, never a target: it is placed, never reshaped. While it is on offer the
 * legend says so in a few words and the text alternative in full.
 *
 * **Pausing with a limb focus stands the figure at its key phase**, as the landing camera always
 * has, so the limb meets its mark (and the footage plate can show). A cadence focus pauses where
 * it is: its beat reads at any phase.
 *
 * Size it through `className`: the figure fills its box, and the drawing fills what the caption
 * and controls leave.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { SKELETON_EDGES } from '../results/skeletonGeometry'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import {
  LANDING_PHASE_WINDOW,
  interpolateCamera,
  landingCamera,
  projectPoint,
  projectPose,
  strideCamera,
  type PhaseWindow,
} from './camera'
import {
  footageKeyPhase,
  heldLegFor,
  placeFootagePlate,
  type FootageFitInput,
} from './footagePlate'
import { GAIT_PHASES, GROUND_Y, cyclesPerSecond, pelvisHeight, poseAt } from './gaitModel'
import {
  beatEnvelope,
  circularDistance,
  planAnnotations,
  shownWhileStill,
  type AnnotationKind,
  type RunnerAnnotationLabel,
  type RunnerSide,
} from './runnerAnnotations'
import { flashAlign, flashAnchor, labelBox, placeFlash, pointsBox, type LabelBox } from './introFlash'
import { runnerParamValues } from './runnerParams'
import {
  CAMERA_TWEEN_MS,
  EDGE_JOINT_INDICES,
  FRAME_MS,
  FRAME_TOLERANCE_MS,
  MAX_FRAME_STEP_MS,
  RUNNER_PARAM_IDS,
  RUNNER_PX,
  VIEW_HALF_HEIGHT,
  VIEW_HALF_WIDTH,
  cameraFromKey,
  cameraKey,
  describeRunner,
  drawOrder,
  easeInOutCubic,
  edgeKey,
  effectiveSources,
  focusParamsOf,
  jointStyles,
  labelAlign,
  mixValues,
  neutralEdgeInFrame,
  partOpacity,
  placeLabel,
  sanitizeRate,
  segmentStyle,
  stepPlayback,
  valueTweenProgress,
  type RunnerSource,
  type SegmentStyle,
} from './runnerScene'
import { useForcedColors } from './useForcedColors'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import type {
  BoundRunnerParams,
  CameraPreset,
  CameraState,
  MetricId,
  RunnerParamId,
  RunnerParams,
  Vec3,
} from './types'

export interface RunnerFocus {
  /** Mapped through `paramForMetric`; `stepWidthCm` drives nothing, `verticalRatio` the stride. */
  metricIds: readonly MetricId[]
  /** Keep only this kind of annotation. Absent: each focus parameter's natural kind. */
  annotation?: AnnotationKind
}

/**
 * A tween of parameter values run by the renderer's own loop, so a multi-second intro never
 * re-renders React per frame. It starts when its `key` first appears and runs linearly over
 * `durationMs` from `from` (missing ids: the base values) to `to`; ids not named in `to` stay at
 * the base values. Progress is WALL-CLOCK time since the key first appeared
 * (`performance.now()`), so it stays in step with the caller's own timers: while the tab is hidden
 * or the figure offscreen the loop stops, and it resumes at the right progress. A non-positive
 * `durationMs` is already finished. It runs while the runner is paused (like a camera tween) and
 * jumps to `to` under reduced motion. Once finished it holds `to` exactly for as long as the same
 * key is passed. **The key is the identity:** passing the same key with a different `from`, `to`
 * or `durationMs` is ignored; use a new key for a new tween.
 */
export interface RunnerValueTween {
  from: Partial<RunnerParams>
  to: Partial<RunnerParams>
  durationMs: number
  key: string | number
}

/**
 * The intro beat's seam (ps19.3). Without it the runner draws exactly `params`.
 *
 * `values`, `sources` and `flash` are for DISCRETE changes: each new object re-renders the
 * runner once. Continuous motion goes through `valueTween`, which the loop interpolates.
 */
export interface RunnerOverrides {
  /** Drawn instead of `params[id].value`. */
  values?: Partial<RunnerParams>
  /** Drawn instead of `params[id].source` (a parameter not yet applied draws neutral). */
  sources?: Partial<Record<RunnerParamId, RunnerSource>>
  /**
   * A short label for a parameter as it is applied, beside a fixed point of its part (frozen for
   * as long as the same flash and values are passed, never following the stride) and clear of
   * the visible annotation labels.
   */
  flash?: { paramId: RunnerParamId; text: string } | null
  /**
   * Interpolated per frame by the loop, on top of `values`. While it is passed, the focus
   * annotations of the parameters in its `to` are hidden (the flash speaks for them).
   */
  valueTween?: RunnerValueTween | null
}

/** The intro beat's controls (ps19.3, `useRunnerIntro`). */
export interface RunnerIntroControl {
  /**
   * While true (and motion is allowed) a "Skip intro" button sits beside Play/Pause, Pause also
   * skips, and the legend reads "Dashed: not applied yet".
   */
  running: boolean
  onSkip: () => void
}

/**
 * The headline metric's evidence image, placed behind a still figure (`src/results/runnerFootagePlate`
 * builds it and applies every gate that does not depend on the figure being drawn: side clip, side
 * camera, a metric with a hip, a knee or ankle and a key leg phase, a known travel direction).
 */
export interface RunnerFootage extends FootageFitInput {
  /** The metric the image was measured for. The plate shows only at its key leg phase. */
  metric: MetricId
  /** The extracted evidence canvas. Read once into a copy, never moved or drawn into. */
  image: HTMLCanvasElement
  /** Appended to the text alternative while the plate is on offer. */
  note: string
}

/** The legend's line while the footage plate is on offer: what the faint picture is, briefly. */
export const PLATE_LEGEND = 'Faint photo: your clip, not a target'
export const PLATE_LEGEND_FLIPPED = ' · flipped'

export interface ModelRunnerProps {
  params: BoundRunnerParams
  camera: CameraPreset | CameraState
  focus?: RunnerFocus
  /** Default 1; a non-finite or non-positive rate plays at 1. */
  playbackRate?: number
  /** The figure's accessible name. */
  label: string
  overrides?: RunnerOverrides
  intro?: RunnerIntroControl
  /**
   * Called with whether the figure is seen (tab visible and on screen): on mount, on every change,
   * and with false on unmount.
   */
  onActiveChange?: (active: boolean) => void
  /** The footage plate's source; absent or null: no plate. */
  footage?: RunnerFootage | null
  className?: string
}

export const RUNNER_CAPTION = 'Model built from your numbers'

// Forced colours: system colours, so measured, neutral and focus parts stay distinct.
const SEGMENT_CLASS: Readonly<Record<SegmentStyle, string>> = {
  focus: 'stroke-cyan-700 dark:stroke-cyan-300 forced-colors:stroke-[color:Highlight]',
  measured: 'stroke-neutral-900 dark:stroke-neutral-100 forced-colors:stroke-[color:CanvasText]',
  neutral: 'stroke-neutral-500 forced-colors:stroke-[color:GrayText]',
}
const JOINT_CLASS: Readonly<Record<SegmentStyle, string>> = {
  focus: 'fill-cyan-700 dark:fill-cyan-300 forced-colors:fill-[color:Highlight]',
  measured: 'fill-neutral-900 dark:fill-neutral-100 forced-colors:fill-[color:CanvasText]',
  neutral: 'fill-neutral-500 forced-colors:fill-[color:GrayText]',
}
const SEGMENT_STROKE_PX: Readonly<Record<SegmentStyle, number>> = {
  focus: RUNNER_PX.focusStroke,
  measured: RUNNER_PX.measuredStroke,
  neutral: RUNNER_PX.neutralStroke,
}
const MARK_CLASS = 'stroke-cyan-700 dark:stroke-cyan-300 forced-colors:stroke-[color:Highlight]'
const FILL_CLASS = 'fill-cyan-700/15 dark:fill-cyan-300/20 forced-colors:fill-none'
const GUIDE_CLASS =
  'stroke-neutral-500 dark:stroke-neutral-400 forced-colors:stroke-[color:CanvasText]'
const GROUND_CLASS =
  'stroke-neutral-300 dark:stroke-neutral-700 forced-colors:stroke-[color:GrayText]'
// The footage plate: hidden until the loop marks it shown, then faded in to a faint 0.26, also on
// its first appearance (`starting:`, important so it wins the starting style over the shown rule).
// Greyscale, so the evidence image's baked-in cyan and amber marks never read as a second accented
// limb beside the figure's own. No fade under reduced motion; under forced colours a photograph
// behind system-coloured strokes would only cost contrast, so it is not drawn.
const PLATE_CLASS =
  'opacity-0 grayscale transition-opacity duration-[240ms] ease-in-out data-[shown]:opacity-[0.26] starting:opacity-0! motion-reduce:transition-none forced-colors:hidden'
// The footfall ring: the focus accent, never a saturated red (WCAG 2.3.1, design D4).
const PULSE_CLASS = 'stroke-cyan-700 dark:stroke-cyan-300 forced-colors:stroke-[color:Highlight]'
const LABEL_CLASS =
  'fill-neutral-900 stroke-white font-sans font-semibold dark:fill-neutral-100 dark:stroke-black forced-colors:fill-[color:CanvasText] forced-colors:stroke-[color:Canvas]'

const CONTROL_CLASS =
  'min-h-11 min-w-11 shrink-0 border border-black px-3 py-2 font-sans text-xs font-semibold dark:border-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'

/** Pixels per viewBox unit before the stage has been measured (and in jsdom). */
const DEFAULT_PX_PER_UNIT = 100

/** "The figure is at this phase", as `shownWhileStill` reads it. */
const PHASE_TOLERANCE = 1e-6

interface DrawTargets {
  segments: { el: SVGLineElement; a: number; b: number }[]
  joints: { el: SVGCircleElement; j: number }[]
  /** `lifts`: the mark hangs off the figure, not the ground, so it rides the figure's height. */
  paths: { el: SVGPathElement; points: readonly Vec3[]; closed: boolean; lifts: boolean }[]
  labels: { lines: SVGTSpanElement[]; label: RunnerAnnotationLabel; lifts: boolean }[]
  /** Footfall rings: on the ground, so they never lift. */
  pulses: {
    el: SVGCircleElement
    tick: SVGPathElement | null
    tickPoints: readonly Vec3[]
    centre: Vec3
    phase: number
  }[]
  ground: SVGLineElement | null
  flash: { el: SVGTextElement; paramId: RunnerParamId; anchor: Vec3; chars: number } | null
  plate: SVGImageElement | null
}

interface Scene {
  /** The static values (bound plus `overrides.values`), before any value tween. */
  values: RunnerParams
  pxPerUnit: number
  targets: DrawTargets
  heldPhase: number
  /** The footage plate on offer (copied, still, keyed to the held phase); null: none. */
  plate: { input: FootageFitInput; heldLeg: RunnerSide } | null
}

/** A footage canvas's pixels, copied to a blob URL. */
interface PlateCopy {
  source: HTMLCanvasElement
  url: string
}

interface CameraTween {
  from: CameraState
  to: CameraState
  elapsedMs: number
}

interface ValueTweenState {
  key: string | number
  from: Partial<RunnerParams>
  to: Partial<RunnerParams>
  durationMs: number
  /** `performance.now()` when the key first appeared; -Infinity once jumped to the end. */
  startedAt: number
}

interface Live {
  active: boolean
  playing: boolean
  rate: number
  /** The span of the cycle playback loops over; null: the whole cycle. */
  window: PhaseWindow | null
}

function fmt(value: number): string {
  return value.toFixed(4)
}

function progressOf(tween: ValueTweenState, now: number): number {
  return valueTweenProgress(tween.durationMs, tween.startedAt, now)
}

function valueTweenRunning(tween: ValueTweenState | null, now: number): boolean {
  return tween !== null && progressOf(tween, now) < 1
}

/** The values drawn now: the static values, with any value tween applied. */
function drawnValues(base: RunnerParams, tween: ValueTweenState | null, now: number): RunnerParams {
  return tween ? mixValues(base, tween.from, tween.to, progressOf(tween, now)) : base
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true,
  )
}

/** On screen per IntersectionObserver; assumed on screen where it is unavailable. */
function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      const latest = entries[entries.length - 1]
      if (latest) setOnScreen(latest.isIntersecting)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return onScreen
}

/** CSS pixels per viewBox unit of the `meet`-fitted drawing, from a ResizeObserver. */
function useSvgPixelScale(ref: RefObject<Element | null>): number {
  const [scale, setScale] = useState(DEFAULT_PX_PER_UNIT)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect
      if (!box) return
      const next = Math.min(box.width / (2 * VIEW_HALF_WIDTH), box.height / (2 * VIEW_HALF_HEIGHT))
      if (next > 0) setScale(Math.round(next * 10) / 10)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return scale
}

type Annotations = ReturnType<typeof planAnnotations>['annotations']

/**
 * Paths that hang off the ground plane (landing, step width, the cadence ticks) stay put when the
 * figure's height changes; the others ride it.
 */
const GROUND_PATHS: ReadonlySet<RunnerParamId> = new Set(['landingOffset', 'stepWidth', 'cadence'])
/** Labels that hang off the ground plane. The cadence label hangs off the head, so it rides. */
const GROUND_LABELS: ReadonlySet<RunnerParamId> = new Set(['landingOffset', 'stepWidth'])

function pathLiftsWithFigure(annotation: Annotations[number]): boolean {
  return !GROUND_PATHS.has(annotation.paramId)
}

function labelLiftsWithFigure(annotation: Annotations[number]): boolean {
  return !GROUND_LABELS.has(annotation.paramId)
}

/** Foot joints, whose lowest point a still figure stands on. */
const FOOT_JOINT_INDICES = COMMON_KEYPOINT_NAMES.flatMap((name, i) =>
  /ankle|heel|foot_index/.test(name) ? [i] : [],
)

/**
 * How far a still pose must rise so its lowest foot point stands on the ground. Past the pin's
 * declared domain (a large overstride) the stance foot gives way below the ground mid-stance; a
 * moving figure passes through that in a few frames, but a held one would show it. No metric reads
 * absolute height, so the lift moves no bound value. Sub-nanometre sinks are left alone.
 */
function stillLift(pose: readonly Vec3[]): number {
  const sink = GROUND_Y - Math.min(...FOOT_JOINT_INDICES.map((i) => pose[i].y))
  return sink > 1e-9 ? sink : 0
}

/** A pose raised by `lift` (`stillLift`). */
function liftPose<T extends Vec3>(pose: readonly T[], lift: number): readonly T[] {
  return lift === 0 ? pose : pose.map((j) => ({ ...j, y: j.y + lift }))
}

/** The point raised by `dy`: a mark built at the static values, moved with a tweening figure. */
function lifted(point: Vec3, dy: number): Vec3 {
  return dy === 0 ? point : { x: point.x, y: point.y + dy, z: point.z }
}

function collectTargets(
  svg: SVGSVGElement,
  annotations: Annotations,
  flash: { paramId: RunnerParamId; anchor: Vec3; chars: number } | null,
): DrawTargets {
  const segments = Array.from(svg.querySelectorAll<SVGLineElement>('line[data-edge-index]'), (el) => {
    const [a, b] = EDGE_JOINT_INDICES[Number(el.dataset.edgeIndex)]
    return { el, a, b }
  })
  const joints = Array.from(svg.querySelectorAll<SVGCircleElement>('circle[data-joint-index]'), (el) => ({
    el,
    j: Number(el.dataset.jointIndex),
  }))
  const paths = Array.from(svg.querySelectorAll<SVGPathElement>('path[data-path]'), (el) => {
    const [annotation, role, index] = (el.dataset.path ?? '').split(':')
    const source = annotations[Number(annotation)]
    const list = role === 'm' ? source.marks : role === 'f' ? source.fills : source.guides
    return { el, points: list[Number(index)], closed: role === 'f', lifts: pathLiftsWithFigure(source) }
  })
  const labels = Array.from(
    svg.querySelectorAll<SVGTextElement>('text[data-label-index], text[data-tag-index]'),
    (el) => {
      const [annotation, tag] = (el.dataset.labelIndex ?? el.dataset.tagIndex ?? '')
        .split(':')
        .map(Number)
      const source = annotations[annotation]
      return {
        lines: Array.from(el.querySelectorAll('tspan')),
        label: tag === undefined ? source.label : (source.tags ?? [])[tag],
        lifts: labelLiftsWithFigure(source),
      }
    },
  )
  const pulses = Array.from(svg.querySelectorAll<SVGCircleElement>('circle[data-pulse]'), (el) => {
    const [annotation, index] = (el.dataset.pulse ?? '').split(':').map(Number)
    const source = annotations[annotation]
    const pulse = (source.pulses ?? [])[index]
    return {
      el,
      tick: svg.querySelector<SVGPathElement>(`path[data-pulse-tick="${annotation}:${index}"]`),
      tickPoints: source.guides[index] ?? [],
      centre: pulse.centre,
      phase: pulse.phase,
    }
  })
  const flashEl = svg.querySelector<SVGTextElement>('text[data-flash]')
  return {
    segments,
    joints,
    paths,
    labels,
    pulses,
    ground: svg.querySelector<SVGLineElement>('line[data-ground]'),
    flash: flashEl && flash ? { el: flashEl, ...flash } : null,
    plate: svg.querySelector<SVGImageElement>('image[data-footage-plate]'),
  }
}

function setPoint(el: Element, xName: string, yName: string, x: number, y: number): void {
  el.setAttribute(xName, fmt(x))
  el.setAttribute(yName, fmt(y))
}

export function ModelRunner({
  params,
  camera,
  focus,
  playbackRate,
  label,
  overrides,
  intro,
  onActiveChange,
  footage = null,
  className = '',
}: ModelRunnerProps) {
  const figureRef = useRef<HTMLElement>(null)
  const playButtonRef = useRef<HTMLButtonElement>(null)
  // Whether the Skip button holds focus, so its removal can hand focus on to Play/Pause.
  const skipFocusedRef = useRef(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const reduced = usePrefersReducedMotion()
  const forcedColors = useForcedColors()
  const visible = useDocumentVisible()
  const onScreen = useOnScreen(figureRef)
  const pxPerUnit = useSvgPixelScale(stageRef)
  // The reader's own choice, never reset by a focus or camera change.
  const [choice, setChoice] = useState<'play' | 'pause' | null>(null)
  const playing = choice === null ? !reduced : choice === 'play'
  const active = visible && onScreen
  const rate = sanitizeRate(playbackRate)

  const overrideValues = overrides?.values
  const values = useMemo<RunnerParams>(() => {
    const base = runnerParamValues(params)
    if (!overrideValues) return base
    return Object.fromEntries(
      RUNNER_PARAM_IDS.map((id) => {
        const override = overrideValues[id]
        return [id, override !== undefined && Number.isFinite(override) ? override : base[id]]
      }),
    ) as Record<RunnerParamId, number>
  }, [params, overrideValues])

  // The landing and stride cameras are framed on the static values, so their keys change only
  // when they do.
  const tracksContact = camera === 'landingSide'
  const presetKey = cameraKey(camera)
  const framedKey = useMemo(() => {
    if (camera === 'landingSide') return cameraKey(landingCamera(values))
    if (camera === 'strideSide') {
      const stride = params.strideLength
      return cameraKey(
        stride.source === 'measured' ? strideCamera(values, stride.metricValue) : strideCamera(values),
      )
    }
    return null
  }, [camera, values, params])
  const targetKey = framedKey ?? presetKey
  const target = useMemo(() => cameraFromKey(targetKey), [targetKey])
  const phaseWindow = tracksContact ? LANDING_PHASE_WINDOW : null
  const overrideSources = overrides?.sources
  const sources = useMemo(
    () => effectiveSources(params, overrideSources),
    [params, overrideSources],
  )
  const focusMetrics = focus?.metricIds
  const focusParams = useMemo(() => focusParamsOf(focusMetrics ?? []), [focusMetrics])
  const annotationKind = focus?.annotation
  const { heldPhase, annotations: allAnnotations } = useMemo(
    () =>
      planAnnotations({
        bound: params,
        values,
        sources,
        focusParams,
        kind: annotationKind,
        cameraYawDeg: target.yawDeg,
        heldPhaseWithoutKey: tracksContact ? GAIT_PHASES.rightContact : undefined,
      }),
    [params, values, sources, focusParams, annotationKind, target.yawDeg, tracksContact],
  )
  // A limb focus keys the still frame to a leg phase; a cadence beat reads at any phase.
  const limbKeyed = allAnnotations.some((a) => a.kind !== 'beat' && a.keyPhase !== null)
  // A still figure shows a limb mark only at its key phase; a playing one shows every mark.
  const valueTween = overrides?.valueTween ?? null
  // A parameter tweening in shows only its flash: its annotation would duplicate the value and
  // draw the arc at the neutral geometry it is leaving.
  const tweening = valueTween ? Object.keys(valueTween.to).join(',') : ''
  const annotations = useMemo(() => {
    const hidden = new Set(tweening.split(','))
    return allAnnotations.filter(
      (a) => !hidden.has(a.paramId) && (playing || shownWhileStill(a, heldPhase)),
    )
  }, [playing, allAnnotations, heldPhase, tweening])
  const edgeStyles = useMemo(
    () => SKELETON_EDGES.map((edge) => segmentStyle(edge, sources, focusParams)),
    [sources, focusParams],
  )
  const focusShown = edgeStyles.includes('focus')
  const jointStyleList = useMemo(() => jointStyles(edgeStyles), [edgeStyles])
  const order = useMemo(() => drawOrder(values, target, heldPhase), [values, target, heldPhase])
  const description = useMemo(() => describeRunner(params, focusParams), [params, focusParams])
  const legend = useMemo(
    () => neutralEdgeInFrame(edgeStyles, values, heldPhase, target),
    [edgeStyles, values, heldPhase, target],
  )
  // Footfall rings move, so only a playing figure with motion allowed draws them; the landing
  // window's contact hold would freeze one at full strength, so not there either.
  const showPulses = playing && !reduced && phaseWindow === null
  const flash = overrides?.flash ?? null
  const introRunning = intro?.running === true && !reduced
  // The flash's world point, taken once per flash from the values its tween ends at.
  const flashPoint = useMemo(() => {
    if (!flash) return null
    const end = valueTween ? mixValues(values, valueTween.from, valueTween.to, 1) : values
    return {
      paramId: flash.paramId,
      anchor: flashAnchor(flash.paramId, end, heldPhase, target.yawDeg),
      chars: flash.text.length,
    }
  }, [flash, valueTween, values, heldPhase, target.yawDeg])

  // The footage plate. Its pixels are copied only while still (the copy is a PNG encode, never
  // worth doing mid-animation), kept for as long as the same canvas is passed, and dropped (then
  // revoked) as soon as another canvas or none is.
  const plateSource = footage?.image ?? null
  const [plateCopy, setPlateCopy] = useState<PlateCopy | null>(null)
  if (plateCopy !== null && plateCopy.source !== plateSource) setPlateCopy(null)
  useEffect(() => {
    if (plateSource === null || playing || plateCopy !== null) return
    let cancelled = false
    try {
      plateSource.toBlob((blob) => {
        if (!cancelled && blob !== null) setPlateCopy({ source: plateSource, url: URL.createObjectURL(blob) })
      })
    } catch {
      // A canvas that cannot be read back (tainted, no encoder): the figure simply has no plate.
    }
    return () => {
      cancelled = true
    }
  }, [plateSource, playing, plateCopy])
  useEffect(() => {
    if (plateCopy === null) return
    const { url } = plateCopy
    return () => URL.revokeObjectURL(url)
  }, [plateCopy])
  const heldLeg = heldLegFor(target.yawDeg)
  const plateKeyPhase = footage === null ? null : footageKeyPhase(footage.metric, heldLeg)
  const plateKeyed =
    footage !== null &&
    plateCopy !== null &&
    !playing &&
    !forcedColors &&
    plateKeyPhase !== null &&
    circularDistance(plateKeyPhase, heldPhase) < PHASE_TOLERANCE
  // Whether the plate is on offer: the same placement the loop draws once the figure rests (held
  // phase, still lift, target camera, static values), so the legend and the text alternative
  // never name a picture the clutter cap or the fit would refuse. During a camera tween the loop
  // hides the plate until the camera rests; the words stay, as they describe the frame it rests on.
  const plateShown = useMemo(() => {
    if (!plateKeyed || footage === null) return false
    const pose = poseAt(heldPhase, values)
    return placeFootagePlate(footage, projectPose(liftPose(pose, stillLift(pose)), target), heldLeg) !== null
  }, [plateKeyed, footage, heldPhase, values, target, heldLeg])
  const plateInput = useMemo(
    () => (plateShown && footage !== null ? { input: footage, heldLeg } : null),
    [plateShown, footage, heldLeg],
  )

  const phaseRef = useRef<number>(heldPhase)
  // Wall-clock ms still to rest on a landing hold (`stepPlayback`).
  const holdLeftRef = useRef(0)
  const heldPhaseRef = useRef(heldPhase)
  const reducedRef = useRef(reduced)
  const cameraNowRef = useRef<CameraState>(target)
  const appliedCameraKeyRef = useRef(targetKey)
  const cameraTweenRef = useRef<CameraTween | null>(null)
  const valueTweenRef = useRef<ValueTweenState | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const liveRef = useRef<Live>({ active, playing, rate, window: phaseWindow })
  // Whether the figure is still (reduced motion, paused): a still figure stands on the ground.
  const stillRef = useRef(!playing)
  const kickRef = useRef<() => void>(() => {})

  const drawRef = useRef(() => {
    const scene = sceneRef.current
    if (!scene) return
    const cam = cameraNowRef.current
    const unit = 1 / scene.pxPerUnit
    const now = performance.now()
    const drawn = drawnValues(scene.values, valueTweenRef.current, now)
    const pose = poseAt(phaseRef.current, drawn)
    // A still figure is lifted onto the ground; marks that ride the figure lift with it, ground
    // marks stay. Playing again drops the lift.
    const lift = stillRef.current ? stillLift(pose) : 0
    const projected = projectPose(liftPose(pose, lift), cam)
    const { segments, joints, paths, labels, pulses, ground, flash: flashTarget, plate } = scene.targets
    if (plate) {
      // Only on the held still frame, with nothing tweening: the image is of one measured moment,
      // so it is shown only while the figure is exactly that moment, framed where the camera rests.
      const fit =
        scene.plate !== null &&
        stillRef.current &&
        circularDistance(phaseRef.current, scene.heldPhase) < PHASE_TOLERANCE &&
        cameraTweenRef.current === null &&
        !valueTweenRunning(valueTweenRef.current, now)
          ? placeFootagePlate(scene.plate.input, projected, scene.plate.heldLeg)
          : null
      if (fit) {
        plate.setAttribute('transform', `matrix(${fmt(fit.a)} 0 0 ${fmt(fit.d)} ${fmt(fit.e)} ${fmt(fit.f)})`)
        plate.setAttribute('data-shown', '')
      } else {
        // Hidden in place: the transform stays put while it fades, never sliding with the figure.
        plate.removeAttribute('data-shown')
      }
    }
    for (const { el, a, b } of segments) {
      setPoint(el, 'x1', 'y1', projected[a].x, projected[a].y)
      setPoint(el, 'x2', 'y2', projected[b].x, projected[b].y)
    }
    for (const { el, j } of joints) setPoint(el, 'cx', 'cy', projected[j].x, projected[j].y)
    if (ground) {
      const groundY = fmt(projectPoint({ x: cam.target.x, y: GROUND_Y, z: cam.target.z }, cam).y)
      ground.setAttribute('y1', groundY)
      ground.setAttribute('y2', groundY)
    }
    // Boxes the flash keeps clear of: annotation marks and guides here, labels below.
    const boxes: LabelBox[] = []
    // Annotations are built at the static values; a value tween (the intro) can change the
    // figure's standing height, so marks that hang off the figure follow it.
    const figureDy =
      (drawn === scene.values ? 0 : pelvisHeight(drawn) - pelvisHeight(scene.values)) + lift
    for (const { el, points, closed, lifts } of paths) {
      const dy = lifts ? figureDy : 0
      const projectedPoints = points.map((point) => projectPoint(lifted(point, dy), cam))
      const d = projectedPoints
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`)
        .join('')
      el.setAttribute('d', closed ? `${d}Z` : d)
      const box = closed || !flashTarget ? null : pointsBox(projectedPoints)
      if (box) boxes.push(box)
    }
    const fontUnits = RUNNER_PX.label * unit
    for (const { lines, label: text, lifts } of labels) {
      const layout = placeLabel(
        projectPoint(lifted(text.anchor, lifts ? figureDy : 0), cam),
        text.side,
        text.lines,
        fontUnits,
        (text.side === 'left' ? RUNNER_PX.labelGapLeft : RUNNER_PX.labelGap) * unit,
        text.offsetLines,
      )
      lines.forEach((line, i) => setPoint(line, 'x', 'y', layout.x, layout.ys[i]))
      const chars = Math.max(0, ...text.lines.map((line) => line.length))
      boxes.push(labelBox(layout.x, labelAlign(text.side), layout.ys, chars, fontUnits))
    }
    for (const pulse of pulses) {
      const strength = beatEnvelope(phaseRef.current, pulse.phase)
      const at = projectPoint(pulse.centre, cam)
      const px = RUNNER_PX.beatRingMin + (RUNNER_PX.beatRingMax - RUNNER_PX.beatRingMin) * strength
      setPoint(pulse.el, 'cx', 'cy', at.x, at.y)
      pulse.el.setAttribute('r', fmt(px * unit))
      pulse.el.setAttribute('opacity', fmt(strength))
      if (pulse.tick) {
        const d = pulse.tickPoints
          .map((point, i) => {
            const p = projectPoint(point, cam)
            return `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`
          })
          .join('')
        pulse.tick.setAttribute('d', d)
        pulse.tick.setAttribute('opacity', fmt(strength))
      }
    }
    if (flashTarget) {
      const align = flashAlign(flashTarget.paramId, cam)
      const at = placeFlash(
        projectPoint(lifted(flashTarget.anchor, lift), cam),
        align,
        flashTarget.chars,
        fontUnits,
        RUNNER_PX.labelGap * 2 * unit,
        boxes,
      )
      setPoint(flashTarget.el, 'x', 'y', at.x, at.y)
      flashTarget.el.setAttribute('text-anchor', align)
    }
  })

  // After every render (props or play state, never per frame): point the loop at the elements
  // just rendered and draw them, so a paused figure redraws too.
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    stillRef.current = !playing
    sceneRef.current = {
      values,
      pxPerUnit,
      targets: collectTargets(svg, annotations, flashPoint),
      heldPhase,
      plate: plateInput,
    }
    drawRef.current()
  })

  // A camera change tweens from wherever the camera is now, so retargeting mid-tween stays
  // continuous. Reduced motion, a hidden tab or an offscreen figure cut instead.
  useLayoutEffect(() => {
    const cut = () => {
      cameraNowRef.current = target
      cameraTweenRef.current = null
      drawRef.current()
    }
    if (appliedCameraKeyRef.current === targetKey) {
      if (cameraTweenRef.current && (reduced || !active)) cut()
      return
    }
    appliedCameraKeyRef.current = targetKey
    if (reduced || !active) cut()
    else cameraTweenRef.current = { from: cameraNowRef.current, to: target, elapsedMs: 0 }
  }, [targetKey, target, reduced, active])

  // A value tween starts when its key first appears; reduced motion jumps it to the end.
  useLayoutEffect(() => {
    const current = valueTweenRef.current
    if (!valueTween) {
      if (current) {
        valueTweenRef.current = null
        drawRef.current()
      }
      return
    }
    if (!current || current.key !== valueTween.key) {
      valueTweenRef.current = {
        key: valueTween.key,
        from: valueTween.from,
        to: valueTween.to,
        durationMs: valueTween.durationMs,
        startedAt: performance.now(),
      }
    }
    const tween = valueTweenRef.current as ValueTweenState
    if (reduced) tween.startedAt = -Infinity
    drawRef.current()
  }, [valueTween, reduced])

  // The still frame: a new held phase (focus change) moves a still figure to it, and so does
  // reduced motion switching on while the reader has not chosen to play. On the landing camera,
  // and with a limb focus, every still state (pausing included) shows the held phase, so the marks
  // meet the drawn limb (and the footage plate can show). A cadence beat pauses where it is.
  useLayoutEffect(() => {
    const heldChanged = heldPhaseRef.current !== heldPhase
    const reducedStarted = reduced && !reducedRef.current && choice === null
    heldPhaseRef.current = heldPhase
    reducedRef.current = reduced
    if (!playing) holdLeftRef.current = 0
    const snapStill = (tracksContact || limbKeyed) && !playing && phaseRef.current !== heldPhase
    if ((heldChanged && !playing) || reducedStarted || snapStill) {
      phaseRef.current = heldPhase
      drawRef.current()
    }
  }, [heldPhase, reduced, choice, playing, tracksContact, limbKeyed])

  // Report whether the figure is seen, and that it no longer is once unmounted (an unmount-only
  // cleanup, so a parent holding `active` never keeps a stale true for a runner that is gone).
  const onActiveChangeRef = useRef(onActiveChange)
  useLayoutEffect(() => {
    onActiveChangeRef.current = onActiveChange
  })
  useEffect(() => {
    onActiveChangeRef.current?.(active)
  }, [active])
  useEffect(() => () => onActiveChangeRef.current?.(false), [])

  // A Skip button removed while focused would drop focus to the page: move it to Play/Pause.
  useLayoutEffect(() => {
    if (introRunning || !skipFocusedRef.current) return
    skipFocusedRef.current = false
    const focused = document.activeElement
    if (focused === null || focused === document.body) playButtonRef.current?.focus()
  }, [introRunning])

  // Hand the loop the latest play state and start or stop it (every render, after the effects
  // above have set up any tween).
  useLayoutEffect(() => {
    liveRef.current = { active, playing, rate, window: phaseWindow }
    kickRef.current()
  })

  // The loop itself, created once. It reads everything through refs.
  useEffect(() => {
    let raf = 0
    let lastDraw: number | null = null
    let nextDue = 0
    const wants = () => {
      const live = liveRef.current
      return (
        live.active &&
        (live.playing ||
          cameraTweenRef.current !== null ||
          valueTweenRunning(valueTweenRef.current, performance.now()))
      )
    }
    const stop = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      lastDraw = null
    }
    const tick = (now: number) => {
      raf = 0
      if (!wants()) {
        // A wall-clock value tween can finish between draws: draw its end state once, then stop.
        drawRef.current()
        stop()
        return
      }
      if (lastDraw === null || now < nextDue - FRAME_TOLERANCE_MS) {
        // The first frame after a (re)start only sets the clock, so resuming never jumps.
        if (lastDraw === null) {
          lastDraw = now
          nextDue = now + FRAME_MS
        }
        raf = requestAnimationFrame(tick)
        return
      }
      const stepMs = Math.min(now - lastDraw, MAX_FRAME_STEP_MS)
      lastDraw = now
      // Each draw pushes the next due time a whole frame on, so the long-run rate never exceeds
      // the cap; more than a frame behind (a stall), it restarts from now rather than bursting.
      nextDue += FRAME_MS
      if (nextDue < now) nextDue = now + FRAME_MS
      const live = liveRef.current
      const scene = sceneRef.current
      if (live.playing && scene) {
        const drawn = drawnValues(scene.values, valueTweenRef.current, performance.now())
        const next = stepPlayback(
          { phase: phaseRef.current, holdLeftMs: live.window ? holdLeftRef.current : 0 },
          stepMs,
          cyclesPerSecond(drawn) * live.rate,
          live.window,
        )
        phaseRef.current = next.phase
        holdLeftRef.current = next.holdLeftMs
      }
      const cameraTween = cameraTweenRef.current
      if (cameraTween) {
        cameraTween.elapsedMs += stepMs
        const t = cameraTween.elapsedMs / CAMERA_TWEEN_MS
        if (t >= 1) {
          cameraNowRef.current = cameraTween.to
          cameraTweenRef.current = null
        } else {
          cameraNowRef.current = interpolateCamera(cameraTween.from, cameraTween.to, easeInOutCubic(t))
        }
      }
      drawRef.current()
      if (wants()) raf = requestAnimationFrame(tick)
      else stop()
    }
    kickRef.current = () => {
      if (!wants()) stop()
      else if (!raf) raf = requestAnimationFrame(tick)
    }
    kickRef.current()
    return () => {
      stop()
      kickRef.current = () => {}
    }
  }, [])

  const unit = 1 / pxPerUnit
  return (
    <figure ref={figureRef} aria-label={label} className={`flex flex-col ${className}`}>
      <figcaption data-runner-part="caption" className="pb-1 font-sans text-xs text-neutral-700 dark:text-neutral-300">
        {RUNNER_CAPTION}
      </figcaption>
      <div ref={stageRef} data-runner-part="stage" className="relative min-h-0 flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          data-runner-part="drawing"
          aria-hidden="true"
          focusable="false"
          viewBox={`${-VIEW_HALF_WIDTH} ${-VIEW_HALF_HEIGHT} ${2 * VIEW_HALF_WIDTH} ${2 * VIEW_HALF_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full"
        >
          {/* First, so it sits under everything; the unit square, placed by the loop's transform. */}
          {plateCopy !== null && (
            <image
              data-footage-plate=""
              href={plateCopy.url}
              x={0}
              y={0}
              width={1}
              height={1}
              preserveAspectRatio="none"
              className={PLATE_CLASS}
            />
          )}
          <line
            data-ground=""
            x1={-10}
            x2={10}
            className={GROUND_CLASS}
            strokeWidth={RUNNER_PX.groundStroke * unit}
          />
          <g data-segments="">
            {order.edges.map((i) => {
              const style = edgeStyles[i]
              const dash = RUNNER_PX.neutralDash * unit
              const opacity = partOpacity(style, order.farEdge[i], focusShown)
              return (
                <line
                  key={edgeKey(SKELETON_EDGES[i])}
                  data-edge={edgeKey(SKELETON_EDGES[i])}
                  data-edge-index={i}
                  data-style={style}
                  className={SEGMENT_CLASS[style]}
                  strokeWidth={SEGMENT_STROKE_PX[style] * unit}
                  // Butt caps on dashes: round ones would close the gaps up.
                  strokeLinecap={style === 'neutral' ? 'butt' : 'round'}
                  strokeDasharray={style === 'neutral' ? `${dash} ${dash}` : undefined}
                  opacity={opacity < 1 ? opacity : undefined}
                />
              )
            })}
          </g>
          <g data-joints="">
            {order.joints.map((j) => {
              const style = jointStyleList[j]
              const opacity = partOpacity(style, order.farJoint[j], focusShown)
              return (
                <circle
                  key={COMMON_KEYPOINT_NAMES[j]}
                  data-joint={COMMON_KEYPOINT_NAMES[j]}
                  data-joint-index={j}
                  data-style={style}
                  className={JOINT_CLASS[style]}
                  r={(style === 'focus' ? RUNNER_PX.focusJoint : RUNNER_PX.joint) * unit}
                  opacity={opacity < 1 ? opacity : undefined}
                />
              )
            })}
          </g>
          <g data-annotations="">
            {annotations.map((annotation, a) => (
              <g key={annotation.paramId} data-annotation={annotation.paramId} data-kind={annotation.kind}>
                {annotation.fills.map((_, i) => (
                  <path key={`fill-${i}`} data-path={`${a}:f:${i}`} data-role="fill" className={FILL_CLASS} />
                ))}
                {annotation.guides.map((_, i) => (
                  <path
                    key={`guide-${i}`}
                    data-path={`${a}:g:${i}`}
                    data-role="guide"
                    fill="none"
                    className={GUIDE_CLASS}
                    strokeWidth={RUNNER_PX.guideStroke * unit}
                  />
                ))}
                {annotation.marks.map((_, i) => (
                  <path
                    key={`mark-${i}`}
                    data-path={`${a}:m:${i}`}
                    data-role="mark"
                    fill="none"
                    className={MARK_CLASS}
                    strokeWidth={RUNNER_PX.markStroke * unit}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                <text
                  data-label-index={a}
                  textAnchor={labelAlign(annotation.label.side)}
                  dominantBaseline="middle"
                  paintOrder="stroke"
                  className={LABEL_CLASS}
                  fontSize={RUNNER_PX.label * unit}
                  strokeWidth={RUNNER_PX.labelHalo * unit}
                  strokeLinejoin="round"
                >
                  {annotation.label.lines.map((line, i) => (
                    <tspan key={i}>{line}</tspan>
                  ))}
                </text>
                {(annotation.tags ?? []).map((tag, k) => (
                  <text
                    key={`tag-${k}`}
                    data-tag-index={`${a}:${k}`}
                    textAnchor={labelAlign(tag.side)}
                    dominantBaseline="middle"
                    paintOrder="stroke"
                    className={LABEL_CLASS}
                    fontSize={RUNNER_PX.label * unit}
                    strokeWidth={RUNNER_PX.labelHalo * unit}
                    strokeLinejoin="round"
                  >
                    {tag.lines.map((line, i) => (
                      <tspan key={i}>{line}</tspan>
                    ))}
                  </text>
                ))}
                {showPulses &&
                  (annotation.pulses ?? []).map((_, i) => (
                    <g key={`pulse-${i}`}>
                      <path
                        data-pulse-tick={`${a}:${i}`}
                        fill="none"
                        className={PULSE_CLASS}
                        strokeWidth={RUNNER_PX.markStroke * unit}
                        strokeLinecap="round"
                        opacity={0}
                      />
                      <circle
                        data-pulse={`${a}:${i}`}
                        fill="none"
                        className={PULSE_CLASS}
                        strokeWidth={RUNNER_PX.beatRingStroke * unit}
                        opacity={0}
                      />
                    </g>
                  ))}
              </g>
            ))}
          </g>
          {flash && (
            <text
              data-flash={flash.paramId}
              dominantBaseline="middle"
              paintOrder="stroke"
              className={LABEL_CLASS}
              fontSize={RUNNER_PX.label * unit}
              strokeWidth={RUNNER_PX.labelHalo * unit}
              strokeLinejoin="round"
            >
              {flash.text}
            </text>
          )}
        </svg>
      </div>
      <p className="sr-only">
        {description}
        {plateShown && footage !== null ? ` ${footage.note}` : ''}
      </p>
      <div data-runner-part="controls" className="flex items-center justify-between gap-3 pt-2">
        <p aria-hidden="true" className="min-w-0 font-sans text-xs text-neutral-600 dark:text-neutral-400">
          {legend ? (introRunning ? 'Dashed: not applied yet' : 'Dashed: not measured') : ''}
          {plateShown && footage !== null && (
            <span data-plate-legend="" className="block">
              {PLATE_LEGEND}
              {footage.mirror ? PLATE_LEGEND_FLIPPED : ''}
            </span>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {introRunning && (
            <button
              type="button"
              onClick={intro?.onSkip}
              onFocus={() => {
                skipFocusedRef.current = true
              }}
              onBlur={() => {
                skipFocusedRef.current = false
              }}
              className={CONTROL_CLASS}
            >
              Skip intro
            </button>
          )}
          <button
            ref={playButtonRef}
            type="button"
            aria-label={playing ? 'Pause runner' : 'Play runner'}
            onClick={() => {
              // Pausing mid-intro skips it: the still figure is the final one.
              if (introRunning && playing) intro?.onSkip()
              setChoice(playing ? 'pause' : 'play')
            }}
            className={CONTROL_CLASS}
          >
            <span aria-hidden="true" className="mr-1.5 inline-block w-3 text-center">
              {playing ? '❚❚' : '▶'}
            </span>
            {playing ? 'Pause' : 'Play'}
          </button>
        </div>
      </div>
    </figure>
  )
}
