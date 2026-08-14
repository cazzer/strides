import { applyRobustness } from '../pose/robustness/interpolate'
import type { PoseSample, RobustPoseFrame } from '../pose/robustness/types'
import { computeFormHeuristics } from '../heuristics/index'
import type { FormHeuristicsResult } from '../heuristics/types'
import { trimToPresenceWindow } from '../heuristics/presenceWindow'
import { computeAnalysisDiagnostics } from './analysisDiagnostics'
import type { AnalysisDiagnostics } from './analysisDiagnostics'
import type { SamplingRobustnessConfig } from './samplingRobustnessConfig'

export interface ClipPipelineResult {
  /** Untrimmed — every sampled frame, for the skeleton overlay and diagnostics, which should
   * keep showing the full, honest picture of the whole clip. */
  robustFrames: RobustPoseFrame[]
  /** Computed over the presence-trimmed window (excludes stretches where the subject isn't in
   * frame at all), so frameCoverage/confidence aren't diluted by dead time. */
  heuristics: FormHeuristicsResult
  diagnostics: AnalysisDiagnostics
}

/**
 * The synchronous half of one clip's analysis run: sort → `applyRobustness` →
 * `trimToPresenceWindow` → `computeFormHeuristics` → `computeAnalysisDiagnostics`. Extracted
 * mechanically from `useVideoAnalysis.ts`, where this exact sequence was duplicated once in
 * `start()`'s IIFE and once in the background scale pass's effect — both call sites now call
 * this instead, and the two are otherwise unchanged (async sampling, ref/state bookkeeping,
 * run-id guarding all stay in the hook). Pure: no ref/state access, safe to call from either
 * pipeline branch or a test in isolation.
 */
export function runClipAnalysisPipeline(
  samples: PoseSample[],
  samplingRobustnessConfig: SamplingRobustnessConfig,
  samplingPath: 'sequential' | 'playback',
): ClipPipelineResult {
  // Cheap mitigation for mid-analysis scrubbing producing non-monotonic timestamps —
  // interpolate.ts's existing gapSeconds > 0 guard already degrades non-positive gaps to
  // 'unrecoverable' rather than crashing, so this is belt-and-suspenders.
  const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp)
  const robustFrames = applyRobustness(sorted, samplingRobustnessConfig.robustness)
  const metricFrames = trimToPresenceWindow(robustFrames)
  const heuristics = computeFormHeuristics(metricFrames)
  const diagnostics = computeAnalysisDiagnostics(sorted, robustFrames, heuristics, samplingPath)
  return { robustFrames, heuristics, diagnostics }
}
