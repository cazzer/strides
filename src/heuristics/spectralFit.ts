import { clamp01 } from './mathUtils'

/**
 * Shared spectral sinusoid-fit primitive: given an irregularly-sampled scalar time series, find
 * the dominant oscillation frequency in a configured band and report its peak-to-peak amplitude,
 * plus enough diagnostics for a caller to decide whether the fit is trustworthy.
 *
 * ## The model
 *
 * For each candidate frequency `f` on the configured grid, the least-squares problem
 *
 *   `v ≈ a·sin(2πft) + b·cos(2πft) + c + d·t + e·t²`
 *
 * is solved over every usable sample, and `f*` is the candidate with the smallest residual sum of
 * squares. Reported amplitude is `2·√(a²+b²)` — PEAK-TO-PEAK, not half-amplitude, so it is directly
 * comparable to a "distance between a trough and the next peak" measurement.
 *
 * The `c + d·t + e·t²` terms are not cosmetic: they absorb slow drift in the underlying signal
 * (e.g. a runner approaching the camera, whose whole body creeps up the frame and grows on screen)
 * that would otherwise be charged to the oscillation and inflate its amplitude. A quadratic is the
 * lowest-order trend that can bend, which is as much freedom as is safe to give a model fitted over
 * a handful of cycles — a cubic starts competing with the oscillation itself.
 *
 * ## Why no resampling
 *
 * The obvious alternative — resample onto a uniform grid, then FFT — is wrong for this input.
 * Pose-detection frame timestamps are genuinely irregular (browser frame callbacks, dropped
 * detections, unrecoverable gaps), and any interpolation onto a uniform grid invents signal exactly
 * where the real signal is missing, which is precisely where an amplitude estimate is most fragile.
 * A least-squares fit over the samples that actually exist has no such failure mode: a gap simply
 * contributes no equations. Irregular sampling is the point, not an obstacle to work around first.
 *
 * To be precise about what this does and does not claim: this primitive DOES receive samples the
 * upstream robustness layer already filled in by interpolation — `verticalOscillation` pushes every
 * frame whose hip resolves, `'interpolated'` status included — and it cannot tell those apart from
 * directly-detected ones. Accounting for that trust gap happens on the confidence side, via each
 * caller's `interpolatedFraction`. The no-resampling argument is specifically about UNRECOVERABLE
 * gaps: stretches the robustness layer refused to fill because there was no defensible basis for
 * guessing, which this primitive likewise declines to fill.
 *
 * ## Why normal equations
 *
 * The design matrix has five columns and (in practice) tens to hundreds of rows, and is
 * deliberately well-conditioned before it is ever formed: time is centered at the sample mean and
 * the values are mean-centered, so no column carries a large constant offset that would swamp the
 * others. Under those conditions forming `XᵀX` explicitly and solving the 5×5 system by Gaussian
 * elimination with partial pivoting is exact enough, one short readable pass, and fast — versus
 * pulling in (or hand-rolling) a QR/SVD factorization for a problem that never gets larger than
 * 5 unknowns. Centering is amplitude- and frequency-invariant (`c`/`d`/`e` span the same subspace
 * either way, and a time shift only rotates `a`/`b` into each other), so it is free conditioning
 * insurance rather than a change of model.
 *
 * ## Why the reported quality number is a PARTIAL R²
 *
 * `sinusoidR2` is `1 − RSS(f*) / RSS_trendOnly`, where `RSS_trendOnly` comes from fitting
 * `c + d·t + e·t²` alone — i.e. "how much of what the trend could not explain does the oscillation
 * explain?". Total R² (against the raw values) is reported too, but ONLY as a diagnostic: on a clip
 * with strong drift the trend terms alone can score above 0.98 while the oscillation explains
 * almost nothing, so a total-R² gate would wave through exactly the fits most in need of gating.
 * Total R² is also not comparable between clips, since its denominator depends on how much drift
 * the clip happened to contain.
 *
 * ## Division of responsibility
 *
 * Well-posedness preconditions live here — a sample floor, a "the fitted frequency must complete at
 * least one cycle inside the observed span" rule, and detection of signals with nothing to fit.
 * POLICY (how good an R² is good enough, how many cycles are enough for full confidence) lives in
 * each caller, because different metrics reading different signals warrant different thresholds.
 */

/** Mirrors the `{ t, v }` sample shape `extrema.ts` already uses, deliberately: the two primitives
 * are alternative readings of the same per-frame series, and a caller swapping one for the other
 * should not have to reshape its input. */
export interface SpectralSample {
  t: number
  v: number
}

export interface SpectralFitOptions {
  minFrequencyHz: number
  maxFrequencyHz: number
  frequencyStepHz: number
}

export type SpectralFitFailureReason =
  /** Fewer usable samples than `MIN_SPECTRAL_FIT_SAMPLES`. */
  | 'too-few-samples'
  /** Nothing periodic to fit: a constant trace, a pure trend the polynomial terms already explain
   * exactly, a zero-length time span, or a system too singular to solve. */
  | 'degenerate-signal'
  /** The winning frequency does not complete a full cycle inside the observed span. */
  | 'insufficient-cycles'

export interface SpectralFitSuccess {
  ok: true
  /** `2·√(a²+b²)` in the input's own units — PEAK-TO-PEAK, not half-amplitude. */
  peakToPeakAmplitude: number
  /** The winning grid frequency, Hz. */
  frequencyHz: number
  /** Partial R² of the sinusoid terms over a trend-only baseline. THE quality number: this is what
   * a caller should gate on. */
  sinusoidR2: number
  /** R² against the raw values, trend included. Diagnostic only — not comparable across clips. */
  totalR2: number
  /** How well the best frequency OUTSIDE a resolution-aware exclusion band around `f*` explains the
   * signal, relative to `f*` itself, in [0, 1]. Near 0 means one unambiguous rhythm; approaching 1
   * means a competing rhythm fits nearly as well and `frequencyHz` should not be over-trusted. */
  secondPeakRatio: number
  /** Usable samples the fit was computed over (non-finite input dropped). */
  sampleCount: number
  /** `max(t) − min(t)` over usable samples. */
  spanSeconds: number
  /** `spanSeconds × frequencyHz` — fractional, not rounded. */
  observedCycles: number
  /**
   * Phase `φ = atan2(b, a)` of the fitted oscillation, radians in `(−π, π]`. Together with
   * `tMeanSeconds` this is what makes a fitted extremum nameable in clock time: the sinusoid
   * component is `√(a²+b²)·sin(ω·(t − tMeanSeconds) + φ)` with `ω = 2π·frequencyHz`, so its
   * maxima sit at `tMeanSeconds + (π/2 − φ)/ω + k/frequencyHz` and its minima half a period away.
   *
   * Reported because `peakToPeakAmplitude` collapses `a` and `b` into a magnitude and throws the
   * direction away — WHEN the oscillation peaks is not recoverable from any other reported field.
   * Says nothing about which body position a maximum corresponds to: that depends entirely on the
   * sign convention of the series the caller fitted, and this primitive never sees one.
   */
  phaseRadians: number
  /**
   * The sample-mean time the fit was centred on (see the module doc on conditioning). Phase is
   * measured from HERE, not from zero, so a caller reconstructing an instant must add it back.
   */
  tMeanSeconds: number
}

export interface SpectralFitFailure {
  ok: false
  reason: SpectralFitFailureReason
  sampleCount: number
  spanSeconds: number
}

export type SpectralFitResult = SpectralFitSuccess | SpectralFitFailure

/**
 * Below this, the fit is not merely noisy but actively dangerous: with five free parameters, a
 * handful of samples can be near-interpolated exactly, which yields R² ≈ 1 alongside a wildly
 * extrapolated amplitude (measured: peak-to-peak 422 recovered from a ±1 signal at n = 5). No
 * quality gate downstream can catch that, because the fit genuinely is perfect — the only defense
 * is refusing to fit at all. 12 leaves at least 7 residual degrees of freedom.
 */
const MIN_SPECTRAL_FIT_SAMPLES = 12

/**
 * Half-width of the exclusion band around `f*` when looking for a competing peak. Two grid
 * frequencies a hairsbreadth apart are the same peak sampled twice, not competitors, so the band
 * has to be wide enough to step off the winner's own shoulder. Widened to `1 / spanSeconds` on
 * short clips, since frequency resolution is bounded by observation length no matter how fine the
 * grid is.
 */
const SECOND_PEAK_MIN_BAND_HZ = 0.4

/**
 * Relative floor for "the trend model already explains everything". Absolute epsilons are useless
 * here — the residuals carry the units of the input signal, so a pixel-space trace and a
 * torso-normalized one would need different constants. Scaling against the total sum of squares
 * makes the test unit-free.
 */
const DEGENERACY_RELATIVE_FLOOR = 1e-9

/** Pivot magnitude below which the system is treated as singular, relative to the largest entry in
 * the matrix — same reasoning as `DEGENERACY_RELATIVE_FLOOR`, applied to the linear solve. */
const PIVOT_RELATIVE_FLOOR = 1e-12

/**
 * Gaussian elimination with partial pivoting for the small dense systems this module forms (3×3 for
 * the trend-only baseline, 5×5 per grid point). Private to this file rather than promoted to
 * `mathUtils.ts` on purpose: it exists to serve exactly one caller with exactly one conditioning
 * story (pre-centered normal equations), and a general-purpose linear solver in a shared module
 * would invite use on systems where normal equations are the wrong approach.
 *
 * Returns `null` — never a NaN-laden vector — when the system is singular to within the relative
 * pivot floor.
 */
function solveLinearSystem(
  matrix: readonly (readonly number[])[],
  rhs: readonly number[],
): number[] | null {
  const n = rhs.length
  // Augmented copy: callers reuse their accumulator arrays across grid points.
  const a = matrix.map((row, i) => [...row, rhs[i]])

  let largest = 0
  for (const row of a) {
    for (let c = 0; c < n; c += 1) largest = Math.max(largest, Math.abs(row[c]))
  }
  if (!(largest > 0)) return null
  const pivotFloor = largest * PIVOT_RELATIVE_FLOOR

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

interface LeastSquaresFit {
  coefficients: number[]
  rss: number
}

/**
 * Ordinary least squares of `y` on the given basis columns, via normal equations. RSS is computed
 * from actual residuals rather than the algebraic `yᵀy − βᵀXᵀy` shortcut — the shortcut is a
 * difference of two nearly-equal large numbers whenever the fit is good, and can land slightly
 * negative, which would poison every R² downstream.
 */
function solveLeastSquares(
  columns: readonly Float64Array[],
  y: Float64Array,
): LeastSquaresFit | null {
  const k = columns.length
  const n = y.length

  const matrix: number[][] = Array.from({ length: k }, () =>
    new Array<number>(k).fill(0),
  )
  const rhs = new Array<number>(k).fill(0)

  for (let i = 0; i < k; i += 1) {
    const ci = columns[i]
    let dot = 0
    for (let s = 0; s < n; s += 1) dot += ci[s] * y[s]
    rhs[i] = dot
    for (let j = i; j < k; j += 1) {
      const cj = columns[j]
      let entry = 0
      for (let s = 0; s < n; s += 1) entry += ci[s] * cj[s]
      matrix[i][j] = entry
      matrix[j][i] = entry
    }
  }

  const coefficients = solveLinearSystem(matrix, rhs)
  if (coefficients === null) return null

  let rss = 0
  for (let s = 0; s < n; s += 1) {
    let predicted = 0
    for (let i = 0; i < k; i += 1) predicted += coefficients[i] * columns[i][s]
    const residual = y[s] - predicted
    rss += residual * residual
  }

  return Number.isFinite(rss) ? { coefficients, rss } : null
}

function failure(
  reason: SpectralFitFailureReason,
  sampleCount: number,
  spanSeconds: number,
): SpectralFitFailure {
  return { ok: false, reason, sampleCount, spanSeconds }
}

/**
 * Fits `v ≈ a·sin(2πft) + b·cos(2πft) + c + d·t + e·t²` over the supplied samples for every
 * frequency on the grid `[minFrequencyHz, maxFrequencyHz]` stepped by `frequencyStepHz`, and
 * reports the best-fitting one. See the module doc comment for the method and its rationale.
 *
 * Samples with a non-finite `t` or `v` are dropped before anything else, including before the
 * sample-count check — a caller passing a partly-unresolvable series gets a verdict about the data
 * that actually exists. Sample order does not affect the result (the samples are sorted by
 * timestamp internally), and nothing is ever resampled or interpolated.
 */
export function fitSpectralSinusoid(
  samples: ReadonlyArray<SpectralSample>,
  options: SpectralFitOptions,
): SpectralFitResult {
  const usable = samples
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.v))
    .sort((a, b) => a.t - b.t)

  const sampleCount = usable.length
  const spanSeconds =
    sampleCount === 0 ? 0 : usable[sampleCount - 1].t - usable[0].t

  if (sampleCount < MIN_SPECTRAL_FIT_SAMPLES) {
    return failure('too-few-samples', sampleCount, spanSeconds)
  }
  if (!(spanSeconds > 0)) {
    return failure('degenerate-signal', sampleCount, spanSeconds)
  }

  const { minFrequencyHz, maxFrequencyHz, frequencyStepHz } = options
  if (
    !(frequencyStepHz > 0) ||
    !(minFrequencyHz > 0) ||
    !(maxFrequencyHz >= minFrequencyHz)
  ) {
    return failure('degenerate-signal', sampleCount, spanSeconds)
  }

  // Center time at the sample mean and values at their mean — see the module doc comment on why
  // this is conditioning insurance and not a change of model.
  let tSum = 0
  let vSum = 0
  for (const sample of usable) {
    tSum += sample.t
    vSum += sample.v
  }
  const tMean = tSum / sampleCount
  const vMean = vSum / sampleCount

  const centeredValues = new Float64Array(sampleCount)
  const ones = new Float64Array(sampleCount)
  const linear = new Float64Array(sampleCount)
  const quadratic = new Float64Array(sampleCount)
  let totalSumOfSquares = 0
  for (let i = 0; i < sampleCount; i += 1) {
    const t = usable[i].t - tMean
    const v = usable[i].v - vMean
    centeredValues[i] = v
    ones[i] = 1
    linear[i] = t
    quadratic[i] = t * t
    totalSumOfSquares += v * v
  }

  const trendOnly = solveLeastSquares(
    [ones, linear, quadratic],
    centeredValues,
  )
  if (trendOnly === null) {
    return failure('degenerate-signal', sampleCount, spanSeconds)
  }
  // A trend model that already explains everything leaves no residual for a sinusoid to explain,
  // and `1 − RSS/RSS_trendOnly` would be 0/0. Covers a flat trace (both sides zero), a pure ramp,
  // and a pure parabola. Compared relatively, never against an absolute epsilon, because the
  // residuals carry the input's units.
  if (!(trendOnly.rss > totalSumOfSquares * DEGENERACY_RELATIVE_FLOOR)) {
    return failure('degenerate-signal', sampleCount, spanSeconds)
  }

  const sineColumn = new Float64Array(sampleCount)
  const cosineColumn = new Float64Array(sampleCount)
  const fullBasis = [sineColumn, cosineColumn, ones, linear, quadratic]

  const gridSize =
    Math.floor((maxFrequencyHz - minFrequencyHz) / frequencyStepHz + 1e-9) + 1
  const frequencies: number[] = []
  // Sum of squares the sinusoid terms explain on top of the trend, per candidate. Non-negative by
  // construction (adding columns can only reduce RSS), which is what makes `secondPeakRatio` a
  // genuine [0, 1] quantity rather than something that needs clamping to look like one.
  const explained: number[] = []

  let bestIndex = -1
  let bestFit: LeastSquaresFit | null = null

  for (let g = 0; g < gridSize; g += 1) {
    const frequency = minFrequencyHz + g * frequencyStepHz
    const omega = 2 * Math.PI * frequency
    for (let i = 0; i < sampleCount; i += 1) {
      const t = linear[i]
      sineColumn[i] = Math.sin(omega * t)
      cosineColumn[i] = Math.cos(omega * t)
    }

    const fit = solveLeastSquares(fullBasis, centeredValues)
    if (fit === null) continue

    frequencies.push(frequency)
    explained.push(Math.max(0, trendOnly.rss - fit.rss))
    if (bestFit === null || fit.rss < bestFit.rss) {
      bestFit = fit
      bestIndex = frequencies.length - 1
    }
  }

  if (bestFit === null || bestIndex < 0) {
    return failure('degenerate-signal', sampleCount, spanSeconds)
  }

  const [a, b] = bestFit.coefficients
  const peakToPeakAmplitude = 2 * Math.hypot(a, b)
  if (!Number.isFinite(peakToPeakAmplitude)) {
    return failure('degenerate-signal', sampleCount, spanSeconds)
  }

  const frequencyHz = frequencies[bestIndex]
  const observedCycles = spanSeconds * frequencyHz
  if (observedCycles < 1) {
    return failure('insufficient-cycles', sampleCount, spanSeconds)
  }

  const exclusionBandHz = Math.max(SECOND_PEAK_MIN_BAND_HZ, 1 / spanSeconds)
  let bestCompetitor = 0
  for (let g = 0; g < frequencies.length; g += 1) {
    if (Math.abs(frequencies[g] - frequencyHz) < exclusionBandHz) continue
    bestCompetitor = Math.max(bestCompetitor, explained[g])
  }
  const bestExplained = explained[bestIndex]
  const secondPeakRatio =
    bestExplained > 0 ? clamp01(bestCompetitor / bestExplained) : 0

  return {
    ok: true,
    peakToPeakAmplitude,
    frequencyHz,
    sinusoidR2: clamp01(1 - bestFit.rss / trendOnly.rss),
    totalR2: clamp01(1 - bestFit.rss / totalSumOfSquares),
    secondPeakRatio,
    sampleCount,
    spanSeconds,
    observedCycles,
    // Reported, not re-derived: `a` and `b` are the same two coefficients `peakToPeakAmplitude`
    // was formed from, read once here before they go out of scope.
    phaseRadians: Math.atan2(b, a),
    tMeanSeconds: tMean,
  }
}
