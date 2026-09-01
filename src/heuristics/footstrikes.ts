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
  /**
   * Whether this instant's ANKLE POSITION may be read. `false` marks a strike whose two ankles
   * have collapsed onto one point, so the labels no longer name two feet — see
   * `hasMeasurableAnkles` for the predicate and `detectFootstrikes` for why such a strike is
   * annotated rather than dropped.
   *
   * Consumed by the four metrics that read an ankle AT a strike (`overstriding`,
   * `footStrikePattern`, `stepWidth`, `stepWidthCm`). Deliberately IGNORED by `strideLength`,
   * which reads only this instant's timestamp and hip-mid — neither of which an ankle-label
   * collapse touches.
   */
  ankleMeasurable: boolean
}

/**
 * A detected instant before `detectFootstrikes` annotates its ankle measurability. The annotation
 * is applied once, at the point where the winning detector path is known, because the two paths
 * are not treated alike — see `detectFootstrikes`' "Two gates, and only one of them is new".
 */
type TimedInstant = Omit<FootstrikeCandidate, 'ankleMeasurable'>

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
): TimedInstant[] {
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
 *
 * **This path is where the boundary defect lives, by construction rather than by chance**: it
 * consumes `findLocalExtrema`, which emits an unconfirmed pivot at the end of every RUN by design,
 * and the last run's end is the series' last frame. `selectFootstrikes` then ranks by descending
 * amplitude, so such a pivot on a contaminated frame competes on the strength of its contamination.
 *
 * **Eligibility is therefore applied to the extrema BEFORE they are ranked**, not to the candidates
 * afterwards. The ranking is greedy non-maximum suppression: an ineligible pivot that wins it
 * suppresses every same-side candidate within `minIntervalSeconds`, so filtering afterwards would
 * drop the pivot and keep the deletion — trading a confirmed interior contact for an unconfirmable
 * boundary one. See `hasFramesEitherSide`, which is the single definition of the rule and is
 * applied again after path selection for the phase path's sake.
 *
 * Note the scope: only the SERIES' final frame is reached this way. A run ending at an interior
 * gap still contributes its own unconfirmed pivot, which this rule deliberately does not touch.
 *
 * This path also runs more often than the module's shape suggests: Demo 2's background scale pass
 * was measured reaching it, not the phase path, because its hip fit fell below `cadenceMinFitR2` —
 * its emitted frames 25/45/67/86/100 have deltas 20/22/19/14, which no single fixed period can
 * produce.
 */
export function detectFootstrikesBetweenAnkles(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig,
  torsoLengthPx: number,
  fit: SpectralFitResult,
): TimedInstant[] {
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

  const candidates: TimedInstant[] = []
  for (const side of ['left', 'right'] as const) {
    const { series, relative } = buildContactSeries(frames, side)
    // Eligibility BEFORE selection, deliberately — see this function's doc and
    // `hasFramesEitherSide`. `selectFootstrikes` suppresses by amplitude rank, so an ineligible
    // extremum left in this list would delete a real contact on its way to being dropped itself.
    const extrema = findLocalExtrema(series, minProminenceAbs).filter((extremum) =>
      hasFramesEitherSide(extremum.index, frames.length),
    )
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
 * Whether the frame at `frameIndex` has a sampled frame on BOTH sides of it — i.e. it sits neither
 * on the first nor on the last frame of the analysed series.
 *
 * ## The evidence for a ground contact is two-sided
 *
 * Every reading of "a foot landed here" this module has ever used is a REVERSAL: the striking
 * ankle stops descending, or the two ankles stop separating, or the fitted body trajectory changes
 * the sign of its curvature. A reversal is a statement about what happened before an instant AND
 * about what happened after it. At the first or last sampled frame only one of those exists, so
 * what gets emitted there is not a confirmed contact — it is whatever the series was doing when the
 * data ran out. The instant may well BE a real touchdown; the point is that this clip contains no
 * evidence either way, and the downstream consumers treat every emitted instant as equally
 * evidenced.
 *
 * **There is no threshold in this.** It is not "near the edge", not a tolerance in seconds, not a
 * discount: an instant either has a neighbour on each side or it does not.
 *
 * ## The boundary is the PRESENCE-TRIMMED window's edge, not the clip's
 *
 * `runClipAnalysisPipeline.ts` calls `trimToPresenceWindow` before `computeFormHeuristics`, so the
 * `frames` every heuristic sees already begin at the first frame the subject was present in and end
 * at the last. That is worth stating because it is surprising in the reader's favour: the frames
 * excluded here are the edges of the SUBJECT's own window, which is exactly where a partially
 * entered or partially exited body produces its least trustworthy geometry, rather than the edges
 * of a recording that may have had the runner nowhere near it.
 *
 * ## Both paths can land here, for entirely different reasons
 *
 * - `detectFromBouncePhase` admits the sampled span **inclusively** (`firstK` rounds up from
 *   `spanStart`, `lastK` rounds down from `spanEnd`), so a predicted touchdown lands on a boundary
 *   frame whenever it happens to fall within the snap tolerance of one end — a coincidence of where
 *   the fitted phase sits, not a mechanism. How often that is depends on the clip's frame interval
 *   against its step period (half a frame either side of a period), so it is a property of fps ×
 *   cadence rather than of this path: about 3.0% per end on Demo 1's 25 fps, 2.5% on Demo 2's 60.
 * - `findLocalExtrema` emits an unconfirmed trailing pivot at the end of every RUN, BY DESIGN — see
 *   the closing paragraph of `findExtremaInRun`'s doc in `extrema.ts`. That defence is made on
 *   PROMINENCE grounds, which is a claim about the pivot's amplitude and not about the pivot being
 *   a ground contact; it is correct as far as it goes and is not what this predicate disputes.
 *   `selectFootstrikes` then ranks candidates by DESCENDING value, so such a pivot sitting on a
 *   contaminated frame competes on the strength of its own contamination — measured on Demo 2's
 *   scale pass, which emitted the clip's final frame at ratio +1.38051 against a primary-pass
 *   maximum of +0.37568.
 *
 *   **Scope, stated rather than glossed:** this predicate reaches only the SERIES' first and last
 *   frame, so of those per-run pivots it removes exactly one — the final run's. A run that ends at
 *   an interior gap (`buildContactSeries` nulls any frame where either ankle is unresolvable, and
 *   `strides-boc` documents a 10-of-12 dropout window on Demo 2) still contributes its unconfirmed
 *   pivot, mid-series, where this rule has nothing to say: such a pivot has sampled frames on both
 *   sides of it and is unconfirmed for a different reason — missing data rather than a missing
 *   side. Knowingly out of scope here.
 *
 * ## Called from two sites, and it is one rule, not two
 *
 * This is the single definition; only the enforcement points are plural, and each is load-bearing:
 *
 * 1. **Before the amplitude ranking on the fallback path** (`detectFootstrikesBetweenAnkles`).
 *    `selectFootstrikes` is greedy non-maximum suppression ranked by DESCENDING contact-series
 *    value, so an ineligible pivot does not merely get emitted — it wins the ranking first and
 *    suppresses every same-side candidate within `minIntervalSeconds` of it. Filtering only
 *    afterwards would drop the pivot and keep the deletion, losing a CONFIRMED interior contact to
 *    an unconfirmable boundary one. Pinned by a regression test; the shape is
 *    `[0,10,20,30,40,50,40,0,0,40,90]` at 30 fps, where a post-ranking-only filter returns nothing
 *    at all rather than the real contact at index 5.
 * 2. **After path selection** (`detectFootstrikes`), which is the module's single enforcement point
 *    for the guarantee: it covers the phase path, which never goes through the fallback, and it is
 *    where a reader can see the contract hold for whichever path won. Idempotent on candidates the
 *    first site already filtered.
 */
function hasFramesEitherSide(frameIndex: number, frameCount: number): boolean {
  return frameIndex > 0 && frameIndex < frameCount - 1
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
 * `y_left − y_right` at this frame: positive when the LEFT ankle is the lower of the two, which is
 * the one thing "this foot was on the ground" necessarily implies — a foot cannot be planted while
 * the other foot is below it. `null` when either ankle is unresolvable.
 *
 * The MAGNITUDE is the point, not just the sign: two ankles half a swing apart are strong evidence
 * about which is planted, and two ankles at the same height are none at all. `attributeSides`
 * consumes it as a weight, which is why this returns the difference rather than a side.
 */
function ankleDifference(frame: RobustPoseFrame): number | null {
  const left = resolvePoint(frame, ANKLE_NAME.left)
  const right = resolvePoint(frame, ANKLE_NAME.right)
  if (left === null || right === null) return null
  return left.y - right.y
}

/**
 * Whether the two ankles at this frame are far enough apart VERTICALLY for the ankle labels to
 * still name two different feet — `|ankleDifference| >= footstrikeMinAnkleSeparationRatio *
 * torsoLengthPx`. The magnitude `attributeSides` already reads as a weight, read here against a
 * floor.
 *
 * ## Why this says anything about whether a contact happened
 *
 * Running has no double-support phase, so at a touchdown one foot is on the ground and the other
 * is mid-swing: the two ankles are near MAXIMAL separation. That is not an incidental correlate —
 * it is the entire premise `buildContactSeries` is built on. Two ankles at the same height at a
 * predicted touchdown therefore say the pose is not a contact, or that both labels have latched
 * onto one foot; measured on Demo 1, both. At t = 6.16 the two "detected" ankles sit 3 px apart
 * horizontally and 23 px vertically, both on the TRAILING swing foot while the planted foot is at
 * the frame edge, and `overstriding` read −0.72 — the foot landing 72% of a torso length BEHIND
 * the hip, which is not a thing a footstrike can do.
 *
 * ## Vertical, not horizontal — and the difference is a whole clip
 *
 * `|Δx|` separates the feet only on a SIDE view. Face-on the feet separate mostly in DEPTH, which
 * projects to almost nothing in image-x: on the front-approach Demo 2 the genuine strikes carry
 * 0.017–0.50 T horizontally, straddling any usable floor, so an `|Δx|` gate would delete the clip's
 * whole sample and null the three metrics it is the primary view for. The same strikes carry
 * 0.46–1.91 T vertically. Vertical separation survives the projection because the ground does not
 * move.
 *
 * ## Undecidable passes
 *
 * `null` — either ankle unresolvable — returns `true`. There is then no evidence that the pose has
 * collapsed, and manufacturing a rejection out of missing data would be a different claim from the
 * one this predicate makes. It matches how the rest of the module treats absent evidence
 * (`buildContactSeries` falls back rather than refusing; `selectFootstrikes` skips its
 * non-negativity rule on the fallback series), and it matters in practice: `strides-boc` documents
 * a 10-of-12 detection dropout on Demo 2, and a single-leg clip has no contralateral ankle at all.
 *
 * ## Interpolation is deliberately NOT part of this
 *
 * It is neither sufficient nor necessary. Demo 1's t = 6.16 collapse is both ankles `detected`,
 * and its t = 4.20 collapse is both `interpolated` — the predicate must catch both, and an
 * interpolation test catches only one. Interpolation is already priced, separately and
 * proportionally, by `interpolatedFraction × interpolationConfidencePenalty`.
 */
function hasMeasurableAnkles(
  frame: RobustPoseFrame,
  config: HeuristicsConfig,
  torsoLengthPx: number,
): boolean {
  const difference = ankleDifference(frame)
  if (difference === null) return true
  return Math.abs(difference) >= config.footstrikeMinAnkleSeparationRatio * torsoLengthPx
}

/**
 * Names the foot at each phase-derived instant — **one decision for the whole clip, not one per
 * instant.**
 *
 * A stride is two steps, one per foot, so consecutive touchdowns alternate feet. The instants here
 * are already one step apart by construction (one per fitted bounce cycle) and each carries its own
 * cycle index `k`, which counts steps and therefore keeps alternating correctly across an instant
 * that had to be dropped. So the entire question reduces to a single bit: does an even `k` mean
 * left, or right?
 *
 * That bit is decided by summing `ankleDifference` across every instant, signed by the parity of
 * `k` — a magnitude-weighted vote, where each instant contributes in proportion to how far apart
 * the two ankles were and therefore to how much it actually knows.
 *
 * ## Why not read the lower ankle at each instant independently
 *
 * Because it was measured doing the wrong thing. On the Demo 1 track clip the per-instant reading
 * emitted `left, left, right, right`: the two middle instants carry 351 px and 373 px of ankle
 * separation and are unambiguous, while the two outer ones carry 41 px — a frame inside a
 * nine-frame interpolation ramp, so its ankles are a straight-line fabrication — and 23 px. The two
 * consecutive same-side instants that produced were one STEP apart, `strideLength`'s period gate
 * correctly rejected the pair, and `verticalRatio` went from `0.0354` to `null`. Summed and
 * weighted, the same four instants decide the parity by 660 px one way against 660 px the other and
 * come out `right, left, right, left`, whose same-side pairs are 1.32 s — one stride at this clip's
 * fitted 1.52 Hz, to within 0.3%. `verticalRatio` resolves again, at **twice** its previous
 * confidence, because it now has two period-consistent pairs instead of one.
 *
 * Side-view footage is exactly where this matters: the two ankles cross and occlude each other
 * every step, and MoveNet swaps their labels outright on some frames (visible on Demo 1 around
 * t = 5.6). A per-instant reading is N independent coin flips on the noisiest quantity in the clip;
 * this is one decision informed by all N, and a swapped or fabricated frame is outvoted rather than
 * obeyed.
 *
 * Returns `null` when the evidence sums to exactly zero — no ankle resolved at any instant, or a
 * perfect tie. There is then nothing in the clip that names the feet, and the caller falls back to
 * the ankle detector rather than picking a parity arbitrarily.
 */
function attributeSides(
  frames: RobustPoseFrame[],
  instants: Array<{ frameIndex: number; cycle: number }>,
): TimedInstant[] | null {
  let evidence = 0
  for (const instant of instants) {
    const difference = ankleDifference(frames[instant.frameIndex])
    if (difference === null) continue
    evidence += instant.cycle % 2 === 0 ? difference : -difference
  }
  if (evidence === 0) return null

  const evenCycleSide = evidence > 0 ? 'left' : 'right'
  const oddCycleSide = OPPOSITE_SIDE[evenCycleSide]
  return instants.map((instant) => ({
    frameIndex: instant.frameIndex,
    timestamp: frames[instant.frameIndex].timestamp,
    side: instant.cycle % 2 === 0 ? evenCycleSide : oddCycleSide,
  }))
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
 * that is 0.0155 s and 0.0555 s: sub-frame to 1.4 frames at 25 fps. Measured on the real Demo 1
 * clip against keyframe-confirmed contacts it is larger — a systematic **+0.11 s** — so the
 * bounce's low point on real footage trails midstance by more than the model allows. That is the
 * first of the two known weaknesses; see the change's design D6 and D11.
 *
 * **What actually changes is the SCATTER, and that is the point.** Same clip, same run, same
 * frames, keyframe-confirmed contacts: the ankle-difference path's four instants land at
 * −0.16 / +0.18 / +0.08 / +0.02 s (spread **0.34 s**, wider than a stance phase); this path's land
 * at +0.12 / +0.10 / +0.12 / +0.10 s (spread **0.02 s**). A per-clip systematic offset is a bias
 * every instant shares, so a runner's metric reads consistently and the offset is a property of
 * their own duty factor. A per-instant scatter is not a bias at all, and it is what put
 * `overstriding`'s and `footStrikePattern`'s Demo 1 dispersion at 73%/78%.
 *
 * The residual is pinned executably by a stance sweep in `footstrikes.test.ts`; the point of that
 * sweep is that the swing-apex sweep, which moves the other path from 1 frame to 11, does not move
 * this one at all.
 *
 * ## What is deliberately NOT here
 *
 * No constant is added, subtracted or fitted anywhere — **including no correction for the measured
 * +0.11 s.** It is a real, reproducible offset on one clip, and fitting it would repeat exactly the
 * mistake the ankle path's phase error was a proof against: the right value is a function of the
 * runner's duty factor and of how far the hip's low point trails their midstance, neither of which
 * this pipeline measures. `T/4` is the distance from a sinusoid's extremum to its inflection and
 * nothing else. The quality bar is `cadenceMinFitR2`, read through the same `isRhythmTrustworthy`
 * predicate the spacing floor uses.
 *
 * **This path asserts nothing about the POSE at the instant it predicts.** It reads the hip's
 * fitted rhythm and snaps a prediction to the nearest frame; whether the body at that frame looks
 * like a foot arriving is a question it never asks, and the ankles enter only to name the feet.
 * That is the gap `hasMeasurableAnkles` covers, and it is why that floor is scoped to this path.
 *
 * Returns `[]` — never a partial guess — when the rhythm is untrustworthy, when the clip is too
 * short to have a snap tolerance, when no predicted instant snaps to a frame, or when nothing in
 * the clip names the feet. `detectFootstrikes` reads an empty result as "fall back", so the failure
 * mode of this path is that the clip keeps the behaviour it had before this path existed.
 *
 * `firstK`/`lastK` admit the sampled span INCLUSIVELY, so this path can also place an instant on the
 * first or last frame — but only when the fitted phase happens to put a prediction within the snap
 * tolerance of an end, rather than by any mechanism. That likelihood is half a frame interval
 * against a step period, so it is a property of fps × cadence and not of this path: about 3.0% per
 * end on Demo 1's 25 fps, 2.5% on Demo 2's 60. Those instants are excluded downstream on the same
 * terms as the fallback's, through the same predicate; see `hasFramesEitherSide`.
 */
function detectFromBouncePhase(
  frames: RobustPoseFrame[],
  fit: SpectralFitResult,
  config: HeuristicsConfig,
): TimedInstant[] {
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

  const instants: Array<{ frameIndex: number; cycle: number }> = []
  const claimedFrames = new Set<number>()
  for (let k = firstK; k <= lastK; k += 1) {
    const predicted = firstTouchdown + k * period
    const index = nearestFrameIndex(frames, predicted)
    if (Math.abs(frames[index].timestamp - predicted) > tolerance) continue
    if (claimedFrames.has(index)) continue
    claimedFrames.add(index)
    instants.push({ frameIndex: index, cycle: k })
  }

  return attributeSides(frames, instants) ?? []
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
 * ## No candidate is ever emitted on the first or last frame of `frames`
 *
 * A ground contact is read as a REVERSAL, which is a claim about both sides of an instant, and at
 * either end of the series only one side exists. Both paths can reach an end — the fallback by
 * construction, the phase path by coincidence — so the rule belongs to this function rather than to
 * either of them, and every consumer inherits it without restating it. Note that `frames` here is
 * already the PRESENCE-TRIMMED window (`runClipAnalysisPipeline.ts`), so the excluded frames are
 * the edges of the subject's own presence, not of the recording. Full argument, and why the
 * fallback additionally applies it before its own amplitude ranking, in `hasFramesEitherSide`.
 *
 * The consequence worth knowing at a call site: a clip whose only detectable contacts sit on its
 * end frames reports NO footstrikes rather than reporting them unconfirmed.
 *
 * ## Two gates, and only one of them is new
 *
 * `hasFramesEitherSide` and `hasMeasurableAnkles` answer different questions about different
 * things, and confusing them is the easiest mistake to make in this file:
 *
 * | | `hasFramesEitherSide` | `hasMeasurableAnkles` |
 * |---|---|---|
 * | about | the INSTANT — is this timing confirmable | the ANKLE PAIR — do the two labels name two feet |
 * | effect | the candidate is DROPPED, for everyone | the candidate is ANNOTATED, and kept |
 * | threshold | none, structurally | `footstrikeMinAnkleSeparationRatio`, measured |
 * | applies to | both paths | the PHASE path only |
 *
 * **Annotated, not dropped, and the difference is a metric.** `strideLength` pairs same-side
 * consecutive strikes and reads only their timestamps and hip-mid, neither of which an ankle-label
 * collapse touches. Demo 1's four strikes are `right@4.20, left@4.84, right@5.52, left@6.16` and
 * exactly the outer two collapse; dropping them leaves `left@4.84` + `right@5.52`, which is **zero
 * same-side pairs**, and `verticalRatio` goes from `0.0310 @ 0.479` to `null`. Measured, not
 * predicted — the drop was built and run. So the four ankle-reading metrics skip these strikes and
 * `strideLength` deliberately does not; the asymmetry is the point, and `strideLength.ts` states it
 * at its call site so nobody "fixes" it.
 *
 * **The phase path only, and the exemption is earned rather than conceded.** The ankle-difference
 * detector runs `findLocalExtrema` over `buildContactSeries`, which IS `ankle_S.y −
 * ankle_opposite.y` — the same quantity this floor measures — at
 * `footstrikeMinProminenceRatio × torsoLengthPx`. It already vets ankle separation, in the same
 * units, as its selection criterion. Stacking a second, differently-shaped check on top would gate
 * one quantity through two constants that could disagree. The phase path vets nothing about the
 * pose: it predicts an instant from the hip's fitted rhythm and snaps it to a frame, and
 * `detectFromBouncePhase`'s own doc says so. That is the gap, and it is the whole of the gap.
 *
 * This scoping was not a convenience. Pooling both detectors' strikes into one distribution left
 * no threshold at all with 2× clearance either side — the honest reading of the pooled corpus was
 * "stop", and it was reported as such before the scope was narrowed. Separated, the phase-path
 * population has a 4.76× gap and `footstrikeMinAnkleSeparationRatio` sits inside it with 2.05× /
 * 2.32×. Numbers and provenance: that key's own doc in `types.ts`.
 *
 * ⚠️ **This does NOT address `strides-boc`'s collapse window, and must not be read as doing so.**
 * There the two ankles are both placed ~310 px from the HIP while remaining ~344 px from EACH
 * OTHER; a mutual-separation predicate is blind to it by construction, at any threshold.
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

  // Path selection FIRST, eligibility second, and the order is load-bearing. Filtering before the
  // `length > 0` test would silently redefine the fallback condition documented above from "path 1
  // produced no instant at all" to "path 1 produced nothing away from the boundary" — a different
  // rule, and one nothing in the spec states.
  const fromPhase = detectFromBouncePhase(frames, fit, config)

  // `ankleMeasurable` is annotated HERE, where the winning path is known, because the two paths
  // are not treated alike — see "Two gates, and only one of them is new" above. Annotating the
  // phase path's output (rather than inside `detectFromBouncePhase`) also keeps the floor strictly
  // after `attributeSides`, so the side vote still sees every instant's separation as the weight it
  // wants: a collapsed pair contributes ~0 to that sum on its own, which is already the right
  // answer there and needs no help from a threshold.
  const candidates: FootstrikeCandidate[] =
    fromPhase.length > 0
      ? fromPhase.map((candidate) => ({
          ...candidate,
          ankleMeasurable: hasMeasurableAnkles(
            frames[candidate.frameIndex],
            config,
            bodyScale.torsoLengthPx,
          ),
        }))
      : detectFootstrikesBetweenAnkles(frames, config, bodyScale.torsoLengthPx, fit).map(
          (candidate) => ({ ...candidate, ankleMeasurable: true }),
        )

  // And AFTER `attributeSides`, which is equally deliberate. That vote is ONE magnitude-weighted
  // decision over every instant, and a boundary instant's ankle separation is real evidence about
  // which foot is which even though its TIMING is unconfirmable — the two are separate claims about
  // the same frame. Excluding it from the vote would throw away a genuine, often large, ankle
  // separation to protect against a defect that is not in the ankles.
  //
  // The fallback ALSO applies this predicate to its extrema before ranking them, and both sites are
  // needed: that one because its amplitude-ranked suppression would otherwise let an ineligible
  // pivot delete a real contact before being dropped itself, this one because the phase path never
  // goes through it and because a single enforcement point is where the module's contract is
  // legible. One predicate, two enforcement points — not two statements of the rule.
  return candidates.filter((candidate) =>
    hasFramesEitherSide(candidate.frameIndex, frames.length),
  )
}
