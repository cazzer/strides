import type { KeypointName } from '../pose/types'
import { viewPhrase } from './viewDetection'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricExemplar, MetricResult, View } from './types'
import { resolvePoint } from './keypoints'
import { estimateBodyScale } from './bodyScale'
import { estimateTravelDirection } from './travelDirection'
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
import { median } from './mathUtils'

/**
 * Roughly one full gait cycle's worth of forward-lift peaks (one per leg per stride, both legs
 * pooled) — the same judgment-call minimum as `MIN_KNEE_FLEXION_SAMPLE_SIZE`, for the same
 * reason: fewer detected peaks than this is too easily dominated by a single noisy cycle. The
 * design probe measured 6 on the reference side-view clip, so a clean clip clears it.
 */
const MIN_KNEE_DRIVE_SAMPLE_SIZE = 4

const LEG_KEYPOINTS: Record<
  'left' | 'right',
  { hip: KeypointName; knee: KeypointName }
> = {
  left: { hip: 'left_hip', knee: 'left_knee' },
  right: { hip: 'right_hip', knee: 'right_knee' },
}

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  frameCoverage = 0,
): MetricResult {
  return {
    metric: 'kneeDrive',
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

interface DriveSample {
  t: number
  v: number
}

interface DrivePeak {
  side: 'left' | 'right'
  frameIndex: number
  timestamp: number
  valueDeg: number
  /** Where this peak sits in its own side's extrema list, so the adjacent trough — which
   * `findLocalExtrema` already computed and this metric otherwise drops on the floor — stays
   * reachable without a second scan. */
  extremaIndex: number
}

/**
 * The peak whose lift angle is nearest the reported median, ghosted against the adjacent trough
 * on the SAME leg — the thigh at its rearmost swing, since on the signed series the minima are
 * the trailing extremes.
 *
 * The peak is REPRESENTATIVE, not the largest in the clip: the reported value is the median peak,
 * so the picture has to be of a typical one. The trough is not itself a measurement — it is what
 * makes the lift angle legible, since a driven thigh only reads as driven against the same thigh
 * swept back — so it is scored for resolvability only and carries no typicality. A caption must
 * not imply the trough was measured.
 *
 * A peak with no adjacent trough (the extrema list ran out, or a tracking gap put a second peak
 * next to it) is dropped rather than demoted to a single frame at build time: one still of a
 * lifted thigh, with nothing to read the lift against, is not evidence. (Post-planning demotion
 * for an uncroppable pair is `SINGLE_INSTANT_KINDS`' separate business.)
 */
function buildExemplars(
  peaks: DrivePeak[],
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

    const { hip, knee } = LEG_KEYPOINTS[peak.side]
    const seed = [hip, knee]
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
      kind: 'kneeDrivePeak',
      timestamp: peak.timestamp,
      pairedTimestamp: trough.timestamp,
      side: peak.side,
      quality: pairQuality(peakQuality, troughQuality),
      label: `Peak knee drive (${peak.side} leg), ghosted against the same leg's thigh swept back`,
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
 * Knee drive — peak thigh-lift angle during swing, in degrees, both legs combined into a single
 * clip-level number.
 *
 * DISTINCT from `kneeFlexion`, which measures swing-phase knee BEND (the hip-knee-ankle interior
 * angle — heel recovery): knee drive measures thigh LIFT, the hip→knee vector's angle off the
 * image's down-vertical ray, and never reads the ankle. A runner can carry a high heel with a low
 * knee or the reverse; the two answer different coaching questions from different geometry. And
 * it is an honest 2D proxy: an ANGLE amplitude, saying nothing about propulsive force.
 *
 * The angle convention is the down-vertical zero (`atan2(dx, dy)` on hip→knee — a thigh hanging
 * straight down reads 0°), NOT trunkLean's up-vertical `atan2(dx, -dy)`: a torso points up, a
 * thigh points down, and reusing trunkLean's formula would read ~180° at rest and fold lift the
 * wrong way through the ±180° discontinuity. The angle is SIGNED by `estimateTravelDirection`
 * (trunkLean's pattern) so forward lift is positive regardless of which way the runner crosses
 * the screen — the design probe measured that the UNSIGNED angle cannot separate forward lift
 * from backward trail by prominence alone (Demo 1's weakest genuine lift peak is weaker than its
 * strongest trail excursion; `openspec/changes/add-knee-drive-metric/design.md` D1), so unlike
 * `kneeFlexion` this metric structurally needs the direction, and an indeterminate direction is a
 * null with its own caveat rather than a guessed sign. Fine for a side-gated metric: direction
 * resolves on side views; it is front-approach footage where it returns 0.
 *
 * Each leg's signed series is fed through the same gap-aware, prominence-thresholded extrema
 * finder kneeFlexion uses (`findLocalExtrema`, floored at `kneeDriveMinProminenceDegrees` — a
 * MEASURED floor, deliberately not kneeFlexion's 20, see design.md D4). Confirmed local maxima
 * with a POSITIVE signed angle are forward-lift peaks — one per leg per stride by construction on
 * the signed series; a maximum at or below zero (the trailing-pivot boundary artifact the probe
 * measured) is a thigh that never crossed the vertical, not a lift, and is dropped. Peaks from
 * both legs are pooled and reported as their median, matching kneeFlexion's aggregation.
 *
 * Hard-gated to side view on kneeFlexion's exact terms: thigh lift is a sagittal-plane angle,
 * foreshortened toward a degenerate reading face-on. Per "never a silent wrong number", the value
 * is still computed and returned even when the view is unsuitable (`viewFitTable.kneeDrive` caps
 * confidence low instead). Like kneeFlexion, no torso-length normalization: an angle is already
 * scale- and camera-distance-independent.
 */
export function computeKneeDrive(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.kneeDrive[view]

  // One entry per frame per leg (aligned 1:1 with `frames`, `null` where that leg's hip/knee
  // don't both resolve that frame), in RAW screen-relative degrees — signed by travel direction
  // only after the direction is known to be determinate.
  const legSeries: Record<'left' | 'right', Array<DriveSample | null>> = {
    left: [],
    right: [],
  }
  const legInterpolated: Record<'left' | 'right', boolean[]> = { left: [], right: [] }
  let resolvableLegFrames = 0

  for (const frame of frames) {
    for (const side of ['left', 'right'] as const) {
      const { hip, knee } = LEG_KEYPOINTS[side]
      const hipPt = resolvePoint(frame, hip)
      const kneePt = resolvePoint(frame, knee)

      if (hipPt === null || kneePt === null) {
        legSeries[side].push(null)
        legInterpolated[side].push(false)
        continue
      }

      resolvableLegFrames += 1
      const dx = kneePt.x - hipPt.x
      const dy = kneePt.y - hipPt.y
      // atan2(dx, dy): image-y grows downward, so a thigh hanging straight down (dx = 0, dy > 0)
      // reads 0°, and the sign reflects which screen-x side the knee sits toward — a purely
      // screen-relative quantity until travelDirection converts it below.
      const thighAngleDeg = (Math.atan2(dx, dy) * 180) / Math.PI
      legSeries[side].push({ t: frame.timestamp, v: thighAngleDeg })
      legInterpolated[side].push(hipPt.interpolated || kneePt.interpolated)
    }
  }

  if (resolvableLegFrames === 0) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable hip-knee position for either leg in this clip.',
    )
  }

  // Data-availability coverage across both legs' independent channels, mirroring kneeFlexion.
  const frameCoverage = resolvableLegFrames / (frames.length * 2)

  const bodyScale = estimateBodyScale(frames)
  if (bodyScale === null) {
    // Distinct from the indeterminate-direction case below: with no body-scale reference the
    // direction was never estimated at all, and "no net horizontal displacement" would name a
    // false cause (overstriding's precedent, same wording).
    return nullResult(
      viewFitEntry.fit,
      'No resolvable body-scale reference (shoulders/hips) in this clip.',
      frameCoverage,
    )
  }

  const travelDirection = estimateTravelDirection(frames, bodyScale)
  if (travelDirection === 0) {
    return nullResult(
      viewFitEntry.fit,
      'Direction of travel could not be determined (no net horizontal displacement) — forward knee lift cannot be told apart from the trailing leg swing.',
      frameCoverage,
    )
  }

  const minProminenceAbs = config.kneeDriveMinProminenceDegrees

  const peaks: DrivePeak[] = []
  // Kept per side rather than discarded with the minima: the trailing-swing troughs are what
  // makes a lift peak legible as a picture, and re-deriving them later would mean a second
  // extrema scan over the same series.
  const sideExtrema: Record<'left' | 'right', Extremum[]> = { left: [], right: [] }
  for (const side of ['left', 'right'] as const) {
    const signedSeries = legSeries[side].map((sample) =>
      sample === null ? null : { t: sample.t, v: sample.v * travelDirection },
    )
    const extrema = findLocalExtrema(signedSeries, minProminenceAbs)
    sideExtrema[side] = extrema
    extrema.forEach((extremum, extremaIndex) => {
      // Local maxima of the signed series with a positive value are forward-lift peaks; minima
      // are trailing-swing extremes, and a non-positive maximum (a trailing pivot at a series
      // boundary) is a thigh that never crossed the vertical — neither is the reported quantity.
      if (extremum.kind !== 'max' || extremum.value <= 0) return
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
      'No forward thigh-lift peaks could be detected in this clip.',
      frameCoverage,
    )
  }

  let interpolatedCount = 0
  const driveValues: number[] = []
  for (const peak of peaks) {
    driveValues.push(peak.valueDeg)
    if (legInterpolated[peak.side][peak.frameIndex]) interpolatedCount += 1
  }

  const sampleSize = driveValues.length
  const interpolatedFraction = interpolatedCount / sampleSize
  const value = median(driveValues)

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize,
    minRequiredSampleSize: MIN_KNEE_DRIVE_SAMPLE_SIZE,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveats: string[] = []
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Knee drive is a sagittal-plane measurement and is not reliable from ${viewPhrase(view)}.`,
    )
  }
  if (sampleSize < MIN_KNEE_DRIVE_SAMPLE_SIZE) {
    caveats.push(
      `Only ${sampleSize} thigh-lift peak(s) detected (recommend at least ${MIN_KNEE_DRIVE_SAMPLE_SIZE}) — confidence reduced accordingly.`,
    )
  }

  const exemplars = selectExemplars(
    buildExemplars(peaks, sideExtrema, frames, describeDistribution(driveValues)),
  )

  return {
    metric: 'kneeDrive',
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
