import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricExemplar, MetricResult, View } from './types'
import { estimateBodyScale } from './bodyScale'
import { estimateTravelDirection } from './travelDirection'
import { resolveMidpoint, resolvePoint } from './keypoints'
import { detectFootstrikes } from './footstrikes'
import type { FootstrikeCandidate } from './footstrikes'
import { computeMetricConfidence } from './confidence'
import {
  attachPairAlternates,
  cropKeypoints,
  describeDistribution,
  selectExemplars,
  selectExtremePairs,
} from './exemplars'
import type { ExemplarDistribution } from './exemplars'
import { median } from './mathUtils'

/**
 * Roughly one full gait cycle's worth of footstrikes (two per leg) — a judgment-call minimum for
 * a stable median overstride ratio, chosen for the same reason as `verticalOscillationMinCycles`:
 * fewer strikes than this is too easily dominated by a single noisy detection.
 */
const MIN_OVERSTRIDE_SAMPLE_SIZE = 4

const ANKLE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_ankle',
  right: 'right_ankle',
}

/** Exemplar crop context only — this metric never reads knee position. A hip-to-ankle box with no
 * knee in it reads as an empty diagonal. */
const KNEE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_knee',
  right: 'right_knee',
}

interface StrikeSample {
  frame: RobustPoseFrame
  side: 'left' | 'right'
  ratio: number
}

/** The points the metric itself reads at a strike: the striking foot, against the hip midline. */
function seedFor(sample: StrikeSample): KeypointName[] {
  return [ANKLE_NAME[sample.side], 'left_hip', 'right_hip']
}

/**
 * The most- and least-overstriding strike, ghosted into one image — an EXTREME pair, because what
 * this metric's picture is about is the range of foot placements it measured, not their median.
 * Both instants must survive the outlier bound first, so the ghost can never be two tracking
 * glitches; among the survivors `selectExtremePairs` RANKS by the quality each strike would be
 * emitted with, rather than taking the raw argmax and scoring it afterwards.
 *
 * It returns the pairs it BEAT as well as the winner, and they ride along as the emitted
 * exemplar's `alternates`. Whether a pair can be drawn as one legible image depends on pixel
 * geometry and display constants this layer does not hold, so the runners-up are what stop one
 * un-drawable pair from taking the whole metric's evidence with it.
 */
function buildExemplars(
  samples: StrikeSample[],
  distribution: ExemplarDistribution,
): MetricExemplar[] {
  const pairs = selectExtremePairs(
    samples,
    (sample) => ({
      frame: sample.frame,
      seed: seedFor(sample),
      value: sample.ratio,
    }),
    distribution,
  )

  // Base is the more extreme of the two — a range ghost is about its far end (see trunkLean's
  // identical reasoning).
  return attachPairAlternates(
    pairs.map(({ base, ghost, quality }) => ({
      kind: 'overstrideRange' as const,
      timestamp: base.frame.timestamp,
      pairedTimestamp: ghost.frame.timestamp,
      // Only meaningful when the two strikes happen to be the same foot; the pair is not
      // constructed to be same-side, so most of the time there is no one side to name. Derived
      // PER PAIR rather than once: two alternatives of the same exemplar can fall differently,
      // and a `side` copied from the winner would claim a foot the picture does not show.
      ...(base.side === ghost.side && { side: base.side }),
      // Which foot each half of the picture was measured from, emitted unconditionally because
      // this metric always knows it — unlike `side` above, whose presence is a property of how the
      // pair happened to fall. Without it a mixed-foot pair (the usual case) reaches the evidence
      // layer with no way to tell which ankle the offset was taken from.
      measuredSide: base.side,
      pairedMeasuredSide: ghost.side,
      quality,
      label: 'Furthest-reaching footstrike, ghosted against the closest-landing one',
      cropKeypoints: cropKeypoints(
        [...seedFor(base), ...seedFor(ghost)],
        [KNEE_NAME[base.side], KNEE_NAME[ghost.side]],
        [base.frame, ghost.frame],
      ),
    })),
  )
}

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  frameCoverage = 0,
): MetricResult {
  return {
    metric: 'overstriding',
    value: null,
    unit: 'ratio',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage,
    sampleSize: 0,
    caveat,
  }
}

/**
 * Overstriding: at each footstrike, how far ahead of the hip (in the direction of travel) the
 * foot lands, as a fraction of torso length. Positive = foot lands ahead of the hip.
 * Hard-gated to side view, for the same reasoning as trunk lean but with a worse failure mode:
 * front-view ankle-x-offset reflects mediolateral foot placement, not fore-aft reach, and could
 * coincidentally look like a "good" (small) number rather than an obviously-wrong one.
 */
export function computeOverstriding(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.overstriding[view]
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
  const overstrideRatios: number[] = []
  // Index-parallel to `overstrideRatios` — and only to it, never to `candidates`, which still
  // holds the strikes skipped below. Recovering a ratio's strike as `candidates[i]` would be off
  // by however many strikes had no resolvable hip.
  const strikeSamples: StrikeSample[] = []
  for (const candidate of candidates) {
    const frame = frames[candidate.frameIndex]
    const ankle = resolvePoint(frame, ANKLE_NAME[candidate.side])
    const hipMid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    if (ankle === null || hipMid === null) continue

    const dx = ankle.x - hipMid.x
    const horizontalOffsetPx = travelDirectionKnown ? dx * travelDirection : dx
    const ratio = horizontalOffsetPx / torsoLengthPx
    overstrideRatios.push(ratio)
    strikeSamples.push({ frame, side: candidate.side, ratio })
    if (ankle.interpolated || hipMid.interpolated) interpolatedCount += 1
  }

  const usableStrikeCount = overstrideRatios.length
  // Event-sampled metric: "coverage" here means what fraction of ankle-detected candidate
  // footstrikes also had a resolvable hip position at that same instant — not the per-frame ratio
  // the other heuristics use. There's no meaningful "fraction of all frames" for a measure that
  // only exists at discrete footstrike events.
  const frameCoverage = usableStrikeCount / candidateStrikeCount

  if (usableStrikeCount === 0) {
    return nullResult(
      viewFitEntry.fit,
      'Footstrikes were detected, but hip position was not resolvable at any of them.',
      frameCoverage,
    )
  }

  const interpolatedFraction = interpolatedCount / usableStrikeCount
  const value = median(overstrideRatios)

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize: usableStrikeCount,
    minRequiredSampleSize: MIN_OVERSTRIDE_SAMPLE_SIZE,
    travelDirectionKnown,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveats: string[] = []
  if (!travelDirectionKnown) {
    caveats.push(
      'Direction of travel could not be determined (no net horizontal displacement) — overstride sign may not reflect forward/backward.',
    )
  }
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Overstriding is a fore-aft measurement and is not reliable from a ${view} view.`,
    )
  }
  if (usableStrikeCount < MIN_OVERSTRIDE_SAMPLE_SIZE) {
    caveats.push(
      `Only ${usableStrikeCount} footstrike(s) detected (recommend at least ${MIN_OVERSTRIDE_SAMPLE_SIZE}) — confidence reduced accordingly.`,
    )
  }

  const exemplars = selectExemplars(
    buildExemplars(strikeSamples, describeDistribution(overstrideRatios)),
  )

  return {
    metric: 'overstriding',
    value,
    unit: 'ratio',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize: usableStrikeCount,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
    ...(exemplars && { exemplars }),
  }
}
