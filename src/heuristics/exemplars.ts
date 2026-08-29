import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { MetricExemplar } from './types'
import { resolvePoint } from './keypoints'
import { median } from './mathUtils'

/**
 * The shared quality gate every metric's exemplar candidates go through — one implementation,
 * imported, never copied per module, so the threshold below cannot drift per metric.
 *
 * A candidate instant's `quality` is the product of exactly two factors: how much of the metric's
 * own input at that instant was directly detected rather than interpolated or missing, and how
 * the instant's own measured value sits relative to the metric's own distribution. What "sits
 * well" means is ROLE-dependent, and that split is the whole point — see `ExemplarRole`.
 *
 * Deliberately NOT built from `RobustKeypoint.score`: an interpolated keypoint carries a lerp of
 * its neighbours' scores and reads misleadingly confident, which is exactly why the robustness
 * layer's own contract tells consumers to gate on `status` rather than `score`.
 */

/**
 * Minimum `quality` for an exemplar to be emitted at all — better to show nothing than a picture
 * nobody should read as evidence.
 *
 * **This is a judgment call, not a derived number**, in the same spirit as
 * `presenceMinConsecutiveFrames`'s own doc. It is pre-registered for measurement: per-clip,
 * per-metric coverage gets reported once the gallery runs on real footage, and a metric gated out
 * on EVERY clip is a finding to report rather than a number to quietly tune down.
 */
export const MIN_EXEMPLAR_QUALITY = 0.5

/** At most this many exemplars per metric. A ghosted pair counts as ONE — it produces one image. */
export const MAX_EXEMPLARS_PER_METRIC = 2

/**
 * Below this many per-instance values there is no distribution to judge an instant against — a
 * median and a spread over three samples describe the samples, not the runner.
 */
const MIN_INSTANCES_FOR_TYPICALITY = 5

/** Half-width, in median-absolute-deviations, of both the typicality ramp and the outlier bound. */
const OUTLIER_BOUND_MADS = 3

/**
 * - **representative** — "this is what the reported number looks like". Closeness to the metric's
 *   own median is GOOD.
 * - **extreme** — "this is one end of the range the metric measured". Distance from the median is
 *   the evidence, so closeness is BAD; an unbounded outlier is also bad, which is what
 *   `isOutlier`'s hard reject is for.
 *
 * A naive "distance from the median is bad" rule would gate out exactly the instants a range
 * exemplar exists to show.
 */
export type ExemplarRole = 'representative' | 'extreme'

export interface ExemplarDistribution {
  median: number
  /** Median absolute deviation about `median` — a robust spread, so one tracking glitch can't
   * widen the bound that is supposed to catch it. */
  mad: number
  sampleCount: number
  /** Whether there is enough of a distribution here to judge an instant against at all. */
  usable: boolean
}

/**
 * Describes the metric's OWN per-instance values (`overstrideRatios`, `offsetRatios`,
 * `leanValues`, peak `valueDeg`, …) — never a cross-metric or cross-clip distribution.
 */
export function describeDistribution(values: number[]): ExemplarDistribution {
  if (values.length === 0) {
    return { median: NaN, mad: 0, sampleCount: 0, usable: false }
  }
  const m = median(values)
  const mad = median(values.map((v) => Math.abs(v - m)))
  return {
    median: m,
    mad,
    sampleCount: values.length,
    usable: mad > 0 && values.length >= MIN_INSTANCES_FOR_TYPICALITY,
  }
}

/**
 * Hard reject, extreme instants only: a raw argmax that is a tracking glitch is thrown out, not
 * merely down-ranked, so a range ghost can never be two detector failures.
 *
 * Never rejects when there is no usable distribution — a bound derived from zero spread would
 * reject every instant that isn't exactly the median, which is the opposite of the fallback the
 * scoring rule takes in that same case.
 */
export function isOutlier(value: number, distribution: ExemplarDistribution): boolean {
  if (!distribution.usable) return false
  return Math.abs(value - distribution.median) > OUTLIER_BOUND_MADS * distribution.mad
}

function typicalityFactor(
  value: number,
  distribution: ExemplarDistribution,
  role: ExemplarRole,
): number {
  // No distribution to judge against: don't pretend to a confidence the data can't support. A
  // representative instant is as typical as anything else here (1); an extreme one is simply
  // unknown (0.5), which lands exactly on the gate rather than sailing through it.
  if (!distribution.usable) return role === 'representative' ? 1 : 0.5

  const spread = Math.min(
    1,
    Math.abs(value - distribution.median) / (OUTLIER_BOUND_MADS * distribution.mad),
  )
  return role === 'representative' ? 1 - spread : spread
}

/**
 * Hard reject: an instant with no resolvable crop-seed keypoint at all has no region to crop
 * around.
 *
 * Deliberately "at least one resolves", NOT "all of them resolve". Most seeds here are bilateral
 * pairs that `resolveMidpoint` resolves from a single side, so an all-must-resolve rule would
 * throw away instants the metric successfully measured and whose crop is perfectly derivable —
 * the crop rect is the union of the RESOLVABLE seed points, and a one-sided seed still names a
 * position. `stepWidth`/`stepWidthCm` are the exception that hides the difference: they gate on
 * the strict `resolveBilateralPair`, so for them every measurable instant has its whole seed
 * resolvable anyway.
 */
export function cropDerivable(frame: RobustPoseFrame, seed: KeypointName[]): boolean {
  return seed.some((name) => resolvePoint(frame, name) !== null)
}

/**
 * Fraction of the instant's own metric-input keypoints that resolved `'detected'` — an
 * interpolated or unrecoverable point counts against it, a detected one for it.
 *
 * Read per KEYPOINT rather than per resolved input, deliberately. `resolveMidpoint` reports
 * `interpolated: true` whenever it stood one side in for a pair, even when that side was itself
 * detected; a metric with two midpoint inputs would therefore score a flat 0 on any frame where
 * both pairs were one-sided — which is 17-22% of frames on this repo's own reference clip, and
 * would gate the metric out on real footage entirely. Counting keypoints instead makes a
 * one-sided pair a partial penalty (one of two points missed) rather than a total one, which is
 * what "interpolation penalises, it does not disqualify" is supposed to mean.
 */
export function detectionFactor(frame: RobustPoseFrame, seed: KeypointName[]): number {
  if (seed.length === 0) return 1
  const detected = seed.filter((name) => {
    const point = resolvePoint(frame, name)
    return point !== null && !point.interpolated
  }).length
  return detected / seed.length
}

export interface ExemplarInstant {
  frame: RobustPoseFrame
  /** The keypoints the metric itself read at this instant — D2's crop SEED, which is the same set
   * by construction: the seed is defined as "the keypoints the metric reads". */
  seed: KeypointName[]
  /**
   * The instant's own measured value, on the metric's own scale. OMITTED for a CONTEXT instant —
   * one that makes a measurement legible without being a measurement itself (`kneeFlexion`'s
   * extension trough) — which has no place in the metric's distribution and therefore no
   * typicality to judge.
   */
  value?: number
}

/**
 * Scores one candidate instant, or returns `null` when it is hard-rejected outright.
 *
 * Two of the four hard rejects live here (no derivable crop; the outlier bound). The third is the
 * metric's own per-instance degenerate fallback — `stepWidth.ts`/`stepWidthCm.ts`'s invented
 * outward polarity — which only the metric can see, so those two modules apply it at their own
 * call sites. The fourth, a snap failure against the sampled frames, cannot arise here: every
 * timestamp a metric emits is read off a frame it already measured.
 */
export function scoreExemplarInstant(
  instant: ExemplarInstant,
  role: ExemplarRole,
  distribution: ExemplarDistribution,
): number | null {
  if (!cropDerivable(instant.frame, instant.seed)) return null
  if (instant.value !== undefined && role === 'extreme' && isOutlier(instant.value, distribution)) {
    return null
  }
  const typicality =
    instant.value === undefined ? 1 : typicalityFactor(instant.value, distribution, role)
  return detectionFactor(instant.frame, instant.seed) * typicality
}

/** A ghosted pair is only as trustworthy as its weaker instant — one unreadable half makes one
 * unreadable image, so the pair takes the minimum rather than an average that would hide it. */
export function pairQuality(a: number, b: number): number {
  return Math.min(a, b)
}

/** The two ends of a range exemplar, already ordered for drawing. */
export interface ExtremePair<T> {
  /** The end further from the metric's median — drawn at full opacity, because a range ghost is
   * *about* its far end. */
  base: T
  /** The nearer end, ghosted over the base. */
  ghost: T
  /** `pairQuality` of the two ends' own scores. */
  quality: number
}

interface RankedEnd<T> {
  candidate: T
  value: number
  quality: number
  /** Distance from the metric's median, the tie-break — and the base/ghost decision. */
  deviation: number
}

function betterEnd<T>(current: RankedEnd<T> | null, next: RankedEnd<T>): RankedEnd<T> {
  if (current === null) return next
  if (next.quality > current.quality) return next
  // Ties are common, not exotic: with no usable distribution every typicality term is the flat 0.5
  // fallback, so an entire candidate set can score identically. Breaking toward the more extreme
  // instant is what makes ranking a strict generalisation of picking the value extreme — on a clip
  // whose candidates are all equally well tracked the two rules select the same pair.
  if (next.quality === current.quality && next.deviation > current.deviation) return next
  return current
}

/**
 * Picks the two ends of a RANGE exemplar — the pair whose ghost says "this metric measured
 * anywhere from here to here" — by RANKING every candidate on the quality it would actually be
 * emitted with, and taking the best-scoring one at each end.
 *
 * The order matters and is the whole point. Taking the raw argmax/argmin of the metric's own value
 * and scoring THAT afterwards makes the score a veto on one pre-chosen frame rather than a ranking
 * over many: `pairQuality` is a minimum, so a single badly-tracked instant sitting at the value
 * extreme takes the pair to zero and gates out a metric that had plenty of well-tracked candidates
 * the selection never looked at. Measured on this repo's own reference clip, `trunkLean`'s
 * most-forward instant had all four torso seeds interpolated (`detectionFactor` 0) while 18 other
 * instants cleared the typicality ramp — and the metric emitted nothing.
 *
 * **The median split is not an extra rule, it is the range itself.** For an extreme instant
 * typicality reads |value − median|, blind to direction, so an unconstrained "two best scores"
 * would happily return two instants from the same end and ghost a frame against its near-twin.
 * Each end is therefore drawn from its own side of the metric's median. That is also EXACTLY the
 * best-scoring valid pair rather than a proxy for it: `pairQuality` is a minimum of two
 * independent scores, so `max over pairs of min(q_high, q_low)` is `min(max q_high, max q_low)` —
 * the per-side argmax IS the argmax pair, with no search.
 *
 * Sides are taken inclusively so an instant sitting exactly ON the median is eligible for either
 * end rather than silently ineligible for both. With a usable distribution such an instant scores
 * 0 for this role and never wins anyway; with an unusable one it can, and dropping it would have
 * narrowed coverage for no statable reason.
 *
 * Ranking runs AFTER the hard rejects, never instead of them: `scoreExemplarInstant` returns
 * `null` for an instant with no derivable crop or one beyond the outlier bound, and those are
 * skipped as ineligible rather than merely ranked low — so this can never promote a tracking
 * glitch into the picture.
 *
 * Returns `null` when there is no honest range to show: nothing eligible on one side, or both ends
 * landing on the same instant or the same value (a clip whose measurement never varied has no
 * range, and ghosting a frame against itself would depict one).
 */
export function selectExtremePair<T>(
  candidates: readonly T[],
  toInstant: (candidate: T) => ExemplarInstant,
  distribution: ExemplarDistribution,
): ExtremePair<T> | null {
  let high: RankedEnd<T> | null = null
  let low: RankedEnd<T> | null = null

  for (const candidate of candidates) {
    const instant = toInstant(candidate)
    // A context instant carries no value, so it has no side of the median to be an end of.
    if (instant.value === undefined) continue
    const quality = scoreExemplarInstant(instant, 'extreme', distribution)
    if (quality === null) continue

    const end: RankedEnd<T> = {
      candidate,
      value: instant.value,
      quality,
      deviation: Math.abs(instant.value - distribution.median),
    }
    if (instant.value >= distribution.median) high = betterEnd(high, end)
    if (instant.value <= distribution.median) low = betterEnd(low, end)
  }

  if (high === null || low === null) return null
  // `high.value >= median >= low.value`, so equal values means both ends sat exactly on the
  // median — which also covers the two ends being one and the same candidate.
  if (high.value === low.value) return null

  const [base, ghost] = high.deviation >= low.deviation ? [high, low] : [low, high]
  return {
    base: base.candidate,
    ghost: ghost.candidate,
    quality: pairQuality(high.quality, low.quality),
  }
}

/**
 * Constructs the opposite-side instant pair the step-width metrics need and do not already have.
 * Those metrics measure each strike independently against the hip midline, and `detectFootstrikes`
 * returns one merged, timestamp-ordered list whose consecutive entries are NOT guaranteed to
 * alternate sides — so "left plant next to right plant", which is what a *width* looks like, has
 * to be built rather than read off.
 *
 * Among ADJACENT opposite-side entries of the ordered list, returns the pair minimising the mean
 * distance from the metric's own median — the most representative pair, not the widest. `null`
 * when every adjacency is same-side, which is the caller's cue to demote to a single strike: one
 * strike against the hip midline is one whole measurement, so a single frame is still honest for
 * these two metrics specifically.
 */
export function selectOppositeSidePair<T extends { side: 'left' | 'right'; value: number }>(
  ordered: T[],
  distribution: ExemplarDistribution,
): [T, T] | null {
  let best: [T, T] | null = null
  let bestCost = Infinity
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const [a, b] = [ordered[i], ordered[i + 1]]
    if (a.side === b.side) continue
    const cost =
      (Math.abs(a.value - distribution.median) + Math.abs(b.value - distribution.median)) / 2
    if (cost < bestCost) {
      best = [a, b]
      bestCost = cost
    }
  }
  return best
}

/**
 * The exemplar's crop keypoints: the SEED (the points the metric itself read) plus whichever
 * CONTEXT points actually resolve somewhere in the exemplar's own frames.
 *
 * Context is strictly optional by design — `left_heel`/`right_heel`/`left_foot_index`/
 * `right_foot_index` are MediaPipe-only, and on MoveNet they resolve `'unrecoverable'`, so a crop
 * that trusted one would silently anchor at nothing. The crop stays well-defined from the
 * resolvable part of the seed alone, which `cropDerivable` has already guaranteed by this point.
 */
export function cropKeypoints(
  seed: KeypointName[],
  context: KeypointName[],
  frames: RobustPoseFrame[],
): KeypointName[] {
  const names = [...new Set(seed)]
  for (const name of context) {
    if (names.includes(name)) continue
    if (frames.some((frame) => resolvePoint(frame, name) !== null)) names.push(name)
  }
  return names
}

/**
 * The one place the gate and the budget are applied. Returns `undefined` rather than an empty
 * array when nothing clears the gate, so `MetricResult.exemplars` is simply ABSENT — "this metric
 * never emits exemplars" and "this run's candidates were all gated out" then read the same way at
 * the metric layer, and eleven metric modules stay free of an empty-array-versus-`undefined`
 * subtlety. The layer that genuinely needs to tell those apart is the plan layer, which has its
 * own discriminated no-evidence result for it.
 */
export function selectExemplars(candidates: MetricExemplar[]): MetricExemplar[] | undefined {
  const kept = candidates
    .filter((candidate) => candidate.quality >= MIN_EXEMPLAR_QUALITY)
    .sort((a, b) => b.quality - a.quality)
    .slice(0, MAX_EXEMPLARS_PER_METRIC)
  return kept.length > 0 ? kept : undefined
}
