import type {
  FormHeuristicsResult,
  MetricId,
  MetricResult,
  ScaleCalibratedVerticalOscillation,
  TimeseriesPoint,
  VerticalOscillationCmResult,
  VerticalOscillationResult,
  ViewDetectionResult,
} from '../../heuristics/types'

/**
 * Shared test factory for `MetricResult` and `FormHeuristicsResult`.
 *
 * Eight test files hand-rolled their own `makeMetric`/`makeHeuristics` before this existed, and
 * they had drifted: one gave all twelve metrics `unit: 'ratio'`, another defaulted `kneeDrive` to
 * `'ratio'` when `kneeDrive.ts` reports `'degrees'`, several paired a measured
 * `verticalOscillationCm` value with `calibration: null` (a combination production never emits, see
 * `VerticalOscillationCmResult.calibration`), and one built the whole object untyped and escaped
 * through `as unknown as`. None of that broke a test,
 * which is exactly the problem: a fixture that is wrong in a way nothing reads becomes wrong in a
 * way something DOES read the day a new consumer arrives. This module is the one place those
 * defaults are stated, and it states them against the production modules rather than against each
 * other.
 *
 * **What the defaults describe.** One coherent, unremarkable clip: 91 frames, 0 to 3 s inclusive at
 * 30 fps, of a runner at 180 steps/min (a 3 Hz bounce, so nine bounce cycles), whose torso is
 * 200 px and half a metre. Every default below is derived from that one picture rather than chosen
 * per metric, so the vertical-oscillation family agrees with itself and with `cadence` the way a
 * real run does: 0.15 torso lengths of bounce is 30 px, is 7.5 cm at 400 px/m, and the fits behind
 * both report `frequencyHz × 60 === 180`.
 *
 * **The defaults also sit inside the published reference bands** (`src/guidance/metricGuidance.ts`)
 * wherever one exists, so a guided-view test reaching for the default renders an unremarkable
 * in-band reading rather than an edge case it did not ask for: 180 steps/min, a 7.5 cm bounce, a
 * 4.0% vertical ratio, 5° of trunk lean and 110° of knee flexion each fall inside their band. A test
 * about a value outside a band states that value. Every `sampleSize` clears its producing module's minimum
 * (`MIN_TRUNK_LEAN_SAMPLE_SIZE = 10` being the highest), so no default describes a result
 * production would have marked down for thin data.
 *
 * **Every default metric is `metricTier() === 'normal'`.** A test that wants a measured,
 * high-confidence metric writes `makeMetric('cadence')` and nothing more; anything else is a
 * deliberate departure the test should have to spell out.
 *
 * **Overrides are applied VERBATIM — the factory never repairs a combination.** Setting
 * `value: null` does not zero `confidence`, null a `fit`, or drop a `calibration`, even though each
 * of those is a production invariant. Tests construct type-legal-but-pathological results on
 * purpose (`metricConfidence.test.ts` pins that a "perfectly confident null" is still excluded), and
 * a factory that quietly corrected them would make those tests assert against something other than
 * what they wrote. The cost is that a test moving off the defaults owns the invariants it moves.
 */

/** The defaults that genuinely differ per metric. Everything else is shared. */
interface MetricDefaults {
  unit: MetricResult['unit']
  value: number
  sampleSize: number
  caveat: string | null
}

/**
 * Keyed by `MetricId` rather than listed, so adding a thirteenth metric fails to compile HERE until
 * someone states its unit — the one default that is never safe to guess, since `formatValue` in
 * `MetricsPanel.tsx` reads it to decide what the number even means.
 *
 * Units are each producing module's own (`src/heuristics/<metric>.ts`), not what the prior
 * hand-rolled fixtures used.
 */
const METRIC_DEFAULTS: Record<MetricId, MetricDefaults> = {
  // 30 px of bounce on a 200 px torso; nine bounce cycles over the 3 s span.
  verticalOscillation: { unit: 'ratio', value: 0.15, sampleSize: 9, caveat: null },
  // Dimensionless bounce / stride length, 0..1 (rendered ×100). The 30 px bounce over a 750 px
  // (1.875 m) stride. `sampleSize` counts same-side stride PAIRS, not bounces (`MIN_STRIDE_PAIRS = 3`).
  verticalRatio: { unit: 'percent', value: 0.04, sampleSize: 7, caveat: null },
  // The same 30 px bounce at 400 px/m. Must agree with `makeCalibration`'s amplitude.
  verticalOscillationCm: { unit: 'centimeters', value: 7.5, sampleSize: 9, caveat: null },
  // One lean reading per resolvable frame.
  trunkLean: { unit: 'degrees', value: 5, sampleSize: 91, caveat: null },
  // `overstriding.ts` discloses its sampling-instant lag on EVERY non-null value, so a null caveat
  // here would be a result production cannot produce. Deliberately not the production wording: a
  // test asserting on caveat text should have to state that text itself.
  overstriding: {
    unit: 'ratio',
    value: 0.08,
    sampleSize: 9,
    caveat: 'Fixture caveat: overstriding always discloses its sampling instant.',
  },
  // 3 Hz × 60. `sampleSize` is the bounce-cycle count, which for cadence is directly a step count.
  cadence: { unit: 'stepsPerMinute', value: 180, sampleSize: 9, caveat: null },
  kneeFlexion: { unit: 'degrees', value: 110, sampleSize: 8, caveat: null },
  // A proxy even at its cleanest, so its caveat is ALWAYS non-null (`footStrikePattern.ts`).
  // 0.001 sits inside `footStrikeMidfootBandRatio` (0.05) — classified midfoot, the unremarkable
  // label, rather than one a presentation test would have to think about.
  footStrikePattern: {
    unit: 'ratio',
    value: 0.001,
    sampleSize: 9,
    caveat: 'Fixture caveat: foot strike pattern is always an approximation.',
  },
  // The same foot placement in two units, so the pair agrees with itself: `stepWidth` is the
  // ankle's offset from hip-mid as a fraction of hip width (`stepWidth.ts`), `stepWidthCm` the same
  // offset in centimetres (`stepWidthCm.ts`), so their quotient IS the hip width — 1.5 cm ÷ 0.05 =
  // a 30 cm hip-keypoint width, 120 px at the default 400 px/m. 1.5 cm sits among the small positive
  // typical values design.md D5.3/4 quotes for scale (not a band).
  stepWidth: { unit: 'percent', value: 0.05, sampleSize: 9, caveat: null },
  stepWidthCm: { unit: 'centimeters', value: 1.5, sampleSize: 9, caveat: null },
  kneeDrive: { unit: 'degrees', value: 45, sampleSize: 8, caveat: null },
  // Arm swing runs at STRIDE frequency (1.5 Hz), half the bounce rate: 4.5 cycles, floored.
  armSwingAmplitude: { unit: 'ratio', value: 0.25, sampleSize: 4, caveat: null },
  swingFootLateralExcursion: { unit: 'percent', value: 0.18, sampleSize: 3, caveat: null },
}

/** Clears `HIGH_CONFIDENCE_THRESHOLD` (0.7) with margin, so no default sits on the tier boundary. */
const DEFAULT_CONFIDENCE = 0.9

const BOUNCE_FREQUENCY_HZ = 3
const FRAME_RATE = 30
const SPAN_SECONDS = 3
const SAMPLE_COUNT = SPAN_SECONDS * FRAME_RATE + 1
const OBSERVED_CYCLES = SPAN_SECONDS * BOUNCE_FREQUENCY_HZ
const TORSO_PX = 200

/**
 * A plain `MetricResult` for `metric`, `'normal'` tier by default.
 *
 * Returns `MetricResult & { metric: M }` rather than bare `MetricResult` so a caller can drop the
 * result straight into a slot typed for that metric without widening. For the two metrics whose
 * `FormHeuristicsResult` slot is WIDER than `MetricResult` — `verticalOscillation` (adds `series`
 * and `fit`) and `verticalOscillationCm` (adds `calibration`) — use `makeVerticalOscillation` and
 * `makeVerticalOscillationCm`; this function's result is still a valid `MetricResult` for them, for
 * tests that only read the shared fields.
 *
 * `overrides` cannot name `metric`: the first argument already does, and a second, disagreeing
 * statement of it is never what a test means. The positional argument is also spread LAST, so a
 * non-literal overrides object that happens to carry a `metric` key (a spread of another result,
 * say) cannot relabel the result at runtime either.
 */
export function makeMetric<M extends MetricId>(
  metric: M,
  overrides: Partial<Omit<MetricResult, 'metric'>> = {},
): MetricResult & { metric: M } {
  const defaults = METRIC_DEFAULTS[metric]
  return {
    value: defaults.value,
    unit: defaults.unit,
    confidence: DEFAULT_CONFIDENCE,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: defaults.sampleSize,
    caveat: defaults.caveat,
    // `exemplars` is ABSENT, which is itself a valid state (`MetricResult.exemplars`: absent, never
    // an empty array, when nothing cleared the quality gate). A generic default exemplar would be
    // wrong for twelve of thirteen metrics — `kind` is per metric and `cadence` never emits one — so
    // a test that needs evidence states the exemplar it means.
    ...overrides,
    metric,
  }
}

/**
 * `verticalOscillation`'s full result, with a `series` and `fit` that agree with its `value`.
 *
 * The series is one point per frame of the default clip, a 3 Hz cosine of amplitude 0.05, so its
 * sampled peak-to-peak is exactly `value` (a cosine sampled at 10 frames per cycle lands on both of
 * its extremes; a sine would read ~5% low). `fit` is non-null because `value` is — production's
 * invariant is that a reported value always has a fit behind it. Both are rebuilt on every call, so
 * a test that mutates one cannot leak into the next.
 */
export function makeVerticalOscillation(
  overrides: Partial<Omit<VerticalOscillationResult, 'metric'>> = {},
): VerticalOscillationResult {
  const value = METRIC_DEFAULTS.verticalOscillation.value
  const series: TimeseriesPoint[] = Array.from({ length: SAMPLE_COUNT }, (_, frame) => {
    const timestamp = frame / FRAME_RATE
    return {
      timestamp,
      value: (value / 2) * Math.cos(2 * Math.PI * BOUNCE_FREQUENCY_HZ * timestamp),
    }
  })
  return {
    ...makeMetric('verticalOscillation'),
    series,
    fit: {
      frequencyHz: BOUNCE_FREQUENCY_HZ,
      // `value` × the default clip's 200 px torso.
      peakToPeakAmplitudePx: value * TORSO_PX,
      sinusoidR2: 0.6,
      totalR2: 0.65,
      secondPeakRatio: 0.3,
      sampleCount: SAMPLE_COUNT,
      spanSeconds: SPAN_SECONDS,
      observedCycles: OBSERVED_CYCLES,
    },
    ...overrides,
    metric: 'verticalOscillation',
  }
}

/**
 * The scale calibration behind a MEASURED `verticalOscillationCm` — what a MediaPipe primary pass,
 * or a grafted background scale pass, produces.
 *
 * Its amplitude, `fit.peakToPeakAmplitudeCm` and `sampleSize` agree with `makeVerticalOscillationCm`'s
 * default `value` and `sampleSize`, because `AnalysisDiagnostics.scaleCalibration` is this object BY
 * REFERENCE and a consumer comparing the two should find them equal. `torsoMeters` is 0.5 because a
 * human torso is roughly half a metre, and that is the sanity check the field exists for.
 */
export function makeCalibration(
  overrides: Partial<ScaleCalibratedVerticalOscillation> = {},
): ScaleCalibratedVerticalOscillation {
  const amplitudeCm = METRIC_DEFAULTS.verticalOscillationCm.value
  return {
    verticalOscillationCm: amplitudeCm,
    sampleSize: Math.floor(OBSERVED_CYCLES),
    observedCycles: OBSERVED_CYCLES,
    fit: {
      frequencyHz: BOUNCE_FREQUENCY_HZ,
      peakToPeakAmplitudeCm: amplitudeCm,
      sinusoidR2: 0.6,
      totalR2: 0.65,
      secondPeakRatio: 0.3,
      sampleCount: SAMPLE_COUNT,
      spanSeconds: SPAN_SECONDS,
      observedCycles: OBSERVED_CYCLES,
    },
    fitFailureReason: null,
    scaleDriftRatio: 1,
    medianPixelsPerMeter: 400,
    torsoMeters: 0.5,
    scaleCoverage: 1,
    integrationRuns: 1,
    ...overrides,
  }
}

/**
 * `verticalOscillationCm`'s full result, MEASURED by default — so `calibration` is non-null.
 *
 * Several prior fixtures paired a measured value with `calibration: null`, which production never
 * emits (`calibration` is non-null iff a real-world scale was measured, and nothing is reported in
 * centimetres without one). The unmeasured shape — the default MoveNet primary pass, before any
 * graft — is `{ value: null, confidence: 0, calibration: null, caveat: <why> }`, and a test that
 * wants it states all four.
 */
export function makeVerticalOscillationCm(
  overrides: Partial<Omit<VerticalOscillationCmResult, 'metric'>> = {},
): VerticalOscillationCmResult {
  return {
    ...makeMetric('verticalOscillationCm'),
    calibration: makeCalibration(),
    ...overrides,
    metric: 'verticalOscillationCm',
  }
}

/**
 * A confidently side-on `ViewDetectionResult`: both view signals past their side-view thresholds
 * (`bilateralSpreadRatio` 0.2 ≤ 0.3, `sagittalExcursionRatio` at its 1.6 full-credit value), all
 * plausibility on `side`, and every per-side sample count clear of `MIN_SAGITTAL_RANGE_SAMPLES`.
 */
export function makeView(overrides: Partial<ViewDetectionResult> = {}): ViewDetectionResult {
  return {
    view: 'side',
    confidence: DEFAULT_CONFIDENCE,
    plausibility: { side: 1, front: 0, ambiguous: 0 },
    diagnostics: {
      bilateralSpreadRatio: 0.2,
      sagittalExcursionRatio: 1.6,
      sagittalExcursionSampleCount: { left: 45, right: 45 },
      sagittalExcursionInterpolatedFraction: { left: 0, right: 0 },
      frameCoverage: 1,
    },
    ...overrides,
  }
}

export interface HeuristicsFixtureOptions {
  /**
   * One confidence for every metric AND for `view.confidence`, applied before `overrides`. Exists
   * for fusion-style tests, which compare whole results clip against clip and pick by confidence —
   * `view` included, since `fuseFormHeuristicsResults` picks the view by it too. A metric named in
   * `overrides` is taken as given and does not receive this value.
   */
  confidence?: number
}

/**
 * A complete `FormHeuristicsResult`: `makeView()` plus all thirteen metrics at their defaults, each
 * `'normal'` tier, with `overrides` replacing whole slots.
 *
 * ⚠️ **The default is view-INCOHERENT, and has to be.** `DEFAULT_VIEW_FIT_TABLE` makes `stepWidth`,
 * `stepWidthCm`, `armSwingAmplitude` and `swingFootLateralExcursion` front-primary and every other
 * gated metric side-primary, so no single view gives all thirteen `viewFit: 'primary'` — a real
 * side-view run would mark those four `'unsuitable'` and exclude them. The factory keeps every
 * metric `'primary'` because "all thirteen
 * measured and normal" is what a test reaching for the default wants, and nothing in
 * `src/results/` re-derives a metric's `viewFit` from `view`: it is computed once, inside
 * `computeFormHeuristics`, and carried verbatim through fusion and the scale-pass graft. A test
 * about view gating overrides both the view and the metrics it gates.
 */
export function makeHeuristics(
  overrides: Partial<FormHeuristicsResult> = {},
  options: HeuristicsFixtureOptions = {},
): FormHeuristicsResult {
  // Empty rather than `{ confidence: undefined }`: an explicit `undefined` would overwrite the
  // default on spread.
  const shared = options.confidence === undefined ? {} : { confidence: options.confidence }
  return {
    view: makeView(shared),
    verticalOscillation: makeVerticalOscillation(shared),
    verticalRatio: makeMetric('verticalRatio', shared),
    verticalOscillationCm: makeVerticalOscillationCm(shared),
    trunkLean: makeMetric('trunkLean', shared),
    overstriding: makeMetric('overstriding', shared),
    cadence: makeMetric('cadence', shared),
    kneeFlexion: makeMetric('kneeFlexion', shared),
    footStrikePattern: makeMetric('footStrikePattern', shared),
    stepWidth: makeMetric('stepWidth', shared),
    stepWidthCm: makeMetric('stepWidthCm', shared),
    kneeDrive: makeMetric('kneeDrive', shared),
    armSwingAmplitude: makeMetric('armSwingAmplitude', shared),
    swingFootLateralExcursion: makeMetric('swingFootLateralExcursion', shared),
    ...overrides,
  }
}
