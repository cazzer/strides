import { useCallback, useRef, useState } from 'react'
import type { MetricId } from '../heuristics/types'
import type { PoseDetector } from '../pose/detector'
import { ClipLoadStatus } from '../video/ClipLoadStatus'
import { ClipPicker } from '../video/ClipPicker'
import { FileUpload } from '../video/FileUpload'
import { releaseClipPoster } from '../video/posterFrame'
import { ClipSlot } from './ClipSlot'
import type { ClipPendingLoad } from './ClipSlot'
import { EvidenceGallery } from './EvidenceGallery'
import { ResultsView } from './ResultsView'
import {
  computeAggregateAnalysisState,
  computeFusionSourceIndices,
  nextActiveClipIndex,
} from './multiClipAnalysis'
import type { ClipSession } from './multiClipAnalysis'

/** Stable empty set, so "no gallery yet" never re-renders the cards with a fresh identity. */
const NO_EVIDENCE_METRICS: ReadonlySet<MetricId> = new Set()

export interface MultiClipVideoSessionProps {
  /** The one shared, stateful pose detector for the whole page — handed to exactly one active
   * clip at a time (see `nextActiveClipIndex`); every other clip gets `null`. */
  detector: PoseDetector | null
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
    previous.analysis.scalePass.reason === next.analysis.scalePass.reason &&
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
export function MultiClipVideoSession({ detector }: MultiClipVideoSessionProps) {
  // "Choose a different video" (a whole-session reset) unmounts the results and returns the page
  // to the picker, so the button's focus needs to land on something that survives the transition —
  // the page heading, the one thing on the page that is always there. Same fix already applied
  // once for the single-clip flow (WebcamCapture, #4).
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Seeded EMPTY, and that is the whole point: a session with no clips is now representable, so
  // the zero-clip state is genuinely "no clips" rather than "one slot whose videoSource.status is
  // 'empty'". Every clip, the first one included, is now created by `addClip` and loaded through a
  // `pendingLoad` — one clip-creation path instead of two. That also deletes a real bug: selecting
  // three files from the old first slot's own picker called `load()` three times on ONE
  // `useVideoSource` and produced a single clip, last file wins.
  const [clipIds, setClipIds] = useState<string[]>([])
  const [pendingLoads, setPendingLoads] = useState<Record<string, ClipPendingLoad>>({})
  const [clipStates, setClipStates] = useState<Record<string, ClipSession>>({})
  const [activeClipIndex, setActiveClipIndex] = useState(0)
  // Which clip's preview is open, or `null`. Session-level rather than per-slot because it is a
  // mutually exclusive choice: exactly one clip can be presented at a time, and "presented" is the
  // third conjunct of every clip's loop condition (design.md D1), so two open previews would mean
  // two clips decoding at once — precisely what scoping the loop to presentation exists to stop.
  const [presentedClipId, setPresentedClipId] = useState<string | null>(null)
  // Reported up by the evidence gallery once it knows which metrics it actually produced imagery
  // for — the same report-up/fan-down shape `ClipSlot` already uses, and the only way the cards
  // (a sibling subtree) can learn it: whether a metric has evidence is not derivable from
  // `heuristics`, since an emitted exemplar can still fail to resolve or fail to extract.
  const [reportedEvidenceMetrics, setReportedEvidenceMetrics] =
    useState<ReadonlySet<MetricId>>(NO_EVIDENCE_METRICS)

  const handleReport = useCallback((clipId: string, session: ClipSession) => {
    setClipStates((prev) => {
      if (sameClipSession(prev[clipId], session)) return prev
      return { ...prev, [clipId]: session }
    })
  }, [])

  const dismissPreview = useCallback(() => setPresentedClipId(null), [])

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

  // Which clip each FUSED metric was selected from, or null until every clip is ready — the same
  // gate `aggregate.heuristics !== null` passes, so the gallery can never attribute a result that
  // has not been fused yet. Deriving `evidenceMetrics` from it rather than storing the reset means
  // an in-flight new clip drops the cards' deep links in the same render the gallery unmounts.
  const sourceIndices = computeFusionSourceIndices(clips)
  const evidenceMetrics =
    sourceIndices === null ? NO_EVIDENCE_METRICS : reportedEvidenceMetrics

  const handleTryAgain = useCallback(() => {
    const errored = clips.find((c) => c.analysis.phase === 'error')
    errored?.analysis.reset()
    // Focus lands on the page heading, not on the errored clip's `<video>`. That element is no
    // longer in the page body — it is positioned off screen and marked `inert`, so focusing it
    // would silently drop focus to `<body>` and strand a keyboard user. Same target
    // `handleChooseDifferentVideo` uses, and for the same reason: it is the nearest thing that
    // survives the alert unmounting underneath the button that was just clicked.
    headingRef.current?.focus()
  }, [clips, headingRef])

  const handleChooseDifferentVideo = useCallback(() => {
    // Every clip in the session is going away, so every poster is too. Same posture as
    // `removeClip`: released here and again by each slot's own cleanup, idempotently.
    for (const session of Object.values(clipStates)) releaseClipPoster(session.poster)

    setClipIds([])
    setPendingLoads({})
    setClipStates({})
    setActiveClipIndex(0)
    setPresentedClipId(null)
    setReportedEvidenceMetrics(NO_EVIDENCE_METRICS)
    headingRef.current?.focus()
  }, [clipStates, headingRef])

  return (
    <>
      <header className="sticky top-0 z-10 border-b-2 border-black dark:border-white bg-white dark:bg-black px-4 sm:px-6 py-4">
        <div className="flex items-center gap-4 sm:gap-6">
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
          */}
          {clipIds.length > 0 && (
            <ul
              aria-label="Clips"
              className="clip-strip flex min-w-0 flex-1 items-start gap-3 overflow-x-auto py-1"
            >
              {clipIds.map((id, index) => (
                <ClipSlot
                  key={id}
                  clipId={id}
                  pendingLoad={pendingLoads[id] ?? null}
                  detector={id === activeClipId ? detector : null}
                  index={index}
                  total={clipIds.length}
                  isActiveClip={id === activeClipId}
                  isPresented={id === presentedClipId}
                  onPresent={setPresentedClipId}
                  onDismiss={dismissPreview}
                  onReport={handleReport}
                  onRemove={removeClip}
                />
              ))}
            </ul>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-10 space-y-8">
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

        {anyClipVideoReady && (
          <ResultsView
            analysis={aggregate}
            onTryAgain={handleTryAgain}
            onChooseDifferentVideo={handleChooseDifferentVideo}
            evidenceMetrics={evidenceMetrics}
          />
        )}

        {anyClipVideoReady && (
          <div className="space-y-2 border-t-2 border-black dark:border-white pt-4">
            <p className="font-sans text-sm font-semibold uppercase tracking-wide">
              Add another clip
            </p>
            <FileUpload onSelected={(file) => addClip(file)} />
          </div>
        )}

        {/*
          The evidence gallery: a sibling of ResultsView, never a child of it — everything it needs
          is already in scope here: `clips` (each carrying its own `videoSource.sourceBlob`/
          `metadata` and its own non-null `analysis.robustFrames` — the aggregate's are null by
          design, see `multiClipAnalysis.ts`) and the per-metric winning clip index. It renders
          nothing until it has images, so the null-guard below is the mount gate, not a visibility
          one.
        */}
        {sourceIndices !== null && (
          <EvidenceGallery
            clips={clips}
            sourceIndices={sourceIndices}
            onEvidenceMetricsChange={setReportedEvidenceMetrics}
          />
        )}
      </main>
    </>
  )
}
