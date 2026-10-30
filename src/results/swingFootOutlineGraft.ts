import type { FormHeuristicsResult, SwingFootLateralExcursionResult } from '../heuristics/types'

/**
 * The outline pass's graft (`strides-uz48`): replaces `swingFootLateralExcursion` and NOTHING
 * else. Every other key of the displayed result keeps its reference, which is what makes "no
 * other metric's value or evidence can change" a structural property rather than a promise.
 */
export function graftOutlineResult(
  primary: FormHeuristicsResult,
  summarized: SwingFootLateralExcursionResult,
): FormHeuristicsResult {
  return { ...primary, swingFootLateralExcursion: summarized }
}

export const OUTLINE_FAILED_CAVEAT =
  "The closer look that checks sideways foot travel couldn't run on this clip."
export const OUTLINE_PLAYBACK_PATH_CAVEAT =
  'This check needs a clip the browser can decode frame by frame.'

/** The planned metric with no reading: value null, confidence 0, the reason as its caveat. The
 * plan rides along for diagnosis; evidence is dropped (there was never any). */
export function withOutlineUnavailable(
  primary: FormHeuristicsResult,
  reason: 'failed' | 'playback-path',
): FormHeuristicsResult {
  const metric = primary.swingFootLateralExcursion
  const unavailable: SwingFootLateralExcursionResult = {
    metric: metric.metric,
    value: null,
    unit: metric.unit,
    confidence: 0,
    viewFit: metric.viewFit,
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat: reason === 'failed' ? OUTLINE_FAILED_CAVEAT : OUTLINE_PLAYBACK_PATH_CAVEAT,
    outlinePlan: metric.outlinePlan ?? null,
    outline: null,
  }
  return graftOutlineResult(primary, unavailable)
}
