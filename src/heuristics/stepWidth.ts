import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricExemplar, MetricResult, View } from './types'
import { estimateHipWidth } from './bodyScale'
import { resolveBilateralPair, resolvePoint } from './keypoints'
import { detectFootstrikes } from './footstrikes'
import type { FootstrikeCandidate } from './footstrikes'
import { computeMetricConfidence } from './confidence'
import {
  cropDerivable,
  cropKeypoints,
  describeDistribution,
  pairQuality,
  scoreExemplarInstant,
  selectExemplars,
  selectOppositeSidePair,
} from './exemplars'
import type { ExemplarDistribution } from './exemplars'
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

interface StrikeSample {
  frame: RobustPoseFrame
  side: 'left' | 'right'
  value: number
  /** The `outwardSign` guard below fell through to its `|| 1` fallback at this strike, inventing a
   * polarity. Fine for a median over many strikes; not something to put a picture under. */
  degenerate: boolean
}

/** The points the metric itself reads at a strike: the striking foot, against the hip midline. */
function seedFor(sample: StrikeSample): KeypointName[] {
  return [ANKLE_NAME[sample.side], 'left_hip', 'right_hip']
}

/**
 * One ghosted pair of OPPOSITE-foot plants, or a single strike when the clip never puts two
 * opposite plants next to each other.
 *
 * The pair is CONSTRUCTED, not read off: this metric measures each strike independently against
 * the hip midline, and `detectFootstrikes` merges both legs into one timestamp-ordered list whose
 * consecutive entries need not alternate. A ghost of two opposite feet at their respective plants
 * is exactly what "step width" means, which is why it is worth building — see
 * `selectOppositeSidePair`.
 *
 * Strikes whose outward polarity was invented by the `|| 1` fallback are gated out here rather
 * than ranked: a picture captioned "landed on its own side" has to be of a strike where which
 * side that was is actually known.
 */
function buildExemplars(
  samples: StrikeSample[],
  distribution: ExemplarDistribution,
): MetricExemplar[] {
  const eligible = samples.filter(
    (sample) => !sample.degenerate && cropDerivable(sample.frame, seedFor(sample)),
  )
  const instant = (sample: StrikeSample) => ({
    frame: sample.frame,
    seed: seedFor(sample),
    value: sample.value,
  })

  const pair = selectOppositeSidePair(eligible, distribution)
  if (pair !== null) {
    const [first, second] = pair
    const firstQuality = scoreExemplarInstant(instant(first), 'representative', distribution)
    const secondQuality = scoreExemplarInstant(instant(second), 'representative', distribution)
    if (firstQuality !== null && secondQuality !== null) {
      // Base is whichever plant sits closer to the reported median — the one the number is most
      // directly about; the other is the ghost that turns it into a width.
      const base =
        Math.abs(first.value - distribution.median) <=
        Math.abs(second.value - distribution.median)
          ? first
          : second
      const ghost = base === first ? second : first
      return [
        {
          kind: 'stepWidthStrike',
          timestamp: base.frame.timestamp,
          pairedTimestamp: ghost.frame.timestamp,
          // No `side`: the two instants are deliberately opposite feet, so naming one would be
          // wrong about the other. Each instant names its OWN foot instead — which is exactly the
          // fact a per-instant consumer needs and the one `side` structurally cannot carry here.
          measuredSide: base.side,
          pairedMeasuredSide: ghost.side,
          quality: pairQuality(firstQuality, secondQuality),
          label: 'Opposite-foot plants either side of the hip midline',
          cropKeypoints: cropKeypoints(
            [...seedFor(base), ...seedFor(ghost)],
            [],
            [base.frame, ghost.frame],
          ),
        },
      ]
    }
  }

  // Demoted: one strike against the hip midline is one whole measurement, so a single frame is
  // still honest here — unlike the range metrics, which have nothing to say from one instant.
  const singles: MetricExemplar[] = []
  for (const sample of eligible) {
    const quality = scoreExemplarInstant(instant(sample), 'representative', distribution)
    if (quality === null) continue
    singles.push({
      kind: 'stepWidthStrike',
      timestamp: sample.frame.timestamp,
      side: sample.side,
      quality,
      label: `Footstrike measured against the hip midline (${sample.side} foot)`,
      cropKeypoints: cropKeypoints(
        seedFor(sample),
        [ANKLE_NAME[sample.side === 'left' ? 'right' : 'left']],
        [sample.frame],
      ),
    })
  }
  singles.sort((a, b) => b.quality - a.quality)
  return singles.slice(0, 1)
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
  // Index-parallel to `offsetRatios`, not to `candidates` — the `continue`s below skip strikes.
  const strikeSamples: StrikeSample[] = []
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

  const exemplars = selectExemplars(
    buildExemplars(strikeSamples, describeDistribution(offsetRatios)),
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
