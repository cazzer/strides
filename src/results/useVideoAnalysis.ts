import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseDetector } from '../pose/detector'
import type { VideoMetadata, VideoSource } from '../video/types'
import { applyRobustness } from '../pose/robustness/interpolate'
import type { PoseSample } from '../pose/robustness/types'
import { computeFormHeuristics } from '../heuristics/index'
import { trimToPresenceWindow } from '../heuristics/presenceWindow'
import { computeVerticalOscillationCm } from '../heuristics/verticalOscillationCm'
import { sampleClip } from './sampleClip'
import type { SampleClipHandle } from './sampleClip'
import { computeAnalysisDiagnostics } from './analysisDiagnostics'
import { resolveSamplingRobustnessConfig } from './samplingRobustnessConfig'
import type { VideoAnalysisState } from './types'

function idleState(): Omit<VideoAnalysisState, 'start' | 'reset'> {
  return {
    phase: 'idle',
    progress: 0,
    isPausedMidAnalysis: false,
    robustFrames: null,
    heuristics: null,
    diagnostics: null,
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
  // Tracks which clip's `metadata` auto-start has already fired for, so it fires at most once
  // per freshly loaded clip — not every time `phase` happens to return to 'idle' (e.g. an
  // explicit `reset()`, or a stale run being abandoned). A new clip's `metadata` is always a new
  // object identity, so this needs no separate reset step of its own.
  const autoStartedForRef = useRef<VideoMetadata | null>(null)

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
    // Clear any loop left armed by a previous run's ready-state loop-restart (see the effect
    // below) — a looping video never fires `ended`, which sampleClip relies on to resolve.
    video.loop = false
    const runId = ++runIdRef.current
    setState({ ...idleState(), phase: 'sampling' })

    // Resolved once per run — the sampling/robustness plane as one object, defaulting to
    // today's existing constants unless a dev-only eval-harness override is present. See
    // samplingRobustnessConfig.ts.
    const samplingRobustnessConfig = resolveSamplingRobustnessConfig()

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
        maxConsecutiveErrors: samplingRobustnessConfig.maxConsecutiveErrors,
        detectionTimeoutMs: samplingRobustnessConfig.detectionTimeoutMs,
      },
    )
    handleRef.current = handle

    // sampleClip deliberately doesn't call play() itself (see its docstring) — it must happen
    // here. Muted unconditionally: a manual "Analyze" click satisfies autoplay policy via its
    // synchronous call stack regardless, but start() is also called from the auto-start effect
    // below (no such call stack), so muting here — rather than only for that path — keeps one
    // code path reliable everywhere clips carry no audio the app uses anyway.
    video.muted = true
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
        const robustFrames = applyRobustness(sorted, samplingRobustnessConfig.robustness)
        // Metrics are computed over the presence-trimmed window (excludes stretches where the
        // subject isn't in frame at all) so frameCoverage/confidence aren't diluted by dead time
        // — but `robustFrames` itself stays untrimmed below, for the skeleton overlay and
        // diagnostics, which should keep showing the full, honest picture of the whole clip.
        // One trim, shared: the scale-calibrated centimetre figure has to be measured over exactly
        // the frames the metrics were measured over, or the two aren't comparable. A second
        // trimToPresenceWindow call would be a second chance for them to drift apart.
        const metricFrames = trimToPresenceWindow(robustFrames)
        const heuristics = computeFormHeuristics(metricFrames)
        // null on every backend that doesn't measure real-world scale — the diagnostics helper
        // omits its key entirely in that case.
        const scaleCalibration = computeVerticalOscillationCm(metricFrames)
        const diagnostics = computeAnalysisDiagnostics(
          sorted,
          robustFrames,
          heuristics,
          scaleCalibration,
        )
        if (runIdRef.current !== runId) return
        setState({
          phase: 'ready',
          progress: 1,
          isPausedMidAnalysis: false,
          robustFrames,
          heuristics,
          diagnostics,
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

  // Once analysis reaches 'ready', sampling has already left the video paused at 'ended' (see
  // sampleClip's docstring) — restart it with looping enabled so the skeleton overlay keeps
  // replaying instead of sitting on the last frame. Muted because this play() call happens well
  // outside the "Analyze" click's synchronous call stack, where autoplay policy is unreliable.
  useEffect(() => {
    if (state.phase !== 'ready') return
    const video = videoRef.current
    if (!video) return
    video.muted = true
    video.loop = true
    video.currentTime = 0
    video.play().catch(() => {
      // Autoplay still blocked: loop stays armed for whenever playback next starts.
    })
  }, [state.phase, videoRef])

  // Auto-starts analysis the moment a freshly loaded clip is ready and a detector exists — no
  // explicit click required. Doesn't fire while `detector` is `null` (still loading, or it never
  // loads at all); either way the manual "Analyze" control remains available as a fallback and
  // surfaces the real `detector-unavailable` error if the detector truly never becomes available.
  // Fires at most once per clip (`autoStartedForRef`) — otherwise an explicit `reset()` back to
  // `'idle'` while the same clip is still `'ready'` would immediately auto-restart itself.
  useEffect(() => {
    if (
      videoSource.status !== 'ready' ||
      state.phase !== 'idle' ||
      !detector ||
      !metadata ||
      autoStartedForRef.current === metadata
    )
      return
    autoStartedForRef.current = metadata
    start()
  }, [videoSource.status, state.phase, detector, metadata, start])

  // Development-only: auto-logs the full diagnostics object once a run reaches 'ready', for
  // driving the app via browser automation across a batch of test clips and reading the result
  // back out of the console — see analysisDiagnostics.ts. import.meta.env.DEV lets the bundler
  // dead-code-eliminate this whole branch from a production build, not just skip it at runtime.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (state.phase !== 'ready' || !state.diagnostics) return
    console.log('[analysis-diagnostics]', JSON.stringify(state.diagnostics))
  }, [state.phase, state.diagnostics])

  return { ...state, start, reset }
}
