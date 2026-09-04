import { useState } from 'react'

export interface DemoVideoButtonProps {
  /**
   * Called once per clip, in `videoUrls` order, as each clip's bytes arrive — not once with the
   * whole set. The caller creates one clip per call, so the session fills in progressively.
   */
  onLoaded: (blob: Blob) => void
  disabled?: boolean
  /**
   * The clips this action loads, in the order they should become clips 1..N. Required: a default
   * would be a URL nobody reading the call site can see, and the clip ORDER is user-visible (the
   * evidence captions name "clip 2 of 3").
   */
  videoUrls: readonly string[]
  /** Button label. */
  label: string
}

type DemoState = 'idle' | 'loading' | 'error'

/**
 * Fetches a fixed set of demo clips and hands each one to the caller as a `Blob` — routed through
 * the same `URL.createObjectURL` path as `FileUpload`/`WebcamCapture` (via `useVideoSource().load()`),
 * rather than pointing `<video src>` straight at the URL, so the canonical video element stays
 * same-origin/untainted for the WebGL-based pose detector reading its pixels later.
 *
 * ### Why the clips are fetched one at a time
 *
 * The bundled set is ~69 MB. Fetching all of it before handing over the first clip would leave the
 * page idle for the whole download; `Promise.all` plus an ordered emit has the same defect, since
 * the first clip still waits on the slowest. Fetching sequentially and emitting each clip as it
 * lands lets clip 1 analyze while clips 2 and 3 are still arriving.
 *
 * A clip arriving mid-analysis is the designed path rather than a race: `MultiClipVideoSession`
 * hands the one shared detector to exactly one clip at a time (`nextActiveClipIndex`), so a clip
 * added while another is running simply queues.
 *
 * A failure part-way through keeps the clips already delivered. They are real, loaded clips that
 * the session is already analyzing — discarding them to report an all-or-nothing failure would
 * throw away work the reader can see happening.
 */
export function DemoVideoButton({
  onLoaded,
  disabled = false,
  videoUrls,
  label,
}: DemoVideoButtonProps) {
  const [state, setState] = useState<DemoState>('idle')

  const runDemo = async () => {
    setState('loading')
    try {
      for (const url of videoUrls) {
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`Demo video request failed with status ${response.status}`)
        }
        onLoaded(await response.blob())
      }
      setState('idle')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={runDemo}
        disabled={disabled || state === 'loading'}
        className="inline-flex items-center justify-center border-2 border-black dark:border-white px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black dark:text-white transition-colors hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {state === 'loading' ? 'Loading demo…' : label}
      </button>

      {state === 'loading' && <p role="status">Loading demo clips…</p>}

      {state === 'error' && (
        <div
          className="border-2 border-black dark:border-white border-l-4 border-l-brand-600 dark:border-l-brand-400 p-4 space-y-2"
          role="alert"
        >
          <p>Couldn't load the demo video — try again, or use your own.</p>
        </div>
      )}
    </div>
  )
}
