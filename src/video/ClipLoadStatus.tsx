import type { VideoSource } from './types'

export interface ClipLoadStatusProps {
  videoSource: VideoSource
}

/**
 * One clip's load-time surface: "still decoding" and "this file did not work, here is why, try
 * again". Split out of `VideoInputPanel` when the clip's `<video>` moved into the header strip
 * (`strides-kyu.4`) — an error message inside a 96x72 thumbnail is an error message nobody can
 * read, and `video-input`'s "Clear error messages for permission and format failures" requires it
 * be visible. So the element went to the strip and this stayed in the page body, rendered per clip
 * by `MultiClipVideoSession`.
 *
 * Purely presentational, like `VideoInputPanel` itself: it calls no hook and owns no state.
 */
export function ClipLoadStatus({ videoSource }: ClipLoadStatusProps) {
  const { status, error, reset } = videoSource

  return (
    <>
      {status === 'loading' && <p role="status">Processing video…</p>}

      {status === 'error' && error && (
        <div
          className="border-2 border-black dark:border-white border-l-4 border-l-brand-600 dark:border-l-brand-400 p-4 space-y-2"
          role="alert"
        >
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
    </>
  )
}
