import type { FormHeuristicsResult } from '../heuristics/types'

/**
 * Appended to the grafted metric's caveat so the one scale-pass-sourced number on the panel
 * names where it came from — every other card is the primary pass's. Asserted verbatim by unit
 * tests and surfaced verbatim in the UI; do not reword without updating both.
 */
export const SCALE_PASS_PROVENANCE_CAVEAT =
  'Measured in a second pass of the same clip.'

/**
 * Grafts a completed background scale pass's `verticalOscillationCm` onto the primary pass's
 * result (D3) — the ONE metric the scale pass exists to provide. Pure and composed OUTSIDE
 * `src/heuristics/`: the heuristics layer computes one result from one set of frames and knows
 * nothing about passes; combining two passes' results is the results layer's policy.
 *
 * - Every other metric, and `view`, stay reference-identical to `primary`'s — the scale pass's
 *   versions of them are deliberately discarded (MoveNet remains the better primary for all
 *   eight; see the change's proposal.md for the assessed evidence).
 * - `calibration` carries by reference, preserving the identity invariant #36 established
 *   (`scalePass.diagnostics.scaleCalibration === grafted.verticalOscillationCm.calibration`).
 * - The provenance sentence is appended after the scale result's own caveat when one exists
 *   (space-joined, the same composition idiom the heuristics layer's multi-caveat paths use).
 *   A measured-but-unfittable scale result grafts too — its named fit-failure caveat plus
 *   provenance replaces the primary's "no scale could be measured" availability caveat, which
 *   after a completed MediaPipe pass would be false.
 *
 * The caller (`useVideoAnalysis.ts`) only invokes this when the scale result's `calibration` is
 * non-null — a pass that measured no scale at all is a failed pass, not a graft. Neither input
 * is mutated.
 */
export function graftScalePassResult(
  primary: FormHeuristicsResult,
  scale: FormHeuristicsResult,
): FormHeuristicsResult {
  return {
    ...primary,
    verticalOscillationCm: {
      ...scale.verticalOscillationCm,
      caveat: [scale.verticalOscillationCm.caveat, SCALE_PASS_PROVENANCE_CAVEAT]
        .filter(Boolean)
        .join(' '),
    },
  }
}
