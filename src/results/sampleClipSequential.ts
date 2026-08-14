import type { PoseDetector, PoseFrameSource } from '../pose/detector'
import type { PoseSample } from '../pose/robustness/types'
import { demuxMp4 } from '../video/mp4Demux'
import { openSequentialFrameSource } from '../video/sequentialFrameSource'
import type { SelectedVideoFrame } from '../video/sequentialFrameSource'
import { createFrameSelector } from './sequentialSamplingStep'
import type { SequentialSamplingConfig } from './sequentialSamplingStep'
import {
  DEFAULT_DETECTION_TIMEOUT_MS,
  DEFAULT_MAX_CONSECUTIVE_ERRORS,
  withTimeout,
} from './sampleClip'
import type { SampleClipHandle, SampleClipOptions } from './sampleClip'

/**
 * The WebCodecs counterpart to `sampleClip.ts`'s `<video>`-playback sampler: demuxes `sourceBlob`
 * (already-loaded clip bytes, not a URL/element), decodes it frame-by-frame via
 * `sequentialFrameSource.ts`, and applies `sequentialSamplingConfig`'s frame-rate-aware stride
 * (`sequentialSamplingStep.ts`) to pick which decoded frames actually reach the detector. Matches
 * `sampleClip`'s return shape and error/cancellation contract exactly — same
 * `{ promise, handle }`, same "record a per-frame miss and keep going, abort after
 * `maxConsecutiveErrors` in a row" circuit breaker, same "`stop()` resolves with whatever was
 * collected so far, discardable by the caller" semantics — so `sampleClipAdaptive.ts` can dispatch
 * to either sampler with zero special-casing downstream.
 *
 * `opts.onPausedChange` is accepted (for signature parity with `sampleClip`'s `SampleClipOptions`)
 * but never invoked: this path never touches `<video>` playback state at all — see
 * `useVideoAnalysis.ts`'s notes on why `video.play()` stays unconditional regardless of which
 * sampling path a run ends up using.
 *
 * Frame lifecycle: exactly one decoded `VideoFrame` is open at a time. Each iteration draws the
 * frame to a single reusable canvas, closes the frame, and only THEN awaits detection — never
 * holding a frame open across an `await`, and never starting a second detection before the first
 * resolves. This is `sequentialFrameSource.ts`'s own memory-discipline contract propagated one
 * layer up; see that module's doc comments for the full reasoning.
 */
export function sampleClipSequential(
  sourceBlob: Blob,
  detector: PoseDetector,
  durationSec: number,
  opts: SampleClipOptions = {},
  sequentialSamplingConfig: SequentialSamplingConfig,
): { promise: Promise<PoseSample[]>; handle: SampleClipHandle } {
  const {
    onProgress,
    maxConsecutiveErrors = DEFAULT_MAX_CONSECUTIVE_ERRORS,
    detectionTimeoutMs = DEFAULT_DETECTION_TIMEOUT_MS,
  } = opts

  const samples: PoseSample[] = []
  let cancelled = false
  let settled = false
  let consecutiveErrors = 0
  let stopFrameSource: (() => void) | null = null

  let resolvePromise!: (samples: PoseSample[]) => void
  let rejectPromise!: (error: Error) => void
  const promise = new Promise<PoseSample[]>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  function finish() {
    if (settled) return
    settled = true
    resolvePromise(samples)
  }

  function abort(error: Error) {
    if (settled) return
    settled = true
    rejectPromise(error)
  }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  const handle: SampleClipHandle = {
    stop: () => {
      cancelled = true
      stopFrameSource?.()
      finish()
    },
  }

  if (!ctx) {
    // Deferred, not thrown synchronously: every other failure in this module (demux, decoder
    // open, decode) surfaces through the returned promise's rejection, and a canvas-context
    // failure should be indistinguishable from those to callers (`sampleClipAdaptive.ts`,
    // `useVideoAnalysis.ts`) that only ever branch on the promise settling, not on how this
    // function was called.
    queueMicrotask(() =>
      abort(new Error('Failed to acquire a 2D canvas context for the WebCodecs sampling path.')),
    )
    return { promise, handle }
  }

  void (async () => {
    let track: Awaited<ReturnType<typeof demuxMp4>>
    try {
      const bytes = await sourceBlob.arrayBuffer()
      if (cancelled) return
      track = await demuxMp4(bytes)
    } catch (err) {
      abort(
        err instanceof Error ? err : new Error('Failed to demux the clip for sequential sampling.'),
      )
      return
    }
    if (cancelled) return

    const selectFrame = createFrameSelector(sequentialSamplingConfig)

    let source: Awaited<ReturnType<typeof openSequentialFrameSource>>
    try {
      source = await openSequentialFrameSource(track, selectFrame)
    } catch (err) {
      abort(
        err instanceof Error
          ? err
          : new Error('Failed to open the WebCodecs decoder for sequential sampling.'),
      )
      return
    }
    if (cancelled) {
      source.stop()
      return
    }
    stopFrameSource = source.stop

    const handleSelectedFrame = async ({ frame, ptsSec }: SelectedVideoFrame): Promise<void> => {
      canvas.width = frame.displayWidth
      canvas.height = frame.displayHeight
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height)
      frame.close()

      const poseSource: PoseFrameSource = {
        image: canvas,
        timestampSec: ptsSec,
        width: canvas.width,
        height: canvas.height,
      }

      try {
        const detected = await withTimeout(detector.estimatePose(poseSource), detectionTimeoutMs)
        if (cancelled) return
        samples.push({ timestamp: ptsSec, frame: detected })
        consecutiveErrors = 0
      } catch {
        if (cancelled) return
        samples.push({ timestamp: ptsSec, frame: null })
        consecutiveErrors += 1
        if (consecutiveErrors >= maxConsecutiveErrors) {
          abort(
            new Error(
              `Pose detection failed ${consecutiveErrors} times in a row — aborting sampling.`,
            ),
          )
          return
        }
      }

      if (!cancelled && durationSec > 0) {
        onProgress?.(Math.min(ptsSec / durationSec, 1))
      }
    }

    try {
      for await (const selected of source.frames) {
        if (cancelled || settled) {
          selected.frame.close()
          break
        }
        await handleSelectedFrame(selected)
        if (settled) break
      }
    } catch (err) {
      if (!settled) {
        abort(err instanceof Error ? err : new Error('Sequential frame decoding failed.'))
      }
    } finally {
      source.stop()
      finish()
    }
  })()

  return { promise, handle }
}
