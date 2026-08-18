import type { ReactNode } from 'react'
import type { VideoSource } from './types'

export interface VideoInputPanelProps {
  /** Owned by the caller (`ClipSlot`) via `useVideoSource()`. */
  videoSource: VideoSource
  /**
   * Whether this clip's element must be genuinely on screen right now, because something is
   * reading frames off it. See the hard constraint below — this is a correctness input, not a
   * styling one. Defaults to `false`, i.e. the concealed placement, so a caller that has no
   * opinion gets the safe-to-hide arrangement rather than an element parked over the page.
   */
  onScreen?: boolean
  /**
   * Whether the reader may operate the element directly — true only while this clip's preview is
   * open AND nothing is sampling it. Drops `inert` and un-suppresses the native media controls;
   * changes NOTHING about placement, size, or whether the element is rendered.
   *
   * Deliberately narrower than `onScreen`: while a run is in flight the reader may watch the
   * element but not touch it, because the native controls write straight into the playback state
   * the pipeline owns (a scrub rewinds the sampler; a pause stalls sampling and fails an
   * in-flight scale pass by design). That is the same boundary the observational rule draws for
   * presentation *code* — `results-view`, "Clip playback loops only while that clip is presented"
   * — applied to the one other actor that can reach the element.
   */
  interactive?: boolean
  /**
   * Rendered inside the same positioned wrapper as `<video>`, e.g. `SkeletonOverlay` (#8) — lets
   * a caller layer a canvas overlay directly on top of the canonical video element without this
   * component needing to know anything about what's being overlaid. The wrapper is a positioned
   * ancestor in BOTH placements below, so the overlay's `absolute inset-0` resolves to the element
   * box either way.
   */
  children?: ReactNode
}

/**
 * Hosts one clip's canonical `<video>` element, and nothing else.
 *
 * Choosing a source is `ClipPicker`'s job, and the clip's load/error surface is `ClipLoadStatus`'s
 * — both moved out, because this element now lives inside a 96x72 clip strip entry in the header
 * and anything a reader has to actually read cannot live there.
 *
 * ## THE HARD CONSTRAINT (`results-view`, "Clip video elements stay mounted and playable while
 * hidden"), and what `strides-kyu.13` measured about it
 *
 * Sampling's playback path drives detection off `requestVideoFrameCallback` on a live, PLAYING
 * element. This element is therefore never conditionally rendered, never unmounted, never moved
 * behind a mount gate, and never suppressed by anything a user agent may read as "not rendered" —
 * no `display: none`, no `visibility: hidden`, no zero-size box. Only its CSS changes between the
 * two placements below, so React updates a class attribute and the DOM node — the one
 * `videoRef.current` points at, the one the sampler holds — keeps its identity throughout.
 *
 * `strides-kyu.3` measured the whole pre-registered escalation ladder of concealment techniques and
 * every rung failed: L0 `fixed` off screen −24%, L3 1x1 window −24%, L2 behind a backdrop −37%,
 * L1 `opacity-0` −45%, all against a 62-frame visible baseline on Demo 2 (portrait 4K, 59.94 fps —
 * the only test clip whose sampling is throughput-limited, and therefore the only one that can see
 * this at all). `strides-kyu.13` then measured the other axis and found the ladder was the wrong
 * question entirely:
 *
 *     visible, full size (control)     124,256 px²   61 detected frames    —
 *     visible, 120 px longest side       8,100 px²   62                 +1.6%
 *     visible,  60 px longest side       2,025 px²   62                 +1.6%
 *     concealed (any rung, any size)         0 px²   47-49          −20..−24%
 *
 * **There is no threshold.** Painted area varies 61x across the passing arms with throughput flat.
 * On screen or not is the only variable that matters. So concealment is not a technique to be
 * chosen well — it is a cost to be avoided while anything is reading, and paid only afterwards.
 *
 * ### On screen (`onScreen`) — while the clip is being sampled, or while its preview is open
 *
 * "Presented" and "being sampled" are two independent reasons for the same element to be on screen
 * (design.md D2's resolution), and they compose into this one placement: `absolute inset-0` inside
 * whatever positioned box the caller has put around it. `ClipSlot` passes `onScreen` for either
 * reason, and `ClipStripEntry` grows that box from a 96x72 strip entry into the preview dialog's
 * stage by changing its own class — so opening a preview on a clip that is mid-analysis makes the
 * live element BIGGER, never concealed, and the sampled-frame cost below is not re-incurred.
 *
 * The element fills its host box: `absolute inset-0`, `object-contain`, 96x72 CSS px in the strip.
 * That keeps
 * the longest painted side at 72 (landscape) or 64 (portrait), both clear of the 60 measured as
 * sufficient. It is a child of the sticky header, which is the one placement where the header
 * cannot occlude it — the trap that made a nominally-visible arm measure like a concealed one while
 * every class name looked right, and which `getBoundingClientRect` cannot see.
 *
 * ### Concealed (the default) — while nothing is reading
 *
 * The full-size box moved out of the viewport, unchanged from what `strides-kyu.3` shipped:
 *   - `fixed`, not `absolute` — it must stay a positioned ancestor so `SkeletonOverlay`'s
 *     `absolute inset-0` keeps this exact containing block, and no ancestor carries a
 *     `transform`/`filter`/`contain` that would capture it. (`fixed` also escapes the strip's own
 *     `overflow-x-auto`, so the concealed box is not clipped into a degenerate one.)
 *   - plain offsets, not a transform — transforms invite compositor culling and `will-change`
 *     heuristics that are exactly the class of thing this must not depend on;
 *   - the box keeps its real size, because a degenerate box is what rules the zero-size option out
 *     in the first place.
 *
 * `inert` in both placements unless `interactive`: an off-screen `<video controls>` is otherwise
 * keyboard-focusable and present in the accessibility tree, and an on-screen one inside a strip
 * entry would put a second, unlabelled tab stop inside a control that already has one. The one
 * exception is an open preview of a clip nothing is sampling, where the whole point is that the
 * reader can scrub it. `inert` is interaction-only and does
 * not affect rendering or decode — measured, not assumed (`strides-kyu.3`'s G1a, hidden vs visible,
 * both demo clips, with and without it). Note this also makes `elementFromPoint` useless as a
 * visibility check here: `inert` removes the subtree from hit-testing while leaving it fully
 * rendered, so the hit test returns whatever is behind the video even when it is plainly visible.
 * Screenshot the element's own rect instead.
 *
 * Neither `tsc` nor the unit suite can observe a violation of any of this: jsdom has no media
 * pipeline and no frame callbacks, so an element that never presents a frame looks exactly like a
 * working one under test.
 *
 * The `hidden` attribute below is a DIFFERENT lever with a different meaning and is deliberately
 * left alone: it is correct while `status === 'empty'` (no clip, nothing to sample) and is
 * precisely the mechanism this requirement forbids extending to a loaded clip. The element is
 * still always mounted, because `useVideoSource.load()` reads `videoRef.current` synchronously and
 * no-ops on null (see `useVideoSource.test.ts`'s "does nothing if load() is called with no video
 * element attached").
 */
export function VideoInputPanel({
  videoSource,
  onScreen = false,
  interactive = false,
  children,
}: VideoInputPanelProps) {
  const { status, videoRef } = videoSource

  return (
    <div
      inert={!interactive}
      className={
        onScreen
          ? 'video-input-panel__host absolute inset-0 bg-black'
          : 'video-input-panel__host fixed top-0 left-[-200vw] w-fit max-w-full border-2 border-black dark:border-white bg-neutral-100 dark:bg-neutral-900'
      }
    >
      {/*
        On screen: fill the entry, aspect-preserving, so the element box is the frame box and the
        `SkeletonOverlay` stretched over it stays aligned. The media controls are suppressed rather
        than the `controls` attribute dropped — the attribute is load-bearing for the scale pass's
        pause detection and for `strides-kyu.5`'s preview, while a full-width control bar over a
        72 px thumbnail would cover most of the frame the sampler is reading.

        Concealed: `max-h` is what keeps this box a sane size rather than a 4K one, and a replaced
        element with auto width/height under max constraints shrinks aspect-preserving, so portrait
        clips especially stay whole.

        The bound is the viewport with NOTHING subtracted for the header (`strides-kyu.7`). This
        host is `fixed; top: 0` — anchored to the viewport's top edge and out of flow — so the
        sticky header is never above it and never takes room from it. The header's height is not a
        term in this element's geometry at any viewport width, with or without a clip strip, with
        the add-a-clip panel open or shut; measured, not reasoned from the CSS (`strides-kyu.7`'s
        live check moved the header 86 -> 130 -> 405 px and read this box's rect unchanged).

        It used to read `100vh - 150px`, the 150 hand-derived as "86px header plus padding" back
        when this element sat in the page BODY under the sticky header and had to fit in what was
        left. It has not been below the header since `strides-kyu.3`, and the header has since
        grown a clip strip and a disclosure panel, so the subtraction was both stale and pointing
        at a dependency that no longer exists. Making the cap TRACK the header would have been the
        same error mechanised: the term is not out of date, it is false.
      */}
      <video
        ref={videoRef}
        controls
        playsInline
        hidden={status === 'empty'}
        className={
          onScreen
            ? interactive
              ? 'block h-full w-full bg-black object-contain'
              : 'block h-full w-full bg-black object-contain [&::-webkit-media-controls]:hidden'
            : 'block w-auto h-auto max-w-full max-h-screen bg-black'
        }
      />
      {status !== 'empty' && children}
    </div>
  )
}
