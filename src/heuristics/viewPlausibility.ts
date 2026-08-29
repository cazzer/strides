import type {
  HeuristicsConfig,
  MetricId,
  View,
  ViewFitEntry,
  ViewPlausibility,
} from './types'
import { clamp01 } from './mathUtils'

/**
 * Nothing is known about the camera: all the mass sits on `'ambiguous'`, so every metric is
 * judged purely by its `ambiguous` row. Returned whenever a signal is missing entirely, and used
 * by `detectView` for the below-coverage-floor early return.
 */
export const AMBIGUOUS_VIEW_PLAUSIBILITY: ViewPlausibility = {
  side: 0,
  front: 0,
  ambiguous: 1,
}

/**
 * How strongly one signal supports one view: 1 at or beyond `fullSupport`, 0 at or beyond
 * `noSupport`, linear across the band between them.
 *
 * The two endpoints are the two views' OWN thresholds for this signal — the band between them is
 * exactly the region the config already declares undecided (neither view gets a vote there), so
 * this introduces no tunable of its own. Saturating AT the far view's threshold rather than some
 * distance past it is deliberate: `sideViewMaxBilateralSpreadRatio` etc. are declared as the
 * points at which a signal votes for a view, so a value that has cleared one is full support for
 * it by the config's own definition. (`viewDetection.ts`'s `confidence` asks a different question
 * — how far past its OWN threshold a signal sits, on the way to what a dead-on view of that kind
 * reads — so its `signalMargin` saturates at an ideal-camera value rather than at the far view's
 * threshold. Both endpoints are now reachable there too; the `2x the threshold` saturation that
 * put the front BSR margin at roughly twice the anatomical maximum was `strides-2iw` and is gone.)
 *
 * A degenerate config whose two thresholds cross (or coincide) collapses to a step at
 * `fullSupport` rather than dividing by zero.
 */
function signalSupport(
  value: number,
  fullSupport: number,
  noSupport: number,
): number {
  if (noSupport <= fullSupport) return value <= fullSupport ? 1 : 0
  return clamp01((noSupport - value) / (noSupport - fullSupport))
}

/**
 * Turns view detection's two raw signals into a weighting over the three views, replacing the
 * committed LABEL as the thing metric gating reads.
 *
 * Why a weighting at all, rather than propagating `ViewDetectionResult.confidence`: that scalar
 * measures how far a signal sits past its own threshold, which is a different question from which
 * view the data supports. On the front-approach demo clip the two answers diverge completely —
 * BSR clears the front bar by 0.13% (so the margin reads 0.0771) while BOTH of side view's
 * conditions fail by more than a factor of two (so side is ruled out, and front is the only view
 * left standing). Multiplying metric confidence by 0.0771 there would degrade `armSwingSymmetry`
 * toward its `ambiguous` row — i.e. delete it — on the strength of a side view the geometry
 * positively excludes.
 *
 * Construction, in the config's own terms:
 *   - each signal contributes a support in [0, 1] for each of the two committed views, ramping
 *     across the undecided band between those views' thresholds (`signalSupport` above);
 *   - a view's plausibility is the PRODUCT of the two signals' support for it — the continuous
 *     form of the existing "two independent signals must AGREE before committing" rule, so one
 *     signal alone can never carry a view;
 *   - `ambiguous` takes the remainder. `side + front <= 1` always holds
 *     (`a*b + (1-a)*(1-b) = 1 - (a*(1-b) + b*(1-a)) <= 1`), with equality only at the two corners
 *     where both signals fully agree, so the remainder is a real quantity and not a fudge.
 *
 * Body-scale sample coverage is deliberately NOT folded in, even though `confidence` scales by
 * it. It gates this stage rather than weighting it — below `minViewDetectionFrameCoverage` the
 * caller returns `AMBIGUOUS_VIEW_PLAUSIBILITY` outright — and every metric already multiplies its
 * own `frameCoverage` into its confidence over the same frames, so blending it here would charge
 * most metrics for the same missing frames twice.
 */
export function computeViewPlausibility(
  bilateralSpreadRatio: number | null,
  sagittalExcursionRatio: number | null,
  config: HeuristicsConfig,
): ViewPlausibility {
  if (bilateralSpreadRatio === null || sagittalExcursionRatio === null) {
    // One signal cannot commit to a view on its own — the same rule the label's two-vote
    // requirement encodes — so a missing signal leaves nothing standing but ambiguity.
    return AMBIGUOUS_VIEW_PLAUSIBILITY
  }

  // Small BSR is side-like (left/right collapse together), large is front-like.
  const bsrSideSupport = signalSupport(
    bilateralSpreadRatio,
    config.sideViewMaxBilateralSpreadRatio,
    config.frontViewMinBilateralSpreadRatio,
  )
  // Small SER is front-like (fore-aft reach hidden in depth), large is side-like.
  const serFrontSupport = signalSupport(
    sagittalExcursionRatio,
    config.frontViewMaxSagittalExcursionRatio,
    config.sideViewMinSagittalExcursionRatio,
  )

  const side = bsrSideSupport * (1 - serFrontSupport)
  const front = (1 - bsrSideSupport) * serFrontSupport

  return { side, front, ambiguous: clamp01(1 - side - front) }
}

/**
 * The view a metric's categorical `viewFit` is named after: the one holding the most plausibility
 * mass, with `'ambiguous'` winning ties.
 *
 * `fit` is a claim about what the camera geometry can support, so it names the geometry we most
 * believe we have, while the multiplier (a quantity) averages over all three rows — one rule each,
 * matched to what the two things are. Ties go to `'ambiguous'` because committing needs
 * agreement, and a tie is not agreement. `side` and `front` can never tie for the maximum: equal
 * plausibility forces both to `a*(1-a) <= 0.25`, always below the remaining ambiguous mass.
 */
export function mostPlausibleView(plausibility: ViewPlausibility): View {
  const { side, front, ambiguous } = plausibility
  if (side > ambiguous && side >= front) return 'side'
  if (front > ambiguous && front > side) return 'front'
  return 'ambiguous'
}

/**
 * Rewrites a view-fit table into the one this clip is actually judged by, so that every metric's
 * existing `config.viewFitTable[metric][view]` lookup transparently reads a plausibility-resolved
 * entry. Resolving at the table rather than at each of the eleven call sites is what makes this a
 * gating change and not eleven metric changes.
 *
 *   - `multiplier` is the plausibility-weighted mean of the three rows. Because the weights sum
 *     to 1 and every other confidence factor is view-independent, that is exactly the confidence
 *     each metric would have reported had the view been known, averaged over what is known about
 *     the view.
 *   - `fit` comes from `mostPlausibleView`'s row.
 *
 * The resolved entry is written under ALL THREE view keys, so the resolved table answers the same
 * way whichever label a caller looks up — the label is no longer load-bearing, and a lookup can no
 * longer disagree with the resolution. The three keys share one frozen-by-convention entry object;
 * nothing in this package mutates a table entry.
 *
 * A one-hot plausibility returns the INPUT TABLE BY REFERENCE, since blending against it is the
 * identity. That is the whole no-op proof for every clip that commits to a label today: a
 * committed label requires both signals strictly inside that view's region, which is exactly the
 * condition under which both supports saturate and the plausibility is one-hot on that same label.
 * Such clips reach every metric with the caller's own config object, unchanged.
 */
export function resolveViewFitTable(
  table: HeuristicsConfig['viewFitTable'],
  plausibility: ViewPlausibility,
): HeuristicsConfig['viewFitTable'] {
  const dominant = mostPlausibleView(plausibility)
  if (plausibility[dominant] >= 1) return table

  const resolved = {} as HeuristicsConfig['viewFitTable']
  for (const [metric, rows] of Object.entries(table) as [
    MetricId,
    Record<View, ViewFitEntry>,
  ][]) {
    const entry: ViewFitEntry = {
      fit: rows[dominant].fit,
      multiplier:
        plausibility.side * rows.side.multiplier +
        plausibility.front * rows.front.multiplier +
        plausibility.ambiguous * rows.ambiguous.multiplier,
    }
    resolved[metric] = { side: entry, front: entry, ambiguous: entry }
  }
  return resolved
}
