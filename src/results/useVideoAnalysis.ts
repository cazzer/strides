import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseDetector } from '../pose/detector'
import type { VideoMetadata, VideoSource } from '../video/types'
import { canUseSequentialDecode } from '../video/webCodecsSupport'
import type { PoseSample } from '../pose/robustness/types'
import type { SampleClipHandle } from './sampleClip'
import { sampleClipAdaptive } from './sampleClipAdaptive'
import { runClipAnalysisPipeline } from './runClipAnalysisPipeline'
import { resolveSamplingRobustnessConfig } from './samplingRobustnessConfig'
import { resolveScalePassConfig } from './scalePassConfig'
import { graftScalePassResult } from './scalePassGraft'
import { getScalePassDetector } from '../pose/scalePassDetector'
import type { ScalePassState, VideoAnalysisState } from './types'

/** Defensive upper bound on the sequential-decode feasibility probe the auto-start effect waits
 * on — see `sequentialDecodeSupported`'s doc for why auto-start waits at all. */
const SEQUENTIAL_DECODE_PROBE_TIMEOUT_MS = 3000

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
  const { videoRef, metadata, sourceBlob } = videoSource

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
  // Whether the WebCodecs sequential-decode sampling path (`sampleClipAdaptive.ts`) can be used
  // for the currently loaded clip — resolved once per clip, ahead of time, specifically so
  // `start()` never has to await it: `start()`'s `video.play()` call must stay in the same
  // synchronous, click-derived call stack as a user-initiated "Analyze"/"Analyze again" click
  // (autoplay policy), so the probe can't live inside `start()` itself. `null` means "not yet
  // known" (still resolving, or no clip loaded) — `start()` and the scale-pass effect below both
  // treat that identically to "false", i.e. fall back to the existing `<video>`-playback path for
  // that run.
  //
  // State, not a ref: the auto-start effect further below (the only trigger for the very first
  // run of almost every clip — this app has no manual "run again on a completed clip" affordance)
  // WAITS for this to leave `null` before firing `start()` at all, and a ref write can't be an
  // effect dependency. Measured directly: without that wait, auto-start's own effect always fires
  // synchronously in the same passive-effects flush as the probe-kickoff effect below, before the
  // probe's `async`/`await` chain gets a single microtask tick to advance — i.e. the "best-effort,
  // might miss the first run" framing this was originally built to was actually "always misses
  // every auto-started run," a structural loss, not a race. Bounded by a timeout below so a
  // pathological probe hang can't stall auto-start forever.
  const [sequentialDecodeSupported, setSequentialDecodeSupported] = useState<boolean | null>(
    null,
  )
  // Which clip's `metadata` the probe above has already been kicked off for — mirrors
  // `autoStartedForRef`'s "fire once per freshly loaded clip" pattern, comparing `metadata`
  // object identity (always a fresh object per clip, per that ref's own doc). A ref, unlike
  // `sequentialDecodeSupported` itself: this is read-and-written only inside the effect that owns
  // it, never needs to trigger a render on its own.
  const sequentialDecodeProbedForRef = useRef<VideoMetadata | null>(null)

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

  // Kicks off the sequential-decode feasibility probe as early as possible for a freshly loaded
  // clip — see `sequentialDecodeSupported`'s doc above for why this has to happen ahead of time
  // rather than inside `start()`. Fires at most once per clip (mirrors `autoStartedForRef`).
  useEffect(() => {
    if (!metadata || sequentialDecodeProbedForRef.current === metadata) return
    sequentialDecodeProbedForRef.current = metadata

    setSequentialDecodeSupported(null)
    const probedFor = metadata
    let settled = false
    const settle = (supported: boolean) => {
      if (settled) return
      settled = true
      // A newer clip may have loaded (and re-triggered this effect) while this was resolving —
      // only commit the result if it's still the clip this probe was actually run for.
      if (sequentialDecodeProbedForRef.current === probedFor) {
        setSequentialDecodeSupported(supported)
      }
    }

    // The sequential-decode plane is a no-op unless explicitly enabled (default `false` — see
    // SequentialSamplingConfig.enabled's doc). When it's off, the probe itself
    // (`canUseSequentialDecode`) is never even called — skipping its real cost (a full
    // `blob.arrayBuffer()` read plus an MP4 demux pass) for a result that can never be used, so
    // this change's documented "zero runtime cost when the sequential path isn't used" claim
    // holds for the default-disabled case too, not just the "probe said no" case. Still routed
    // through the same `.then(settle)` shape as the real probe below (rather than an early
    // `return` with its own direct `setSequentialDecodeSupported` call) — a second, differently-
    // shaped call site to the same setter read as a render-cascade risk to `react-hooks/set-
    // state-in-effect`'s static analysis even though this one is also microtask-deferred.
    const probe = resolveSamplingRobustnessConfig().sequentialSampling.enabled
      ? canUseSequentialDecode(sourceBlob)
      : Promise.resolve(false)
    void probe.then(settle)
    // Defensive bound, not an expected path: canUseSequentialDecode is documented to never hang
    // (every gate resolves, nothing awaits an unbounded external operation once a Blob is already
    // in hand) — this exists so a future regression there degrades to "no sequential decode this
    // run" instead of stalling auto-start indefinitely.
    const timeoutId = setTimeout(() => settle(false), SEQUENTIAL_DECODE_PROBE_TIMEOUT_MS)
    return () => clearTimeout(timeoutId)
  }, [metadata, sourceBlob])

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

    // Captured once, here, rather than re-read later: `sequentialDecodeSupported` could in
    // principle change (a later clip's probe resolving) before this run's diagnostics get
    // computed, and diagnostics must report the path THIS run actually took, not whatever the
    // state says by the time the run finishes.
    const usesSequentialDecode = sequentialDecodeSupported === true
    const { promise, handle } = sampleClipAdaptive(
      video,
      // Already-resolved boolean, not an internal probe — see sequentialDecodeSupported's doc
      // above. `null` (not yet known) and `false` (probe said no) both fall back to `null` here,
      // which is sampleClipAdaptive's own signal to use the playback path.
      usesSequentialDecode ? sourceBlob : null,
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
      samplingRobustnessConfig.sequentialSampling,
    )
    handleRef.current = handle

    // sampleClip deliberately doesn't call play() itself (see its docstring) — it must happen
    // here, but only on the playback path. Muted unconditionally regardless: a manual "Analyze"
    // click satisfies autoplay policy via its synchronous call stack regardless, but start() is
    // also called from the auto-start effect below (no such call stack), so muting here — rather
    // than only for that path — keeps one code path reliable everywhere clips carry no audio the
    // app uses anyway.
    video.muted = true
    // The sequential-decode path samples directly off `sourceBlob`'s own bytes via VideoDecoder
    // and never reads from the <video> element at all — playing it here would only run the
    // browser's native hardware decoder concurrently with WebCodecs' own decode of the identical
    // clip for no reason. (A GPU/decoder-contention explanation for design.md's D7 confidence
    // regression was tested by gating this exact call and re-measuring live — it did NOT recover
    // the regression, see D7's update, so this gate is not a fix for that; it's just correct on
    // its own terms.) On-screen playback during sampling is purely cosmetic either way — the
    // skeleton-overlay replay effect (below) starts it once analysis is ready, independent of
    // which path did the actual sampling.
    if (!usesSequentialDecode) {
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
    }

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
        // The synchronous sort → robustness → presence-trim → heuristics → diagnostics
        // pipeline, shared verbatim with the background scale pass below — see
        // runClipAnalysisPipeline.ts for what each step does and why. `computeFormHeuristics`
        // computes the scale-calibrated centimetre figure itself, as part of
        // `verticalOscillationCm` (#36, D1), so there is no second `trimToPresenceWindow` call
        // left to drift apart from this one — `computeAnalysisDiagnostics` reads that figure back
        // off `heuristics.verticalOscillationCm.calibration` by reference (D1b).
        const { robustFrames, heuristics, diagnostics } = runClipAnalysisPipeline(
          samples,
          samplingRobustnessConfig,
          usesSequentialDecode ? 'sequential' : 'playback',
        )
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
  }, [detector, videoRef, metadata, sourceBlob, sequentialDecodeSupported])

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

      // Same capture-once discipline as start()'s usesSequentialDecode above — resolved before
      // the playback-path-only reset immediately below, since that reset only matters when the
      // pass is actually about to read frames off the <video> element itself.
      const usesSequentialDecode = sequentialDecodeSupported === true

      // Replay from the top, muted (this play() is far outside any user click's synchronous
      // call stack) and un-looped (sampleClip needs the natural 'ended' event to resolve) — but
      // ONLY on the playback path. The sequential-decode path samples `sourceBlob`'s own bytes
      // directly and never reads from the <video> element at all, so this reset would only yank
      // the user's just-started skeleton-overlay replay back to frame 0 and un-loop it mid-view,
      // for no functional reason (review finding) — the loop-restart effect above already
      // re-arms looping playback once this pass reaches a terminal status, regardless of which
      // path sampled it.
      if (!usesSequentialDecode) {
        video.muted = true
        video.loop = false
        video.currentTime = 0
      }

      // Forward declaration: onPausedChange below needs abortPass, which needs the handle.
      let abortPassRef: (error: string) => void = () => {}
      const { promise, handle } = sampleClipAdaptive(
        video,
        // Same already-resolved signal start() uses above — the scale pass replays the same
        // clip, so the same feasibility result applies.
        usesSequentialDecode ? sourceBlob : null,
        scaleDetector,
        metadata.durationSec,
        {
          maxConsecutiveErrors: samplingRobustnessConfig.maxConsecutiveErrors,
          detectionTimeoutMs: samplingRobustnessConfig.detectionTimeoutMs,
          // Fail fast on a user pause instead of letting the pass zombie-stall until the
          // watchdog: the native controls are visible, and a paused replay produces no frames.
          // A natural clip end also fires 'pause' — video.ended distinguishes it. Only meaningful
          // on the playback path — the sequential-decode path never invokes onPausedChange at
          // all (see sampleClipSequential.ts's doc), since it doesn't depend on video playback.
          onPausedChange: (paused) => {
            if (paused && !video.ended) {
              abortPassRef('Video playback was paused before the scale pass finished.')
            }
          },
        },
        samplingRobustnessConfig.sequentialSampling,
      )
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

      // Same gate as start()'s own play() call above, same reason: the sequential path never
      // touches <video> playback, so playing it here would only run the native decoder alongside
      // WebCodecs' own decode for no reason — see that comment for why this is correct on its own
      // terms even though it turned out not to explain D7's confidence regression.
      if (!usesSequentialDecode) {
        video.play().catch((err: unknown) => {
          abortPass(
            err instanceof Error
              ? `Could not start video playback for the scale pass: ${err.message}`
              : 'Could not start video playback for the scale pass.',
          )
        })
      }

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
        // The byte-identical pipeline the primary run uses, over the scale pass's own samples.
        // The pass's own `robustFrames` aren't retained — nothing renders a scale-pass skeleton
        // overlay, and the graft below only ever reads `scaleHeuristics`/`scaleDiagnostics`.
        const { heuristics: scaleHeuristics, diagnostics: scaleDiagnostics } =
          runClipAnalysisPipeline(
            samples,
            samplingRobustnessConfig,
            usesSequentialDecode ? 'sequential' : 'playback',
          )
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
  }, [
    state.phase,
    state.scalePass.status,
    state.heuristics,
    videoRef,
    metadata,
    sourceBlob,
    sequentialDecodeSupported,
  ])

  // Auto-starts analysis the moment a freshly loaded clip is ready and a detector exists — no
  // explicit click required. Doesn't fire while `detector` is `null` (still loading, or it never
  // loads at all); either way the manual "Analyze" control remains available as a fallback and
  // surfaces the real `detector-unavailable` error if the detector truly never becomes available.
  // Fires at most once per clip (`autoStartedForRef`) — otherwise an explicit `reset()` back to
  // `'idle'` while the same clip is still `'ready'` would immediately auto-restart itself.
  //
  // Also waits for `sequentialDecodeSupported` to leave `null` (the probe above to settle, or its
  // own timeout) before firing — see that state's doc comment for why this matters: this app has
  // no "run again on an already-completed clip" control (`ResultsView.tsx` only shows a re-run
  // button after an *error*), so auto-start is the only trigger for nearly every real run, and
  // without this wait the sequential-decode path would never actually engage in practice, not
  // merely "sometimes miss the first run" as originally assumed.
  useEffect(() => {
    if (
      videoSource.status !== 'ready' ||
      state.phase !== 'idle' ||
      !detector ||
      !metadata ||
      sequentialDecodeSupported === null ||
      autoStartedForRef.current === metadata
    )
      return
    autoStartedForRef.current = metadata
    start()
  }, [videoSource.status, state.phase, detector, metadata, sequentialDecodeSupported, start])

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
