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
import { median } from './mathUtils'
import type { SpectralFitResult, SpectralFitSuccess } from './spectralFit'

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
 *
 * The same predicate decides whether `detectFromBouncePhase` may time the footstrikes at all, which
 * is deliberate: two independently movable gates on one fit would let this module hold two opinions
 * about whether the clip has a measurable rhythm.
 */
function isRhythmTrustworthy(
  fit: SpectralFitResult,
  config: HeuristicsConfig,
): fit is SpectralFitSuccess {
  return fit.ok && fit.sinusoidR2 >= config.cadenceMinFitR2
}

function resolveStepFrequencyHz(
  fit: SpectralFitResult,
  config: HeuristicsConfig,
): number | undefined {
  return isRhythmTrustworthy(fit, config) ? fit.frequencyHz : undefined
}

/**
 * The ankle-difference detector: **the fallback path**, and the whole of what this module did
 * before footstrike timing moved to the fitted hip-bounce phase (`detectFromBouncePhase`). It runs
 * unchanged whenever that phase is unavailable — see `detectFootstrikes` for the exact condition.
 *
 * It is exported so the unit suite can measure BOTH paths on the same fixture. That comparison is
 * the acceptance evidence for the phase detector and it cannot be written any other way: on a clip
 * with a fittable bounce the phase path always wins, so the older path would otherwise be
 * unreachable from a test that also wants a bounce present.
 *
 * ## Its phase residual is a property of the signal, and no offset can correct it
 *
 * The instant this selects is the maximum of `d_S`, which with S planted is decided entirely by the
 * OTHER ankle — it is the **contralateral foot's swing apex**, a real gait event that is not
 * touchdown and is not a fixed distance from it. Sweeping the fixture's apex phase moves the
 * emitted lag from 1 frame to 11 (0.04–0.44 s at 25 fps), one for one and monotonically — a range
 * wider than a whole stance phase, so a constant fitted to one runner is wrong for the next. Every
 * constant-free alternative on this same signal marks a different wrong event. Measured and
 * enumerated in `openspec/changes/archive/2026-08-29-detect-footstrike-contact-onsets/design.md`
 * D15, pinned in `footstrikes.test.ts`, and **not to be re-litigated by picking a better offset.**
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
 * `torsoLengthPx` sizes the prominence threshold; `fit` is the caller's already-computed hip-bounce
 * fit, passed in rather than re-derived so that the two paths cannot end up reading two different
 * fits of the same clip.
 */
export function detectFootstrikesBetweenAnkles(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig,
  torsoLengthPx: number,
  fit: SpectralFitResult,
): FootstrikeCandidate[] {
  const minProminenceAbs = config.footstrikeMinProminenceRatio * torsoLengthPx

  const expectedStridePeriodSeconds = resolveExpectedStridePeriodSeconds(
    resolveStepFrequencyHz(fit, config),
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

/**
 * Index of the sampled frame nearest `t`, ties resolving toward the EARLIER frame — the same
 * tie-breaking `selectFootstrikes` applies on a flat plateau, and the same search
 * `skeletonGeometry.ts`'s `findNearestFrame` performs. It is re-stated here rather than reused
 * because a `FootstrikeCandidate` carries a frame INDEX, which that helper does not return.
 *
 * Assumes `frames` is timestamp-ordered, which every caller of this module guarantees.
 */
function nearestFrameIndex(frames: RobustPoseFrame[], t: number): number {
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid].timestamp < t) lo = mid + 1
    else hi = mid
  }
  if (lo === 0) return 0
  return Math.abs(frames[lo].timestamp - t) < Math.abs(frames[lo - 1].timestamp - t) ? lo : lo - 1
}

/**
 * Half the median interval between consecutive frames — beyond this distance a continuous instant
 * is closer to some other frame than to the one the search returned, so snapping it would be a
 * silent lie about which frame was depicted. Same derivation, and same reason, as
 * `bounceInstants.ts`'s own snap tolerance. `null` for a clip too short to have an interval.
 */
function snapToleranceSeconds(frames: RobustPoseFrame[]): number | null {
  if (frames.length < 2) return null
  const intervals: number[] = []
  for (let i = 1; i < frames.length; i += 1) {
    intervals.push(frames[i].timestamp - frames[i - 1].timestamp)
  }
  const half = median(intervals) / 2
  return Number.isFinite(half) && half > 0 ? half : null
}

/**
 * Which foot is on the ground at this frame: **the lower one**, since a foot cannot be planted
 * while the other foot is below it. `null` when either ankle is unresolvable, because without both
 * there is nothing to compare and a guess would attribute a real contact to the wrong leg.
 *
 * This is the identical fact `selectFootstrikes` uses as an admissibility check (`value >= 0` on
 * the differenced series); read here as the selector rather than as a filter. It has no tolerance
 * parameter, and an exact tie resolves to `'left'` only because a tie means the two ankles are at
 * the same height, which at a real contact does not happen.
 */
function plantedSide(frame: RobustPoseFrame): 'left' | 'right' | null {
  const left = resolvePoint(frame, ANKLE_NAME.left)
  const right = resolvePoint(frame, ANKLE_NAME.right)
  if (left === null || right === null) return null
  return left.y >= right.y ? 'left' : 'right'
}

/**
 * **Footstrike timing from the fitted hip-bounce phase** — the primary path, and the reason this
 * module no longer reports the contralateral swing apex as a touchdown.
 *
 * ## Why the inflections of the vertical trajectory ARE the contact events
 *
 * The body's vertical acceleration is `−g` throughout flight and net upward throughout stance,
 * because in flight gravity is the only force on it and in stance the ground pushes back harder
 * than gravity pulls (that is what holds a runner up). The sign therefore flips exactly at
 * touchdown, and again at toe-off. Curvature is the sign of acceleration, so the trajectory's
 * INFLECTION POINTS are the contact events — a statement about contact itself, carrying no
 * coefficient and no per-runner tuning.
 *
 * For a sinusoid the inflections are its zero crossings, a quarter period either side of each
 * extremum. `analyzeHipBounce` fits raw image-y, which grows DOWNWARD, so the fitted MAXIMUM is
 * the body's LOWEST point (midstance), and:
 *
 * ```
 * lowest_k   = tMeanSeconds + (π/2 − φ)/ω + k·T      ω = 2π·f,  T = 1/f
 * touchdown_k = lowest_k − T/4
 * ```
 *
 * The hip-mid trace bounces ONCE PER STEP (`cadence.ts`'s module doc — it is why cadence reports
 * `frequencyHz × 60` with no harmonic correction), so this emits one touchdown per step: the right
 * rate by construction, rather than by selecting a subset of candidates and hoping.
 *
 * ## Its own residual, in closed form
 *
 * Taking the bounce's low point as midstance, and writing `stance` for the stance duration:
 *
 * ```
 * lag = stance/2 − T/4 = (stance − T/2) / 2
 * ```
 *
 * — half the amount by which stance exceeds half a step period, which is exactly the error a single
 * sinusoid makes by forcing stance = flight. On Demo 1 (`T = 0.658 s`, stances 0.36 s and 0.44 s)
 * that is 0.0155 s and 0.0555 s: **0.4 and 1.4 frames at 25 fps**, against the 4–6 frames the
 * ankle-difference path is late by on the same clip. Across all of running it stays inside
 * `0 … 0.10·T`, which is where the ankle path's residual STARTS. The residual is pinned executably
 * by a stance sweep in `footstrikes.test.ts`; the point of that sweep is that the swing-apex sweep,
 * which moves the other path from 1 frame to 11, does not move this one at all.
 *
 * ## What is deliberately NOT here
 *
 * No constant is added, subtracted or fitted anywhere. `T/4` is the distance from a sinusoid's
 * extremum to its inflection and nothing else. The quality bar is `cadenceMinFitR2`, read through
 * the same `isRhythmTrustworthy` predicate the spacing floor uses.
 *
 * Returns `[]` — never a partial guess — when the rhythm is untrustworthy, when the clip is too
 * short to have a snap tolerance, or when no predicted instant lands on a frame that resolves both
 * ankles. `detectFootstrikes` reads an empty result as "fall back", so the failure mode of this
 * path is that the clip keeps the behaviour it had before this path existed.
 */
function detectFromBouncePhase(
  frames: RobustPoseFrame[],
  fit: SpectralFitResult,
  config: HeuristicsConfig,
): FootstrikeCandidate[] {
  if (!isRhythmTrustworthy(fit, config)) return []
  if (!Number.isFinite(fit.frequencyHz) || fit.frequencyHz <= 0) return []

  const tolerance = snapToleranceSeconds(frames)
  if (tolerance === null) return []

  const period = 1 / fit.frequencyHz
  const omega = 2 * Math.PI * fit.frequencyHz
  const firstLowest = fit.tMeanSeconds + (Math.PI / 2 - fit.phaseRadians) / omega
  const firstTouchdown = firstLowest - period / 4

  const spanStart = frames[0].timestamp
  const spanEnd = frames[frames.length - 1].timestamp
  const firstK = Math.ceil((spanStart - firstTouchdown) / period)
  const lastK = Math.floor((spanEnd - firstTouchdown) / period)

  const candidates: FootstrikeCandidate[] = []
  const claimedFrames = new Set<number>()
  for (let k = firstK; k <= lastK; k += 1) {
    const predicted = firstTouchdown + k * period
    const index = nearestFrameIndex(frames, predicted)
    if (Math.abs(frames[index].timestamp - predicted) > tolerance) continue
    if (claimedFrames.has(index)) continue
    const side = plantedSide(frames[index])
    if (side === null) continue
    claimedFrames.add(index)
    candidates.push({ frameIndex: index, timestamp: frames[index].timestamp, side })
  }

  return candidates
}

/**
 * Detects footstrike candidates across both legs of a pose-frame sequence — the shared basis for
 * overstriding, foot-strike-pattern, step width and stride length, all of which need "when did a
 * foot plant" without each reimplementing it.
 *
 * ## Two paths, one of which is a strict safety net for the other
 *
 * 1. **Timing from the fitted hip-bounce phase** (`detectFromBouncePhase`), whenever this clip's
 *    bounce fit clears the same bar cadence itself clears before publishing a number. Touchdown is
 *    a quarter period before each fitted low point, one per step, sides taken from the ankles.
 * 2. **The ankle-difference detector** (`detectFootstrikesBetweenAnkles`), otherwise — and
 *    "otherwise" includes the case where path 1 clears its gate but yields nothing attributable.
 *
 * Stating the fallback as "path 1 produced no instant at all" rather than as a count threshold
 * keeps a number out of it, and buys the property that bounds this module's coupling to the hip
 * signal: **a clip that reports footstrike-derived metrics without path 1 keeps reporting them with
 * it.** The worst case of a poor hip fit is no improvement, never a new failure. That matters
 * because timing is now a function of a signal `overstriding` and `footStrikePattern` previously
 * did not depend on at all.
 *
 * The emitted instants are **ground-contact onsets** — the moment a foot arrives — not "the frame
 * within stance where this ankle read lowest", and not the contralateral foot's swing apex. That is
 * what every consumer actually wants: `overstriding` and `footStrikePattern` measure a touchdown
 * geometry, `stepWidth` measures a touchdown position, and `strideLength` measures the interval
 * between touchdowns.
 *
 * Returns candidates from both legs combined into one timestamp-ordered list (not grouped or
 * interleaved by side), while `side` is still carried on each candidate for consumers that need to
 * resolve a per-leg point at that instant.
 *
 * Returns `[]` when there's no resolvable body-scale reference at all (no shoulders/hips to measure
 * torso length from) — the fallback path has no way to size its prominence threshold without one,
 * and a clip with no resolvable hips has no bounce to fit either. Callers that need to distinguish
 * "no body scale" from "body scale present but zero footstrikes found" (as `computeOverstriding`
 * does, for a more specific caveat message) should call `estimateBodyScale` themselves first.
 */
export function detectFootstrikes(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig,
): FootstrikeCandidate[] {
  const bodyScale = estimateBodyScale(frames)
  if (bodyScale === null) return []

  const { fit } = analyzeHipBounce(frames, config)

  const fromPhase = detectFromBouncePhase(frames, fit, config)
  if (fromPhase.length > 0) return fromPhase

  return detectFootstrikesBetweenAnkles(frames, config, bodyScale.torsoLengthPx, fit)
}
