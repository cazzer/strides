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

export interface VerticalOscillationResult extends MetricResult {
  metric: 'verticalOscillation'
  /** One entry per input RobustPoseFrame, timestamp-aligned 1:1. Empty only when bodyScale was null. */
  series: TimeseriesPoint[]
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

  /** Minimum prominence (as a fraction of torsoLengthPx) for a hip-y extremum to count as a real
   * bounce rather than tracking jitter. */
  verticalOscillationMinProminenceRatio: number // 0.03
  /** Minimum half-cycle count below which confidence is penalized via the sampleSize factor. */
  verticalOscillationMinCycles: number // 4

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
   * extremum to count as a real half-swing rather than tracking jitter. Same order of magnitude as
   * verticalOscillationMinProminenceRatio — both read a moderately large, roughly twice-per-stride
   * vertical excursion. */
  armSwingMinProminenceRatio: number // 0.03

  /** Half-width, as a fraction of torsoLengthPx, of the "midfoot" band in `footStrikePattern`'s
   * ankle-relative-to-knee classification: at or within this ratio of the knee (either direction)
   * reads as midfoot; further ahead (in the travel direction) reads as heel, further behind reads
   * as forefoot. See `footStrikePattern.ts` / design.md for why this is symmetric and why 0.05. */
  footStrikeMidfootBandRatio: number // 0.05

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
  verticalOscillationMinProminenceRatio: 0.03,
  verticalOscillationMinCycles: 4,
  footstrikeMinProminenceRatio: 0.05,
  footstrikeMinIntervalSeconds: 0.25,
  overstrideFlagRatio: 0.15,
  kneeFlexionMinProminenceDegrees: 20,
  armSwingMinProminenceRatio: 0.03,
  footStrikeMidfootBandRatio: 0.05,
  interpolationConfidencePenalty: 0.5,
  viewFitTable: DEFAULT_VIEW_FIT_TABLE,
}
