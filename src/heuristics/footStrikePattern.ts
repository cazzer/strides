import type { KeypointName } from '../pose/types'
import { viewPhrase } from './viewDetection'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricExemplar, MetricResult, View } from './types'
import { estimateBodyScale } from './bodyScale'
import { estimateTravelDirection } from './travelDirection'
import { resolvePoint } from './keypoints'
import { detectFootstrikes } from './footstrikes'
import type { FootstrikeCandidate } from './footstrikes'
import { computeMetricConfidence } from './confidence'
import {
  cropKeypoints,
  describeDistribution,
  scoreExemplarInstant,
  selectExemplars,
} from './exemplars'
import type { ExemplarDistribution } from './exemplars'
import { median } from './mathUtils'

/**
 * Roughly one full gait cycle's worth of footstrikes (two per leg) — same value and reasoning as
 * `overstriding.ts`'s `MIN_OVERSTRIDE_SAMPLE_SIZE`: fewer strikes than this is too easily
 * dominated by a single noisy detection.
 */
const MIN_FOOT_STRIKE_SAMPLE_SIZE = 4

const ANKLE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_ankle',
  right: 'right_ankle',
}

const KNEE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_knee',
  right: 'right_knee',
}

/** Exemplar crop context only — a foot-strike picture that omits the foot is useless. These four
 * are MediaPipe-only names, so they resolve to nothing on MoveNet and are simply dropped there;
 * the crop stays well-defined from the ankle/knee seed alone. */
const FOOT_NAMES: Record<'left' | 'right', KeypointName[]> = {
  left: ['left_heel', 'left_foot_index'],
  right: ['right_heel', 'right_foot_index'],
}

export type FootStrikeClass = 'heel' | 'midfoot' | 'forefoot'

/**
 * THIS IS A PROXY, NOT A FOOT-ANGLE MEASUREMENT. This pipeline has no toe/foot keypoint and no
 * ground-plane calibration anywhere (the 12-keypoint set from #3 stops at the ankle — the exact
 * gap `overstriding.ts`'s footstrike-detection doc already documents). A real strike-pattern
 * classification would need to see the foot's angle relative to the ground at the instant of
 * contact; nothing in this pipeline can see that. What it computes instead is a coarse,
 * documented stand-in: how far the ankle sits ahead of (or behind) the knee, horizontally, in the
 * direction of travel, at the moment of footstrike, normalized by torso length. This is EVERY
 * `footStrikePattern` result's caveat, unconditionally — including the cleanest, highest-
 * confidence one — never just a degraded-case fallback message. See design.md for the exact
 * thresholds and the reasoning behind them.
 */
const PROXY_CAVEAT =
  'Foot strike pattern is an approximation based on ankle position relative to the knee at footstrike, not a direct measurement of foot-ground angle. Treat the heel/midfoot/forefoot label as a rough indicator, not a clinical classification.'

/**
 * Maps a signed ankle-relative-to-knee offset ratio (positive = ankle ahead of the knee in the
 * direction of travel) to a heel/midfoot/forefoot label via a symmetric band around zero. Exported
 * so presentation code (the results view) can turn `MetricResult.value` back into the same label
 * this module used internally, without duplicating the threshold logic. See design.md for why the
 * band is symmetric and why `footStrikeMidfootBandRatio` defaults to `0.05`.
 */
export function classifyFootStrike(ratio: number, midfootBandRatio: number): FootStrikeClass {
  if (ratio > midfootBandRatio) return 'heel'
  if (ratio < -midfootBandRatio) return 'forefoot'
  return 'midfoot'
}

interface StrikeSample {
  frame: RobustPoseFrame
  side: 'left' | 'right'
  ratio: number
}

/**
 * Up to two SINGLE-instant exemplars — the strikes nearest the reported median, ranked. Single is
 * correct, not a degraded pair: this metric only exists at the moment of strike, so there is no
 * honest second instant to ghost against, and the exemplar simply carries no `pairedTimestamp`
 * rather than a null one that would read as a missing half. Two singles is how this metric spends
 * its two-exemplar budget.
 */
function buildExemplars(
  samples: StrikeSample[],
  distribution: ExemplarDistribution,
  midfootBandRatio: number,
): MetricExemplar[] {
  const exemplars: MetricExemplar[] = []
  for (const sample of samples) {
    const seed = [ANKLE_NAME[sample.side], KNEE_NAME[sample.side]]
    const quality = scoreExemplarInstant(
      { frame: sample.frame, seed, value: sample.ratio },
      'representative',
      distribution,
    )
    if (quality === null) continue

    exemplars.push({
      kind: 'footStrike',
      timestamp: sample.frame.timestamp,
      side: sample.side,
      quality,
      label: `${classifyFootStrike(sample.ratio, midfootBandRatio)}-like footstrike, ${sample.side} foot`,
      cropKeypoints: cropKeypoints(seed, FOOT_NAMES[sample.side], [sample.frame]),
    })
  }
  return exemplars
}

function nullResult(
  viewFit: MetricResult['viewFit'],
  reason: string,
  frameCoverage = 0,
): MetricResult {
  return {
    metric: 'footStrikePattern',
    value: null,
    unit: 'ratio',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage,
    sampleSize: 0,
    caveat: `${PROXY_CAVEAT} ${reason}`,
  }
}

/**
 * Foot strike pattern (heel / midfoot / forefoot), reported as a signed ankle-relative-to-knee
 * offset ratio: at each footstrike (reusing `detectFootstrikes`, shared with overstriding and
 * cadence), how far the ankle sits ahead of the same-side knee, horizontally, in the direction of
 * travel, as a fraction of torso length. Positive = ankle notably ahead of the knee (heel-strike-
 * like); near zero = ankle roughly under the knee (midfoot-like); negative = ankle behind the knee
 * (forefoot-like). `classifyFootStrike` turns that continuous ratio into the three-way label.
 *
 * Deliberately uses the KNEE as the reference point, not the hip (which `overstriding.ts` already
 * uses for a related but distinct "braking risk" measurement) — see design.md for why a shank-
 * angle-style ankle-knee relationship is a closer proxy for foot-strike geometry than an ankle-hip
 * one, and the noise trade-off that choice accepts.
 *
 * Hard-gated to side view, for the same reasoning as overstriding and trunk lean, with the same
 * worse-than-noisier failure mode: front-view ankle-x-relative-to-knee reflects mediolateral foot
 * placement, not fore-aft shank angle, and could coincidentally look like a confident "midfoot"
 * reading rather than an obviously-wrong one.
 *
 * `caveat` is ALWAYS non-null on every returned result, including the cleanest, highest-confidence
 * one — this is the one metric in this package where that's true by design, not just for
 * degraded/low-confidence cases. See `PROXY_CAVEAT` above.
 */
export function computeFootStrikePattern(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.footStrikePattern[view]
  const bodyScale = estimateBodyScale(frames)

  if (bodyScale === null) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable body-scale reference (shoulders/hips) in this clip.',
    )
  }

  const { torsoLengthPx } = bodyScale
  const travelDirection = estimateTravelDirection(frames, bodyScale)
  const travelDirectionKnown = travelDirection !== 0

  const candidates: FootstrikeCandidate[] = detectFootstrikes(frames, config)

  const candidateStrikeCount = candidates.length
  if (candidateStrikeCount === 0) {
    return nullResult(viewFitEntry.fit, 'No footstrikes could be detected in this clip.')
  }

  let interpolatedCount = 0
  const offsetRatios: number[] = []
  // Index-parallel to `offsetRatios`, not to `candidates` — the `continue` above skips strikes.
  const strikeSamples: StrikeSample[] = []
  for (const candidate of candidates) {
    // A strike whose two ankle labels have collapsed onto one point measures nothing about where
    // the foot landed. Same bucket as the `continue` below — an ankle that failed to resolve while
    // presenting as resolved — so it is skipped and stays in `frameCoverage`'s denominator. The
    // predicate, and why such a strike is annotated rather than dropped, are in `footstrikes.ts`.
    if (!candidate.ankleMeasurable) continue

    const frame = frames[candidate.frameIndex]
    const ankle = resolvePoint(frame, ANKLE_NAME[candidate.side])
    const knee = resolvePoint(frame, KNEE_NAME[candidate.side])
    if (ankle === null || knee === null) continue

    const dx = ankle.x - knee.x
    const horizontalOffsetPx = travelDirectionKnown ? dx * travelDirection : dx
    const ratio = horizontalOffsetPx / torsoLengthPx
    offsetRatios.push(ratio)
    strikeSamples.push({ frame, side: candidate.side, ratio })
    if (ankle.interpolated || knee.interpolated) interpolatedCount += 1
  }

  const usableStrikeCount = offsetRatios.length
  // Event-sampled metric, same convention as overstriding: "coverage" is what fraction of
  // ankle-detected candidate footstrikes also had a resolvable same-side knee position at that
  // same instant, not a per-frame ratio.
  const frameCoverage = usableStrikeCount / candidateStrikeCount

  if (usableStrikeCount === 0) {
    return nullResult(
      viewFitEntry.fit,
      'Footstrikes were detected, but knee position was not resolvable at any of them.',
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
    minRequiredSampleSize: MIN_FOOT_STRIKE_SAMPLE_SIZE,
    travelDirectionKnown,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  // Seeded with the mandatory proxy disclaimer, unconditionally — this is what makes `caveat`
  // non-null even on an otherwise-clean, high-confidence result. Every other branch below only
  // ever appends to it, never replaces it.
  const caveats: string[] = [PROXY_CAVEAT]
  if (!travelDirectionKnown) {
    caveats.push(
      'Direction of travel could not be determined (no net horizontal displacement) — the heel/forefoot sign may not reflect forward/backward.',
    )
  }
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Foot strike pattern is a fore-aft measurement and is not reliable from ${viewPhrase(view)}.`,
    )
  }
  if (usableStrikeCount < MIN_FOOT_STRIKE_SAMPLE_SIZE) {
    caveats.push(
      `Only ${usableStrikeCount} footstrike(s) detected (recommend at least ${MIN_FOOT_STRIKE_SAMPLE_SIZE}) — confidence reduced accordingly.`,
    )
  }

  const exemplars = selectExemplars(
    buildExemplars(
      strikeSamples,
      describeDistribution(offsetRatios),
      config.footStrikeMidfootBandRatio,
    ),
  )

  return {
    metric: 'footStrikePattern',
    value,
    unit: 'ratio',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize: usableStrikeCount,
    caveat: caveats.join(' '),
    ...(exemplars && { exemplars }),
  }
}
