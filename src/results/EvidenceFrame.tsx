import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ExtractedEvidenceFrame } from '../video/extractFrames'
import { ClipPreviewDialog } from './ClipPreviewDialog'
import { EvidenceCanvas } from './EvidenceCanvas'
import { altFor, captionFor } from './evidenceCaptions'

export interface EvidenceFrameProps {
  item: ExtractedEvidenceFrame
  clipLabel: string
  onOpenVideo?: (returnFocus: HTMLButtonElement | null) => void
}

/** The extractor's one canvas moves between the thumbnail and a body-level dialog. */
export function EvidenceFrame({ item, clipLabel, onOpenVideo }: EvidenceFrameProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const skipRestoreRef = useRef(false)
  const wasOpenRef = useRef(false)
  const titleId = useId()

  useEffect(() => {
    if (wasOpenRef.current && !open && !skipRestoreRef.current) triggerRef.current?.focus()
    if (!open) skipRestoreRef.current = false
    wasOpenRef.current = open
  }, [open])

  const openSourceVideo = () => {
    skipRestoreRef.current = true
    setOpen(false)
    onOpenVideo?.(triggerRef.current)
  }

  return (
    <>
      <figure className="metrics-panel__evidence-figure space-y-1">
        <button
          ref={triggerRef}
          type="button"
          hidden={open}
          aria-label="Enlarge evidence image"
          onClick={() => setOpen(true)}
          className="block w-36 max-w-full text-left font-sans text-xs font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          {!open && <EvidenceCanvas canvas={item.canvas} alt={altFor(item.plan)} />}
          <span>Enlarge</span>
        </button>
        <figcaption className="metrics-panel__evidence-caption font-sans text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
          {captionFor(item.plan)}
        </figcaption>
      </figure>
      {open && createPortal(
        <ClipPreviewDialog open labelledBy={titleId} onDismiss={() => setOpen(false)}>
          <div className="w-full max-w-[min(90vw,40rem)]">
            <EvidenceCanvas canvas={item.canvas} alt={altFor(item.plan)} />
          </div>
          <p id={titleId} className="max-w-2xl font-sans text-sm leading-snug text-white">
            {captionFor(item.plan)}
            <span className="block mt-1">{clipLabel}</span>
          </p>
          {onOpenVideo && (
            <button type="button" onClick={openSourceVideo} className="border-2 border-white px-4 py-2 font-sans text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
              Open source video at {item.plan.ghost ? 'the solid frame' : 'this frame'}
            </button>
          )}
        </ClipPreviewDialog>,
        document.body,
      )}
    </>
  )
}
