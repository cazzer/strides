import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
import { estimateBodyScale } from './bodyScale'
import { resolvePoint } from './keypoints'
import { detectFootstrikes } from './footstrikes'
import { computeMetricConfidence } from './confidence'

/**
 * Roughly one full gait cycle's worth of footstrikes (two per leg) — the same judgment-call
 * minimum, and the same reasoning, as overstriding's `MIN_OVERSTRIDE_SAMPLE_SIZE`: fewer strikes
 * than this is too easily dominated by one missed or spurious detection. Cadence is arguably even
 * more sensitive to this than overstriding's median, since a single missed footstrike doesn't get
 * averaged away — it directly lowers the countable numerator.
 */
const MIN_CADENCE_SAMPLE_SIZE = 4

const ANKLE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_ankle',
  right: 'right_ankle',
}

function nullResult(viewFit: MetricResult['viewFit'], caveat: string): MetricResult {
  return {
    metric: 'cadence',
    value: null,
    unit: 'stepsPerMinute',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat,
  }
}

/**
 * Cadence: footstrikes per minute, both legs combined — `detectFootstrikes(frames, config).length
 * / (clip duration in minutes)`. Real-time playback is assumed: `RobustPoseFrame.timestamp` is
 * `video.currentTime`, a media-time value independent of however fast frames were sampled or the
 * clip is played back, so this holds regardless of playback rate — no separate time-signature
 * handling needed.
 *
 * View-tolerant, like vertical oscillation, not hard-gated like trunk lean/overstriding — see
 * design.md and this metric's `viewFitTable.cadence` entry in types.ts for the full reasoning.
 *
 * Clip duration is `frames[frames.length - 1].timestamp - frames[0].timestamp`, not just the last
 * frame's timestamp: the two coincide whenever sampling starts at t=0 (the common case), but
 * computing the true span is no more expensive and stays correct if that assumption ever doesn't
 * hold (e.g. a future caller trimming a leading segment before this runs).
 */
export function computeCadence(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.cadence[view]
  const bodyScale = estimateBodyScale(frames)

  if (bodyScale === null) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable body-scale reference (shoulders/hips) in this clip.',
    )
  }

  const candidates = detectFootstrikes(frames, config)
  const strikeCount = candidates.length

  if (strikeCount === 0) {
    return nullResult(viewFitEntry.fit, 'No footstrikes could be detected in this clip.')
  }

  const durationMinutes =
    (frames[frames.length - 1].timestamp - frames[0].timestamp) / 60

  if (durationMinutes <= 0) {
    return nullResult(
      viewFitEntry.fit,
      'Clip duration could not be determined (frames span no measurable elapsed time).',
    )
  }

  // Cadence doesn't resolve any additional keypoint beyond what footstrike detection already
  // used (there's no hip/torso lookup the way overstriding needs, since cadence only cares about
  // *when* a strike happened, not *where*) — so "how much of this was interpolated" is read
  // straight off the ankle point at each candidate's frame/side, the same per-candidate lookup
  // overstriding does for its own purpose, not a re-run of extrema detection.
  let interpolatedCount = 0
  for (const candidate of candidates) {
    const ankle = resolvePoint(frames[candidate.frameIndex], ANKLE_NAME[candidate.side])
    if (ankle?.interpolated) interpolatedCount += 1
  }
  const interpolatedFraction = interpolatedCount / strikeCount

  // Event-sampled, like overstriding's frameCoverage, but cadence has no per-candidate resolution
  // step that can itself fail (no hip lookup) — every detected candidate contributes directly to
  // the count. Coverage instead falls back to how much of the clip could be tracked at all
  // (`bodyScale.sampleCoverage`): a clip with long untracked stretches could easily have missed
  // footstrikes during those gaps without candidates or duration reflecting that, so it's a
  // meaningful independent confidence signal here rather than a redundant one.
  const frameCoverage = bodyScale.sampleCoverage
  const value = strikeCount / durationMinutes

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize: strikeCount,
    minRequiredSampleSize: MIN_CADENCE_SAMPLE_SIZE,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveat =
    strikeCount < MIN_CADENCE_SAMPLE_SIZE
      ? `Only ${strikeCount} footstrike(s) detected (recommend at least ${MIN_CADENCE_SAMPLE_SIZE}) — confidence reduced accordingly.`
      : null

  return {
    metric: 'cadence',
    value,
    unit: 'stepsPerMinute',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize: strikeCount,
    caveat,
  }
}
