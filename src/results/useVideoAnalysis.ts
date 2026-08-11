import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseDetector } from '../pose/detector'
import type { VideoSource } from '../video/types'
import { applyRobustness } from '../pose/robustness/interpolate'
import type { PoseSample } from '../pose/robustness/types'
import { computeFormHeuristics } from '../heuristics/index'
import { sampleClip } from './sampleClip'
import type { SampleClipHandle } from './sampleClip'
import type { VideoAnalysisState } from './types'

function idleState(): Omit<VideoAnalysisState, 'start' | 'reset'> {
  return {
    phase: 'idle',
    progress: 0,
    isPausedMidAnalysis: false,
    robustFrames: null,
    heuristics: null,
    error: null,
  }
}

/**
 * Drives one end-to-end analysis run: samples the loaded clip via `sampleClip` (playing it
 * once, at 1x), then runs the synchronous robustness + heuristics pipeline over the result.
 * Guards every state update behind a monotonic `runId` — the same stale-result-discard pattern
 * `useVideoQualityGate` (#6) already uses — so a `reset()`/new-clip-triggered abandonment of an
 * in-flight run can never have its (still-resolving) `sampleClip` promise clobber state that has
 * already moved on.
 */
export function useVideoAnalysis(
  videoSource: VideoSource,
  detector: PoseDetector | null,
): VideoAnalysisState {
  const { videoRef, metadata } = videoSource

  const [state, setState] =
    useState<Omit<VideoAnalysisState, 'start' | 'reset'>>(idleState)
  // Tracks the metadata reference the analysis state currently reflects — compared during
  // render (not in an effect) per React's "adjusting state when a prop changes" pattern, so a
  // new clip's metadata identity change never needs to round-trip through an effect just to
  // call setState.
  const [trackedMetadata, setTrackedMetadata] = useState(metadata)

  const runIdRef = useRef(0)
  const handleRef = useRef<SampleClipHandle | null>(null)

  const abandonActiveRun = () => {
    handleRef.current?.stop()
    handleRef.current = null
    runIdRef.current += 1
  }

  // New clip loaded (or metadata otherwise replaced) abandons any stale run — mirrors
  // useVideoQualityGate's `dismissed`-reset-on-new-clip precedent. Only the *state* reset
  // happens here, during render (React's documented "adjusting state when a prop changes"
  // pattern — https://react.dev/reference/react/useState#storing-information-from-previous-renders):
  // refs can't be touched during render (react-hooks/refs), so the actual cancellation of any
  // in-flight `sampleClip` run is a side effect, handled by the effect below instead.
  if (metadata !== trackedMetadata) {
    setTrackedMetadata(metadata)
    setState(idleState())
  }

  // The side-effect half of the reset above: stop any in-flight run and invalidate its runId so
  // a late resolution can never clobber the fresh idle state already committed. Never calls
  // setState itself — it only synchronizes with the external sampling work — so this doesn't
  // trigger react-hooks/set-state-in-effect. The cleanup fires both when `metadata` is about to
  // change (abandoning the old clip's run) and on unmount (same cancellation, no clip change
  // involved) — one mechanism covers both, and is a no-op when nothing is active.
  useEffect(() => {
    return () => {
      abandonActiveRun()
    }
  }, [metadata])

  const reset = useCallback(() => {
    abandonActiveRun()
    setState(idleState())
  }, [])

  const start = useCallback(() => {
    const video = videoRef.current
    if (!detector) {
      abandonActiveRun()
      setState({
        ...idleState(),
        phase: 'error',
        error: {
          kind: 'detector-unavailable',
          message:
            'The pose detector is not ready yet — try again in a moment.',
        },
      })
      return
    }
    if (!video || !metadata) {
      abandonActiveRun()
      setState({
        ...idleState(),
        phase: 'error',
        error: { kind: 'unknown', message: 'No video is loaded to analyze.' },
      })
      return
    }

    handleRef.current?.stop()
    const runId = ++runIdRef.current
    setState({ ...idleState(), phase: 'sampling' })

    const { promise, handle } = sampleClip(
      video,
      detector,
      metadata.durationSec,
      {
        onProgress: (fraction) => {
          if (runIdRef.current !== runId) return
          setState((s) => ({ ...s, progress: fraction }))
        },
        onPausedChange: (paused) => {
          if (runIdRef.current !== runId) return
          setState((s) => ({ ...s, isPausedMidAnalysis: paused }))
        },
      },
    )
    handleRef.current = handle

    // sampleClip deliberately doesn't call play() itself (see its docstring) — it must happen
    // here, synchronously within this same click-handler call stack, to count as a user gesture
    // under browser autoplay policy. Without this the video never advances, rVFC never fires
    // past the first frame, and the run hangs at 0% forever.
    video.play().catch((err: unknown) => {
      handle.stop()
      if (runIdRef.current !== runId) return
      setState({
        ...idleState(),
        phase: 'error',
        error: {
          kind: 'unknown',
          message:
            err instanceof Error
              ? `Could not start video playback: ${err.message}`
              : 'Could not start video playback to begin analysis.',
        },
      })
    })

    void (async () => {
      let samples: PoseSample[]
      try {
        samples = await promise
      } catch (err) {
        if (runIdRef.current !== runId) return
        setState({
          ...idleState(),
          phase: 'error',
          error: {
            kind: 'detection-stalled',
            message:
              err instanceof Error
                ? err.message
                : 'Pose detection stalled unexpectedly.',
          },
        })
        return
      }

      if (runIdRef.current !== runId) return
      setState((s) => ({
        ...s,
        phase: 'processing',
        isPausedMidAnalysis: false,
      }))

      // Yield one tick so 'processing' is an observable render before the (fast, but
      // synchronous) robustness + heuristics pass below runs.
      await Promise.resolve()
      if (runIdRef.current !== runId) return

      try {
        // Cheap mitigation for mid-analysis scrubbing producing non-monotonic timestamps —
        // interpolate.ts's existing gapSeconds > 0 guard already degrades non-positive gaps to
        // 'unrecoverable' rather than crashing, so this is belt-and-suspenders.
        const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp)
        const robustFrames = applyRobustness(sorted)
        const heuristics = computeFormHeuristics(robustFrames)
        if (runIdRef.current !== runId) return
        setState({
          phase: 'ready',
          progress: 1,
          isPausedMidAnalysis: false,
          robustFrames,
          heuristics,
          error: null,
        })
      } catch (err) {
        if (runIdRef.current !== runId) return
        setState({
          ...idleState(),
          phase: 'error',
          error: {
            kind: 'unknown',
            message:
              err instanceof Error
                ? err.message
                : 'Analysis failed unexpectedly.',
          },
        })
      }
    })()
  }, [detector, videoRef, metadata])

  return { ...state, start, reset }
}
