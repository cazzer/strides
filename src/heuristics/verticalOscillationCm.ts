import type { RobustPoseFrame } from '../pose/robustness/types'
import { estimateBodyScale } from './bodyScale'
import { resolveMidpoint } from './keypoints'
import { fitSpectralSinusoid } from './spectralFit'
import type {
  SpectralFitFailureReason,
  SpectralFitSuccess,
  SpectralSample,
} from './spectralFit'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { HeuristicsConfig } from './types'
import { median } from './mathUtils'

/**
 * Sinusoid PARTIAL R² (against a trend-only baseline, never total R²) an integration run's fit
 * must reach to contribute an amplitude. Below it the run contributes nothing, and if no run
 * clears it the calculation reports `fitFailureReason: 'below-quality-gate'` rather than a number
 * describing noise.
 *
 * A module constant rather than a `HeuristicsConfig` key, following this module's established
 * private-policy precedent (the `CM_MIN_PROMINENCE_TORSO_RATIO` it replaces, and
 * `MIN_CADENCE_SAMPLE_SIZE` and friends elsewhere): this calculation is not a `MetricId`, renders
 * no card, and is read only by dev diagnostics — a config key is the vocabulary for "a deployment
 * might want to tune this", and nothing consumes this number in a way that would make tuning
 * meaningful yet. Recorded upgrade path: GitHub #36 promotes it to a config key if a rendered
 * card's availability comes to depend on it.
 *
 * **0.30 is the same number, from the same calibration, as `verticalOscillationMinFitR2` and
 * `cadenceMinFitR2`**, and the transfer is sound for the same reason cadence's reuse is: the same
 * hip samples at the same n. Live MediaPipe runs give n = 57 (track clip) and n = 84 (park clip),
 * inside the n ≈ 50+ band that value was calibrated for — measured pure-noise partial R² p95 ≈
 * 0.22 and p99 ≈ 0.28 at n = 50, against a worst observed real trial of 0.40.
 *
 * **The n-regime caveat bites harder here than at any other call site.** The pure-noise floor
 * climbs steeply as n falls (measured p95: 0.34 at n = 30, 0.44 at n = 20, 0.64 at n = 12), and
 * because this module fits PER RUN rather than once per clip, a fragmented clip can reach
 * `fitSpectralSinusoid`'s 12-sample floor — a regime where this gate is NOT protective, since
 * noise clears it more often than not. That is exposed rather than hidden: the winning run's
 * `fit.sampleCount` says which regime the reported number came from. The n-invariant replacement
 * (an F-test on the fit's 2 sinusoid degrees of freedom against its residual degrees of freedom)
 * is deferred, and when it lands it replaces all three gates together, not just this one.
 */
const CM_MIN_FIT_R2 = 0.3

/**
 * Why this calculation reported no amplitude. The three `SpectralFitFailureReason` values come
 * straight from the shared primitive's well-posedness rules; the two added here are this
 * calculation's own policy (`'below-quality-gate'`) and its "there was nothing to fit in the first
 * place" case (`'no-usable-run'` — no integration run, or every run carried no scale at all).
 */
export type ScaleCalibratedFitFailureReason =
  | SpectralFitFailureReason
  | 'below-quality-gate'
  | 'no-usable-run'

/**
 * The spectral fit behind `verticalOscillationCm`. Mirrors `VerticalOscillationFit` (`types.ts`)
 * field for field, with the amplitude named for the unit it is actually in — so the pixel-path and
 * centimetre-path diagnostics read the same way side by side.
 *
 * Every field describes ONE contributing run's fit, never a blend across runs (see
 * `selectWeightedMedianFit`): an averaged amplitude paired with an averaged fit quality would
 * describe a fit that never happened.
 */
export interface ScaleCalibratedFit {
  /** Winning candidate frequency from the shared grid, Hz. This is BOUNCE frequency — one bounce
   * per STEP — so `frequencyHz × 60` is directly comparable to the `cadence` metric's steps/min.
   * A free cross-check, and a strong one: it reaches the same rhythm through an entirely separate
   * series (this module's integrated metric series, not the raw pixel trace), so a large
   * disagreement means one of the two fits landed on a harmonic or a grid edge. */
  frequencyHz: number
  /** Fitted peak-to-peak bounce, centimetres. This is `verticalOscillationCm`. */
  peakToPeakAmplitudeCm: number
  /** Partial R² of the sinusoid terms over a trend-only baseline — the number `CM_MIN_FIT_R2`
   * gates on. */
  sinusoidR2: number
  /** R² against the raw metric series, trend included. Diagnostic only: on a drifting clip the
   * trend terms alone can push this near 1 while the oscillation explains almost nothing, so it is
   * never gated on and is not comparable across clips. */
  totalR2: number
  /** How well the best frequency outside a resolution-aware band around `frequencyHz` fits,
   * relative to `frequencyHz` itself, in [0, 1]. Reported for diagnosis only. */
  secondPeakRatio: number
  /** Frames in the winning run that the fit was computed over. Read this alongside the amplitude:
   * near `fitSpectralSinusoid`'s 12-sample floor the quality gate is not protective — see
   * `CM_MIN_FIT_R2`. */
  sampleCount: number
  /** Time from the winning run's first to its last sample. */
  spanSeconds: number
  /** `spanSeconds × frequencyHz`, fractional, for the winning run alone. `sampleSize` sums the
   * floor of this across ALL contributing runs. */
  observedCycles: number
}

export interface ScaleCalibratedVerticalOscillation {
  /** Fitted PEAK-TO-PEAK bounce amplitude in centimetres; null when no integration run produced a
   * fit that cleared the quality gate. Never zero-as-a-stand-in for "nothing measured" — a null
   * here always comes with a `fitFailureReason`. */
  verticalOscillationCm: number | null
  /** Complete bounce cycles observed across every contributing run — one bounce per STEP, i.e.
   * HALF a full gait cycle. Same unit `MetricResult.sampleSize` reports for the pixel-space
   * vertical oscillation and cadence metrics; NOT the paired half-cycle count an older
   * extrema-pairing estimator reported here. */
  sampleSize: number
  /** The fit the reported amplitude came from. Non-null exactly when `verticalOscillationCm` is. */
  fit: ScaleCalibratedFit | null
  /** Why no amplitude was reported. Non-null exactly when `verticalOscillationCm` is null — a
   * measured-but-unfittable clip names its reason rather than reporting an unexplained null. */
  fitFailureReason: ScaleCalibratedFitFailureReason | null
  /** Last measured scale / first measured scale. ~1.0 = fixed camera distance; far from 1.0 means
   * the subject approached or receded. Unlike under the previous extrema-pairing estimator, that
   * translation is absorbed by the fit's trend terms rather than charged to the amplitude — so
   * this is now a note about the footage, not a warning that the figure above is inflated. */
  scaleDriftRatio: number
  medianPixelsPerMeter: number
  /** torsoLengthPx / medianPixelsPerMeter — a sanity check on the whole calibration: a human
   * torso (shoulder-mid to hip-mid) is roughly 0.5 m, so a wildly different number here means the
   * scale is wrong and the centimetre figure should not be believed. Null when no body-scale
   * reference resolves, which no longer suppresses the measurement: it was only ever a check, and
   * since the amplitude estimator stopped needing a prominence threshold, `torsoLengthPx` is not
   * an input to the centimetre figure at all. */
  torsoMeters: number | null
  /** Frames carrying a measured scale / frames considered. Frames in a run that was dropped for
   * carrying no scale at all still count in the denominator — a dropped run is visible here as
   * lost coverage rather than silently vanishing. */
  scaleCoverage: number
  /** Independent integration runs that contributed a fit. Each gap in hip tracking resets
   * integration, so a fragmented clip yields several small runs rather than one. */
  integrationRuns: number
}

/**
 * The backend contract already promises a measured scale is finite and strictly positive; this
 * re-checks it at the one place a violation would matter, so that no arithmetic below can produce
 * an `Infinity`/`NaN` that would escape into the diagnostics output. A value failing the check is
 * treated exactly like an unmeasured frame.
 */
function isUsableScale(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0
}

/** One maximal contiguous stretch of frames where the hip midpoint resolves. */
interface IntegrationRun {
  /** Hip-mid image y, in pixels, one entry per frame in the run. */
  hipY: number[]
  timestamps: number[]
  /** Pixels-per-metre per frame in the run; null where that frame carried no measurement. */
  scales: Array<number | null>
}

/**
 * Splits `frames` into maximal contiguous runs of resolvable hip-midpoints. Each run integrates
 * from its own zero downstream: across a gap the hip's position is simply unknown, so carrying a
 * cumulative sum through it would assert motion nobody measured.
 *
 * Interpolated hip keypoints are used, same as the pixel-space `computeVerticalOscillation` — and
 * the bias runs the safe way: linear interpolation across a curved trajectory understates its
 * excursion, so a gap-filled stretch can only pull the reported amplitude down, never inflate it.
 */
function buildRuns(frames: RobustPoseFrame[]): IntegrationRun[] {
  const runs: IntegrationRun[] = []
  let current: IntegrationRun | null = null

  for (const frame of frames) {
    const hipMid = resolveMidpoint(frame, 'left_hip', 'right_hip')
    if (hipMid === null) {
      current = null
      continue
    }
    if (current === null) {
      current = { hipY: [], timestamps: [], scales: [] }
      runs.push(current)
    }
    current.hipY.push(hipMid.y)
    current.timestamps.push(frame.timestamp)
    current.scales.push(isUsableScale(frame.pixelsPerMeter) ? frame.pixelsPerMeter : null)
  }

  return runs
}

/**
 * Every measured scale across the whole clip, in frame order — the basis for the median scale, the
 * drift ratio, and coverage.
 */
function collectScales(frames: RobustPoseFrame[]): number[] {
  const scales: number[] = []
  for (const frame of frames) {
    if (isUsableScale(frame.pixelsPerMeter)) scales.push(frame.pixelsPerMeter)
  }
  return scales
}

/**
 * Fills a run's missing per-frame scales: linear interpolation between the flanking measurements,
 * nearest-value hold past the outermost ones. Unlike a *position*, a scale is a smooth function of
 * camera distance, so interpolating it asserts far less than interpolating where a body was. A run
 * with no measurement at all returns `null` — it is dropped rather than borrowing a neighbouring
 * run's scale, which would apply one camera distance's calibration to a different camera
 * distance's motion.
 */
function fillRunScales(scales: Array<number | null>): number[] | null {
  const filled = new Array<number>(scales.length)
  let lastMeasured = -1

  for (let i = 0; i < scales.length; i += 1) {
    const scale = scales[i]
    if (scale === null) continue

    if (lastMeasured === -1) {
      // Leading unmeasured frames: hold the first measurement backwards.
      for (let j = 0; j < i; j += 1) filled[j] = scale
    } else {
      const previous = filled[lastMeasured]
      for (let j = lastMeasured + 1; j < i; j += 1) {
        const t = (j - lastMeasured) / (i - lastMeasured)
        filled[j] = previous + (scale - previous) * t
      }
    }
    filled[i] = scale
    lastMeasured = i
  }

  if (lastMeasured === -1) return null
  // Trailing unmeasured frames: hold the last measurement forwards.
  for (let j = lastMeasured + 1; j < scales.length; j += 1) {
    filled[j] = filled[lastMeasured]
  }
  return filled
}

/**
 * Converts one run's pixel hip-y series into a cumulative metric series (metres), ready to be
 * fitted.
 *
 * The conversion integrates DELTAS — `(y[k-1] - y[k]) / s̄[k]` accumulated — rather than dividing
 * absolute pixel positions by a per-frame scale. That distinction is the whole point of this
 * module: under a drifting scale (a subject approaching the camera), `y_px / s(t)` reports the
 * drift itself as vertical movement, which measured as a ~480 cm "bounce" on a real clip whose
 * subject bounced a few centimetres. Deltas are immune: a stationary hip has zero delta every
 * frame, whatever the scale is doing.
 *
 * `s̄[k] = (s[k-1] + s[k]) / 2` — the step spans two frames, so it gets the two frames' mean
 * scale. Under a constant scale this collapses to that constant, which is what makes the result
 * exactly `pixel_amplitude / s`.
 *
 * Sign convention: `(y[k-1] - y[k])`, so positive means upward on screen (image y grows
 * downward) — matching `computeVerticalOscillation`'s charting series.
 */
function buildMetricSeries(run: IntegrationRun, scales: number[]): SpectralSample[] {
  const series: SpectralSample[] = []
  let cumulative = 0
  for (let k = 0; k < run.hipY.length; k += 1) {
    if (k > 0) {
      const stepScale = (scales[k - 1] + scales[k]) / 2
      cumulative += (run.hipY[k - 1] - run.hipY[k]) / stepScale
    }
    series.push({ t: run.timestamps[k], v: cumulative })
  }
  return series
}

/**
 * Picks the contributing run whose amplitude is the SAMPLE-COUNT-WEIGHTED MEDIAN: sort by
 * amplitude (stable, so equal amplitudes keep run order), then walk the sorted list accumulating
 * `sampleCount` and take the first run whose cumulative count, doubled, reaches the total — the
 * lower weighted median.
 *
 * Selecting one run's fit rather than blending several is deliberate: everything reported
 * alongside the amplitude (`frequencyHz`, `sinusoidR2`, `spanSeconds`, `sampleCount`, ...) then
 * describes ONE coherent fit of one real stretch of footage. A mean amplitude paired with a mean
 * R² describes no fit that ever happened, and the `frequencyHz × 60` vs. cadence cross-check would
 * be meaningless against a blended frequency.
 *
 * Weighting by sample count buys a dominance property a plain median of run amplitudes would not
 * have: a run holding more than half the total samples ALWAYS wins, whatever its amplitude —
 * everything sorted before it sums to less than half the total, so the cumulative test cannot trip
 * early. A noisy 15-sample fragment therefore can never outvote a 50-sample run.
 */
function selectWeightedMedianFit(
  fits: SpectralFitSuccess[],
): SpectralFitSuccess | null {
  if (fits.length === 0) return null

  const sorted = [...fits].sort(
    (a, b) => a.peakToPeakAmplitude - b.peakToPeakAmplitude,
  )
  let total = 0
  for (const fit of sorted) total += fit.sampleCount

  let cumulative = 0
  for (const fit of sorted) {
    cumulative += fit.sampleCount
    if (cumulative * 2 >= total) return fit
  }
  // Unreachable: every fit's sampleCount is a positive integer, so the last iteration always has
  // `cumulative === total`. Kept as a total function rather than a non-null assertion.
  return sorted[sorted.length - 1]
}

/** One run that was fitted but contributed nothing, with enough context to arbitrate between
 * several such verdicts. */
interface RunRefusal {
  /** Frames in the run — "longest run wins" is decided on this, not on the fit's own sample
   * count, so a run refused before any sample was usable still competes on its real length. */
  frameCount: number
  reason: ScaleCalibratedFitFailureReason
}

/**
 * When no run contributed, exactly one reason is reported: the LONGEST refused run's, ties broken
 * toward the earliest run (a stable scan, no sort). The longest run's verdict carries the most
 * evidence about why the clip yielded nothing.
 *
 * Runs dropped for carrying no scale at all never reach here — they were never fitted, so they
 * have no verdict to offer. An empty list therefore means "no run was ever fitted", which is
 * `'no-usable-run'`: either there were no integration runs at all, or every one of them was
 * scale-less.
 */
function arbitrateFailureReason(
  refusals: RunRefusal[],
): ScaleCalibratedFitFailureReason {
  let winner: RunRefusal | null = null
  for (const refusal of refusals) {
    if (winner === null || refusal.frameCount > winner.frameCount) winner = refusal
  }
  return winner?.reason ?? 'no-usable-run'
}

/**
 * Vertical oscillation in real centimetres, calibrated by a per-frame pixels-per-metre scale that
 * only some detection backends can measure (today: MediaPipe Pose Landmarker, from its
 * hip-centered `worldLandmarks`).
 *
 * Deliberately a sibling of `computeVerticalOscillation` rather than a change to it: this is a
 * different unit answering a different question ("how many centimetres?" vs. "what fraction of
 * this runner's torso?"), it only exists on one backend, and `computeFormHeuristics` is
 * backend-agnostic by contract — making the seven-metric result shape depend on which detector ran
 * would leak backend identity into the heuristics layer.
 *
 * ## Which stage does what
 *
 * `collectScales → buildRuns → buildMetricSeries → fitSpectralSinusoid`. The pixel→metre
 * CONVERSION (`buildMetricSeries`, and the run splitting that feeds it) is unchanged and is this
 * module's one correctness constraint — see its doc comment, and the 480 cm regression test. What
 * changed is only how an amplitude is READ off the converted series: a spectral sinusoid fit
 * (`spectralFit.ts`, the same primitive `verticalOscillation` and `cadence` use) replaced an
 * extrema-pairing estimator.
 *
 * The fit's `c + d·t + e·t²` trend terms are the entire reason for the swap. This calculation
 * reads the signal where whole-body translation is worst — a runner approaching the camera — and
 * extrema pairing has no way to separate that translation from the bounce, so it charged the
 * approach to the amplitude (measured on the park clip: half-cycle amplitudes alternating
 * 24.6/6.6/14.9/4.5/18.0/4.5/31.1 cm with the drift direction). The trend terms are fitted
 * alongside the sinusoid, so the translation is removed by construction rather than by hoping it
 * averages out.
 *
 * One fit PER INTEGRATION RUN, never across runs: each run's cumulative series restarts at its own
 * arbitrary baseline, so a fit spanning two of them would try to explain the step between two
 * unrelated zeros. With several contributing runs, `selectWeightedMedianFit` picks one run's fit to
 * report in full. See the change's design.md (D1) for why de-meaned concatenation of runs is not a
 * valid way to pool short runs' sample mass.
 *
 * `fit.frequencyHz × 60` is a free cross-check against the `cadence` metric's steps/minute: same
 * body, same rhythm, reached through a completely separate series.
 *
 * ## Config
 *
 * `config` is read for the shared spectral frequency GRID ONLY
 * (`spectralFitMinFrequencyHz`/`spectralFitMaxFrequencyHz`/`spectralFitFrequencyStepHz`), so that
 * retuning that grid moves this calculation with it instead of letting a hardcoded copy silently
 * diverge from cadence and break the cross-check above. It is NEVER read for signal selection:
 * `verticalOscillationSignal` does not apply here, and this calculation stays anchored to the
 * hip/shoulder torso segment unconditionally — the whole scale calibration is derived from that
 * segment, and `torsoMeters`' ~0.5 m sanity check only means anything against it.
 *
 * ## Return
 *
 * Returns `null` when no frame carries a scale (every backend but MediaPipe) — the caller omits
 * the diagnostics key entirely in that case rather than reporting invented nulls. A clip that DID
 * carry a scale but yielded no fittable run returns a result object with a null amplitude, a null
 * `fit`, and a `fitFailureReason` naming why — measured-but-unfittable is a different fact from
 * not-measured, and an unexplained null is indistinguishable from a bug.
 */
export function computeVerticalOscillationCm(
  frames: RobustPoseFrame[],
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): ScaleCalibratedVerticalOscillation | null {
  const scales = collectScales(frames)
  if (scales.length === 0) return null

  const medianPixelsPerMeter = median(scales)
  // Sanity-check reporting only — no longer an input to the amplitude. The extrema estimator
  // needed it to express a prominence threshold in metres; the fit has no such threshold, so a
  // clip with no resolvable body-scale reference can now report centimetres with `torsoMeters:
  // null` instead of reporting nothing at all.
  const torsoLengthPx = estimateBodyScale(frames)?.torsoLengthPx ?? null

  const fitOptions = {
    minFrequencyHz: config.spectralFitMinFrequencyHz,
    maxFrequencyHz: config.spectralFitMaxFrequencyHz,
    frequencyStepHz: config.spectralFitFrequencyStepHz,
  }

  const contributing: SpectralFitSuccess[] = []
  const refusals: RunRefusal[] = []

  for (const run of buildRuns(frames)) {
    const runScales = fillRunScales(run.scales)
    // A run with no scale anywhere is dropped without a verdict: it was never fitted, so it has
    // nothing to say about why the clip yielded no amplitude.
    if (runScales === null) continue

    const fit = fitSpectralSinusoid(buildMetricSeries(run, runScales), fitOptions)
    if (!fit.ok) {
      refusals.push({ frameCount: run.hipY.length, reason: fit.reason })
      continue
    }
    if (fit.sinusoidR2 < CM_MIN_FIT_R2) {
      refusals.push({ frameCount: run.hipY.length, reason: 'below-quality-gate' })
      continue
    }
    contributing.push(fit)
  }

  const winner = selectWeightedMedianFit(contributing)
  // Summed across ALL contributing runs, not just the winner's: the reported cycle count is how
  // much bounce the calculation actually observed, even though the amplitude comes from one run.
  let observedCycles = 0
  for (const fit of contributing) observedCycles += fit.observedCycles

  return {
    verticalOscillationCm:
      winner === null ? null : winner.peakToPeakAmplitude * 100,
    sampleSize: Math.floor(observedCycles),
    fit:
      winner === null
        ? null
        : {
            frequencyHz: winner.frequencyHz,
            peakToPeakAmplitudeCm: winner.peakToPeakAmplitude * 100,
            sinusoidR2: winner.sinusoidR2,
            totalR2: winner.totalR2,
            secondPeakRatio: winner.secondPeakRatio,
            sampleCount: winner.sampleCount,
            spanSeconds: winner.spanSeconds,
            observedCycles: winner.observedCycles,
          },
    fitFailureReason: winner === null ? arbitrateFailureReason(refusals) : null,
    scaleDriftRatio: scales[scales.length - 1] / scales[0],
    medianPixelsPerMeter,
    torsoMeters: torsoLengthPx === null ? null : torsoLengthPx / medianPixelsPerMeter,
    scaleCoverage: scales.length / frames.length,
    integrationRuns: contributing.length,
  }
}
