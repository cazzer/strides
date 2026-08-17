import type { ReactNode } from 'react'
import { ClipPicker } from './ClipPicker'
import type { VideoSource } from './types'

export interface VideoInputPanelProps {
  /** Owned by the caller (e.g. `App.tsx`) via `useVideoSource()`. */
  videoSource: VideoSource
  /**
   * Rendered inside the same positioned wrapper as `<video>`, e.g. `SkeletonOverlay` (#8) — lets
   * a caller layer a canvas overlay directly on top of the canonical video element without this
   * component needing to know anything about what's being overlaid.
   */
  children?: ReactNode
}

/**
 * Lets the user choose between recording via webcam and uploading a file,
 * and shows the resulting video's loading/error/ready state. Does not know
 * or care which path produced the loaded video — that distinction stops
 * existing once `videoSource.status` changes.
 */
export function VideoInputPanel({ videoSource, children }: VideoInputPanelProps) {
  const { status, error, load, reset, videoRef } = videoSource

  return (
    <section className="video-input-panel space-y-4" aria-label="Video input">
      {status === 'empty' && <ClipPicker onSource={load} />}

      {status === 'loading' && <p role="status">Processing video…</p>}

      {status === 'error' && error && (
        <div className="border-2 border-black dark:border-white border-l-4 border-l-brand-600 dark:border-l-brand-400 p-4 space-y-2" role="alert">
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

      {/*
        Always mounted (never conditionally rendered on `status`) — `useVideoSource.load()`
        reads `videoRef.current` synchronously and no-ops if it's null (see
        `useVideoSource.test.ts`'s "does nothing if load() is called with no video element
        attached"), so the picker's `load()` calls, made while `status` is still `'empty'`,
        depend on this element already being mounted. Only the `hidden` attribute — not DOM
        presence — reflects `status`. The wrapper gives an overlay (e.g. `SkeletonOverlay`, #8)
        a `position: relative` stage to be positioned against as a sibling of `<video>`.
      */}
      <div className="relative w-fit max-w-full border-2 border-black dark:border-white bg-neutral-100 dark:bg-neutral-900">
        {/*
          `max-h` keeps the whole frame (portrait clips especially) inside the viewport —
          150px clears the sticky header (86px) plus the main column's top padding — and a
          replaced element with auto width/height under max constraints shrinks
          aspect-preserving, so the element box always equals the frame box and the
          `SkeletonOverlay` stretched over it stays aligned at any scale.
        */}
        <video
          ref={videoRef}
          controls
          playsInline
          hidden={status === 'empty'}
          className="block w-auto h-auto max-w-full max-h-[calc(100vh-150px)] bg-black"
        />
        {status !== 'empty' && children}
      </div>

    </section>
  )
}
