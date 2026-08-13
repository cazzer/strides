import { describe, expect, it } from 'vitest'
import { graftScalePassResult, SCALE_PASS_PROVENANCE_CAVEAT } from './scalePassGraft'
import type {
  FormHeuristicsResult,
  MetricResult,
  ScaleCalibratedVerticalOscillation,
  VerticalOscillationCmResult,
} from '../heuristics/types'

function makeMetric(overrides: Partial<MetricResult>): MetricResult {
  return {
    metric: 'trunkLean',
    value: 5,
    unit: 'degrees',
    confidence: 0.9,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 20,
    caveat: null,
    ...overrides,
  }
}

function makeCalibration(
  overrides: Partial<ScaleCalibratedVerticalOscillation> = {},
): ScaleCalibratedVerticalOscillation {
  return {
    verticalOscillationCm: 4.79,
    sampleSize: 3,
    observedCycles: 3.4,
    fit: {
      frequencyHz: 1.52,
      peakToPeakAmplitudeCm: 4.79,
      sinusoidR2: 0.49,
      totalR2: 0.9,
      secondPeakRatio: 0.5,
      sampleCount: 57,
      spanSeconds: 2.24,
      observedCycles: 3.4,
    },
    fitFailureReason: null,
    scaleDriftRatio: 1.01,
    medianPixelsPerMeter: 872,
    torsoMeters: 0.505,
    scaleCoverage: 0.9,
    integrationRuns: 1,
    ...overrides,
  }
}

function makeVerticalOscillationCm(
  overrides: Partial<VerticalOscillationCmResult> = {},
): VerticalOscillationCmResult {
  return {
    metric: 'verticalOscillationCm',
    value: 4.79,
    unit: 'centimeters',
    confidence: 0.5,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 3,
    caveat: null,
    calibration: makeCalibration(),
    ...overrides,
  }
}

function makeResult(
  verticalOscillationCm: VerticalOscillationCmResult,
): FormHeuristicsResult {
  return {
    view: {
      view: 'side',
      confidence: 0.9,
      diagnostics: {
        bilateralSpreadRatio: 0.2,
        sagittalExcursionRatio: 0.9,
        frameCoverage: 1,
      },
    },
    verticalOscillation: {
      ...makeMetric({ metric: 'verticalOscillation', value: 0.12, unit: 'ratio' }),
      metric: 'verticalOscillation',
      series: [{ timestamp: 0, value: 0.05 }],
      fit: null,
    },
    verticalRatio: makeMetric({ metric: 'verticalRatio', value: 0.08, unit: 'percent' }),
    verticalOscillationCm,
    trunkLean: makeMetric({ metric: 'trunkLean', value: 6 }),
    overstriding: makeMetric({ metric: 'overstriding', value: 0.08, unit: 'ratio' }),
    cadence: makeMetric({ metric: 'cadence', value: 172, unit: 'stepsPerMinute' }),
    kneeFlexion: makeMetric({ metric: 'kneeFlexion', value: 110 }),
    armSwingSymmetry: makeMetric({
      metric: 'armSwingSymmetry',
      value: 0.92,
      unit: 'percent',
    }),
    footStrikePattern: makeMetric({
      metric: 'footStrikePattern',
      value: 0.02,
      unit: 'ratio',
      caveat: 'Approximated from ankle position relative to the knee at footstrike.',
    }),
  }
}

function makePrimary(): FormHeuristicsResult {
  // A realistic MoveNet primary: no measured scale, availability caveat, null value.
  return makeResult(
    makeVerticalOscillationCm({
      value: null,
      confidence: 0,
      frameCoverage: 0,
      sampleSize: 0,
      caveat: "No real-world scale could be measured for this clip, so bounce can't be reported in centimetres.",
      calibration: null,
    }),
  )
}

describe('graftScalePassResult', () => {
  it('grafts only verticalOscillationCm — every other metric and view stay reference-identical to the primary', () => {
    const primary = makePrimary()
    const scale = makeResult(makeVerticalOscillationCm())

    const grafted = graftScalePassResult(primary, scale)

    expect(grafted.verticalOscillationCm.value).toBe(4.79)
    expect(grafted.verticalOscillationCm.confidence).toBe(0.5)
    // Reference identity, not just equality — the graft must not rebuild anything else.
    expect(grafted.view).toBe(primary.view)
    expect(grafted.verticalOscillation).toBe(primary.verticalOscillation)
    expect(grafted.verticalRatio).toBe(primary.verticalRatio)
    expect(grafted.trunkLean).toBe(primary.trunkLean)
    expect(grafted.overstriding).toBe(primary.overstriding)
    expect(grafted.cadence).toBe(primary.cadence)
    expect(grafted.kneeFlexion).toBe(primary.kneeFlexion)
    expect(grafted.armSwingSymmetry).toBe(primary.armSwingSymmetry)
    expect(grafted.footStrikePattern).toBe(primary.footStrikePattern)
  })

  it('does not mutate either input', () => {
    const primary = makePrimary()
    const scale = makeResult(makeVerticalOscillationCm({ caveat: 'Scale coverage was low.' }))
    const primaryCmBefore = primary.verticalOscillationCm
    const scaleCmBefore = { ...scale.verticalOscillationCm }

    graftScalePassResult(primary, scale)

    expect(primary.verticalOscillationCm).toBe(primaryCmBefore)
    expect(primary.verticalOscillationCm.value).toBeNull()
    expect(scale.verticalOscillationCm).toEqual(scaleCmBefore)
  })

  it('appends the provenance sentence after the scale result caveat when one exists', () => {
    const primary = makePrimary()
    const scale = makeResult(
      makeVerticalOscillationCm({ caveat: 'Scale coverage was low for this clip.' }),
    )

    const grafted = graftScalePassResult(primary, scale)

    expect(grafted.verticalOscillationCm.caveat).toBe(
      `Scale coverage was low for this clip. ${SCALE_PASS_PROVENANCE_CAVEAT}`,
    )
  })

  it('uses the provenance sentence alone when the scale result has no caveat', () => {
    const primary = makePrimary()
    const scale = makeResult(makeVerticalOscillationCm({ caveat: null }))

    const grafted = graftScalePassResult(primary, scale)

    expect(grafted.verticalOscillationCm.caveat).toBe(SCALE_PASS_PROVENANCE_CAVEAT)
  })

  it('carries the calibration by reference', () => {
    const primary = makePrimary()
    const scale = makeResult(makeVerticalOscillationCm())

    const grafted = graftScalePassResult(primary, scale)

    expect(grafted.verticalOscillationCm.calibration).toBe(
      scale.verticalOscillationCm.calibration,
    )
  })

  it('grafts a measured-but-unfittable result, replacing the availability caveat with the fit-failure reason', () => {
    const primary = makePrimary()
    const fitFailureCaveat =
      'Hip position and scale were both measured, but the bounce rhythm was too irregular to measure in any continuous stretch of the clip.'
    const scale = makeResult(
      makeVerticalOscillationCm({
        value: null,
        confidence: 0,
        frameCoverage: 0,
        sampleSize: 0,
        caveat: fitFailureCaveat,
        calibration: makeCalibration({
          verticalOscillationCm: null,
          fit: null,
          fitFailureReason: 'below-quality-gate',
        }),
      }),
    )

    const grafted = graftScalePassResult(primary, scale)

    expect(grafted.verticalOscillationCm.value).toBeNull()
    expect(grafted.verticalOscillationCm.caveat).toBe(
      `${fitFailureCaveat} ${SCALE_PASS_PROVENANCE_CAVEAT}`,
    )
    // The primary's "no scale could be measured" statement is gone — after a completed MediaPipe
    // pass it would be false.
    expect(grafted.verticalOscillationCm.caveat).not.toMatch(
      /no real-world scale could be measured/i,
    )
    expect(grafted.verticalOscillationCm.calibration).toBe(
      scale.verticalOscillationCm.calibration,
    )
  })
})
