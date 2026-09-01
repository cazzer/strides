import type { KeypointName } from '../pose/types'
import { viewPhrase } from './viewDetection'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricExemplar, MetricResult, View } from './types'
import { estimateBodyScale } from './bodyScale'
import { estimateTravelDirection } from './travelDirection'
import { resolveMidpoint, resolvePoint } from './keypoints'
import { detectFootstrikes } from './footstrikes'
import type { FootstrikeCandidate } from './footstrikes'
import { computeMetricConfidence } from './confidence'
import {
  attachPairAlternates,
  cropKeypoints,
  describeDistribution,
  selectExemplars,
  selectExtremePairs,
} from './exemplars'
import type { ExemplarDistribution } from './exemplars'
import { median } from './mathUtils'

/**
 * Roughly one full gait cycle's worth of footstrikes — two per leg — which is the smallest sample
 * that has seen both feet do the whole thing once. That is the basis, and it is a GAIT one.
 *
 * ## What this constant does NOT claim
 *
 * It used to say "fewer strikes than this is too easily dominated by a single noisy detection".
 * That sentence is false, and `stepWidth.ts:18-83` demolishes it in full for the identical
 * estimator: at `n = 4` with one contaminant the median is `mean(rank2, rank3)` =
 * `mean(clean median, clean MAX)`, so half the reported number is the worst clean sample. Four is
 * dominated by one bad strike. The claim is deleted rather than repaired, because the honest
 * defence of 4 is the gait cycle above and never was the arithmetic.
 *
 * ## The derived `n >= 2k + 3` bound does NOT endorse 4, and this docstring will not pretend it does
 *
 * `stepWidth`'s rule prices `k` contaminants biased the same way. It took `k = 2` from two measured
 * mechanisms, and only ONE of them has since been removed:
 *
 * - boundary strikes (`strides-aah`) — excluded in `detectFootstrikes`, gone;
 * - detector-dropout windows where surviving detections collapse both ankles onto one point
 *   (`strides-boc`) — **still present**. `stepWidth.ts:18-83` calls it "NOT fixed and not fixable at
 *   this layer", and it is not fixable HERE either: that failure puts both ankles far from the HIP
 *   while leaving them far apart from EACH OTHER, so the separation floor above is blind to it by
 *   construction (`footstrikes.ts`, "Two gates", and this change's design D11).
 *
 * The collapsed-ankle strikes this file now skips are a THIRD mechanism, not `stepWidth`'s second
 * one. So on `stepWidth`'s own accounting `k = 1`, giving `n >= 5` — which **4 does not clear**. At
 * `n = 4, k = 1` the median is `mean(clean median, clean MAX)`, the exact failure the deleted
 * sentence above was wrong about.
 *
 * ## Why it holds at 4 anyway
 *
 * Because the gait cycle is what this constant means, and that argument needs no `k` at all. Moving
 * it is a separate decision with its own blast radius, which `stepWidth.ts` explicitly reserved when
 * it declined to sweep its four siblings — and this change is not that decision. Two things bound
 * the cost of leaving it: the minimum DISCOUNTS, it never withholds (`min(1, n / 4)` plus the caveat
 * below, never a `null`), and moving it up would compound with the discount this gate already
 * applies to the same thinning. On Demo 1 that is the difference between `min(1, 2/4) = 0.5` and a
 * doubly-charged `2/7 = 0.143`.
 *
 * **Revisit** when `strides-boc`'s dropout mechanism is addressed — at that point `k` really does
 * reach 0 and the derived bound becomes `n >= 3`, which is the first moment the arithmetic and this
 * value agree. Tracked as `strides-dbh`, together with the sibling sweep.
 */
const MIN_OVERSTRIDE_SAMPLE_SIZE = 4

/**
 * Unconditional disclosure of the sampling-instant limitation — present on EVERY result that has a
 * non-null `value`, including the cleanest, highest-confidence one, modelled on
 * `footStrikePattern.ts`'s `PROXY_CAVEAT`. Prepended first in the `caveats` array wherever `value`
 * is non-null, exactly as that sibling metric's proxy disclaimer is.
 *
 * ## Why this exists: `strides-pr1`, successor to the closed `strides-24s`
 *
 * `detectFootstrikes`' phase-based instant is `T/4` before the fitted hip-bounce low point
 * (midstance), not the moment of ground contact — a real, reproducible offset, measured on Demo 1
 * against keyframe-confirmed onsets at roughly +0.10 to +0.12s. Because the hip advances while the
 * planted foot stays put, that lag SHRINKS the measured ankle-to-hip offset: the reported ratio
 * reads systematically LOWER than the ratio at true touchdown. `strides-24s` spiked and rejected
 * three correction strategies (a duty-factor closed form, ankle-x stationarity, a constant offset
 * fitted to one clip's contacts — the last explicitly prohibited by name, since the underlying
 * quantity was measured to vary 37x across the one corpus available). This metric's `value` is
 * therefore left uncorrected, and this caveat exists so the card stops implying a precision (an
 * exact touchdown geometry) that the sampled instant does not have.
 *
 * ## Why "lower bound" and why no number
 *
 * The lag consistently REMOVES reach rather than adding it (the foot has already begun retracting
 * relative to the advancing hip by the time the metric samples it), so `value` should be read as a
 * lower bound on how far the foot actually lands ahead of the hip — not a two-sided error band.
 * The MECHANISM is general (any clip with this lag direction), but the MAGNITUDE was measured on a
 * single clip and is not known to transfer, so this text names the direction and never quotes a
 * figure — asserted in tests via `/\d/`.
 *
 * The lower-bound claim itself holds only when the metric KNOWS which way the runner travels.
 * When `estimateTravelDirection` returns `0` the ratio is computed from raw `dx` with no sign
 * correction, so the lag's effect on the reported number has no derivable direction — for a
 * right-to-left runner it INFLATES `dx` rather than shrinking it. On that branch
 * `SAMPLING_INSTANT_CAVEAT_UNKNOWN_DIRECTION` ships instead: the same disclosure, the same
 * unconditional presence, no bias-direction claim. The WORDING is conditional; the presence
 * never is.
 *
 * A follow-up spike (`resolve-the-overstriding-sampling-instant`, sampling the metric's own signal
 * at its own forward-reach extremum instead of the detected instant) measured a candidate fix that
 * passed its accuracy gates convincingly but failed a pre-registered materiality gate — it could
 * only resolve an interior extremum on a minority of the corpus's otherwise-usable strikes, because
 * a majority of real footage lacks either a known travel direction or a trustworthy fitted step
 * period, both of which the search structurally requires. See that change's design.md for the full
 * gate table. This constant is this change's entire shipped surface.
 */
const SAMPLING_INSTANT_CAVEAT =
  'Overstriding is measured at the footstrike instant this pipeline can detect, which tends to trail the true moment of ground contact — treat this value as a lower bound on how far the foot actually lands ahead of the hip, not a precise touchdown measurement.'

/** The unknown-travel-direction wording of the disclosure above: same lag, same unconditional
 * presence, but no lower-bound claim — with no resolved travel direction there is no derivable
 * sign for the bias (see the sibling constant's doc). Digit-free on the same terms. */
const SAMPLING_INSTANT_CAVEAT_UNKNOWN_DIRECTION =
  'Overstriding is measured at the footstrike instant this pipeline can detect, which tends to trail the true moment of ground contact — and with the direction of travel unresolved, the direction of the resulting bias is unknown, so treat this value as approximate rather than a precise touchdown measurement.'

const ANKLE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_ankle',
  right: 'right_ankle',
}

/** Exemplar context only — this metric never reads knee position. It earns its place twice over:
 * a hip-to-ankle CROP box with no knee in it reads as an empty diagonal, and in an instant's
 * ANNOTATION set the knee is what supplies `SKELETON_EDGES`' hip→knee and knee→ankle bones, so the
 * marked ankle reads as the end of the leg the caliper measured rather than a loose dot. */
const KNEE_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_knee',
  right: 'right_knee',
}

interface StrikeSample {
  frame: RobustPoseFrame
  side: 'left' | 'right'
  ratio: number
}

/** The points the metric itself reads at a strike: the striking foot, against the hip midline. */
function seedFor(sample: StrikeSample): KeypointName[] {
  return [ANKLE_NAME[sample.side], 'left_hip', 'right_hip']
}

/**
 * The most- and least-overstriding strike, ghosted into one image — an EXTREME pair, because what
 * this metric's picture is about is the range of foot placements it measured, not their median.
 * Both instants must survive the outlier bound first, so the ghost can never be two tracking
 * glitches; among the survivors `selectExtremePairs` RANKS by the quality each strike would be
 * emitted with, rather than taking the raw argmax and scoring it afterwards.
 *
 * It returns the pairs it BEAT as well as the winner, and they ride along as the emitted
 * exemplar's `alternates`. Whether a pair can be drawn as one legible image depends on pixel
 * geometry and display constants this layer does not hold, so the runners-up are what stop one
 * un-drawable pair from taking the whole metric's evidence with it.
 */
function buildExemplars(
  samples: StrikeSample[],
  distribution: ExemplarDistribution,
): MetricExemplar[] {
  const pairs = selectExtremePairs(
    samples,
    (sample) => ({
      frame: sample.frame,
      seed: seedFor(sample),
      value: sample.ratio,
    }),
    distribution,
  )

  // Base is the more extreme of the two — a range ghost is about its far end (see trunkLean's
  // identical reasoning).
  return attachPairAlternates(
    pairs.map(({ base, ghost, quality }) => ({
      kind: 'overstrideRange' as const,
      timestamp: base.frame.timestamp,
      pairedTimestamp: ghost.frame.timestamp,
      // Only meaningful when the two strikes happen to be the same foot; the pair is not
      // constructed to be same-side, so most of the time there is no one side to name. Derived
      // PER PAIR rather than once: two alternatives of the same exemplar can fall differently,
      // and a `side` copied from the winner would claim a foot the picture does not show.
      ...(base.side === ghost.side && { side: base.side }),
      // Which foot each half of the picture was measured from, emitted unconditionally because
      // this metric always knows it — unlike `side` above, whose presence is a property of how the
      // pair happened to fall. Without it a mixed-foot pair (the usual case) reaches the evidence
      // layer with no way to tell which ankle the offset was taken from.
      measuredSide: base.side,
      pairedMeasuredSide: ghost.side,
      // What each instant's own measurement was about, as distinct from what the IMAGE has to
      // contain. The crop below unions both strikes because one photograph holds both; annotating
      // each instant with that union draws the trailing leg's ankle and knee on a body whose
      // caliper measured the other foot, which is a picture of a measurement nobody took.
      //
      // Filtered against that instant's OWN frame, not both — this makes the set a property of the
      // instant, so the same strike appearing in two different `alternates` pairs gets the same
      // one. Visually identical either way: a knee that resolves only in the other instant's frame
      // comes back `'unrecoverable'` from `resolveInstantKeypoints` and `builder.point` drops it.
      annotationKeypoints: cropKeypoints(
        seedFor(base),
        [KNEE_NAME[base.side]],
        [base.frame],
      ),
      pairedAnnotationKeypoints: cropKeypoints(
        seedFor(ghost),
        [KNEE_NAME[ghost.side]],
        [ghost.frame],
      ),
      quality,
      label: 'Furthest-reaching footstrike, ghosted against the closest-landing one',
      cropKeypoints: cropKeypoints(
        [...seedFor(base), ...seedFor(ghost)],
        [KNEE_NAME[base.side], KNEE_NAME[ghost.side]],
        [base.frame, ghost.frame],
      ),
    })),
  )
}

function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  frameCoverage = 0,
): MetricResult {
  return {
    metric: 'overstriding',
    value: null,
    unit: 'ratio',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage,
    sampleSize: 0,
    caveat,
  }
}

/**
 * Overstriding: at each footstrike, how far ahead of the hip (in the direction of travel) the
 * foot lands, as a fraction of torso length. Positive = foot lands ahead of the hip.
 * Hard-gated to side view, for the same reasoning as trunk lean but with a worse failure mode:
 * front-view ankle-x-offset reflects mediolateral foot placement, not fore-aft reach, and could
 * coincidentally look like a "good" (small) number rather than an obviously-wrong one.
 */
export function computeOverstriding(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.overstriding[view]
  const bodyScale = estimateBodyScale(frames)

  if (bodyScale === null) {
    return nullResult(
      viewFitEntry.fit,
      'No resolvable body-scale reference (shoulders/hips) in this clip.',
    )
  }

  const { torsoLengthPx } = bodyScale
  const travelDirection = estimateTravelDirection(frames, bodyScale)
  const travelDirectionKnown = travelDirection !== 0

  const candidates: FootstrikeCandidate[] = detectFootstrikes(frames, config)

  const candidateStrikeCount = candidates.length
  if (candidateStrikeCount === 0) {
    return nullResult(viewFitEntry.fit, 'No footstrikes could be detected in this clip.')
  }

  let interpolatedCount = 0
  /** Strikes skipped for a collapsed ankle pair, kept apart from the hip-unresolvable skips so the
   * caveat can name the cause the reader can act on. */
  let unmeasurableAnkleCount = 0
  const overstrideRatios: number[] = []
  // Index-parallel to `overstrideRatios` — and only to it, never to `candidates`, which still
  // holds the strikes skipped below. Recovering a ratio's strike as `candidates[i]` would be off
  // by however many strikes had no resolvable hip.
  const strikeSamples: StrikeSample[] = []
  for (const candidate of candidates) {
    // Shares the `continue` below, and belongs with it: a strike whose two ankle labels have
    // collapsed onto one point IS an ankle that failed to resolve — it merely presents as
    // resolved, which is what makes it dangerous rather than merely absent. Same bucket, so the
    // same treatment, including staying in `frameCoverage`'s denominator. Defined once, in
    // `footstrikes.ts`.
    if (!candidate.ankleMeasurable) {
      unmeasurableAnkleCount += 1
      continue
    }

    const frame = frames[candidate.frameIndex]
    const ankle = resolvePoint(frame, ANKLE_NAME[candidate.side])
    const hipMid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    if (ankle === null || hipMid === null) continue

    const dx = ankle.x - hipMid.x
    const horizontalOffsetPx = travelDirectionKnown ? dx * travelDirection : dx
    const ratio = horizontalOffsetPx / torsoLengthPx
    overstrideRatios.push(ratio)
    strikeSamples.push({ frame, side: candidate.side, ratio })
    if (ankle.interpolated || hipMid.interpolated) interpolatedCount += 1
  }

  const usableStrikeCount = overstrideRatios.length
  // Event-sampled metric: "coverage" here means what fraction of candidate footstrikes this metric
  // could actually measure — both a resolvable hip position at that instant AND an ankle pair that
  // still names two feet (`ankleMeasurable`) — not the per-frame ratio the other heuristics use.
  // There's no meaningful "fraction of all frames" for a measure that only exists at discrete
  // footstrike events. A gated strike stays in the DENOMINATOR deliberately: a collapsed ankle pair
  // is an ankle that failed to resolve while presenting as resolved, which is the same bucket the
  // hip-unresolvable skip already occupies.
  const frameCoverage = usableStrikeCount / candidateStrikeCount

  if (usableStrikeCount === 0) {
    return nullResult(
      viewFitEntry.fit,
      // Two different failures, and the reader can only act on the right one. Naming the hips when
      // the hips were fine and the ankles collapsed is the mistake this branch exists to avoid —
      // and it is reachable: an all-unmeasurable clip is exercised in `footstrikes.test.ts`.
      unmeasurableAnkleCount === candidateStrikeCount
        ? 'Footstrikes were detected, but at every one the two ankles were too close together to tell the feet apart.'
        : 'Footstrikes were detected, but hip position was not resolvable at any of them.',
      frameCoverage,
    )
  }

  const interpolatedFraction = interpolatedCount / usableStrikeCount
  const value = median(overstrideRatios)

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage,
    interpolatedFraction,
    sampleSize: usableStrikeCount,
    minRequiredSampleSize: MIN_OVERSTRIDE_SAMPLE_SIZE,
    travelDirectionKnown,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  // Seeded with the mandatory sampling-instant disclaimer, unconditionally — this is what makes
  // `caveat` non-null even on an otherwise-clean, high-confidence result. Every branch below only
  // ever appends to it, never replaces it. Mirrors footStrikePattern.ts's identical pattern with
  // PROXY_CAVEAT. Only the WORDING follows `travelDirectionKnown`: the lower-bound claim is a
  // claim about the bias's sign, derivable only when the runner's direction is (see the
  // constants' shared doc).
  const caveats: string[] = [
    travelDirectionKnown ? SAMPLING_INSTANT_CAVEAT : SAMPLING_INSTANT_CAVEAT_UNKNOWN_DIRECTION,
  ]
  if (!travelDirectionKnown) {
    caveats.push(
      'Direction of travel could not be determined (no net horizontal displacement) — overstride sign may not reflect forward/backward.',
    )
  }
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Overstriding is a fore-aft measurement and is not reliable from ${viewPhrase(view)}.`,
    )
  }
  if (usableStrikeCount < MIN_OVERSTRIDE_SAMPLE_SIZE) {
    caveats.push(
      // "usable of detected", not "detected": since the collapsed-ankle gate the two differ, and a
      // sentence that blames detection for a discount caused by unreadable poses describes a
      // failure that did not happen.
      `Only ${usableStrikeCount} of ${candidateStrikeCount} detected footstrike(s) were usable (recommend at least ${MIN_OVERSTRIDE_SAMPLE_SIZE}) — confidence reduced accordingly.`,
    )
  }

  const exemplars = selectExemplars(
    buildExemplars(strikeSamples, describeDistribution(overstrideRatios)),
  )

  return {
    metric: 'overstriding',
    value,
    unit: 'ratio',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction,
    frameCoverage,
    sampleSize: usableStrikeCount,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
    ...(exemplars && { exemplars }),
  }
}
