/**
 * 'front' means "front-or-back" — no face keypoints exist anywhere in this pipeline (a scope
 * decision made back in #3), so a camera looking at the runner's chest is indistinguishable from
 * one looking at their back from pure limb geometry. Nothing downstream needs the distinction:
 * both orientations equally hide the sagittal-plane signal that trunk lean and overstriding need,
 * and vertical oscillation doesn't care about facing direction at all.
 */
export type View = 'side' | 'front' | 'ambiguous'

export type ViewFit = 'primary' | 'tolerated' | 'unsuitable'

export type MetricId = 'verticalOscillation' | 'trunkLean' | 'overstriding'

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
  unit: 'ratio' | 'degrees'
  /** 0..1; forced 0 when value is null. */
  confidence: number
  viewFit: ViewFit
  interpolatedFraction: number
  frameCoverage: number
  sampleSize: number
  caveat: string | null
}

export interface FormHeuristicsResult {
  view: ViewDetectionResult
  verticalOscillation: MetricResult
  trunkLean: MetricResult
  overstriding: MetricResult
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

  /** A fully-interpolated input is trusted at this fraction relative to a fully-detected one. */
  interpolationConfidencePenalty: number // 0.5 — fully-interpolated input trusted at 50%

  viewFitTable: Record<MetricId, Record<View, { fit: ViewFit; multiplier: number }>>
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
  interpolationConfidencePenalty: 0.5,
  viewFitTable: DEFAULT_VIEW_FIT_TABLE,
}
