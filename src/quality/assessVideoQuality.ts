import type { PoseDetector } from '../pose/detector'
import type { PoseFrame } from '../pose/types'
import type { VideoMetadata } from '../video/types'
import type { QualityCheckResult, VideoQualityAssessment } from './types'

/** Shorter of width/height, in px — orientation-agnostic. */
export const MIN_SHORT_SIDE_PX = 480
/** Only evaluated when metadata.frameRate is known (never true for uploads). */
export const MIN_FRAME_RATE_FPS = 24
/** Per-keypoint "usable" cutoff. */
export const VISIBLE_KEYPOINT_SCORE = 0.3
/** Avg fraction of the 12 common keypoints visible across samples. */
export const MIN_AVG_VISIBLE_FRACTION = 0.6
export const DEFAULT_SAMPLE_COUNT = 5

const SEEK_TIMEOUT_MS = 2000

/**
 * Evenly spreads `count` timestamps across the *middle* of the clip, trimming 10% off
 * each end when the clip is long enough — the start of a clip is often the runner
 * walking in or the camera settling, which would bias a naive first-N-frames sample low.
 */
function sampleTimestamps(durationSec: number, count: number): number[] {
  const trim = durationSec > 3 ? durationSec * 0.1 : 0
  const span = durationSec - trim * 2
  return Array.from(
    { length: count },
    (_, i) => trim + (span * (i + 0.5)) / count,
  )
}

/**
 * Seeks `video` to `time` and waits for `seeked` — with a timeout fallback, since
 * `seeked` isn't guaranteed to fire reliably in every browser/state. Degrades
 * gracefully (resolves anyway) rather than hanging the assessment.
 */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001) {
      resolve()
      return
    }
    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
    }
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, SEEK_TIMEOUT_MS)
    video.addEventListener('seeked', onSeeked)
    video.currentTime = time
  })
}

function visibleFraction(frame: PoseFrame | null): number {
  if (!frame) return 0
  return (
    frame.keypoints.filter((k) => k.score >= VISIBLE_KEYPOINT_SCORE).length /
    frame.keypoints.length
  )
}

/** Always evaluated — width/height are always known once VideoSource.status === 'ready'. */
function checkResolution(metadata: VideoMetadata): QualityCheckResult {
  const value = Math.min(metadata.width, metadata.height)
  const pass = value >= MIN_SHORT_SIDE_PX
  return {
    id: 'resolution',
    status: pass ? 'pass' : 'fail',
    value,
    threshold: MIN_SHORT_SIDE_PX,
    message: pass
      ? null
      : `Video resolution is too low (shortest side ${value}px, need at least ${MIN_SHORT_SIDE_PX}px) — pose detection may be unreliable.`,
  }
}

/** Skipped whenever frameRate is unknown — always true for uploads, per VideoMetadata's contract. */
function checkFrameRate(metadata: VideoMetadata): QualityCheckResult {
  if (metadata.frameRate == null) {
    return {
      id: 'frameRate',
      status: 'skipped',
      value: null,
      threshold: MIN_FRAME_RATE_FPS,
      message: null,
    }
  }
  const pass = metadata.frameRate >= MIN_FRAME_RATE_FPS
  return {
    id: 'frameRate',
    status: pass ? 'pass' : 'fail',
    value: metadata.frameRate,
    threshold: MIN_FRAME_RATE_FPS,
    message: pass
      ? null
      : `Frame rate is too low (${metadata.frameRate}fps, need at least ${MIN_FRAME_RATE_FPS}fps) — fast stride motion may be missed.`,
  }
}

/**
 * Per-sample resilient: one bad/errored sample degrades the average rather than
 * aborting the check. Restores the original playhead position when done.
 */
async function checkConfidence(
  video: HTMLVideoElement,
  metadata: VideoMetadata,
  detector: PoseDetector | null,
  sampleCount: number,
): Promise<QualityCheckResult> {
  if (!detector) {
    return {
      id: 'confidence',
      status: 'error',
      value: null,
      threshold: MIN_AVG_VISIBLE_FRACTION,
      message:
        'Could not run the detection-confidence sample; proceeding without it.',
    }
  }

  const originalTime = video.currentTime
  const timestamps = sampleTimestamps(metadata.durationSec, sampleCount)
  try {
    let total = 0
    for (const t of timestamps) {
      await seekTo(video, t)
      let frame: PoseFrame | null = null
      try {
        frame = await detector.estimatePose(video)
      } catch {
        // Treat as 0-visible, keep sampling — one bad frame shouldn't abort the check.
      }
      total += visibleFraction(frame)
    }
    const avg = total / timestamps.length
    const pass = avg >= MIN_AVG_VISIBLE_FRACTION
    return {
      id: 'confidence',
      status: pass ? 'pass' : 'fail',
      value: avg,
      threshold: MIN_AVG_VISIBLE_FRACTION,
      message: pass
        ? null
        : `Only ${Math.round(avg * 100)}% of body joints were reliably detected in a quick sample — check lighting and that the runner is fully visible in frame.`,
    }
  } finally {
    await seekTo(video, originalTime)
  }
}

export async function assessVideoQuality(params: {
  video: HTMLVideoElement
  metadata: VideoMetadata
  detector: PoseDetector | null
  sampleCount?: number
}): Promise<VideoQualityAssessment> {
  const {
    video,
    metadata,
    detector,
    sampleCount = DEFAULT_SAMPLE_COUNT,
  } = params

  const resolution = checkResolution(metadata)
  const frameRate = checkFrameRate(metadata)
  const confidence = await checkConfidence(
    video,
    metadata,
    detector,
    sampleCount,
  )

  const checks = { resolution, frameRate, confidence }
  const overall = Object.values(checks).some((c) => c.status === 'fail')
    ? 'warn'
    : 'pass'

  return { overall, checks }
}
