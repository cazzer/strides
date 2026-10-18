import { useEffect, useId, useRef, useState } from 'react'

const OUTLINED =
  'inline-flex items-center justify-center border-2 border-black dark:border-white px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black dark:text-white transition-colors hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'
const FILLED =
  'inline-flex items-center justify-center border-2 border-brand-700 bg-brand-700 px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-800 hover:border-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'

export interface StartOverControlProps {
  /** Performs the whole-session reset. Called only after the reader confirms. */
  onConfirm: () => void
  /** How many clips the reset removes, named in the confirmation. */
  clipCount: number
}

/**
 * The whole-session reset, behind an in-place confirmation (`strides-qi5q`). It used to be a single
 * "Choose a different video" button that removed every clip on the first click.
 *
 * In-page rather than `window.confirm`: a browser dialog blocks both the Playwright harness and the
 * Chrome automation extension, and it cannot be styled or tested here. The first activation swaps
 * the button for a short question and two buttons; focus moves to the safe choice (Cancel), and
 * Cancel or Escape returns it to "Start over". Shared by both results views so their shells cannot
 * drift apart on the one control that throws work away.
 */
export function StartOverControl({ onConfirm, clipCount }: StartOverControlProps) {
  const [confirming, setConfirming] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // Focus moves after the commit that swaps the elements, never inline: the element to focus does
  // not exist yet at the moment the click handler runs.
  const focusTargetRef = useRef<'cancel' | 'trigger' | null>(null)
  const questionId = useId()

  useEffect(() => {
    const target = focusTargetRef.current
    if (target === null) return
    focusTargetRef.current = null
    ;(target === 'cancel' ? cancelRef : triggerRef).current?.focus()
  }, [confirming])

  const cancel = () => {
    focusTargetRef.current = 'trigger'
    setConfirming(false)
  }

  if (!confirming) {
    return (
      <button
        type="button"
        ref={triggerRef}
        onClick={() => {
          focusTargetRef.current = 'cancel'
          setConfirming(true)
        }}
        className={OUTLINED}
      >
        Start over
      </button>
    )
  }

  const clips = clipCount === 1 ? 'this clip' : `all ${clipCount} clips`
  return (
    <div
      role="group"
      aria-labelledby={questionId}
      className="start-over-confirm flex flex-wrap items-center gap-2"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        cancel()
      }}
    >
      <p id={questionId} className="font-sans text-sm">
        Remove {clips} and start over?
      </p>
      <button type="button" onClick={onConfirm} className={FILLED}>
        Remove and start over
      </button>
      <button type="button" ref={cancelRef} onClick={cancel} className={OUTLINED}>
        Cancel
      </button>
    </div>
  )
}
