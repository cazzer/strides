import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ClipPicker } from './ClipPicker'

/** Ties the trigger's `aria-controls` to the region it reveals. */
const PANEL_ID = 'add-clip-panel'

export interface AddClipActionProps {
  /**
   * Called once per chosen source, straight through from `ClipPicker` — so a multi-file upload
   * still fans out one call per file and a caller that mints a clip per call still gets a clip per
   * file. See the note on `handleSource` for why closing the panel does not truncate that fan-out.
   */
  onSource: (source: Blob | File, opts?: { frameRateHint?: number }) => void
}

/**
 * The header's persistent add-a-clip action: the same `ClipPicker` the zero-clip state presents
 * full-page, collapsed behind one button (design.md D6). Record, upload and both demo clips —
 * *not* upload alone.
 *
 * ### Why this is a bug fix and not a relocation
 *
 * The block it replaces was a bare `<FileUpload>`, so upload was the only way to add clips 2..N.
 * Recording and the demo buttons were not merely absent from that block, they were unreachable:
 * every `addClip` records a `pendingLoad` that the new `ClipSlot` consumes on mount, so the new
 * slot's own picker — gated on `status === 'empty'` — never rendered. Presenting the whole picker
 * here is what makes a clip added later indistinguishable from the first.
 *
 * ### Why a fragment, and why the panel is IN FLOW
 *
 * This returns two siblings with no wrapper, so both land as direct flex items of the header row.
 * The trigger sits beside the clip strip (`shrink-0`); the panel takes `basis-full` and therefore
 * wraps onto its own line BELOW the strip. That is a correctness constraint, not a layout taste:
 * each strip entry hosts its clip's real `<video>` while that clip is being sampled, and a
 * concealed element loses ~20% of the sampled frames (`strides-kyu.13`). A popover, a modal, or
 * any absolutely-positioned panel large enough to reach back up over the strip would reintroduce
 * that silently — `getBoundingClientRect` reads perfectly healthy on an occluded element. An
 * in-flow sibling below the strip cannot overlap it at any viewport size, by construction.
 *
 * The strip's own row is unchanged, so opening this grows the header downward and pushes `<main>`
 * down; it never paints over the row above.
 */
export function AddClipAction({ onSource }: AddClipActionProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Set by every path that collapses the panel, consumed by the effect below. Focus cannot be
  // restored inline: `triggerRef.current` is still rendering the PREVIOUS commit at that moment,
  // and after a recording it is still `disabled`, so a synchronous `focus()` would silently no-op
  // and strand a keyboard user on `<body>`.
  const shouldReturnFocusRef = useRef(false)

  const close = useCallback(() => {
    setIsOpen(false)
    // Cleared unconditionally, because `WebcamCapture` reports `false` on MOUNT but never on
    // unmount: a take that ends by handing its blob over closes this panel while the flag is still
    // set, and a stale `true` would leave the trigger permanently disabled.
    setIsRecording(false)
    shouldReturnFocusRef.current = true
  }, [])

  useEffect(() => {
    if (isOpen || !shouldReturnFocusRef.current) return
    shouldReturnFocusRef.current = false
    triggerRef.current?.focus()
  }, [isOpen])

  const handleSource = useCallback(
    (source: Blob | File, opts?: { frameRateHint?: number }) => {
      onSource(source, opts)
      // Closing on the FIRST source does not truncate a multi-file selection: `FileUpload` calls
      // its handler once per file synchronously inside one change event (`FileUpload.tsx:33-35`),
      // and `close`'s state update is batched until that handler returns, so every file still
      // reaches `onSource`. `ClipPicker.test.tsx` and this file's own test both pin that.
      close()
    },
    [onSource, close],
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || isRecording) return
    // Stopped so this never doubles as a dismissal of anything the header is nested in.
    event.stopPropagation()
    close()
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={isOpen}
        aria-controls={isOpen ? PANEL_ID : undefined}
        // Collapsing mid-recording unmounts `WebcamCapture`, which stops the tracks and discards
        // the take. Same guard, and the same wording shape, as the picker's own tab bar.
        disabled={isRecording}
        title={isRecording ? "Can't close while recording" : undefined}
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        className="shrink-0 border-2 border-black dark:border-white px-3 py-2 font-sans text-xs font-semibold uppercase tracking-wide hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit"
      >
        Add a clip
      </button>

      {isOpen && (
        <div
          id={PANEL_ID}
          role="group"
          aria-label="Add a clip"
          onKeyDown={handleKeyDown}
          // `basis-full` is what puts this on its own line under the strip (the header row is
          // `flex-wrap`); the strip itself is `flex-1`, i.e. `flex-basis: 0`, so it never
          // contributes to that wrap decision and never gets pushed off its own line by this.
          // Capped and scrollable so a tall picker cannot grow the sticky header without bound.
          className="basis-full max-h-[60vh] overflow-y-auto border-t-2 border-black dark:border-white pt-4"
        >
          {/* `ClipPicker` returns a fragment and inherits its host's vertical rhythm, so the
              spacing lives here — the same `space-y-4` the full-page presentation applies. The
              width cap keeps the webcam preview (`w-full aspect-video`) from spanning the header. */}
          <div className="max-w-xl space-y-4">
            <ClipPicker onSource={handleSource} onRecordingStateChange={setIsRecording} />
          </div>
        </div>
      )}
    </>
  )
}
