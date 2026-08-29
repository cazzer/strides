/**
 * Generic `<video>` plumbing, owned by neither of the two features that use it. Everything here
 * takes an element (or the bytes to make one) and a timeout, and decides nothing about WHY it is
 * being asked: no crop, no timestamp, no opacity, no metric, no poster sizing. If a change here
 * starts reading a plan or picking an instant, it belongs in the consumer instead.
 *
 * Two consumers today, and the module exists because they had grown identical halves:
 * `extractFrames.ts` (evidence images, after analysis) and `posterFrame.ts` (clip-strip posters, at
 * clip-add time). Before this module, `posterFrame.ts` imported `seekTo`/`waitForPresentedFrame`
 * from `extractFrames.ts` and re-implemented `waitForDecodedData`, `HAVE_CURRENT_DATA`, the load
 * timeout and the decoder teardown alongside them — so a fix to the teardown sequence or the
 * readiness wait had to be made twice, and only one of the two sites was reachable by grepping the
 * other's imports.
 *
 * ### One detached decoder at a time, process-wide, ACROSS both consumers
 *
 * `queueDetachedDecode` is the single serialization point, and it is single on purpose. Each
 * consumer previously kept a module-level queue of its own, which guaranteed at most one decoder OF
 * ITS OWN KIND and nothing about the pair: a global peak of two concurrent 4K decoders was
 * structurally possible. It was never observed, but only because of timing rather than design —
 * posters are derived at clip-add time and evidence extraction only starts after analysis, and
 * nothing holds those apart. A slow poster decode on a large clip, or a faster analysis path, closes
 * the gap. Demo 1 is 3840x2160 and Demo 2 is 2160x3840, and these decoders are opened while a WebGL
 * sampling run is competing for the same memory, so the ceiling is worth being structural.
 *
 * ### These primitives carry no scheduling invariant of their own
 *
 * `extractFrames.ts` states that it "runs strictly after `phase: 'ready'`, never inside the sampling
 * loop." That is true of evidence extraction and is a property of WHEN that module is called — it is
 * not a property of anything here, and it deliberately did not travel with the code. `useClipPoster`
 * runs these same primitives DURING sampling, on purpose: the strip would otherwise be empty for the
 * whole of the analysis, which is exactly the window in which it has per-clip progress to show. Both
 * schedules are legitimate, they are the consumers' to state, and the shared queue above is what
 * makes them safe to hold at once.
 */

/**
 * Bounded wait for a single seek. Resurrected verbatim from the retired
 * `src/quality/assessVideoQuality.ts` (`git show ee7a56e^`): `seeked` is not guaranteed to fire
 * reliably in every browser/state, so the wait degrades rather than hanging the caller forever.
 */
export const SEEK_TIMEOUT_MS = 2000

/**
 * Bounded wait for a detached element to have decoded data. Generous, because the alternative to
 * waiting is drawing a black frame: the blob is local, so a clip that has not produced `loadeddata`
 * inside this window is broken rather than slow.
 */
export const LOAD_TIMEOUT_MS = 10000

/**
 * Backstop on the post-seek presentation grace period (see `waitForPresentedFrame`). Deliberately
 * two orders of magnitude below `SEEK_TIMEOUT_MS`: this is a courtesy pause, not a gate, and the
 * one situation that reaches it is a document that never paints (a backgrounded tab throttles
 * `requestAnimationFrame` to nothing). A whole clip's plan is on the order of forty instants, so a
 * seek-sized backstop here would cost a minute of wall clock to buy nothing `seeked` had not
 * already guaranteed.
 */
export const FRAME_PRESENTATION_TIMEOUT_MS = 100

/** `HTMLMediaElement.HAVE_CURRENT_DATA` — data for the current playback position is available. */
const HAVE_CURRENT_DATA = 2

/**
 * `'already-there'` distinguishes the `<0.001s` short-circuit from a real seek, which matters
 * downstream: no seek means no new frame will be presented, so waiting for one would only ever
 * time out.
 */
export type SeekOutcome = 'seeked' | 'already-there' | 'timed-out'

/**
 * Seeks `video` to `time` and waits for `seeked`, with a timeout fallback — resurrected from the
 * retired `assessVideoQuality.ts` rather than rewritten. It never rejects and never hangs.
 *
 * The one change from the original is the resolved value: that caller degraded gracefully on a
 * timeout and had no use for the distinction, whereas both callers here must tell a seek that never
 * landed from one that did rather than draw whatever frame happened to be showing — evidence marks
 * the metric `'extraction-failed'`, a poster moves on to its next candidate instant.
 */
export function seekTo(
  video: HTMLVideoElement,
  time: number,
  timeoutMs: number = SEEK_TIMEOUT_MS,
): Promise<SeekOutcome> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001) {
      resolve('already-there')
      return
    }
    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
    }
    const onSeeked = () => {
      cleanup()
      resolve('seeked')
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve('timed-out')
    }, timeoutMs)
    video.addEventListener('seeked', onSeeked)
    video.currentTime = time
  })
}

/** Which arm of `waitForPresentedFrame` resolved it. Reported for observability — no arm is a
 * failure, so the caller draws regardless of which one won. */
export type FramePresentationSignal =
  | 'video-frame-callback'
  | 'animation-frame'
  | 'timed-out'

/**
 * Bounded, best-effort pause between a completed seek and the draw. **Every arm resolves and none
 * of them fails the exemplar** — a presentation signal is a courtesy here, never the only path to
 * a drawn frame.
 *
 * ### Why this is not the `requestVideoFrameCallback` gate it replaced
 *
 * #66 awaited exactly one `requestVideoFrameCallback` after `seeked` and dropped the exemplar when
 * it did not arrive, reasoning that `seeked` reports seek completion but not that the new frame is
 * on screen (design D11 — an inference, never measured). Measured live for #59 (headless Chromium,
 * real GPU): **`requestVideoFrameCallback` does not fire after a PAUSED seek** in this Chromium —
 * detached or attached to the document, headless or headed. It fires normally during playback; the
 * paused-seek case specifically never presents. So the gate never opened, and every metric on every
 * clip degraded to `'extraction-failed'`.
 *
 * The premise was wrong as well as the remedy. `drawImage(video, …)` samples the DECODED frame at
 * the current playback position, not the composited output `requestVideoFrameCallback` reports on,
 * and `seeked` already implies `readyState >= HAVE_CURRENT_DATA` for the new position — the frame
 * is decoded and drawable at that point. The #59 probe confirms it end to end: pixels drawn
 * immediately after `seeked` alone are correct and DISTINCT per timestamp.
 *
 * ### The three arms
 *
 * - `requestVideoFrameCallback`, when the browser has it. First choice, and the reason the wait
 *   still exists: a browser that DOES present after a paused seek gets the real signal.
 * - Two `requestAnimationFrame` ticks. The everyday fallback, ~32 ms. Two rather than one because a
 *   single tick can land ahead of the frame callback in a browser where that callback works, which
 *   would make the real signal unreachable in practice.
 * - `timeoutMs`. The backstop for a document that never paints at all, where
 *   `requestAnimationFrame` is throttled to nothing and would hang this forever.
 *
 * A browser with no `requestVideoFrameCallback` simply loses the first arm and resolves through the
 * other two, which is the same "extract anyway" posture the old code took by resolving immediately.
 */
export function waitForPresentedFrame(
  video: HTMLVideoElement,
  timeoutMs: number = FRAME_PRESENTATION_TIMEOUT_MS,
): Promise<FramePresentationSignal> {
  return new Promise((resolve) => {
    let settled = false
    let frameHandle: number | undefined
    let rafHandle: number | undefined

    // Armed before either fast arm is registered, and read only through the hoisted `settle`
    // below, so no arm — not even one a stub fires synchronously — can reach it unassigned.
    const timer = setTimeout(() => settle('timed-out'), timeoutMs)

    function settle(signal: FramePresentationSignal) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (frameHandle !== undefined) video.cancelVideoFrameCallback?.(frameHandle)
      if (rafHandle !== undefined && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafHandle)
      }
      resolve(signal)
    }

    if (typeof video.requestVideoFrameCallback === 'function') {
      frameHandle = video.requestVideoFrameCallback(() => {
        frameHandle = undefined
        settle('video-frame-callback')
      })
    }

    if (typeof requestAnimationFrame === 'function') {
      rafHandle = requestAnimationFrame(() => {
        rafHandle = requestAnimationFrame(() => {
          rafHandle = undefined
          settle('animation-frame')
        })
      })
    }
  })
}

/** Bounded wait for the element to hold decoded pixels. Resolves `false` on error or timeout. */
function waitForDecodedData(
  video: HTMLVideoElement,
  timeoutMs: number,
): Promise<boolean> {
  if (video.readyState >= HAVE_CURRENT_DATA) return Promise.resolve(true)
  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('error', onError)
    }
    const onLoaded = () => {
      cleanup()
      resolve(true)
    }
    const onError = () => {
      cleanup()
      resolve(false)
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve(false)
    }, timeoutMs)
    video.addEventListener('loadeddata', onLoaded)
    video.addEventListener('error', onError)
  })
}

/**
 * Opens ONE detached decoder on `sourceBlob`, waits for it to hold decoded pixels, hands the
 * element to `onDecoded`, and tears the decoder down before returning — on every exit path,
 * including the ones `onDecoded` throws on.
 *
 * The object URL is minted from `sourceBlob` here and revoked here. `useVideoSource` keeps its own
 * private object URL for the clip's canonical element; that one is never reused and never revoked
 * from here — `sourceBlob` is the intended seam and needs no `VideoSource` API change. Blob URLs
 * inherit the document's origin, so a canvas drawn from this element is never tainted (all four
 * input modes converge on `useVideoSource.load(blob)`; the remote demo URL is fetched to a blob and
 * never assigned to a `src`).
 *
 * `onUndecodable` supplies the caller's own name for "this clip never became readable", because the
 * consumers name it differently — a poster is a `null`, a clip's evidence is `'extraction-failed'`
 * for every metric that planned images — and a shared sentinel would improve neither.
 *
 * It does NOT take a place in the queue. Serialization is `queueDetachedDecode`'s job, applied by
 * whichever exported entry point owns the decision that a decoder is worth opening at all: both
 * consumers have work to do (an abandonment check, a seek calibration) between "asked" and
 * "opened", and only they can say which of it belongs inside the turn.
 */
export async function withDecodedVideo<T>(
  sourceBlob: Blob,
  loadTimeoutMs: number,
  onDecoded: (video: HTMLVideoElement) => Promise<T>,
  onUndecodable: () => T,
): Promise<T> {
  const url = URL.createObjectURL(sourceBlob)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  video.load()

  try {
    const ready = await waitForDecodedData(video, loadTimeoutMs)
    if (!ready) return onUndecodable()
    return await onDecoded(video)
  } finally {
    // Drop the decoder before the URL: revoking first leaves the element holding a reference to a
    // now-unresolvable blob.
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

/**
 * Tail of the process-wide detached-decoder queue (see the module doc). Always settled or pending —
 * never rejected, so one failed decode cannot wedge the queue for everything behind it.
 */
let decoderQueue: Promise<unknown> = Promise.resolve()

/**
 * Runs `open` **strictly after every decode already asked for**, wherever it was asked from.
 *
 * The wait is imposed inside the functions that open decoders rather than asked of their callers.
 * `useClipPoster` is mounted once per clip and cannot see the other clips, so a picked-4-files
 * session fires four derivations in a single microtask flush with nothing between them; evidence's
 * own `for await` loop can only order the clips of ONE pass, and the overlap that mattered there was
 * between SEPARATE passes. Chaining onto one module-level tail makes "one detached decoder exists at
 * a time" a property of this module instead of a convention every future call site has to know —
 * and, unlike the two per-consumer queues it replaces, it holds across the pair as well as within
 * each.
 *
 * A queued decode is not cancellable from here. Evidence carries its own `AbortSignal`, checked
 * again after the turn is granted; a poster is bounded by its load, seek and presentation timeouts
 * instead. Adding cancellation to the queue itself would introduce a second way for it to be left
 * holding a decoder.
 *
 * The returned promise is the caller's own outcome and is NOT swallowed — a decode that throws
 * rejects for whoever asked for it. Only the tail swallows, and only so the next decode still gets
 * its turn.
 */
export function queueDetachedDecode<T>(open: () => Promise<T>): Promise<T> {
  const decode = decoderQueue.then(open)
  // The tail swallows outcomes on purpose. Both consumers name a verdict rather than throwing on
  // every failure they know about, but an unforeseen throw must still not leave `decoderQueue`
  // rejected — everything later chains off it, and it would all reject without ever decoding.
  decoderQueue = decode.then(
    () => undefined,
    () => undefined,
  )
  return decode
}
