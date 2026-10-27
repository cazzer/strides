/**
 * The model runner, drawn as SVG: a wireframe built from the reader's own numbers, measured parts
 * solid, unmeasured parts dashed grey, the focus area accented and annotated with its metric's
 * value (`openspec/changes/add-model-runner`, requirements on rendering).
 *
 * **React renders the element set; one rAF loop moves it.** A render happens only when props or
 * the play/visibility state change. Every frame, `draw` writes the projected pose straight onto
 * the rendered elements' attributes, so animation never re-renders React. The loop draws at most
 * thirty times a second, integrates phase (`phase += dt × cycles/s × rate`) so a cadence or rate
 * change never makes the figure jump, and runs only while playing (or tweening the camera), the
 * tab is visible and the figure is on screen.
 *
 * Size it through `className`: the figure fills its box, and the drawing fills what the caption
 * and controls leave.
 */
import {
  useCallback,
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
import { interpolateCamera, projectPoint, projectPose, resolveCamera } from './camera'
import { GAIT_PHASES, cyclesPerSecond, poseAt } from './gaitModel'
import {
  buildAnnotations,
  type AnnotationKind,
  type RunnerAnnotationLabel,
} from './runnerAnnotations'
import { RUNNER_PARAM_SEGMENTS, runnerParamValues } from './runnerParams'
import {
  CAMERA_TWEEN_MS,
  EDGE_JOINT_INDICES,
  FAR_OPACITY,
  FRAME_MS,
  FRAME_TOLERANCE_MS,
  MAX_FRAME_STEP_MS,
  RUNNER_PARAM_IDS,
  RUNNER_PX,
  VIEW_HALF_HEIGHT,
  VIEW_HALF_WIDTH,
  cameraKey,
  describeRunner,
  drawOrder,
  easeInOutCubic,
  edgeKey,
  effectiveSources,
  focusParamsOf,
  jointStyles,
  labelAlign,
  placeLabel,
  sanitizeRate,
  segmentStyle,
  type RunnerSource,
  type SegmentStyle,
} from './runnerScene'
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
  /** Mapped through `paramForMetric`; `verticalRatio` and `stepWidthCm` drive nothing. */
  metricIds: readonly MetricId[]
  /** Keep only this kind of annotation. Absent: each focus parameter's natural kind. */
  annotation?: AnnotationKind
}

/**
 * The intro beat's seam (ps19.3). Without it the runner draws exactly `params`. Each field is
 * read whenever it changes, so step it no faster than the parameters actually change.
 */
export interface RunnerOverrides {
  /** Drawn instead of `params[id].value` (a parameter mid-tween). */
  values?: Partial<RunnerParams>
  /** Drawn instead of `params[id].source` (a parameter not yet applied draws neutral). */
  sources?: Partial<Record<RunnerParamId, RunnerSource>>
  /** A short label beside a parameter's part, e.g. its value as it is applied. */
  flash?: { paramId: RunnerParamId; text: string } | null
}

export interface ModelRunnerProps {
  params: BoundRunnerParams
  camera: CameraPreset | CameraState
  focus?: RunnerFocus
  /** Default 1; a non-finite or non-positive rate plays at 1. */
  playbackRate?: number
  /** The figure's accessible name. */
  label: string
  overrides?: RunnerOverrides
  className?: string
}

export const RUNNER_CAPTION = 'Model built from your numbers'

const SEGMENT_CLASS: Readonly<Record<SegmentStyle, string>> = {
  focus: 'stroke-cyan-700 dark:stroke-cyan-300',
  measured: 'stroke-neutral-900 dark:stroke-neutral-100',
  neutral: 'stroke-neutral-500',
}
const JOINT_CLASS: Readonly<Record<SegmentStyle, string>> = {
  focus: 'fill-cyan-700 dark:fill-cyan-300',
  measured: 'fill-neutral-900 dark:fill-neutral-100',
  neutral: 'fill-neutral-500',
}
const SEGMENT_STROKE_PX: Readonly<Record<SegmentStyle, number>> = {
  focus: RUNNER_PX.focusStroke,
  measured: RUNNER_PX.measuredStroke,
  neutral: RUNNER_PX.neutralStroke,
}
const LABEL_CLASS =
  'fill-neutral-900 stroke-white font-sans font-semibold dark:fill-neutral-100 dark:stroke-black'

/** Pixels per viewBox unit before the stage has been measured (and in jsdom). */
const DEFAULT_PX_PER_UNIT = 100

interface DrawTargets {
  segments: { el: SVGLineElement; a: number; b: number }[]
  joints: { el: SVGCircleElement; j: number }[]
  paths: { el: SVGPathElement; points: readonly Vec3[] }[]
  labels: { lines: SVGTSpanElement[]; label: RunnerAnnotationLabel }[]
  ground: SVGLineElement | null
  flash: { el: SVGTextElement; paramId: RunnerParamId } | null
}

interface Scene {
  values: RunnerParams
  pxPerUnit: number
  targets: DrawTargets
}

interface CameraTween {
  from: CameraState
  to: CameraState
  elapsedMs: number
}

function fract(value: number): number {
  return value - Math.floor(value)
}

function fmt(value: number): string {
  return value.toFixed(4)
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

function collectTargets(
  svg: SVGSVGElement,
  annotations: ReturnType<typeof buildAnnotations>,
  flashParam: RunnerParamId | null,
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
    return { el, points: (role === 'm' ? source.marks : source.guides)[Number(index)] }
  })
  const labels = Array.from(svg.querySelectorAll<SVGTextElement>('text[data-label-index]'), (el) => ({
    lines: Array.from(el.querySelectorAll('tspan')),
    label: annotations[Number(el.dataset.labelIndex)].label,
  }))
  const flashEl = svg.querySelector<SVGTextElement>('text[data-flash]')
  return {
    segments,
    joints,
    paths,
    labels,
    ground: svg.querySelector<SVGLineElement>('line[data-ground]'),
    flash: flashEl && flashParam ? { el: flashEl, paramId: flashParam } : null,
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
  className = '',
}: ModelRunnerProps) {
  const figureRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const reduced = usePrefersReducedMotion()
  const visible = useDocumentVisible()
  const onScreen = useOnScreen(figureRef)
  const pxPerUnit = useSvgPixelScale(stageRef)
  // The reader's own choice, never reset by a focus or camera change.
  const [choice, setChoice] = useState<'play' | 'pause' | null>(null)
  const playing = choice === null ? !reduced : choice === 'play'
  const active = visible && onScreen
  const rate = sanitizeRate(playbackRate)

  const target = resolveCamera(camera)
  const targetKey = cameraKey(camera)
  const nearSide = Math.cos((target.yawDeg * Math.PI) / 180) >= 0 ? 'right' : 'left'

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
  const overrideSources = overrides?.sources
  const sources = useMemo(
    () => effectiveSources(params, overrideSources),
    [params, overrideSources],
  )
  const focusMetrics = focus?.metricIds
  const focusParams = useMemo(() => focusParamsOf(focusMetrics ?? []), [focusMetrics])
  const annotationKind = focus?.annotation
  const annotations = useMemo(
    () =>
      buildAnnotations({ bound: params, values, sources, focusParams, kind: annotationKind, nearSide }),
    [params, values, sources, focusParams, annotationKind, nearSide],
  )
  const edgeStyles = useMemo(
    () => SKELETON_EDGES.map((edge) => segmentStyle(edge, sources, focusParams)),
    [sources, focusParams],
  )
  const jointStyleList = useMemo(() => jointStyles(edgeStyles), [edgeStyles])
  const order = useMemo(() => drawOrder(values, target), [values, target])
  const description = useMemo(() => describeRunner(params, focusParams), [params, focusParams])
  const anyNeutral = edgeStyles.includes('neutral')
  const flash = overrides?.flash ?? null

  const phaseRef = useRef<number>(GAIT_PHASES.midStance)
  const cameraNowRef = useRef<CameraState>(target)
  const appliedCameraKeyRef = useRef(targetKey)
  const tweenRef = useRef<CameraTween | null>(null)
  const sceneRef = useRef<Scene | null>(null)

  const draw = useCallback(() => {
    const scene = sceneRef.current
    if (!scene) return
    const cam = cameraNowRef.current
    const unit = 1 / scene.pxPerUnit
    const projected = projectPose(poseAt(phaseRef.current, scene.values), cam)
    const { segments, joints, paths, labels, ground, flash: flashTarget } = scene.targets
    for (const { el, a, b } of segments) {
      setPoint(el, 'x1', 'y1', projected[a].x, projected[a].y)
      setPoint(el, 'x2', 'y2', projected[b].x, projected[b].y)
    }
    for (const { el, j } of joints) setPoint(el, 'cx', 'cy', projected[j].x, projected[j].y)
    if (ground) {
      const groundY = fmt(projectPoint({ x: cam.target.x, y: 0, z: cam.target.z }, cam).y)
      ground.setAttribute('y1', groundY)
      ground.setAttribute('y2', groundY)
    }
    for (const { el, points } of paths) {
      el.setAttribute(
        'd',
        points
          .map((point, i) => {
            const p = projectPoint(point, cam)
            return `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`
          })
          .join(''),
      )
    }
    const fontUnits = RUNNER_PX.label * unit
    const maxY = VIEW_HALF_HEIGHT - fontUnits
    for (const { lines, label: text } of labels) {
      const layout = placeLabel(
        projectPoint(text.anchor, cam),
        text.side,
        text.lines,
        fontUnits,
        RUNNER_PX.labelGap * unit,
      )
      lines.forEach((line, i) => setPoint(line, 'x', 'y', layout.x, layout.ys[i]))
    }
    if (flashTarget) {
      const [edge] = RUNNER_PARAM_SEGMENTS[flashTarget.paramId]
      if (edge) {
        const a = projected[COMMON_KEYPOINT_NAMES.indexOf(edge[0])]
        const b = projected[COMMON_KEYPOINT_NAMES.indexOf(edge[1])]
        const x = Math.max(a.x, b.x) + 10 * unit
        setPoint(flashTarget.el, 'x', 'y', Math.min(x, VIEW_HALF_WIDTH - 4 * fontUnits), (a.y + b.y) / 2)
      } else {
        setPoint(flashTarget.el, 'x', 'y', -VIEW_HALF_WIDTH + fontUnits, -maxY)
      }
    }
  }, [])

  // After every render (props or play state, never per frame): point the loop at the elements
  // just rendered and draw them at the current phase, so a paused figure redraws too.
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    sceneRef.current = {
      values,
      pxPerUnit,
      targets: collectTargets(svg, annotations, flash?.paramId ?? null),
    }
    draw()
  })

  // A camera change tweens from wherever the camera is now, so retargeting mid-tween stays
  // continuous. Reduced motion, a hidden tab or an offscreen figure cut instead.
  useLayoutEffect(() => {
    const cut = () => {
      cameraNowRef.current = target
      tweenRef.current = null
      draw()
    }
    if (appliedCameraKeyRef.current === targetKey) {
      if (tweenRef.current && (reduced || !active)) cut()
      return
    }
    appliedCameraKeyRef.current = targetKey
    if (reduced || !active) cut()
    else tweenRef.current = { from: cameraNowRef.current, to: target, elapsedMs: 0 }
  }, [targetKey, target, reduced, active, draw])

  useEffect(() => {
    if (!active || (!playing && tweenRef.current === null)) return
    let raf = 0
    let lastDraw: number | null = null
    let nextDue = 0
    const tick = (now: number) => {
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
      const scene = sceneRef.current
      if (playing && scene) {
        phaseRef.current = fract(
          phaseRef.current + (stepMs / 1000) * cyclesPerSecond(scene.values) * rate,
        )
      }
      const tween = tweenRef.current
      if (tween) {
        tween.elapsedMs += stepMs
        const t = tween.elapsedMs / CAMERA_TWEEN_MS
        if (t >= 1) {
          cameraNowRef.current = tween.to
          tweenRef.current = null
        } else {
          cameraNowRef.current = interpolateCamera(tween.from, tween.to, easeInOutCubic(t))
        }
      }
      draw()
      raf = playing || tweenRef.current ? requestAnimationFrame(tick) : 0
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, playing, rate, targetKey, draw])

  const unit = 1 / pxPerUnit
  return (
    <figure ref={figureRef} aria-label={label} className={`flex flex-col ${className}`}>
      <figcaption className="pb-1 font-sans text-xs text-neutral-700 dark:text-neutral-300">
        {RUNNER_CAPTION}
      </figcaption>
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          aria-hidden="true"
          focusable="false"
          viewBox={`${-VIEW_HALF_WIDTH} ${-VIEW_HALF_HEIGHT} ${2 * VIEW_HALF_WIDTH} ${2 * VIEW_HALF_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full"
        >
          <line
            data-ground=""
            x1={-10}
            x2={10}
            className="stroke-neutral-300 dark:stroke-neutral-700"
            strokeWidth={RUNNER_PX.groundStroke * unit}
          />
          <g data-segments="">
            {order.edges.map((i) => {
              const style = edgeStyles[i]
              const dash = RUNNER_PX.neutralDash * unit
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
                  opacity={order.farEdge[i] ? FAR_OPACITY : undefined}
                />
              )
            })}
          </g>
          <g data-joints="">
            {order.joints.map((j) => {
              const style = jointStyleList[j]
              return (
                <circle
                  key={COMMON_KEYPOINT_NAMES[j]}
                  data-joint={COMMON_KEYPOINT_NAMES[j]}
                  data-joint-index={j}
                  data-style={style}
                  className={JOINT_CLASS[style]}
                  r={(style === 'focus' ? RUNNER_PX.focusJoint : RUNNER_PX.joint) * unit}
                  opacity={order.farJoint[j] ? FAR_OPACITY : undefined}
                />
              )
            })}
          </g>
          <g data-annotations="">
            {annotations.map((annotation, a) => (
              <g key={annotation.paramId} data-annotation={annotation.paramId} data-kind={annotation.kind}>
                {annotation.guides.map((_, i) => (
                  <path
                    key={`guide-${i}`}
                    data-path={`${a}:g:${i}`}
                    data-role="guide"
                    fill="none"
                    className="stroke-neutral-500 dark:stroke-neutral-400"
                    strokeWidth={RUNNER_PX.guideStroke * unit}
                  />
                ))}
                {annotation.marks.map((_, i) => (
                  <path
                    key={`mark-${i}`}
                    data-path={`${a}:m:${i}`}
                    data-role="mark"
                    fill="none"
                    className="stroke-cyan-700 dark:stroke-cyan-300"
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
              </g>
            ))}
          </g>
          {flash && (
            <text
              data-flash=""
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
      <p className="sr-only">{description}</p>
      <div className="flex items-center justify-between gap-3 pt-2">
        <p aria-hidden="true" className="min-w-0 font-sans text-xs text-neutral-600 dark:text-neutral-400">
          {anyNeutral ? 'Dashed: not measured' : ''}
        </p>
        <button
          type="button"
          aria-label={playing ? 'Pause runner' : 'Play runner'}
          onClick={() => setChoice(playing ? 'pause' : 'play')}
          className="min-h-11 min-w-11 shrink-0 border border-black px-3 py-2 font-sans text-xs font-semibold dark:border-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
    </figure>
  )
}
