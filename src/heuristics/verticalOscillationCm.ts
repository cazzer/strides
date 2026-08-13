import type { RobustPoseFrame } from '../pose/robustness/types'
import { estimateBodyScale } from './bodyScale'
import { resolveMidpoint } from './keypoints'
import { fitSpectralSinusoid } from './spectralFit'
import type { SpectralFitSuccess, SpectralSample } from './spectralFit'
import { analyzeHipBounce } from './hipBounce'
import { computeMetricConfidence } from './confidence'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type {
  HeuristicsConfig,
  MetricResult,
  ScaleCalibratedFit,
  ScaleCalibratedFitFailureReason,
  ScaleCalibratedVerticalOscillation,
  VerticalOscillationCmResult,
  View,
} from './types'
import { clamp01, median } from './mathUtils'

// Re-exported for callers that imported the calibration shape from this module before #36 moved
// the type declarations to `types.ts` (D7) — the mechanics that PRODUCE a
// `ScaleCalibratedVerticalOscillation` stay here (D8); only the shape moved, since every consumer
// of `FormHeuristicsResult`, not just this module, now needs to reference it.
export type {
  ScaleCalibratedFit,
  ScaleCalibratedFitFailureReason,
  ScaleCalibratedVerticalOscillation,
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
 * `config` is read for the shared spectral frequency GRID
 * (`spectralFitMinFrequencyHz`/`spectralFitMaxFrequencyHz`/`spectralFitFrequencyStepHz`), so that
 * retuning that grid moves this calculation with it instead of letting a hardcoded copy silently
 * diverge from cadence and break the cross-check above, AND — as of #36 (D3) — for the quality
 * GATE below (`config.verticalOscillationMinFitR2`, replacing a former private `CM_MIN_FIT_R2`
 * module constant; see that key's doc in `types.ts` for why reusing it rather than adding a
 * separate configurable threshold is the coherent choice once this calculation backs a rendered
 * metric). It is NEVER read for signal selection: `verticalOscillationSignal` does not apply here,
 * and this calculation stays anchored to the hip/shoulder torso segment unconditionally — the
 * whole scale calibration is derived from that segment, and `torsoMeters`' ~0.5 m sanity check
 * only means anything against it.
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
    // Gate reuses `verticalOscillationMinFitR2` verbatim (D3) rather than a dedicated constant —
    // see that key's doc (`types.ts`) for the n-regime caveat this gate inherits: because this
    // module fits PER RUN, a fragmented clip can reach `fitSpectralSinusoid`'s 12-sample floor,
    // a regime where the gate is not protective (noise clears 0.30 more often than not at low n).
    // `winner.sampleCount` in the reported fit says which regime a passing run came from.
    if (fit.sinusoidR2 < config.verticalOscillationMinFitR2) {
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
    observedCycles,
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

// ============================================================================================
// Policy layer (#36, D1/D2/D8): `computeVerticalOscillationCm` above is the pure calibration
// calculation, unaware of `MetricId`/view-fit/confidence — everything below turns its result into
// a `VerticalOscillationCmResult`, the third member of the vertical-oscillation family alongside
// `verticalOscillation` and `verticalRatio`. Kept in this file, section-commented, rather than
// split into a separate module: this metric is `computeVerticalOscillationCm`'s only consumer, so
// there is nothing yet for a second file to decouple. If a second consumer of the raw calibration
// ever appears, the extractor (everything above this comment) is what moves out, not this layer.
// ============================================================================================

/** Sinusoid partial R² at or above which the winning run's fit is treated as fully trustworthy —
 * identical constant, identical reasoning, as `verticalOscillation.ts`'s and `verticalRatio.ts`'s
 * own `FIT_QUALITY_SATURATION_R2`: this metric's numerator is a fit of the same shape, gated by
 * the same `verticalOscillationMinFitR2` minimum (D3), so the same ramp shape applies. */
const FIT_QUALITY_SATURATION_R2 = 0.8

/**
 * Shown when no frame in the clip carried a measured real-world scale — the common case today
 * (every backend but MediaPipe Pose Landmarker), and indistinguishable, from inside this
 * calculation, from a MediaPipe clip whose per-frame scale measurement happened to fail
 * everywhere: both look like "no scale anywhere" to `computeVerticalOscillationCm`, so both get
 * this one availability statement rather than two caveats guessing at a cause neither case can
 * actually tell apart. Text is asserted verbatim by a unit test — do not reword without updating
 * it. Layout-independent by design, so #37 (rendering this metric's unavailability well) can reuse
 * it without this module needing to know anything about presentation.
 */
const NO_SCALE_CAVEAT =
  "No real-world scale could be measured for this clip, so bounce can't be reported in centimetres. Vertical oscillation and vertical ratio measure the same bounce without it."

/**
 * Caveat text for a clip that DID carry a measured scale but yielded no fittable amplitude —
 * measured-but-unfittable is a different fact from not-measured (`NO_SCALE_CAVEAT` above), so each
 * `ScaleCalibratedFitFailureReason` gets its own sentence naming specifically what happened. No
 * `default` case: an exhaustive switch over every reason, so a future addition to the union fails
 * to compile here until this function is taught to describe it.
 */
function caveatForFitFailure(reason: ScaleCalibratedFitFailureReason): string {
  switch (reason) {
    case 'too-few-samples':
      return 'Hip position was tracked in too few frames, in any continuous stretch, to fit a bounce rhythm.'
    case 'insufficient-cycles':
      return 'Hip position was tracked, but no continuous stretch was long enough to contain a complete bounce cycle.'
    case 'degenerate-signal':
      return 'Hip position was tracked, but showed no oscillating vertical motion to measure.'
    case 'below-quality-gate':
      return 'Hip position and scale were both measured, but the bounce rhythm was too irregular to measure in any continuous stretch of the clip.'
    case 'no-usable-run':
      return 'No continuous stretch of hip tracking carried a real-world scale, so bounce could not be converted to centimetres.'
  }
}

/**
 * Both null-value branches (no scale measured at all; scale measured but unfittable) share this
 * shape — zeroed frame-coverage/interpolation/sample-size fields, same convention
 * `verticalOscillation.ts`'s and `verticalRatio.ts`'s own `nullResult` helpers use for every
 * no-value path regardless of how far into the computation the failure occurred. `calibration` is
 * the one field that differs by caller: `null` when nothing was measured, the measured-but-
 * unfittable result when something was.
 */
function nullResult(
  viewFit: MetricResult['viewFit'],
  caveat: string,
  calibration: ScaleCalibratedVerticalOscillation | null,
): VerticalOscillationCmResult {
  return {
    metric: 'verticalOscillationCm',
    value: null,
    unit: 'centimeters',
    confidence: 0,
    viewFit,
    interpolatedFraction: 0,
    frameCoverage: 0,
    sampleSize: 0,
    caveat,
    calibration,
  }
}

/**
 * Vertical oscillation in real centimetres, as a `MetricId` (#36) — the third member of the
 * vertical-oscillation family, promoted from the diagnostics-only `computeVerticalOscillationCm`
 * above. Calls that calculation EXACTLY ONCE (D1): the returned `calibration` is carried forward
 * verbatim onto the result, so `AnalysisDiagnostics.scaleCalibration` (D1b, `analysisDiagnostics.ts`)
 * can read it back BY REFERENCE from `FormHeuristicsResult.verticalOscillationCm.calibration`
 * instead of the diagnostics layer computing its own second copy — no-double-compute is a
 * reference-identity invariant now, not just a "don't call the expensive function twice" habit.
 *
 * ## Backend gate
 *
 * `computeVerticalOscillationCm` returns `null` when no frame in the clip carries a measured
 * real-world scale (every backend but MediaPipe Pose Landmarker, and any MediaPipe clip whose
 * per-frame measurement happened to fail everywhere). That is reported here as an AVAILABILITY
 * statement, not an error: `value: null`, `confidence: 0`, `calibration: null`, and
 * `NO_SCALE_CAVEAT` naming what would be needed. This is deliberately the same caveat for both
 * "wrong backend" and "right backend, this clip measured nothing" — the calculation itself cannot
 * tell those apart (see `NO_SCALE_CAVEAT`'s own doc), so this layer does not pretend to either.
 *
 * ## View tolerance
 *
 * View-tolerant on the SAME terms as `verticalOscillation` — see
 * `viewFitTable.verticalOscillationCm`'s doc comment in `types.ts` (D2) for the full argument:
 * the numerator (hip bounce) is view-tolerant for the identical reason `verticalOscillation`'s is,
 * and unlike `verticalRatio` this metric has no view-degenerate denominator to be dragged down by
 * — it has no denominator at all. Applied even to the calibration-failed and no-scale null
 * results, matching every sibling metric's convention of reporting `viewFit` regardless of whether
 * a value was produced.
 *
 * ## Confidence
 *
 * Only computed when `calibration.verticalOscillationCm` is non-null (a null value always forces
 * confidence to 0, per the shared `MetricResult` contract). Built from:
 *   - `viewFitMultiplier`: `viewFitTable.verticalOscillationCm[view].multiplier`.
 *   - `frameCoverage`/`interpolatedFraction`: from `analyzeHipBounce(frames, config)` — COVERAGE
 *     ONLY. This is a SEPARATE call from the one `computeVerticalOscillationCm` makes internally
 *     (via `buildRuns`/`resolveMidpoint`, not `analyzeHipBounce`) — it exists purely to reuse the
 *     already-established hip-mid coverage/interpolation bookkeeping `verticalRatio.ts` already
 *     relies on for the identical purpose, and its own spectral `fit` field is DELIBERATELY UNUSED
 *     here. This is NOT a second bounce estimate: the amplitude and fit-quality this metric reports
 *     come exclusively from `calibration`, computed once, above. Calling `analyzeHipBounce` a
 *     second time costs a second sub-millisecond 141-candidate grid search over the identical
 *     pixel series cadence/verticalOscillation/verticalRatio already each pay independently (see
 *     `hipBounce.ts`'s module doc) — an accepted, precedented redundancy, not a new one.
 *   - `sampleSize`: `calibration.observedCycles`, the FRACTIONAL summed cycle count — never
 *     `calibration.sampleSize` (the floored field used for the reported `MetricResult.sampleSize`
 *     and for caveat text), for the identical reason `verticalOscillation.ts` uses its own fit's
 *     unfloored `observedCycles` for confidence: flooring first would turn a difference smaller
 *     than the fit's own frequency resolution into a confidence cliff.
 *   - `minRequiredSampleSize`: `config.verticalOscillationMinCycles` (3) — the same minimum every
 *     other bounce-cycle-counting family member uses.
 *   - `fitQuality`: a clamp01 ramp from `verticalOscillationMinFitR2` (0, just cleared the gate) to
 *     `FIT_QUALITY_SATURATION_R2` (1, as good as a clean clip gets) — identical shape to
 *     `verticalOscillation.ts`'s and `verticalRatio.ts`'s own ramps, over `calibration.fit`'s
 *     `sinusoidR2` (the winning run's fit — the only fit behind the reported amplitude).
 *   - `scaleCoverage`: `calibration.scaleCoverage`, via `computeMetricConfidence`'s new optional
 *     `scaleCoverage` parameter (`confidence.ts`) — a concern specific to this metric among the
 *     family (whether a resolved hip position also carried a scale measurement that frame), so it
 *     defaults to 1 (irrelevant) for every metric that doesn't depend on measured scale.
 *
 * ## Caveats
 *
 * Null-calibration and fit-failure caveats are each exactly one sentence naming the cause (see
 * `NO_SCALE_CAVEAT` and `caveatForFitFailure`). A non-null value can still carry a joined,
 * space-separated caveat describing what reduced confidence: fewer than
 * `verticalOscillationMinCycles` complete cycles observed; fit quality below
 * `FIT_QUALITY_SATURATION_R2`; more than one integration run contributing (naming that the
 * reported figure comes from the most representative stretch, not a blend); or scale coverage
 * below 0.995 (a formatting-driven cutoff — `(coverage * 100).toFixed(0)` — chosen so this caveat
 * never fires for a clip that would display as a full "100%" anyway). Deliberately NOT added: a
 * `torsoMeters` plausibility caveat (e.g. flagging a wildly non-human ~0.5 m estimate) — recorded
 * as an upgrade trigger in the change's design.md rather than implemented speculatively, pending a
 * live clip that actually lands outside a roughly 0.35–0.70 m range.
 */
export function computeVerticalOscillationCmMetric(
  frames: RobustPoseFrame[],
  view: View,
  config: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): VerticalOscillationCmResult {
  const viewFitEntry = config.viewFitTable.verticalOscillationCm[view]

  const calibration = computeVerticalOscillationCm(frames, config)
  if (calibration === null) {
    return nullResult(viewFitEntry.fit, NO_SCALE_CAVEAT, null)
  }

  if (calibration.verticalOscillationCm === null || calibration.fit === null) {
    const reason = calibration.fitFailureReason ?? 'no-usable-run'
    return nullResult(viewFitEntry.fit, caveatForFitFailure(reason), calibration)
  }

  // COVERAGE ONLY — see the module doc's "Confidence" section for why this second
  // `analyzeHipBounce` call is deliberate and why its own `fit` is never read below.
  const bounceSignal = analyzeHipBounce(frames, config)

  const minFitR2 = config.verticalOscillationMinFitR2
  const fitQuality =
    FIT_QUALITY_SATURATION_R2 > minFitR2
      ? clamp01(
          (calibration.fit.sinusoidR2 - minFitR2) / (FIT_QUALITY_SATURATION_R2 - minFitR2),
        )
      : 1

  const confidence = computeMetricConfidence({
    viewFitMultiplier: viewFitEntry.multiplier,
    frameCoverage: bounceSignal.frameCoverage,
    interpolatedFraction: bounceSignal.interpolatedFraction,
    // Fractional, not `calibration.sampleSize` — see the module doc's "Confidence" section.
    sampleSize: calibration.observedCycles,
    minRequiredSampleSize: config.verticalOscillationMinCycles,
    fitQuality,
    scaleCoverage: calibration.scaleCoverage,
    interpolationConfidencePenalty: config.interpolationConfidencePenalty,
  })

  const caveats: string[] = []
  if (calibration.sampleSize < config.verticalOscillationMinCycles) {
    caveats.push(
      `Only ${calibration.sampleSize} complete bounce cycle(s) observed (recommend at least ${config.verticalOscillationMinCycles}) — confidence reduced accordingly.`,
    )
  }
  if (calibration.fit.sinusoidR2 < FIT_QUALITY_SATURATION_R2) {
    caveats.push(
      'The bounce rhythm in this clip was too irregular to read confidently — confidence reduced accordingly.',
    )
  }
  if (calibration.integrationRuns > 1) {
    caveats.push(
      `Bounce was measured across ${calibration.integrationRuns} separate stretches of the clip; the reported figure comes from the most representative one.`,
    )
  }
  if (calibration.scaleCoverage < 0.995) {
    caveats.push(
      `Real-world scale was measured in only ${(calibration.scaleCoverage * 100).toFixed(0)}% of the analyzed frames — confidence reduced accordingly.`,
    )
  }

  return {
    metric: 'verticalOscillationCm',
    value: calibration.verticalOscillationCm,
    unit: 'centimeters',
    confidence,
    viewFit: viewFitEntry.fit,
    interpolatedFraction: bounceSignal.interpolatedFraction,
    frameCoverage: bounceSignal.frameCoverage,
    sampleSize: calibration.sampleSize,
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
    calibration,
  }
}
