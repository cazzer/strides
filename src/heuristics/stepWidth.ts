import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
import { estimateHipWidth } from './bodyScale'
import { resolveBilateralPair, resolvePoint } from './keypoints'
import { detectFootstrikes } from './footstrikes'
import type { FootstrikeCandidate } from './footstrikes'
import { computeMetricConfidence } from './confidence'
import { median } from './mathUtils'

/**
 * Roughly one full gait cycle's worth of footstrikes (two per leg) — a judgment-call minimum for
 * a stable median step-width ratio, chosen for the same reason as overstriding's identical
 * minimum: fewer strikes than this is too easily dominated by a single noisy detection.
 */
const MIN_STEP_WIDTH_SAMPLE_SIZE = 4

const ANKLE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_ankle',
  right: 'right_ankle',
}

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  frameCoverage = 0,
): MetricResult {
  return {
    metric: 'stepWidth',
    value: null,
    unit: 'percent',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage,
    sampleSize: 0,
    caveat,
  }
}

/**
 * At each footstrike, the signed lateral offset of the ankle from the hip-midline, as a fraction
 * of hip width. Sign: POSITIVE = foot landed on its own anatomical side of the midline; NEGATIVE
 * = crossed to the opposite side (crossover gait). Polarity is resolved per-footstrike from that
 * frame's own-side hip position relative to hip-mid — NOT from a clip-wide travelDirection-style
 * constant (that solves a different, fore-aft problem) — because a raw, unflipped ankle.x -
 * hipMid.x combined across both legs cancels toward ~0 for any symmetric gait, destroying the
 * crossover signal this metric exists to report.
 *
 * Per-candidate hip-mid uses the STRICT bilateral primitive (`resolveBilateralPair`), not the
 * tolerant `resolveMidpoint` other heuristics use for center-of-mass proxies — same reasoning as
 * `estimateHipWidth` (see `bodyScale.ts`): an actual left/right separation IS the measured signal
 * here, so a frame where only one hip resolves is discarded rather than falling back to a
 * single-side stand-in. The tolerant fallback would silently collapse hipMid onto whichever hip
 * happened to resolve; when that's the candidate's OWN-side hip, `dx = ankle.x - hipMid.x`
 * degenerates to "ankle relative to its own hip" instead of "ankle relative to the body midline",
 * and the `outwardSign` guard below can't catch it because `sideHip` and `hipMid` become the same
 * point (see stepWidth.test.ts's regression case for the numeric proof).
 */
export function computeStepWidth(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.stepWidth[view]
  const hipWidth = estimateHipWidth(frames)
  if (hipWidth === null) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable hip-width reference (left/right hip) in this clip.',
    )
  }
  const { hipWidthPx } = hipWidth

  const candidates: FootstrikeCandidate[] = detectFootstrikes(frames, config)
  if (candidates.length === 0) {
    return nullResult(viewFitEntry.fit, 'No footstrikes could be detected in this clip.')
  }

  let interpolatedCount = 0
  const offsetRatios: number[] = []
  for (const candidate of candidates) {
    const frame = frames[candidate.frameIndex]
    const ankle = resolvePoint(frame, ANKLE_NAME[candidate.side])
    const hips = resolveBilateralPair(frame, 'left_hip', 'right_hip')
    if (ankle === null || hips === null) continue

    // resolveBilateralPair's return shape carries x/y only, no interpolated flag — it exists
    // purely as the strict both-sides-must-resolve gate above. Recover each side's interpolated
    // status directly; both calls are guaranteed non-null here since `hips` already resolved.
    const leftHip = resolvePoint(frame, 'left_hip')
    const rightHip = resolvePoint(frame, 'right_hip')
    if (leftHip === null || rightHip === null) continue // unreachable given `hips !== null`
    const hipMid = {
      x: (hips.left.x + hips.right.x) / 2,
      interpolated: leftHip.interpolated || rightHip.interpolated,
    }
    const sideHip = candidate.side === 'left' ? leftHip : rightHip

    const dx = ankle.x - hipMid.x
    // Guarded against a zero-sign product. Pre-fix, this defaulted to +1 on every frame where only
    // one hip resolved (hipMid collapsed onto sideHip, making `sideHip.x - hipMid.x` identically
    // 0) — the actual source of the sign-flip bug this file was fixed for, not a rare edge case.
    // Post-fix, that whole scenario is discarded above instead (`hips === null` when only one side
    // resolves), so this can only land on exactly 0 when BOTH hips independently resolve and
    // happen to share the same x. That's a narrow edge case, not a load-bearing branch: even this
    // codebase's own near-pure-side-view fixture keeps hip x's a few pixels apart rather than
    // literally equal (`SIDE_VIEW_BILATERAL_OFFSET_PX = 6` in syntheticGait.ts, chosen specifically
    // so bilateral resolution always has two distinct points), and any real clip whose true hip
    // spread is that small already has its confidence heavily discounted by this metric's
    // `unsuitable` view-fit tier regardless of which way this guard breaks the tie.
    const outwardSign = Math.sign(sideHip.x - hipMid.x) || 1
    offsetRatios.push((dx * outwardSign) / hipWidthPx)
    if (ankle.interpolated || hipMid.interpolated || sideHip.interpolated) {
      interpolatedCount += 1
    }
  }

  const usableStrikeCount = offsetRatios.length
  // Event-sampled metric, same convention as overstriding's frameCoverage: what fraction of
  // ankle-detected candidate footstrikes also had a resolvable hip position at that same instant.
  const frameCoverage = usableStrikeCount / candidates.length

  if (usableStrikeCount === 0) {
    return nullResult(
      viewFitEntry.fit,
      'Footstrikes were detected, but hip position was not resolvable at any of them.',
      frameCoverage,
    )
  }

  const interpolatedFraction = interpolatedCount / usableStrikeCount
  const value = median(offsetRatios)

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize: usableStrikeCount,
    minRequiredSampleSize: MIN_STEP_WIDTH_SAMPLE_SIZE,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveats: string[] = []
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Step width is a mediolateral measurement and is not reliable from a ${view} view.`,
    )
  }
  if (usableStrikeCount < MIN_STEP_WIDTH_SAMPLE_SIZE) {
    caveats.push(
      `Only ${usableStrikeCount} footstrike(s) detected (recommend at least ${MIN_STEP_WIDTH_SAMPLE_SIZE}) — confidence reduced accordingly.`,
    )
  }
  if (value < 0) {
    caveats.push(
      "This clip's footstrikes tend to cross the body's midline (crossover gait) rather than landing on their own side. Based on this one clip's footstrikes, not a diagnosis.",
    )
  }

  return {
    metric: 'stepWidth',
    value,
    unit: 'percent',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize: usableStrikeCount,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
  }
}
