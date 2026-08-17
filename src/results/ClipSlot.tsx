import { useLayoutEffect, useRef } from 'react'
import type { PoseDetector } from '../pose/detector'
import { useClipPoster } from '../video/useClipPoster'
import { useVideoSource } from '../video/useVideoSource'
import { VideoInputPanel } from '../video/VideoInputPanel'
import { ClipStripEntry } from './ClipStripEntry'
import { clipHostsLiveElement, describeClipStripStatus } from './clipStripStatus'
import { SkeletonOverlay } from './SkeletonOverlay'
import { useVideoAnalysis } from './useVideoAnalysis'
import type { ClipSession } from './multiClipAnalysis'

export interface ClipPendingLoad {
  source: Blob | File
  opts?: { frameRateHint?: number }
}

export interface ClipSlotProps {
  clipId: string
  /** The source chosen before this slot existed — loaded once, on mount. Since the session
   * models zero clips and creates every clip (the first one included) through `addClip`, a slot
   * mounted by `MultiClipVideoSession` always has one; `null` remains legal for a slot mounted
   * with nothing to load, which is what the tests exercise. */
  pendingLoad: ClipPendingLoad | null
  /** Non-null only for the one clip currently allowed to sample against the shared, stateful
   * pose detector (see `nextActiveClipIndex` / the concurrency mitigation in this change's
   * design.md) — `null` for every other clip. `useVideoAnalysis` already treats `null` as "no
   * detector available," so this reuses an existing contract rather than adding a new one. */
  detector: PoseDetector | null
  /** Zero-based position in clip-session order, and how many clips there are. Presentation only —
   * the entry says "Clip 2 of 3", matching the order fusion's source index and the "Combined from
   * clip N of TOTAL" copy already number clips by. Defaulted so a slot rendered in isolation (the
   * tests) still describes itself sensibly. */
  index?: number
  total?: number
  /**
   * Whether this clip is the one `nextActiveClipIndex` currently points at.
   *
   * NOT derivable from `detector` here, which is why it is a prop: the shared detector is `null`
   * for every non-active clip AND for the active one while `usePoseDetector` is still loading the
   * model, so `!detector` reads a lone first clip as "queued behind another clip" during startup.
   * `MultiClipVideoSession` already computes `activeClipId` every render, so this is a value being
   * passed down rather than a new one being derived (design.md D3, "No new plumbing").
   */
  isActiveClip?: boolean
  /**
   * Whether this clip's preview is currently open. The session owns it (at most one clip is
   * presented at a time) and it reaches three places from here: the loop condition inside
   * `useVideoAnalysis` (design.md D1's third conjunct), the element's placement, and the entry,
   * which grows its frame into the dialog's stage.
   */
  isPresented?: boolean
  onPresent?: (clipId: string) => void
  onDismiss?: () => void
  /** Called after every render with this clip's current `{ videoSource, analysis }` — the
   * caller (`MultiClipVideoSession`) must be the one that decides whether anything meaningful
   * changed before committing state, since this fires on every render, not just on real
   * transitions. */
  onReport: (clipId: string, session: ClipSession) => void
  onRemove: (clipId: string) => void
}

/**
 * Mounts one full, completely unmodified `useVideoSource()` + `useVideoAnalysis()` pair for one
 * clip, and renders that clip's entry in the header strip. This is the whole of the "compose
 * hooks, don't rewrite them" architecture (design.md D1) — neither hook is touched by this file.
 *
 * ### Why the strip entry is rendered HERE and not by the strip
 *
 * The entry is where the clip's canonical `<video>` lives while its analysis is in flight, and that
 * element cannot be reparented or remounted at any point in its life (`results-view`, "Clip video
 * elements stay mounted and playable while hidden"). Rendering the entry from the component that
 * already owns the element makes the element a plain, permanent child of the entry, so moving
 * between "on screen because it is being sampled" and "concealed off screen" is a CSS change and
 * nothing else. Every alternative — a portal into the header, or positioning the element over a
 * separately-rendered entry's measured rect — reintroduces exactly the two failure modes
 * `strides-kyu.13` warned about: a target that is null on first render, and an element that ends up
 * under the sticky header while every class name still looks right.
 *
 * Anything a reader has to actually READ about this clip (its load error, its "processing video"
 * line) is not here: it cannot be, inside a 96x72 box. `MultiClipVideoSession` renders that in the
 * page body from the state this slot reports up.
 */
export function ClipSlot({
  clipId,
  pendingLoad,
  detector,
  index = 0,
  total = 1,
  isActiveClip = false,
  isPresented = false,
  onPresent,
  onDismiss,
  onReport,
  onRemove,
}: ClipSlotProps) {
  const videoSource = useVideoSource()
  const analysis = useVideoAnalysis(videoSource, detector, isPresented)
  // Reads `videoSource`'s blob and metadata only, never its `videoRef` — the poster is decoded on
  // a detached element, so it cannot move the playback position `sampleClip` is reading from (see
  // `useClipPoster`). Released by that hook's own cleanup when this slot unmounts.
  const poster = useClipPoster(videoSource)

  // Loads a pre-chosen source exactly once, before paint (useLayoutEffect, not useEffect) — so a
  // clip created with a `pendingLoad` never flashes an empty entry for a frame before the load
  // kicks in. Guarded by a ref rather than a dependency array: `pendingLoad` is
  // provided once at creation time and is never expected to change identity for a given clipId.
  //
  // The actual `load()` call is deferred one microtask (`queueMicrotask`), not called directly
  // from the effect body — verified live (real GPU, two-clip session) that calling it
  // synchronously here corrupts the SECOND (and only the second) mounted clip's video under
  // React StrictMode's dev-only double-invoke: `useVideoSource`'s own unmount-cleanup effect
  // (untouched, out of this change's scope) revokes the freshly-created object URL as part of
  // StrictMode's synthetic cleanup-then-resetup pass for THIS component's first mount, which a
  // clip loaded from a later, real user interaction (never a mount-time effect, until this
  // pendingLoad path existed) never triggered. `queueMicrotask` defers the call until after that
  // synchronous double-invoke dance has already finished — same "after mount has settled"
  // timing a user-triggered load naturally has — without the visible flash a `setTimeout` would
  // introduce (microtasks still flush before the browser paints).
  const loadStartedRef = useRef(false)
  useLayoutEffect(() => {
    if (loadStartedRef.current || !pendingLoad) return
    loadStartedRef.current = true
    // Depends on StrictMode's mount→cleanup→remount dance running fully synchronously (no await/
    // microtask yield in between) so that by the time this microtask callback runs, the dance has
    // already settled — that's documented *behavior* of React's dev-only StrictMode simulation,
    // not a guarantee of React's public API, so a future React version that changes StrictMode's
    // internal timing could silently reopen the corruption bug this defers past (see the comment
    // above) without anything here failing loudly.
    queueMicrotask(() => {
      videoSource.load(pendingLoad.source, pendingLoad.opts)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per mounted clip, by design
  }, [])

  // Reports this clip's live state up on every render. Deliberately unconditional (no
  // dependency array) rather than gated on a derived "did anything change" check here — that
  // responsibility belongs to the caller, which already holds the previous value to diff
  // against and can bail out of its own state update without triggering another render.
  useLayoutEffect(() => {
    onReport(clipId, { clipId, videoSource, analysis, poster })
  })

  // The correctness predicate, not a display preference: while this is true, something is reading
  // frames off the element and concealing it costs ~20-24% of them (`clipHostsLiveElement`).
  const hostsLiveElement = clipHostsLiveElement(analysis.phase, analysis.scalePass.status)

  const status = describeClipStripStatus({
    videoStatus: videoSource.status,
    phase: analysis.phase,
    progress: analysis.progress,
    isPausedMidAnalysis: analysis.isPausedMidAnalysis,
    scalePassStatus: analysis.scalePass.status,
    isActiveClip,
  })

  return (
    <ClipStripEntry
      index={index}
      total={total}
      status={status}
      poster={poster}
      hostsLiveElement={hostsLiveElement}
      isActiveClip={isActiveClip}
      isPresented={isPresented}
      onPresent={() => onPresent?.(clipId)}
      onDismiss={() => onDismiss?.()}
      onRemove={() => onRemove(clipId)}
    >
      {/*
        `onScreen` for either reason — something is sampling this element, or a reader is looking
        at it. They compose: opening a preview mid-analysis keeps the element on screen (larger,
        in the dialog's stage) rather than pulling it out of the strip, so the ~20-24% sampled-
        frame cost of concealment is never re-incurred (design.md D2's resolution).

        `interactive` is the strictly narrower one: the native controls write into the very
        playback state the pipeline owns while a run is in flight, so they stay `inert` until
        nothing is reading the element.
      */}
      <VideoInputPanel
        videoSource={videoSource}
        onScreen={hostsLiveElement || isPresented}
        interactive={isPresented && !hostsLiveElement}
      >
        {analysis.phase === 'ready' &&
          analysis.robustFrames &&
          videoSource.metadata && (
            <SkeletonOverlay
              videoRef={videoSource.videoRef}
              frames={analysis.robustFrames}
              metadata={videoSource.metadata}
            />
          )}
      </VideoInputPanel>
    </ClipStripEntry>
  )
}
