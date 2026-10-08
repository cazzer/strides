import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { MetricId } from '../heuristics/types'
import type { KeypointName } from '../pose/types'
import type { ExtractedEvidenceFrame } from '../video/extractFrames'
import { SKELETON_EDGES } from './skeletonGeometry'
import { METRIC_LABELS } from './metricConfidence'
import type { MetricCardEvidence } from './MetricsPanel'
import type { ClipSession } from './multiClipAnalysis'
import type { AggregateAnalysisState } from './types'
import {
  REFERENCE_POINTS, REFERENCE_POINTS_SECOND, buildMotionSequence, mixPoints, pointsAtTimestamp,
} from './motionStoryGeometry'
import type { StoryPoints } from './motionStoryGeometry'

export interface MotionStoryStageProps {
  analysis: AggregateAnalysisState
  clips: ClipSession[]
  sourceIndices: Record<MetricId, number> | null
  evidence: readonly MetricCardEvidence[]
  resultsRef: RefObject<HTMLDivElement | null>
  headerRef: RefObject<HTMLElement | null>
  viewMode: 'classic' | 'guide'
}

const isMetric = (value: string | undefined): value is MetricId =>
  value !== undefined && Object.prototype.hasOwnProperty.call(METRIC_LABELS, value)

function Skeleton({
  points, highlighted, illustrative = false, secondPose = false, animate = false,
}: {
  points: StoryPoints
  highlighted?: readonly KeypointName[]
  illustrative?: boolean
  secondPose?: boolean
  animate?: boolean
}) {
  return (
    <g
      className={animate ? (secondPose ? 'motion-story__reference-b' : 'motion-story__reference-a') : undefined}
      fill="none"
      stroke={illustrative ? '#616974' : '#087f94'}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={illustrative ? '4 6' : undefined}
    >
      {SKELETON_EDGES.map(([a, b]) => {
        const from = points[a]
        const to = points[b]
        if (!from || !to) return null
        const emphasized = !highlighted?.length || highlighted.includes(a) || highlighted.includes(b)
        return (
          <line
            key={`${a}-${b}`}
            x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            strokeWidth={emphasized ? 3.5 : 2}
            opacity={(emphasized ? 1 : 0.32) * (from.inferred || to.inferred ? 0.35 : 1)}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
      {Object.entries(points).map(([name, point]) => point && (
        <circle
          key={name} data-joint={name} cx={point.x} cy={point.y}
          r={highlighted?.includes(name as KeypointName) ? 5 : 2.5}
          fill={illustrative ? '#616974' : '#087f94'}
          stroke="none"
          opacity={point.inferred ? 0.35 : 1}
        />
      ))}
    </g>
  )
}

/** The only surface allowed to own the extracted evidence canvas is still its metric card.
 * This stage copies pixels into a private canvas; it never adopts, clears, or reparents that node. */
function GhostPixels({ canvas }: { canvas: HTMLCanvasElement }) {
  const copyRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const copy = copyRef.current
    if (!copy) return
    copy.width = canvas.width
    copy.height = canvas.height
    const context = copy.getContext('2d')
    if (context) context.drawImage(canvas, 0, 0)
  }, [canvas])
  return <canvas ref={copyRef} aria-hidden="true" className="motion-story__ghost absolute inset-0 h-full w-full" />
}

function StoryPicture({
  measured, ready, item, points, highlighted, className, animateSeam, seamHidden,
}: {
  measured: boolean
  ready: boolean
  item: ExtractedEvidenceFrame | undefined
  points: StoryPoints
  highlighted: readonly KeypointName[] | undefined
  className: string
  animateSeam: boolean
  seamHidden: boolean
}) {
  return (
    <div className={`relative aspect-square shrink-0 overflow-hidden bg-neutral-100 dark:bg-neutral-900 ${className}`}>
      <div aria-hidden="true" className="motion-story__grid absolute inset-0" />
      {measured && item && <GhostPixels canvas={item.canvas} />}
      <svg viewBox="0 0 320 320" aria-hidden="true" className={`absolute inset-0 h-full w-full ${animateSeam ? 'motion-story__trace' : ''} ${seamHidden ? 'motion-story__trace--hidden' : ''}`}>
        {!measured && <Skeleton points={REFERENCE_POINTS} illustrative animate={!ready} />}
        {!ready && <Skeleton points={REFERENCE_POINTS_SECOND} illustrative secondPose animate />}
        {measured && <Skeleton points={points} highlighted={highlighted} />}
      </svg>
    </div>
  )
}

/** Select the result nearest the viewport's reading line. Keyboard focus and guide hashes take
 * precedence when explicitly used, including links to cards inside collapsed disclosures. */
function useReadingMetric(
  resultsRef: RefObject<HTMLDivElement | null>,
  viewMode: 'classic' | 'guide',
  ready: boolean,
  frozen: boolean,
): MetricId | null {
  const [metric, setMetric] = useState<MetricId | null>(null)
  useEffect(() => {
    if (!ready || frozen) return
    const root = resultsRef.current
    if (!root) return
    let raf = 0
    const update = () => {
      const cards = [...root.querySelectorAll<HTMLElement>('[data-motion-metric]')]
        .filter((card) => card.getClientRects().length > 0)
      if (!cards.length) return
      const readingLine = window.innerHeight * 0.42
      const nearest = cards.reduce((best, card) =>
        Math.abs(card.getBoundingClientRect().top - readingLine) <
        Math.abs(best.getBoundingClientRect().top - readingLine) ? card : best)
      if (isMetric(nearest.dataset.motionMetric)) setMetric(nearest.dataset.motionMetric)
    }
    const schedule = () => {
      if (typeof requestAnimationFrame === 'function') {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(update)
      } else update()
    }
    const onFocus = (event: FocusEvent) => {
      const element = event.target
      if (!(element instanceof Element)) return
      const container = element.closest<HTMLElement>('[data-metric], [data-motion-metric]')
      const selected = container?.dataset.motionMetric ?? container?.dataset.metric
      if (container && root.contains(container) && isMetric(selected)) {
        setMetric(selected)
      }
    }
    const onHash = () => {
      let id: string
      try { id = decodeURIComponent(window.location.hash.slice(1)) } catch { return }
      const target = document.getElementById(id)
      if (target && root.contains(target)) {
        const container = target.closest<HTMLElement>('[data-metric]')
        if (container && isMetric(container.dataset.metric)) setMetric(container.dataset.metric)
      }
    }
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('hashchange', onHash)
    root.addEventListener('focusin', onFocus)
    root.addEventListener('toggle', schedule, true)
    schedule()
    onHash()
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('hashchange', onHash)
      root.removeEventListener('focusin', onFocus)
      root.removeEventListener('toggle', schedule, true)
    }
  }, [ready, frozen, resultsRef, viewMode])
  return ready ? metric : null
}

export function MotionStoryStage({
  analysis, clips, sourceIndices, evidence, resultsRef, headerRef, viewMode,
}: MotionStoryStageProps) {
  const stageRef = useRef<HTMLElement>(null)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    const header = headerRef.current
    const stage = stageRef.current
    if (!header || !stage) return
    const update = () => {
      const height = `${Math.ceil(header.getBoundingClientRect().height)}px`
      stage.style.setProperty('--motion-story-header-height', height)
      resultsRef.current?.style.setProperty('--motion-story-header-height', height)
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(header)
    return () => observer.disconnect()
  }, [headerRef, resultsRef, analysis.phase])
  const ready = analysis.phase === 'ready' && analysis.heuristics !== null
  const focusedMetric = useReadingMetric(resultsRef, viewMode, ready, expanded)
  const metric = focusedMetric ?? (ready
    ? (Object.keys(METRIC_LABELS) as MetricId[]).find((id) =>
        analysis.heuristics?.[id].value !== null && analysis.heuristics?.[id].viewFit !== 'unsuitable') ?? null
    : null)
  const result = metric && ready ? analysis.heuristics?.[metric] : null
  const unavailable = result !== null && result !== undefined &&
    (result.value === null || result.viewFit === 'unsuitable')
  const winningIndex = metric ? sourceIndices?.[metric] : undefined
  const section = evidence.find((entry) => entry.metric === metric && entry.clipIndex === winningIndex)
  const item = section?.items[0]
  const clipIndex = winningIndex ?? 0
  const clip = clips[clipIndex]
  const frames = metric === 'verticalOscillationCm' || metric === 'stepWidthCm'
    ? clip?.analysis.scalePass.robustFrames
    : clip?.analysis.robustFrames
  const points = useMemo(() => unavailable ? null : pointsAtTimestamp(
    frames, item?.plan.base.timestamp ?? null, item?.plan.crop ?? null,
  ), [frames, item, unavailable])
  const sequence = useMemo(() => unavailable ? null : buildMotionSequence(
    frames, item?.plan.base.timestamp ?? null,
  ), [frames, item?.plan.base.timestamp, unavailable])
  const highlighted = item?.plan.base.keypoints.map((point) => point.name)
  const [displayPoints, setDisplayPoints] = useState<StoryPoints>(REFERENCE_POINTS)
  const [morphedPoints, setMorphedPoints] = useState<StoryPoints | null>(null)
  const morphComplete = points !== null && morphedPoints === points
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const [playbackChoice, setPlaybackChoice] = useState<{
    metric: MetricId | null; winningIndex: number | undefined
    frames: typeof frames; mode: 'motion' | 'still'
  } | null>(null)
  const playback = playbackChoice?.metric === metric && playbackChoice.winningIndex === winningIndex &&
    playbackChoice.frames === frames
    ? playbackChoice.mode : reducedMotion ? 'still' : 'motion'
  const [currentFrame, setCurrentFrame] = useState<{ sequence: typeof sequence; index: number } | null>(null)
  const frameIndex = currentFrame?.sequence === sequence ? currentFrame.index : 0
  const [seam, setSeam] = useState<{ sequence: typeof sequence; hidden: boolean } | null>(null)
  const seamHidden = seam?.sequence === sequence && seam.hidden
  const dialogRef = useRef<HTMLDialogElement>(null)
  const expandButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!preference) return
    const onChange = () => {
      setReducedMotion(preference.matches)
      if (preference.matches) setPlaybackChoice({ metric, winningIndex, frames, mode: 'still' })
    }
    preference.addEventListener('change', onChange)
    return () => preference.removeEventListener('change', onChange)
  }, [metric, winningIndex, frames])
  useEffect(() => {
    if (!ready || !sequence || playback !== 'motion' || !morphComplete) return
    let raf = 0
    let started: number | null = null
    const firstTime = sequence.frames[0].timestamp
    const lastTime = sequence.frames[sequence.frames.length - 1].timestamp - firstTime
    const fadeAt = Math.max(lastTime + 0.04, sequence.duration - 0.06)
    const loopDuration = fadeAt + 0.24
    const tick = (now: number) => {
      if (started === null) started = now
      const elapsed = ((now - started) / 1000) % loopDuration
      let index = 0
      while (index + 1 < sequence.frames.length &&
        sequence.frames[index + 1].timestamp - firstTime <= elapsed) index += 1
      setCurrentFrame((previous) => previous?.sequence === sequence && previous.index === index
        ? previous : { sequence, index })
      const hidden = elapsed >= fadeAt
      setSeam((previous) => previous?.sequence === sequence && previous.hidden === hidden
        ? previous : { sequence, hidden })
      raf = requestAnimationFrame(tick)
    }
    const onVisibility = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden) {
        started = null
        raf = requestAnimationFrame(tick)
      }
    }
    if (!document.hidden) raf = requestAnimationFrame(tick)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ready, sequence, playback, morphComplete])
  useEffect(() => {
    if (!expanded) return
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    closeButtonRef.current?.focus()
  }, [expanded])
  const hasMorphed = useRef(false)
  useEffect(() => {
    if (!ready) {
      hasMorphed.current = false
      return
    }
    if (!points) return
    if (
      hasMorphed.current ||
      typeof requestAnimationFrame !== 'function' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      hasMorphed.current = true
      setDisplayPoints(points)
      setMorphedPoints(points)
      return
    }
    hasMorphed.current = true
    let raf = 0
    const started = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - started) / 680, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplayPoints(mixPoints(REFERENCE_POINTS, points, eased))
      if (t < 1) raf = requestAnimationFrame(tick)
      else setMorphedPoints(points)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ready, points])

  if (analysis.phase === 'idle' || analysis.phase === 'error') return null
  const measured = ready && !unavailable && points !== null
  const inMotion = measured && sequence !== null && playback === 'motion' && morphComplete
  const visiblePoints = inMotion ? sequence.frames[frameIndex]?.points ?? displayPoints : displayPoints
  const visibleItem = !inMotion && morphComplete ? item : undefined
  const heading = ready ? (metric ? METRIC_LABELS[metric] : 'Your running form') : 'Running form in motion'
  const imageText = !ready
    ? 'An illustrative runner moves while your clip is analyzed.'
    : unavailable
      ? 'Reference illustration shown; this measurement was not available from the clip.'
      : !measured
        ? 'Reference illustration shown; a reliable full-body pose is not available for this measurement.'
        : inMotion
          ? 'Detected motion from recorded pose samples, centered to keep the runner in view. Footage is hidden while the pose moves.'
          : !sequence
            ? 'Detected form held still because this clip has too few continuous pose samples for motion. The faint footage, when available, is this measurement’s evidence.'
        : section?.pending
          ? 'Your detected form is shown while clip frames are prepared.'
          : item
            ? 'Your detected form over a faint copy of this measurement’s clip evidence.'
            : 'Your detected form. No clip image is available for this measurement.'
  const playbackButton = () => sequence && measured && (
    <button
      type="button"
      onClick={() => setPlaybackChoice({ metric, winningIndex, frames, mode: inMotion ? 'still' : 'motion' })}
      className="min-h-11 border border-black px-3 py-2 text-left font-sans text-xs font-semibold dark:border-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      {inMotion ? (item ? 'Show evidence still' : 'Pause detected motion') : 'Play detected motion'}
    </button>
  )
  return (
    <section ref={stageRef} aria-label="Form in motion" className="motion-story sticky z-[8] border-2 border-black bg-white p-2 dark:border-white dark:bg-black lg:p-4">
      <div className="flex items-center gap-3 lg:block">
        <StoryPicture measured={measured} ready={ready} item={visibleItem} points={visiblePoints} highlighted={highlighted} className="w-16 lg:w-full" animateSeam={inMotion} seamHidden={inMotion && seamHidden} />
        <div className="min-w-0 flex-1 space-y-0.5 lg:space-y-1 lg:pt-3">
          <h2 className="font-display text-sm font-bold leading-tight lg:text-xl">{heading}</h2>
          <p className="sr-only font-sans text-xs leading-snug text-neutral-700 dark:text-neutral-300 lg:not-sr-only lg:text-sm">{imageText}</p>
          <p aria-hidden="true" className="font-sans text-[11px] leading-tight text-neutral-600 dark:text-neutral-400 lg:hidden">
            {!ready ? 'Reference illustration' : unavailable ? 'Reference only · not measured' : !measured ? 'Reference only · pose unavailable' : inMotion ? 'Detected motion' : !sequence ? 'Still pose · motion unavailable' : section?.pending ? 'Preparing footage' : item ? 'Form with footage' : 'Pose only'}
          </p>
          {measured && metric && clips.length > 1 && (
            <p className="font-sans text-xs font-semibold text-neutral-700 dark:text-neutral-300">Clip {clipIndex + 1} of {clips.length}</p>
          )}
          {!ready && <p className="hidden font-sans text-xs text-neutral-600 dark:text-neutral-400 lg:block">Reference illustration · measured form appears when analysis finishes</p>}
          <div className="hidden lg:block lg:pt-2">{playbackButton()}</div>
        </div>
        <button ref={expandButtonRef} type="button" onClick={() => setExpanded(true)} aria-label="Expand form" className="min-h-11 min-w-11 shrink-0 self-start border border-black px-2 py-1 font-sans text-xs font-semibold dark:border-white lg:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">View</button>
      </div>
      {expanded && (
        <dialog
          ref={dialogRef}
          aria-labelledby="motion-story-detail-heading"
          aria-describedby="motion-story-detail-description"
          onClose={() => { setExpanded(false); expandButtonRef.current?.focus() }}
          className="motion-story__dialog w-[min(90vw,28rem)] max-h-[85vh] overflow-y-auto border-2 border-black bg-white p-4 text-black backdrop:bg-black/70 dark:border-white dark:bg-black dark:text-white"
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <h2 id="motion-story-detail-heading" className="font-display text-lg font-bold leading-tight">{heading}</h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => {
                  if (typeof dialogRef.current?.close === 'function') dialogRef.current.close()
                  else { setExpanded(false); expandButtonRef.current?.focus() }
                }}
                className="min-h-11 min-w-11 border border-black px-2 py-1 font-sans text-xs font-semibold dark:border-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >Close</button>
            </div>
            <StoryPicture measured={measured} ready={ready} item={visibleItem} points={visiblePoints} highlighted={highlighted} className="mx-auto w-full max-w-[320px]" animateSeam={inMotion} seamHidden={inMotion && seamHidden} />
            <p id="motion-story-detail-description" className="font-sans text-sm text-neutral-700 dark:text-neutral-300">{imageText}</p>
            {playbackButton()}
            {measured && metric && clips.length > 1 && <p className="font-sans text-xs">Clip {clipIndex + 1} of {clips.length}</p>}
          </div>
        </dialog>
      )}
    </section>
  )
}
