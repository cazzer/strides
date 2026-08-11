/**
 * jsdom's HTMLMediaElement doesn't implement real seeking — assigning `currentTime`
 * just... does nothing observable, no `seeked` event ever fires. Code under test that
 * awaits `seeked` (see `src/quality/assessVideoQuality.ts`'s `seekTo`) would otherwise
 * only ever resolve via its timeout fallback, which would make tests slow and would
 * hide bugs in the fast path.
 *
 * This patches `currentTime` on a given `<video>` element so assignment synchronously
 * stores the value and dispatches `seeked`, mirroring the `Object.defineProperty` +
 * manual-`dispatchEvent` idiom already used for `duration`/`videoWidth`/`videoHeight` in
 * `src/video/useVideoSource.test.ts`.
 */
export function makeVideoSeekable(video: HTMLVideoElement): void {
  let currentTime = 0
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value
      video.dispatchEvent(new Event('seeked'))
    },
  })
}
