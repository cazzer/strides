import type { RefObject } from 'react'

export interface VideoMetadata {
  durationSec: number
  width: number
  height: number
  /**
   * Best-effort frame rate. `null` for file uploads — no browser API exposes
   * a video file's frame rate without expensive frame sampling, which is out
   * of scope here (known gap). Webcam recordings can populate this from
   * `MediaStreamTrack.getSettings().frameRate`.
   */
  frameRate: number | null
}

export type VideoSourceStatus = 'empty' | 'loading' | 'ready' | 'error'

export interface VideoSourceError {
  kind: 'unsupported-format' | 'decode-error' | 'unknown'
  /** User-facing, plain language. */
  message: string
}

export interface VideoSource {
  /**
   * Ref to the canonical, `src`-backed `<video>` element. Rendered by the
   * caller (e.g. `VideoInputPanel`) — this hook owns state only, not DOM.
   */
  videoRef: RefObject<HTMLVideoElement | null>
  status: VideoSourceStatus
  metadata: VideoMetadata | null
  error: VideoSourceError | null
  load: (source: Blob | File, opts?: { frameRateHint?: number }) => void
  reset: () => void
}
