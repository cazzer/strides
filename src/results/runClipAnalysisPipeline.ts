import { applyRobustness } from '../pose/robustness/interpolate'
import type { PoseSample, RobustPoseFrame } from '../pose/robustness/types'
import { computeFormHeuristics } from '../heuristics/index'
import type { FormHeuristicsResult } from '../heuristics/types'
import { trimToPresenceWindow } from '../heuristics/presenceWindow'
import { computeAnalysisDiagnostics } from './analysisDiagnostics'
import type { AnalysisDiagnostics } from './analysisDiagnostics'
import { selectRetroactivePersonOfInterest } from './retroactivePersonSelection'
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
 * The synchronous half of one clip's analysis run: sort → `selectRetroactivePersonOfInterest` →
 * `applyRobustness` → `trimToPresenceWindow` → `computeFormHeuristics` →
 * `computeAnalysisDiagnostics`. Extracted mechanically from `useVideoAnalysis.ts`, where this
 * exact sequence was duplicated once in `start()`'s IIFE and once in the background scale pass's
 * effect — both call sites now call this instead, and the two are otherwise unchanged (async
 * sampling, ref/state bookkeeping, run-id guarding all stay in the hook). Pure: no ref/state
 * access, safe to call from either pipeline branch or a test in isolation.
 *
 * Person selection sits immediately after the sort and before everything else, which is the only
 * position that works: it needs timestamp order to measure continuity, and every later stage must
 * see the selected subject's frames and nothing else. Its output feeds BOTH `applyRobustness` and
 * `computeAnalysisDiagnostics`, so the overlay, the diagnostics and the metrics all describe the
 * same person — a diagnostics object built from the pre-selection samples would report frames the
 * metrics never saw.
 */
export function runClipAnalysisPipeline(
  samples: PoseSample[],
  samplingRobustnessConfig: SamplingRobustnessConfig,
  samplingPath: 'sequential' | 'playback',
  /** The source clip's pixel dimensions, which person selection needs to resolve its
   * frame-fraction area floor into absolute px². An unusable size (zero, negative, non-finite) is
   * not an error — the stage skips and reports `'unknown-frame-size'`. */
  frameSize: { width: number; height: number },
): ClipPipelineResult {
  // Cheap mitigation for mid-analysis scrubbing producing non-monotonic timestamps —
  // interpolate.ts's existing gapSeconds > 0 guard already degrades non-positive gaps to
  // 'unrecoverable' rather than crashing, so this is belt-and-suspenders. It is also person
  // selection's documented precondition, which is why that stage goes immediately after.
  const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp)
  const { samples: selected, diagnostics: personSelection } =
    selectRetroactivePersonOfInterest(
      sorted,
      frameSize.width,
      frameSize.height,
      samplingRobustnessConfig.personSelection,
    )
  const robustFrames = applyRobustness(selected, samplingRobustnessConfig.robustness)
  const metricFrames = trimToPresenceWindow(robustFrames)
  const heuristics = computeFormHeuristics(metricFrames)
  const diagnostics = computeAnalysisDiagnostics(
    selected,
    robustFrames,
    heuristics,
    samplingPath,
    personSelection,
  )
  return { robustFrames, heuristics, diagnostics }
}
