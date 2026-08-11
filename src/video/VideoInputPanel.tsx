import { useState } from 'react'
import { FileUpload } from './FileUpload'
import { WebcamCapture } from './WebcamCapture'
import type { VideoSource } from './types'

export interface VideoInputPanelProps {
  /** Owned by the caller (e.g. `App.tsx`) via `useVideoSource()`. */
  videoSource: VideoSource
}

type Tab = 'record' | 'upload'

/**
 * Lets the user choose between recording via webcam and uploading a file,
 * and shows the resulting video's loading/error/ready state. Does not know
 * or care which path produced the loaded video — that distinction stops
 * existing once `videoSource.status` changes.
 */
export function VideoInputPanel({ videoSource }: VideoInputPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('record')
  const [isRecording, setIsRecording] = useState(false)

  const { status, error, load, reset, videoRef } = videoSource
  const showPicker = status === 'empty'

  return (
    <section className="video-input-panel">
      {showPicker && (
        <div className="video-input-panel__tabs">
          <button
            type="button"
            aria-pressed={activeTab === 'record'}
            disabled={isRecording && activeTab !== 'record'}
            onClick={() => setActiveTab('record')}
          >
            Record
          </button>
          <button
            type="button"
            aria-pressed={activeTab === 'upload'}
            disabled={isRecording && activeTab !== 'upload'}
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

      <video ref={videoRef} controls playsInline hidden={status === 'empty'} />

      {status === 'ready' && (
        <button type="button" onClick={reset}>
          Choose a different video
        </button>
      )}
    </section>
  )
}
