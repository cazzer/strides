import { useCallback, useState } from 'react'
import type { RefObject } from 'react'
import type { PoseDetector } from '../pose/detector'
import { FileUpload } from '../video/FileUpload'
import { ClipSlot } from './ClipSlot'
import type { ClipPendingLoad } from './ClipSlot'
import { ResultsView } from './ResultsView'
import { computeAggregateAnalysisState, nextActiveClipIndex } from './multiClipAnalysis'
import type { ClipSession } from './multiClipAnalysis'

export interface MultiClipVideoSessionProps {
  /** The one shared, stateful pose detector for the whole page — handed to exactly one active
   * clip at a time (see `nextActiveClipIndex`); every other clip gets `null`. */
  detector: PoseDetector | null
  /** Owned by `App.tsx` (the page heading lives in its header, outside this component) — "choose
   * a different video" moves focus there once this whole session resets, the same fix already
   * applied for the single-clip flow this generalizes. */
  headingRef: RefObject<HTMLHeadingElement | null>
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
 */
function sameClipSession(previous: ClipSession | undefined, next: ClipSession): boolean {
  if (!previous) return false
  return (
    previous.videoSource.status === next.videoSource.status &&
    previous.videoSource.metadata === next.videoSource.metadata &&
    previous.videoSource.error === next.videoSource.error &&
    previous.analysis.phase === next.analysis.phase &&
    previous.analysis.progress === next.analysis.progress &&
    previous.analysis.isPausedMidAnalysis === next.analysis.isPausedMidAnalysis &&
    previous.analysis.robustFrames === next.analysis.robustFrames &&
    previous.analysis.heuristics === next.analysis.heuristics &&
    previous.analysis.diagnostics === next.analysis.diagnostics &&
    previous.analysis.error === next.analysis.error &&
    previous.analysis.scalePass.status === next.analysis.scalePass.status &&
    previous.analysis.scalePass.diagnostics === next.analysis.scalePass.diagnostics &&
    previous.analysis.scalePass.error === next.analysis.scalePass.error &&
    previous.analysis.scalePass.reason === next.analysis.scalePass.reason
  )
}

/**
 * Owns a multi-clip session: which clips exist, what each was pre-loaded with (if anything), and
 * every clip's live `{ videoSource, analysis }` reported up from its `ClipSlot`. Renders one
 * `ClipSlot` per clip, hands the shared detector to exactly one of them (the serialization
 * mitigation — see this change's design.md D5/D6), and feeds the unmodified `ResultsView` the
 * fused aggregate from `computeAggregateAnalysisState`.
 */
export function MultiClipVideoSession({ detector, headingRef }: MultiClipVideoSessionProps) {
  const [clipIds, setClipIds] = useState<string[]>(() => [makeClipId()])
  const [pendingLoads, setPendingLoads] = useState<Record<string, ClipPendingLoad>>({})
  const [clipStates, setClipStates] = useState<Record<string, ClipSession>>({})
  const [activeClipIndex, setActiveClipIndex] = useState(0)

  const handleReport = useCallback((clipId: string, session: ClipSession) => {
    setClipStates((prev) => {
      if (sameClipSession(prev[clipId], session)) return prev
      return { ...prev, [clipId]: session }
    })
  }, [])

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
      clipStates[id]?.analysis.reset()

      setClipIds((prev) => (prev.length <= 1 ? prev : prev.filter((existing) => existing !== id)))
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

  // Adjusts which clip is active during render, mirroring useVideoAnalysis.ts's own
  // "adjusting state when a prop changes" pattern (React's documented approach —
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders):
  // computed fresh every render so this pass's JSX below is always consistent even while the
  // state update above is still propagating.
  const desiredActiveIndex = nextActiveClipIndex(clips, activeClipIndex)
  if (desiredActiveIndex !== activeClipIndex) {
    setActiveClipIndex(desiredActiveIndex)
  }
  const activeClipId = clips[desiredActiveIndex]?.clipId ?? null

  const aggregate = computeAggregateAnalysisState(clips)
  const anyClipVideoReady = clips.some((c) => c.videoSource.status === 'ready')

  const handleTryAgain = useCallback(() => {
    const errored = clips.find((c) => c.analysis.phase === 'error')
    errored?.analysis.reset()
    errored?.videoSource.videoRef.current?.focus()
  }, [clips])

  const handleChooseDifferentVideo = useCallback(() => {
    setClipIds([makeClipId()])
    setPendingLoads({})
    setClipStates({})
    setActiveClipIndex(0)
    headingRef.current?.focus()
  }, [headingRef])

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-10 space-y-8 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8 lg:space-y-0">
      {/* Sticky video column — see App.tsx's prior version of this comment for the layout
          rationale, unchanged by going multi-clip. */}
      <div className="lg:sticky lg:top-[86px] space-y-6">
        {clipIds.map((id) => (
          <ClipSlot
            key={id}
            clipId={id}
            pendingLoad={pendingLoads[id] ?? null}
            detector={id === activeClipId ? detector : null}
            onReport={handleReport}
            onRemove={removeClip}
            canRemove={clipIds.length > 1}
          />
        ))}
        {anyClipVideoReady && (
          <div className="space-y-2 border-t-2 border-black dark:border-white pt-4">
            <p className="font-sans text-sm font-semibold uppercase tracking-wide">
              Add another clip
            </p>
            <FileUpload onSelected={(file) => addClip(file)} />
          </div>
        )}
      </div>
      <div className="lg:max-h-[calc(100vh-86px)] lg:overflow-y-auto">
        {anyClipVideoReady && (
          <ResultsView
            analysis={aggregate}
            onTryAgain={handleTryAgain}
            onChooseDifferentVideo={handleChooseDifferentVideo}
          />
        )}
      </div>
      {/*
        Evidence-gallery mount point: a THIRD child of <main> and a sibling of ResultsView, never
        a child of it (the grid is two-column, so the gallery needs `lg:col-span-2` to span rather
        than land in column 1 of row 2). Everything it needs is already in scope here and needs no
        new plumbing:

          clips                              — one `ClipSession` per analyzed clip, in the same
                                               order the aggregate fused them, each carrying its
                                               own `videoSource.sourceBlob`/`metadata` and its own
                                               non-null `analysis.robustFrames` (the aggregate's
                                               are null by design — see `multiClipAnalysis.ts`)
          computeFusionSourceIndices(clips)  — which of those clips each FUSED metric was selected
                                               from, or null until every clip is ready

        i.e. `<EvidenceGallery clips={clips} sourceIndices={sourceIndices} />` once that map is
        non-null, spanning both grid columns. Deliberately not rendered yet: the component is a
        separate ticket's, and a placeholder that renders nothing would be UI scaffolding this one
        has no use for.
      */}
    </main>
  )
}
