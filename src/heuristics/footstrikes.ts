import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { HeuristicsConfig } from './types'
import { estimateBodyScale } from './bodyScale'
import { analyzeHipBounce } from './hipBounce'
import {
  resolveExpectedStridePeriodSeconds,
  shortestPlausibleStrideSeconds,
} from './stridePeriod'
import { resolvePoint } from './keypoints'
import { findLocalExtrema } from './extrema'
import type { Extremum } from './extrema'

export interface FootstrikeCandidate {
  frameIndex: number
  timestamp: number
  side: 'left' | 'right'
}

const ANKLE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_ankle',
  right: 'right_ankle',
}

const OPPOSITE_SIDE: Record<'left' | 'right', 'left' | 'right'> = {
  left: 'right',
  right: 'left',
}

/**
 * The series a footstrike is detected on: **this ankle's vertical position relative to the OTHER
 * ankle's**, `ankle_S.y − ankle_opposite.y`, in the same pixel space and with image-y increasing
 * downward — so it reads "how far below the other foot this foot currently is", and its maxima are
 * the instants this foot is lowest *relative to its partner*.
 *
 * ## Why relative and not `ankle_S.y` on its own
 *
 * A single ankle's screen y is the sum of two things: (a) the leg's own configuration, which is
 * what a footstrike detector wants, and (b) the whole body's vertical motion, which every keypoint
 * shares — the ~1.5 Hz bounce `verticalOscillation`/`cadence` measure, plus any vertical camera
 * motion. Term (b) is pure contamination here, and it is not small: on the Demo 1 track clip the
 * bounce is 16.3% of torso length against a `footstrikeMinProminenceRatio` of 0.05, so the body's
 * own oscillation clears the prominence gate more than three times over. It produced two distinct,
 * separately-measured defects:
 *
 * - **A maximum where no foot landed.** A leg trailing through early swing is being carried
 *   *downward* by the body's descent into the other foot's stance faster than it is lifting, so its
 *   absolute ankle-y turns over and back — a prominence-confirmed maximum with the foot in the air.
 *   `cadence.ts` names this mechanism as the reason cadence stopped consuming this detector, and
 *   `strideLength.ts`'s "halving bias" section names it again.
 * - **A real contact reported at the wrong instant.** Through stance the planted foot does not
 *   move, so its absolute ankle-y is a flat plateau; the argmax over a flat plateau is decided by
 *   noise, and the body's bounce tilts it late. Frame-by-frame ground truth on Demo 1 caught two of
 *   three emitted instants at a toe-off and inside late stance rather than at touchdown.
 *
 * Differencing the two ankles cancels (b) exactly — both feet share the same body and the same
 * camera — and leaves only the between-legs geometry, which is what alternating gait actually is.
 *
 * ## Why its maximum lands on the contact ONSET
 *
 * Differentiate: `d_S' = y_S' − y_opposite'`. Approaching touchdown, this foot is descending fast
 * (`y_S' ≫ 0`) while the other foot is at or near its swing apex, where its own vertical velocity
 * passes through zero — the classic heel-up-behind pose at initial contact — so `d_S' > 0`. The
 * instant this foot lands, `y_S'` drops to ~0 (a planted foot does not move) while the other foot
 * has begun descending toward its own contact half a stride later, so `y_opposite' > 0` and
 * `d_S' < 0`. The sign flips *at touchdown*, and it keeps falling for the rest of stance — so the
 * late-stance and toe-off instants that the flat absolute plateau could not order are strictly
 * below the onset here, rather than tied with it.
 *
 * The same sign argument kills the trailing-leg artifact: while this leg trails and the other is
 * planted, `d_S` is near its MINIMUM (this foot high, the other on the ground), which is the
 * opposite extremum from the one this detector reads.
 *
 * ## What differencing does NOT remove — measured, not assumed
 *
 * The cancellation is exact only when the two feet are in the SAME state, and in running they never
 * are: one foot is planted (a fixed world point, so it carries none of the body's motion) while the
 * other is airborne (so it carries all of it). Write it out for the interval while side S is
 * planted:
 *
 * ```
 * d_S = y_S − y_opposite = ground − (hip_y + rel_opposite)
 * ```
 *
 * The body term survives at FULL amplitude, inverted. It puts a dip in `d_S` at S's own midstance
 * (the body's lowest point) and lets `d_S` recover toward toe-off, so a stance can carry a second
 * confirmed maximum, and the midstance dip is by complementarity a confirmed maximum on the OTHER
 * side. Measured live on Demo 1: about 2.3× as many candidates as there are contacts, alternating
 * sides perfectly (which complementarity guarantees and which therefore proves nothing on its own),
 * with same-side spacings of 0.36–0.48 s against that clip's own measured stance durations of
 * 0.36 s and 0.44 s.
 *
 * **This cannot be gated away.** The artifact's prominence is the runner's vertical oscillation,
 * 16.3% of torso length on Demo 1 against a `footstrikeMinProminenceRatio` of 0.05 — 3.3× the gate.
 * Rescaling the gate for the differenced signal's √2-larger noise (the only correction that IS
 * derivable) reaches 0.0707, still well under it; a gate large enough would have to exceed the
 * runner's own vertical oscillation, a quantity this app measures and which spans 16–25% across its
 * own three clips. So the gate is left exactly as it was and the artifacts are removed by
 * SELECTION instead — see `selectFootstrikes`.
 *
 * Two structural consequences worth knowing. `d_left ≡ −d_right`, so the two sides' candidate sets
 * are exact complements — each side's maxima are the other's minima. That guarantees the merged
 * list alternates feet no matter how wrong it is, so alternation is never evidence of correct side
 * attribution; what it does buy is that two opposite-side candidates can no longer be reported at
 * the same instant off a shared common-mode bump, which absolute ankle-y permitted (and which is
 * how Demo 1 came to emit three instants all labelled the same side). And the differenced signal has
 * roughly twice a single ankle's swing excursion against ~√2 times its noise, which is a better
 * conditioned signal for ordering candidates by amplitude — the property `selectFootstrikes` relies
 * on.
 *
 * ## Fallback, and what it costs
 *
 * A frame where either ankle is unresolvable has no defined difference, so it becomes a `null` —
 * `findLocalExtrema`'s existing gap semantics, which split the series into independently-scanned
 * runs rather than inventing what happened across the gap. That is stricter than before (an
 * unresolvable OPPOSITE ankle now also costs a sample), and it is the deliberate trade: without the
 * other foot there is no way to tell a contact from a body-bounce artifact.
 *
 * The one degenerate case is handled separately rather than by a threshold: when the opposite ankle
 * is resolvable in NO frame of the clip there is no contralateral reference to speak of, and the
 * series falls back to raw `ankle_S.y` — exactly the pre-existing behaviour, for a single-leg trace
 * where the ambiguity this differencing resolves cannot arise in the first place.
 */
function buildContactSeries(
  frames: RobustPoseFrame[],
  side: 'left' | 'right',
): { series: Array<{ t: number; v: number } | null>; relative: boolean } {
  const own = frames.map((frame) => resolvePoint(frame, ANKLE_NAME[side]))
  const opposite = frames.map((frame) => resolvePoint(frame, ANKLE_NAME[OPPOSITE_SIDE[side]]))

  if (opposite.every((point) => point === null)) {
    return {
      series: frames.map((frame, index) =>
        own[index] === null ? null : { t: frame.timestamp, v: own[index]!.y },
      ),
      relative: false,
    }
  }

  return {
    series: frames.map((frame, index) => {
      const ownPoint = own[index]
      const oppositePoint = opposite[index]
      if (ownPoint === null || oppositePoint === null) return null
      return { t: frame.timestamp, v: ownPoint.y - oppositePoint.y }
    }),
    relative: true,
  }
}

/**
 * `findLocalExtrema` gives every prominence-confirmed local max/min of one side's contact series;
 * only the MAXIMA are candidate footstrikes (this foot at its lowest relative to the other ≈ this
 * foot on the ground while the other is airborne — see `buildContactSeries` for why the comparison
 * is between the two ankles rather than against the screen).
 *
 * On the relative series a maximum is additionally required to be non-negative, which is the one
 * thing "this foot was on the ground" *necessarily* implies and the raw screen-y series could never
 * state: a foot cannot be planted while the other foot is below it. Running has no double-support
 * phase, so at a genuine strike the contralateral foot is airborne and the margin is most of a
 * swing excursion — this rejects the physically impossible, not the marginal, and it has no
 * threshold in it to calibrate. It is skipped on the fallback (absolute-y) series, where `value` is
 * a screen coordinate and its sign means nothing.
 *
 * ## Selection is by AMPLITUDE, and spacing comes from the clip's own rhythm
 *
 * Prominence is a LOCAL criterion. It answers "is this a turning point", never "is this a ground
 * contact", and the contact series carries prominence-confirmed maxima that are not contacts —
 * see `buildContactSeries`'s "What differencing does NOT remove" note for the mechanism and the
 * measurement. What separates a contact from those artifacts is AMPLITUDE, by a wide margin: a
 * contact sits at the full inter-leg separation, most of a swing excursion, while the artifacts
 * are the size of the runner's own vertical oscillation — measured on Demo 1, a factor of about
 * three, and the artifacts clear the prominence gate more than three times over.
 *
 * So candidates are accepted greedily in DESCENDING order of contact-series value, each accepted
 * one excluding every candidate within `minIntervalSeconds` of it, and the survivors are returned
 * in time order. Ties break toward the earlier instant, which preserves the older "a candidate this
 * soon after a kept one is the same footstrike re-detected" reading on a flat plateau.
 *
 * `minIntervalSeconds` is the caller's already-resolved floor — `footstrikeMinIntervalSeconds`, or
 * the clip's own shortest plausible stride where its step rhythm could be fitted. See
 * `detectFootstrikes`.
 */
function selectFootstrikes(
  extrema: Extremum[],
  side: 'left' | 'right',
  minIntervalSeconds: number,
  relative: boolean,
): FootstrikeCandidate[] {
  const admissible = extrema.filter(
    (extremum) => extremum.kind === 'max' && !(relative && extremum.value < 0),
  )
  const byAmplitude = [...admissible].sort(
    (a, b) => b.value - a.value || a.timestamp - b.timestamp,
  )

  const kept: Extremum[] = []
  for (const extremum of byAmplitude) {
    const clashes = kept.some(
      (accepted) => Math.abs(accepted.timestamp - extremum.timestamp) < minIntervalSeconds,
    )
    if (!clashes) kept.push(extremum)
  }

  return kept
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((extremum) => ({ frameIndex: extremum.index, timestamp: extremum.timestamp, side }))
}

/**
 * This clip's own step frequency, from the same shared hip-bounce spectral fit `cadence` reads, or
 * `undefined` when the clip has no trustworthy step rhythm to speak of.
 *
 * Gated at `cadenceMinFitR2` — the identical bar cadence itself clears before it will report a
 * number at all. Below that bar the fitted frequency describes noise, and a rhythm derived from
 * noise must never be allowed to delete real footstrikes; above it, cadence is willing to put the
 * number on screen. Reusing that key rather than adding a second one is deliberate: two
 * independently movable gates on the same fit would let the pipeline disagree with itself about
 * whether this clip has a measurable rhythm.
 *
 * No cycle: `cadence` reads this fit but does not read footstrikes — it stopped doing so precisely
 * because of the defect this module is fixing (`cadence.ts`'s module doc).
 */
function resolveStepFrequencyHz(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig,
): number | undefined {
  const { fit } = analyzeHipBounce(frames, config)
  if (!fit.ok) return undefined
  if (fit.sinusoidR2 < config.cadenceMinFitR2) return undefined
  return fit.frequencyHz
}

/**
 * Detects footstrike candidates across both legs of a pose-frame sequence — the shared basis for
 * overstriding, cadence, and foot-strike-pattern, all of which need "when did a foot plant"
 * without each reimplementing ankle-extrema detection and dedup.
 *
 * Per side, builds the contact series — this ankle's y MINUS the opposite ankle's y, see
 * `buildContactSeries` for the full argument and for the gap/fallback rules — runs it through
 * `findLocalExtrema` with a prominence threshold scaled to this clip's body size
 * (`footstrikeMinProminenceRatio * torsoLengthPx` — the same normalizer every heuristic in this
 * package uses, see `bodyScale.ts`), and hands the maxima to `selectFootstrikes`. Both config
 * values are used exactly as they were before the series changed; neither was retuned.
 *
 * ## The same-side spacing floor comes from the clip, not from a constant
 *
 * Two contacts of the SAME foot are one stride apart, and this clip's own fitted step frequency
 * says how long a stride is: `2 / stepFrequencyHz`, from the definition of a gait cycle, with no
 * fitted coefficient anywhere in it. The floor used here is the SHORTEST interval that could still
 * be one stride — `shortestPlausibleStrideSeconds`, which is exactly the lower edge of the accept
 * band `strideLength.ts` already applies to a candidate pair. Stating it as that edge rather than
 * as an independent number is what makes the two rules incapable of disagreeing: this selection can
 * only ever drop a same-side pair the period gate downstream would have rejected anyway.
 *
 * `footstrikeMinIntervalSeconds` remains in force as an absolute floor, and binds on its own
 * whenever no step rhythm could be fitted (`resolveStepFrequencyHz` returning `undefined`) — which
 * is exactly the behaviour that predates this rule. On a clip with a fitted rhythm the derived
 * floor is the larger of the two (on Demo 1, 1.14 s against the config's 0.25 s), so the config
 * value is subsumed rather than weakened, and it was not touched.
 *
 * The emitted instants are **ground-contact onsets** — the moment a foot arrives — not "the frame
 * within stance where this ankle read lowest". That distinction is the whole point of the contact
 * series, and it is what every consumer actually wants: `overstriding` and `footStrikePattern`
 * measure a touchdown geometry, and `strideLength` measures the interval between touchdowns.
 *
 * Returns candidates from both legs combined into one timestamp-ordered list (not grouped or
 * interleaved by side) — the natural shape for a cadence computation that just wants "every
 * footstrike, in order, regardless of which foot", while `side` is still carried on each
 * candidate for consumers (overstriding, foot-strike-pattern) that need to resolve a per-leg point
 * at that instant.
 *
 * Returns `[]` when there's no resolvable body-scale reference at all (no shoulders/hips to
 * measure torso length from) — there's no way to size the prominence threshold without one, so no
 * candidates can be extracted. Callers that need to distinguish "no body scale" from "body scale
 * present but zero footstrikes found" (as `computeOverstriding` does, for a more specific caveat
 * message) should call `estimateBodyScale` themselves first.
 */
export function detectFootstrikes(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig,
): FootstrikeCandidate[] {
  const bodyScale = estimateBodyScale(frames)
  if (bodyScale === null) return []

  const minProminenceAbs = config.footstrikeMinProminenceRatio * bodyScale.torsoLengthPx

  const expectedStridePeriodSeconds = resolveExpectedStridePeriodSeconds(
    resolveStepFrequencyHz(frames, config),
  )
  const minIntervalSeconds = Math.max(
    config.footstrikeMinIntervalSeconds,
    expectedStridePeriodSeconds === null
      ? 0
      : shortestPlausibleStrideSeconds(expectedStridePeriodSeconds),
  )

  const candidates: FootstrikeCandidate[] = []
  for (const side of ['left', 'right'] as const) {
    const { series, relative } = buildContactSeries(frames, side)
    const extrema = findLocalExtrema(series, minProminenceAbs)
    candidates.push(...selectFootstrikes(extrema, side, minIntervalSeconds, relative))
  }

  candidates.sort((a, b) => a.timestamp - b.timestamp)
  return candidates
}
