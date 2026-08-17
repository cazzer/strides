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
