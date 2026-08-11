import type { VideoSourceError } from './types'

/**
 * Classifies a native `HTMLVideoElement` `MediaError` (post-load failures —
 * the video already has a `src`/data but the browser couldn't play it) into
 * a plain-language, actionable message.
 */
// MediaError.code values, per the HTML spec (https://html.spec.whatwg.org/#error-codes).
// Referenced as numeric literals rather than `MediaError.MEDIA_ERR_*` because
// jsdom (used in tests) does not define the `MediaError` global.
const MEDIA_ERR_DECODE = 3
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

export function classifyMediaError(error: MediaError | null): VideoSourceError {
  if (error?.code === MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return {
      kind: 'unsupported-format',
      message:
        "This video format isn't supported. Try a different file, or record with your webcam instead.",
    }
  }

  if (error?.code === MEDIA_ERR_DECODE) {
    return {
      kind: 'decode-error',
      message:
        'This video file appears to be corrupted and could not be decoded. Try a different file, or record with your webcam instead.',
    }
  }

  return {
    kind: 'unknown',
    message:
      'This video could not be loaded. Try a different file, or record with your webcam instead.',
  }
}

export type GetUserMediaErrorKind =
  | 'permission-denied'
  | 'no-camera'
  | 'device-error'
  | 'recorder-unsupported'
  | 'unknown'

export interface GetUserMediaClassifiedError {
  kind: GetUserMediaErrorKind
  /** User-facing, plain language. */
  message: string
}

/**
 * Classifies a `getUserMedia`/`MediaRecorder` failure (pre-capture — no
 * video data exists yet) into a plain-language, actionable message.
 */
export function classifyGetUserMediaError(
  error: unknown,
): GetUserMediaClassifiedError {
  // getUserMedia/MediaRecorder failures are typically DOMExceptions, which
  // (per spec) do NOT extend Error, so this can't rely on `instanceof
  // Error` — just duck-type on `.name`, which both Error and DOMException
  // instances carry.
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : undefined

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        kind: 'permission-denied',
        message:
          'Camera access was denied. You can allow it in your browser settings, or upload a video file instead.',
      }
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        kind: 'no-camera',
        message:
          'No camera was found on this device. You can upload a video file instead.',
      }
    case 'NotReadableError':
    case 'AbortError':
      return {
        kind: 'device-error',
        message:
          'The camera could not be started, possibly because another app is using it. You can upload a video file instead.',
      }
    default:
      return {
        kind: 'unknown',
        message:
          'Something went wrong accessing the camera. You can upload a video file instead.',
      }
  }
}
