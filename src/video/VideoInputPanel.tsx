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

        ⚠️ THIS RUNG DOES NOT FULLY SATISFY THE CONSTRAINT, and neither does any other one tried.
        `strides-kyu.3` measured the whole pre-registered escalation ladder against the PLAYBACK
        sampling arm on Demo 2 (portrait 4K, 59.94 fps — the only test clip whose sampling is
        throughput-limited, and therefore the only one that can see this at all). Concealment
        costs frames in proportion to HOW concealed the element is, and every rung fails the
        pre-registered ±10% gate:

          base (old layout, visible)                62 [57..63]
          this layout, wrapper left `relative`      61 [56..63]   ← the restructure itself is free
          this layout, `fixed` but ON SCREEN        63 [57..64]   ← `position: fixed` is free
          L0  `fixed` off screen + `inert`          47 [46..57]   −24%   (shipped)
          L3  1x1 `overflow:hidden` window          47 [40..59]   −24%
          L2  `-z-20` behind an opaque backdrop     39 [37..47]   −37%
          L1  `opacity-0` + `-z-10`                 34 [33..39]   −45%

        So the cost is CONCEALMENT, not the positioning technique, and the ladder's ordering is
        inverted — L0 is the best of the concealed options, not merely the first to try. Demo 1
        (landscape 4K, 25 fps) is unaffected at every rung (47 → 47) because 40 ms per frame
        leaves the sampler slack to absorb the added per-frame cost; Demo 2 has 16.7 ms and does
        not. The default WebCodecs path is entirely unaffected on both clips (Demo 1 53 → 53,
        Demo 2 99 → 99, bit-identical), because it reads `sourceBlob`'s bytes and never touches
        this element — so the regression lands only on clips where `canUseSequentialDecode` says
        no, i.e. webcam/WebM recordings, exactly the case D1's guard exists to protect.

        This is reported, not resolved: picking a rung cannot fix a cost that every rung shares.
        See the report on `strides-kyu.3` and design.md D2's "Measured" section.

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

          The 150 is one of four hardcoded header-height values, and its stated derivation is
          already stale: there is no main column any more. `strides-kyu.7` names this exact line
          and replaces all four with the header's measured height, so it is deliberately left
          alone here rather than half-fixed. The CAP still does its real job in the meantime —
          it is what keeps this box a sane size rather than a 4K one.
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
