import { useCallback, useEffect, useRef, useState } from 'react'
import { classifyGetUserMediaError } from './mediaErrors'
import type { GetUserMediaClassifiedError } from './mediaErrors'

export interface WebcamCaptureProps {
  onRecorded: (blob: Blob, opts: { frameRateHint: number | null }) => void
  disabled?: boolean
  /** Notifies the parent so it can e.g. disable switching to Upload mid-recording. */
  onRecordingStateChange?: (isRecording: boolean) => void
}

type CaptureState =
  | { kind: 'idle' }
  | { kind: 'requesting-permission' }
  | { kind: 'recording' }
  | { kind: 'stopping' }
  | { kind: 'error'; error: GetUserMediaClassifiedError }

const MIME_TYPE_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
]

function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return (
    MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ??
    null
  )
}

/**
 * Records webcam video via `getUserMedia` + `MediaRecorder`. Its live
 * preview is its own internal, stream-backed `<video>` — separate from the
 * canonical, `src`-backed video downstream consumers see. On stop, hands the
 * recorded `Blob` to `onRecorded`; the caller feeds that into
 * `useVideoSource().load()`.
 */
export function WebcamCapture({
  onRecorded,
  disabled = false,
  onRecordingStateChange,
}: WebcamCaptureProps) {
  const [state, setState] = useState<CaptureState>({ kind: 'idle' })

  const previewRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const frameRateHintRef = useRef<number | null>(null)
  const unmountedRef = useRef(false)
  const stopButtonRef = useRef<HTMLButtonElement | null>(null)

  const stopAllTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  // Release the camera if the component unmounts while a stream is open —
  // otherwise the camera indicator stays on after the user navigates away.
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      stopAllTracks()
    }
  }, [stopAllTracks])

  useEffect(() => {
    onRecordingStateChange?.(
      state.kind === 'recording' || state.kind === 'stopping',
    )
  }, [state.kind, onRecordingStateChange])

  // Move focus to the Stop button when recording begins — the Start button
  // it replaces has just unmounted, so without this, keyboard/screen-reader
  // users lose their place and land back on <body>.
  useEffect(() => {
    if (state.kind === 'recording') {
      stopButtonRef.current?.focus()
    }
  }, [state.kind])

  const finalizeRecording = useCallback(() => {
    const mimeType = recorderRef.current?.mimeType
    const blob = new Blob(
      chunksRef.current,
      mimeType ? { type: mimeType } : undefined,
    )
    chunksRef.current = []
    recorderRef.current = null
    stopAllTracks()

    if (blob.size === 0) {
      setState({
        kind: 'error',
        error: {
          kind: 'device-error',
          message:
            'Recording ended before any video was captured. Try again, or upload a video file instead.',
        },
      })
      return
    }

    onRecorded(blob, { frameRateHint: frameRateHintRef.current })
    setState({ kind: 'idle' })
  }, [onRecorded, stopAllTracks])

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({
        kind: 'error',
        error: {
          kind: 'no-camera',
          message:
            "Camera access isn't available in this browser. You can upload a video file instead.",
        },
      })
      return
    }

    const mimeType = pickSupportedMimeType()
    if (!mimeType) {
      setState({
        kind: 'error',
        error: {
          kind: 'recorder-unsupported',
          message:
            "Recording isn't supported in this browser. You can upload a video file instead.",
        },
      })
      return
    }

    setState({ kind: 'requesting-permission' })

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
    } catch (err) {
      if (!unmountedRef.current) {
        setState({ kind: 'error', error: classifyGetUserMediaError(err) })
      }
      return
    }

    if (unmountedRef.current) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }

    streamRef.current = stream
    frameRateHintRef.current =
      stream.getVideoTracks()[0]?.getSettings().frameRate ?? null

    if (previewRef.current) {
      previewRef.current.srcObject = stream
    }

    const track = stream.getVideoTracks()[0]
    if (track) {
      track.onended = () => {
        // Device disconnected mid-recording; finalize whatever was
        // captured rather than losing the user's work.
        if (recorderRef.current && recorderRef.current.state === 'recording') {
          recorderRef.current.stop()
        }
      }
    }

    const recorder = new MediaRecorder(stream, { mimeType })
    recorderRef.current = recorder
    chunksRef.current = []

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => finalizeRecording()
    recorder.onerror = () => {
      chunksRef.current = []
      recorderRef.current = null
      stopAllTracks()
      setState({
        kind: 'error',
        error: {
          kind: 'device-error',
          message:
            'Recording failed unexpectedly. Try again, or upload a video file instead.',
        },
      })
    }

    recorder.start()
    setState({ kind: 'recording' })
  }, [finalizeRecording, stopAllTracks])

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      setState({ kind: 'stopping' })
      recorderRef.current.stop()
    }
  }, [])

  const tryAgain = useCallback(() => setState({ kind: 'idle' }), [])

  const isPreviewing = state.kind === 'recording' || state.kind === 'stopping'

  return (
    <div className="webcam-capture space-y-4">
      <video
        ref={previewRef}
        muted
        autoPlay
        playsInline
        hidden={!isPreviewing}
        aria-label="Camera preview"
        className="w-full aspect-video border-2 border-black dark:border-white bg-black object-contain"
      />

      {state.kind === 'idle' && (
        <button
          type="button"
          onClick={startRecording}
          disabled={disabled}
          className="inline-flex items-center justify-center border-2 border-brand-700 bg-brand-700 px-5 py-2.5 font-sans text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-800 hover:border-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-700"
        >
          Start recording
        </button>
      )}

      {state.kind === 'requesting-permission' && (
        <p role="status">Requesting camera access…</p>
      )}

      {state.kind === 'recording' && <p role="status">Recording…</p>}

      {isPreviewing && (
        <button
          ref={stopButtonRef}
          type="button"
          onClick={stopRecording}
          disabled={state.kind === 'stopping'}
          className="inline-flex items-center justify-center border-2 border-black dark:border-white px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black dark:text-white transition-colors hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {state.kind === 'stopping' ? 'Stopping…' : 'Stop recording'}
        </button>
      )}

      {state.kind === 'error' && (
        <div className="border-2 border-black dark:border-white border-l-4 border-l-brand-600 dark:border-l-brand-400 p-4 space-y-2" role="alert">
          <p>{state.error.message}</p>
          <button
            type="button"
            onClick={tryAgain}
            className="inline-flex items-center justify-center border-2 border-black dark:border-white px-4 py-2 font-sans text-sm font-semibold uppercase tracking-wide text-black dark:text-white transition-colors hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
