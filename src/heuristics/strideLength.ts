import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { HeuristicsConfig } from './types'
import { estimateBodyScale } from './bodyScale'
import { estimateTravelDirection } from './travelDirection'
import { detectFootstrikes } from './footstrikes'
import type { FootstrikeCandidate } from './footstrikes'
import { resolveMidpoint } from './keypoints'
import { median } from './mathUtils'
import {
  STRIDE_PERIOD_TOLERANCE,
  isPeriodConsistent,
  resolveExpectedStridePeriodSeconds,
} from './stridePeriod'

export type StrideLengthFailureReason =
  | 'no-body-scale'
  | 'travel-direction-unknown'
  | 'too-few-footstrikes'
  | 'no-usable-pairs'
  /** Every candidate pair was rejected by step 4a's period gate — footstrikes were detected and
   * paired, but none of the pairs lasted a plausible single stride at the clip's own fitted step
   * rhythm. Distinct from `'no-usable-pairs'` (which is about DISPLACEMENT: pairs that didn't
   * advance in the direction of travel) and only ever returned when a `stepFrequencyHz` reference
   * was supplied AND at least one pair was actually rejected on timing — so it always carries real
   * information rather than being a rename of the older reason. */
  | 'no-period-consistent-pairs'

/**
 * One same-side consecutive-footstrike pair that survived step 4 below, kept whole rather than
 * collapsed to its displacement number.
 *
 * The two FRAMES, not their indices, are what this carries: `verticalRatio.ts` turns the median
 * pair into a `MetricExemplar`, and the shared exemplar gate (`exemplars.ts`) scores a
 * `RobustPoseFrame` — it reads `frame.keypoints` for both crop-derivability and the detected/
 * interpolated split. An index would also be wrong across the presence trim (see
 * `MetricExemplar.timestamp`'s doc).
 */
export interface StridePair {
  side: 'left' | 'right'
  /** Hip-mid horizontal displacement across this stride, signed positive in the runner's own
   * direction of travel — strictly positive, by the `d > 0` filter in step 4. */
  displacementPx: number
  /** The footstrike frame this stride started at. */
  startFrame: RobustPoseFrame
  /** The next same-side footstrike frame, where it ended. */
  endFrame: RobustPoseFrame
}

export type StrideLengthResult =
  | {
      ok: true
      strideLengthPx: number
      pairCount: number
      candidatePairCount: number
      /** How many candidate pairs step 4a rejected as period-inconsistent — pairs whose elapsed
       * TIME could not be one stride at the supplied `stepFrequencyHz`. Always `0` when no
       * reference was supplied. Invariant: `pairCount + periodRejectedPairCount <=
       * candidatePairCount`; the remainder is the pre-existing hip-unresolvable / non-advancing
       * drop. Reported separately from that remainder because the two mean different things to a
       * reader — a period-rejected pair was read perfectly cleanly, it just wasn't a stride. */
      periodRejectedPairCount: number
      /** Every kept pair, in detection order (all of the left side's, then all of the right's).
       * `pairs.length === pairCount` and `strideLengthPx === median(pairs.map(displacementPx))`,
       * both by construction. */
      pairs: StridePair[]
    }
  | { ok: false; reason: StrideLengthFailureReason }

/**
 * Optional references the extractor can use but never requires. Every field being optional is the
 * point: `estimateStrideLength(frames, config)` behaves exactly as it did before this parameter
 * existed.
 */
export interface StrideLengthOptions {
  /** The fitted hip-bounce frequency, in Hz — the **STEP** frequency, not the stride frequency.
   * Supply `SpectralFitSuccess.frequencyHz` from `analyzeHipBounce`/`analyzeBounceSignal`; that is
   * the same number `cadence.ts` multiplies by 60 to report steps per minute, and its
   * step-not-stride identity is established there (the hip-mid y-trace bounces once per step, twice
   * per gait cycle). Step 4a turns it into an expected stride PERIOD of `2 / stepFrequencyHz`.
   *
   * Omitted, non-finite or non-positive → the period gate is inert. */
  stepFrequencyHz?: number
}

const HIP_NAMES: [KeypointName, KeypointName] = ['left_hip', 'right_hip']

/**
 * Re-exported so this module's public surface is unchanged by the constant's move to
 * `stridePeriod.ts` — it lives there because `footstrikes.ts` now reads it too, and a constant
 * declared here and read there would be an import cycle. See that module for the derivation.
 */
export { STRIDE_PERIOD_TOLERANCE }

/**
 * Pure extractor — no confidence/caveat policy, that's `verticalRatio.ts`'s job (same division of
 * labor `detectFootstrikes` and `hipBounce.ts`'s `analyzeHipBounce`/`analyzeBounceSignal` already
 * establish for this package: well-posedness/extraction lives here, policy lives in the caller).
 *
 * ## What a "stride" is here
 *
 * A stride is the interval between two consecutive footstrikes of the SAME foot — left-to-left or
 * right-to-left is a step (half a stride); this extractor only pairs same-side consecutive
 * footstrikes, so every `d` in its result is a genuine full-stride displacement, not a step. The
 * measured quantity is the hip-mid's horizontal (x) displacement between those two footstrike
 * instants, signed positive in the runner's own direction of travel — i.e. real forward
 * progress per stride, in pixels, real-world scale not removed (the caller, `verticalRatio.ts`,
 * only ever divides another same-pixel-space quantity by this, so the scale cancels there without
 * needing to be resolved here — see that module's doc).
 *
 * ## Gate order, and why
 *
 * 1. `estimateBodyScale` → `'no-body-scale'`. Nothing downstream is computable without a
 *    torso-length reference (footstrike prominence thresholding needs it too).
 * 2. `estimateTravelDirection === 0` → `'travel-direction-unknown'`. Checked BEFORE footstrike
 *    detection, not after: footstrikes can detect fine on an approach/indeterminate clip (ankle-y
 *    prominence doesn't need a travel direction), but every resulting pair would be unusable —
 *    step 4 below requires a signed-positive displacement, which is meaningless without a known
 *    sign convention. Gating here means a caller's caveat says "direction of travel could not be
 *    determined", not a confusing "no usable pairs" that hides the real reason.
 * 3. `detectFootstrikes(frames, config)` as-is (no reimplementation), partitioned by side.
 *    `candidatePairCount = Σ max(0, n_side - 1)` — the count of consecutive-pair opportunities
 *    before any pair is dropped for a resolution failure or non-advancing displacement. Zero →
 *    `'too-few-footstrikes'`.
 * 4a. **Period gate**, only when `options.stepFrequencyHz` supplies a usable reference. A stride is
 *    exactly two steps and the fitted hip-bounce frequency IS the step frequency (see
 *    `StrideLengthOptions.stepFrequencyHz`), so the expected stride period is
 *    `2 / stepFrequencyHz` — derived, with no fitted or calibrated coefficient in it. A pair whose
 *    elapsed time falls outside `STRIDE_PERIOD_TOLERANCE`'s log-symmetric band around that period
 *    is dropped and counted in `periodRejectedPairCount`. Checked BEFORE the hip resolution and
 *    `d > 0` filters below, so a pair that isn't a stride is accounted for as "not a stride" rather
 *    than as "couldn't be read" whenever both would have applied.
 * 4. For each side's consecutive footstrike pair `(i, i+1)`: resolve hip-mid x at both strike
 *    frames via `resolveMidpoint`. Either unresolvable → skip (silently — reflected in
 *    `pairCount < candidatePairCount`, not a separate failure reason). Otherwise
 *    `d = (x_{i+1} - x_i) * travelDirection`; keep only `d > 0`. Signing by `travelDirection`
 *    first handles a runner moving in the screen's negative-x direction identically to positive-x;
 *    filtering `d > 0` after that rejects a pair whose measured displacement doesn't advance in
 *    the runner's own travel direction (mid-clip drift, a misdetected footstrike, camera shake) —
 *    such a pair isn't a real stride, and this filter also guarantees every kept `d` is strictly
 *    positive, so a caller dividing by `strideLengthPx` never risks a zero-or-negative
 *    denominator.
 * 5. Empty kept-pairs list → `'no-period-consistent-pairs'` if step 4a rejected at least one pair,
 *    otherwise `'no-usable-pairs'` (byte-for-byte the pre-gate behavior). Otherwise
 *    `{ ok: true, strideLengthPx: median(d), pairCount: d.length, candidatePairCount,
 *    periodRejectedPairCount, pairs }`, where each kept pair is returned whole (`StridePair`)
 *    rather than as a bare `d` — see that type's doc for why the frames travel with the number.
 *
 * **No re-pairing across a dropped strike.** If strike `k+1` is dropped at step 4, this does NOT
 * fall back to pairing `k` with `k+2` — that interval spans two real strides, not one, and
 * silently folding it into the same `d` array as genuine single-stride intervals would manufacture
 * a doubled value indistinguishable from a real one. Losing that pair (visible as
 * `pairCount < candidatePairCount`) is honest; inventing a same-shaped-but-wrong value is not.
 *
 * ## Two multiplicity biases, in OPPOSITE directions
 *
 * A pairwise interval can be wrong by a multiple of a stride in either direction, and the two cases
 * push a caller's ratio opposite ways. Both are listed here because a reader debugging a
 * `verticalRatio` that looks wrong needs to know which way to suspect:
 *
 * | cause | interval spans | `strideLengthPx` | caller's `bounce / stride` |
 * |---|---|---|---|
 * | a MISSED strike | ~2 strides | **HIGH** | reads **LOW** |
 * | a SPURIOUS extra strike | ~½ a stride | **LOW** | reads **HIGH** |
 *
 * ### Doubling bias — bounded by the median, reads LOW on a caller's ratio
 *
 * `detectFootstrikes` can miss a real footstrike (e.g. a brief occlusion suppressing one side's
 * ankle-y extremum below the prominence threshold for one cycle). When that happens, the NEXT
 * detected footstrike on that side is two strides after the previous one, not one — its pairwise
 * `d` is roughly double a normal stride length, and nothing in this extractor catches it (the
 * displacement is still positive, still "advancing", just describing two strides instead of one).
 *
 * This is bounded, not eliminated, by taking the MEDIAN rather than the mean: as long as fewer
 * than half of a side's consecutive pairs are doubled, the median lands among the genuine
 * single-stride values, unaffected. When a doubled interval DOES slip through, the reported
 * `strideLengthPx` skews HIGH relative to the true stride length — and since a caller's
 * `verticalRatio = bounce / strideLengthPx`, an inflated denominator means the reported ratio
 * reads LOW (a runner would look like they bounce less, per stride, than they actually do).
 * Direction matters for anyone debugging a ratio that looks implausibly good.
 *
 * ### Halving bias — NOT bounded by the median, reads HIGH on a caller's ratio
 *
 * The mirror image, and the more dangerous of the two. `detectFootstrikes` keeps per-side ankle-y
 * MAXIMA, and a trailing leg produces a secondary prominence-confirmed ankle-y maximum while the
 * OTHER foot is in stance — an instant that is not a ground-contact onset at all (`cadence.ts`'s
 * module doc names the same mechanism as the reason cadence stopped consuming this extractor's
 * input). Two such instants, or one real strike plus one spurious one, get labelled the same side
 * and paired, so the "stride" spans roughly one STEP. `strideLengthPx` then reads LOW, and a
 * caller's `bounce / strideLengthPx` reads HIGH.
 *
 * **The median does not defend against this**, and that is the structural difference from the
 * doubling case. A missed strike is an occasional outlier that a majority of clean pairs outvotes;
 * spurious trailing-leg maxima are a systematic property of the signal, so they can affect EVERY
 * pair at once and leave the median nothing clean to land among. Measured on the Demo 1 side-view
 * track clip: of three same-side "strikes" at app t = 4.00 / 5.04 / 5.60, frame-by-frame
 * ground-contact reading of the source shows only the first is a contact onset — the other two are
 * a toe-off and a late-stance instant belonging to two DIFFERENT (therefore opposite-foot)
 * contacts. Both surviving pairs (1.04 s and 0.56 s) were wrong against a true ~1.25 s stride, and
 * `verticalRatio` reported ~6.8% — about 2× high — at High confidence with no caveat.
 *
 * Step 4a's period gate is the defense, and it needs a reference the pair set cannot supply itself
 * (see the mitigation notes below).
 *
 * ### A third, unrelated bias
 *
 * Subtler and about displacement rather than timing: the `d > 0` filter truncates the noise
 * distribution for pairs whose TRUE displacement is near zero (a hesitant stride, mid-clip
 * deceleration) — keeping only the positive measurements of a near-zero quantity biases the
 * kept values upward. Immaterial on clips where real strides (~1000px) dwarf hip jitter, but
 * worth knowing on slow or stop-start footage.
 *
 * Two gap-tolerance mitigations were considered and rejected for now (not because they're wrong
 * in principle, but because neither has a calibration trigger yet):
 *
 * - **Unrecoverable-ankle-gap drop**: track whether either side's ankle position was
 *   `'unrecoverable'` (not merely `'interpolated'`) across the SPAN between two consecutive
 *   footstrikes, and drop the pair if so — a missed footstrike is far likelier when the tracker
 *   lost the ankle entirely than when it merely interpolated through a brief gap. Rejected:
 *   `detectFootstrikes` reports footstrike instants, not span-level tracking quality, so this
 *   would need its own signal; no clip in this repo's evidence base has actually exhibited this
 *   failure mode to calibrate against.
 * - **Fit-period multiplicity correction**: compare each pair's `d` against the median `d` and
 *   halve (or discard) any pair suspiciously close to 2x the median — a purely statistical
 *   correction needing no extra tracking signal. Rejected: on a short clip a "suspicious 2x"
 *   threshold has no calibrated boundary (this repo's park-clip investigation already flagged
 *   short clips as too noisy for confident per-half-cycle normalization — see this repo's
 *   CLAUDE.md), and misclassifying a genuinely long single stride as doubled would silently halve
 *   a real value. **STILL REJECTED IN THAT FORM — and superseded for the TIMING case by step 4a.**
 *   The objection above is specifically about a SELF-REFERENTIAL comparison: "2x the median" is a
 *   statement about a sample whose own median may already be wrong, and on Demo 1 it is
 *   catastrophically so (every pair is wrong, so no comparison among them can detect anything).
 *   Step 4a compares each pair against an EXTERNAL, physically-derived reference instead — the
 *   fitted step period, doubled, with no coefficient to calibrate — which is a different kind of
 *   check, not a re-litigation of this one. A displacement-space `d`-versus-median rule remains
 *   uncalibrated and unbuilt.
 *
 * Trigger for revisiting either: if live `pairCount` medians consistently land at or just above
 * the caller's minimum-sample-size gate in practice (rather than comfortably above it), that's
 * evidence the gap-tolerance question needs an answer rather than remaining deferred — see
 * `openspec/changes/add-vertical-ratio-metric/design.md` D3.
 */
export function estimateStrideLength(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig,
  options: StrideLengthOptions = {},
): StrideLengthResult {
  const expectedStridePeriodSeconds = resolveExpectedStridePeriodSeconds(options.stepFrequencyHz)

  const bodyScale = estimateBodyScale(frames)
  if (bodyScale === null) return { ok: false, reason: 'no-body-scale' }

  const travelDirection = estimateTravelDirection(frames, bodyScale)
  if (travelDirection === 0) return { ok: false, reason: 'travel-direction-unknown' }

  const candidates: FootstrikeCandidate[] = detectFootstrikes(frames, config)

  const bySide: Record<'left' | 'right', FootstrikeCandidate[]> = { left: [], right: [] }
  for (const candidate of candidates) {
    bySide[candidate.side].push(candidate)
  }

  let candidatePairCount = 0
  for (const side of ['left', 'right'] as const) {
    candidatePairCount += Math.max(0, bySide[side].length - 1)
  }
  if (candidatePairCount === 0) return { ok: false, reason: 'too-few-footstrikes' }

  const pairs: StridePair[] = []
  let periodRejectedPairCount = 0
  for (const side of ['left', 'right'] as const) {
    const strikes = bySide[side]
    for (let i = 0; i < strikes.length - 1; i += 1) {
      // Step 4a, ahead of both displacement checks — see the gate-order note in the module doc.
      if (
        expectedStridePeriodSeconds !== null &&
        !isPeriodConsistent(
          strikes[i + 1].timestamp - strikes[i].timestamp,
          expectedStridePeriodSeconds,
        )
      ) {
        periodRejectedPairCount += 1
        continue
      }

      const frameA = frames[strikes[i].frameIndex]
      const frameB = frames[strikes[i + 1].frameIndex]
      const hipA = resolveMidpoint(frameA, HIP_NAMES[0], HIP_NAMES[1])
      const hipB = resolveMidpoint(frameB, HIP_NAMES[0], HIP_NAMES[1])
      if (hipA === null || hipB === null) continue

      const d = (hipB.x - hipA.x) * travelDirection
      if (d > 0) {
        pairs.push({ side, displacementPx: d, startFrame: frameA, endFrame: frameB })
      }
    }
  }

  if (pairs.length === 0) {
    // `'no-period-consistent-pairs'` only when a pair was actually rejected on timing; otherwise
    // the reason is exactly what it was before step 4a existed.
    return {
      ok: false,
      reason: periodRejectedPairCount > 0 ? 'no-period-consistent-pairs' : 'no-usable-pairs',
    }
  }

  return {
    ok: true,
    strideLengthPx: median(pairs.map((pair) => pair.displacementPx)),
    pairCount: pairs.length,
    candidatePairCount,
    periodRejectedPairCount,
    pairs,
  }
}
