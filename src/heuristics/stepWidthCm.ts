import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
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
 * A judgment-call minimum footstrike count for a stable median step-width estimate, chosen by the
 * same reasoning as `overstriding.ts`'s `MIN_OVERSTRIDE_SAMPLE_SIZE` — this metric shares its
 * event-sampled shape (one measurement per footstrike, not per frame).
 */
const MIN_STEP_WIDTH_CM_SAMPLE_SIZE = 4

const HIP_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_hip',
  right: 'right_hip',
}

/**
 * The backend contract already promises a measured scale is finite and strictly positive; this
 * re-checks it at the one place a violation would matter, so that no arithmetic below can produce
 * an `Infinity`/`NaN` that would escape into a `MetricResult`. A value failing the check is
 * treated exactly like an unmeasured frame — same discipline `verticalOscillationCm.ts`'s own
 * `isUsableScale` uses.
 */
function isUsableScale(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0
}

// British spelling in user-facing prose is this codebase's established convention for the VO-cm
// family (identifiers use "centimeters", prose uses "centimetres") — follow it here too.
const NO_SCALE_CAVEAT =
  "No real-world scale could be measured for this clip, so step width can't be reported in centimetres."

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  frameCoverage = 0,
): MetricResult {
  return {
    metric: 'stepWidthCm',
    value: null,
    unit: 'centimeters',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage,
    sampleSize: 0,
    caveat,
  }
}

/**
 * Step width in real centimetres: at each footstrike, how far to the side of the hip midline the
 * foot lands, converted to centimetres via that same frame's `pixelsPerMeter`. Sign: POSITIVE =
 * foot landed on its own anatomical side of the midline; NEGATIVE = crossed to the opposite side
 * (crossover gait). Polarity is resolved per-footstrike from that frame's own-side hip position
 * relative to hip-mid — NOT from a clip-wide travelDirection-style constant (that solves a
 * different, fore-aft problem) — because a raw, unflipped ankle.x - hipMid.x combined across both
 * legs cancels toward ~0 for any symmetric gait, destroying the crossover signal this metric
 * exists to report. This mirrors `stepWidth`'s (the ratio sibling, #46) sign convention exactly —
 * same semantics, just different units.
 *
 * Hip-mid is resolved via the STRICT bilateral primitive (`resolveBilateralPair`), not
 * `resolveMidpoint`'s tolerant single-hip fallback: a frame where only one hip resolves would
 * otherwise silently substitute "my own hip" for the midline, which corrupts both the raw offset
 * and — worse, since it's now sign-bearing — the crossover polarity itself. Such frames are
 * discarded rather than approximated.
 *
 * Despite the name parallel to `verticalOscillationCm`, this metric's shape is `overstriding`'s,
 * not `verticalOscillationCm`'s: an INSTANTANEOUS per-frame spatial offset (ankle vs. hip-mid,
 * both read off one video frame) divided by that same frame's scale — never a time series to
 * integrate. `verticalOscillationCm`'s spectral-fit/drift-integration machinery exists to solve a
 * camera-approach-drift problem specific to accumulating a *series* of bounce over time; that
 * problem cannot arise here, so this module doesn't have (and doesn't need) a `buildRuns`/fit/
 * weighted-median-across-runs structure of its own.
 *
 * MediaPipe-only, like `verticalOscillationCm`: `pixelsPerMeter` is `null` on every other
 * detection backend today, so a clip that never carries a measured scale reports an availability
 * caveat (`NO_SCALE_CAVEAT`) rather than an error — the backend gate is checked FIRST, before
 * footstrike detection, mirroring `computeVerticalOscillationCmMetric`'s ordering so a MoveNet
 * clip gets one clear "wrong backend" caveat, never a confusing "no footstrikes" message for a
 * clip that actually tracked fine.
 *
 * View-gated like `armSwingSymmetry`, not `overstriding`/`trunkLean`: step width is a
 * mediolateral (side-to-side) offset, primary from front/rear, unsuitable from the side — see
 * `viewFitTable.stepWidthCm`'s own doc in `types.ts`.
 *
 * No `calibration`/`fit` companion type: unlike `VerticalOscillationCmResult`, there is no
 * fit/drift/weighted-median concept behind this number to expose — a plain `MetricResult`
 * suffices.
 */
export function computeStepWidthCm(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.stepWidthCm[view]

  if (!frames.some((f) => isUsableScale(f.pixelsPerMeter))) {
    return nullResult(viewFitEntry.fit, NO_SCALE_CAVEAT)
  }

  const candidates: FootstrikeCandidate[] = detectFootstrikes(frames, config)
  if (candidates.length === 0) {
    return nullResult(viewFitEntry.fit, 'No footstrikes could be detected in this clip.')
  }

  let interpolatedCount = 0
  const offsetsCm: number[] = []
  // Index-parallel to `offsetsCm`, not to `candidates` — the `continue` below skips strikes.
  const strikeSamples: StepWidthStrikeSample[] = []
  for (const candidate of candidates) {
    const frame = frames[candidate.frameIndex]
    const ankle = resolvePoint(frame, STEP_WIDTH_ANKLE_NAME[candidate.side])
    // Strict bilateral resolution for hip-mid: both hips must independently resolve, or the
    // frame is discarded. `resolveMidpoint`'s tolerant single-hip fallback would silently stand
    // in "my own hip" for the midline when the other side is briefly unresolved — harmless for a
    // magnitude-only reading, but corrupting for this metric now that the offset's SIGN is the
    // point: a fallback hip-mid can flip which side of the (fabricated) midline the ankle reads
    // as landing on.
    const hips = resolveBilateralPair(frame, 'left_hip', 'right_hip')
    const sideHip = resolvePoint(frame, HIP_NAME[candidate.side])
    if (
      ankle === null ||
      hips === null ||
      sideHip === null ||
      !isUsableScale(frame.pixelsPerMeter)
    ) {
      continue
    }

    const hipMidX = (hips.left.x + hips.right.x) / 2
    // Sign: which side of hip-mid this leg's OWN hip sits on. Flipping the raw offset by this
    // sign turns "positive x" (camera-arbitrary) into "landed on its own side" (meaningful,
    // camera-orientation-independent) — see the module doc. Guarded: only reaches 0 when the
    // side hip and hip-mid exactly coincide in x, which correlates with near-pure side view
    // (already discounted to the `unsuitable` view-fit tier), so `|| 1` never masks a real
    // mediolateral reading.
    const rawOutwardSign = Math.sign(sideHip.x - hipMidX)
    const outwardSign = rawOutwardSign || 1
    const dx = ankle.x - hipMidX
    const offsetCm = ((dx * outwardSign) / frame.pixelsPerMeter) * 100 // px / (px/m) = m; ×100 = cm
    offsetsCm.push(offsetCm)
    strikeSamples.push({
      frame,
      side: candidate.side,
      value: offsetCm,
      degenerate: rawOutwardSign === 0,
    })

    const otherHip = resolvePoint(frame, HIP_NAME[candidate.side === 'left' ? 'right' : 'left'])
    const hipMidInterpolated = sideHip.interpolated || (otherHip?.interpolated ?? false)
    if (ankle.interpolated || hipMidInterpolated) interpolatedCount += 1
  }

  const usableStrikeCount = offsetsCm.length
  // Event-sampled metric, same convention as overstriding's own `frameCoverage`: what fraction of
  // ankle-detected candidate footstrikes also had a resolvable hip position AND a measured scale
  // at that same instant.
  const frameCoverage = usableStrikeCount / candidates.length

  if (usableStrikeCount === 0) {
    return nullResult(
      viewFitEntry.fit,
      'Footstrikes were detected, but hip position, ankle position, or real-world scale was not resolvable at any of them.',
      frameCoverage,
    )
  }

  const interpolatedFraction = interpolatedCount / usableStrikeCount
  const value = median(offsetsCm)

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize: usableStrikeCount,
    minRequiredSampleSize: MIN_STEP_WIDTH_CM_SAMPLE_SIZE,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
    // No scaleCoverage factor: every counted point already required a usable scale to exist, so
    // frameCoverage above already reflects that fact — a separate factor would double-penalize
    // the same missing measurement.
  })

  const caveats: string[] = []
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Step width is a side-to-side measurement and is not reliable from a ${view} view.`,
    )
  }
  if (usableStrikeCount < MIN_STEP_WIDTH_CM_SAMPLE_SIZE) {
    caveats.push(
      `Only ${usableStrikeCount} footstrike(s) detected (recommend at least ${MIN_STEP_WIDTH_CM_SAMPLE_SIZE}) — confidence reduced accordingly.`,
    )
  }
  if (value < 0) {
    caveats.push(
      "This clip's footstrikes tend to cross the body's midline (crossover gait) rather than landing on their own side. Based on this one clip's footstrikes, not a diagnosis.",
    )
  }

  const exemplars = selectExemplars(
    buildStepWidthExemplars(strikeSamples, describeDistribution(offsetsCm)),
  )

  return {
    metric: 'stepWidthCm',
    value,
    unit: 'centimeters',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize: usableStrikeCount,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
    ...(exemplars && { exemplars }),
  }
}
