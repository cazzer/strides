import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricExemplar, MetricResult, View } from './types'
import { estimateBodyScale } from './bodyScale'
import { estimateTravelDirection } from './travelDirection'
import { resolveMidpoint } from './keypoints'
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
 * A judgment-call minimum frame count for a stable median lean estimate — analogous in spirit to
 * `verticalOscillationMinCycles`, but scoped to its own constant because trunk lean's sample unit
 * is resolvable frames, not complete gait cycles, so the two aren't the same quantity. Not derived
 * from real footage; cheaply tunable here if it turns out to be wrong.
 */
const MIN_TRUNK_LEAN_SAMPLE_SIZE = 10

/** The points the metric itself reads at an instant — a torso is exactly this segment. */
const EXEMPLAR_SEED_KEYPOINTS: KeypointName[] = [
  'left_shoulder',
  'right_shoulder',
  'left_hip',
  'right_hip',
]
/** The head is how a viewer reads "upright"; a shoulders-to-hips box alone doesn't show it. */
const EXEMPLAR_CONTEXT_KEYPOINTS: KeypointName[] = ['nose', 'left_ear', 'right_ear']

interface LeanSample {
  frame: RobustPoseFrame
  value: number
}

/**
 * The most forward-leaning frame ghosted against the most upright one — an EXTREME pair, since
 * this metric's picture is the range it measured, not its median.
 *
 * `selectExtremePairs` does the load-bearing work: the extremes of a per-frame distribution are, on
 * real footage, the frames most likely to be tracking glitches, so anything beyond the outlier
 * bound is dropped from consideration entirely, and the surviving candidates are then RANKED by
 * the quality they would be emitted with rather than by lean angle alone. A clip whose lean never
 * varies has no range to show and emits nothing rather than ghosting a frame against itself.
 *
 * It returns the pairs it BEAT as well as the winner, and they are carried as the emitted
 * exemplar's `alternates`. This metric cannot tell whether the pair it likes best can be drawn as
 * one legible image — that is decided from pixel geometry and display constants the evidence layer
 * owns — and on this repo's own side-view reference clip the best-scoring pair puts the runner at
 * opposite edges of a 4K frame. Offering the runners-up is what stops that one pair from taking the
 * whole metric's evidence with it.
 */
function buildExemplars(
  samples: LeanSample[],
  distribution: ExemplarDistribution,
): MetricExemplar[] {
  const pairs = selectExtremePairs(
    samples,
    (sample) => ({
      frame: sample.frame,
      seed: EXEMPLAR_SEED_KEYPOINTS,
      value: sample.value,
    }),
    distribution,
  )

  // Base is the more extreme of the two, per the blend plan: a range ghost is *about* its far end,
  // so that is the frame drawn at full opacity. Usually the forward-lean frame, but not always —
  // a clip that spends most of itself leaning forward puts the upright frame further from the
  // median, and it is that frame the picture is really about.
  return attachPairAlternates(
    pairs.map(({ base, ghost, quality }) => ({
      kind: 'trunkLeanRange' as const,
      timestamp: base.frame.timestamp,
      pairedTimestamp: ghost.frame.timestamp,
      quality,
      label: 'Most forward trunk lean, ghosted against the most upright frame',
      cropKeypoints: cropKeypoints(EXEMPLAR_SEED_KEYPOINTS, EXEMPLAR_CONTEXT_KEYPOINTS, [
        base.frame,
        ghost.frame,
      ]),
    })),
  )
}

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
): MetricResult {
  return {
    metric: 'trunkLean',
    value: null,
    unit: 'degrees',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat,
  }
}

/**
 * Forward/backward trunk lean, in degrees, positive = leaning in the direction of travel.
 * Hard-gated to side view: this is fundamentally a sagittal-plane rotation. Viewed face-on, any
 * apparent shoulder/hip x-offset reflects side-bend or arm-swing rotation, not fore-aft lean —
 * front view doesn't just make this measurement noisier, it measures a different physical
 * quantity entirely. Per "never a silent wrong number", the value is still computed and returned
 * even when the view is unsuitable (`viewFitTable.trunkLean` caps confidence low instead); ticket
 * #8's results view decides whether to hide it outright.
 */
export function computeTrunkLean(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.trunkLean[view]
  const bodyScale = estimateBodyScale(frames)

  if (bodyScale === null) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable body-scale reference (shoulders/hips) in this clip.',
    )
  }

  const travelDirection = estimateTravelDirection(frames, bodyScale)
  const travelDirectionKnown = travelDirection !== 0

  let interpolatedCount = 0
  const leanValues: number[] = []
  // Index-parallel to `leanValues`, carrying the identity `leanValues` alone can't: which frame a
  // lean came from, and how much of that frame's torso was interpolated rather than detected.
  const leanSamples: LeanSample[] = []
  for (const frame of frames) {
    const shoulderMid = resolveMidpoint(
      frame,
      'left_shoulder',
      'right_shoulder',
    )
    const hipMid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    if (shoulderMid === null || hipMid === null) continue

    const dx = shoulderMid.x - hipMid.x
    const dy = shoulderMid.y - hipMid.y
    // atan2(dx, -dy): image-y grows downward, so "up" (an upright torso) is -dy. This reads 0deg
    // upright, with a sign that reflects which screen-x side the torso leans toward — a purely
    // screen-relative quantity until travelDirection converts it into a travel-relative
    // forward(+)/backward(-) one below.
    const leanAngleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI
    const forwardLeanDeg = travelDirectionKnown
      ? leanAngleDeg * travelDirection
      : leanAngleDeg

    if (shoulderMid.interpolated || hipMid.interpolated) interpolatedCount += 1
    leanValues.push(forwardLeanDeg)
    leanSamples.push({ frame, value: forwardLeanDeg })
  }

  if (leanValues.length === 0) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable torso position in this clip.',
    )
  }

  const frameCoverage = leanValues.length / frames.length
  const interpolatedFraction = interpolatedCount / leanValues.length
  const value = median(leanValues)

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize: leanValues.length,
    minRequiredSampleSize: MIN_TRUNK_LEAN_SAMPLE_SIZE,
    travelDirectionKnown,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveats: string[] = []
  if (!travelDirectionKnown) {
    caveats.push(
      'Direction of travel could not be determined (no net horizontal displacement) — lean sign may not reflect forward/backward.',
    )
  }
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Trunk lean is a sagittal-plane measurement and is not reliable from a ${view} view.`,
    )
  }
  if (leanValues.length < MIN_TRUNK_LEAN_SAMPLE_SIZE) {
    caveats.push(
      `Only ${leanValues.length} resolvable frame(s) (recommend at least ${MIN_TRUNK_LEAN_SAMPLE_SIZE}) — confidence reduced accordingly.`,
    )
  }

  const exemplars = selectExemplars(
    buildExemplars(leanSamples, describeDistribution(leanValues)),
  )

  return {
    metric: 'trunkLean',
    value,
    unit: 'degrees',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize: leanValues.length,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
    ...(exemplars && { exemplars }),
  }
}
