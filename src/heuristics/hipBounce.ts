import type { RobustPoseFrame } from '../pose/robustness/types'
import type { HeuristicsConfig } from './types'
import { resolveMidpoint } from './keypoints'
import { fitSpectralSinusoid } from './spectralFit'
import type { SpectralFitResult, SpectralSample } from './spectralFit'

export interface HipBounceAnalysis {
  /** One entry per input frame, timestamp-aligned 1:1 — `null` where the hip-mid wasn't
   * resolvable that frame. Raw pixel y, not sign-flipped or normalized (a caller charting this
   * does that transform itself). */
  hipY: Array<number | null>
  /** Frames whose hip-mid resolved, via `resolveMidpoint`'s tolerant (single-side-fallback)
   * policy. */
  resolvedCount: number
  /** Of `resolvedCount`, how many came from `resolveMidpoint`'s interpolated/single-side-fallback
   * path rather than a fully bilateral direct resolution. */
  interpolatedCount: number
  /** `resolvedCount / frames.length`. `0` for an empty `frames` (guarded, not `0/0`). */
  frameCoverage: number
  /** `interpolatedCount / resolvedCount`. `0` when `resolvedCount` is `0` (guarded, not `0/0`). */
  interpolatedFraction: number
  /** The shared spectral fit over the resolvable hip-mid samples. Typed success/failure — see
   * `spectralFit.ts`. */
  fit: SpectralFitResult
}

/**
 * Shared hip-bounce SIGNAL extraction — not a metric in its own right. Owns the one piece of work
 * `verticalOscillation` and `cadence` both need done identically: resolve hip-mid position per
 * frame (`resolveMidpoint('left_hip', 'right_hip')`, the same tolerant midpoint policy every
 * center-of-mass proxy in this package uses), track how much of that was interpolated, and fit the
 * shared spectral sinusoid primitive (`fitSpectralSinusoid`) to the resolvable subset over the
 * `spectralFitMinFrequencyHz`/`spectralFitMaxFrequencyHz`/`spectralFitFrequencyStepHz` grid.
 *
 * Vertical oscillation reads the fit's AMPLITUDE (`peakToPeakAmplitude`, normalized by torso
 * length); cadence reads its FREQUENCY (`frequencyHz`, converted to steps/minute — see
 * `cadence.ts`'s module doc for why `× 60` needs no correction factor). Both are legitimate,
 * independent readings of the same underlying oscillation, which is why this module exists rather
 * than each metric re-deriving its own hip trace.
 *
 * POLICY — quality gates (what R² is good enough), caveat text, confidence computation, and
 * `sampleSize` reporting — is deliberately NOT this module's concern. It stays in each caller,
 * exactly the same division of responsibility `spectralFit.ts`'s own module doc already
 * establishes one layer down ("well-posedness lives in the shared primitive, policy lives in the
 * caller") — the two metrics gate on different thresholds
 * (`verticalOscillationMinFitR2`/`cadenceMinFitR2`) and need different caveat wording, and folding
 * either policy in here would force them to agree when there's no reason they should.
 *
 * Each caller invokes this independently rather than sharing one computed result through
 * `computeFormHeuristics`'s orchestration — a deliberate, accepted redundancy. The fit is a pure
 * function over an immutable `RobustPoseFrame[]`, so both calls are bit-identical, and running the
 * whole 141-candidate grid search twice is still sub-millisecond against a pipeline that spends
 * tens of seconds in pose detection. Precedent: `detectFootstrikes` is already a shared extractor
 * that `overstriding`/`cadence`/`footStrikePattern` each call independently rather than threading a
 * shared result through the orchestrator.
 */
export function analyzeHipBounce(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig,
): HipBounceAnalysis {
  let interpolatedCount = 0
  let resolvedCount = 0
  const hipY: Array<number | null> = frames.map((frame) => {
    const hipMid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    if (hipMid === null) return null
    resolvedCount += 1
    if (hipMid.interpolated) interpolatedCount += 1
    return hipMid.y
  })

  // Guarded rather than left to divide-by-zero: an empty `frames` or an all-unresolvable clip
  // must report `0`, not `NaN`, per this package's never-NaN output contract.
  const frameCoverage = frames.length === 0 ? 0 : resolvedCount / frames.length
  const interpolatedFraction = resolvedCount === 0 ? 0 : interpolatedCount / resolvedCount

  const fitSamples: SpectralSample[] = []
  frames.forEach((frame, i) => {
    const y = hipY[i]
    if (y !== null) fitSamples.push({ t: frame.timestamp, v: y })
  })

  const fit = fitSpectralSinusoid(fitSamples, {
    minFrequencyHz: config.spectralFitMinFrequencyHz,
    maxFrequencyHz: config.spectralFitMaxFrequencyHz,
    frequencyStepHz: config.spectralFitFrequencyStepHz,
  })

  return { hipY, resolvedCount, interpolatedCount, frameCoverage, interpolatedFraction, fit }
}
