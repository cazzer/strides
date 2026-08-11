import { useState } from 'react'
import type { ReactNode } from 'react'
import { DemoVideoButton } from './DemoVideoButton'
import { FileUpload } from './FileUpload'
import { WebcamCapture } from './WebcamCapture'
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

type Tab = 'record' | 'upload'

/**
 * Lets the user choose between recording via webcam and uploading a file,
 * and shows the resulting video's loading/error/ready state. Does not know
 * or care which path produced the loaded video — that distinction stops
 * existing once `videoSource.status` changes.
 */
export function VideoInputPanel({ videoSource, children }: VideoInputPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('record')
  const [isRecording, setIsRecording] = useState(false)

  const { status, error, load, reset, videoRef } = videoSource
  const showPicker = status === 'empty'

  return (
    <section className="video-input-panel space-y-4" aria-label="Video input">
      {showPicker && (
        <div className="flex border-2 border-black dark:border-white divide-x-2 divide-black dark:divide-white w-fit">
          <button
            type="button"
            aria-pressed={activeTab === 'record'}
            disabled={isRecording && activeTab !== 'record'}
            title={
              isRecording && activeTab !== 'record'
                ? "Can't switch while recording"
                : undefined
            }
            onClick={() => setActiveTab('record')}
            className="px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide aria-pressed:bg-black aria-pressed:text-white dark:aria-pressed:bg-white dark:aria-pressed:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Record
          </button>
          <button
            type="button"
            aria-pressed={activeTab === 'upload'}
            disabled={isRecording && activeTab !== 'upload'}
            title={
              isRecording && activeTab !== 'upload'
                ? "Can't switch while recording"
                : undefined
            }
            onClick={() => setActiveTab('upload')}
            className="px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide aria-pressed:bg-black aria-pressed:text-white dark:aria-pressed:bg-white dark:aria-pressed:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Upload
          </button>
        </div>
      )}

      {showPicker && activeTab === 'record' && (
        <WebcamCapture
          onRecorded={(blob, opts) =>
            load(blob, { frameRateHint: opts.frameRateHint ?? undefined })
          }
          onRecordingStateChange={setIsRecording}
        />
      )}

      {showPicker && activeTab === 'upload' && (
        <FileUpload onSelected={(file) => load(file)} />
      )}

      {showPicker && (
        <DemoVideoButton onLoaded={(blob) => load(blob)} disabled={isRecording} />
      )}

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
        <video
          ref={videoRef}
          controls
          playsInline
          hidden={status === 'empty'}
          className="block max-w-full h-auto bg-black"
        />
        {status !== 'empty' && children}
      </div>

      {status === 'ready' && (
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center border-2 border-black dark:border-white px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black dark:text-white transition-colors hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Choose a different video
        </button>
      )}
    </section>
  )
}
