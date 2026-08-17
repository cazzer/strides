import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
import { estimateBodyScale } from './bodyScale'
import { resolvePoint } from './keypoints'
import { findLocalExtrema } from './extrema'
import { computeMetricConfidence } from './confidence'
import {
  cropKeypoints,
  describeDistribution,
  pairQuality,
  scoreExemplarInstant,
  selectExemplars,
} from './exemplars'
import type { MetricExemplar } from './types'
import { median } from './mathUtils'

/**
 * A judgment-call minimum half-cycle count for a stable median swing-amplitude estimate per side,
 * chosen by analogy to `verticalOscillationMinCycles` — both read a moderately large, roughly
 * twice-per-stride vertical excursion. See design.md for the full reasoning.
 */
const MIN_ARM_SWING_SAMPLE_SIZE = 4

const SHOULDER_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_shoulder',
  right: 'right_shoulder',
}

const WRIST_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_wrist',
  right: 'right_wrist',
}

/** Context only (design D2): the elbow is the joint the swing bends at, so a shoulder-to-wrist
 * crop without it reads as a bare diagonal. Optional by contract — `cropKeypoints` drops it if it
 * resolves nowhere in the pair's own frames. */
const ELBOW_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_elbow',
  right: 'right_elbow',
}

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  frameCoverage = 0,
): MetricResult {
  return {
    metric: 'armSwingSymmetry',
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
 * One findLocalExtrema-confirmed half-swing, kept whole rather than collapsed to its amplitude.
 *
 * It carries the two FRAMES, not a per-extremum interpolated flag: the shared exemplar gate
 * (`exemplars.ts`) scores a `RobustPoseFrame` — `cropDerivable` and `detectionFactor` both read
 * `frame.keypoints` — so a boolean could neither derive a crop nor be scored. Same conclusion #62
 * reached for `IntegrationRun.frames`.
 *
 * **The field names resolve a sign trap.** The series is `wrist.y − shoulder.y` in image-y, which
 * grows DOWNWARD, so the series' MINIMUM is the wrist at its HIGHEST on screen. Naming these by
 * body position rather than by extremum kind means a caption cannot say the exact opposite of the
 * truth while passing every type check — the same hazard `bounceInstants.ts` documents at length.
 */
interface HalfSwing {
  /** Peak-to-trough wrist-relative-to-shoulder excursion, px. */
  amplitudePx: number
  /** Frame where the wrist sat highest on screen — the series minimum. */
  wristHighFrame: RobustPoseFrame
  /** Frame where it sat lowest — the series maximum, half a swing away. */
  wristLowFrame: RobustPoseFrame
}

interface SideSwing {
  /** One entry per findLocalExtrema-confirmed swing, in time order. */
  halfSwings: HalfSwing[]
  /** Frames where this side's shoulder AND wrist both resolved. */
  resolvedCount: number
  /** Of resolvedCount, how many had either point flagged interpolated. */
  interpolatedCount: number
}

/**
 * Per-side wrist-relative-to-shoulder vertical (image-y) excursion, read as paired extrema via the
 * shared `findLocalExtrema` primitive (the approach `verticalOscillation.ts` used for hip bounce
 * before it moved to a spectral sinusoid fit — see `spectralFit.ts`). Vertical, not
 * horizontal or angular, and wrist rather than elbow, per design.md's reasoning: the sagittal
 * shoulder-flexion rotation that drives arm swing is foreshortened face-on (this metric's primary
 * view), but the coupled elbow-flexion rise/fall of the forearm toward the chest on the forward
 * swing is a real, front-view-visible vertical motion, and the wrist — the most distal available
 * point — inherits the largest version of it.
 */
function computeSideSwing(
  frames: RobustPoseFrame[],
  side: 'left' | 'right',
  minProminenceAbs: number,
): SideSwing {
  let resolvedCount = 0
  let interpolatedCount = 0

  const series = frames.map((frame) => {
    const shoulder = resolvePoint(frame, SHOULDER_NAME[side])
    const wrist = resolvePoint(frame, WRIST_NAME[side])
    if (shoulder === null || wrist === null) return null
    resolvedCount += 1
    if (shoulder.interpolated || wrist.interpolated) interpolatedCount += 1
    return { t: frame.timestamp, v: wrist.y - shoulder.y }
  })

  const extrema = findLocalExtrema(series, minProminenceAbs)

  // Pair consecutive opposite-kind extrema into half-cycles. The same-kind skip is
  // load-bearing: two runs separated by an unrecoverable gap could both end/start on the same
  // kind, and pairing those would fabricate an amplitude that was never observed.
  const halfSwings: HalfSwing[] = []
  for (let i = 1; i < extrema.length; i += 1) {
    const [previous, current] = [extrema[i - 1], extrema[i]]
    if (current.kind === previous.kind) continue
    // `Extremum.index` indexes the series passed to `findLocalExtrema`, and that series is
    // `frames.map(...)` — index-parallel to `frames`, including its `null` entries.
    const [minimum, maximum] =
      current.kind === 'min' ? [current, previous] : [previous, current]
    halfSwings.push({
      amplitudePx: Math.abs(current.value - previous.value),
      wristHighFrame: frames[minimum.index],
      wristLowFrame: frames[maximum.index],
    })
  }

  return { halfSwings, resolvedCount, interpolatedCount }
}

/**
 * Up to one ghosted pair per side: the wrist at the top and the bottom of that side's
 * median-amplitude half-swing. Two of them, one per arm, is what makes an ASYMMETRY metric legible
 * as a picture — one arm's swing only means anything next to the other's, so this metric spends
 * its whole two-exemplar budget on the comparison rather than on two views of one arm.
 *
 * **Each side is judged against its OWN distribution.** The metric compares two per-side medians,
 * so ranking a left swing against a pooled left+right spread would score it on the very asymmetry
 * the metric exists to report — a genuinely typical left swing on an asymmetric runner would read
 * as an outlier and gate itself out.
 *
 * **Base is the wrist-high frame**, design D1's instant A for this row. D11's rule — base is the
 * instant closest to (representative) or furthest from (extreme) the metric's own median — cannot
 * decide it here: both instants belong to ONE half-swing and therefore carry the identical value,
 * that swing's amplitude. Same shape of gap #62 recorded for the bounce pair, resolved the same
 * way: fall back to the row's own naming.
 */
function buildSideExemplar(side: 'left' | 'right', swing: SideSwing): MetricExemplar[] {
  const distribution = describeDistribution(swing.halfSwings.map((s) => s.amplitudePx))

  // The swing whose amplitude sits closest to this side's own median — the amplitude the metric
  // reports for this side, so this is the swing the number is most directly about. `<` rather than
  // `<=` keeps the earliest of any tie, which a symmetric fixture produces routinely.
  let selected: HalfSwing | null = null
  let bestCost = Infinity
  for (const halfSwing of swing.halfSwings) {
    const cost = Math.abs(halfSwing.amplitudePx - distribution.median)
    if (cost < bestCost) {
      selected = halfSwing
      bestCost = cost
    }
  }
  if (selected === null) return []

  const seed = [SHOULDER_NAME[side], WRIST_NAME[side]]
  const instant = (frame: RobustPoseFrame) => ({
    frame,
    seed,
    value: selected.amplitudePx,
  })
  const highQuality = scoreExemplarInstant(
    instant(selected.wristHighFrame),
    'representative',
    distribution,
  )
  const lowQuality = scoreExemplarInstant(
    instant(selected.wristLowFrame),
    'representative',
    distribution,
  )
  if (highQuality === null || lowQuality === null) return []

  return [
    {
      kind: 'armSwingCycle',
      timestamp: selected.wristHighFrame.timestamp,
      pairedTimestamp: selected.wristLowFrame.timestamp,
      side,
      quality: pairQuality(highQuality, lowQuality),
      label: `Top and bottom of one ${side}-arm swing, ghosted together`,
      cropKeypoints: cropKeypoints(seed, [ELBOW_NAME[side]], [
        selected.wristHighFrame,
        selected.wristLowFrame,
      ]),
    },
  ]
}

/**
 * Arm swing symmetry: `min(left, right) / max(left, right)` of each arm's torso-normalized
 * wrist-relative-to-shoulder swing amplitude — a 0-1 ratio, 1 = perfectly symmetric swing.
 * Front-view-primary, the mirror image of trunk lean/overstriding's side-view-primary gating: a
 * side view occludes or superimposes the far arm (an occlusion/separability problem) rather than
 * making the swing signal itself invisible (side view's problem for trunk lean/overstriding).
 * See design.md for the full reasoning, including why amplitude ratio was chosen over phase
 * alignment. Per "never a silent wrong number", the value is still computed and returned even
 * when the view is unsuitable (`viewFitTable.armSwingSymmetry` caps confidence low instead).
 */
export function computeArmSwingSymmetry(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.armSwingSymmetry[view]
  const bodyScale = estimateBodyScale(frames)

  if (bodyScale === null) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable body-scale reference (shoulders/hips) in this clip.',
    )
  }

  const { torsoLengthPx } = bodyScale
  const minProminenceAbs = config.armSwingMinProminenceRatio * torsoLengthPx

  const left = computeSideSwing(frames, 'left', minProminenceAbs)
  const right = computeSideSwing(frames, 'right', minProminenceAbs)

  // Weakest-side aggregation: a symmetry comparison is only as trustworthy as its less-observed
  // side, so frameCoverage/sampleSize use min(left, right) rather than an average that could hide
  // a real weakness on one side.
  const frameCoverage =
    Math.min(left.resolvedCount, right.resolvedCount) / frames.length

  if (left.resolvedCount === 0 || right.resolvedCount === 0) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable shoulder/wrist position for one or both arms in this clip.',
      frameCoverage,
    )
  }

  if (left.halfSwings.length === 0 || right.halfSwings.length === 0) {
    return nullResult(
      viewFitEntry.fit,
      'Arm positions were tracked, but no complete arm-swing cycle was detected on one or both sides.',
      frameCoverage,
    )
  }

  const leftValue = median(left.halfSwings.map((s) => s.amplitudePx)) / torsoLengthPx
  const rightValue = median(right.halfSwings.map((s) => s.amplitudePx)) / torsoLengthPx
  const maxValue = Math.max(leftValue, rightValue)
  // maxValue === 0 shouldn't be reachable here: findLocalExtrema only confirms an extremum once
  // the series has moved at least minProminenceAbs (> 0) from its predecessor, so any amplitude
  // that made it into amplitudesPx is strictly positive. Guarded explicitly anyway, per this
  // pipeline's "never NaN" contract, rather than relying on that invariant silently.
  const value = maxValue === 0 ? 1 : Math.min(leftValue, rightValue) / maxValue

  const interpolatedFraction =
    (left.interpolatedCount + right.interpolatedCount) /
    (left.resolvedCount + right.resolvedCount)

  const sampleSize = Math.min(
    left.halfSwings.length,
    right.halfSwings.length,
  )

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize,
    minRequiredSampleSize: MIN_ARM_SWING_SAMPLE_SIZE,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveats: string[] = []
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Arm swing symmetry needs both arms visible and separable, and is not reliable from a ${view} view.`,
    )
  }
  if (sampleSize < MIN_ARM_SWING_SAMPLE_SIZE) {
    caveats.push(
      `Only ${sampleSize} matched swing cycle(s) (recommend at least ${MIN_ARM_SWING_SAMPLE_SIZE}) — confidence reduced accordingly.`,
    )
  }

  // One candidate per side, gated and ranked together: the budget is per-metric, so gating each
  // arm separately would apply the cap twice and could keep two pictures of one arm.
  const exemplars = selectExemplars([
    ...buildSideExemplar('left', left),
    ...buildSideExemplar('right', right),
  ])

  return {
    metric: 'armSwingSymmetry',
    value,
    unit: 'percent',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
    ...(exemplars && { exemplars }),
  }
}
