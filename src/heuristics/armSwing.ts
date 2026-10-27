import type { KeypointName } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { HeuristicsConfig, MetricExemplar } from './types'
import { resolveBilateralPair, resolvePoint } from './keypoints'
import { distance, median } from './mathUtils'
import { fitSpectralSinusoid } from './spectralFit'
import type { SpectralFitFailureReason, SpectralFitResult } from './spectralFit'
import { analyzeHipBounce } from './hipBounce'
import { resolvedSpanCenter, selectBounceInstants } from './bounceInstants'
import {
  cropKeypoints,
  describeDistribution,
  pairQuality,
  scoreExemplarInstant,
} from './exemplars'

/**
 * The shared per-side arm-swing computation — the per-side fit, its gate/policy constants, and
 * the per-side exemplar builder. `armSwingAmplitude` (how BIG the swing is) is its consumer
 * today; it calls `computeSideSwing` itself and runs the fit, exactly as
 * `verticalOscillationCm`/`verticalRatio` each call the exported `analyzeHipBounce` — no
 * cross-metric memoization exists in `index.ts`, and the fit is one cheap linear least-squares per
 * side.
 *
 * **One deliberate difference from the `hipBounce.ts` precedent**: `analyzeBounceSignal`'s
 * callers each own their own gate policy (`verticalOscillationMinFitR2` vs `cadenceMinFitR2` —
 * two config keys answering two different questions). Every consumer of THIS fitted signal is
 * MANDATED to share one gate policy — a second, separately-tunable gate constant on the identical
 * fit is the bug class #36 deleted, two gates letting a metric family disagree with itself about
 * trustworthiness — so the gate constants live HERE, in the shared module, rather than
 * per-caller, and a future second consumer inherits the gate rather than choosing its own.
 *
 * ## Scale stabilization before the fit
 *
 * `fitSpectralSinusoid`'s model is a CONSTANT-amplitude sinusoid over a polynomial trend, and a
 * clip whose subject changes on-screen size inside the fit window violates that premise for this
 * signal specifically: the wrist-relative-to-shoulder excursion is a body-proportioned quantity,
 * so its pixel amplitude scales with the subject. Demo 2 — this metric family's primary clip — is
 * the measured case: the inter-shoulder span grows from ~120 px to ~358 px inside the fitted
 * window, so the raw-pixel least squares weights the late, large-scale frames roughly 9:1 over the
 * early ones and each side's "amplitude" is mostly a reading of the clip's end.
 *
 * The fix divides every sample by a per-frame scale factor before the fit — see
 * `resolveScaleStabilizer` for the construction and the reasoning behind each piece of it (strict
 * bilateral proxy, whole-window log-quadratic trend, no clamp). The output stays in PIXELS, at the
 * clip's reference (median measured) scale, so downstream semantics are unchanged:
 * `armSwingAmplitude`'s division by the clip-median torso length still pairs a reference-scale
 * numerator with a clip-median denominator.
 */

/**
 * Minimum complete ARM-SWING cycles — one per STRIDE, so one cycle spans two footfalls — for the
 * fitted per-side amplitude to be trusted at full confidence.
 *
 * Two is deliberately the same real demand the previous estimator encoded as "at least 4
 * half-swings": swapping the estimator should not silently also raise the sample bar, so the
 * number was converted rather than re-chosen. It is NOT comparable to
 * `verticalOscillationMinCycles`, which counts BOUNCE cycles at one per step — twice this rate for
 * the same footage.
 */
export const MIN_ARM_SWING_CYCLES = 2

/**
 * Sinusoid partial R² at or above which a side's fit is treated as fully trustworthy — the top of
 * the ramp `armSwingMinFitR2` starts. Same value and same reasoning as
 * `verticalOscillation.ts`'s constant of the same name: a module constant rather than config,
 * because unlike the minimum (a "publish this or not" policy) this is only the shape of the ramp
 * between the gate and "perfect", and moving it independently of the gate only makes the two
 * numbers disagree.
 */
export const FIT_QUALITY_SATURATION_R2 = 0.8

/**
 * Maximum fractional disagreement between the two sides' fitted frequencies, above which the two
 * amplitudes are not treated as comparable at all.
 *
 * **This is the check that distinguishes a real reading from a measured artifact**, and it exists
 * because the R² gate provably does not catch it. Both arms belong to one body and swing on one
 * rhythm, so two fits landing on materially different frequencies means at least one of them found
 * something that is not the arm swing — and any statistic combining an arm-swing amplitude with
 * some other oscillation's amplitude is not an arm-swing measurement, however confidently each
 * side fitted on its own. Measured live on `e2e/fixtures/multiperson-track.mp4` (2026-08-29): left 1.48 Hz at
 * R² 0.676, right **2.80 Hz** at R² 0.324 — the right side had latched onto the step rhythm
 * (cadence 174 spm = 2.90 Hz) rather than the stride rhythm, cleared the R² gate anyway, and the
 * reported 0.349 ratio was a comparison between two different oscillations.
 *
 * 0.25 is a judgment call sized to be far wider than the disagreement a healthy clip produces and
 * far narrower than a step-versus-stride confusion, which is a factor of two by construction. The
 * measured margins either side of it: Demo 2 (both sides on the stride rhythm) 0.027, Demo 1
 * 0.104, multiperson (one side on the step rhythm) 0.892.
 */
export const MAX_SIDE_FREQUENCY_DISAGREEMENT = 0.25

/**
 * Difference in the two sides' fitted `sinusoidR2` above which the clip is caveated for having
 * measured one arm materially better than the other.
 *
 * Confidence already carries this numerically — it ramps on the WEAKER side's fit, below — but a
 * number alone cannot tell a reader that what they are looking at may be a property of the
 * footage rather than of the runner. On a clip where one arm spends the measured window further
 * from the camera (Demo 2: left R² 0.778, right R² 0.497), the smaller-swinging arm is also the
 * worse-measured one, and that coincidence is exactly what a reported swing size must not present
 * as a finding. A judgment call, in the same spirit as `presenceMinConsecutiveFrames`.
 */
export const SIDE_FIT_QUALITY_DISPARITY_R2 = 0.2

/**
 * Half-width of the per-side frequency search, as a fraction of the clip's stride rate: the grid
 * spans `[(1 − this), (1 + this)] × strideHz`.
 *
 * Wider than every arm-vs-stride gap measured live (side-landscape 1.40 vs 1.45 Hz, front-approach
 * 1.50 vs 1.51, multiperson left 1.48 vs 1.45 — all under 4%) and far narrower than a 2×
 * step-versus-stride confusion, which is therefore structurally off the grid rather than something
 * a gate has to catch.
 */
export const ARM_SWING_BAND_HALF_WIDTH = 0.2

/**
 * Grid spacing as a fraction of the stride rate — 21 candidates across the band at ANY playback
 * rate, so a ~7× slow-motion clip searched around 0.2 Hz gets the same relative resolution as a
 * real-time one around 1.5 Hz. 0.02 × 1.5 Hz = 0.03 Hz, the same order as the shared bounce grid's
 * 0.02 Hz step.
 */
export const ARM_SWING_BAND_STEP_FRACTION = 0.02

/**
 * The clip's STRIDE rate in clip-time Hz — half the hip-bounce frequency, because the hip bounces
 * once per step and each arm swings once per stride — or `null` when the clip has no hip-bounce
 * rhythm trustworthy enough to anchor the arm search to.
 *
 * Trusted on exactly the terms cadence trusts the same fit: `analyzeHipBounce`'s fit (including
 * its sub-floor pass, which is how a retimed slow-motion clip gets an anchor at all) must be `ok`
 * with `sinusoidR2 ≥ config.cadenceMinFitR2`. Unlike cadence this does NOT withhold on
 * `subFloorRhythm`: cadence reports a real-time RATE, which a retimed clock gets wrong; the arm
 * fit runs over the same clip-time samples the bounce was fitted on, so a clip-time anchor is the
 * correct one for it.
 *
 * There is deliberately no fallback to the shared bounce band when this is `null`: searching the
 * STEP band for a STRIDE-rate oscillation is the defect this anchor replaces.
 */
export function resolveStrideRateHz(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig,
): number | null {
  const { fit } = analyzeHipBounce(frames, config)
  if (!fit.ok || !(fit.sinusoidR2 >= config.cadenceMinFitR2)) return null
  const strideHz = fit.frequencyHz / 2
  return Number.isFinite(strideHz) && strideHz > 0 ? strideHz : null
}

/**
 * Minimum frames on which BOTH shoulders independently resolve for the scale trend to be fitted
 * at all — deliberately the same bar `fitSpectralSinusoid` sets for its own smallest fit
 * (`MIN_SPECTRAL_FIT_SAMPLES`), for the same reason: a low-order model over a handful of points
 * chases noise rather than describing anything. Below it the factor is IDENTICALLY 1 for every
 * sample — an exact no-op, bit-equal to the raw-pixel behavior this stabilization replaced —
 * rather than a poorly-founded trend quietly reshaping the series.
 */
export const MIN_SCALE_TREND_SAMPLES = 12

/** Pivot magnitude below which the 3×3 trend system is treated as singular, relative to the
 * largest entry — `spectralFit.ts`'s own convention, restated here because that module's solver is
 * deliberately private (see its doc for why). */
const TREND_PIVOT_RELATIVE_FLOOR = 1e-12

/**
 * Fitted log-trend range (max − min over the observed window) below which the trend is treated as
 * FLAT and the factor snaps to the constant 1. A degeneracy floor in the same spirit as
 * `spectralFit.ts`'s `DEGENERACY_RELATIVE_FLOOR`, not a tuning knob: 1e-6 is a within-window scale
 * change of one part in a million — meaningless to any amplitude — while sitting eight orders of
 * magnitude above the ~1e-14 coefficient noise a constant proxy leaves in `d`/`e`.
 *
 * This rung is what makes the constant-scale no-op EXACT rather than approximate, and exactness is
 * load-bearing: dividing a series by `exp(~1e-14 wobble)` perturbs constant values at the same
 * order as their own floating-point rounding, which is enough to turn a motionless-arm clip's
 * honest `'degenerate-signal'` ("no oscillating vertical motion") into a spurious
 * below-quality-gate reading over pure rounding noise.
 */
const FLAT_TREND_LOG_RANGE = 1e-6

/**
 * Gaussian elimination with partial pivoting for the one 3×3 normal-equation system this module
 * forms. Private for the same reason `spectralFit.ts` keeps its solver private: it serves exactly
 * one caller with exactly one conditioning story (a time-centered quadratic basis), and is not an
 * invitation to solve arbitrary systems this way. Returns `null` — never a NaN-laden vector — when
 * the system is singular to within the relative pivot floor.
 */
function solveTrendSystem(
  matrix: readonly (readonly number[])[],
  rhs: readonly number[],
): number[] | null {
  const n = rhs.length
  const a = matrix.map((row, i) => [...row, rhs[i]])

  let largest = 0
  for (const row of a) {
    for (let c = 0; c < n; c += 1) largest = Math.max(largest, Math.abs(row[c]))
  }
  if (!(largest > 0)) return null
  const pivotFloor = largest * TREND_PIVOT_RELATIVE_FLOOR

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivotRow][col])) pivotRow = r
    }
    if (Math.abs(a[pivotRow][col]) <= pivotFloor) return null
    if (pivotRow !== col) {
      const swap = a[pivotRow]
      a[pivotRow] = a[col]
      a[col] = swap
    }
    const pivot = a[col][col]
    for (let r = col + 1; r < n; r += 1) {
      const factor = a[r][col] / pivot
      if (factor === 0) continue
      for (let c = col; c <= n; c += 1) a[r][c] -= factor * a[col][c]
    }
  }

  const solution = new Array<number>(n)
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = a[i][n]
    for (let j = i + 1; j < n; j += 1) sum -= a[i][j] * solution[j]
    solution[i] = sum / a[i][i]
  }
  return solution.every((value) => Number.isFinite(value)) ? solution : null
}

/**
 * Builds the per-frame scale factor `f(t)` the swing series is divided by: a smoothed
 * inter-shoulder-span trend, normalized so `f` reads 1 at the clip's reference (median measured)
 * scale. Each piece is a deliberate choice:
 *
 * - **The proxy is the inter-shoulder distance, resolved STRICTLY bilaterally**
 *   (`resolveBilateralPair`, never `resolveMidpoint`'s single-side fallback). A scale needs two
 *   real points — a span measured against a fabricated stand-in point is a fabricated length, the
 *   exact bug class `estimateHipWidth` and view detection's bilateral-spread signal already refuse
 *   for the same reason. A frame whose proxy is missing still gets a factor (the trend evaluates
 *   at every timestamp), so no swing sample is ever dropped for it.
 * - **The trend is a whole-window least-squares quadratic in LOG space**,
 *   `log(spanPx) ≈ c + d·t + e·t²` with time centered at the proxy samples' mean before the basis
 *   is built — the centering `spectralFit.ts`'s module doc describes as free conditioning
 *   insurance for normal equations. Log space because
 *   scale is multiplicative — a 2× approach costs the same trend budget at any distance — and
 *   because the exponentiated trend is positive by construction, so the divisor can never cross
 *   zero. Three degrees of freedom because a 3-dof polynomial cannot represent ANY frequency the
 *   fit searches (every candidate completes at least one cycle inside the window): the stride-rate
 *   wobble the
 *   inter-shoulder span genuinely carries (trunk counter-rotation, ~5.8% rms measured on Demo 2)
 *   structurally cannot leak into the divisor, where it would multiply straight into the swing
 *   series as in-band noise. A per-frame or heavily-smoothed divisor has no such guarantee.
 * - **`f(t) = exp(trend(t)) / referencePx`**, where `referencePx` is the median of the measured
 *   per-frame proxies — so the divided series stays in PIXELS, at the clip's reference scale,
 *   rather than becoming a dimensionless shoulder-span multiple with different downstream units.
 * - **Evaluation time is clamped into the fitted proxy window; the factor's VALUE is not.**
 *   Inside the window the exponentiated fit stays within the data's own range — but a frame whose
 *   own proxy is missing can sit OUTSIDE the window (a far shoulder unresolvable at the clip's
 *   edge), where an exponentiated quadratic extrapolates super-exponentially. Clamping the
 *   evaluation time hands such a frame the nearest measured-window scale, keeping the trend an
 *   interpolation of measured data. There is still no clamp on `f(t)` itself: the fallback
 *   ladder below guards the degenerate cases a value clamp would otherwise paper over.
 *
 * Fallback ladder — every rung returns the CONSTANT 1 (an exact no-op, not an approximate one):
 * fewer than `MIN_SCALE_TREND_SAMPLES` frames with a usable bilateral proxy; a trend system too
 * singular to solve (e.g. all proxy samples at one timestamp); a fitted trend flat to within
 * `FLAT_TREND_LOG_RANGE` (see that constant for why this rung is what makes the constant-scale
 * no-op exact); a non-finite or non-positive factor at evaluation time (unreachable from a solved
 * fit over real input, guarded per the "never NaN" contract).
 */
function resolveScaleStabilizer(frames: RobustPoseFrame[]): (timestampSeconds: number) => number {
  const times: number[] = []
  const spans: number[] = []
  for (const frame of frames) {
    const shoulders = resolveBilateralPair(frame, 'left_shoulder', 'right_shoulder')
    if (shoulders === null) continue
    const span = distance(shoulders.left, shoulders.right)
    if (!Number.isFinite(span) || span <= 0) continue
    times.push(frame.timestamp)
    spans.push(span)
  }

  if (spans.length < MIN_SCALE_TREND_SAMPLES) return () => 1

  const n = spans.length
  let tSum = 0
  for (const t of times) tSum += t
  const tMean = tSum / n

  // Normal equations for `log(span) ≈ c + d·t̃ + e·t̃²` over the centered basis `t̃ = t − tMean`.
  let sT = 0
  let sT2 = 0
  let sT3 = 0
  let sT4 = 0
  let sY = 0
  let sTY = 0
  let sT2Y = 0
  for (let i = 0; i < n; i += 1) {
    const t = times[i] - tMean
    const y = Math.log(spans[i])
    const t2 = t * t
    sT += t
    sT2 += t2
    sT3 += t2 * t
    sT4 += t2 * t2
    sY += y
    sTY += t * y
    sT2Y += t2 * y
  }

  const coefficients = solveTrendSystem(
    [
      [n, sT, sT2],
      [sT, sT2, sT3],
      [sT2, sT3, sT4],
    ],
    [sY, sTY, sT2Y],
  )
  if (coefficients === null) return () => 1

  const [c, d, e] = coefficients

  // The flat-trend rung: the quadratic's extrema over the observed window sit at the window ends
  // or at its vertex, so its full range is readable from at most three evaluations (`c` cancels
  // out of a range).
  let tLow = Infinity
  let tHigh = -Infinity
  for (const t of times) {
    const centered = t - tMean
    if (centered < tLow) tLow = centered
    if (centered > tHigh) tHigh = centered
  }
  const logTrendAt = (t: number) => d * t + e * t * t
  let trendMin = Math.min(logTrendAt(tLow), logTrendAt(tHigh))
  let trendMax = Math.max(logTrendAt(tLow), logTrendAt(tHigh))
  if (e !== 0) {
    const vertex = -d / (2 * e)
    if (vertex > tLow && vertex < tHigh) {
      const atVertex = logTrendAt(vertex)
      trendMin = Math.min(trendMin, atVertex)
      trendMax = Math.max(trendMax, atVertex)
    }
  }
  if (!(trendMax - trendMin > FLAT_TREND_LOG_RANGE)) return () => 1

  const referencePx = median(spans)
  return (timestampSeconds) => {
    // Evaluation TIME is clamped into the fitted proxy window [tLow, tHigh]: a frame whose own
    // proxy is missing can sit OUTSIDE that window (e.g. the far shoulder unresolvable for the
    // clip's opening), and an exponentiated quadratic grows super-exponentially under
    // extrapolation — such a frame gets the nearest measured-window scale instead. The factor
    // VALUE stays unclamped (design D3).
    const t = Math.min(tHigh, Math.max(tLow, timestampSeconds - tMean))
    const factor = Math.exp(c + d * t + e * t * t) / referencePx
    return Number.isFinite(factor) && factor > 0 ? factor : 1
  }
}

export const SHOULDER_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_shoulder',
  right: 'right_shoulder',
}

export const WRIST_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_wrist',
  right: 'right_wrist',
}

/** Context only (design D2): the elbow is the joint the swing bends at, so a shoulder-to-wrist
 * crop without it reads as a bare diagonal. Optional by contract — `cropKeypoints` drops it if it
 * resolves nowhere in the pair's own frames. */
export const ELBOW_NAME: Record<'left' | 'right', KeypointName> = {
  left: 'left_elbow',
  right: 'right_elbow',
}

export interface SideSwing {
  /** The side's own scale-stabilized wrist-relative-to-shoulder-y trace, in px at the clip's
   * reference scale (see `resolveScaleStabilizer`), `null` where it did not resolve, index-
   * parallel to `frames` — the shape `resolvedSpanCenter` reads. */
  seriesY: Array<number | null>
  /** The spectral fit of that trace, over the stride-rate-anchored grid. */
  fit: SpectralFitResult
  /** Frames where this side's shoulder AND wrist both resolved. */
  resolvedCount: number
  /** Of resolvedCount, how many had either point flagged interpolated. */
  interpolatedCount: number
}

/**
 * Per-side wrist-relative-to-shoulder vertical (image-y) excursion, read as a spectral sinusoid
 * fit via the shared `fitSpectralSinusoid` primitive — the same estimator `verticalOscillation` and
 * `cadence` read their own rhythms with, over a grid anchored on the clip's stride rate (below).
 *
 * Vertical, not horizontal or angular, and wrist rather than elbow, per design.md's original
 * reasoning: the sagittal shoulder-flexion rotation that drives arm swing is foreshortened face-on
 * (this metric's primary view), but the coupled elbow-flexion rise/fall of the forearm toward the
 * chest on the forward swing is a real, front-view-visible vertical motion, and the wrist — the
 * most distal available point — inherits the largest version of it. That input signal is unchanged;
 * only how an amplitude is read off it changed.
 *
 * Each sample is divided by the clip's smoothed inter-shoulder scale trend before the fit — the
 * module doc's "Scale stabilization" section says why, `resolveScaleStabilizer` says how. The
 * division changes sample VALUES only: the series' null pattern, `resolvedCount` and
 * `interpolatedCount` are exactly what the raw series produces, because the trend evaluates at
 * every timestamp whether or not that frame's own proxy resolved.
 *
 * ## Why a fit and not paired extrema
 *
 * This function used to hand the same series to `findLocalExtrema` at a
 * `armSwingMinProminenceRatio × torsoLengthPx` prominence floor and take the median of the
 * resulting peak-to-trough excursions. Measured on Demo 2 (2026-08-29, real GPU, three
 * fresh-process trials, bit-identical), that produced roughly **twice as many extrema as the clip
 * contains half-swings**: 9 confirmed half-swings per side across a 1.62 s window whose fitted
 * rhythm holds ~2.4 arm-swing cycles, i.e. ~5 real half-swings. Their spacings — left
 * `[0.200, 0.234, 0.500, 0.184, 0.050, 0.150, 0.100, 0.100, 0.067]` s against a 0.331 s half-cycle
 * — are the direct evidence: six of nine span under two-thirds of a half-cycle, and the shortest
 * is three frames. The amplitudes those fragments carry (left 11.5 px to 109.8 px; right 7.9 px to
 * 159.7 px) are consequently a mixture of real half-swings and tracking wiggle, and their MEDIAN —
 * the reported per-side amplitude — is a statistic over that mixture rather than over the swing.
 *
 * This is the identical failure `verticalOscillation` retired its own extrema-pairing estimator
 * for, for the identical reasons (see that module's "Method" section), and the fix is the same
 * primitive: the trend terms absorb whole-body drift instead of charging it to the swing, and the
 * fitted frequency is a rhythm rather than a count of whichever wiggles cleared a threshold.
 *
 * ## The frequency grid is anchored on the clip's stride rate
 *
 * The grid is `[(1 − ARM_SWING_BAND_HALF_WIDTH), (1 + ARM_SWING_BAND_HALF_WIDTH)] × strideHz` at
 * `ARM_SWING_BAND_STEP_FRACTION × strideHz` (`resolveStrideRateHz` supplies the anchor;
 * `measure-arm-swing-travel-at-stride-rate` design D1). It used to be the SHARED bounce band
 * (1.2–4.0 Hz) — the STEP band — which has no candidate for a runner below 144 spm, none at all
 * for a retimed slow-motion clip (~0.2 Hz on `park-side-portrait.mp4`), and always offers the 2×
 * step-rate component as a rival.
 *
 * A FIXED halved band (0.6–2.0 Hz) was measured and rejected on 2026-08-29: both side-view clips
 * landed on its 0.60 Hz floor, a grid-edge artifact. That record does not transfer to an ANCHORED
 * band, which cannot offer 0.6 Hz to a 1.45 Hz stride at all; nor does the `secondPeakRatio`
 * comparison made then — nothing on the arm path reads it, and inside a ±20% band its exclusion
 * zone covers most of the grid.
 */
export function computeSideSwing(
  frames: RobustPoseFrame[],
  side: 'left' | 'right',
  options: { strideHz: number },
): SideSwing {
  let resolvedCount = 0
  let interpolatedCount = 0
  const scaleFactorAt = resolveScaleStabilizer(frames)

  const seriesY = frames.map((frame) => {
    const shoulder = resolvePoint(frame, SHOULDER_NAME[side])
    const wrist = resolvePoint(frame, WRIST_NAME[side])
    if (shoulder === null || wrist === null) return null
    resolvedCount += 1
    if (shoulder.interpolated || wrist.interpolated) interpolatedCount += 1
    return (wrist.y - shoulder.y) / scaleFactorAt(frame.timestamp)
  })

  const samples: Array<{ t: number; v: number }> = []
  seriesY.forEach((v, i) => {
    if (v !== null) samples.push({ t: frames[i].timestamp, v })
  })

  const { strideHz } = options
  const fit = fitSpectralSinusoid(samples, {
    minFrequencyHz: (1 - ARM_SWING_BAND_HALF_WIDTH) * strideHz,
    maxFrequencyHz: (1 + ARM_SWING_BAND_HALF_WIDTH) * strideHz,
    frequencyStepHz: ARM_SWING_BAND_STEP_FRACTION * strideHz,
  })

  return { seriesY, fit, resolvedCount, interpolatedCount }
}

export function caveatForFailure(reason: SpectralFitFailureReason, sampleCount: number): string {
  switch (reason) {
    case 'too-few-samples':
      return `Arm position resolved in only ${sampleCount} frame(s) on one side — too few to fit a swing rhythm.`
    case 'insufficient-cycles':
      return 'Arm positions were tracked, but the clip is too short to contain a complete arm-swing cycle.'
    case 'degenerate-signal':
      return 'Arm positions were tracked, but one arm showed no oscillating vertical motion to measure.'
  }
}

/**
 * One ghosted pair per side: the wrist at the top and the bottom of ONE fitted half-swing, half a
 * fitted period apart by construction.
 *
 * Two of them, one per arm, is what makes the measurement legible as a picture — each pair spans
 * the very excursion the reported amplitude is taken over, so the whole two-exemplar budget goes
 * to one pair per arm rather than to two views of one arm.
 *
 * **The instants come from the fitted PHASE, never from a scan of the raw trace**, and the pair is
 * resolved by the same `selectBounceInstants` the vertical-oscillation family uses — see that
 * module's doc for why (an exemplar scanned off the raw trace depicts drift and jitter the reported
 * amplitude explicitly excludes, so the picture would contradict the number printed beside it). It
 * is also the whole point of this change: the previous exemplar was whichever raw extremum pair sat
 * nearest the median amplitude, which on Demo 2 put a *left* pair 0.5005 s apart — one and a half
 * half-cycles — under a caption promising one swing.
 *
 * **`maximumIs: 'lowest'`** — the fitted series is `wrist.y − shoulder.y` in image-y, which grows
 * DOWNWARD, so the sinusoid's MAXIMUM is the wrist at its LOWEST on screen. Getting this backwards
 * produces a caption that says the exact opposite of the truth while passing every type check; the
 * hazard is documented at length in `bounceInstants.ts` and asserted against fixture geometry in
 * `armSwing.test.ts`.
 *
 * Scored on DETECTION ALONE, via an empty distribution — same reasoning `buildBounceCycleExemplar`
 * records: a fitted amplitude has no per-instance values to form a distribution from, and inventing
 * one (say, the raw excursion at that frame) would reintroduce exactly the jittery quantity the fit
 * replaced.
 */
export function buildSideExemplar(
  side: 'left' | 'right',
  swing: SideSwing,
  frames: RobustPoseFrame[],
): MetricExemplar[] {
  if (!swing.fit.ok) return []
  const spanCenterSeconds = resolvedSpanCenter(frames, swing.seriesY)
  if (spanCenterSeconds === null) return []

  const instants = selectBounceInstants({
    fit: swing.fit,
    frames,
    spanCenterSeconds,
    maximumIs: 'lowest',
  })
  if (instants === null) return []

  const seed = [SHOULDER_NAME[side], WRIST_NAME[side]]
  const distribution = describeDistribution([])
  const highQuality = scoreExemplarInstant(
    { frame: instants.highest, seed },
    'representative',
    distribution,
  )
  const lowQuality = scoreExemplarInstant(
    { frame: instants.lowest, seed },
    'representative',
    distribution,
  )
  if (highQuality === null || lowQuality === null) return []

  return [
    {
      kind: 'armSwingCycle',
      timestamp: instants.highest.timestamp,
      pairedTimestamp: instants.lowest.timestamp,
      side,
      quality: pairQuality(highQuality, lowQuality),
      label: `Top and bottom of one ${side}-arm swing, ghosted together`,
      cropKeypoints: cropKeypoints(seed, [ELBOW_NAME[side]], [
        instants.highest,
        instants.lowest,
      ]),
    },
  ]
}
