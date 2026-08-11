import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type {
  HeuristicsConfig,
  MetricResult,
  TimeseriesPoint,
  VerticalOscillationResult,
  View,
} from './types'
import { estimateBodyScale } from './bodyScale'
import { resolveMidpoint } from './keypoints'
import { findLocalExtrema } from './extrema'
import { computeMetricConfidence } from './confidence'
import { median } from './mathUtils'

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  series: TimeseriesPoint[] = [],
): VerticalOscillationResult {
  return {
    metric: 'verticalOscillation',
    value: null,
    unit: 'ratio',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat,
    series,
  }
}

/**
 * Vertical oscillation: how much the pelvis (center-of-mass proxy) bounces up and down per
 * stride, as a fraction of torso length. View-tolerant by design — unlike trunk lean and
 * overstriding, vertical bounce projects onto image-y similarly regardless of which way the
 * runner is facing the camera, as long as the camera itself is level (an explicit out-of-scope
 * assumption: no roll correction here). `viewFitTable.verticalOscillation` still applies a
 * conservative discount for front view (0.85) to account for pelvic-drop noise that's more
 * visible face-on than from the side — a documented judgment call, not a measured effect.
 */
export function computeVerticalOscillation(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): VerticalOscillationResult {
  const viewFitEntry = config.viewFitTable.verticalOscillation[view]
  const bodyScale = estimateBodyScale(frames)

  if (bodyScale === null) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable body-scale reference (shoulders/hips) in this clip.',
    )
  }

  const { torsoLengthPx } = bodyScale

  let interpolatedCount = 0
  let resolvedCount = 0
  let hipYSum = 0
  // One entry per frame — `null` where the hip wasn't resolvable that frame, preserving
  // timestamp alignment with `frames` regardless of resolvability (unlike the extrema-detection
  // series below, which only needs a value/timestamp pair for resolvable samples).
  const rawHipY: Array<number | null> = frames.map((frame) => {
    const hipMid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    if (hipMid === null) return null
    resolvedCount += 1
    if (hipMid.interpolated) interpolatedCount += 1
    hipYSum += hipMid.y
    return hipMid.y
  })

  if (resolvedCount === 0) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable hip position in this clip.',
      frames.map((frame) => ({ timestamp: frame.timestamp, value: null })),
    )
  }

  const frameCoverage = resolvedCount / frames.length
  const interpolatedFraction = interpolatedCount / resolvedCount

  // The run mean is the charting baseline, not a physical quantity — it just centers the
  // waveform around 0 so the chart reads as "bounce above/below typical", independent of where
  // in the frame the runner happened to be positioned.
  const runMeanHipY = hipYSum / resolvedCount
  const series: TimeseriesPoint[] = frames.map((frame, i) => {
    const y = rawHipY[i]
    return {
      timestamp: frame.timestamp,
      // Sign-flipped: image-y grows downward, so a smaller y (higher on screen) should read as
      // a positive bounce.
      value: y === null ? null : (runMeanHipY - y) / torsoLengthPx,
    }
  })

  const minProminenceAbs = config.verticalOscillationMinProminenceRatio * torsoLengthPx
  const extremaSeries = frames.map((frame, i) => {
    const y = rawHipY[i]
    return y === null ? null : { t: frame.timestamp, v: y }
  })
  const extrema = findLocalExtrema(extremaSeries, minProminenceAbs)

  // Pair consecutive opposite-sign extrema into half-cycle amplitudes. findLocalExtrema already
  // guarantees strict alternation within one contiguous run, but two separate runs on either side
  // of an unrecoverable gap could both end/start on the same kind — skip rather than pair two
  // same-kind extrema into a fabricated "amplitude".
  const amplitudes: number[] = []
  for (let i = 1; i < extrema.length; i += 1) {
    if (extrema[i].kind === extrema[i - 1].kind) continue
    amplitudes.push(Math.abs(extrema[i].value - extrema[i - 1].value))
  }

  const sampleSize = amplitudes.length
  if (sampleSize === 0) {
    // Zero detected half-cycles (e.g. a motionless or perfectly flat hip trace) is treated as
    // "no computable input" for this metric specifically, distinct from but adjacent to "no
    // resolvable input at all": there is no principled amplitude to report, and reporting 0 would
    // misleadingly claim "measured zero bounce" rather than "couldn't measure a bounce at all".
    return nullResult(
      viewFitEntry.fit,
      'Hip position was tracked, but no complete vertical-oscillation cycle was detected.',
      series,
    )
  }

  const value = median(amplitudes) / torsoLengthPx

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize,
    minRequiredSampleSize: config.verticalOscillationMinCycles,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveat =
    sampleSize < config.verticalOscillationMinCycles
      ? `Only ${sampleSize} half-cycle(s) detected (recommend at least ${config.verticalOscillationMinCycles}) — confidence reduced accordingly.`
      : null

  return {
    metric: 'verticalOscillation',
    value,
    unit: 'ratio',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize,
    caveat,
    series,
  }
}
