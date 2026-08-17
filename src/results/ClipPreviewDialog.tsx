import { useEffect, useRef } from 'react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'

export interface ClipPreviewDialogProps {
  /** Whether this clip is currently presented. */
  open: boolean
  /** Id of the element naming this clip — rendered as one of `children`, below the stage. */
  labelledBy: string
  onDismiss: () => void
  /**
   * The clip's frame (which contains its canonical `<video>`) and its caption, handed down from
   * `ClipStripEntry` verbatim. **Always rendered, in this exact position, open or closed** — see
   * the note on `display: contents` below.
   */
  children: ReactNode
}

/**
 * Everything CSS treats as focusable and that a modal should cycle through. `video[controls]` is
 * in the list because an open preview un-`inert`s the element on purpose, so its native controls
 * become a real tab stop the trap has to know about.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])'

/**
 * The surface a clip's preview is presented on.
 *
 * ## Why this component exists at all, and why it is ALWAYS mounted
 *
 * The clip's `<video>` is a permanent DOM child of its strip entry and must never move: the
 * running analysis and `SkeletonOverlay` both hold `videoRef.current`, and reparenting the node
 * (a portal container switch, an `appendChild`, a conditional wrapper) hands them a stale
 * reference to an element that is no longer the one playing (`results-view`, "Clip video elements
 * stay mounted and playable while hidden"; design.md D4).
 *
 * So the modal does not receive the element — **the modal forms around where the element already
 * is.** This component is rendered unconditionally between `<li>` and the entry's frame, so
 * `children`'s position in the tree is a constant. Closed, it is `display: contents` and generates
 * no box at all, which is layout-identical to it not being there. Open, it becomes
 * `position: fixed` and covers the viewport, taking the frame (and therefore the `<video>`) with
 * it. React updates a `class` and a couple of attributes; the DOM node the sampler holds is
 * untouched. That is exactly the mechanism `VideoInputPanel` already uses for the two placements
 * it switches between, one level up.
 *
 * A consequence worth stating, because it is the point rather than a side effect: a clip that is
 * mid-analysis keeps its full frame throughput while its preview is open. Concealment is what
 * costs ~20-24% of sampled frames on the playback path (`strides-kyu.13`) and this never conceals
 * anything — it makes an already-on-screen element larger. Nothing opaque is drawn over the stage
 * either: the backdrop is this element's own background, strictly BEHIND its children, and the
 * label and Close sit below the stage rather than over it.
 *
 * `position: fixed` here is safe from the strip's `overflow-x-auto` and from the sticky header
 * around it — neither clips a fixed descendant, and no ancestor carries a
 * `transform`/`filter`/`contain` that would capture one. Already proven in place: the concealed
 * placement in `VideoInputPanel` is a `fixed` box inside this same header.
 */
export function ClipPreviewDialog({
  open,
  labelledBy,
  onDismiss,
  children,
}: ClipPreviewDialogProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)

  // Focus enters the dialog itself rather than its first control, so the label is announced
  // before anything is offered. `tabIndex={-1}` below is what makes that possible.
  useEffect(() => {
    if (!open) return
    surfaceRef.current?.focus()
  }, [open])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return

    if (event.key === 'Escape') {
      event.stopPropagation()
      onDismiss()
      return
    }

    if (event.key !== 'Tab') return

    const surface = surfaceRef.current
    if (!surface) return
    const focusable = Array.from(
      surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => !el.hasAttribute('inert') && el.closest('[inert]') === null)

    // Nothing to cycle between: keep focus on the surface rather than letting Tab escape into the
    // page behind the backdrop. Reachable whenever the clip is mid-analysis (its element is
    // `inert`) and the Close button has somehow not rendered.
    if (focusable.length === 0) {
      event.preventDefault()
      surface.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (event.shiftKey && (active === first || active === surface)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // The backdrop IS this element, so a click that lands on it (and not on the stage, the label or
  // Close) is a click outside the content — the conventional dismissal.
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!open) return
    if (event.target !== event.currentTarget) return
    onDismiss()
  }

  return (
    <div
      ref={surfaceRef}
      {...(open
        ? {
            role: 'dialog',
            'aria-modal': true,
            'aria-labelledby': labelledBy,
            tabIndex: -1,
          }
        : {})}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      className={
        open
          ? 'clip-preview-dialog fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4 focus:outline-none sm:p-6'
          : 'contents'
      }
    >
      {children}
      {open && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 border-2 border-white bg-black px-4 py-2 font-sans text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-white hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Close preview
        </button>
      )}
    </div>
  )
}
