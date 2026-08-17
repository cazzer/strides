import type { FormHeuristicsResult, MetricResult } from '../heuristics/types'

/**
 * Appended to the grafted metric's caveat so the one scale-pass-sourced number on the panel
 * names where it came from — every other card is the primary pass's. Worded to read correctly
 * after both a value's own caveats and a fit-failure explanation ("…too irregular to measure.
 * From a second look…"), and to match the "second look" phrasing every other scale-pass surface
 * uses. Asserted verbatim by unit tests and surfaced verbatim in the UI; do not reword without
 * updating both.
 */
export const SCALE_PASS_PROVENANCE_CAVEAT =
  'From a second look at the same clip.'

/**
 * Appends the provenance sentence to one scale-pass-sourced metric's own caveat (space-joined,
 * the same composition idiom the heuristics layer's multi-caveat paths use) — the shared shape
 * behind grafting either `verticalOscillationCm` or `stepWidthCm` below.
 */
function withProvenance<T extends MetricResult>(scaleMetric: T): T {
  return {
    ...scaleMetric,
    caveat: [scaleMetric.caveat, SCALE_PASS_PROVENANCE_CAVEAT].filter(Boolean).join(' '),
  }
}

/**
 * Grafts a completed background scale pass's `verticalOscillationCm` AND `stepWidthCm` onto the
 * primary pass's result (D3; extended to `stepWidthCm` by #45) — the metrics the scale pass
 * exists to provide. Pure and composed OUTSIDE `src/heuristics/`: the heuristics layer computes
 * one result from one set of frames and knows nothing about passes; combining two passes'
 * results is the results layer's policy.
 *
 * Extending the graft to `stepWidthCm` rather than scoping it to MediaPipe-primary-only was a
 * deliberate call, not an oversight: the caller's gate for even running the pass at all
 * (`heuristics.verticalOscillationCm.calibration !== null`, in `useVideoAnalysis.ts`) already
 * tests the exact same underlying fact — a measured `pixelsPerMeter` — that gates `stepWidthCm`,
 * so extending the graft costs no new branch anywhere in the decision to run the pass; it only
 * widens what gets pulled out of an already-computed scale-pass result.
 *
 * - Every other metric, and `view`, stay reference-identical to `primary`'s — the scale pass's
 *   versions of them are deliberately discarded (MoveNet remains the better primary for the
 *   rest; see the change's proposal.md for the assessed evidence).
 * - `calibration` carries by reference, preserving the identity invariant #36 established
 *   (`scalePass.diagnostics.scaleCalibration === grafted.verticalOscillationCm.calibration`).
 *   `stepWidthCm` has no such companion object to carry — see its own module doc for why.
 * - The provenance sentence is appended after each grafted metric's own caveat when one exists.
 *   A measured-but-unfittable/no-footstrikes scale result grafts too — its named caveat plus
 *   provenance replaces the primary's "no scale could be measured" availability caveat, which
 *   after a completed MediaPipe pass would be false.
 *
 * The caller (`useVideoAnalysis.ts`) only invokes this when the scale result's
 * `verticalOscillationCm.calibration` is non-null — a pass that measured no scale at all is a
 * failed pass, not a graft. `stepWidthCm` grafts unconditionally alongside it once that gate
 * passes: a clip that measured scale but found no footstrikes for step width still grafts its own
 * null value and caveat, independently of whatever `verticalOscillationCm` did. Neither input is
 * mutated.
 */
export function graftScalePassResult(
  primary: FormHeuristicsResult,
  scale: FormHeuristicsResult,
): FormHeuristicsResult {
  return {
    ...primary,
    verticalOscillationCm: withProvenance(scale.verticalOscillationCm),
    stepWidthCm: withProvenance(scale.stepWidthCm),
  }
}

/**
 * Appended after the provenance sentence when the two passes' independently selected subjects are
 * judged to have diverged (#56, `scalePassSubjectAgreement.ts`). Reads correctly in sequence —
 * "…From a second look at the same clip. This second look may have measured a different person
 * than the other metrics." — reuses the "second look" phrasing every other scale-pass surface
 * uses, names no backend, and is honest under uncertainty in both directions ("may have").
 * Asserted verbatim by unit tests and surfaced verbatim in the UI; do not reword without updating
 * both.
 */
export const SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT =
  'This second look may have measured a different person than the other metrics.'

/**
 * Appends the divergence sentence to the two scale-pass-sourced metrics' caveats and nothing else,
 * composing OVER an already-grafted result so the sentence lands after provenance rather than
 * before it.
 *
 * Split from `graftScalePassResult` rather than folded into it (as a third parameter, say) so that
 * function's stated contract — unconditional, gated entirely by its caller — stays literally true,
 * and so the graft's own tests keep exercising the graft alone. The caller composes the two.
 *
 * Divergence caveats the grafted numbers; it never withholds or alters them. Suppression would
 * mean shipping an unvalidated metric-removal path on a signal that has never fired on real
 * footage — see the change's design.md D2 for why the asymmetry decides it.
 */
export function withSubjectDivergenceCaveat(
  result: FormHeuristicsResult,
): FormHeuristicsResult {
  return {
    ...result,
    verticalOscillationCm: {
      ...result.verticalOscillationCm,
      caveat: [result.verticalOscillationCm.caveat, SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT]
        .filter(Boolean)
        .join(' '),
    },
    stepWidthCm: {
      ...result.stepWidthCm,
      caveat: [result.stepWidthCm.caveat, SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT]
        .filter(Boolean)
        .join(' '),
    },
  }
}
