/**
 * jsdom doesn't implement `HTMLVideoElement.requestVideoFrameCallback` at all — the method is
 * simply undefined. Code under test that drives sampling off it (see
 * `src/results/sampleClip.ts`) needs a way to register a callback and have tests invoke it
 * manually with a controlled `mediaTime`, mirroring the `makeVideoSeekable` idiom already used
 * for `currentTime`/`seeked` in `src/test/videoTestUtils.ts`.
 */
export interface FakeVideoFrameCallbackController {
  /**
   * Invokes the most recently registered callback (if any) with the given `mediaTime`, then
   * clears it — matching the real API's one-shot-per-registration contract (the caller must
   * call `requestVideoFrameCallback` again to keep receiving callbacks).
   */
  fire: (mediaTime: number) => void
  /** True iff a callback is currently registered (i.e. re-armed and waiting). */
  hasPendingCallback: () => boolean
  /** Total number of times `requestVideoFrameCallback` has been called. */
  registrationCount: () => number
}

export function stubRequestVideoFrameCallback(
  video: HTMLVideoElement,
): FakeVideoFrameCallbackController {
  let pending: VideoFrameRequestCallback | null = null
  let registrations = 0
  let nextHandle = 1

  video.requestVideoFrameCallback = ((callback: VideoFrameRequestCallback) => {
    pending = callback
    registrations += 1
    return nextHandle++
  }) as HTMLVideoElement['requestVideoFrameCallback']

  video.cancelVideoFrameCallback = (() => {
    pending = null
  }) as HTMLVideoElement['cancelVideoFrameCallback']

  return {
    fire(mediaTime: number) {
      const callback = pending
      pending = null
      if (!callback) return
      callback(performance.now(), {
        mediaTime,
        presentationTime: performance.now(),
        expectedDisplayTime: performance.now(),
        width: 0,
        height: 0,
        presentedFrames: 0,
      })
    },
    hasPendingCallback: () => pending !== null,
    registrationCount: () => registrations,
  }
}
