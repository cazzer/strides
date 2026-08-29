import { describe, expect, it, vi } from 'vitest'
import type { MetricId } from '../heuristics/types'
import type { ClipEvidencePlan } from '../results/evidenceFrames'
import { METRIC_LABELS } from '../results/metricConfidence'
import { stubCanvas2DContext } from '../test/canvasTestUtils'
import { makeVideoSeekable } from '../test/videoTestUtils'
import { stubRequestVideoFrameCallback } from '../test/videoFrameCallbackTestUtils'
import { extractClipEvidence } from './extractFrames'
import { deriveClipPoster } from './posterFrame'
import type { VideoMetadata } from './types'
import { waitForPresentedFrame, withDecodedVideo } from './videoElement'

/**
 * The shared `<video>` plumbing, and the one property that only this file can assert: that a poster
 * derivation and an evidence extraction are serialized against EACH OTHER, not merely each against
 * its own kind. Both features' own suites are blind to that by construction — each imports one
 * consumer, so each can only ever observe its own queue.
 *
 * Never pixels: jsdom ships no canvas and this repo refuses the `canvas` npm package
 * (`canvasTestUtils.ts`).
 */

/**
 * A `<video>` that behaves enough like a real one to drive the wait: `currentTime` assignment
 * dispatches `seeked` (`makeVideoSeekable`), and the repo's `requestVideoFrameCallback` stub is
 * wrapped to fire itself on the next microtask rather than waiting for a manual `fire()`.
 *
 * `presentFrames: false` is the interesting arm, not a degenerate one: it is exactly what real
 * Chromium does after a PAUSED seek, where `requestVideoFrameCallback` never fires at all (#59).
 */
function seekableVideo({ presentFrames = true } = {}): { video: HTMLVideoElement } {
  const video = document.createElement('video')
  makeVideoSeekable(video)
  const controller = stubRequestVideoFrameCallback(video)
  const register = video.requestVideoFrameCallback.bind(video)
  video.requestVideoFrameCallback = ((callback: VideoFrameRequestCallback) => {
    const handle = register(callback)
    if (presentFrames) queueMicrotask(() => controller.fire(video.currentTime))
    return handle
  }) as HTMLVideoElement['requestVideoFrameCallback']
  return { video }
}

describe('waitForPresentedFrame', () => {
  it('resolves on the presentation callback when the browser actually fires one', async () => {
    const { video } = seekableVideo()
    // The stub answers on the next microtask — ahead of any animation frame, so the real signal
    // wins the race wherever it works, which is the whole reason the arm is still here.
    await expect(waitForPresentedFrame(video, 30_000)).resolves.toBe(
      'video-frame-callback',
    )
  })

  it('falls through to an animation frame when the callback never fires', async () => {
    const { video } = seekableVideo({ presentFrames: false })
    // 30s backstop: only the animation-frame arm can resolve this inside the test timeout.
    await expect(waitForPresentedFrame(video, 30_000)).resolves.toBe(
      'animation-frame',
    )
  })

  it('cancels the pending frame callback once another arm has won', async () => {
    const { video } = seekableVideo({ presentFrames: false })
    const cancel = vi.spyOn(video, 'cancelVideoFrameCallback')
    await waitForPresentedFrame(video, 30_000)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('resolves on its own backstop when nothing paints', async () => {
    const { video } = seekableVideo({ presentFrames: false })
    // A document that never paints — a backgrounded tab throttles rAF to nothing, and without the
    // backstop this wait would simply never settle.
    vi.stubGlobal('requestAnimationFrame', undefined)
    try {
      await expect(waitForPresentedFrame(video, 5)).resolves.toBe('timed-out')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('withDecodedVideo', () => {
  it('hands the caller its own answer when the element never decodes', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const onDecoded = vi.fn()

    // jsdom never fires `loadeddata`, so this is the load-timeout path.
    const outcome = await withDecodedVideo(
      new Blob(['x']),
      5,
      onDecoded,
      () => 'never-decoded' as const,
    )

    expect(outcome).toBe('never-decoded')
    expect(onDecoded).not.toHaveBeenCalled()
    expect(revokeSpy).toHaveBeenCalledTimes(1)
    revokeSpy.mockRestore()
  })

  it('revokes the object URL even when the work throws', async () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shared')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    // `readyState` is patched on the prototype because the element under test is created INSIDE
    // the function under test, so no per-element stub can reach it.
    const readyState = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'readyState',
    )
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => 2, // HAVE_CURRENT_DATA — short-circuits the readiness wait.
    })

    try {
      await expect(
        withDecodedVideo(
          new Blob(['x']),
          5,
          () => Promise.reject(new Error('draw exploded')),
          () => null,
        ),
      ).rejects.toThrow('draw exploded')
      // The whole point of the shared `finally`: a throw on the way out still frees the decoder.
      expect(revokeSpy).toHaveBeenCalledWith('blob:shared')
    } finally {
      if (readyState === undefined) {
        delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).readyState
      } else {
        Object.defineProperty(HTMLMediaElement.prototype, 'readyState', readyState)
      }
      createSpy.mockRestore()
      revokeSpy.mockRestore()
    }
  })
})

function metadata(): VideoMetadata {
  return { durationSec: 10, width: 1920, height: 1080, frameRate: null }
}

/** Every metric no-evidence. Total by construction — `METRIC_LABELS` is the app's own exhaustive
 * `Record<MetricId, …>`, so a metric added later cannot leave a hole here. */
function emptyPlan(): ClipEvidencePlan {
  const plan = {} as ClipEvidencePlan
  for (const metric of Object.keys(METRIC_LABELS) as MetricId[]) {
    plan[metric] = { status: 'no-evidence', reason: 'not-emitted' }
  }
  return plan
}

/**
 * The decoder's whole lifetime, bracketed: an object URL is minted before the element exists and
 * revoked after it is torn down, so an interleaved log is direct evidence of overlap. The same
 * instrument both consumers' suites use on their own queue — pointed here at BOTH at once, which
 * is the only way the shared queue is observable.
 */
function bracketDecoders(): { log: string[]; restore: () => void } {
  const log: string[] = []
  let minted = 0
  const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    minted += 1
    log.push(`open:${minted}`)
    return `blob:decode-${minted}`
  })
  const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    log.push(`close:${String(url).replace('blob:decode-', '')}`)
  })
  return {
    log,
    restore: () => {
      createSpy.mockRestore()
      revokeSpy.mockRestore()
    },
  }
}

/** A poster derivation that will time out on load — enough to open and close one decoder. */
function poster() {
  return deriveClipPoster(new Blob(['poster']), metadata(), { loadTimeoutMs: 5 })
}

/** An evidence extraction that will time out on load. `seekOffsetSeconds: 0` pins the seek
 * calibration rather than deriving it from a blob that carries no container at all. */
function evidence() {
  return extractClipEvidence(
    { sourceBlob: new Blob(['evidence']), plan: emptyPlan() },
    { loadTimeoutMs: 5, seekOffsetSeconds: 0 },
  )
}

/** Peak concurrent decoders implied by a bracket log. */
function peakOpen(log: string[]): number {
  let open = 0
  let peak = 0
  for (const entry of log) {
    open += entry.startsWith('open:') ? 1 : -1
    peak = Math.max(peak, open)
  }
  return peak
}

describe('queueDetachedDecode, across both consumers', () => {
  it('serializes a poster derivation against an evidence extraction started in the same tick', async () => {
    stubCanvas2DContext()
    const decoders = bracketDecoders()

    // The structural gap this closes (strides-3uy): each consumer used to keep a queue of its own,
    // so each guaranteed at most one decoder OF ITS OWN KIND and nothing about the pair. Both tails
    // are settled here, so with two queues both decoders open in this tick and the peak is 2. Demo
    // 1 is 3840x2160 and Demo 2 is 2160x3840 — two of those at once is the memory this bounds.
    await Promise.all([poster(), evidence()])

    // Strictly paired, never nested, and in the order they asked.
    expect(decoders.log).toEqual(['open:1', 'close:1', 'open:2', 'close:2'])
    expect(peakOpen(decoders.log)).toBe(1)
    decoders.restore()
  })

  it('serializes them the other way round too — the queue has no preferred kind', async () => {
    stubCanvas2DContext()
    const decoders = bracketDecoders()

    await Promise.all([evidence(), poster()])

    expect(decoders.log).toEqual(['open:1', 'close:1', 'open:2', 'close:2'])
    expect(peakOpen(decoders.log)).toBe(1)
    decoders.restore()
  })

  it('holds the ceiling at one across several of each, interleaved', async () => {
    stubCanvas2DContext()
    const decoders = bracketDecoders()

    await Promise.all([poster(), evidence(), poster(), evidence(), evidence()])

    // Which kind owns which slot is not the claim — "never two open at once" is.
    expect(decoders.log).toHaveLength(10)
    expect(peakOpen(decoders.log)).toBe(1)
    decoders.restore()
  })

  it('lets an extraction take its turn after a poster derivation fails outright', async () => {
    stubCanvas2DContext()
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementationOnce(() => {
        throw new Error('no object URL for you')
      })
      .mockReturnValue('blob:decode')

    // A throw reaches whoever asked for it, and the shared tail still swallows it — otherwise one
    // feature's unforeseen failure would wedge the OTHER feature's decodes, which is a way for
    // these two to break each other that neither had while their queues were separate.
    await expect(poster()).rejects.toThrow('no object URL')
    await expect(evidence()).resolves.toEqual(emptyPlan())

    createSpy.mockRestore()
    revokeSpy.mockRestore()
  })
})
