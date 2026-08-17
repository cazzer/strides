import type { KeypointName } from '../pose/types'
import type { SpectralFitFailureReason } from './spectralFit'

/**
 * 'front' means "front-or-back" — no face keypoints exist anywhere in this pipeline (a scope
 * decision made back in #3), so a camera looking at the runner's chest is indistinguishable from
 * one looking at their back from pure limb geometry. Nothing downstream needs the distinction:
 * both orientations equally hide the sagittal-plane signal that trunk lean and overstriding need,
 * and vertical oscillation doesn't care about facing direction at all.
 */
export type View = 'side' | 'front' | 'ambiguous'

/**
 * Which bilateral-pair midpoint vertical oscillation fits its spectral sinusoid against.
 * `'hipMid'` (the pelvis, via `left_hip`/`right_hip`) is the default and the metric's original,
 * validated signal — a genuine center-of-mass proxy, and what `verticalOscillationCm`'s
 * calibrated centimetre figure is anchored to regardless of this setting. `'earMid'` (the head,
 * via `left_ear`/`right_ear`) reads a physically different quantity — head bounce, damped
 * roughly 0.80–0.92x relative to the pelvis (epic #27's integration-level A/B) — not a
 * center-of-mass proxy at all, but measured more stable run-to-run on both evaluated clips.
 *
 * Selection is per-run, not per-frame: `verticalOscillation.ts` resolves ONE pair for the whole
 * clip and never falls back to the other signal on a frame where the configured one is
 * unresolvable — see `verticalOscillation.ts`'s module doc for why a per-frame fallback would
 * corrupt the fit. Within the chosen signal, `resolveMidpoint`'s existing tolerant single-side
 * fallback still applies (one ear, or one hip, standing in for its pair when only one side
 * resolves), same as every other bilateral-pair signal in this package.
 *
 * Nothing else reads this: cadence stays pinned to `hipMid` regardless of this setting (see
 * `cadence.ts`'s module doc), and `verticalOscillationCm` ignores it and stays hip-based
 * unconditionally — that calculation does take a `HeuristicsConfig`, but reads it only for the
 * shared spectral frequency grid, never for signal selection.
 */
export type VerticalOscillationSignal = 'hipMid' | 'earMid'

export type ViewFit = 'primary' | 'tolerated' | 'unsuitable'

export type MetricId =
  | 'verticalOscillation'
  | 'verticalRatio'
  | 'verticalOscillationCm'
  | 'trunkLean'
  | 'overstriding'
  | 'cadence'
  | 'kneeFlexion'
  | 'armSwingSymmetry'
  | 'footStrikePattern'
  | 'stepWidth'
  | 'stepWidthCm'

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

/**
 * What an exemplar depicts, in the terms of the metric that emitted it — enough for presentation
 * code to caption it, and the discriminator for the one metric whose two exemplars answer
 * different questions (`verticalRatio`'s numerator versus its denominator). Deliberately named
 * per-measurement rather than "footstrike"/"frame": three different metrics can pick the same
 * instant for three different reasons, and a caption has to say which reason it is.
 *
 * Members are added by the metric that needs them — `armSwingSymmetry` adds its own when it
 * starts emitting.
 */
export type MetricExemplarKind =
  | 'kneeFlexionPeak'
  | 'overstrideRange'
  | 'footStrike'
  | 'stepWidthStrike'
  | 'trunkLeanRange'
  /** One bounce half-cycle — the highest and lowest points of the fitted vertical oscillation,
   * shared by `verticalOscillation`, `verticalOscillationCm` and `verticalRatio`'s NUMERATOR
   * (all three read the same shape of fit). `cadence` reads that fit too and deliberately emits
   * nothing: a rate is a property of a sequence, and these two stills depict an amplitude. */
  | 'bounceCycle'
  /** One arm-swing half-cycle — the wrist at its highest and its lowest, on ONE side. Two of these
   * (one per arm) is what makes `armSwingSymmetry` legible: the comparison IS the evidence. */
  | 'armSwingCycle'
  /** One stride — two consecutive same-side footstrikes, the interval whose hip-mid horizontal
   * displacement is `verticalRatio`'s DENOMINATOR. Distinct from `'bounceCycle'`, which is that
   * same metric's numerator: `verticalRatio` is the one metric whose two exemplars answer
   * different questions, and this pair is the discriminator a caption reads. */
  | 'stridePair'

/**
 * One renderable piece of evidence for a metric: either a single instant, or a ghosted PAIR of
 * two instants blended into one image. A pair counts as ONE exemplar, because it produces one
 * image.
 */
export interface MetricExemplar {
  kind: MetricExemplarKind
  /**
   * Seconds on the clip's own media clock — the same clock `RobustPoseFrame.timestamp` carries.
   * On a ghosted pair this is the BASE instant: the one that most directly corresponds to the
   * reported value.
   *
   * **There is deliberately no frame-index field on this type, not even an optional one.**
   * Heuristics run over the presence-TRIMMED frame array while the rest of the app holds the
   * UNTRIMMED one, so an index produced here is off by however many leading frames the presence
   * trim removed — which is `0` on a clip where the subject is present from frame one, and
   * non-zero on precisely the clips this evidence is most useful for. `trimToPresenceWindow`
   * slices the same `RobustPoseFrame` OBJECTS, so a timestamp is valid on both sides of that
   * boundary and an index is not.
   */
  timestamp: number
  /** The GHOST instant, when this exemplar depicts a two-instant range or comparison. ABSENT —
   * not null — on a single-instant exemplar, so "this metric only exists at one moment" never
   * reads as "half a pair went missing". */
  pairedTimestamp?: number
  /** Present only where the metric measures per side, and only when both instants of a pair share
   * that side — omitted on `stepWidth`'s deliberately opposite-side pair. */
  side?: 'left' | 'right'
  /** 0..1, from `exemplars.ts`'s shared gate. Never below `MIN_EXEMPLAR_QUALITY`. */
  quality: number
  /** Short human-readable caption seed, naming what the picture shows. */
  label: string
  /** The keypoints whose positions define the region of the frame this exemplar is about — named
   * by the metric that measured them, never re-derived downstream from `MetricId`, so knowledge
   * of what a metric measured stays in the module that measures it. */
  cropKeypoints: KeypointName[]
}

export interface MetricResult {
  metric: MetricId
  /** null iff no resolvable input at all (including "resolvable but never produced a complete,
   * well-defined measurement" — see each metric's module for what that means concretely).
   * NEVER NaN. */
  value: number | null
  /** 'ratio'/'degrees' are torso-length- or angle-relative, per the metric that produces them.
   * 'stepsPerMinute' is cadence's own physical unit. 'percent' is a dimensionless 0..1 comparison
   * that is NOT a fraction of torso length — kept distinct from 'ratio' specifically because
   * `formatValue` in MetricsPanel.tsx bakes "% of torso length" into 'ratio''s formatting, which
   * would misstate a dimensionless ratio. Two metrics use it: armSwingSymmetry's
   * min(left,right)/max(left,right), and verticalRatio's bounce/strideLength (both pixel-space
   * ratios where real-world scale cancels — see verticalRatio.ts's module doc). 'centimeters'
   * (American spelling, matching every identifier in this codebase that names the unit) is an
   * ABSOLUTE physical quantity with no denominator at all — unlike every other unit here, it is
   * not relative to torso length, stride length, or anything else about the runner's own body.
   * `verticalOscillationCm` and `stepWidthCm` are its only producers. */
  unit: 'ratio' | 'degrees' | 'stepsPerMinute' | 'percent' | 'centimeters'
  /** 0..1; forced 0 when value is null. */
  confidence: number
  viewFit: ViewFit
  interpolatedFraction: number
  frameCoverage: number
  /** Count of whatever the producing metric aggregates over — the unit differs per metric and is
   * documented in each module (resolvable frames for trunk lean, footstrikes for overstriding).
   * Vertical oscillation and cadence both read the shared hip-bounce spectral fit
   * (`hipBounce.ts`) and report complete BOUNCE cycles observed — one bounce per STEP, i.e. HALF
   * a full gait cycle, not a full gait cycle itself. For cadence specifically that count is
   * directly a step count, not a footstrike-detection count the way it was before this metric
   * moved off `detectFootstrikes`. Neither metric counts the half-BOUNCE-cycles an older
   * extrema-pairing estimator used to report. Vertical ratio's numerator reads that same shared
   * fit, but its own `sampleSize` is NOT the bounce-cycle count — it's the stride-PAIR count from
   * its own `estimateStrideLength` extractor (same-side consecutive-footstrike pairs), the sample
   * its median (the ratio's denominator) actually aggregates over — see `verticalRatio.ts`. */
  sampleSize: number
  /** Non-null for degraded/low-confidence results across every metric. `footStrikePattern` is the
   * one deliberate exception: it is a proxy (ankle-relative-to-knee position, not a direct
   * foot-angle measurement) even in its cleanest, highest-confidence result, so its `caveat` is
   * ALWAYS non-null — see `footStrikePattern.ts`. */
  caveat: string | null
  /** The instants that produced this result, ranked by `quality` and capped at
   * `MAX_EXEMPLARS_PER_METRIC` (`exemplars.ts`). ABSENT — never an empty array — when nothing
   * cleared the quality gate, and absent by design for `cadence`, which is a property of a
   * sequence rather than of any pair of instants. Emitting exemplars never moves `value`,
   * `confidence`, `viewFit`, `interpolatedFraction`, `frameCoverage`, `sampleSize` or `caveat`. */
  exemplars?: MetricExemplar[]
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

/**
 * Why `verticalOscillationCm` reported no amplitude. The three `SpectralFitFailureReason` values
 * come straight from the shared primitive's well-posedness rules; the two added here are this
 * calculation's own policy (`'below-quality-gate'`) and its "there was nothing to fit in the
 * first place" case (`'no-usable-run'` — no integration run, or every run carried no scale at
 * all). Moved here from `verticalOscillationCm.ts` (D7) alongside `ScaleCalibratedFit` and
 * `ScaleCalibratedVerticalOscillation` so that `VerticalOscillationCmResult` — which every
 * consumer of `FormHeuristicsResult` sees, not just `verticalOscillationCm.ts` itself — can
 * reference the calibration shape without importing the policy module; the mechanics that PRODUCE
 * a `ScaleCalibratedVerticalOscillation` remain in `verticalOscillationCm.ts` (D8), which stays
 * this type's only producer.
 */
export type ScaleCalibratedFitFailureReason =
  | SpectralFitFailureReason
  | 'below-quality-gate'
  | 'no-usable-run'

/**
 * The spectral fit behind `verticalOscillationCm`. Mirrors `VerticalOscillationFit` above field
 * for field, with the amplitude named for the unit it is actually in — so the pixel-path and
 * centimetre-path diagnostics read the same way side by side.
 *
 * Every field describes ONE contributing run's fit, never a blend across runs (see
 * `verticalOscillationCm.ts`'s `selectWeightedMedianFit`): an averaged amplitude paired with an
 * averaged fit quality would describe a fit that never happened.
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
  /** Partial R² of the sinusoid terms over a trend-only baseline — the number
   * `verticalOscillationMinFitR2` gates on (reused verbatim; see that key's doc — D3). */
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
   * `verticalOscillationMinFitR2`'s doc on the n-regime caveat. */
  sampleCount: number
  /** Time from the winning run's first to its last sample. */
  spanSeconds: number
  /** `spanSeconds × frequencyHz`, fractional, for the winning run alone. `sampleSize` is the
   * floor of the SUM of this across all contributing runs (floor once, after summing — two runs
   * at 1.6 cycles each report 3, not 2). */
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
   * extrema-pairing estimator reported here. `Math.floor(observedCycles)` — see that field for
   * the unfloored value. */
  sampleSize: number
  /** `spanSeconds × frequencyHz` summed across every contributing run, FRACTIONAL — `sampleSize`
   * above is this floored once, after summing (two runs at 1.6 cycles each report `sampleSize: 3`,
   * but `observedCycles: 3.2`). Exists so confidence (`computeVerticalOscillationCmMetric`, D2)
   * can read the unrounded count — mirroring `VerticalOscillationFit.observedCycles`'s own
   * fractional-vs-floored split, one level up because this calculation sums across runs where the
   * pixel-path metric has only one fit to begin with. Flooring before this point would turn a
   * difference smaller than the fit's own frequency resolution into a confidence cliff (see
   * `verticalOscillation.ts`'s identical reasoning on its own `sampleSize`/`fit.observedCycles`
   * split). */
  observedCycles: number
  /** The fit the reported amplitude came from. Non-null exactly when `verticalOscillationCm` is. */
  fit: ScaleCalibratedFit | null
  /** Why no amplitude was reported. Non-null exactly when `verticalOscillationCm` is null — a
   * measured-but-unfittable clip names its reason rather than reporting an unexplained null. */
  fitFailureReason: ScaleCalibratedFitFailureReason | null
  /** Last measured scale / first measured scale. ~1.0 = fixed camera distance; far from 1.0 means
   * the subject approached or receded. That translation is absorbed by the fit's trend terms
   * rather than charged to the amplitude — so this is a note about the footage, not a warning that
   * the figure above is inflated. */
  scaleDriftRatio: number
  medianPixelsPerMeter: number
  /** torsoLengthPx / medianPixelsPerMeter — a sanity check on the whole calibration: a human
   * torso (shoulder-mid to hip-mid) is roughly 0.5 m, so a wildly different number here means the
   * scale is wrong and the centimetre figure should not be believed. Null when no body-scale
   * reference resolves, which does not suppress the measurement: it is only ever a check, and the
   * amplitude estimator does not need it as an input. */
  torsoMeters: number | null
  /** Frames carrying a measured scale / frames considered. Frames in a run that was dropped for
   * carrying no scale at all still count in the denominator — a dropped run is visible here as
   * lost coverage rather than silently vanishing. */
  scaleCoverage: number
  /** Independent integration runs that contributed a fit. Each gap in hip tracking resets
   * integration, so a fragmented clip yields several small runs rather than one. */
  integrationRuns: number
}

export interface VerticalOscillationCmResult extends MetricResult {
  metric: 'verticalOscillationCm'
  /** Non-null iff the input carried a measured real-world scale (today: MediaPipe Pose
   * Landmarker's `pixelsPerMeter`) — i.e. iff `computeVerticalOscillationCm` returned non-null.
   * The richer diagnostics-only shape this metric derives from, carried alongside the plain
   * `MetricResult` fields rather than duplicated into them; see `verticalOscillationCm.ts`'s
   * `computeVerticalOscillationCmMetric` (D1) for the single point that computes it and the exact
   * reference this field carries forward — `AnalysisDiagnostics.scaleCalibration` (D1b) is this
   * same object, by reference, never a second computation. */
  calibration: ScaleCalibratedVerticalOscillation | null
}

export interface FormHeuristicsResult {
  view: ViewDetectionResult
  verticalOscillation: VerticalOscillationResult
  verticalRatio: MetricResult
  verticalOscillationCm: VerticalOscillationCmResult
  trunkLean: MetricResult
  overstriding: MetricResult
  cadence: MetricResult
  kneeFlexion: MetricResult
  armSwingSymmetry: MetricResult
  footStrikePattern: MetricResult
  stepWidth: MetricResult
  stepWidthCm: MetricResult
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

  /** Lowest candidate bounce frequency for the SHARED hip-bounce spectral fit
   * (`hipBounce.ts`'s `analyzeHipBounce`, consumed by both vertical oscillation and cadence), in
   * Hz. Hip bounce happens twice per gait cycle — once per STEP — so 1.2 Hz corresponds to a ~72
   * steps/min shuffle (`1.2 × 60`) — comfortably below any running cadence, and low enough to
   * leave walking-speed footage detectable rather than silently forcing it onto a faster
   * candidate. */
  spectralFitMinFrequencyHz: number // 1.2
  /** Highest candidate bounce frequency, in Hz, for the shared hip-bounce spectral fit — 4.0
   * corresponds to 240 steps/min (`4.0 × 60`), above any sustained human running cadence. Capping
   * here rather than higher keeps the grid from offering candidates that can only be fitting
   * per-frame tracking jitter. */
  spectralFitMaxFrequencyHz: number // 4.0
  /** Candidate-frequency spacing, in Hz, for the shared hip-bounce spectral fit. 0.02 over the
   * 1.2-4.0 band is 141 candidates — finer than the frequency resolution any clip of a few
   * seconds actually supports (0.02 Hz = 1.2 steps/min), so the grid is never the limiting
   * factor, and cheap enough that the whole search is sub-millisecond. */
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
   * rather than reusing this value. See the change's design.md for the n-invariant upgrade path.
   *
   * `cadenceMinFitR2` (below) reuses this exact calibration at the exact same value, because
   * cadence's fit reads the IDENTICAL hip-mid series at the IDENTICAL sample count — see that
   * key's own doc for why the reuse is sound there specifically and not a general license to reuse
   * this number at other sample counts.
   *
   * **Third consumer, as of #36: `verticalOscillationCm`.** That calculation's amplitude comes
   * from fitting the identical spectral primitive to the identical hip-mid samples — just
   * converted to metres per frame before fitting rather than left in pixels — so the fit's
   * `sinusoidR2` is unchanged by the conversion (an affine rescaling of the fitted series moves
   * only the amplitude, never the partial-R² ratio; verified live: 0.4860 pixel-path vs. 0.4886
   * centimetre-path on the same real clip, within noise). Reusing this key rather than adding a
   * `verticalOscillationCmMinFitR2` follows the same reasoning `cadenceMinFitR2`'s doc gives, one
   * level stricter: gating the SAME fitted amplitude (not just the same series) behind two
   * independently-tunable thresholds would let the three vertical-oscillation-family metrics
   * disagree about whether an identical fit is trustworthy — incoherent, since they're reporting
   * the same bounce through three different denominators (D6). Replaced the calculation's former
   * private `CM_MIN_FIT_R2` module constant (D3) — that constant duplicated this exact value
   * rather than reusing it, which was sound only as long as `verticalOscillationCm` stayed a
   * diagnostics-only calculation nothing but a dev harness ever gated on; now that it backs a
   * rendered `MetricId`, two gates on the identical amplitude would be exactly the incoherence
   * this doc warns about. */
  verticalOscillationMinFitR2: number // 0.30
  /** Minimum sinusoid PARTIAL R² for cadence's hip-bounce fit (`hipBounce.ts`) to report a value.
   * Same quantity, same gating discipline, and the same default as `verticalOscillationMinFitR2`
   * — deliberately not a separate tuned constant, because cadence and vertical oscillation fit the
   * IDENTICAL hip-mid series (`analyzeHipBounce` is called independently by each, over the same
   * frames, producing a bit-identical fit) at the IDENTICAL sample count, so
   * `verticalOscillationMinFitR2`'s calibration — 2000-seed pure-noise floor (p95 ≈ 0.22 at n=50)
   * against a worst observed real trial of 0.397 — transfers exactly rather than needing its own
   * derivation.
   *
   * **This calibration is n-dependent and does NOT transfer to a caller operating at a different
   * sample count.** The pure-noise floor climbs steeply as n falls (measured p95: 0.34 at n=30,
   * 0.44 at n=20, 0.64 at n=12) — 0.30 is safe here only because cadence, like vertical
   * oscillation, operates at n ≈ 50+ in live footage (the same frames, hence the same resolvable-
   * hip count). A future n-invariant replacement (an F-test on the fit's 2 sinusoid degrees of
   * freedom against its residual degrees of freedom) would replace BOTH this key and
   * `verticalOscillationMinFitR2` together, not just one — deliberately not implemented here, see
   * the `derive-cadence-from-step-frequency` change's design.md. */
  cadenceMinFitR2: number // 0.30
  /** Minimum complete BOUNCE CYCLE count below which confidence is penalized via the sampleSize
   * factor — one bounce cycle is one STEP, HALF a full gait cycle, not a full gait cycle itself.
   * Full bounce cycles, not half-bounce-cycles — the spectral estimator fits a whole waveform
   * rather than pairing individual extrema, so its natural sample unit is the cycle. Cadence has its own,
   * higher minimum (`MIN_CADENCE_STEPS` in `cadence.ts`) rather than reusing this one — despite
   * both metrics now reading the same hip-bounce fit, cadence needs more cycles for adequate
   * FREQUENCY precision (a spectral estimator's frequency resolution improves with the SQUARE of
   * observation time) where vertical oscillation only needs enough for a stable AMPLITUDE
   * estimate — see `cadence.ts`'s doc on `MIN_CADENCE_STEPS` for the full reasoning. Documented at
   * both sites deliberately, so the two minimums aren't "simplified" into one shared constant
   * without re-deriving why they differ. */
  verticalOscillationMinCycles: number // 3

  /** Which bilateral-pair midpoint vertical oscillation fits its spectral sinusoid against — see
   * `VerticalOscillationSignal`'s own doc for the full semantic tradeoff. Defaults to `'hipMid'`,
   * decided by a pre-registered rule against a live integration-level A/B — see
   * `openspec/changes/widen-keypoints-selectable-vo-signal/design.md` for the numbers and the
   * rule as written. Affects `verticalOscillation` ONLY: cadence stays hip-pinned regardless
   * (`cadence.ts`), and `verticalOscillationCm` ignores this key and stays hip-based
   * unconditionally. `verticalOscillationCm` DOES read this `HeuristicsConfig` — for the shared
   * spectral frequency GRID (`spectralFitMinFrequencyHz`/`spectralFitMaxFrequencyHz`/
   * `spectralFitFrequencyStepHz`) and, as of #36, the shared quality GATE
   * (`verticalOscillationMinFitR2`) — but this specific key, signal SELECTION, is the one setting
   * on the config object it never consults. */
  verticalOscillationSignal: VerticalOscillationSignal // 'hipMid'

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
  /**
   * Argued from stride OBSERVABILITY, not copied from trunkLean's/overstriding's identical-
   * looking numbers (though they land the same) — see
   * `openspec/changes/add-vertical-ratio-metric/design.md` D4 for the full reasoning. The
   * numerator (hip bounce, from the same fit `verticalOscillation` uses) is view-TOLERANT; the
   * denominator (stride length, a fore-aft/sagittal displacement) is not — it foreshortens toward
   * zero away from a side-on camera angle, which INFLATES the ratio (a shrunk denominator) rather
   * than just adding noise. A view-tolerant numerator paired with a view-degenerate denominator is
   * worse than either alone: it produces a confidently-wrong number, not an obviously-degraded
   * one, so `'unsuitable'` (matching the hard-gated sagittal metrics) is the only honest
   * classification. `ambiguous` gets the same 0.2 (vs. front's 0.1) every other hard-gated
   * sagittal metric uses, for the identical reason: an ambiguous view is weaker evidence against
   * the metric than a confidently-front one.
   */
  verticalRatio: {
    side: { fit: 'primary', multiplier: 1.0 },
    front: { fit: 'unsuitable', multiplier: 0.1 },
    ambiguous: { fit: 'unsuitable', multiplier: 0.2 },
  },
  /**
   * View-tolerant, on the SAME terms as `verticalOscillation` — identical multipliers, not merely
   * similar ones (D2, #36). The reasoning is the denominator, not the numerator: `verticalRatio`
   * above is hard-gated because ITS denominator (stride length, a fore-aft/sagittal displacement)
   * foreshortens toward zero away from a side-on camera angle. `verticalOscillationCm` has no
   * denominator at all — it is an absolute centimetre figure (see `MetricResult.unit`'s doc) — so
   * that failure mode does not exist here. Its numerator is the identical hip-bounce amplitude
   * `verticalOscillation` reports (converted to metres before fitting, not after — see
   * `verticalOscillationCm.ts`), which projects onto image-y similarly regardless of facing
   * direction, exactly as `verticalOscillation`'s own view-tolerance argument says. Torso
   * foreshortening IS camera-angle-dependent — a runner's on-screen torso shortens face-on the
   * same way stride length does — but that effect lands in the SCALE calibration
   * (`ScaleCalibratedVerticalOscillation.torsoMeters`/`scaleCoverage`), a trunk-TILT effect visible
   * from side view too (any torso lean foreshortens its own on-screen projection), not a
   * camera-angle effect specific to front view — so it is handled by the scale-coverage/fit-
   * quality confidence factors (D2), not by a view-fit discount here.
   */
  verticalOscillationCm: {
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
   * — see `openspec/changes/derive-cadence-from-step-frequency/design.md` for the full reasoning.
   * As of that change, cadence's multipliers are IDENTICAL to verticalOscillation's, not merely
   * similar: both metrics now fit the exact same hip-mid vertical-axis signal
   * (`hipBounce.ts`'s `analyzeHipBounce`), a signal that projects onto image-y similarly
   * regardless of facing direction and never reads the sagittal (fore-aft) axis that makes trunk
   * lean/overstriding meaningless face-on. Cadence previously carried a steeper 0.8 front-view
   * discount justified by ankle-occlusion risk near a footstrike detection — that justification no
   * longer applies now that cadence doesn't read ankle position at all, so the discount was
   * relaxed to match vertical oscillation's 0.85 exactly.
   */
  cadence: {
    side: { fit: 'primary', multiplier: 1.0 },
    front: { fit: 'tolerated', multiplier: 0.85 },
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
  // Mediolateral, the opposite view-tolerance from most existing (sagittal-plane) metrics: a
  // side-on camera looks straight along the axis this metric measures (foot offset from the
  // hip midline), collapsing it toward a degenerate reading, while front/rear view is exactly
  // where mediolateral foot placement is visible. Mirrors armSwingSymmetry's row (front primary,
  // side unsuitable) — arm swing is occluded/superimposed in side view for a different reason
  // (separability, not axis collapse), but lands on the identical numbers.
  stepWidth: {
    front: { fit: 'primary', multiplier: 1.0 },
    side: { fit: 'unsuitable', multiplier: 0.1 },
    ambiguous: { fit: 'unsuitable', multiplier: 0.2 },
  },
  // Same signal as stepWidth, converted to centimetres — identical view-tolerance reasoning,
  // on the SAME terms as the ratio sibling (mirrors how verticalOscillationCm's row copies
  // verticalOscillation's verbatim rather than being independently derived).
  stepWidthCm: {
    front: { fit: 'primary', multiplier: 1.0 },
    side: { fit: 'unsuitable', multiplier: 0.1 },
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
  cadenceMinFitR2: 0.3,
  verticalOscillationMinCycles: 3,
  verticalOscillationSignal: 'hipMid',
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
