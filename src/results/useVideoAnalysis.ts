import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseDetector } from '../pose/detector'
import type { VideoMetadata, VideoSource } from '../video/types'
import { applyRobustness } from '../pose/robustness/interpolate'
import type { PoseSample } from '../pose/robustness/types'
import { computeFormHeuristics } from '../heuristics/index'
import { trimToPresenceWindow } from '../heuristics/presenceWindow'
import { sampleClip } from './sampleClip'
import type { SampleClipHandle } from './sampleClip'
import { computeAnalysisDiagnostics } from './analysisDiagnostics'
import { resolveSamplingRobustnessConfig } from './samplingRobustnessConfig'
import { resolveScalePassConfig } from './scalePassConfig'
import { graftScalePassResult } from './scalePassGraft'
import { getScalePassDetector } from '../pose/scalePassDetector'
import type { ScalePassState, VideoAnalysisState } from './types'

function idleState(): Omit<VideoAnalysisState, 'start' | 'reset'> {
  return {
    phase: 'idle',
    progress: 0,
    isPausedMidAnalysis: false,
    robustFrames: null,
    heuristics: null,
    diagnostics: null,
    scalePass: { status: 'idle', diagnostics: null },
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
  // The background scale pass's own sampling handle — separate from `handleRef` because the two
  // passes can never share one: a new primary run's `handleRef.current?.stop()` in `start()`
  // must not be able to miss a still-running scale pass, and vice versa.
  const scaleHandleRef = useRef<SampleClipHandle | null>(null)
  // Tracks which clip's `metadata` auto-start has already fired for, so it fires at most once
  // per freshly loaded clip — not every time `phase` happens to return to 'idle' (e.g. an
  // explicit `reset()`, or a stale run being abandoned). A new clip's `metadata` is always a new
  // object identity, so this needs no separate reset step of its own.
  const autoStartedForRef = useRef<VideoMetadata | null>(null)
  // Mirrors `autoStartedForRef` for the scale pass: which primary run's `runId` the pass has
  // already started for, so a re-render between the 'pending' commit and the 'running' commit
  // (or a strict-mode double-fire) can't start the pass twice for one run.
  const scalePassStartedForRunRef = useRef<number | null>(null)

  const abandonActiveRun = () => {
    handleRef.current?.stop()
    handleRef.current = null
    scaleHandleRef.current?.stop()
    scaleHandleRef.current = null
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
    // A still-running scale pass belongs to the run being replaced — without this stop, its
    // sampler stays attached to the video and runs MediaPipe inference concurrently with the
    // new primary run, silently degrading the new run's sampling density (review finding,
    // add-background-scale-pass).
    scaleHandleRef.current?.stop()
    scaleHandleRef.current = null
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
        // One trim, shared: `computeFormHeuristics` now computes the scale-calibrated centimetre
        // figure itself, as part of `verticalOscillationCm` (#36, D1), over these same
        // `metricFrames` — there is no second `trimToPresenceWindow` call left to drift apart from
        // this one, because there is no second computation left to feed it. `computeAnalysisDiagnostics`
        // reads that figure back off `heuristics.verticalOscillationCm.calibration` by reference
        // (D1b) rather than taking it as an input.
        const metricFrames = trimToPresenceWindow(robustFrames)
        const heuristics = computeFormHeuristics(metricFrames)
        const diagnostics = computeAnalysisDiagnostics(sorted, robustFrames, heuristics)
        if (runIdRef.current !== runId) return
        // Decide the background scale pass's fate at the moment the primary result exists
        // (add-background-scale-pass, D1): nothing to add when the primary backend already
        // measured a real-world scale (only possible via the dev-only mediapipe-primary backend
        // override today), and nothing to do when the kill switch is off. Config resolved once
        // per run, here — the same once-per-run discipline `resolveSamplingRobustnessConfig`
        // gets above. Gating on `verticalOscillationCm.calibration` alone is still the right
        // single check even though the pass now also backfills `stepWidthCm` (#45): both metrics
        // key off the identical underlying fact (`pixelsPerMeter` populated that frame), so this
        // gate already covers whether there's anything for either metric to gain from a pass.
        const scalePass: ScalePassState =
          heuristics.verticalOscillationCm.calibration !== null
            ? { status: 'skipped', reason: 'primary-scale', diagnostics: null }
            : !resolveScalePassConfig().enabled
              ? { status: 'skipped', reason: 'disabled', diagnostics: null }
              : { status: 'pending', diagnostics: null }
        setState({
          phase: 'ready',
          progress: 1,
          isPausedMidAnalysis: false,
          robustFrames,
          heuristics,
          diagnostics,
          scalePass,
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
  //
  // The background scale pass replays the same video for its own sampling, so this effect also
  // waits for it: while the pass is 'pending'/'running' the loop stays un-armed (a looping video
  // never fires 'ended', which the pass's sampleClip relies on), and this one declarative
  // condition owns re-arming — it fires immediately when the pass was skipped, and again the
  // moment the pass reaches 'done'/'failed'. No scale-pass code re-arms the loop imperatively.
  useEffect(() => {
    if (state.phase !== 'ready') return
    if (state.scalePass.status === 'pending' || state.scalePass.status === 'running') return
    const video = videoRef.current
    if (!video) return
    video.muted = true
    video.loop = true
    video.currentTime = 0
    video.play().catch(() => {
      // Autoplay still blocked: loop stays armed for whenever playback next starts.
    })
  }, [state.phase, state.scalePass.status, videoRef])

  // Drives the background scale pass (add-background-scale-pass, D1): once the primary run is
  // 'ready' with the pass 'pending', replay the same clip through a dedicated MediaPipe detector
  // and run the identical sort → robustness → presence-trim → heuristics pipeline over the
  // result, then graft ONLY `verticalOscillationCm` into the displayed heuristics. Every state
  // write is guarded by the primary run's `runId` (a reset()/new clip invalidates the pass
  // exactly like a primary run), and every failure path lands on scalePass 'failed' with the
  // primary result untouched — the pass can only ever improve the displayed result.
  useEffect(() => {
    if (state.phase !== 'ready' || state.scalePass.status !== 'pending') return
    if (scalePassStartedForRunRef.current === runIdRef.current) return
    scalePassStartedForRunRef.current = runIdRef.current
    const runId = runIdRef.current

    const failPass = (error: string) => {
      if (runIdRef.current !== runId) return
      setState((s) => ({ ...s, scalePass: { status: 'failed', error, diagnostics: null } }))
    }

    const video = videoRef.current
    const primaryHeuristics = state.heuristics
    if (!video || !metadata || !primaryHeuristics) {
      failPass('No video was available for the scale pass.')
      return
    }

    setState((s) => ({ ...s, scalePass: { status: 'running', diagnostics: null } }))

    // Same resolution discipline as the primary run: the sampling/robustness plane is one
    // object, resolved once per pass. No onProgress — nothing renders the pass's progress;
    // onPausedChange is wired below only to fail fast on a user pause.
    const samplingRobustnessConfig = resolveSamplingRobustnessConfig()
    const watchdogMs = Math.max(30_000, 3 * metadata.durationSec * 1000)

    void (async () => {
      // The watchdog must bound detector creation too: a stalled WASM/model fetch never
      // settles, and getScalePassDetector caches the still-pending promise — without this
      // race the pass would sit 'running' forever (frozen video, permanent hint) and every
      // later run's pass would await the same hung promise.
      let detectorDeadline: ReturnType<typeof setTimeout> | undefined
      const scaleDetector = await Promise.race([
        getScalePassDetector(),
        new Promise<null>((resolve) => {
          detectorDeadline = setTimeout(() => resolve(null), watchdogMs)
        }),
      ])
      clearTimeout(detectorDeadline)
      if (runIdRef.current !== runId) return
      if (!scaleDetector) {
        failPass('The scale-pass detector could not be created.')
        return
      }

      // Replay from the top, muted (this play() is far outside any user click's synchronous
      // call stack) and un-looped (sampleClip needs the natural 'ended' event to resolve).
      video.muted = true
      video.loop = false
      video.currentTime = 0

      // Forward declaration: onPausedChange below needs abortPass, which needs the handle.
      let abortPassRef: (error: string) => void = () => {}
      const { promise, handle } = sampleClip(video, scaleDetector, metadata.durationSec, {
        maxConsecutiveErrors: samplingRobustnessConfig.maxConsecutiveErrors,
        detectionTimeoutMs: samplingRobustnessConfig.detectionTimeoutMs,
        // Fail fast on a user pause instead of letting the pass zombie-stall until the
        // watchdog: the native controls are visible, and a paused replay produces no frames.
        // A natural clip end also fires 'pause' — video.ended distinguishes it.
        onPausedChange: (paused) => {
          if (paused && !video.ended) {
            abortPassRef('Video playback was paused before the scale pass finished.')
          }
        },
      })
      scaleHandleRef.current = handle

      // `handle.stop()` RESOLVES the promise with whatever partial samples were collected
      // rather than rejecting (see SampleClipHandle's doc), so aborting locally must also mark
      // the resolution as discardable — `abortedLocally` is what keeps a watchdog-stopped
      // pass's partial samples from being processed as if the pass had finished.
      let abortedLocally = false
      const abortPass = (error: string) => {
        if (abortedLocally) return
        abortedLocally = true
        clearTimeout(watchdog)
        handle.stop()
        if (scaleHandleRef.current === handle) scaleHandleRef.current = null
        failPass(error)
      }
      abortPassRef = abortPass
      // Wall-clock watchdog: the pass replays the clip in real time, so anything past a few
      // multiples of the clip's duration means it is stuck, not slow.
      const watchdog = setTimeout(() => {
        abortPass(`The scale pass exceeded its ${watchdogMs}ms watchdog and was stopped.`)
      }, watchdogMs)

      video.play().catch((err: unknown) => {
        abortPass(
          err instanceof Error
            ? `Could not start video playback for the scale pass: ${err.message}`
            : 'Could not start video playback for the scale pass.',
        )
      })

      let samples: PoseSample[]
      try {
        samples = await promise
      } catch (err) {
        clearTimeout(watchdog)
        if (scaleHandleRef.current === handle) scaleHandleRef.current = null
        failPass(
          err instanceof Error ? err.message : 'Scale-pass detection stalled unexpectedly.',
        )
        return
      }
      clearTimeout(watchdog)
      if (abortedLocally || runIdRef.current !== runId) return
      if (scaleHandleRef.current === handle) scaleHandleRef.current = null

      try {
        // The byte-identical pipeline the primary run uses (sort → robustness → presence-trim →
        // heuristics), over the scale pass's own samples.
        const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp)
        const scaleRobustFrames = applyRobustness(sorted, samplingRobustnessConfig.robustness)
        const scaleMetricFrames = trimToPresenceWindow(scaleRobustFrames)
        const scaleHeuristics = computeFormHeuristics(scaleMetricFrames)
        // Graft rule: a pass that measured no real-world scale has nothing to graft — that is a
        // failed pass (named as such), never a silent no-op replacement of the primary metrics.
        // Still gated on `verticalOscillationCm.calibration` alone (#45): `stepWidthCm` has no
        // calibration object of its own to check, and it reads the identical per-frame
        // `pixelsPerMeter` fact this gate already tests — a pass that cleared this check grafts
        // both metrics (see `graftScalePassResult`), including a `stepWidthCm` that
        // independently found no footstrikes of its own (grafted with its own null value and
        // caveat, not a reason to fail the whole pass).
        if (scaleHeuristics.verticalOscillationCm.calibration === null) {
          failPass('The scale pass completed but measured no real-world scale.')
          return
        }
        const grafted = graftScalePassResult(primaryHeuristics, scaleHeuristics)
        const scaleDiagnostics = computeAnalysisDiagnostics(
          sorted,
          scaleRobustFrames,
          scaleHeuristics,
        )
        if (runIdRef.current !== runId) return
        setState((s) => ({
          ...s,
          // The one write the scale pass makes outside its own status object. `diagnostics`
          // stays the primary's — the scale pass's live on scalePass.diagnostics instead.
          heuristics: grafted,
          scalePass: { status: 'done', diagnostics: scaleDiagnostics },
        }))
      } catch (err) {
        failPass(err instanceof Error ? err.message : 'Scale pass failed unexpectedly.')
      }
    })()
  }, [state.phase, state.scalePass.status, state.heuristics, videoRef, metadata])

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

  // Development-only, second line: the scale pass's outcome under its own distinct prefix, once
  // per terminal transition (each transition replaces the `scalePass` object wholesale, so
  // keying on its identity fires exactly once each). The primary line above stays byte-identical
  // — same trigger, same payload, primary pass only. `diagnostics` rides along only on 'done';
  // 'skipped'/'failed' carry their reason/error instead.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const { status, reason, error, diagnostics } = state.scalePass
    if (status !== 'done' && status !== 'failed' && status !== 'skipped') return
    console.log(
      '[analysis-diagnostics:scale-pass]',
      JSON.stringify({
        status,
        ...(reason !== undefined ? { reason } : {}),
        ...(error !== undefined ? { error } : {}),
        ...(status === 'done' && diagnostics !== null ? { diagnostics } : {}),
      }),
    )
  }, [state.scalePass])

  return { ...state, start, reset }
}
