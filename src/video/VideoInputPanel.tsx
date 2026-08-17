import type { ReactNode } from 'react'
import type { VideoSource } from './types'

export interface VideoInputPanelProps {
  /** Owned by the caller (e.g. `App.tsx`) via `useVideoSource()`. */
  videoSource: VideoSource
  /**
   * Rendered inside the same positioned wrapper as `<video>`, e.g. `SkeletonOverlay` (#8) — lets
   * a caller layer a canvas overlay directly on top of the canonical video element without this
   * component needing to know anything about what's being overlaid.
   */
  children?: ReactNode
}

/**
 * Hosts one clip's canonical `<video>` element, and shows that clip's loading/error state.
 *
 * Choosing a source is no longer this component's job — `ClipPicker` owns that, and the session
 * renders it once for the whole page rather than once per clip. What is left here is the clip's
 * own surface: the element itself (positioned off screen, see below) plus the two states a reader
 * still has to be able to act on.
 */
export function VideoInputPanel({ videoSource, children }: VideoInputPanelProps) {
  const { status, error, reset, videoRef } = videoSource

  return (
    <section className="video-input-panel space-y-4" aria-label="Video input">
      {status === 'loading' && <p role="status">Processing video…</p>}

      {status === 'error' && error && (
        <div className="border-2 border-black dark:border-white border-l-4 border-l-brand-600 dark:border-l-brand-400 p-4 space-y-2" role="alert">
          <p>{error.message}</p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center border-2 border-black dark:border-white px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black dark:text-white transition-colors hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Try again
          </button>
        </div>
      )}

      {/*
        THE HARD CONSTRAINT (`results-view`, "Clip video elements stay mounted and playable while
        hidden"). Sampling's playback path drives detection off `requestVideoFrameCallback` on a
        live, PLAYING element, so hiding a clip must be VISUAL ONLY. This element is therefore
        never conditionally rendered, never unmounted, never moved behind a mount gate, and never
        suppressed by anything a user agent is allowed to read as "not rendered" — no
        `display: none`, no `visibility: hidden`, no zero-size box. Neither `tsc` nor the unit
        suite can observe a violation: jsdom has no media pipeline and no frame callbacks, so an
        element that never presents a frame looks exactly like a working one under test.

        The mechanism is the full-size box moved out of the viewport, which keeps it a rendered,
        composited, playing element and changes only where it is:
          - `fixed`, not `absolute` — it must stay a positioned ancestor so `SkeletonOverlay`'s
            `absolute inset-0` keeps this exact containing block, and no ancestor carries a
            `transform`/`filter`/`contain` that would capture it;
          - plain offsets, not a transform — transforms invite compositor culling and
            `will-change` heuristics that are exactly the class of thing this must not depend on;
          - the box keeps its real size (`w-fit max-w-full` and the `<video>`'s own sizing below),
            because a degenerate box is what rules the zero-size option out in the first place;
          - `inert` because an off-screen `<video controls>` is otherwise keyboard-focusable and
            present in the accessibility tree — a tab stop leading nowhere. `inert` is
            interaction-only and does not affect rendering or decode; measured, not assumed
            (`strides-kyu.3`'s G1a, hidden vs. visible, both demo clips, with and without it).

        The `hidden` attribute below is a DIFFERENT lever with a different meaning and is
        deliberately left alone: it is correct while `status === 'empty'` (no clip, nothing to
        sample) and is precisely the mechanism this requirement forbids extending to a loaded
        clip. The element is still always mounted, because `useVideoSource.load()` reads
        `videoRef.current` synchronously and no-ops on null (see `useVideoSource.test.ts`'s "does
        nothing if load() is called with no video element attached").

        `strides-kyu.5` gives this wrapper a presentation state, at which point "off screen" stops
        being unconditional. Until then a clip has no presentation surface at all, which is the
        correct intermediate state.
      */}
      <div
        inert
        className="fixed top-0 left-[-200vw] w-fit max-w-full border-2 border-black dark:border-white bg-neutral-100 dark:bg-neutral-900"
      >
        {/*
          `max-h` keeps the whole frame (portrait clips especially) inside the viewport —
          150px clears the sticky header (86px) plus the main column's top padding — and a
          replaced element with auto width/height under max constraints shrinks
          aspect-preserving, so the element box always equals the frame box and the
          `SkeletonOverlay` stretched over it stays aligned at any scale.
        */}
        <video
          ref={videoRef}
          controls
          playsInline
          hidden={status === 'empty'}
          className="block w-auto h-auto max-w-full max-h-[calc(100vh-150px)] bg-black"
        />
        {status !== 'empty' && children}
      </div>

    </section>
  )
}
