import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { HeuristicsConfig } from './types'
import { estimateBodyScale } from './bodyScale'
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
 * Two structural consequences worth knowing. `d_left ≡ −d_right`, so the two sides' candidate sets
 * are exact complements — each side's maxima are the other's minima, and two opposite-side
 * candidates can no longer be reported at the same instant off a shared common-mode bump, which
 * absolute ankle-y permitted. And the differenced signal has roughly twice a single ankle's swing
 * excursion (the legs are antiphase) against ~√2 times its noise, so the unchanged
 * `footstrikeMinProminenceRatio` gate sits on a better-conditioned signal than before, not a
 * differently-calibrated one.
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
 * is between the two ankles rather than against the screen). This is still an explicit
 * approximation — there is no foot/toe keypoint or ground-plane calibration anywhere in this
 * pipeline — but it is now an approximation of the ground-contact ONSET rather than of "the lowest
 * point of a stance plateau", which is a different instant (see design.md).
 *
 * On the relative series a maximum is additionally required to be non-negative, which is the one
 * thing "this foot was on the ground" *necessarily* implies and the raw screen-y series could never
 * state: a foot cannot be planted while the other foot is below it. Running has no double-support
 * phase, so at a genuine strike the contralateral foot is airborne and the margin is most of a
 * swing excursion — this rejects the physically impossible, not the marginal, and it has no
 * threshold in it to calibrate. It is skipped on the fallback (absolute-y) series, where `value` is
 * a screen coordinate and its sign means nothing.
 *
 * A simple greedy scan then enforces the minimum footstrike interval: real footstrikes can't be
 * closer together than a runner's fastest plausible cadence, so a candidate less than
 * `minIntervalSeconds` after the last KEPT one is almost certainly the same footstrike
 * re-detected across a couple of noisy frames, not a second one.
 */
function extractFootstrikes(
  extrema: Extremum[],
  side: 'left' | 'right',
  minIntervalSeconds: number,
  relative: boolean,
): FootstrikeCandidate[] {
  const kept: FootstrikeCandidate[] = []
  let lastTimestamp = -Infinity
  for (const extremum of extrema) {
    if (extremum.kind !== 'max') continue
    if (relative && extremum.value < 0) continue
    if (extremum.timestamp - lastTimestamp < minIntervalSeconds) continue
    kept.push({ frameIndex: extremum.index, timestamp: extremum.timestamp, side })
    lastTimestamp = extremum.timestamp
  }
  return kept
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
 * package uses, see `bodyScale.ts`), and keeps only the maxima that survive the
 * `footstrikeMinIntervalSeconds` dedup in `extractFootstrikes`. Both config values are used exactly
 * as they were before the series changed; neither was retuned.
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

  const candidates: FootstrikeCandidate[] = []
  for (const side of ['left', 'right'] as const) {
    const { series, relative } = buildContactSeries(frames, side)
    const extrema = findLocalExtrema(series, minProminenceAbs)
    candidates.push(
      ...extractFootstrikes(extrema, side, config.footstrikeMinIntervalSeconds, relative),
    )
  }

  candidates.sort((a, b) => a.timestamp - b.timestamp)
  return candidates
}
