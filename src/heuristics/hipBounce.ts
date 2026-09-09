import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { HeuristicsConfig } from './types'
import { resolveMidpoint } from './keypoints'
import { fitBounceSpectrum } from './bounceSpectrum'
import type { SpectralFitResult, SpectralSample } from './spectralFit'

/** `['left_hip', 'right_hip']` — `analyzeBounceSignal`'s default pair, and the only pair
 * `analyzeHipBounce` (cadence's call site) ever uses. */
const HIP_PAIR: [KeypointName, KeypointName] = ['left_hip', 'right_hip']

export interface HipBounceAnalysis {
  /** One entry per input frame, timestamp-aligned 1:1 — `null` where the configured pair's
   * midpoint wasn't resolvable that frame. Raw pixel y, not sign-flipped or normalized (a caller
   * charting this does that transform itself). Named `hipY` for historical/cadence-call-site
   * reasons — when `analyzeBounceSignal` is called with a non-hip pair (vertical oscillation's
   * `earMid` option), this is that pair's midpoint-y trace, not literally hip position. */
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
   * `spectralFit.ts`. Since the two-pass fit (`bounceSpectrum.ts`) this may be a fit from BELOW the
   * human-gait band; `subFloorRhythm` is how a caller tells, and is the only way to tell without
   * comparing `frequencyHz` against a config key. */
  fit: SpectralFitResult
  /**
   * `true` when `fit` came from the sub-floor retry — the clip's on-screen bounce is slower than
   * any human gait, which means the footage is RETIMED (slow-motion) rather than that the runner is
   * shuffling. See `bounceSpectrum.ts` for why an adopted sub-floor fit is evidence of retiming and
   * why it needs no threshold of its own.
   *
   * Every metric here is factor-independent — measured AT an instant, or a ratio, or a distance —
   * so a retimed clip's spatial numbers are correct as they stand and this flag is not a reason to
   * withhold them. `cadence` is the sole exception and the sole reader: it reports a RATE, and a
   * rate read off a retimed clock is wrong by exactly the factor nothing here measures.
   */
  subFloorRhythm: boolean
}

/**
 * Shared bounce SIGNAL extraction — not a metric in its own right. Owns the one piece of work
 * `verticalOscillation` and `cadence` both need done identically: resolve a bilateral-pair
 * midpoint per frame (`resolveMidpoint(...pair)`, the same tolerant midpoint policy every
 * center-of-mass proxy in this package uses), track how much of that was interpolated, and fit the
 * shared spectral sinusoid to the resolvable subset over the
 * `spectralFitMinFrequencyHz`/`spectralFitMaxFrequencyHz`/`spectralFitFrequencyStepHz` grid.
 *
 * ## The fit is TWO-PASS, and the second pass detects retimed footage
 *
 * The fit goes through `bounceSpectrum.ts`'s `fitBounceSpectrum` rather than straight to
 * `fitSpectralSinusoid`. On any clip whose in-band fit clears the shared quality gate that is
 * exactly the call this module used to make, bit for bit. Only when the in-band grid yields nothing
 * trustworthy is a second, DISJOINT grid below the human-gait floor tried, and only if THAT clears
 * the same gate is its fit adopted — reported as `subFloorRhythm`. A clip whose ordinary fit
 * succeeds cannot be affected by any of it. See that module for the disjointness argument and for
 * why no new threshold is involved.
 *
 * `verticalOscillationCm.calibrate` fits its own per-run metre series through the same function, so
 * the whole vertical-oscillation family reaches the same verdict about whether a clip has a
 * measurable rhythm — the coherence `verticalOscillationMinFitR2`'s doc argues for, extended to
 * cover which BAND that verdict was reached in.
 *
 * `pair` defaults to `['left_hip', 'right_hip']` — cadence (`analyzeHipBounce`, below) always
 * gets that default and never varies it, since cadence stays hip-pinned regardless of vertical
 * oscillation's `verticalOscillationSignal` setting (see that config key's doc). Vertical
 * oscillation is the only caller that ever passes a non-default pair, via
 * `SIGNAL_KEYPOINTS[config.verticalOscillationSignal]` in `verticalOscillation.ts`.
 *
 * Vertical oscillation reads the fit's AMPLITUDE (`peakToPeakAmplitude`, normalized by torso
 * length); cadence reads its FREQUENCY (`frequencyHz`, converted to steps/minute — see
 * `cadence.ts`'s module doc for why `× 60` needs no correction factor). Both are legitimate,
 * independent readings of the same underlying oscillation, which is why this module exists rather
 * than each metric re-deriving its own trace.
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
 * function over an immutable `RobustPoseFrame[]` and `pair`, so both of cadence's and vertical
 * oscillation's calls are bit-identical WHEN they share a pair (the default-config case), and
 * running the whole 141-candidate grid search twice is still sub-millisecond against a pipeline
 * that spends tens of seconds in pose detection. Precedent: `detectFootstrikes` is already a
 * shared extractor that `overstriding`/`cadence`/`footStrikePattern` each call independently
 * rather than threading a shared result through the orchestrator.
 */
export function analyzeBounceSignal(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig,
  pair: [KeypointName, KeypointName] = HIP_PAIR,
): HipBounceAnalysis {
  const [leftName, rightName] = pair
  let interpolatedCount = 0
  let resolvedCount = 0
  const hipY: Array<number | null> = frames.map((frame) => {
    const mid = resolveMidpoint(frame, leftName, rightName)
    if (mid === null) return null
    resolvedCount += 1
    if (mid.interpolated) interpolatedCount += 1
    return mid.y
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

  const { fit, subFloor } = fitBounceSpectrum(fitSamples, config)

  return {
    hipY,
    resolvedCount,
    interpolatedCount,
    frameCoverage,
    interpolatedFraction,
    fit,
    subFloorRhythm: subFloor,
  }
}

/**
 * `analyzeBounceSignal` pinned to the hip pair — cadence's only call site (`cadence.ts`), kept as
 * a distinct, stable name so cadence's hip-pinning reads as structural (it calls a function that
 * can only ever analyze the hip) rather than as a config value someone could accidentally thread
 * a different pair into later. See `analyzeBounceSignal`'s doc for the shared mechanics.
 */
export function analyzeHipBounce(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig,
): HipBounceAnalysis {
  return analyzeBounceSignal(frames, config, HIP_PAIR)
}
