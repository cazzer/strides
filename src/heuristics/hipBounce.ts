import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { HeuristicsConfig } from './types'
import { resolveMidpoint } from './keypoints'
import {
  estimateBodyScale,
  estimateLocalTorsoLengths,
  LOCAL_TORSO_HALF_WINDOW_SECONDS,
} from './bodyScale'
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
   * `spectralFit.ts`. Since the multi-pass fit (`bounceSpectrum.ts`) this may be a fit from BELOW
   * the human-gait band (`subFloorRhythm`, the only way to tell without comparing `frequencyHz`
   * against a config key), or a fit of the SCALE-NORMALIZED series rather than the raw one
   * (`scaleNormalized`, which changes the units of `peakToPeakAmplitude`). At most one is true. */
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
  /**
   * `true` when `fit` came from the last-resort SCALE-NORMALIZED retry — neither the in-band nor
   * the sub-floor fit of the raw series was adopted, and the same motion re-expressed at one torso
   * scale cleared the gate in band. The case it exists for is a runner approaching the camera,
   * whose pixel bounce grows several-fold across the clip. See `bounceSpectrum.ts` ("The
   * scale-normalized pass") for why it runs last and in band only. Mutually exclusive with
   * `subFloorRhythm`.
   *
   * ⚠️ Units: when `true`, `fit.peakToPeakAmplitude` is in pixels AT THE CLIP-MEDIAN TORSO SCALE,
   * not raw image pixels, and `fit.sampleCount` may be less than `resolvedCount` (frames without a
   * local torso are dropped from that series). `hipY` is raw either way.
   *
   * `verticalRatio` is the one reader that withholds on it: its denominator is a raw-pixel stride
   * length, which a median-scale amplitude cannot be divided by. Frequency and phase readers
   * (cadence, footstrike timing) need no change — normalization leaves both where they were.
   */
  scaleNormalized: boolean
}

/**
 * Shared bounce SIGNAL extraction — not a metric in its own right. Owns the one piece of work
 * `verticalOscillation` and `cadence` both need done identically: resolve a bilateral-pair
 * midpoint per frame (`resolveMidpoint(...pair)`, the same tolerant midpoint policy every
 * center-of-mass proxy in this package uses), track how much of that was interpolated, and fit the
 * shared spectral sinusoid to the resolvable subset over the
 * `spectralFitMinFrequencyHz`/`spectralFitMaxFrequencyHz`/`spectralFitFrequencyStepHz` grid.
 *
 * ## The fit is MULTI-PASS: the second pass detects retimed footage, the third follows an approach
 *
 * The fit goes through `bounceSpectrum.ts`'s `fitBounceSpectrum` rather than straight to
 * `fitSpectralSinusoid`. On any clip whose in-band fit clears the shared quality gate that is
 * exactly the call this module used to make, bit for bit. Only when the in-band grid yields nothing
 * trustworthy is a second, DISJOINT grid below the human-gait floor tried, and only if THAT clears
 * the same gate is its fit adopted — reported as `subFloorRhythm`. Only when neither is adopted is
 * a third, last-resort series fitted on the in-band grid: the same motion re-expressed at one torso
 * scale (`buildScaleNormalizedSamples`), adopted only if it clears the same gate — reported as
 * `scaleNormalized`. A clip whose ordinary fit succeeds cannot be affected by any of it. See that
 * module for the disjointness argument, the ordering, and why no new threshold is involved.
 *
 * `verticalOscillationCm.calibrate` fits its own per-run metre series through the same function, so
 * the whole vertical-oscillation family is governed by the same RULE about whether a clip has a
 * measurable rhythm (not necessarily the same answer — `bounceSpectrum.ts` explains why). The one
 * exception is the last-resort SCALE-NORMALIZED pass (`scaleNormalized`), which is pixel-path only:
 * the metre series is already delta-integrated over a per-frame scale, so it omits that pass.
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

  const { fit, subFloor, scaleNormalized } = fitBounceSpectrum(fitSamples, config, () =>
    buildScaleNormalizedSamples(frames, hipY),
  )

  return {
    hipY,
    resolvedCount,
    interpolatedCount,
    frameCoverage,
    interpolatedFraction,
    fit,
    subFloorRhythm: subFloor,
    scaleNormalized,
  }
}

/**
 * The scale-normalized series `fitBounceSpectrum` falls back to: the same vertical motion, with
 * every frame-to-frame step re-expressed at ONE torso scale, so a runner who grows several-fold in
 * frame contributes a bounce of constant size and a descent the fit's trend can follow.
 *
 * Built by integrating normalized deltas rather than by dividing each sample by its local torso,
 * because the latter would also rescale the runner's absolute image position: a hip-mid sitting
 * 1000 px down the frame, divided by a torso that doubles, sweeps 500 px in "normalized" space with
 * no motion at all. A delta divided by the scale AT that delta carries only the motion.
 *
 * - Each kept step `a → b` is divided by the mean of the two frames' local torso lengths
 *   (`estimateLocalTorsoLengths`, `LOCAL_TORSO_HALF_WINDOW_SECONDS`) and the running sum is
 *   multiplied back up by the clip-median torso, so the fit's amplitude reads in pixels at the
 *   clip's typical scale.
 * - Image-y sign is KEPT (`y[b] − y[a]`, not flipped), so the fitted phase means the same thing it
 *   means on the raw series and `footstrikes.ts`/`bounceInstants.ts` read it unchanged.
 * - Frames with no signal or no local torso are skipped, and the integral does NOT reset across
 *   such a gap: the step spanning it is one normalized delta like any other.
 *
 * Not to be confused with `verticalOscillationCm.ts`'s `buildMetricSeries`, which also integrates
 * per-frame deltas but in METRES over the detector's per-frame scale and with the sign flipped
 * upward-positive.
 *
 * Returns `null` — declining the fallback — when frames are out of presentation order
 * (`estimateLocalTorsoLengths` requires that order and would throw) or when no torso resolves at
 * all.
 */
function buildScaleNormalizedSamples(
  frames: RobustPoseFrame[],
  signalY: ReadonlyArray<number | null>,
): SpectralSample[] | null {
  for (let i = 1; i < frames.length; i += 1) {
    if (!(frames[i].timestamp >= frames[i - 1].timestamp)) return null
  }
  const medianTorsoPx = estimateBodyScale(frames)?.torsoLengthPx ?? null
  if (medianTorsoPx === null || !(medianTorsoPx > 0)) return null
  const localTorsoPx = estimateLocalTorsoLengths(frames, LOCAL_TORSO_HALF_WINDOW_SECONDS)

  const samples: SpectralSample[] = []
  let previous: { y: number; local: number } | null = null
  let normalizedY = 0
  for (let i = 0; i < frames.length; i += 1) {
    const y = signalY[i]
    const local = localTorsoPx[i]
    if (y === null || local === null || !Number.isFinite(local) || !(local > 0)) continue
    if (previous !== null) normalizedY += (y - previous.y) / ((previous.local + local) / 2)
    samples.push({ t: frames[i].timestamp, v: normalizedY * medianTorsoPx })
    previous = { y, local }
  }
  return samples
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
