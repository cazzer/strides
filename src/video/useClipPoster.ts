import { useEffect, useState } from 'react'
import { deriveClipPoster, releaseClipPoster } from './posterFrame'
import type { ClipPoster } from './posterFrame'
import type { VideoSource } from './types'

/**
 * Derives one poster frame for a clip and owns its lifetime, from an UNMODIFIED `VideoSource` — the
 * same "compose hooks, don't rewrite them" shape `ClipSlot` already uses for
 * `useVideoSource`/`useVideoAnalysis`. `null` until there is one, and `null` again the moment the
 * source it was derived from goes away.
 *
 * ### Why this cannot disturb the clip's own analysis
 *
 * It reads `sourceBlob` and `metadata`, and never `videoRef`. `deriveClipPoster` decodes the blob
 * on its own detached element, so the canonical `<video>` — the one `sampleClip` reads frames off
 * during a run, and the one `useVideoAnalysis` re-arms and replays once the run is `ready` — is
 * never seeked, never paused, and never even referenced. Nothing here can move a playback position
 * that something else is reading.
 *
 * ### Why `status === 'ready'` and not later
 *
 * Analysis auto-starts on the same condition, so a poster derived here can overlap a live sampling
 * run. That overlap is a one-shot decode of a single frame with a bounded timeout, not a per-frame
 * cost inside the loop, and waiting for `phase: 'ready'` instead would leave the clip strip empty
 * for the whole of the analysis — precisely the window in which it has per-clip progress to show.
 */
export function useClipPoster(videoSource: VideoSource): ClipPoster | null {
  const { status, sourceBlob, metadata } = videoSource
  const [poster, setPoster] = useState<ClipPoster | null>(null)

  useEffect(() => {
    // No bytes worth decoding — and nothing to clear either: `reset()` and a fresh `load()` both
    // change these deps, so the PREVIOUS run's cleanup has already released that poster and set
    // this back to `null` before control reaches here. Clearing again from the effect body would
    // only be a synchronous cascading render (`react-hooks/set-state-in-effect`).
    if (status !== 'ready' || sourceBlob === null || metadata === null) return

    let active = true
    let owned: ClipPoster | null = null

    void deriveClipPoster(sourceBlob, metadata).then((result) => {
      if (!active) {
        // Landed after this effect run was torn down (unmount, reset, or a new source). Nothing
        // will ever render it, so free it here — the cleanup below could not, it had nothing to
        // free at the time it ran.
        releaseClipPoster(result)
        return
      }
      owned = result
      setPoster(result)
    })

    return () => {
      active = false
      releaseClipPoster(owned)
      owned = null
      setPoster(null)
    }
  }, [status, sourceBlob, metadata])

  return poster
}
