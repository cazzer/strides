import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { detectFootstrikes } from './footstrikes'
import { estimateBodyScale, estimateHipWidth } from './bodyScale'
import { analyzeHipBounce } from './hipBounce'
import { resolveExpectedStridePeriodSeconds, shortestPlausibleStrideSeconds } from './stridePeriod'
import { resolvePoint } from './keypoints'
import { median, percentile } from './mathUtils'
import { computeMetricConfidence } from './confidence'
import {
  cropKeypoints,
  describeDistribution,
  pairQuality,
  scoreExemplarInstant,
  selectExemplars,
} from './exemplars'
import { viewPhrase } from './viewDetection'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricExemplar, MetricResult, View } from './types'

type Side = 'left' | 'right'

// At n=6, p20 and p80 sit at sorted ranks 1 and 4: neither endpoint controls the range.
const MIN_INTERIOR_SAMPLES = 6
const LOW_QUANTILE = 0.2
const HIGH_QUANTILE = 0.8
const MIN_WINDOW_COVERAGE = 0.7
const MIN_WINDOWS_FOR_CONFIDENCE = 3
/**
 * The contact detector's fitted-bounce path has a documented late residual: +0.10–0.12 s on
 * Demo 1. On the front-approach clip, frame review shows landing by 0.700 s even though the
 * following detected strike lies about a quarter-step later. A strike-bound window therefore
 * includes stance if it runs right up to the detected strike. Reserve the terminal THIRD of
 * each clip-derived step interval for that uncertainty. This is a conservative phase exclusion,
 * not a seconds offset fitted to one video; the remaining range describes early-to-mid swing.
 * The guard reduces the risk of stance contamination; no image-only phase rule can certify
 * airborne status on every runner. A clip too short to retain six direct samples abstains.
 */
const TERMINAL_CONTACT_GUARD_FRACTION = 1 / 3
// A frame's hips must retain at least half the clip's usual separation and at least a tenth of
// torso length. These are conservative pose-resolution floors, not biomechanical thresholds.
const MIN_HIP_WIDTH_FRACTION_OF_MEDIAN = 0.5
const MIN_HIP_WIDTH_FRACTION_OF_TORSO = 0.1

interface SwingSample {
  frameIndex: number
  offset: number
  interpolated: boolean
}

interface SwingWindow {
  side: Side
  value: number
  samples: SwingSample[]
}

function nullResult(viewFit: MetricResult['viewFit'], caveat: string, frameCoverage = 0): MetricResult {
  return {
    metric: 'swingFootLateralExcursion',
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

function names(side: Side): { knee: KeypointName; ankle: KeypointName } {
  return side === 'left'
    ? { knee: 'left_knee', ankle: 'left_ankle' }
    : { knee: 'right_knee', ankle: 'right_ankle' }
}

/**
 * Signed ankle displacement from the same-side knee's vertical image line, divided by this
 * frame's bilateral hip width. The sign is retained only inside one swing's range calculation:
 * P80−P20 is invariant to camera mirroring, foot side, and front-versus-rear orientation.
 */
function sampleAt(
  frame: RobustPoseFrame,
  frameIndex: number,
  side: Side,
  minimumHipWidthPx: number,
): SwingSample | null {
  const { knee, ankle } = names(side)
  const kneePoint = resolvePoint(frame, knee)
  const anklePoint = resolvePoint(frame, ankle)
  const leftHip = resolvePoint(frame, 'left_hip')
  const rightHip = resolvePoint(frame, 'right_hip')
  if (kneePoint === null || anklePoint === null || leftHip === null || rightHip === null) {
    return null
  }
  const hipWidth = Math.abs(leftHip.x - rightHip.x)
  if (!(hipWidth > 0) || hipWidth < minimumHipWidthPx) return null
  return {
    frameIndex,
    offset: (anklePoint.x - kneePoint.x) / hipWidth,
    interpolated:
      kneePoint.interpolated || anklePoint.interpolated ||
      leftHip.interpolated || rightHip.interpolated,
  }
}

function nearest(samples: SwingSample[], target: number): SwingSample {
  return samples.reduce((best, sample) =>
    Math.abs(sample.offset - target) < Math.abs(best.offset - target) ? sample : best,
  )
}

function exemplarFor(window: SwingWindow, frames: RobustPoseFrame[]): MetricExemplar | null {
  const lowValue = percentile(window.samples.map((sample) => sample.offset), LOW_QUANTILE)
  const highValue = percentile(window.samples.map((sample) => sample.offset), HIGH_QUANTILE)
  const low = nearest(window.samples, lowValue)
  const high = nearest(window.samples, highValue)
  if (low.frameIndex === high.frameIndex) return null

  const { knee, ankle } = names(window.side)
  const seed = [knee, ankle]
  // These are the two quantile ends of ONE swing, not two independent typicality claims. The
  // quality gate judges whether each end's measured joints were actually detected.
  const distribution = describeDistribution([])
  const lowQuality = scoreExemplarInstant(
    { frame: frames[low.frameIndex], seed }, 'representative', distribution,
  )
  const highQuality = scoreExemplarInstant(
    { frame: frames[high.frameIndex], seed }, 'representative', distribution,
  )
  if (lowQuality === null || highQuality === null) return null

  return {
    kind: 'swingFootLateralRange',
    timestamp: frames[high.frameIndex].timestamp,
    pairedTimestamp: frames[low.frameIndex].timestamp,
    side: window.side,
    quality: pairQuality(lowQuality, highQuality),
    label: `The ${window.side} ankle farther to screen-right of its knee, ghosted against its more screen-left position during early-to-mid swing`,
    cropKeypoints: cropKeypoints(
      seed, ['left_hip', 'right_hip'], [frames[high.frameIndex], frames[low.frameIndex]],
    ),
  }
}

/**
 * Swing-foot lateral excursion is the median, over complete approximate swing windows, of the
 * P80−P20 range of ankle.x−same-side-knee.x divided by same-frame bilateral hip width. A window
 * starts at the other foot's detected contact and ends at this foot's next detected contact;
 * the terminal third is excluded because detected contact may lag visible landing. This is a
 * two-dimensional early-to-mid-swing foot-path measurement, not heel
 * rotation and not a clinical inward/outward classification. Both front and rear recordings show
 * the mediolateral axis; a side view largely hides it.
 */
export function computeSwingFootLateralExcursion(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFit = config.viewFitTable.swingFootLateralExcursion[view]
  const bodyScale = estimateBodyScale(frames)
  const hipScale = estimateHipWidth(frames)
  if (
    bodyScale === null || hipScale === null ||
    !(bodyScale.torsoLengthPx > 0) || !(hipScale.hipWidthPx > 0)
  ) {
    return nullResult(viewFit.fit, 'No resolvable torso and bilateral-hip scale in this clip.')
  }
  const minimumHipWidthPx = Math.max(
    MIN_HIP_WIDTH_FRACTION_OF_MEDIAN * hipScale.hipWidthPx,
    MIN_HIP_WIDTH_FRACTION_OF_TORSO * bodyScale.torsoLengthPx,
  )
  const strikes = detectFootstrikes(frames, config)
  if (strikes.length < 2) {
    return nullResult(viewFit.fit, 'At least two alternating footstrikes are needed to bound a swing.')
  }
  const rhythm = analyzeHipBounce(frames, config).fit
  if (!rhythm.ok || rhythm.sinusoidR2 < config.cadenceMinFitR2) {
    return nullResult(viewFit.fit, 'No trustworthy step rhythm was measured to verify swing duration.')
  }
  const expectedStrideSeconds = resolveExpectedStridePeriodSeconds(rhythm.frequencyHz)
  if (expectedStrideSeconds === null) {
    return nullResult(viewFit.fit, 'No trustworthy step period was measured to verify swing duration.')
  }
  // A single step must be shorter than the shortest plausible full stride. This reuses the
  // repo's existing fitted-period tolerance: if two contacts are ~3 steps apart because two
  // detections vanished, treating their interval as one swing would pool stance and flight.
  const maxSingleStepSeconds = shortestPlausibleStrideSeconds(expectedStrideSeconds)

  const windows: SwingWindow[] = []
  let availableFrames = 0
  let usableFrames = 0
  for (let i = 1; i < strikes.length; i += 1) {
    const start = strikes[i - 1]
    const end = strikes[i]
    if (start.side === end.side) continue
    const contactGuardStart = end.timestamp -
      TERMINAL_CONTACT_GUARD_FRACTION * (end.timestamp - start.timestamp)
    const interiorIndices: number[] = []
    for (let frameIndex = start.frameIndex + 1; frameIndex < end.frameIndex; frameIndex += 1) {
      if (frames[frameIndex].timestamp < contactGuardStart) interiorIndices.push(frameIndex)
    }
    const interiorCount = interiorIndices.length
    availableFrames += interiorCount
    if (!(end.timestamp > start.timestamp) ||
        end.timestamp - start.timestamp >= maxSingleStepSeconds) continue
    if (!start.ankleMeasurable || !end.ankleMeasurable) continue
    if (interiorCount < MIN_INTERIOR_SAMPLES) continue
    const samples: SwingSample[] = []
    for (const frameIndex of interiorIndices) {
      const sample = sampleAt(frames[frameIndex], frameIndex, end.side, minimumHipWidthPx)
      // This is a percentile range: interpolated points can move a quantile toward a bad
      // anchor, so the shared heuristic policy excludes them rather than discounting them.
      if (sample !== null && !sample.interpolated) samples.push(sample)
    }
    const coverage = samples.length / interiorCount
    if (samples.length < MIN_INTERIOR_SAMPLES || coverage < MIN_WINDOW_COVERAGE) continue
    usableFrames += samples.length
    const offsets = samples.map((sample) => sample.offset)
    windows.push({
      side: end.side,
      value: percentile(offsets, HIGH_QUANTILE) - percentile(offsets, LOW_QUANTILE),
      samples,
    })
  }

  const frameCoverage = availableFrames === 0 ? 0 : usableFrames / availableFrames
  if (windows.length === 0) {
    return nullResult(
      viewFit.fit,
      'No single-step swing had enough directly detected early-to-mid knee, ankle, and bilateral-hip frames.',
      frameCoverage,
    )
  }

  const values = windows.map((window) => window.value)
  const value = median(values)
  // No interpolated point contributes to the extreme-quantile populations. The excluded frames
  // instead reduce frameCoverage, including every rejected complete candidate window.
  const interpolatedFraction = 0
  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFit.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize: windows.length,
    minRequiredSampleSize: MIN_WINDOWS_FOR_CONFIDENCE,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveats: string[] = []
  if (viewFit.fit === 'unsuitable') {
    caveats.push(`Sideways foot travel is not reliable from ${viewPhrase(view)}.`)
  }
  if (windows.length < MIN_WINDOWS_FOR_CONFIDENCE) {
    caveats.push(`Only ${windows.length} complete ${windows.length === 1 ? 'swing was' : 'swings were'} usable; confidence is reduced.`)
  }

  const representative = [...windows].sort(
    (a, b) => Math.abs(a.value - value) - Math.abs(b.value - value),
  )
  const exemplars = selectExemplars(
    representative.flatMap((window) => {
      const exemplar = exemplarFor(window, frames)
      return exemplar === null ? [] : [exemplar]
    }),
  )

  return {
    metric: 'swingFootLateralExcursion',
    value,
    unit: 'percent',
    confidence,
    viewFit: viewFit.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize: windows.length,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
    ...(exemplars && { exemplars }),
  }
}
