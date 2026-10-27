import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { PoseDetector } from '../pose/detector'
import type { ModelLoadStates } from '../pose/modelLoadState'
import { AddClipAction } from '../video/AddClipAction'
import { ClipLoadStatus } from '../video/ClipLoadStatus'
import { ClipPicker } from '../video/ClipPicker'
import { releaseClipPoster } from '../video/posterFrame'
import { ClipSlot } from './ClipSlot'
import { clipHostsLiveElement } from './clipStripStatus'
import type { ClipPendingLoad } from './ClipSlot'
import type { GuidedResultsViewProps } from './GuidedResultsView'
import { MotionStoryStage } from './MotionStoryStage'
import type { MetricCardEvidence } from './MetricsPanel'
import { ModelLoadStripEntry } from './ModelLoadStripEntry'
import { describeModelLoadStripStatus } from './modelLoadStripStatus'
import { ResultsView } from './ResultsView'
import { SessionCoverageNotice } from './SessionCoverageNotice'
import { sessionCoverage } from './sessionCoverage'
import { readResultsLanding, writeResultsLanding } from './resultsLanding'
import {
  pushResultsViewMode,
  resolveResultsViewMode,
  resultsViewModeFromHistoryState,
  stampResultsViewMode,
} from './resultsViewMode'
import type { ResultsViewMode } from './resultsViewMode'
import { ResultsSummary } from './summary/ResultsSummary'
import { RunnerTour } from './tour/RunnerTour'
import { useScreenWakeLock } from './useScreenWakeLock'
import { useSessionEvidence } from './useSessionEvidence'
import type { EvidenceSection } from './useSessionEvidence'
import {
  computeAggregateAnalysisState,
  computeFusionSourceIndices,
  nextActiveClipIndex,
  nextScalePassClipIndex,
  scalePassLeaseIndex,
} from './multiClipAnalysis'
import type { ClipSession } from './multiClipAnalysis'
import { clipViewLabel } from './clipProvenance'

/** Stable empty list, so "extraction has not settled yet" never hands the cards a fresh
 * identity on every render. */
const NO_EVIDENCE: readonly EvidenceSection[] = []

/**
 * Publishes the sticky header's height on `<main>` as `--motion-story-header-height`, for the two
 * rules that read it (`index.css`): the classic view's sticky motion stage, and the scroll margin on
 * every card and `.guided-results__scroll-target`. On `<main>` rather than on the stage, because the
 * stage renders beside the classic view only; set there, every other view's scroll targets would
 * fall back to the 88 px guess and land under a header that is often taller.
 */
function useHeaderHeightProperty(
  headerRef: RefObject<HTMLElement | null>,
  mainRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const header = headerRef.current
    const main = mainRef.current
    if (!header || !main) return
    const update = () => {
      main.style.setProperty(
        '--motion-story-header-height',
        `${Math.ceil(header.getBoundingClientRect().height)}px`,
      )
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(header)
    return () => observer.disconnect()
  }, [headerRef, mainRef])
}

export interface MultiClipVideoSessionProps {
  /** The one shared, stateful pose detector for the whole page — handed to exactly one active
   * clip at a time (see `nextActiveClipIndex`); every other clip gets `null`. */
  detector: PoseDetector | null
  /**
   * Both detector owners' model-download state, read in `App` and threaded here because this
   * component owns the application header (`strides-utn.1`).
   *
   * Rendered as the strip's leading entry since `strides-utn.5` — see `ModelLoadStripEntry` and
   * `describeModelLoadStripStatus`, which decide between "a download is in flight", "one failed"
   * and by far the commonest answer, "render nothing".
   */
  modelLoad: ModelLoadStates
}

function makeClipId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `clip-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Field-by-field comparison, not object identity — `ClipSlot` reports a freshly-constructed
 * `{ clipId, videoSource, analysis }` object on every one of its renders (both `useVideoSource`
 * and `useVideoAnalysis` return new top-level objects each call, regardless of whether their
 * underlying state actually changed), so comparing by reference would never bail out and
 * `handleReport` would call `setClipStates` — and therefore re-render every mounted `ClipSlot` —
 * on every single render, forever. Comparing the fields that actually matter for rendering lets
 * `setClipStates`'s updater return the previous state object unchanged when nothing meaningful
 * moved, which React treats as a no-op (no re-render), breaking the loop.
 *
 * `analysis.progress` is deliberately NOT compared (strides-e4c.3). Nothing at session level reads
 * it — each clip's strip entry renders its own progress inside `ClipSlot`, off that clip's own
 * state — and comparing it re-rendered this whole tree, finished clips' results included, once per
 * displayed percent while a clip sampled, on the main thread the sampler shares. The aggregate has
 * no `progress` field (`AggregateAnalysisState`) so a stale one cannot be rendered by mistake.
 */
function sameClipSession(previous: ClipSession | undefined, next: ClipSession): boolean {
  if (!previous) return false
  return (
    previous.videoSource.status === next.videoSource.status &&
    previous.videoSource.metadata === next.videoSource.metadata &&
    previous.videoSource.error === next.videoSource.error &&
    previous.analysis.phase === next.analysis.phase &&
    previous.analysis.isPausedMidAnalysis === next.analysis.isPausedMidAnalysis &&
    previous.analysis.robustFrames === next.analysis.robustFrames &&
    previous.analysis.heuristics === next.analysis.heuristics &&
    previous.analysis.diagnostics === next.analysis.diagnostics &&
    previous.analysis.error === next.analysis.error &&
    previous.analysis.scalePass.status === next.analysis.scalePass.status &&
    previous.analysis.scalePass.diagnostics === next.analysis.scalePass.diagnostics &&
    previous.analysis.scalePass.error === next.analysis.scalePass.error &&
    previous.analysis.scalePass.reason === next.analysis.scalePass.reason &&
    // Read by the schedule before a clip's run starts (`nextActiveClipIndex`), and it settles on
    // its own, with nothing else moving.
    previous.analysis.primarySamplingPath === next.analysis.primarySamplingPath &&
    // A poster arrives asynchronously, long after the fields above have stopped moving — leaving it
    // out would make its arrival invisible to this comparison and `setClipStates` would keep
    // returning the previous state, so the poster would never reach anything that renders it.
    previous.poster === next.poster
  )
}

/**
 * Owns a multi-clip session: which clips exist, what each was pre-loaded with (if anything), and
 * every clip's live `{ videoSource, analysis }` reported up from its `ClipSlot`. Renders one
 * `ClipSlot` per clip, hands the shared detector to exactly one of them (the serialization
 * mitigation — see this change's design.md D5/D6), and feeds the unmodified `ResultsView` the
 * fused aggregate from `computeAggregateAnalysisState`.
 *
 * ### Why this component renders the page header
 *
 * The clip strip lives in the header, and each strip entry hosts that clip's real `<video>` while
 * its analysis is in flight — a correctness requirement, not a layout one (`strides-kyu.13`, and
 * see `VideoInputPanel`). The elements therefore have to be rendered INTO the header by whatever
 * owns the clip list, and that is this component. Lifting the header up to `App.tsx` and passing
 * the strip down is not equivalent: a portal target is `null` on the first render, and an element
 * positioned over a separately-rendered entry lands under the sticky header at the slightest
 * mistake — both of which produce a silently concealed element that measures like a failure while
 * every class name looks right. So the header moved down here, and `App.tsx` keeps only the pose
 * detector.
 */
export function MultiClipVideoSession({ detector, modelLoad }: MultiClipVideoSessionProps) {
  // "Start over" (a whole-session reset, confirmed first) unmounts the results and returns the page
  // to the picker, so the button's focus needs to land on something that survives the transition —
  // the page heading, the one thing on the page that is always there. Same fix already applied
  // once for the single-clip flow (WebcamCapture, #4).
  const headingRef = useRef<HTMLHeadingElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  useHeaderHeightProperty(headerRef, mainRef)
  // Seeded EMPTY, and that is the whole point: a session with no clips is now representable, so
  // the zero-clip state is genuinely "no clips" rather than "one slot whose videoSource.status is
  // 'empty'". Every clip, the first one included, is now created by `addClip` and loaded through a
  // `pendingLoad` — one clip-creation path instead of two. That also deletes a real bug: selecting
  // three files from the old first slot's own picker called `load()` three times on ONE
  // `useVideoSource` and produced a single clip, last file wins.
  const [clipIds, setClipIds] = useState<string[]>([])
  const stripMounted = clipIds.length > 0 || describeModelLoadStripStatus(modelLoad) !== null
  const stripRef = useRef<HTMLDivElement>(null)
  const [overflowCue, setOverflowCue] = useState<'left' | 'right' | null>(null)
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const update = () => {
      const hasLeft = strip.scrollLeft > 1
      const hasRight = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1
      setOverflowCue(hasRight ? 'right' : hasLeft ? 'left' : null)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(strip)
    strip.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    update()
    return () => {
      observer?.disconnect()
      strip.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
    // `stripMounted` as well as the clip count: the model-download entry can mount the scroller
    // before any clip exists, and the ref is only populated once it has.
  }, [clipIds.length, stripMounted])
  const [pendingLoads, setPendingLoads] = useState<Record<string, ClipPendingLoad>>({})
  const [clipStates, setClipStates] = useState<Record<string, ClipSession>>({})
  const [activeClipIndex, setActiveClipIndex] = useState(0)
  // Which clip the scale-pass lane was last granted to (`nextScalePassClipIndex`). Only read
  // through `scalePassLeaseIndex`, which drops it once that clip's pass is terminal or the clip is
  // gone, so it never needs clearing by hand.
  const [scalePassLeaseClipId, setScalePassLeaseClipId] = useState<string | null>(null)
  // Which clip's preview is open, or `null`. Session-level rather than per-slot because it is a
  // mutually exclusive choice: exactly one clip can be presented at a time, and "presented" is the
  // third conjunct of every clip's loop condition (design.md D1), so two open previews would mean
  // two clips decoding at once — precisely what scoping the loop to presentation exists to stop.
  const [presentedClipId, setPresentedClipId] = useState<string | null>(null)
  const [seekRequest, setSeekRequest] = useState<{ clipId: string; timestamp: number; nonce: number } | null>(null)
  const seekNonceRef = useRef(0)
  const evidenceReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const previouslyPresentedRef = useRef<string | null>(null)
  useEffect(() => {
    if (previouslyPresentedRef.current !== null && presentedClipId === null) {
      const target = evidenceReturnFocusRef.current
      if (target?.isConnected) target.focus()
      evidenceReturnFocusRef.current = null
    }
    previouslyPresentedRef.current = presentedClipId
  }, [presentedClipId])
  // Which results view renders: the tour, the summary or the classic table. Seeded ONCE from the
  // address and the remembered landing (lazy initialiser, so a later render never re-reads either).
  // Every switch the reader makes pushes a history entry stamped with its view, so browser Back
  // steps back through the views instead of leaving the page and losing the analysis. See
  // `resultsViewMode.ts` and `resultsLanding.ts`.
  const [resultsViewMode, setResultsViewMode] = useState<ResultsViewMode>(() =>
    resolveResultsViewMode(window.location.search, readResultsLanding()),
  )
  const resultsViewModeRef = useRef(resultsViewMode)
  useEffect(() => {
    resultsViewModeRef.current = resultsViewMode
  }, [resultsViewMode])
  // Set by a switch (a control, or browser Back/Forward), never by the initial mount: focus moves
  // into the new view only when the view the reader was in has been unmounted underneath them.
  const focusViewAfterSwitchRef = useRef(false)
  const viewRegionRef = useRef<HTMLDivElement>(null)
  const showView = useCallback((mode: ResultsViewMode) => {
    focusViewAfterSwitchRef.current = true
    setResultsViewMode(mode)
    pushResultsViewMode(mode)
  }, [])
  useEffect(() => {
    // The entry the page loaded on gets the view it opened with, so Back to it restores that view
    // even if the remembered landing has changed since. Its address is left as it is.
    stampResultsViewMode(resultsViewModeRef.current)
    const onPopState = (event: PopStateEvent) => {
      const stamped = resultsViewModeFromHistoryState(event.state)
      if (stamped === null) {
        // Not an entry a switch created. In practice it is one an in-page `#` link created (the
        // guided view's measurement links), and that link changed no view. Re-resolving it from the
        // address would be wrong: in a replayed tour with the summary remembered, the address says
        // summary. So it keeps the view on screen, and gets stamped with it for next time.
        stampResultsViewMode(resultsViewModeRef.current)
        return
      }
      if (stamped === resultsViewModeRef.current) return
      focusViewAfterSwitchRef.current = true
      // The entry is already in history; setting the view must not push another.
      setResultsViewMode(stamped)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const leaveTour = useCallback(() => {
    writeResultsLanding()
    showView('summary')
  }, [showView])
  const replayTour = useCallback(() => showView('tour'), [showView])
  const showSummary = useCallback(() => showView('summary'), [showView])
  const showClassic = useCallback(() => showView('classic'), [showView])
  useEffect(() => {
    if (!focusViewAfterSwitchRef.current) return
    focusViewAfterSwitchRef.current = false
    // Each view marks its one entry point explicitly: the "Your runner" heading in the tour, the
    // "Summary" heading in the summary, Show summary above the classic table. A marker rather than "the first button",
    // so a control a later ticket puts in the runner slot cannot take focus by position.
    viewRegionRef.current?.querySelector<HTMLElement>('[data-view-entry]')?.focus()
  }, [resultsViewMode])

  const handleReport = useCallback((clipId: string, session: ClipSession) => {
    setClipStates((prev) => {
      if (sameClipSession(prev[clipId], session)) return prev
      return { ...prev, [clipId]: session }
    })
  }, [])

  const dismissPreview = useCallback(() => {
    setPresentedClipId(null)
    setSeekRequest(null)
  }, [])
  const presentClip = useCallback((clipId: string) => {
    evidenceReturnFocusRef.current = null
    setSeekRequest(null)
    setPresentedClipId(clipId)
  }, [])
  const openEvidenceVideo = useCallback((clipIndex: number, timestamp: number, returnFocus: HTMLButtonElement | null) => {
    const clipId = clipIds[clipIndex]
    const clip = clipStates[clipId]
    if (!clip || clipHostsLiveElement(clip.analysis.phase, clip.analysis.scalePass.status)) return
    evidenceReturnFocusRef.current = returnFocus
    setSeekRequest({ clipId, timestamp, nonce: ++seekNonceRef.current })
    setPresentedClipId(clipId)
  }, [clipIds, clipStates])

  const addClip = useCallback((source: Blob | File, opts?: { frameRateHint?: number }) => {
    const id = makeClipId()
    setClipIds((prev) => [...prev, id])
    setPendingLoads((prev) => ({ ...prev, [id]: { source, opts } }))
  }, [])

  const removeClip = useCallback(
    (id: string) => {
      // Tear down this clip's pipeline BEFORE it disappears from `clipStates` — otherwise, if `id`
      // is the currently-ACTIVE clip and still mid-analysis (not yet primary+scale-pass terminal),
      // `nextActiveClipIndex` would simply never see it again (removed from the array, not marked
      // done) and would hand the shared detector to the next clip on the very next render. The only
      // thing that made that safe in practice was React unmounting this clip's `ClipSlot` and
      // running its cleanup effect (`abandonActiveRun`, via `useVideoAnalysis`'s unmount effect)
      // before the newly-active clip's own auto-start effect fires — true today because both
      // updates land in the same commit, but an implementation detail of React's passive-effect
      // ordering, not a contract this architecture should lean on (see design.md D5/D6 and the
      // review that flagged this). Calling `reset()` here — a plain, synchronous function call,
      // not a scheduled effect — stops the sample loop (`handleRef.current?.stop()`) and bumps
      // `runIdRef` deterministically, in this same tick, regardless of how/when React gets around
      // to unmounting the slot. `reset()` is idempotent and cheap for a clip that was never active
      // (idle) or already terminal (ready/error), so it's called unconditionally rather than only
      // for the clip that happens to be active right now.
      // A preview of the clip being removed cannot survive it — its stage is that clip's own
      // element, which is about to unmount. Cleared before anything else so no render ever sees a
      // `presentedClipId` pointing at a clip that is no longer in the session.
      setPresentedClipId((current) => (current === id ? null : current))

      clipStates[id]?.analysis.reset()

      // Frees the poster's pixels in this same tick, for the same reason `reset()` is called here
      // rather than left to the slot's unmount: the ordering of React's cleanup pass is not a
      // contract to lean on. `releaseClipPoster` is idempotent, so the slot's own cleanup calling
      // it again on unmount is a no-op, not a double free.
      //
      // Unguarded, unlike before: `setClipIds` below now really does drop the last remaining clip
      // (a zero-clip session is representable), so there is no case left where this slot stays
      // mounted and goes on rendering the poster being released.
      releaseClipPoster(clipStates[id]?.poster)

      setClipIds((prev) => prev.filter((existing) => existing !== id))
      setPendingLoads((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
      setClipStates((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    },
    [clipStates],
  )

  // Only clips whose ClipSlot has reported at least once — briefly excludes a just-mounted clip
  // for one render, which every consumer below tolerates (the aggregate and active-index
  // calculations both treat "not yet reported" the same as "not there yet").
  const clips: ClipSession[] = clipIds
    .map((id) => clipStates[id])
    .filter((session): session is ClipSession => session != null)
  const clipViews = clipIds.map((id) => {
    const view = clipStates[id]?.analysis.heuristics?.view.view
    return view ? clipViewLabel(view) : 'View pending'
  })

  // Adjusts which clip is active during render, mirroring useVideoAnalysis.ts's own
  // "adjusting state when a prop changes" pattern (React's documented approach —
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders):
  // computed fresh every render so this pass's JSX below is always consistent even while the
  // state update above is still propagating.
  //
  // The scale-pass lease goes in FIRST: while the lane is granted to a clip whose pass is still
  // due, the active clip must not advance into a newly added one — even on a render where that
  // clip has not yet reported its pass 'running' (schedule-scale-passes-after-primaries).
  const leaseIndex = scalePassLeaseIndex(clips, scalePassLeaseClipId)
  const desiredActiveIndex = nextActiveClipIndex(clips, activeClipIndex, leaseIndex)
  if (desiredActiveIndex !== activeClipIndex) {
    setActiveClipIndex(desiredActiveIndex)
  }
  const activeClipId = clips[desiredActiveIndex]?.clipId ?? null
  // The scale-pass lane: which ONE clip may run its background scale pass now. Remembered as a
  // lease from the grant until that pass is terminal, by the same during-render adjustment.
  const scalePassClipIndex = nextScalePassClipIndex(clips, desiredActiveIndex, leaseIndex)
  const scalePassClipId =
    scalePassClipIndex === null ? null : (clips[scalePassClipIndex]?.clipId ?? null)
  if (scalePassClipId !== scalePassLeaseClipId) {
    setScalePassLeaseClipId(scalePassClipId)
  }

  const aggregate = computeAggregateAnalysisState(clips)
  const anyClipVideoReady = clips.some((c) => c.videoSource.status === 'ready')
  // Which camera views the session is missing, read off the fused result (`strides-pz0u`). Only
  // once the session is ready: a clip still analysing has no view yet, and would read as missing.
  const coverage =
    aggregate.phase === 'ready' && aggregate.heuristics
      ? sessionCoverage(
          clips.flatMap((c) => (c.analysis.heuristics ? [c.analysis.heuristics.view.view] : [])),
          aggregate.heuristics,
        )
      : null
  const [addClipRequest, setAddClipRequest] = useState(0)
  const requestAddClip = useCallback(() => setAddClipRequest((n) => n + 1), [])

  // Any clip still being worked on — its primary pass, or its scale pass, which replays the clip
  // after "Analysis complete". The screen is kept on for exactly that long (`strides-6os1`).
  const analysisInFlight =
    aggregate.phase === 'sampling' ||
    aggregate.phase === 'processing' ||
    clips.some((c) => clipHostsLiveElement(c.analysis.phase, c.analysis.scalePass.status))
  useScreenWakeLock(analysisInFlight)
  // Read once: a device's primary pointer does not change mid-session, and a coarse one is the
  // closest honest proxy for "a phone or tablet" without sniffing the user agent.
  const [coarsePointer] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) ?? false,
  )

  // `null` on every settled render, which is nearly all of them. Non-null exactly while a model
  // download is in flight or has failed — twice per session at most, and at two very different
  // moments: MoveNet's 14.5 MB at mount, and MediaPipe's 9.4 MB `.task` only once a first clip has
  // reached `'ready'`. The second of those is why this cannot be a page-load-only affordance.
  const modelLoadStatus = describeModelLoadStripStatus(modelLoad)

  // Which clip each FUSED metric was selected from, or null until every clip is ready — the same
  // gate `aggregate.heuristics !== null` passes, so a card can never attribute a picture to a
  // result that has not been fused yet.
  const sourceIndices = computeFusionSourceIndices(clips)
  // The session's ONE evidence extraction. It lives here, not inside the results subtree, because
  // the images it produces are canvas ELEMENTS and a node has one parent: whoever owns extraction
  // must not also be the thing that parents the canvases, or a second surface would silently steal
  // them. A second caller of this hook would mean a second cache, a second batch and a second
  // decoder — so there is exactly one, here.
  const evidenceState = useSessionEvidence(clips, sourceIndices)
  // Read from BOTH non-idle states, deliberately: `extracting` carries the sections the previous
  // pass produced, so a re-extraction — which the scale-pass graft triggers on every default run —
  // leaves the imagery on screen instead of blanking every card for the length of a decode
  // (`strides-3ui`). Only `idle` means "nothing has been produced for this session".
  //
  // A metric the run has planned but not yet decoded rides along as a PENDING entry, so its card
  // says "being prepared" rather than showing the same empty space a metric with no picture at all
  // shows. `MetricsPanel` keys these by metric, so the concatenation order is immaterial.
  const evidence: readonly MetricCardEvidence[] =
    evidenceState.status === 'idle'
      ? NO_EVIDENCE
      : evidenceState.status === 'settled'
        ? evidenceState.sections.filter((section) => sourceIndices?.[section.metric] === section.clipIndex)
        : [
            ...evidenceState.sections.filter((section) => sourceIndices?.[section.metric] === section.clipIndex),
            ...evidenceState.pending.map((metric) => ({
              metric,
              clipIndex: sourceIndices?.[metric] ?? 0,
              items: [],
              pending: true as const,
            })),
          ]

  const handleTryAgain = useCallback(() => {
    const errored = clips.find((c) => c.analysis.phase === 'error')
    errored?.analysis.reset()
    // Focus lands on the page heading, not on the errored clip's `<video>`. That element is no
    // longer in the page body — it is positioned off screen and marked `inert`, so focusing it
    // would silently drop focus to `<body>` and strand a keyboard user. Same target
    // `handleStartOver` uses, and for the same reason: it is the nearest thing that
    // survives the alert unmounting underneath the button that was just clicked.
    headingRef.current?.focus()
  }, [clips, headingRef])

  const handleStartOver = useCallback(() => {
    // Every clip in the session is going away, so every poster is too. Same posture as
    // `removeClip`: released here and again by each slot's own cleanup, idempotently.
    for (const session of Object.values(clipStates)) releaseClipPoster(session.poster)

    setClipIds([])
    setPendingLoads({})
    setClipStates({})
    setActiveClipIndex(0)
    setScalePassLeaseClipId(null)
    setPresentedClipId(null)
    headingRef.current?.focus()
  }, [clipStates, headingRef])

  // What every results view is given — identical by construction (`GuidedResultsViewProps` IS
  // `ResultsViewProps`), so the three stay interchangeable at the one conditional that picks one.
  const resultsViewProps: GuidedResultsViewProps = {
    analysis: aggregate,
    onTryAgain: handleTryAgain,
    onStartOver: handleStartOver,
    evidence,
    clipCount: clips.length,
    clipViews,
    sourceIndices,
    onOpenEvidenceVideo: clips.every(
      (clip) => !clipHostsLiveElement(clip.analysis.phase, clip.analysis.scalePass.status),
    )
      ? openEvidenceVideo
      : undefined,
  }

  return (
    <>
      <header ref={headerRef} className="sticky top-0 z-10 border-b-2 border-black dark:border-white bg-white dark:bg-black px-4 sm:px-6 py-4">
        {/*
          `flex-wrap` exists for the add-a-clip panel and nothing else: it is the one item allowed
          to take a line of its own (`basis-full`), which is what keeps it BELOW the strip instead
          of over it. The three items on the first line are unaffected — the strip is `flex-1`
          (`flex-basis: 0`), so it shrinks rather than wrapping and never displaces the wordmark or
          the trigger.
        */}
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <div className="shrink-0">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-2xl font-bold tracking-tight focus:outline-none"
            >
              Strides
            </h1>
            {/*
              Dropped below `sm`. The tagline is ~250 px wide and this block does not shrink, so
              on a phone it left the strip about 90 px — narrower than a single 96 px entry, which
              clipped the working clip's element at the strip's edge. That is not merely untidy:
              an entry scrolled or clipped out of the strip's bounds is a partially concealed
              element, and concealment is what costs sampled frames. The wordmark stays at every
              width; the sentence is the part a narrow viewport can afford to lose.
            */}
            <p className="hidden font-sans text-sm text-neutral-600 sm:block dark:text-neutral-400">
              Browser-based running form analysis.
            </p>
          </div>

          {/*
            The clip strip. Every clip's slot is mounted HERE, in the header, and each entry hosts
            that clip's own `<video>` — on screen and painting while it is being sampled, concealed
            off screen once nothing is reading it (`VideoInputPanel`). That placement is the
            correctness fix `strides-kyu.13` measured: concealment costs ~20-24% of the sampled
            frames on the playback path, at any size, by any mechanism.

            `overflow-x-auto` with `shrink-0` entries: a crowded strip scrolls within its own
            bounds instead of wrapping the header onto a second line. `min-w-0` is what lets it
            actually shrink inside the flex row rather than pushing the wordmark off screen. An
            entry scrolled out of view would be a concealed entry, so `ClipStripEntry` scrolls the
            working clip back into view when it starts.

            The SCROLLER is this wrapper, not the `<ul>` — moved out one level by `strides-utn.5`.
            The model-download entry has to be first in the bar and must NOT be a member of a list
            labelled *Clips* (it would break the one-entry-per-clip count that lets a reader match
            `"Combined from clip N of TOTAL"` by counting), so it is a preceding sibling — and a
            sibling OUTSIDE the scroller would permanently consume 96 px of the strip's visible
            width. That is not cosmetic: the strip's own box measures 158 px at a 390 px viewport,
            so a fixed leading entry plus the 12 px gap leaves 50 px of a 96 px clip frame — the
            working `<video>` more than half clipped out of the strip, which costs ~20-24% of its
            sampled frames. Inside the scroller, the working clip's own `scrollIntoView` pushes this
            entry off the left edge instead (measured: it scrolls 46 px and the frame stays whole).
          */}
          {(modelLoadStatus !== null || clipIds.length > 0) && (
            <div className="relative order-3 min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-1">
              <div
                ref={stripRef}
                className="clip-strip flex min-w-0 items-start gap-3 overflow-x-auto py-1 pb-2"
              >
                {modelLoadStatus !== null && <ModelLoadStripEntry status={modelLoadStatus} />}
                {clipIds.length > 0 && (
                  <ul aria-label="Clips; scroll sideways for more" className="flex shrink-0 items-start gap-3">
                    {clipIds.map((id, index) => (
                      <ClipSlot
                        key={id}
                        clipId={id}
                        pendingLoad={pendingLoads[id] ?? null}
                        detector={id === activeClipId ? detector : null}
                        index={index}
                        total={clipIds.length}
                        viewLabel={clipViews[index]}
                        isActiveClip={id === activeClipId}
                        scalePassAllowed={id === scalePassClipId}
                        isPresented={id === presentedClipId}
                        // Every clip shifts horizontally when the leading entry appears or leaves, so
                        // the working clip has to be scrolled back into view at that moment too — its
                        // own `hostsLiveElement` has not changed, and the scale pass's download starts
                        // precisely while a clip is already hosting its live element.
                        leadingEntryPresent={modelLoadStatus !== null}
                        onPresent={presentClip}
                        seekRequest={seekRequest?.clipId === id ? seekRequest : null}
                        onDismiss={dismissPreview}
                        onReport={handleReport}
                        onRemove={removeClip}
                      />
                    ))}
                  </ul>
                )}
              </div>
              {overflowCue && (
                <p className="pointer-events-none absolute right-0 -bottom-3 bg-white/95 px-1 font-sans text-[10px] font-semibold text-neutral-700 dark:bg-black/95 dark:text-neutral-300" aria-hidden="true">
                  {overflowCue === 'right' ? 'More clips →' : '← More clips'}
                </p>
              )}
            </div>
          )}

          {/*
            The picker, collapsed. Gated on exactly the complement of the body picker's own gate
            below, so the two presentations are mutually exclusive by construction — there is never
            a moment with two file inputs, two Upload tabs or two pairs of demo buttons on the page
            for a test or a reader to pick between.
          */}
          {anyClipVideoReady && <AddClipAction onSource={addClip} openRequest={addClipRequest} />}
        </div>
      </header>

      <main ref={mainRef} className="mx-auto max-w-6xl px-4 sm:px-6 py-10 space-y-8">
        {/*
          What a reader has to be able to READ about a clip cannot live in a 96x72 strip entry: the
          load-error alert and its Try again in particular, which `video-input`'s "Clear error
          messages for permission and format failures" requires be visible. So the element went to
          the strip and this stayed in the body, rendered from the state each slot reports up.
          `ClipLoadStatus` renders nothing at all for a clip that is neither loading nor broken.
        */}
        {clipIds.map((id) => {
          const session = clipStates[id]
          return session ? (
            <ClipLoadStatus key={id} videoSource={session.videoSource} />
          ) : null
        })}

        {/*
          The picker-vs-results gate is `anyClipVideoReady`, NOT `clipIds.length`: a clip that is
          still loading, or that failed to load, is not a *loaded* clip, so the picker stays on the
          page beside that clip's own error alert rather than leaving the reader with an error and
          no way forward.
        */}
        {!anyClipVideoReady && (
          <section className="space-y-4" aria-label="Add a clip">
            <ClipPicker onSource={addClip} />
          </section>
        )}

        {/*
          A plain paragraph, NOT a live region: the results view's status line is the session's one
          announced line. Phones take a minute or more (`strides-6i6`), so the wait is said once,
          up front, rather than discovered.
        */}
        {coarsePointer && analysisInFlight && (
          <p className="phone-wait-notice font-sans text-sm text-neutral-700 dark:text-neutral-300">
            Analysis on a phone can take a minute or more. Keep this tab open and in front until it
            finishes.
          </p>
        )}

        {/*
          Above BOTH views, rendered once here rather than copied into each: what the session is
          missing is a session fact, not a property of how the results are laid out.
        */}
        {coverage && <SessionCoverageNotice coverage={coverage} onAddClip={requestAddClip} />}

        {/*
          ONE view, chosen by a conditional — never two mounted with one hidden. The evidence
          imagery is real canvas ELEMENTS and a node has one parent, so a second mounted view would
          silently take every canvas from the first (guided-results-view design.md D7.3). All three
          take the same results props, and a switch unmounts one and mounts the other, so the
          canvases move across rather than being lost. The tour and the summary each wrap exactly
          one `GuidedResultsView`; only the classic table sits beside the motion stage.

          In the page body, not the header: the header's clip strip is `flex-1` and gives up width to
          anything beside it, and a strip entry squeezed or scrolled out of view is a concealed clip
          element — which costs sampled frames (`strides-kyu.13`).
        */}
        {anyClipVideoReady && (
          <div ref={viewRegionRef} className="space-y-8">
            {resultsViewMode === 'tour' && <RunnerTour {...resultsViewProps} onLeaveTour={leaveTour} />}
            {resultsViewMode === 'summary' && (
              <ResultsSummary
                {...resultsViewProps}
                onReplayTour={replayTour}
                onOpenClassic={showClassic}
              />
            )}
            {resultsViewMode === 'classic' && (
              <>
                <button
                  type="button"
                  data-view-entry
                  onClick={showSummary}
                  className="inline-flex items-center justify-center border-2 border-black px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black transition-colors hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-black"
                >
                  Show summary
                </button>
                <div className={aggregate.phase === 'idle' || aggregate.phase === 'error'
                  ? ''
                  : 'lg:grid lg:grid-cols-[minmax(16rem,19rem)_minmax(0,1fr)] lg:items-start lg:gap-6'}>
                  <MotionStoryStage
                    analysis={aggregate}
                    clips={clips}
                    sourceIndices={sourceIndices}
                    evidence={evidence}
                    resultsRef={resultsRef}
                  />
                  <div ref={resultsRef} className="min-w-0">
                    <ResultsView {...resultsViewProps} />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/*
          The in-body "Add another clip" block used to mount here. It is gone, not moved:
          `video-input` requires that no add-a-clip affordance remain in the page body, and what
          was here offered upload alone — the header's `AddClipAction` offers recording and the
          demo clips as well, which were unreachable for clips 2..N while that block was the only
          way in.
        */}

        {/*
          The standalone evidence gallery used to mount here, as a sibling of `ResultsView`. It no
          longer does: the imagery moved into the metric cards (`strides-ac9.2`), and the two
          surfaces cannot coexist — the extractor hands back canvas ELEMENTS, a node has exactly
          one parent, and whichever surface adopted a canvas second would silently steal it and
          leave the first showing an empty box. The cards are the evidence surface now.
          `EvidenceGallery.tsx` was retired by `strides-ac9.3`; `useSessionEvidence` owns extraction now.
        */}
      </main>
    </>
  )
}
