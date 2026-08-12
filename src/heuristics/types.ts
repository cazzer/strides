/**
 * 'front' means "front-or-back" — no face keypoints exist anywhere in this pipeline (a scope
 * decision made back in #3), so a camera looking at the runner's chest is indistinguishable from
 * one looking at their back from pure limb geometry. Nothing downstream needs the distinction:
 * both orientations equally hide the sagittal-plane signal that trunk lean and overstriding need,
 * and vertical oscillation doesn't care about facing direction at all.
 */
export type View = 'side' | 'front' | 'ambiguous'

export type ViewFit = 'primary' | 'tolerated' | 'unsuitable'

export type MetricId =
  | 'verticalOscillation'
  | 'trunkLean'
  | 'overstriding'
  | 'cadence'
  | 'kneeFlexion'
  | 'armSwingSymmetry'
  | 'footStrikePattern'

export interface ViewDetectionResult {
  view: View
  /** 0..1, confidence in the LABEL itself, not in any downstream metric's output. */
  confidence: number
  diagnostics: {
    bilateralSpreadRatio: number | null
    sagittalExcursionRatio: number | null
    frameCoverage: number
  }
}

export interface MetricResult {
  metric: MetricId
  /** null iff no resolvable input at all (including "resolvable but never produced a complete,
   * well-defined measurement" — see each metric's module for what that means concretely).
   * NEVER NaN. */
  value: number | null
  /** 'ratio'/'degrees' are torso-length- or angle-relative, per the metric that produces them.
   * 'stepsPerMinute' is cadence's own physical unit. 'percent' is a dimensionless 0..1 comparison
   * (currently just armSwingSymmetry's min(left,right)/max(left,right)) that is NOT a fraction of
   * torso length — kept distinct from 'ratio' specifically because `formatValue` in
   * MetricsPanel.tsx bakes "% of torso length" into 'ratio''s formatting, which would misstate a
   * dimensionless ratio. */
  unit: 'ratio' | 'degrees' | 'stepsPerMinute' | 'percent'
  /** 0..1; forced 0 when value is null. */
  confidence: number
  viewFit: ViewFit
  interpolatedFraction: number
  frameCoverage: number
  /** Count of whatever the producing metric aggregates over — the unit differs per metric and is
   * documented in each module (resolvable frames for trunk lean, footstrikes for overstriding and
   * cadence, and, since vertical oscillation moved to a spectral fit, COMPLETE GAIT CYCLES rather
   * than the half-cycles its extrema-pairing predecessor counted). */
  sampleSize: number
  /** Non-null for degraded/low-confidence results across every metric. `footStrikePattern` is the
   * one deliberate exception: it is a proxy (ankle-relative-to-knee position, not a direct
   * foot-angle measurement) even in its cleanest, highest-confidence result, so its `caveat` is
   * ALWAYS non-null — see `footStrikePattern.ts`. */
  caveat: string | null
}

export interface TimeseriesPoint {
  timestamp: number
  /** (hipY - runMeanHipY) / torsoLengthPx, sign-flipped so positive = higher on screen.
   *  null where hip position wasn't resolvable that frame — a real gap, not interpolated for charting. */
  value: number | null
}

/**
 * Diagnostics from the spectral sinusoid fit that produced `VerticalOscillationResult.value` —
 * enough to tell "this clip has a clean, unambiguous bounce rhythm" from "this number came out of
 * a marginal fit" without re-running the estimator. Mirrors `SpectralFitSuccess` from
 * `spectralFit.ts`, minus its discriminant and with the amplitude named in the units it is
 * actually in (raw pixels, before torso normalization).
 */
export interface VerticalOscillationFit {
  /** Winning candidate frequency from the configured grid, Hz. This is BOUNCE frequency — two
   * bounces per gait cycle, so roughly twice stride frequency. */
  frequencyHz: number
  /** Fitted peak-to-peak bounce, in raw image pixels. `value` is this divided by `torsoLengthPx`. */
  peakToPeakAmplitudePx: number
  /** Partial R² of the sinusoid terms over a trend-only baseline — the number
   * `verticalOscillationMinFitR2` gates on and the one that feeds confidence. */
  sinusoidR2: number
  /** R² against the raw hip trace. Diagnostic only: on a drifting clip the trend terms alone can
   * push this near 1 while the oscillation explains almost nothing, and its denominator differs
   * per clip, so it is not comparable across clips and is never gated on. */
  totalR2: number
  /** How well the best frequency outside a resolution-aware band around `frequencyHz` fits,
   * relative to `frequencyHz` itself, in [0, 1]. Reported for diagnosis only — deliberately NOT
   * wired into confidence, since no calibration evidence exists for what value should cost what. */
  secondPeakRatio: number
  /** Frames with a resolvable hip position that the fit was computed over. */
  sampleCount: number
  /** Time from the first to the last resolvable hip sample. */
  spanSeconds: number
  /** `spanSeconds × frequencyHz`, fractional. `sampleSize` is this floored. */
  observedCycles: number
}

export interface VerticalOscillationResult extends MetricResult {
  metric: 'verticalOscillation'
  /** One entry per input RobustPoseFrame, timestamp-aligned 1:1. Empty only when bodyScale was null. */
  series: TimeseriesPoint[]
  /** Non-null exactly when `value` is non-null — a reported value always has a fit behind it, and a
   * fit that failed or fell below the quality gate never yields a value. */
  fit: VerticalOscillationFit | null
}

export interface FormHeuristicsResult {
  view: ViewDetectionResult
  verticalOscillation: VerticalOscillationResult
  trunkLean: MetricResult
  overstriding: MetricResult
  cadence: MetricResult
  kneeFlexion: MetricResult
  armSwingSymmetry: MetricResult
  footStrikePattern: MetricResult
}

export interface HeuristicsConfig {
  /** Bilateral Spread Ratio at/below which a frame votes "side-like" in view detection. */
  sideViewMaxBilateralSpreadRatio: number // 0.30
  /** Bilateral Spread Ratio at/above which a frame votes "front-like" in view detection. */
  frontViewMinBilateralSpreadRatio: number // 0.55
  /** Sagittal Excursion Ratio at/above which a frame votes "side-like". */
  sideViewMinSagittalExcursionRatio: number // 0.8
  /** Sagittal Excursion Ratio at/below which a frame votes "front-like". */
  frontViewMaxSagittalExcursionRatio: number // 0.4
  /** Below this fraction of frames yielding a usable body-scale sample, view detection refuses
   * to commit to any label at all (confidence forced to 0) rather than guessing from too little
   * data. */
  minViewDetectionFrameCoverage: number // 0.4

  /** Lowest candidate bounce frequency for vertical oscillation's spectral fit, in Hz. Hip bounce
   * happens twice per gait cycle, so 1.2 Hz corresponds to a ~72 steps/min shuffle — comfortably
   * below any running cadence, and low enough to leave walking-speed footage detectable rather
   * than silently forcing it onto a faster candidate. */
  spectralFitMinFrequencyHz: number // 1.2
  /** Highest candidate bounce frequency, in Hz — 4.0 corresponds to 240 steps/min, above any
   * sustained human running cadence. Capping here rather than higher keeps the grid from offering
   * candidates that can only be fitting per-frame tracking jitter. */
  spectralFitMaxFrequencyHz: number // 4.0
  /** Candidate-frequency spacing, in Hz. 0.02 over the 1.2-4.0 band is 141 candidates — finer than
   * the frequency resolution any clip of a few seconds actually supports, so the grid is never the
   * limiting factor, and cheap enough that the whole search is sub-millisecond. */
  spectralFitFrequencyStepHz: number // 0.02
  /** Minimum sinusoid PARTIAL R² (against a trend-only baseline, NOT total R²) for a vertical
   * oscillation fit to report a value at all. Below this the metric returns `null` with a caveat
   * rather than a number nobody should act on.
   *
   * **This number is calibrated for sample counts near n ≈ 50 and above**, which is where real
   * clips land (47-81 resolvable hip samples across live verification runs). At n ≈ 50 the measured
   * pure-noise partial R² has p95 ≈ 0.22 and p99 ≈ 0.28, against a worst observed real trial of
   * 0.40 — so 0.30 sits in the gap. The noise floor rises sharply as n falls (measured p95: 0.34 at
   * n=30, 0.44 at n=20, 0.64 at n=12), because two sinusoid parameters explain proportionally more
   * of a shorter series by chance alone. A fixed R² threshold is therefore NOT n-invariant, and any
   * other caller of `fitSpectralSinusoid` operating at low sample counts must set its own policy
   * rather than reusing this value. See the change's design.md for the n-invariant upgrade path. */
  verticalOscillationMinFitR2: number // 0.30
  /** Minimum COMPLETE GAIT CYCLE count below which confidence is penalized via the sampleSize
   * factor. Full cycles, not half-cycles — the spectral estimator fits a whole waveform rather
   * than pairing individual extrema, so its natural sample unit is the cycle. */
  verticalOscillationMinCycles: number // 3

  /** Minimum prominence (as a fraction of torsoLengthPx) for an ankle-y extremum to count as a
   * footstrike — higher than vertical oscillation's because ankle detection is noisier. */
  footstrikeMinProminenceRatio: number // 0.05
  /** Minimum real time between two accepted footstrikes on the same or different leg — below a
   * runner's fastest plausible cadence, a "second" candidate this soon is almost certainly the
   * same footstrike re-detected across a couple of noisy frames. */
  footstrikeMinIntervalSeconds: number // 0.25
  /** Documented, tunable qualitative cutoff for a future "flag if ahead by more than this
   * fraction of torso length" UI treatment — not a clinical threshold. */
  overstrideFlagRatio: number // 0.15

  /** Minimum prominence, in degrees of knee flexion (already scale-free — no torso-length
   * conversion needed, unlike the px-based prominence ratios above), for a per-leg flexion-degrees
   * extremum to count as a real swing-phase peak rather than tracking jitter or stance-phase
   * loading-response noise. */
  kneeFlexionMinProminenceDegrees: number // 20

  /** Minimum prominence (as a fraction of torsoLengthPx) for a wrist-relative-to-shoulder-y
   * extremum to count as a real half-swing rather than tracking jitter. Set to the same 0.03 that
   * hip bounce used before it moved to a spectral fit: arm swing reads a comparable
   * roughly-twice-per-stride vertical excursion, so the same jitter floor applies. */
  armSwingMinProminenceRatio: number // 0.03

  /** Half-width, as a fraction of torsoLengthPx, of the "midfoot" band in `footStrikePattern`'s
   * ankle-relative-to-knee classification: at or within this ratio of the knee (either direction)
   * reads as midfoot; further ahead (in the travel direction) reads as heel, further behind reads
   * as forefoot. See `footStrikePattern.ts` / design.md for why this is symmetric and why 0.05. */
  footStrikeMidfootBandRatio: number // 0.05

  /** Minimum run of consecutive frames with a resolvable shoulder+hip position required to start
   * or end the presence window (`presenceWindow.ts`) — below this, a single spurious detection in
   * an otherwise-empty scene can't anchor the window and pull dead time back into it. A
   * judgment-call threshold, not derived from real footage; cheaply tunable here if it turns out
   * wrong. */
  presenceMinConsecutiveFrames: number // 3

  /** A fully-interpolated input is trusted at this fraction relative to a fully-detected one. */
  interpolationConfidencePenalty: number // 0.5 — fully-interpolated input trusted at 50%

  viewFitTable: Record<
    MetricId,
    Record<View, { fit: ViewFit; multiplier: number }>
  >
}

export const DEFAULT_VIEW_FIT_TABLE: HeuristicsConfig['viewFitTable'] = {
  verticalOscillation: {
    side: { fit: 'primary', multiplier: 1.0 },
    front: { fit: 'tolerated', multiplier: 0.85 },
    ambiguous: { fit: 'tolerated', multiplier: 0.6 },
  },
  trunkLean: {
    side: { fit: 'primary', multiplier: 1.0 },
    front: { fit: 'unsuitable', multiplier: 0.1 },
    ambiguous: { fit: 'unsuitable', multiplier: 0.2 },
  },
  overstriding: {
    side: { fit: 'primary', multiplier: 1.0 },
    front: { fit: 'unsuitable', multiplier: 0.1 },
    ambiguous: { fit: 'unsuitable', multiplier: 0.2 },
  },
  /**
   * Cadence is view-tolerant, like verticalOscillation, NOT hard-gated like trunkLean/overstriding
   * — see `openspec/changes/add-cadence-metric/design.md` for the full reasoning. Short version:
   * cadence only needs footstrike TIMING (ankle-y crossing a local max), a vertical-axis signal
   * that projects onto image-y similarly regardless of facing direction, same as hip-y bounce. It
   * never reads the sagittal (fore-aft) axis that makes trunk lean/overstriding meaningless
   * face-on. Front view still gets a real discount, slightly steeper than vertical oscillation's
   * 0.85: near each footstrike the swing leg's ankle passes close to the stance leg's on screen
   * face-on (an occlusion/crossing risk side view doesn't have, since the legs stay laterally
   * separated on screen throughout the stride), and a missed or spurious extremum here directly
   * biases the countable footstrike total rather than just adding noise to an already-averaged
   * amplitude the way it would for vertical oscillation.
   */
  cadence: {
    side: { fit: 'primary', multiplier: 1.0 },
    front: { fit: 'tolerated', multiplier: 0.8 },
    ambiguous: { fit: 'tolerated', multiplier: 0.6 },
  },
  // Same reasoning as trunkLean/overstriding: the hip-knee-ankle angle is a sagittal-plane
  // quantity foreshortened toward a degenerate reading face-on.
  kneeFlexion: {
    side: { fit: 'primary', multiplier: 1.0 },
    front: { fit: 'unsuitable', multiplier: 0.1 },
    ambiguous: { fit: 'unsuitable', multiplier: 0.2 },
  },
  // Mirror image of trunkLean/overstriding: side view occludes/superimposes the far arm rather
  // than making the swing signal invisible, so side is unsuitable and front is primary here — see
  // `openspec/changes/add-arm-swing-symmetry-metric/design.md` for the full reasoning.
  armSwingSymmetry: {
    front: { fit: 'primary', multiplier: 1.0 },
    side: { fit: 'unsuitable', multiplier: 0.1 },
    ambiguous: { fit: 'unsuitable', multiplier: 0.2 },
  },
  footStrikePattern: {
    side: { fit: 'primary', multiplier: 1.0 },
    front: { fit: 'unsuitable', multiplier: 0.1 },
    ambiguous: { fit: 'unsuitable', multiplier: 0.2 },
  },
}

export const DEFAULT_HEURISTICS_CONFIG: HeuristicsConfig = {
  sideViewMaxBilateralSpreadRatio: 0.3,
  frontViewMinBilateralSpreadRatio: 0.55,
  sideViewMinSagittalExcursionRatio: 0.8,
  frontViewMaxSagittalExcursionRatio: 0.4,
  minViewDetectionFrameCoverage: 0.4,
  spectralFitMinFrequencyHz: 1.2,
  spectralFitMaxFrequencyHz: 4.0,
  spectralFitFrequencyStepHz: 0.02,
  verticalOscillationMinFitR2: 0.3,
  verticalOscillationMinCycles: 3,
  footstrikeMinProminenceRatio: 0.05,
  footstrikeMinIntervalSeconds: 0.25,
  overstrideFlagRatio: 0.15,
  kneeFlexionMinProminenceDegrees: 20,
  armSwingMinProminenceRatio: 0.03,
  footStrikeMidfootBandRatio: 0.05,
  presenceMinConsecutiveFrames: 3,
  interpolationConfidencePenalty: 0.5,
  viewFitTable: DEFAULT_VIEW_FIT_TABLE,
}
