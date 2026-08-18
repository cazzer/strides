import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import type { ClipPoster } from '../video/posterFrame'
import { ClipPreviewDialog } from './ClipPreviewDialog'
import type { ClipStripStatus } from './clipStripStatus'

export interface ClipStripEntryProps {
  /** Zero-based position in clip-session order — the same order fusion's source index and the
   * "Combined from clip N of TOTAL" copy number clips by, so a reader can match a metric's stated
   * source clip to an entry by counting. */
  index: number
  total: number
  status: ClipStripStatus
  poster: ClipPoster | null
  /**
   * Whether this entry is currently hosting the clip's real, painting `<video>` (see
   * `clipHostsLiveElement`). While true the element fills the frame and the poster is not drawn —
   * two images in one 96x72 box would just fight. While false the element is concealed off screen
   * again and the poster is all there is.
   */
  hostsLiveElement: boolean
  /**
   * Whether this clip currently holds the shared detector. The ONE live region for the whole
   * session rides on this entry (design.md D3, "One live region, not N"): every entry exposes its
   * condition as text, but only the clip that is actually working announces.
   */
  isActiveClip: boolean
  /**
   * Whether this clip's preview is open. A SECOND, independent reason for the frame to show the
   * live element rather than the poster — see `showsLiveElement` below — and the flag that turns
   * the always-mounted `ClipPreviewDialog` around this entry's frame into an actual dialog.
   */
  isPresented?: boolean
  /** Activating the entry presents this clip. */
  onPresent?: () => void
  /** Escape, Close, or a backdrop click dismisses it. */
  onDismiss?: () => void
  onRemove: () => void
  /** This clip's canonical `<video>` host, supplied by `ClipSlot` — never created here. */
  children: ReactNode
}

/**
 * One clip's entry in the header strip: its frame (which is either the live element or the poster),
 * its own condition and progress, and Remove.
 *
 * ### The frame is not decoration
 *
 * While that clip's analysis is in flight this box is where its real `<video>` lives, on screen and
 * painting, because concealing it costs ~20-24% of the sampled frames on the playback path
 * (`strides-kyu.13`, measured; no threshold, 60 CSS px is enough). So the box's size is a floor to
 * respect, not a style to taste: 96x72 CSS px keeps the longest painted side at or above 72 for a
 * landscape clip and 64 for a portrait one, both clear of the 60 that was measured as sufficient.
 *
 * ### Nothing opaque covers the frame
 *
 * The activation button stretched over the entry is transparent, and the condition bar is a 6 px
 * strip at the bottom edge. Occlusion is the failure mode the measurement kept hitting (a small
 * element buried under the sticky header reads healthy to `getBoundingClientRect` and dead to the
 * sampler), so this component covers as little of the frame as it can and puts the caption BELOW
 * the frame rather than over it. The preview keeps that discipline: the backdrop is behind the
 * stage, and the label and Close sit under it.
 *
 * ### The preview grows the frame; it never moves the element
 *
 * Activating the entry opens this clip's preview, and the whole of that is: `ClipPreviewDialog`
 * (always mounted, `display: contents` when closed) goes `position: fixed` over the viewport, and
 * the frame below grows from 96x72 into the dialog's stage. `children` — the clip's `<video>` —
 * stays in exactly the same place in the tree throughout, which is the requirement
 * (`results-view`, "Revealing a clip does not change which element analysis holds"). A clip that
 * is mid-analysis therefore keeps its element on screen and keeps its frame throughput; opening
 * its preview makes that element larger, not concealed.
 */
export function ClipStripEntry({
  index,
  total,
  status,
  poster,
  hostsLiveElement,
  isActiveClip,
  isPresented = false,
  onPresent,
  onDismiss,
  onRemove,
  children,
}: ClipStripEntryProps) {
  const entryRef = useRef<HTMLLIElement>(null)
  const activateRef = useRef<HTMLButtonElement>(null)
  const labelId = useId()

  // Focus returns to the control that opened the preview. Guarded on a true→false transition
  // rather than on `!isPresented`, so a freshly-mounted entry never steals focus. The button is
  // `hidden` while the preview is open and visible again by the time this effect runs, since
  // React commits attributes before flushing effects.
  const wasPresentedRef = useRef(false)
  useEffect(() => {
    if (wasPresentedRef.current && !isPresented) {
      activateRef.current?.focus()
    }
    wasPresentedRef.current = isPresented
  }, [isPresented])

  // A strip that scrolls can scroll the working clip out of its own bounds, which would conceal the
  // very element that has to stay on screen — the horizontal-overflow requirement and the
  // stay-visible requirement pull against each other, and this is the seam between them. Scoped to
  // `nearest` in both axes so an entry that is already visible causes no scrolling at all.
  // Optional-called: jsdom implements no scrolling API, and this is a live-browser concern only.
  useEffect(() => {
    if (!hostsLiveElement) return
    entryRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [hostsLiveElement])

  const label = `Clip ${index + 1} of ${total}: ${status.announcement}`

  // Two independent reasons the frame must show the real element rather than the poster: the
  // sampler is reading it, or a reader is looking at it. Drawing a still over either would just
  // fight with what is actually wanted there.
  const showsLiveElement = hostsLiveElement || isPresented

  return (
    <li
      ref={entryRef}
      data-clip-condition={status.condition}
      className="clip-strip__entry relative shrink-0"
    >
      <ClipPreviewDialog
        open={isPresented}
        labelledBy={labelId}
        onDismiss={() => onDismiss?.()}
      >
        <div
          className={
            isPresented
              ? 'clip-strip__frame relative min-h-0 w-full max-w-5xl flex-1 border-2 border-white bg-black'
              : 'clip-strip__frame relative h-[4.5rem] w-24 overflow-hidden border-2 border-black bg-neutral-100 dark:border-white dark:bg-neutral-900'
          }
        >
          {children}
          {!showsLiveElement &&
            (poster ? (
              <ClipPosterFrame poster={poster} />
            ) : (
              // Neutral placeholder, not a spinner: a poster is optional everywhere and may simply
              // never arrive (a clip that failed to load has no frame to take).
              <div
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center font-display text-lg font-bold text-neutral-400 dark:text-neutral-600"
              >
                {index + 1}
              </div>
            ))}
          {/* Not drawn over the preview: 6 px of bar is 6 px of the frame the reader opened the
              preview to look at, and it would sit right on the native control bar. The caption
              below carries the same condition in words. */}
          {!isPresented && (
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-1.5 bg-black/25 dark:bg-white/25"
            >
              <ConditionBar status={status} />
            </div>
          )}
        </div>

        <p
          id={labelId}
          // The session's single clip-progress live region, on the one clip that is working. Every
          // other entry carries the identical text as plain, unannounced content.
          {...(isActiveClip ? { role: 'status' } : {})}
          className={
            isPresented
              ? 'clip-strip__caption flex shrink-0 items-center gap-2 font-sans text-sm leading-tight font-semibold uppercase tracking-wide text-white'
              : 'clip-strip__caption mt-0.5 flex w-24 items-center gap-1 font-sans text-[0.6875rem] leading-tight font-semibold uppercase tracking-wide'
          }
        >
          <span aria-hidden="true" className="shrink-0">
            {status.glyph}
          </span>
          <span aria-hidden="true" className={isPresented ? '' : 'truncate'}>
            {isPresented ? label : status.caption}
          </span>
          <span className="sr-only">{label}</span>
        </p>
      </ClipPreviewDialog>

      {/*
        The entry's activation target: opens this clip's preview. Transparent and stretched over
        the whole entry, so it never covers the frame's pixels with anything opaque.

        `hidden` while the preview is open, and not merely styled away: the frame has moved into
        the fixed dialog surface, which collapses the `<li>` to nothing, and a zero-size button is
        invisible but still tabbable — it would be a hole in the modal's focus trap. It is also the
        focus-restore target, which is why it is a ref rather than something re-found by query.
      */}
      <button
        ref={activateRef}
        type="button"
        hidden={isPresented}
        onClick={() => onPresent?.()}
        aria-labelledby={labelId}
        className="absolute inset-0 z-10 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      />

      <button
        type="button"
        hidden={isPresented}
        onClick={onRemove}
        className="absolute top-0 right-0 z-20 flex h-5 w-5 items-center justify-center border-b-2 border-l-2 border-black bg-white font-sans text-xs leading-none font-bold text-black transition-colors hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-white dark:bg-black dark:text-white dark:hover:bg-white dark:hover:text-black"
      >
        <span aria-hidden="true">×</span>
        <span className="sr-only">Remove clip</span>
      </button>
    </li>
  )
}

/**
 * The bar is a THIRD encoding of the condition, behind the caption word and the glyph — a filled
 * fraction while sampling, a pulsing full bar while processing, a solid full bar once analysed, a
 * hatched one on failure, and nothing at all while the clip has not started. Colour alone never
 * carries a distinction here.
 */
function ConditionBar({ status }: { status: ClipStripStatus }) {
  switch (status.condition) {
    case 'sampling':
      return (
        <div
          className="h-full bg-brand-600"
          style={{ width: `${status.percent ?? 0}%` }}
        />
      )
    case 'processing':
      return <div className="h-full w-full animate-pulse bg-brand-600" />
    case 'ready':
      return <div className="h-full w-full bg-black dark:bg-white" />
    case 'error':
    case 'load-error':
      return (
        <div
          className="h-full w-full bg-brand-700"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent 0 3px, rgba(255,255,255,0.7) 3px 6px)',
          }}
        />
      )
    default:
      return null
  }
}

/**
 * Adopts the poster's own `<canvas>` node — the same posture `EvidenceCanvas` takes, and for the
 * same reason: the poster is a live canvas held in memory for the session, never a data URL or a
 * blob, so a renderer takes the node itself and releases nothing (its owner, `useClipPoster`, does
 * that).
 */
function ClipPosterFrame({ poster }: { poster: ClipPoster }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    host.replaceChildren(poster.canvas)
    return () => {
      host.replaceChildren()
    }
  }, [poster])

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="clip-strip__poster absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full [&>canvas]:object-contain"
    />
  )
}
