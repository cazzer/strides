import { useEffect, useRef } from 'react'

export interface EvidenceCanvasProps {
  canvas: HTMLCanvasElement
  alt: string
  /** Extra classes for the host box — the caller's sizing decision. The extractor's canvas is
   * capped at `EVIDENCE_OUTPUT_MAX_SIDE_PX` and every crop is square by construction, so a gallery
   * figure and a card thumbnail are the SAME image at two CSS sizes, never two extractions. */
  className?: string
}

/**
 * Adopts an already-drawn `<canvas>` into the tree. The extractor hands back canvas ELEMENTS
 * rather than URLs on purpose — `toDataURL`/`toBlob` are the export path this epic deliberately
 * does not have — so the one way to render one is to parent the node itself.
 *
 * The host carries the accessible role and description, and sizes the adopted node through a
 * child selector, so the canvas itself is never mutated — it belongs to the extractor, and
 * writing to a prop is exactly what `react-hooks/immutability` is there to stop.
 *
 * The box is square, and so is the canvas by construction (`computeCropRect` produces squares and
 * the extractor draws into a square of the same side), so every image presents at one aspect ratio
 * at every width and at every size (design D13) — a card carrying one thumbnail and a card carrying
 * two read as the same set.
 *
 * Lifted out of the since-deleted `EvidenceGallery.tsx` unchanged by `strides-ac9.2`, so the metric card adopts the
 * node exactly as the gallery does rather than reimplementing the one mechanism that must not drift.
 */
export function EvidenceCanvas({ canvas, alt, className = '' }: EvidenceCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    host.replaceChildren(canvas)
    return () => {
      host.replaceChildren()
    }
  }, [canvas])

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={alt}
      className={`evidence-image aspect-square w-full overflow-hidden border border-neutral-300 bg-neutral-100 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full [&>canvas]:object-contain dark:border-neutral-700 dark:bg-neutral-900 ${className}`}
    />
  )
}
