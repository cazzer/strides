import { describe, expect, it } from 'vitest'
import {
  dropGraftedExemplars,
  graftScalePassResult,
  withSubjectDivergenceCaveat,
  GRAFTED_METRIC_IDS,
  SCALE_PASS_PROVENANCE_CAVEAT,
  SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT,
} from './scalePassGraft'
import type {
  FormHeuristicsResult,
  MetricExemplar,
  MetricId,
  MetricResult,
  ScaleCalibratedVerticalOscillation,
  VerticalOscillationCmResult,
} from '../heuristics/types'

function makeExemplar(overrides: Partial<MetricExemplar> = {}): MetricExemplar {
  return {
    kind: 'bounceCycle',
    timestamp: 1.2,
    pairedTimestamp: 1.5,
    quality: 0.8,
    label: 'Highest and lowest point of one bounce',
    cropKeypoints: ['left_hip', 'right_hip'],
    ...overrides,
  }
}

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

function makeStepWidthCm(overrides: Partial<MetricResult> = {}): MetricResult {
  return makeMetric({
    metric: 'stepWidthCm',
    value: 8.2,
    unit: 'centimeters',
    confidence: 0.5,
    sampleSize: 5,
    ...overrides,
  })
}

function makeResult(
  verticalOscillationCm: VerticalOscillationCmResult,
  stepWidthCm: MetricResult = makeStepWidthCm(),
): FormHeuristicsResult {
  return {
    view: {
      view: 'side',
      plausibility: { side: 1, front: 0, ambiguous: 0 },
      confidence: 0.9,
      diagnostics: {
        bilateralSpreadRatio: 0.2,
        sagittalExcursionRatio: 0.9,
        sagittalExcursionSampleCount: { left: 30, right: 30 },
        sagittalExcursionInterpolatedFraction: { left: 0, right: 0 },
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
    stepWidth: makeMetric({ metric: 'stepWidth', value: 0.15, unit: 'percent' }),
    stepWidthCm,
  }
}

function makePrimary(): FormHeuristicsResult {
  // A realistic MoveNet primary: no measured scale, availability caveat, null value for both
  // scale-pass-backed metrics (#45).
  return makeResult(
    makeVerticalOscillationCm({
      value: null,
      confidence: 0,
      frameCoverage: 0,
      sampleSize: 0,
      caveat: "No real-world scale could be measured for this clip, so bounce can't be reported in centimetres.",
      calibration: null,
    }),
    makeStepWidthCm({
      value: null,
      confidence: 0,
      frameCoverage: 0,
      sampleSize: 0,
      caveat:
        "No real-world scale could be measured for this clip, so step width can't be reported in centimetres.",
    }),
  )
}

describe('graftScalePassResult', () => {
  it('grafts verticalOscillationCm AND stepWidthCm — every other metric and view stay reference-identical to the primary', () => {
    const primary = makePrimary()
    const scale = makeResult(makeVerticalOscillationCm(), makeStepWidthCm())

    const grafted = graftScalePassResult(primary, scale)

    expect(grafted.verticalOscillationCm.value).toBe(4.79)
    expect(grafted.verticalOscillationCm.confidence).toBe(0.5)
    expect(grafted.stepWidthCm.value).toBe(8.2)
    expect(grafted.stepWidthCm.confidence).toBe(0.5)
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
    expect(grafted.stepWidth).toBe(primary.stepWidth)
  })

  it("carries the scale pass's exemplars across verbatim, timestamps untouched", () => {
    // Both passes sampled the same clip on the same media clock, so a grafted instant stays
    // meaningful — and its crop geometry then resolves against the PRIMARY pass's frames, the
    // only ones any consumer holds (the scale pass's never leave `useVideoAnalysis`).
    const exemplars = [makeExemplar()]
    const primary = makePrimary()
    const scale = makeResult(
      makeVerticalOscillationCm({ exemplars }),
      makeStepWidthCm({ exemplars: [makeExemplar({ kind: 'stepWidthStrike' })] }),
    )

    const grafted = graftScalePassResult(primary, scale)

    expect(grafted.verticalOscillationCm.exemplars).toBe(exemplars)
    expect(grafted.stepWidthCm.exemplars).toEqual([makeExemplar({ kind: 'stepWidthStrike' })])
  })

  it('does not mutate either input', () => {
    const primary = makePrimary()
    const scale = makeResult(
      makeVerticalOscillationCm({ caveat: 'Scale coverage was low.' }),
      makeStepWidthCm({ caveat: 'Only 3 footstrike(s) detected.' }),
    )
    const primaryCmBefore = primary.verticalOscillationCm
    const primaryStepWidthBefore = primary.stepWidthCm
    const scaleCmBefore = { ...scale.verticalOscillationCm }
    const scaleStepWidthBefore = { ...scale.stepWidthCm }

    graftScalePassResult(primary, scale)

    expect(primary.verticalOscillationCm).toBe(primaryCmBefore)
    expect(primary.verticalOscillationCm.value).toBeNull()
    expect(primary.stepWidthCm).toBe(primaryStepWidthBefore)
    expect(primary.stepWidthCm.value).toBeNull()
    expect(scale.verticalOscillationCm).toEqual(scaleCmBefore)
    expect(scale.stepWidthCm).toEqual(scaleStepWidthBefore)
  })

  it('grafts stepWidthCm with its own null value and caveat when the pass measured scale broadly but found no footstrikes for it — verticalOscillationCm unaffected', () => {
    const primary = makePrimary()
    const scale = makeResult(
      makeVerticalOscillationCm(), // the pass DID measure scale and fit a bounce
      makeStepWidthCm({
        value: null,
        confidence: 0,
        frameCoverage: 0,
        sampleSize: 0,
        caveat: 'No footstrikes could be detected in this clip.',
      }),
    )

    const grafted = graftScalePassResult(primary, scale)

    expect(grafted.verticalOscillationCm.value).toBe(4.79)
    expect(grafted.verticalOscillationCm.caveat).toBe(SCALE_PASS_PROVENANCE_CAVEAT)
    expect(grafted.stepWidthCm.value).toBeNull()
    expect(grafted.stepWidthCm.caveat).toBe(
      `No footstrikes could be detected in this clip. ${SCALE_PASS_PROVENANCE_CAVEAT}`,
    )
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
      'Hip position and real-world scale were both tracked, but the bounce rhythm was too irregular to measure in any continuous stretch of the clip.'
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

describe('withSubjectDivergenceCaveat', () => {
  it('uses the exact divergence sentence', () => {
    expect(SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT).toBe(
      'This second look may have measured a different person than the other metrics.',
    )
  })

  it('appends to the two scale-sourced metrics and leaves everything else identical', () => {
    const grafted = graftScalePassResult(makePrimary(), makeResult(makeVerticalOscillationCm()))

    const caveated = withSubjectDivergenceCaveat(grafted)

    expect(caveated.verticalOscillationCm.caveat).toBe(
      `${SCALE_PASS_PROVENANCE_CAVEAT} ${SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT}`,
    )
    expect(caveated.stepWidthCm.caveat).toBe(
      `${SCALE_PASS_PROVENANCE_CAVEAT} ${SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT}`,
    )
    // Divergence caveats the two numbers; it never withholds or alters them.
    expect(caveated.verticalOscillationCm.value).toBe(grafted.verticalOscillationCm.value)
    expect(caveated.stepWidthCm.value).toBe(grafted.stepWidthCm.value)
    expect(caveated.verticalOscillationCm.calibration).toBe(
      grafted.verticalOscillationCm.calibration,
    )

    expect(caveated.view).toBe(grafted.view)
    expect(caveated.verticalOscillation).toBe(grafted.verticalOscillation)
    expect(caveated.verticalRatio).toBe(grafted.verticalRatio)
    expect(caveated.trunkLean).toBe(grafted.trunkLean)
    expect(caveated.overstriding).toBe(grafted.overstriding)
    expect(caveated.cadence).toBe(grafted.cadence)
    expect(caveated.kneeFlexion).toBe(grafted.kneeFlexion)
    expect(caveated.armSwingSymmetry).toBe(grafted.armSwingSymmetry)
    expect(caveated.footStrikePattern).toBe(grafted.footStrikePattern)
    expect(caveated.stepWidth).toBe(grafted.stepWidth)
  })

  it('composes after provenance, behind the metric’s own caveat', () => {
    const ownCaveat = 'The bounce rhythm in this clip was not perfectly steady.'
    const scale = makeResult(
      makeVerticalOscillationCm({ caveat: ownCaveat }),
      makeStepWidthCm({ caveat: null }),
    )

    const caveated = withSubjectDivergenceCaveat(
      graftScalePassResult(makePrimary(), scale),
    )

    expect(caveated.verticalOscillationCm.caveat).toBe(
      `${ownCaveat} ${SCALE_PASS_PROVENANCE_CAVEAT} ${SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT}`,
    )
    // No leading space when the grafted metric carried no caveat of its own before provenance.
    expect(caveated.stepWidthCm.caveat).toBe(
      `${SCALE_PASS_PROVENANCE_CAVEAT} ${SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT}`,
    )
  })

  it('handles a null caveat without emitting a leading space', () => {
    const result = makeResult(
      makeVerticalOscillationCm({ caveat: null }),
      makeStepWidthCm({ caveat: null }),
    )

    const caveated = withSubjectDivergenceCaveat(result)

    expect(caveated.verticalOscillationCm.caveat).toBe(SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT)
    expect(caveated.stepWidthCm.caveat).toBe(SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT)
  })

  it('does not mutate its input', () => {
    const result = makeResult(makeVerticalOscillationCm({ caveat: null }))
    const before = JSON.stringify(result)

    withSubjectDivergenceCaveat(result)

    expect(JSON.stringify(result)).toBe(before)
  })
})

describe('dropGraftedExemplars', () => {
  it('removes the key on both grafted metrics rather than emptying it', () => {
    const result = makeResult(
      makeVerticalOscillationCm({ exemplars: [makeExemplar()] }),
      makeStepWidthCm({ exemplars: [makeExemplar({ kind: 'stepWidthStrike' })] }),
    )

    const dropped = dropGraftedExemplars(result)

    // Absent, never `[]` — "this metric shows nothing" must not read as "its instants went
    // missing", which is the distinction `MetricResult.exemplars` being optional exists to make.
    expect('exemplars' in dropped.verticalOscillationCm).toBe(false)
    expect('exemplars' in dropped.stepWidthCm).toBe(false)
  })

  it('leaves the numbers, their caveats and every other metric alone', () => {
    const caveated = withSubjectDivergenceCaveat(
      graftScalePassResult(
        makePrimary(),
        makeResult(
          makeVerticalOscillationCm({ exemplars: [makeExemplar()] }),
          makeStepWidthCm({ exemplars: [makeExemplar({ kind: 'stepWidthStrike' })] }),
        ),
      ),
    )

    const dropped = dropGraftedExemplars(caveated)

    // The number stays, caveated — only the picture is withheld, because a crop of the primary
    // pass's subject under a number measured about somebody else asserts an identity the caveat
    // beside it only doubts.
    expect(dropped.verticalOscillationCm.value).toBe(4.79)
    expect(dropped.stepWidthCm.value).toBe(8.2)
    expect(dropped.verticalOscillationCm.caveat).toBe(
      `${SCALE_PASS_PROVENANCE_CAVEAT} ${SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT}`,
    )
    expect(dropped.verticalOscillationCm.calibration).toBe(
      caveated.verticalOscillationCm.calibration,
    )

    expect(dropped.view).toBe(caveated.view)
    expect(dropped.verticalOscillation).toBe(caveated.verticalOscillation)
    expect(dropped.verticalRatio).toBe(caveated.verticalRatio)
    expect(dropped.trunkLean).toBe(caveated.trunkLean)
    expect(dropped.overstriding).toBe(caveated.overstriding)
    expect(dropped.cadence).toBe(caveated.cadence)
    expect(dropped.kneeFlexion).toBe(caveated.kneeFlexion)
    expect(dropped.armSwingSymmetry).toBe(caveated.armSwingSymmetry)
    expect(dropped.footStrikePattern).toBe(caveated.footStrikePattern)
    expect(dropped.stepWidth).toBe(caveated.stepWidth)
  })

  it('keeps the primary pass’s own exemplars — divergence is about the two grafted metrics', () => {
    const primaryExemplars = [makeExemplar({ kind: 'trunkLeanRange' })]
    const primary: FormHeuristicsResult = {
      ...makePrimary(),
      trunkLean: makeMetric({ metric: 'trunkLean', exemplars: primaryExemplars }),
    }

    const dropped = dropGraftedExemplars(
      graftScalePassResult(primary, makeResult(makeVerticalOscillationCm())),
    )

    expect(dropped.trunkLean.exemplars).toBe(primaryExemplars)
  })

  it('is a no-op, by reference, when neither grafted metric carried exemplars', () => {
    const result = makeResult(makeVerticalOscillationCm(), makeStepWidthCm())

    const dropped = dropGraftedExemplars(result)

    expect(dropped.verticalOscillationCm).toBe(result.verticalOscillationCm)
    expect(dropped.stepWidthCm).toBe(result.stepWidthCm)
  })

  it('does not mutate its input', () => {
    const result = makeResult(
      makeVerticalOscillationCm({ exemplars: [makeExemplar()] }),
      makeStepWidthCm({ exemplars: [makeExemplar({ kind: 'stepWidthStrike' })] }),
    )
    const before = JSON.stringify(result)

    dropGraftedExemplars(result)

    expect(JSON.stringify(result)).toBe(before)
  })
})

describe('GRAFTED_METRIC_IDS', () => {
  /**
   * The set is DERIVED from the graft rather than compared against a hand-written literal, so it
   * cannot drift from the function it describes. A third grafted metric that forgot to join the
   * set would not merely be untidy: `planClipEvidence` reads this set to decide which metrics get
   * the scale pass's own frames, so an omission plans that metric's evidence from the wrong
   * detector — silently, and looking entirely deliberate. That class of divergence has already
   * happened once in this area (`stepWidthExemplars.ts`'s two copied builders).
   */
  function metricsGraftScalePassResultReplaces(): MetricId[] {
    const primary = makeResult(makeVerticalOscillationCm(), makeStepWidthCm())
    const scale = makeResult(
      makeVerticalOscillationCm({ value: 9.99 }),
      makeStepWidthCm({ value: 8.88 }),
    )
    const grafted = graftScalePassResult(primary, scale)
    return (Object.keys(primary) as Array<keyof FormHeuristicsResult>)
      .filter((key): key is MetricId => key !== 'view')
      .filter((id) => grafted[id] !== primary[id])
  }

  it('names exactly the metrics graftScalePassResult replaces', () => {
    expect([...GRAFTED_METRIC_IDS].sort()).toEqual(
      metricsGraftScalePassResultReplaces().sort(),
    )
  })

  it('names exactly the metrics dropGraftedExemplars strips', () => {
    // The other consumer of the same fact, checked the same way, so a metric can never be grafted
    // by one path and forgotten by the other.
    const withExemplars = makeResult(
      makeVerticalOscillationCm({ exemplars: [makeExemplar()] }),
      makeStepWidthCm({ exemplars: [makeExemplar({ kind: 'stepWidthStrike' })] }),
    )
    const stripped = dropGraftedExemplars(withExemplars)
    const changed = (Object.keys(withExemplars) as Array<keyof FormHeuristicsResult>)
      .filter((key): key is MetricId => key !== 'view')
      .filter((id) => stripped[id] !== withExemplars[id])
    expect(changed.sort()).toEqual([...GRAFTED_METRIC_IDS].sort())
  })
})
