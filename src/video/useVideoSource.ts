import { useCallback, useEffect, useRef, useState } from 'react'
import { classifyMediaError } from './mediaErrors'
import type { VideoMetadata, VideoSource, VideoSourceError } from './types'

interface AttachedListeners {
  video: HTMLVideoElement
  cleanup: () => void
}

/**
 * Owns the canonical, `src`-backed video element's state: the object URL
 * lifecycle, loading/ready/error status, and metadata. Does not render the
 * `<video>` DOM node itself — the caller renders
 * `<video ref={videoSource.videoRef} controls playsInline />` and this hook
 * drives it via the ref.
 *
 * Both the webcam-record path and the file-upload path call `load()` with
 * whatever `Blob`/`File` they produced; there is no special-casing between
 * them past this point.
 */
export function useVideoSource(): VideoSource {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const frameRateHintRef = useRef<number | null>(null)
  const listenersRef = useRef<AttachedListeners | null>(null)

  const [status, setStatus] = useState<VideoSource['status']>('empty')
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null)
  const [error, setError] = useState<VideoSourceError | null>(null)

  const revokeCurrentObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  // Attached lazily (from `load()`) rather than in a mount effect, so the
  // hook works whether the `<video>` is wired up via JSX (real usage) or
  // assigned directly to `videoRef.current` (unit tests) — either way,
  // listeners are guaranteed attached before they're needed.
  const ensureListeners = useCallback((video: HTMLVideoElement) => {
    if (listenersRef.current?.video === video) return
    listenersRef.current?.cleanup()

    const handleLoadedMetadata = () => {
      setMetadata({
        durationSec: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        frameRate: frameRateHintRef.current,
      })
      setStatus('ready')
    }

    const handleError = () => {
      setError(classifyMediaError(video.error))
      setStatus('error')
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('error', handleError)

    listenersRef.current = {
      video,
      cleanup: () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata)
        video.removeEventListener('error', handleError)
      },
    }
  }, [])

  const load = useCallback<VideoSource['load']>(
    (source, opts) => {
      const video = videoRef.current
      if (!video) return

      ensureListeners(video)
      revokeCurrentObjectUrl()
      frameRateHintRef.current = opts?.frameRateHint ?? null

      setStatus('loading')
      setError(null)
      setMetadata(null)

      const url = URL.createObjectURL(source)
      objectUrlRef.current = url

      // Defensive: the canonical element must always be src-backed, never
      // stream-backed (see design.md - D1).
      video.srcObject = null
      video.src = url
      video.load()
    },
    [ensureListeners, revokeCurrentObjectUrl],
  )

  const reset = useCallback(() => {
    revokeCurrentObjectUrl()
    frameRateHintRef.current = null
    const video = videoRef.current
    if (video) {
      video.removeAttribute('src')
      video.load()
    }
    setStatus('empty')
    setError(null)
    setMetadata(null)
  }, [revokeCurrentObjectUrl])

  // Revoke the last object URL and detach listeners on unmount.
  useEffect(() => {
    return () => {
      revokeCurrentObjectUrl()
      listenersRef.current?.cleanup()
    }
  }, [revokeCurrentObjectUrl])

  return { videoRef, status, metadata, error, load, reset }
}
