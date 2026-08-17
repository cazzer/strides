import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig, MetricResult, View } from './types'
import { analyzeHipBounce } from './hipBounce'
import type { SpectralFitFailureReason } from './spectralFit'
import { estimateStrideLength } from './strideLength'
import type { StrideLengthFailureReason, StridePair } from './strideLength'
import { buildBounceCycleExemplar, resolvedSpanCenter } from './bounceInstants'
import {
  cropKeypoints,
  describeDistribution,
  pairQuality,
  scoreExemplarInstant,
  selectExemplars,
} from './exemplars'
import type { MetricExemplar } from './types'
import { computeMetricConfidence } from './confidence'
import { clamp01 } from './mathUtils'
import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'

/**
 * Minimum stride-pair count below which confidence is penalized via the sampleSize factor.
 * Deliberately 3 (matching `verticalOscillationMinCycles`'s reasoning), not
 * `MIN_CADENCE_STEPS`/`MIN_OVERSTRIDE_SAMPLE_SIZE`'s 4: a MEDIAN becomes a genuine rank statistic
 * — "the middle value", distinct from "the only value" or "an average of two" — starting at
 * `n = 3`. This metric's dominant error mode (`strideLength.ts`'s doubling bias, when a footstrike
 * is missed) is a single outlier-shaped value, not a diffuse noise floor, so a rank-statistic
 * defense (the median simply ignoring an outlier once a majority of clean values surrounds it) is
 * the right shape of protection, and 3 is the smallest sample where that protection exists at all.
 *
 * This is a judgment call pending live evidence, not a derived calibration — see
 * `openspec/changes/add-vertical-ratio-metric/design.md` D3 for the upgrade trigger: if live
 * `pairCount` medians consistently land at or just above this floor rather than comfortably above
 * it, that's a signal either this minimum should rise, or `strideLength.ts`'s deferred
 * gap-tolerance mitigations need to stop being deferred.
 */
const MIN_STRIDE_PAIRS = 3

/** The points the NUMERATOR reads at an instant — hip-pinned, exactly as the numerator's own fit
 * is (see the hip-pinning section below). The denominator's stride pair is a separate exemplar
 * with a separate seed, below. */
const BOUNCE_SEED_KEYPOINTS: KeypointName[] = ['left_hip', 'right_hip']

/** The points the DENOMINATOR reads at each strike: `strideLength.ts` measures the hip midpoint's
 * horizontal displacement between two same-side footstrikes, and that displacement IS the stride
 * length this ratio divides by. Same two names as the numerator's seed, for a different reason —
 * one reads their vertical motion, the other their horizontal. */
const STRIDE_SEED_KEYPOINTS: KeypointName[] = ['left_hip', 'right_hip']

/** Context for the stride pair (design D2). A stride is a HORIZONTAL displacement, so a crop
 * spanning two hip midpoints one stride apart is a wide, featureless band; the ankles put the feet
 * whose strikes bound the stride into the picture. Optional by contract — `cropKeypoints` drops
 * whichever does not resolve. */
const STRIDE_CONTEXT_KEYPOINTS: KeypointName[] = ['left_ankle', 'right_ankle']

/** Sinusoid partial R² at or above which the shared hip-bounce fit is treated as fully
 * trustworthy — identical constant, identical reasoning, as `verticalOscillation.ts`'s and
 * `cadence.ts`'s own `FIT_QUALITY_SATURATION_R2`: this metric reads the same fit those two do
 * (see the module doc below), so the same ramp shape applies. */
const FIT_QUALITY_SATURATION_R2 = 0.8

function nullResult(viewFit: MetricResult['viewFit'], caveat: string): MetricResult {
  return {
    metric: 'verticalRatio',
    value: null,
    unit: 'percent',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat,
  }
}

function caveatForBounceFailure(reason: SpectralFitFailureReason, sampleCount: number): string {
  switch (reason) {
    case 'too-few-samples':
      return `Hip position resolved in only ${sampleCount} frame(s) — too few to fit a bounce rhythm.`
    case 'insufficient-cycles':
      return 'Hip position was tracked, but the clip is too short to contain a complete bounce cycle.'
    case 'degenerate-signal':
      return 'Hip position was tracked, but showed no oscillating vertical motion to measure.'
  }
}

/** `travel-direction-unknown`'s text is EXACT — asserted verbatim by a unit test — and
 * deliberately not a shared constant with `overstriding.ts`'s or `footStrikePattern.ts`'s own
 * travel-direction caveats: those two already duplicate this same prefix inline, each with a
 * different tail describing what specifically becomes unreliable for that metric. See
 * `openspec/changes/add-vertical-ratio-metric/design.md` D2 for why introducing a shared constant
 * now is out of scope for this change. */
function caveatForStrideLengthFailure(reason: StrideLengthFailureReason): string {
  switch (reason) {
    case 'no-body-scale':
      return 'No resolvable body-scale reference (shoulders/hips) in this clip.'
    case 'travel-direction-unknown':
      return 'Direction of travel could not be determined (no net horizontal displacement) — stride length is not observable from this camera angle, so vertical ratio cannot be computed.'
    case 'too-few-footstrikes':
      return 'No footstrikes could be detected in this clip.'
    case 'no-usable-pairs':
      return 'Footstrikes were detected, but no consecutive same-side pair advanced in the direction of travel.'
  }
}

/**
 * The DENOMINATOR's exemplar: the two same-side footstrike frames of the median stride pair — the
 * pair that literally defines the stride length the ratio divides by.
 *
 * The selected pair is the one whose displacement sits closest to the median of them all, and that
 * median is `strideLengthPx` itself (`describeDistribution` takes the same `median` over the same
 * numbers `estimateStrideLength` already did) — so this is the stride the reported denominator is
 * most directly about, not merely a stride that happened to track well.
 *
 * **Base is the FIRST strike**, design D1's instant A for this row. D11's rule cannot decide it:
 * both instants bound ONE stride and therefore carry the identical value, its displacement. Reading
 * the pair chronologically — the stride started here, ended there — is the honest fallback, the
 * same one #62 took for the bounce pair.
 */
function buildStridePairExemplar(pairs: StridePair[]): MetricExemplar[] {
  const distribution = describeDistribution(pairs.map((pair) => pair.displacementPx))

  let selected: StridePair | null = null
  let bestCost = Infinity
  for (const pair of pairs) {
    const cost = Math.abs(pair.displacementPx - distribution.median)
    if (cost < bestCost) {
      selected = pair
      bestCost = cost
    }
  }
  if (selected === null) return []

  const instant = (frame: RobustPoseFrame) => ({
    frame,
    seed: STRIDE_SEED_KEYPOINTS,
    value: selected.displacementPx,
  })
  const startQuality = scoreExemplarInstant(
    instant(selected.startFrame),
    'representative',
    distribution,
  )
  const endQuality = scoreExemplarInstant(
    instant(selected.endFrame),
    'representative',
    distribution,
  )
  if (startQuality === null || endQuality === null) return []

  return [
    {
      kind: 'stridePair',
      timestamp: selected.startFrame.timestamp,
      pairedTimestamp: selected.endFrame.timestamp,
      // Both instants are the SAME foot by construction — `estimateStrideLength` only ever pairs
      // same-side consecutive strikes — so naming the side is right about both.
      side: selected.side,
      quality: pairQuality(startQuality, endQuality),
      label: `One stride: consecutive ${selected.side}-foot strikes, ghosted together`,
      cropKeypoints: cropKeypoints(STRIDE_SEED_KEYPOINTS, STRIDE_CONTEXT_KEYPOINTS, [
        selected.startFrame,
        selected.endFrame,
      ]),
    },
  ]
}

/**
 * Vertical ratio: how much a runner bounces per stride, relative to how far each stride actually
 * carries them — `bounce / strideLength`, the same ratio CONCEPT consumer running watches
 * (Garmin/COROS) report as "Vertical Ratio". Third member of the vertical-oscillation metric
 * family (epic #33): `verticalOscillation` (bounce / torso length, view-tolerant),
 * `verticalOscillationCm` (bounce in real centimetres, MediaPipe-scale-gated), and this one
 * (bounce / stride length, side-view-gated) all read the SAME shared hip-bounce spectral fit
 * (`hipBounce.ts`) — never an independently re-fit amplitude, so the three numbers can't drift
 * apart from measuring the identical bounce three different ways.
 *
 * ## Hip-pinning
 *
 * Reads `analyzeHipBounce` — ALWAYS the hip pair, never `analyzeBounceSignal` with whatever
 * `config.verticalOscillationSignal` currently selects. `verticalOscillationSignal` ('hipMid' |
 * 'earMid') is a per-run choice for the `verticalOscillation` metric specifically (see that config
 * key's doc in `types.ts`) — letting it silently retarget this metric's numerator too would mean
 * flipping that setting changes what physical quantity `verticalRatio` reports without changing
 * its name, unit, or the stride-length denominator it's paired against (which is itself hip-mid
 * displacement — see `strideLength.ts`). This metric always measures hip bounce over
 * hip-consistent stride length, regardless of what `verticalOscillation` is currently configured
 * to chart.
 *
 * ## Gate reuse — no separate `verticalRatioMinFitR2`
 *
 * This metric's numerator is the exact same `fit.peakToPeakAmplitude` `verticalOscillation`
 * reports when that metric's signal is at its default `'hipMid'` (and, per the hip-pinning above,
 * ALWAYS for this metric). A second, independently-tunable fit-quality threshold would let the two
 * metrics disagree about whether the IDENTICAL amplitude is trustworthy — incoherent, since
 * they're reading the same number. This metric reuses `config.verticalOscillationMinFitR2`
 * verbatim instead. **Invariant** (default config only): `verticalRatio.value !== null` implies
 * `verticalOscillation.value !== null` — not the converse, since this metric has its own
 * additional gate (`estimateStrideLength`'s travel-direction/footstrike requirements) that
 * `verticalOscillation` doesn't share. Exercised by `index.test.ts`'s drift-guard rather than
 * asserted at runtime (asserting it here would require importing `verticalOscillation.ts`, an
 * unwanted coupling between two peer metrics that just happen to share a config key).
 *
 * ## Fraction, not pre-multiplied percent
 *
 * `unit: 'percent'` already has an established meaning in this package, from `armSwingSymmetry`: a
 * dimensionless 0..1 comparison, NOT a fraction of torso length (`types.ts`'s doc on
 * `MetricResult.unit`). `value` here is exactly `fit.peakToPeakAmplitude / stride.strideLengthPx`
 * — a ratio of two pixel quantities in the same pixel space (real-world scale cancels, the same
 * trick `verticalOscillation`'s and `overstriding`'s torso-length normalization already rely on),
 * reported as the raw 0..1 fraction. `MetricsPanel.tsx`'s `formatValue` already renders any
 * `'percent'`-unit value as `(value * 100).toFixed(1)%` — no formatting-layer change needed, and
 * multiplying by 100 here too would double-count it.
 *
 * ## Watch comparability: PENDING
 *
 * The `~10%` ground-truth reading behind this metric's target range was inferred — not confirmed
 * with the user — to be a Vertical-Ratio-shaped quantity, because it was given as a percentage
 * (see this repo's CLAUDE.md, "Stride-length normalization" section). This metric computes the
 * ratio in pixel space, not the calibrated centimetre-based figure any specific watch computes —
 * same ratio CONCEPT, not a claimed reproduction of a particular device's algorithm.
 *
 * ## Diagnostics: no new field needed
 *
 * `verticalOscillationFit.peakToPeakAmplitudePx / verticalRatio.value` recovers this metric's
 * stride length in pixels live, from diagnostics fields that already exist — no new
 * `analysisDiagnostics.ts` field was added for it.
 *
 * ## View gating
 *
 * Hard-gated to side view (`viewFitTable.verticalRatio`) — see `types.ts`'s doc comment on that
 * table entry for the stride-observability argument (a view-tolerant numerator paired with a
 * view-degenerate, foreshortening-prone denominator is worse than either alone: it INFLATES the
 * ratio into a confidently-wrong number, not an obviously-degraded one).
 */
export function computeVerticalRatio(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): MetricResult {
  const viewFitEntry = config.viewFitTable.verticalRatio[view]

  // Numerator gate first: a degenerate bounce is reported as a bounce-shaped caveat even when
  // stride length would also fail, per this metric's own spec ("Degenerate zero bounce reports no
  // value ahead of the stride-length check").
  const bounceSignal = analyzeHipBounce(frames, config)
  if (bounceSignal.resolvedCount === 0) {
    return nullResult(viewFitEntry.fit, 'No resolvable hip position in this clip.')
  }

  const fit = bounceSignal.fit
  if (!fit.ok) {
    return nullResult(viewFitEntry.fit, caveatForBounceFailure(fit.reason, fit.sampleCount))
  }

  const minFitR2 = config.verticalOscillationMinFitR2
  if (fit.sinusoidR2 < minFitR2) {
    return nullResult(
      viewFitEntry.fit,
      'Hip position was tracked, but the bounce rhythm was too irregular to measure.',
    )
  }

  const stride = estimateStrideLength(frames, config)
  if (!stride.ok) {
    return nullResult(viewFitEntry.fit, caveatForStrideLengthFailure(stride.reason))
  }

  const value = fit.peakToPeakAmplitude / stride.strideLengthPx

  const fitQuality =
    FIT_QUALITY_SATURATION_R2 > minFitR2
      ? clamp01((fit.sinusoidR2 - minFitR2) / (FIT_QUALITY_SATURATION_R2 - minFitR2))
      : 1

  // travelDirectionKnown is NOT passed: estimateStrideLength already hard-gates on it (a not-ok
  // 'travel-direction-unknown' result returns above before this point is ever reached), so the
  // 0.5 factor computeMetricConfidence would apply for an unknown direction can never fire here —
  // see design.md D2/D6.
  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage: bounceSignal.frameCoverage,
    interpolatedFraction: bounceSignal.interpolatedFraction,
    sampleSize: stride.pairCount,
    minRequiredSampleSize: MIN_STRIDE_PAIRS,
    fitQuality,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveats: string[] = []
  if (stride.pairCount < MIN_STRIDE_PAIRS) {
    caveats.push(
      `Only ${stride.pairCount} stride pair(s) detected (recommend at least ${MIN_STRIDE_PAIRS}) — confidence reduced accordingly.`,
    )
  }
  if (fit.sinusoidR2 < FIT_QUALITY_SATURATION_R2) {
    caveats.push(
      "The bounce rhythm in this clip wasn't perfectly steady — confidence reduced accordingly.",
    )
  }
  if (stride.pairCount < stride.candidatePairCount) {
    caveats.push(
      `${stride.candidatePairCount - stride.pairCount} stride pair(s) couldn't be read cleanly and didn't count toward the measurement.`,
    )
  }
  if (viewFitEntry.fit === 'unsuitable') {
    caveats.push(
      `Vertical ratio depends on stride length, a fore-aft measurement, and is not reliable from a ${view} view.`,
    )
  }

  // Numerator exemplar. `maximumIs: 'lowest'` because `analyzeHipBounce` fits raw
  // downward-positive image-y — see `bounceInstants.ts`'s module doc on the sign trap.
  const spanCenterSeconds = resolvedSpanCenter(frames, bounceSignal.hipY)
  const bounceExemplars =
    spanCenterSeconds === null
      ? []
      : buildBounceCycleExemplar({
          fit,
          frames,
          spanCenterSeconds,
          maximumIs: 'lowest',
          seed: BOUNCE_SEED_KEYPOINTS,
        })

  // This is the one metric whose two exemplars answer different questions — how far the runner
  // bounced, and how far one stride carried them. Both go through ONE `selectExemplars` call, not
  // one each: `MAX_EXEMPLARS_PER_METRIC` is a per-metric budget, and gating the two halves
  // separately would apply it twice. Exactly two candidates against a cap of two, so a numerator
  // that clears the gate can never crowd out a denominator that also does.
  const exemplars = selectExemplars([
    ...bounceExemplars,
    ...buildStridePairExemplar(stride.pairs),
  ])

  return {
    metric: 'verticalRatio',
    value,
    unit: 'percent',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction: bounceSignal.interpolatedFraction,
    frameCoverage: bounceSignal.frameCoverage,
    sampleSize: stride.pairCount,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
    ...(exemplars && { exemplars }),
  }
}
