import { DEFAULT_VIEW_FIT_TABLE } from '../heuristics/types'
import type { FormHeuristicsResult, HeuristicsConfig, MetricId, MetricResult, View } from '../heuristics/types'

/** A committed camera view a clip can be detected as. `ambiguous` is the absence of one. */
export type CommittedView = Exclude<View, 'ambiguous'>

const COMMITTED_VIEWS: readonly CommittedView[] = ['side', 'front']

/** One missing view, and the measurements the session lost for want of it. */
export interface MissingViewNeed {
  view: CommittedView
  /** In `FormHeuristicsResult` key order, which is the classic panel's order. */
  metrics: MetricId[]
}

export interface SessionCoverage {
  /** Which committed views at least one clip was detected as. */
  present: Record<CommittedView, boolean>
  /** Empty when nothing is missing for an angle reason — the notice renders nothing then. */
  needs: MissingViewNeed[]
}

/**
 * PURE. What the session's camera coverage cost it (`strides-pz0u`): for each committed view no clip
 * was detected as, the measurements that are unmeasured BECAUSE the angle was wrong and for which
 * that view is the primary one.
 *
 * Read straight off the FUSED result's own `viewFit`, never re-derived. `'unsuitable'` is exactly
 * the verdict that excluded the metric for its angle (`metricTier`), so a metric that was excluded
 * for too few samples, a failed fit or a missing scale is never blamed on the camera. And it says a
 * view is *needed*, not that one would produce a number — a clip from that view can still fail on
 * any of those other grounds, which is why nothing here promises a value.
 */
export function sessionCoverage(
  clipViews: readonly View[],
  heuristics: FormHeuristicsResult,
  viewFitTable: HeuristicsConfig['viewFitTable'] = DEFAULT_VIEW_FIT_TABLE,
): SessionCoverage {
  const present: Record<CommittedView, boolean> = {
    side: clipViews.includes('side'),
    front: clipViews.includes('front'),
  }
  const metricIds = (Object.keys(heuristics) as Array<keyof FormHeuristicsResult>).filter(
    (key): key is MetricId => key !== 'view' && key in viewFitTable,
  )
  const needs: MissingViewNeed[] = []
  for (const view of COMMITTED_VIEWS) {
    if (present[view]) continue
    const metrics = metricIds.filter((id) => {
      const metric = heuristics[id] as MetricResult
      return metric.viewFit === 'unsuitable' && viewFitTable[id][view].fit === 'primary'
    })
    if (metrics.length > 0) needs.push({ view, metrics })
  }
  return { present, needs }
}
