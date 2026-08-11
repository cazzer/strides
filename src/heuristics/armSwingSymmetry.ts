import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
import { estimateBodyScale } from './bodyScale'
import { resolvePoint } from './keypoints'
import { findLocalExtrema } from './extrema'
import { computeMetricConfidence } from './confidence'
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

interface SideSwing {
  /** Raw pixel half-cycle amplitudes, one per findLocalExtrema-confirmed swing. */
  amplitudesPx: number[]
  /** Frames where this side's shoulder AND wrist both resolved. */
  resolvedCount: number
  /** Of resolvedCount, how many had either point flagged interpolated. */
  interpolatedCount: number
}

/**
 * Per-side wrist-relative-to-shoulder vertical (image-y) excursion, reusing the exact
 * amplitude-via-extrema approach `verticalOscillation.ts` uses for hip bounce. Vertical, not
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

  // Pair consecutive opposite-kind extrema into half-cycle amplitudes — same logic as
  // verticalOscillation.ts: two runs separated by an unrecoverable gap could both end/start on
  // the same kind, and pairing those would fabricate an amplitude that was never observed.
  const amplitudesPx: number[] = []
  for (let i = 1; i < extrema.length; i += 1) {
    if (extrema[i].kind === extrema[i - 1].kind) continue
    amplitudesPx.push(Math.abs(extrema[i].value - extrema[i - 1].value))
  }

  return { amplitudesPx, resolvedCount, interpolatedCount }
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

  if (left.amplitudesPx.length === 0 || right.amplitudesPx.length === 0) {
    return nullResult(
      viewFitEntry.fit,
      'Arm positions were tracked, but no complete arm-swing cycle was detected on one or both sides.',
      frameCoverage,
    )
  }

  const leftValue = median(left.amplitudesPx) / torsoLengthPx
  const rightValue = median(right.amplitudesPx) / torsoLengthPx
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
    left.amplitudesPx.length,
    right.amplitudesPx.length,
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
  }
}
