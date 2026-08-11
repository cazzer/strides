import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type { KeypointName } from '../pose/types'
import type { PoseSample } from '../pose/robustness/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { FormHeuristicsResult, MetricId, ViewFit } from '../heuristics/types'

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
  }
}
