import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type { KeypointName } from '../pose/types'
import type { PoseSample } from '../pose/robustness/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type {
  FormHeuristicsResult,
  MetricId,
  VerticalOscillationFit,
  ViewFit,
} from '../heuristics/types'
import type { ScaleCalibratedVerticalOscillation } from '../heuristics/verticalOscillationCm'

export interface KeypointResolutionStats {
  detected: number
  interpolated: number
  unrecoverable: number
}

export interface MetricDiagnostics {
  value: number | null
  confidence: number
  viewFit: ViewFit
  frameCoverage: number
  interpolatedFraction: number
  sampleSize: number
  caveat: string | null
}

export interface AnalysisDiagnostics {
  sampling: {
    totalSamples: number
    detectedFrames: number
    missingFrames: number
  }
  view: FormHeuristicsResult['view']
  keypoints: Record<KeypointName, KeypointResolutionStats>
  metrics: Record<MetricId, MetricDiagnostics>
  /** Vertical oscillation's spectral-fit internals — fitted frequency, fit quality, cycle count.
   * `null` whenever that metric reported no value, per its own `fit`/`value` invariant. Broken out
   * rather than folded into `metrics.verticalOscillation` because `MetricDiagnostics` is uniform
   * across all seven metrics on purpose, and only this one has a fit behind it. */
  verticalOscillationFit: VerticalOscillationFit | null
  /**
   * Present only when the detection backend measured a real-world scale (today: MediaPipe Pose
   * Landmarker). The key is ABSENT — not `null`, not `undefined` — on every other backend, so a
   * MoveNet run serializes to exactly the JSON it did before this existed, and a harness can test
   * `'scaleCalibration' in diagnostics` to tell "not measured" from "measured nothing".
   *
   * Unlike every other field here, this one reflects the presence-trimmed window (the same frames
   * `computeFormHeuristics` sees) rather than the full clip — it has to, for its figures to be
   * comparable with the metrics it sits alongside.
   */
  scaleCalibration?: ScaleCalibratedVerticalOscillation
}

function emptyKeypointStats(): Record<KeypointName, KeypointResolutionStats> {
  const stats = {} as Record<KeypointName, KeypointResolutionStats>
  for (const name of COMMON_KEYPOINT_NAMES) {
    stats[name] = { detected: 0, interpolated: 0, unrecoverable: 0 }
  }
  return stats
}

/**
 * Pure aggregation over data the analysis pipeline already produces — no new instrumentation of
 * sampling or robustness. Built for development-time diagnosis of why a given clip's confidence
 * came out low, not for end users (see `useVideoAnalysis.ts`'s dev-only auto-log of this).
 */
export function computeAnalysisDiagnostics(
  samples: PoseSample[],
  robustFrames: RobustPoseFrame[],
  heuristics: FormHeuristicsResult,
  scaleCalibration?: ScaleCalibratedVerticalOscillation | null,
): AnalysisDiagnostics {
  const detectedFrames = samples.filter((s) => s.frame !== null).length

  const keypoints = emptyKeypointStats()
  for (const frame of robustFrames) {
    for (const kp of frame.keypoints) {
      keypoints[kp.name][kp.status] += 1
    }
  }

  const metricEntries = Object.entries(heuristics).filter(
    (entry): entry is [MetricId, FormHeuristicsResult[MetricId]] => entry[0] !== 'view',
  )
  const metrics = {} as Record<MetricId, MetricDiagnostics>
  for (const [id, metric] of metricEntries) {
    metrics[id] = {
      value: metric.value,
      confidence: metric.confidence,
      viewFit: metric.viewFit,
      frameCoverage: metric.frameCoverage,
      interpolatedFraction: metric.interpolatedFraction,
      sampleSize: metric.sampleSize,
      caveat: metric.caveat,
    }
  }

  return {
    sampling: {
      totalSamples: samples.length,
      detectedFrames,
      missingFrames: samples.length - detectedFrames,
    },
    view: heuristics.view,
    keypoints,
    metrics,
    verticalOscillationFit: heuristics.verticalOscillation.fit,
    // Conditional spread, not `scaleCalibration: scaleCalibration ?? undefined`: an explicitly
    // `undefined` property is still a present key to `toStrictEqual`/`in`, and "this backend
    // doesn't measure scale" has to be indistinguishable from the pre-existing output shape.
    ...(scaleCalibration == null ? {} : { scaleCalibration }),
  }
}
