import { useLayoutEffect, useRef } from 'react'
import type { PoseDetector } from '../pose/detector'
import { useVideoSource } from '../video/useVideoSource'
import { VideoInputPanel } from '../video/VideoInputPanel'
import { SkeletonOverlay } from './SkeletonOverlay'
import { useVideoAnalysis } from './useVideoAnalysis'
import type { ClipSession } from './multiClipAnalysis'

export interface ClipPendingLoad {
  source: Blob | File
  opts?: { frameRateHint?: number }
}

export interface ClipSlotProps {
  clipId: string
  /** A source already chosen before this slot existed (e.g. one file out of a multi-file
   * session-level picker) — loaded once, on mount. `null` for a slot whose own (unmodified)
   * `VideoInputPanel` picker is how the user chooses its clip interactively. */
  pendingLoad: ClipPendingLoad | null
  /** Non-null only for the one clip currently allowed to sample against the shared, stateful
   * pose detector (see `nextActiveClipIndex` / the concurrency mitigation in this change's
   * design.md) — `null` for every other clip. `useVideoAnalysis` already treats `null` as "no
   * detector available," so this reuses an existing contract rather than adding a new one. */
  detector: PoseDetector | null
  /** Called after every render with this clip's current `{ videoSource, analysis }` — the
   * caller (`MultiClipVideoSession`) must be the one that decides whether anything meaningful
   * changed before committing state, since this fires on every render, not just on real
   * transitions. */
  onReport: (clipId: string, session: ClipSession) => void
  onRemove: (clipId: string) => void
  /** Removal is disabled below one remaining clip — a multi-clip session always keeps at least
   * one slot to show a picker in. */
  canRemove: boolean
}

/**
 * Mounts one full, completely unmodified `useVideoSource()` + `useVideoAnalysis()` pair for one
 * clip. This is the whole of the "compose hooks, don't rewrite them" architecture (design.md D1)
 * — neither hook is touched by this file, so a single mounted `ClipSlot` behaves exactly as
 * `App.tsx` used to behave directly.
 */
export function ClipSlot({
  clipId,
  pendingLoad,
  detector,
  onReport,
  onRemove,
  canRemove,
}: ClipSlotProps) {
  const videoSource = useVideoSource()
  const analysis = useVideoAnalysis(videoSource, detector)

  // Loads a pre-chosen source exactly once, before paint (useLayoutEffect, not useEffect) — so a
  // clip created with a `pendingLoad` never flashes VideoInputPanel's picker UI for a frame
  // before the load kicks in. Guarded by a ref rather than a dependency array: `pendingLoad` is
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
  // timing a user-triggered load naturally has — without the visible picker-UI flash a
  // `setTimeout` would introduce (microtasks still flush before the browser paints).
  const loadStartedRef = useRef(false)
  useLayoutEffect(() => {
    if (loadStartedRef.current || !pendingLoad) return
    loadStartedRef.current = true
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
    onReport(clipId, { clipId, videoSource, analysis })
  })

  return (
    <div className="clip-slot space-y-2">
      <VideoInputPanel videoSource={videoSource}>
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
      {videoSource.status === 'ready' && analysis.phase === 'idle' && !detector && (
        <p role="status">Queued — waiting for another clip to finish analyzing…</p>
      )}
      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(clipId)}
          className="inline-flex items-center justify-center border-2 border-black dark:border-white px-3 py-1.5 font-sans text-xs font-semibold uppercase tracking-wide text-black dark:text-white transition-colors hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Remove clip
        </button>
      )}
    </div>
  )
}
