import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
import { resolvePoint } from './keypoints'
import { findLocalExtrema } from './extrema'
import { computeMetricConfidence } from './confidence'
import { median, angleBetweenVectorsDeg } from './mathUtils'

/**
 * Roughly one full gait cycle's worth of swing-phase flexion peaks (one per leg per stride, both
 * legs pooled) — a judgment-call minimum for a stable median, chosen for the same reason as
 * `MIN_OVERSTRIDE_SAMPLE_SIZE`: fewer detected peaks than this is too easily dominated by a
 * single noisy cycle.
 */
const MIN_KNEE_FLEXION_SAMPLE_SIZE = 4

const LEG_KEYPOINTS: Record<
  'left' | 'right',
  { hip: KeypointName; knee: KeypointName; ankle: KeypointName }
> = {
  left: { hip: 'left_hip', knee: 'left_knee', ankle: 'left_ankle' },
  right: { hip: 'right_hip', knee: 'right_knee', ankle: 'right_ankle' },
}

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  frameCoverage = 0,
): MetricResult {
  return {
    metric: 'kneeFlexion',
    value: null,
    unit: 'degrees',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage,
    sampleSize: 0,
    caveat,
  }
}

interface FlexionSample {
  t: number
  v: number
}

/**
 * Hip-knee-ankle knee flexion, in degrees, both legs combined into a single clip-level number.
 *
 * A raw per-frame joint angle isn't itself a "form" number the way trunk lean's angle or vertical
 * oscillation's amplitude already are — see design.md for the full reasoning. In short: for each
 * leg independently, the interior hip-knee-ankle angle is converted to "degrees of flexion from
 * full extension" (`180° - interior angle`, so 0° = straight leg and larger = more bent — a scale
 * that reads correctly against the metric's own name, unlike the raw interior angle, where more
 * bending means a *smaller* number). That per-leg flexion-degrees series is fed through the same
 * gap-aware, prominence-thresholded extrema finder overstriding uses for footstrikes
 * (`findLocalExtrema`); each confirmed local MAXIMUM is one leg's peak flexion for one stride — by
 * construction the largest excursions in this series are the swing-phase heel-toward-glutes
 * motion, not the much smaller stance-phase loading-response dip, so a generous prominence
 * threshold (`kneeFlexionMinProminenceDegrees`) isolates swing-phase peaks without any separate
 * phase/footstrike detection. The peaks from both legs are pooled and reported as their median —
 * matching the median-based aggregation trunkLean/overstriding already use for the same
 * outlier-robustness reason.
 *
 * Hard-gated to side view, for the same reasoning as trunk lean and overstriding: hip-knee-ankle
 * is a sagittal-plane angle, foreshortened toward a degenerate reading face-on. Per "never a
 * silent wrong number", the value is still computed and returned even when the view is unsuitable
 * (`viewFitTable.kneeFlexion` caps confidence low instead).
 *
 * Unlike trunk lean/overstriding, this metric doesn't need `estimateBodyScale`/torso-length
 * normalization at all: an angle is already scale- and camera-distance-independent, and it isn't
 * signed by direction of travel (a bent knee reads the same regardless of which way the runner is
 * moving), so travel direction isn't a confidence factor here either.
 */
export function computeKneeFlexion(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.kneeFlexion[view]

  // One entry per frame per leg (aligned 1:1 with `frames`, `null` where that leg's hip/knee/ankle
  // don't all resolve that frame) — mirrors overstriding's per-side ankle-y series, but built
  // directly in "flexion degrees" units rather than raw pixels.
  const legSeries: Record<'left' | 'right', Array<FlexionSample | null>> = {
    left: [],
    right: [],
  }
  const legInterpolated: Record<'left' | 'right', boolean[]> = { left: [], right: [] }
  let resolvableLegFrames = 0

  for (const frame of frames) {
    for (const side of ['left', 'right'] as const) {
      const { hip, knee, ankle } = LEG_KEYPOINTS[side]
      const hipPt = resolvePoint(frame, hip)
      const kneePt = resolvePoint(frame, knee)
      const anklePt = resolvePoint(frame, ankle)

      if (hipPt === null || kneePt === null || anklePt === null) {
        legSeries[side].push(null)
        legInterpolated[side].push(false)
        continue
      }

      resolvableLegFrames += 1
      const jointAngleDeg = angleBetweenVectorsDeg(kneePt, hipPt, anklePt)
      const flexionDeg = 180 - jointAngleDeg
      legSeries[side].push({ t: frame.timestamp, v: flexionDeg })
      legInterpolated[side].push(
        hipPt.interpolated || kneePt.interpolated || anklePt.interpolated,
      )
    }
  }

  if (resolvableLegFrames === 0) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable hip-knee-ankle position for either leg in this clip.',
    )
  }

  // Data-availability coverage across both legs' independent channels — analogous to trunkLean's
  // per-frame frameCoverage, but pooling left+right since each is its own resolvability signal.
  const frameCoverage = resolvableLegFrames / (frames.length * 2)

  const minProminenceAbs = config.kneeFlexionMinProminenceDegrees

  interface FlexionPeak {
    side: 'left' | 'right'
    frameIndex: number
    valueDeg: number
  }
  const peaks: FlexionPeak[] = []
  for (const side of ['left', 'right'] as const) {
    const extrema = findLocalExtrema(legSeries[side], minProminenceAbs)
    for (const extremum of extrema) {
      // Local maxima of the flexion-degrees series are swing-phase peaks (most bent); local
      // minima are near-full-extension troughs, which aren't the quantity being reported.
      if (extremum.kind !== 'max') continue
      peaks.push({ side, frameIndex: extremum.index, valueDeg: extremum.value })
    }
  }

  if (peaks.length === 0) {
    return nullResult(
      viewFitEntry.fit,
      'No swing-phase knee-flexion peaks could be detected in this clip.',
      frameCoverage,
    )
  }

  let interpolatedCount = 0
  const flexionValues: number[] = []
  for (const peak of peaks) {
    flexionValues.push(peak.valueDeg)
    if (legInterpolated[peak.side][peak.frameIndex]) interpolatedCount += 1
  }

  const sampleSize = flexionValues.length
  const interpolatedFraction = interpolatedCount / sampleSize
  const value = median(flexionValues)

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize,
    minRequiredSampleSize: MIN_KNEE_FLEXION_SAMPLE_SIZE,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveats: string[] = []
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Knee flexion is a sagittal-plane measurement and is not reliable from a ${view} view.`,
    )
  }
  if (sampleSize < MIN_KNEE_FLEXION_SAMPLE_SIZE) {
    caveats.push(
      `Only ${sampleSize} swing-phase flexion peak(s) detected (recommend at least ${MIN_KNEE_FLEXION_SAMPLE_SIZE}) — confidence reduced accordingly.`,
    )
  }

  return {
    metric: 'kneeFlexion',
    value,
    unit: 'degrees',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
  }
}
