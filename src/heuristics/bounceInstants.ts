import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { findNearestFrame } from '../results/skeletonGeometry'
import type { MetricExemplar } from './types'
import type { SpectralFitSuccess } from './spectralFit'
import {
  cropKeypoints,
  describeDistribution,
  pairQuality,
  scoreExemplarInstant,
} from './exemplars'
import { median } from './mathUtils'

/**
 * Turning the shared spectral fit's phase into two nameable, renderable instants — the one piece
 * of work `verticalOscillation`, `verticalOscillationCm` and `verticalRatio`'s numerator all need
 * done identically, and the one place the sign trap below is resolved.
 *
 * ## Why the phase, and never a scan of the raw signal
 *
 * The obvious alternative — walk the hip trace for its argmin/argmax — is wrong here, and not
 * merely less tidy. The fit deliberately removes a `c + d·t + e·t²` trend, so a raw extreme
 * includes whole-body translation the reported amplitude explicitly excludes; and the run-to-run
 * jitter of raw extrema is exactly what the spectral estimator was adopted to replace. An exemplar
 * scanned off the raw trace would therefore be a picture contradicting the number printed beside
 * it.
 *
 * ## The sign trap — read this before captioning anything
 *
 * A fitted maximum is a maximum of whatever series the CALLER fitted, and the two members of this
 * family fit series with OPPOSITE conventions:
 *
 * - `hipBounce.ts` fits raw image-y, which grows DOWNWARD — its sinusoid maximum is the runner's
 *   LOWEST on-screen position.
 * - `verticalOscillationCm.ts` integrates `(y[k−1] − y[k])` deltas, which is upward-positive — its
 *   sinusoid maximum is the runner's HIGHEST position.
 *
 * So `maximumIs` has no default and cannot be inferred here: a caller states its own series'
 * convention, and a wrong answer produces a caption that tells the user the exact opposite of the
 * truth while passing every type check. `bounceInstants.test.ts` asserts the direction against a
 * fixture with known geometry for both conventions, which is the only check that catches a flip.
 */

/**
 * What the fitted series' MAXIMUM means about where the body was on screen. See the module doc:
 * this is a property of the series the caller fitted, not of the fit.
 */
export type BounceMaximumPosition = 'highest' | 'lowest'

/**
 * The context points every member of this family adds around its own seed (design D2). One
 * midpoint is a zero-area rect; a torso band keeps the body recognisable while leaving the
 * vertical delta a visible fraction of the crop. Optional by contract — `cropKeypoints` drops any
 * of these that resolves nowhere in the pair's own frames.
 *
 * **The head is in the set because of WHICH instant loses it (`strides-ql0`).** A shoulders-and-
 * knees band tops out at the shoulders, and `computeEvidenceCropRect` pads from the union of both
 * instants' boxes — so the crown of the head sits above the padded top edge, and the instant it is
 * cut from is not arbitrary. The base of a bounce pair is the HIGHEST point by construction
 * (`buildBounceCycleExemplar`), so it is the base whose head leaves the frame first, while the
 * lower ghost keeps its whole head. Measured on Demo 2 before this changed: the base's nose/ear
 * line cleared the crop's top edge by 35.5 px against the ghost's 87.5 px, on a 720 px crop, and
 * the visible scalp above that line was clipped on the base alone. The composite then held exactly
 * one complete, legible face and it belonged to the GHOST — so a reader anchored on the ghost's
 * face as "the runner" and read the correctly-drawn solid skeleton, sitting above it on the base's
 * body, as mis-registered.
 *
 * Adding them ENLARGES both per-instant boxes and their union, which is why it is not free and was
 * measured rather than assumed. It moves `evidencePairCropGrowth` toward 1 rather than away from
 * it: the growth ratio is `demand(union) / max(demand(base), demand(ghost))`, and a head raises
 * the union's long side and each solo box's long side by very nearly the same number of pixels, so
 * the ratio of two quantities greater than 1 falls when both gain the same addend. Every
 * bounce-family pair on all three test clips moved DOWN, the largest reading going 1.197 → 1.132
 * against a 2.5 threshold. See `EVIDENCE_MAX_PAIR_CROP_GROWTH`.
 */
export const BOUNCE_CONTEXT_KEYPOINTS: KeypointName[] = [
  'left_shoulder',
  'right_shoulder',
  'left_knee',
  'right_knee',
  'nose',
  'left_ear',
  'right_ear',
]

/**
 * Midpoint of the span a fit actually saw, given a per-frame series whose `null`s mark the frames
 * that contributed no sample. `null` when nothing resolved.
 *
 * Deliberately not the midpoint of `frames` itself: leading or trailing unresolvable frames sit
 * outside the fit's own span, and ranking cycles against the wrong centre picks the wrong cycle.
 */
export function resolvedSpanCenter(
  frames: RobustPoseFrame[],
  series: ReadonlyArray<number | null>,
): number | null {
  let first: number | null = null
  let last: number | null = null
  for (let i = 0; i < frames.length; i += 1) {
    if (series[i] === null || series[i] === undefined) continue
    if (first === null) first = frames[i].timestamp
    last = frames[i].timestamp
  }
  return first === null || last === null ? null : (first + last) / 2
}

/** The two sampled frames a bounce half-cycle resolves to, named by body position rather than by
 * the sign of the fit that produced them. */
export interface BounceInstants {
  /** Body at the top of the bounce. */
  highest: RobustPoseFrame
  /** Body at the bottom of the same bounce, half a fitted period away. */
  lowest: RobustPoseFrame
}

export interface BounceInstantOptions {
  fit: SpectralFitSuccess
  /**
   * The frames the fitted samples were drawn from, in timestamp order. Both the snap target and
   * the source of the sampling interval the snap tolerance is derived from — so a fit is only ever
   * resolved against footage it actually saw.
   */
  frames: RobustPoseFrame[]
  /** Midpoint of the fit's own observed span, in seconds. The selected cycle is the one whose
   * midpoint sits nearest here — the most-supported cycle, rather than an edge one propped up by
   * a handful of samples. */
  spanCenterSeconds: number
  maximumIs: BounceMaximumPosition
}

/**
 * Half the median interval between consecutive frames — the distance beyond which a continuous
 * instant is closer to some other frame than to the one `findNearestFrame` returned.
 *
 * A tolerance is mandatory rather than nice-to-have: `findNearestFrame` CLAMPS and carries no
 * distance limit of its own, so without this check a timestamp outside the sampled window resolves
 * silently to the first or last frame of it.
 */
function snapToleranceSeconds(frames: RobustPoseFrame[]): number | null {
  if (frames.length < 2) return null
  const intervals: number[] = []
  for (let i = 1; i < frames.length; i += 1) {
    intervals.push(frames[i].timestamp - frames[i - 1].timestamp)
  }
  return median(intervals) / 2
}

function snapToFrame(
  frames: RobustPoseFrame[],
  t: number,
  tolerance: number,
): RobustPoseFrame | null {
  const frame = findNearestFrame(frames, t)
  if (frame === null) return null
  return Math.abs(frame.timestamp - t) <= tolerance ? frame : null
}

/**
 * Resolves the fit's best-supported (maximum, adjacent minimum) pair to two real sampled frames.
 *
 * The candidates are every maximum the fitted phase puts inside the frames' own span, each paired
 * with whichever adjacent minimum also falls inside it; the winner is the one whose MIDPOINT sits
 * closest to `spanCenterSeconds` — the cycle the fit has the most evidence for, rather than an
 * edge one propped up by a handful of samples. That one pair is then snapped, and `null` is
 * returned if either half fails, rather than walking outward to a less-supported cycle: a
 * fallback would emit a picture of a different bounce from the one this selection claims to have
 * chosen, and the caller emitting nothing is a supported state.
 *
 * Both halves landing on the SAME sampled frame is likewise a `null`: one frame ghosted against
 * itself depicts no delta. (Half a bounce period is many frame intervals at any plausible cadence,
 * so this is a guard, not a routine path.)
 */
export function selectBounceInstants(
  options: BounceInstantOptions,
): BounceInstants | null {
  const { fit, frames, spanCenterSeconds, maximumIs } = options
  const tolerance = snapToleranceSeconds(frames)
  if (tolerance === null) return null
  if (!(fit.frequencyHz > 0) || !Number.isFinite(fit.frequencyHz)) return null

  const period = 1 / fit.frequencyHz
  const halfPeriod = period / 2
  const omega = 2 * Math.PI * fit.frequencyHz
  // `A·sin(ω·(t − tMean) + φ)` peaks where its argument is `π/2`, and again every full period.
  const firstMaximum = fit.tMeanSeconds + (Math.PI / 2 - fit.phaseRadians) / omega

  const spanStart = frames[0].timestamp
  const spanEnd = frames[frames.length - 1].timestamp

  let best: { maximum: number; minimum: number } | null = null
  let bestOffset = Infinity
  const firstK = Math.ceil((spanStart - firstMaximum) / period)
  const lastK = Math.floor((spanEnd - firstMaximum) / period)
  for (let k = firstK; k <= lastK; k += 1) {
    const maximum = firstMaximum + k * period
    for (const minimum of [maximum - halfPeriod, maximum + halfPeriod]) {
      if (minimum < spanStart || minimum > spanEnd) continue
      const offset = Math.abs((maximum + minimum) / 2 - spanCenterSeconds)
      if (offset >= bestOffset) continue
      best = { maximum, minimum }
      bestOffset = offset
    }
  }
  if (best === null) return null

  const maximumFrame = snapToFrame(frames, best.maximum, tolerance)
  const minimumFrame = snapToFrame(frames, best.minimum, tolerance)
  if (maximumFrame === null || minimumFrame === null) return null
  if (maximumFrame === minimumFrame) return null

  return maximumIs === 'highest'
    ? { highest: maximumFrame, lowest: minimumFrame }
    : { highest: minimumFrame, lowest: maximumFrame }
}

/**
 * The family's whole exemplar contribution: at most one ghosted pair depicting one bounce
 * half-cycle, top against bottom.
 *
 * Scored on DETECTION ALONE, deliberately. Every other exemplar in this package carries the
 * instant's own measured value and is judged on how that sits in the metric's own distribution —
 * but a fitted amplitude has no per-instance values to form a distribution from, and inventing
 * one (say, the raw hip-y excursion at that frame) would reintroduce exactly the jittery quantity
 * the fit replaced. Omitting `value` makes the shared gate score `detectionFactor` alone, which is
 * the honest reading: for this family the only per-instant question is how well the seed was
 * tracked at that moment.
 *
 * The BASE is the highest point (design D1's row for this family), so the pair reads top-first
 * regardless of which sign convention produced it.
 */
export function buildBounceCycleExemplar(
  options: BounceInstantOptions & { seed: KeypointName[] },
): MetricExemplar[] {
  const { seed, ...instantOptions } = options
  const instants = selectBounceInstants(instantOptions)
  if (instants === null) return []

  // No per-instance distribution exists here — see this function's doc. `scoreExemplarInstant`
  // reads it only when an instant carries a `value`, which neither of these does.
  const distribution = describeDistribution([])
  const highestQuality = scoreExemplarInstant(
    { frame: instants.highest, seed },
    'representative',
    distribution,
  )
  const lowestQuality = scoreExemplarInstant(
    { frame: instants.lowest, seed },
    'representative',
    distribution,
  )
  if (highestQuality === null || lowestQuality === null) return []

  return [
    {
      kind: 'bounceCycle',
      timestamp: instants.highest.timestamp,
      pairedTimestamp: instants.lowest.timestamp,
      quality: pairQuality(highestQuality, lowestQuality),
      label: 'Highest point of the bounce, ghosted against the lowest',
      cropKeypoints: cropKeypoints(seed, BOUNCE_CONTEXT_KEYPOINTS, [
        instants.highest,
        instants.lowest,
      ]),
    },
  ]
}
