import type { FormHeuristicsResult, MetricId, MetricResult } from '../heuristics/types'

/**
 * The metrics `graftScalePassResult` replaces — the ones whose value comes from the background
 * MediaPipe scale pass rather than from the primary pass, stated once, here, by the module that
 * does the replacing.
 *
 * It exists because a grafted metric's *value* and its *frames* have to travel together, and the
 * consumer that needs to know which is which (`evidenceFrames.ts`, planning that metric's
 * evidence) sits below the annotation layer that first needed the same list. A set here rather
 * than a second reading of this file's body, and `graftScalePassResult` is pinned against it by
 * test so the two cannot drift.
 *
 * **Membership is not by itself a claim that a given result WAS grafted.** A MediaPipe-primary run
 * computes both of these in the primary pass and no graft happens at all. Whether a particular
 * result's copies came from the scale pass is answered by whether that pass's frames are present
 * beside them — see `ScalePassState.robustFrames` — never by this set alone.
 */
export const GRAFTED_METRIC_IDS: ReadonlySet<MetricId> = new Set<MetricId>([
  'verticalOscillationCm',
  'stepWidthCm',
])

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
 * - `exemplars` carry with the grafted objects, unaltered — the scale pass's OWN instants, and
 *   both passes sample the same clip on the same media clock, so the timestamps stay meaningful.
 *   (Measured on all three test clips: every sampled timestamp is shared EXACTLY between the two
 *   passes — 228/228, 99/99, 233/233 — so this is an equality, not a near-miss.)
 *
 *   The scale pass's `RobustPoseFrame[]` now carry too, alongside the metrics, on
 *   `ScalePassState.robustFrames` (`strides-3a1`). They have to: an exemplar's timestamp names an
 *   instant, but everything an annotation draws at that instant — each joint's position, and the
 *   hip ORDER a caliper's polarity is read from — is a property of the FRAME, and reading it off
 *   the primary pass's frame attributes one detector's estimate to another detector's measurement.
 *
 *   That was not a theoretical tidiness point. Measured live, 2026-08-31, real GPU, at every
 *   instant where both passes resolved both hips: the two order the hips OPPOSITELY on 15/57
 *   instants of the side-view demo (26%), 15/87 of the multi-person clip (17%), and 0/98 of the
 *   front-approach demo — the front view separates the hips by ~93 px, where the other two leave
 *   them ~9-32 px apart and a few pixels of detector disagreement flips the sign. Of the twelve
 *   grafted exemplar instants those three clips actually plan, THREE carry the inverse ordering.
 *   Positions disagree materially too: hip-mid lands a median 31.5 px apart on the side-view demo,
 *   ~7% of a torso length.
 *
 *   `scalePassSubjectAgreement.ts` does not and cannot catch this: it compares bounding-box HULLS,
 *   which are identical under a left/right relabelling. The side-view demo reports `'agreed'` at
 *   52/53 on the same run where 26% of its instants order the hips oppositely — the two passes
 *   agree about WHO, and disagree about WHICH SIDE. Both statements are true at once and neither
 *   substitutes for the other.
 *
 *   A grafted timestamp still yields no evidence where no frame of its own pass resolves it;
 *   widening a tolerance to rescue one would be inventing a frame.
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
 * Divergence caveats the grafted NUMBERS; it never withholds or alters them. Suppression would
 * mean shipping an unvalidated metric-removal path on a signal that has never fired on real
 * footage — see the change's design.md D2 for why the asymmetry decides it. Their exemplar
 * IMAGES are a different question and get the opposite answer — see `dropGraftedExemplars`, which
 * the caller composes with this one.
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

/** Removes the key rather than emptying it: `exemplars` is ABSENT when a metric has no instants
 * to show, never an empty array, so "this metric shows nothing" never reads as "its instants went
 * missing". Returns the input untouched when there was nothing to remove. */
function withoutExemplars<T extends MetricResult>(metric: T): T {
  if (metric.exemplars === undefined) return metric
  const stripped = { ...metric }
  delete stripped.exemplars
  return stripped
}

/**
 * Drops the two scale-pass-sourced metrics' exemplars, and nothing else — composed over an
 * already-grafted result by the same caller, under the same condition, as
 * `withSubjectDivergenceCaveat`.
 *
 * Why an image is treated more harshly than the number it captions: a diverged verdict (#56) means
 * the two passes selected DIFFERENT PEOPLE. The grafted number is then honestly caveated as
 * possibly somebody else's and the reader can weigh it. An exemplar cannot be caveated the same
 * way — its crop geometry resolves against the PRIMARY pass's frames (the only ones any consumer
 * holds), so it would picture the primary pass's subject under a number the scale pass measured
 * about a different one, asserting an identity that a sentence beside it merely doubts. Withdrawing
 * the picture costs a metric its evidence on a clip whose scale pass already disagrees with itself
 * about who was measured; showing it would be a confident visual claim that is wrong.
 */
export function dropGraftedExemplars(result: FormHeuristicsResult): FormHeuristicsResult {
  return {
    ...result,
    verticalOscillationCm: withoutExemplars(result.verticalOscillationCm),
    stepWidthCm: withoutExemplars(result.stepWidthCm),
  }
}
