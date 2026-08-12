import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { HeuristicsConfig } from './types'
import { estimateBodyScale } from './bodyScale'
import { estimateTravelDirection } from './travelDirection'
import { detectFootstrikes } from './footstrikes'
import type { FootstrikeCandidate } from './footstrikes'
import { resolveMidpoint } from './keypoints'
import { median } from './mathUtils'

export type StrideLengthFailureReason =
  | 'no-body-scale'
  | 'travel-direction-unknown'
  | 'too-few-footstrikes'
  | 'no-usable-pairs'

export type StrideLengthResult =
  | { ok: true; strideLengthPx: number; pairCount: number; candidatePairCount: number }
  | { ok: false; reason: StrideLengthFailureReason }

const HIP_NAMES: [KeypointName, KeypointName] = ['left_hip', 'right_hip']

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
 * 5. Empty kept-pairs list → `'no-usable-pairs'`. Otherwise
 *    `{ ok: true, strideLengthPx: median(d), pairCount: d.length, candidatePairCount }`.
 *
 * **No re-pairing across a dropped strike.** If strike `k+1` is dropped at step 4, this does NOT
 * fall back to pairing `k` with `k+2` — that interval spans two real strides, not one, and
 * silently folding it into the same `d` array as genuine single-stride intervals would manufacture
 * a doubled value indistinguishable from a real one. Losing that pair (visible as
 * `pairCount < candidatePairCount`) is honest; inventing a same-shaped-but-wrong value is not.
 *
 * ## Doubling bias — bounded, not eliminated, and reads LOW on a caller's ratio
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
 * A second, subtler bias runs the other way: the `d > 0` filter truncates the noise
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
 *   a real value.
 *
 * Trigger for revisiting either: if live `pairCount` medians consistently land at or just above
 * the caller's minimum-sample-size gate in practice (rather than comfortably above it), that's
 * evidence the gap-tolerance question needs an answer rather than remaining deferred — see
 * `openspec/changes/add-vertical-ratio-metric/design.md` D3.
 */
export function estimateStrideLength(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig,
): StrideLengthResult {
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

  const displacements: number[] = []
  for (const side of ['left', 'right'] as const) {
    const strikes = bySide[side]
    for (let i = 0; i < strikes.length - 1; i += 1) {
      const frameA = frames[strikes[i].frameIndex]
      const frameB = frames[strikes[i + 1].frameIndex]
      const hipA = resolveMidpoint(frameA, HIP_NAMES[0], HIP_NAMES[1])
      const hipB = resolveMidpoint(frameB, HIP_NAMES[0], HIP_NAMES[1])
      if (hipA === null || hipB === null) continue

      const d = (hipB.x - hipA.x) * travelDirection
      if (d > 0) displacements.push(d)
    }
  }

  if (displacements.length === 0) return { ok: false, reason: 'no-usable-pairs' }

  return {
    ok: true,
    strideLengthPx: median(displacements),
    pairCount: displacements.length,
    candidatePairCount,
  }
}
