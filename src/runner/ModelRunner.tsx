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
import { interpolateCamera, projectPoint, projectPose } from './camera'
import { cyclesPerSecond, poseAt } from './gaitModel'
import {
  footFloor,
  planAnnotations,
  shownWhileStill,
  type AnnotationKind,
  type RunnerAnnotationLabel,
} from './runnerAnnotations'
import { RUNNER_PARAM_SEGMENTS, runnerParamValues } from './runnerParams'
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
  clampLabelX,
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
  valueTweenProgress,
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
  /** A short label beside a parameter's part, e.g. its value as it is applied. */
  flash?: { paramId: RunnerParamId; text: string } | null
  /** Interpolated per frame by the loop, on top of `values`. */
  valueTween?: RunnerValueTween | null
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
const LABEL_CLASS =
  'fill-neutral-900 stroke-white font-sans font-semibold dark:fill-neutral-100 dark:stroke-black forced-colors:fill-[color:CanvasText] forced-colors:stroke-[color:Canvas]'

/** Pixels per viewBox unit before the stage has been measured (and in jsdom). */
const DEFAULT_PX_PER_UNIT = 100

interface DrawTargets {
  segments: { el: SVGLineElement; a: number; b: number }[]
  joints: { el: SVGCircleElement; j: number }[]
  paths: { el: SVGPathElement; points: readonly Vec3[]; closed: boolean }[]
  labels: { lines: SVGTSpanElement[]; label: RunnerAnnotationLabel }[]
  ground: SVGLineElement | null
  flash: { el: SVGTextElement; paramId: RunnerParamId; chars: number } | null
}

interface Scene {
  /** The static values (bound plus `overrides.values`), before any value tween. */
  values: RunnerParams
  floor: number
  pxPerUnit: number
  targets: DrawTargets
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
}

function fract(value: number): number {
  return value - Math.floor(value)
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

function collectTargets(
  svg: SVGSVGElement,
  annotations: Annotations,
  flash: RunnerOverrides['flash'],
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
    return { el, points: list[Number(index)], closed: role === 'f' }
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
    flash: flashEl && flash ? { el: flashEl, paramId: flash.paramId, chars: flash.text.length } : null,
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

  const targetKey = cameraKey(camera)
  const target = useMemo(() => cameraFromKey(targetKey), [targetKey])

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
  const floor = useMemo(() => footFloor(values), [values])
  const { heldPhase, annotations: allAnnotations } = useMemo(
    () =>
      planAnnotations({
        bound: params,
        values,
        sources,
        focusParams,
        kind: annotationKind,
        cameraYawDeg: target.yawDeg,
        floor,
      }),
    [params, values, sources, focusParams, annotationKind, target.yawDeg, floor],
  )
  // A still figure shows a limb mark only at its key phase; a playing one shows every mark.
  const annotations = useMemo(
    () =>
      playing ? allAnnotations : allAnnotations.filter((a) => shownWhileStill(a, heldPhase)),
    [playing, allAnnotations, heldPhase],
  )
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
  const flash = overrides?.flash ?? null
  const valueTween = overrides?.valueTween ?? null

  const phaseRef = useRef<number>(heldPhase)
  const heldPhaseRef = useRef(heldPhase)
  const reducedRef = useRef(reduced)
  const cameraNowRef = useRef<CameraState>(target)
  const appliedCameraKeyRef = useRef(targetKey)
  const cameraTweenRef = useRef<CameraTween | null>(null)
  const valueTweenRef = useRef<ValueTweenState | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const liveRef = useRef<Live>({ active, playing, rate })
  const kickRef = useRef<() => void>(() => {})

  const drawRef = useRef(() => {
    const scene = sceneRef.current
    if (!scene) return
    const cam = cameraNowRef.current
    const unit = 1 / scene.pxPerUnit
    const drawn = drawnValues(scene.values, valueTweenRef.current, performance.now())
    const projected = projectPose(poseAt(phaseRef.current, drawn), cam)
    const { segments, joints, paths, labels, ground, flash: flashTarget } = scene.targets
    for (const { el, a, b } of segments) {
      setPoint(el, 'x1', 'y1', projected[a].x, projected[a].y)
      setPoint(el, 'x2', 'y2', projected[b].x, projected[b].y)
    }
    for (const { el, j } of joints) setPoint(el, 'cx', 'cy', projected[j].x, projected[j].y)
    if (ground) {
      const groundY = fmt(projectPoint({ x: cam.target.x, y: scene.floor, z: cam.target.z }, cam).y)
      ground.setAttribute('y1', groundY)
      ground.setAttribute('y2', groundY)
    }
    for (const { el, points, closed } of paths) {
      const d = points
        .map((point, i) => {
          const p = projectPoint(point, cam)
          return `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`
        })
        .join('')
      el.setAttribute('d', closed ? `${d}Z` : d)
    }
    const fontUnits = RUNNER_PX.label * unit
    for (const { lines, label: text } of labels) {
      const layout = placeLabel(
        projectPoint(text.anchor, cam),
        text.side,
        text.lines,
        fontUnits,
        (text.side === 'left' ? RUNNER_PX.labelGapLeft : RUNNER_PX.labelGap) * unit,
      )
      lines.forEach((line, i) => setPoint(line, 'x', 'y', layout.x, layout.ys[i]))
    }
    if (flashTarget) {
      const [edge] = RUNNER_PARAM_SEGMENTS[flashTarget.paramId]
      const maxY = VIEW_HALF_HEIGHT - fontUnits
      let x = -VIEW_HALF_WIDTH
      let y = -maxY
      if (edge) {
        const a = projected[COMMON_KEYPOINT_NAMES.indexOf(edge[0])]
        const b = projected[COMMON_KEYPOINT_NAMES.indexOf(edge[1])]
        x = Math.max(a.x, b.x) + RUNNER_PX.labelGap * 2 * unit
        y = Math.min(maxY, Math.max(-maxY, (a.y + b.y) / 2))
      }
      setPoint(flashTarget.el, 'x', 'y', clampLabelX(x, 'start', flashTarget.chars, fontUnits), y)
    }
  })

  // After every render (props or play state, never per frame): point the loop at the elements
  // just rendered and draw them, so a paused figure redraws too.
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    sceneRef.current = {
      values,
      floor,
      pxPerUnit,
      targets: collectTargets(svg, annotations, flash),
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
  // reduced motion switching on while the reader has not chosen to play.
  useLayoutEffect(() => {
    const heldChanged = heldPhaseRef.current !== heldPhase
    const reducedStarted = reduced && !reducedRef.current && choice === null
    heldPhaseRef.current = heldPhase
    reducedRef.current = reduced
    if ((heldChanged && !playing) || reducedStarted) {
      phaseRef.current = heldPhase
      drawRef.current()
    }
  }, [heldPhase, reduced, choice, playing])

  // Hand the loop the latest play state and start or stop it (every render, after the effects
  // above have set up any tween).
  useLayoutEffect(() => {
    liveRef.current = { active, playing, rate }
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
        phaseRef.current = fract(
          phaseRef.current + (stepMs / 1000) * cyclesPerSecond(drawn) * live.rate,
        )
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
          {legend ? 'Dashed: not measured' : ''}
        </p>
        <button
          type="button"
          aria-label={playing ? 'Pause runner' : 'Play runner'}
          onClick={() => setChoice(playing ? 'pause' : 'play')}
          className="min-h-11 min-w-11 shrink-0 border border-black px-3 py-2 font-sans text-xs font-semibold dark:border-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <span aria-hidden="true" className="mr-1.5 inline-block w-3 text-center">
            {playing ? '❚❚' : '▶'}
          </span>
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
    </figure>
  )
}
