import type { RobustPoseFrame } from '../pose/robustness/types'
import { estimateBodyScale } from './bodyScale'
import { resolveMidpoint } from './keypoints'
import { findLocalExtrema } from './extrema'
import { median } from './mathUtils'

/**
 * Extremum prominence threshold as a fraction of torso length. Inherited from the pixel VO
 * metric's old `verticalOscillationMinProminenceRatio` config default (0.03), which was deleted
 * when that metric moved to a spectral fit — this module is now the only extrema-pairing VO
 * estimator, so the threshold is its private policy (module-constant precedent: see
 * MIN_CADENCE_SAMPLE_SIZE and friends).
 */
const CM_MIN_PROMINENCE_TORSO_RATIO = 0.03

export interface ScaleCalibratedVerticalOscillation {
  /** Median half-cycle bounce amplitude in centimetres; null when no half-cycle was detected. */
  verticalOscillationCm: number | null
  /** Half-cycles that contributed to the median. */
  sampleSize: number
  /** Last measured scale / first measured scale. ~1.0 = fixed camera distance; far from 1.0 means
   * the subject approached or receded, and the figure above is inflated by that translation. */
  scaleDriftRatio: number
  medianPixelsPerMeter: number
  /** torsoLengthPx / medianPixelsPerMeter — a sanity check on the whole calibration: a human
   * torso (shoulder-mid to hip-mid) is roughly 0.5 m, so a wildly different number here means the
   * scale is wrong and the centimetre figure should not be believed. */
  torsoMeters: number | null
  /** Frames carrying a measured scale / frames considered. Frames in a run that was dropped for
   * carrying no scale at all still count in the denominator — a dropped run is visible here as
   * lost coverage rather than silently vanishing. */
  scaleCoverage: number
  /** Independent integration runs that contributed at least one amplitude. Each gap in hip
   * tracking resets integration, so a fragmented clip yields several small runs rather than one. */
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
 * Every measured scale across the whole clip, in frame order — the basis for the median scale
 * (the prominence threshold's unit conversion), the drift ratio, and coverage.
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
 * Converts one run's pixel hip-y series into a cumulative metric series (metres), then reads
 * half-cycle amplitudes off it.
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
function estimateAmplitudes(
  run: IntegrationRun,
  minProminenceMeters: number,
): number[] {
  const scales = fillRunScales(run.scales)
  if (scales === null) return []

  const metricSeries: Array<{ t: number; v: number } | null> = []
  let cumulative = 0
  for (let k = 0; k < run.hipY.length; k += 1) {
    if (k > 0) {
      const stepScale = (scales[k - 1] + scales[k]) / 2
      cumulative += (run.hipY[k - 1] - run.hipY[k]) / stepScale
    }
    metricSeries.push({ t: run.timestamps[k], v: cumulative })
  }

  // Called per run, never over a concatenation of runs: each run's cumulative series restarts at
  // 0, so pairing an extremum from one run with one from another would report the difference
  // between two unrelated baselines as an amplitude. findLocalExtrema does split on nulls, but its
  // output is a flat list with no run labels — the pairing loop below could not tell the two cases
  // apart, so the boundary is enforced here structurally instead.
  const extrema = findLocalExtrema(metricSeries, minProminenceMeters)

  // Pair consecutive opposite-kind extrema into half-cycle amplitudes. Same 5 lines as
  // verticalOscillation.ts's pixel-space pairing, deliberately duplicated rather than shared: the
  // scope differs (one run here, the whole clip there), so a shared helper would need a parameter
  // to distinguish them for no gain.
  const amplitudes: number[] = []
  for (let i = 1; i < extrema.length; i += 1) {
    if (extrema[i].kind === extrema[i - 1].kind) continue
    amplitudes.push(Math.abs(extrema[i].value - extrema[i - 1].value))
  }
  return amplitudes
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
 * Returns `null` when no frame carries a scale (every backend but MediaPipe) — the caller omits
 * the diagnostics key entirely in that case rather than reporting invented nulls.
 */
export function computeVerticalOscillationCm(
  frames: RobustPoseFrame[],
): ScaleCalibratedVerticalOscillation | null {
  const scales = collectScales(frames)
  if (scales.length === 0) return null

  const medianPixelsPerMeter = median(scales)
  const bodyScale = estimateBodyScale(frames)

  // The pixel-space prominence threshold, expressed in metres so it means the same thing against
  // the converted series — which keeps this calculation detecting the same cycles the pixel path
  // detected under a constant scale. Without a body-scale reference there's no threshold to
  // convert, so nothing can be measured.
  //
  // The 0.03 torso-length ratio was `verticalOscillationMinProminenceRatio` until the pixel VO
  // metric moved to a spectral fit and deleted that config key (its extrema path no longer
  // exists). This module still pairs extrema, so the threshold lives on here as its own policy
  // constant rather than resurrecting a config key only one calculation reads.
  const torsoLengthPx = bodyScale?.torsoLengthPx ?? null
  const minProminenceMeters =
    torsoLengthPx === null
      ? null
      : (CM_MIN_PROMINENCE_TORSO_RATIO * torsoLengthPx) / medianPixelsPerMeter

  const runs = buildRuns(frames)
  const amplitudesPerRun =
    minProminenceMeters === null
      ? []
      : runs.map((run) => estimateAmplitudes(run, minProminenceMeters))
  const amplitudes = amplitudesPerRun.flat()

  return {
    verticalOscillationCm: amplitudes.length === 0 ? null : median(amplitudes) * 100,
    sampleSize: amplitudes.length,
    scaleDriftRatio: scales[scales.length - 1] / scales[0],
    medianPixelsPerMeter,
    torsoMeters: torsoLengthPx === null ? null : torsoLengthPx / medianPixelsPerMeter,
    scaleCoverage: scales.length / frames.length,
    integrationRuns: amplitudesPerRun.filter((run) => run.length > 0).length,
  }
}
