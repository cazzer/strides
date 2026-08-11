import { useState } from 'react'
import type { ReactNode } from 'react'
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
    <section className="video-input-panel" aria-label="Video input">
      {showPicker && (
        <div className="video-input-panel__tabs">
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

      {status === 'loading' && <p role="status">Processing video…</p>}

      {status === 'error' && error && (
        <div role="alert">
          <p>{error.message}</p>
          <button type="button" onClick={reset}>
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
      <div className="video-input-panel__stage" style={{ position: 'relative' }}>
        <video ref={videoRef} controls playsInline hidden={status === 'empty'} />
        {status !== 'empty' && children}
      </div>

      {status === 'ready' && (
        <button type="button" onClick={reset}>
          Choose a different video
        </button>
      )}
    </section>
  )
}
