import type { RobustPoseFrame } from '../pose/robustness/types'
import { viewPhrase } from './viewDetection'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
import { estimateHipWidth } from './bodyScale'
import { resolveBilateralPair, resolvePoint } from './keypoints'
import { detectFootstrikes } from './footstrikes'
import type { FootstrikeCandidate } from './footstrikes'
import { computeMetricConfidence } from './confidence'
import { describeDistribution, selectExemplars } from './exemplars'
import {
  STEP_WIDTH_ANKLE_NAME,
  buildStepWidthExemplars,
} from './stepWidthExemplars'
import type { StepWidthStrikeSample } from './stepWidthExemplars'
import { median } from './mathUtils'

/**
 * How many footstrikes a median over per-strike ratios needs before one contaminated strike stops
 * deciding it. **Half derived, half judgment, and the two halves are kept apart on purpose.**
 *
 * ## The derived half: `n >= 2k + 3`
 *
 * Take `n` samples of which `k` are contaminants, all biased the same way — which is the shape
 * contamination actually takes here, since both known mechanisms (a boundary strike, a
 * tracker-dropout window) inflate the offset rather than scattering it. Those `k` then occupy the
 * top `k` ranks, so the median is untouched by them exactly when the middle of the sorted array
 * still lies strictly inside the clean subsample's interior:
 *
 * ```
 * odd  n:  (n + 1) / 2  <  n − k    ->   n >= 2k + 2
 * even n:  n / 2 + 1    <  n − k    ->   n >= 2k + 3
 * ```
 *
 * The even case binds, so the requirement is `n >= 2k + 3`: `k = 1` needs 5, `k = 2` needs 7.
 *
 * **The previous value of 4 fails its own docstring.** It claimed to be the point where a *single*
 * noisy detection stops dominating, and at `n = 4, k = 1` the median is
 * `mean(rank2, rank3) = mean(clean median, clean MAX)` — half of the reported number IS the worst
 * clean sample, with the contaminant merely pushed off the top. Four is dominated by one bad
 * strike. That was a correctness defect on its own terms, independent of any clip.
 *
 * ## The judgment half: `k = 2`
 *
 * Nothing derives `k`. It is chosen at 2 on two grounds, both from this repo's own corpus:
 * TWO independent contamination mechanisms are documented on it — footstrikes at the analysed
 * series' boundaries (`strides-aah`, now excluded in `detectFootstrikes`) and detector-dropout
 * windows where surviving detections collapse both ankles onto one point (`strides-boc`, NOT fixed
 * and not fixable at this layer) — and the one clip whose per-strike ratios have actually been
 * measured carried exactly `k = 2` of `n = 5`.
 *
 * ## What this does and does not buy, measured
 *
 * Demo 2's scale pass reads `n = 4` AFTER the boundary exclusion, so it is a live instance of
 * precisely the `n = 4, k = 1` failure above: `median = mean(0.16306, 0.40424) = 0.28365`, with the
 * clean maximum contributing half. This minimum does not repair that median — nothing at this layer
 * can — it prices it, at `4/7` of whatever the other confidence factors allow, and says so in the
 * caveat.
 *
 * Below the minimum the metric is DISCOUNTED, never withheld: `min(1, n / 7)` in
 * `computeMetricConfidence` plus the caveat below, never a `null`. The four sibling
 * `MIN_*_SAMPLE_SIZE` constants (`stepWidthCm`, `footStrikePattern`, `kneeFlexion`, `overstriding`)
 * are deliberately NOT moved with this one — the same arithmetic applies to each, but each has its
 * own estimator and its own blast radius, and sweeping them is a separate decision.
 */
const MIN_STEP_WIDTH_SAMPLE_SIZE = 7

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
  // Index-parallel to `offsetRatios`, not to `candidates` — the `continue`s below skip strikes.
  const strikeSamples: StepWidthStrikeSample[] = []
  for (const candidate of candidates) {
    const frame = frames[candidate.frameIndex]
    const ankle = resolvePoint(frame, STEP_WIDTH_ANKLE_NAME[candidate.side])
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
    const rawOutwardSign = Math.sign(sideHip.x - hipMid.x)
    const outwardSign = rawOutwardSign || 1
    const ratio = (dx * outwardSign) / hipWidthPx
    offsetRatios.push(ratio)
    strikeSamples.push({
      frame,
      side: candidate.side,
      value: ratio,
      degenerate: rawOutwardSign === 0,
    })
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
      `Step width is a mediolateral measurement and is not reliable from ${viewPhrase(view)}.`,
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

  const exemplars = selectExemplars(
    buildStepWidthExemplars(strikeSamples, describeDistribution(offsetRatios)),
  )

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
    ...(exemplars && { exemplars }),
  }
}
