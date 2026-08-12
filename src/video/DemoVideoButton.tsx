import { useState } from 'react'

export interface DemoVideoButtonProps {
  onLoaded: (blob: Blob) => void
  disabled?: boolean
  /** Defaults to the original stock side-view track clip. */
  videoUrl?: string
  /** Button label — defaults to match the original single-demo copy. */
  label?: string
}

type DemoState = 'idle' | 'loading' | 'error'

// Pexels' https://www.pexels.com/download/video/8533913/ redirects here. Fetching that
// redirector URL directly fails: its 302 response itself carries no CORS header, so the
// browser blocks the fetch mid-redirect even though this final CDN response does send
// `access-control-allow-origin: *`. Fetching the resolved URL sidesteps that redirect leg.
const DEFAULT_DEMO_VIDEO_URL =
  'https://videos.pexels.com/video-files/8533913/8533913-uhd_3840_2160_25fps.mp4'

/**
 * Fetches a fixed demo clip and hands it to the caller as a `Blob` — routed through the same
 * `URL.createObjectURL` path as `FileUpload`/`WebcamCapture` (via `useVideoSource().load()`),
 * rather than pointing `<video src>` straight at the remote URL, so the canonical video element
 * stays same-origin/untainted for the WebGL-based pose detector reading its pixels later.
 */
export function DemoVideoButton({
  onLoaded,
  disabled = false,
  videoUrl = DEFAULT_DEMO_VIDEO_URL,
  label = 'Try a demo video',
}: DemoVideoButtonProps) {
  const [state, setState] = useState<DemoState>('idle')

  const runDemo = async () => {
    setState('loading')
    try {
      const response = await fetch(videoUrl)
      if (!response.ok) {
        throw new Error(`Demo video request failed with status ${response.status}`)
      }
      const blob = await response.blob()
      onLoaded(blob)
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

      {state === 'loading' && <p role="status">Downloading demo video…</p>}

      {state === 'error' && (
        <div
          className="border-2 border-black dark:border-white border-l-4 border-l-brand-600 dark:border-l-brand-400 p-4 space-y-2"
          role="alert"
        >
          <p>
            Couldn't load the demo video — check your connection and try again, or use your own.
          </p>
        </div>
      )}
    </div>
  )
}
