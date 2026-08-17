import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricExemplar, MetricResult, View } from './types'
import { resolvePoint } from './keypoints'
import { findLocalExtrema } from './extrema'
import type { Extremum } from './extrema'
import { computeMetricConfidence } from './confidence'
import {
  cropKeypoints,
  describeDistribution,
  pairQuality,
  scoreExemplarInstant,
  selectExemplars,
} from './exemplars'
import type { ExemplarDistribution } from './exemplars'
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

interface FlexionPeak {
  side: 'left' | 'right'
  frameIndex: number
  timestamp: number
  valueDeg: number
  /** Where this peak sits in its own side's extrema list, so the adjacent extension minimum —
   * which `findLocalExtrema` already computed and this metric otherwise drops on the floor —
   * stays reachable without a second scan. */
  extremaIndex: number
}

/**
 * The peak whose flexion is nearest the reported median, ghosted against the adjacent extension
 * trough on the SAME leg.
 *
 * The peak is REPRESENTATIVE, not the largest in the clip: the reported value is the median peak,
 * so the picture has to be of a typical one. The trough is not itself a measurement — it is what
 * makes the flexion angle legible, since a bent knee only reads as bent against a straight one —
 * so it is scored for resolvability only and carries no typicality. A caption must not imply the
 * trough was measured.
 *
 * A peak with no adjacent trough (the extrema list ran out, or a tracking gap put a second peak
 * next to it) is dropped rather than demoted to a single frame: one still of a bent knee, with
 * nothing to read the bend against, is not evidence.
 */
function buildExemplars(
  peaks: FlexionPeak[],
  sideExtrema: Record<'left' | 'right', Extremum[]>,
  frames: RobustPoseFrame[],
  distribution: ExemplarDistribution,
): MetricExemplar[] {
  const candidates: MetricExemplar[] = []
  for (const peak of peaks) {
    const extrema = sideExtrema[peak.side]
    const trough =
      adjacentMinimum(extrema, peak.extremaIndex, 1) ??
      adjacentMinimum(extrema, peak.extremaIndex, -1)
    if (trough === null) continue

    const { hip, knee, ankle } = LEG_KEYPOINTS[peak.side]
    const seed = [hip, knee, ankle]
    const peakQuality = scoreExemplarInstant(
      { frame: frames[peak.frameIndex], seed, value: peak.valueDeg },
      'representative',
      distribution,
    )
    const troughQuality = scoreExemplarInstant(
      { frame: frames[trough.index], seed },
      'representative',
      distribution,
    )
    if (peakQuality === null || troughQuality === null) continue

    candidates.push({
      kind: 'kneeFlexionPeak',
      timestamp: peak.timestamp,
      pairedTimestamp: trough.timestamp,
      side: peak.side,
      quality: pairQuality(peakQuality, troughQuality),
      label: `Peak knee flexion (${peak.side} leg), ghosted against the same leg near full extension`,
      cropKeypoints: cropKeypoints(seed, [], [frames[peak.frameIndex], frames[trough.index]]),
    })
  }

  // One pair, not two: a second near-median peak would be the same picture of the same runner.
  candidates.sort((a, b) => b.quality - a.quality)
  return candidates.slice(0, 1)
}

function adjacentMinimum(
  extrema: Extremum[],
  from: number,
  step: 1 | -1,
): Extremum | null {
  const neighbour = extrema[from + step]
  // `findLocalExtrema` alternates min/max within a contiguous run but not across a tracking gap,
  // so the neighbour's kind has to be checked rather than assumed.
  return neighbour !== undefined && neighbour.kind === 'min' ? neighbour : null
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

  const peaks: FlexionPeak[] = []
  // Kept per side rather than discarded with the minima: the near-full-extension troughs are what
  // makes a flexion peak legible as a picture, and re-deriving them later would mean a second
  // extrema scan over the same series.
  const sideExtrema: Record<'left' | 'right', Extremum[]> = { left: [], right: [] }
  for (const side of ['left', 'right'] as const) {
    const extrema = findLocalExtrema(legSeries[side], minProminenceAbs)
    sideExtrema[side] = extrema
    extrema.forEach((extremum, extremaIndex) => {
      // Local maxima of the flexion-degrees series are swing-phase peaks (most bent); local
      // minima are near-full-extension troughs, which aren't the quantity being reported.
      if (extremum.kind !== 'max') return
      peaks.push({
        side,
        frameIndex: extremum.index,
        timestamp: extremum.timestamp,
        valueDeg: extremum.value,
        extremaIndex,
      })
    })
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

  const exemplars = selectExemplars(
    buildExemplars(peaks, sideExtrema, frames, describeDistribution(flexionValues)),
  )

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
    ...(exemplars && { exemplars }),
  }
}
