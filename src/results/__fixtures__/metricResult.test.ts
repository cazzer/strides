import { describe, expect, it } from 'vitest'
import {
  makeCalibration,
  makeHeuristics,
  makeMetric,
  makeVerticalOscillation,
  makeVerticalOscillationCm,
  makeView,
} from './metricResult'
import { METRIC_LABELS, metricTier } from '../metricConfidence'
import { METRIC_GUIDANCE } from '../../guidance/metricGuidance'
import { referenceBandEnvelope } from '../../guidance/types'
import type { FormHeuristicsResult, MetricId, MetricResult } from '../../heuristics/types'

/**
 * Every `MetricId`, written out. `METRIC_LABELS` is the one production `Record<MetricId, …>` this
 * file can see, so the first test below pins this list against its keys — a thirteenth metric then
 * fails here instead of being silently skipped by every loop that follows.
 */
const METRIC_IDS: readonly MetricId[] = [
  'verticalOscillation',
  'verticalRatio',
  'verticalOscillationCm',
  'trunkLean',
  'overstriding',
  'cadence',
  'kneeFlexion',
  'footStrikePattern',
  'stepWidth',
  'stepWidthCm',
  'kneeDrive',
  'armSwingAmplitude',
]

/**
 * The unit each metric's producing module actually emits (`unit:` in
 * `src/heuristics/<metric>.ts`), stated independently of the fixture so a wrong default fails
 * instead of agreeing with itself. `kneeDrive` is the one prior fixtures most often got wrong.
 */
const PRODUCTION_UNITS: Record<MetricId, MetricResult['unit']> = {
  verticalOscillation: 'ratio',
  verticalRatio: 'percent',
  verticalOscillationCm: 'centimeters',
  trunkLean: 'degrees',
  overstriding: 'ratio',
  cadence: 'stepsPerMinute',
  kneeFlexion: 'degrees',
  footStrikePattern: 'ratio',
  stepWidth: 'percent',
  stepWidthCm: 'centimeters',
  kneeDrive: 'degrees',
  armSwingAmplitude: 'ratio',
}

describe('makeMetric', () => {
  it('covers exactly the MetricIds METRIC_LABELS names', () => {
    expect([...METRIC_IDS].sort()).toEqual(Object.keys(METRIC_LABELS).sort())
  })

  it.each(METRIC_IDS)('%s defaults to a measured, normal-tier result in its production unit', (id) => {
    const metric = makeMetric(id)
    expect(metric.metric).toBe(id)
    expect(metric.unit).toBe(PRODUCTION_UNITS[id])
    expect(metricTier(metric)).toBe('normal')
    expect(Number.isFinite(metric.value)).toBe(true)
    expect(metric.confidence).toBeGreaterThanOrEqual(0)
    expect(metric.confidence).toBeLessThanOrEqual(1)
    expect(metric.viewFit).toBe('primary')
    expect(metric.sampleSize).toBeGreaterThan(0)
    // Absent, never an empty array — the valid "nothing cleared the quality gate" state.
    expect('exemplars' in metric).toBe(false)
  })

  it('pins the defaults that describe a plausible clip', () => {
    // Stated as literals so a default moving is a visible diff. The vertical-oscillation family
    // and the step-width pair each agree with themselves — see the fixture's docstring.
    expect(makeMetric('verticalOscillation').value).toBe(0.15)
    expect(makeMetric('verticalOscillationCm').value).toBe(7.5)
    expect(makeMetric('verticalRatio').value).toBe(0.04)
    expect(makeMetric('stepWidth').value).toBe(0.05)
    expect(makeMetric('stepWidthCm').value).toBe(1.5)
    // stepWidthCm ÷ stepWidth is the hip width the pair implies: 30 cm.
    expect(makeMetric('stepWidthCm').value! / makeMetric('stepWidth').value!).toBeCloseTo(30, 10)
  })

  it.each(['cadence', 'verticalRatio', 'verticalOscillationCm', 'trunkLean', 'kneeFlexion'] as const)(
    '%s defaults to a value inside its published reference band',
    (id) => {
      const band = METRIC_GUIDANCE[id].band
      expect(band).not.toBeNull()
      const envelope = band ? referenceBandEnvelope(band) : null
      expect(envelope).not.toBeNull()
      const value = makeMetric(id).value!
      expect(value).toBeGreaterThanOrEqual(envelope!.min)
      expect(value).toBeLessThanOrEqual(envelope!.max)
    },
  )

  it.each(['footStrikePattern', 'overstriding'] as const)(
    '%s carries a non-null caveat by default, as production always does for a measured value',
    (id) => {
      expect(makeMetric(id).caveat).not.toBeNull()
    },
  )

  it('narrows the result to the metric it was asked for', () => {
    // A compile-time assertion as much as a runtime one: `tsc -b` type-checks this file.
    const cadence: MetricResult & { metric: 'cadence' } = makeMetric('cadence')
    expect(cadence.metric).toBe('cadence')
  })

  it('applies overrides verbatim, including a combination production never emits', () => {
    // A "perfectly confident null": the factory must not zero the confidence, or a test pinning
    // that null still wins would be asserting against something it did not write.
    const metric = makeMetric('trunkLean', { value: null, confidence: 0.95 })
    expect(metric.value).toBeNull()
    expect(metric.confidence).toBe(0.95)
    expect(metricTier(metric)).toBe('excluded')
  })

  it('reaches the caveated and excluded tiers with a single override each', () => {
    expect(metricTier(makeMetric('cadence', { confidence: 0.5 }))).toBe('caveated')
    expect(metricTier(makeMetric('armSwingAmplitude', { viewFit: 'unsuitable' }))).toBe('excluded')
  })

  it('keeps the positional metric even when a non-literal override carries another', () => {
    // A literal second statement of `metric` is rejected at compile time; `tsc -b` fails if this
    // directive ever stops being needed.
    // @ts-expect-error -- `overrides` omits `metric`
    expect(makeMetric('cadence', { metric: 'trunkLean' }).metric).toBe('cadence')

    const borrowed: Partial<MetricResult> = makeMetric('trunkLean', { value: 12 })
    const metric = makeMetric('kneeFlexion', borrowed)
    expect(metric.metric).toBe('kneeFlexion')
    expect(metric.value).toBe(12)
  })
})

describe('makeVerticalOscillation', () => {
  it('has a fit and a series that agree with its value', () => {
    const vo = makeVerticalOscillation()
    expect(vo.metric).toBe('verticalOscillation')
    expect(metricTier(vo)).toBe('normal')
    expect(vo.fit).not.toBeNull()
    expect(vo.sampleSize).toBe(Math.floor(vo.fit!.observedCycles))
    expect(vo.fit!.observedCycles).toBeCloseTo(vo.fit!.spanSeconds * vo.fit!.frequencyHz, 10)
    expect(vo.series).toHaveLength(vo.fit!.sampleCount)

    const values = vo.series.map((point) => point.value).filter((v): v is number => v !== null)
    expect(values).toHaveLength(vo.series.length)
    expect(Math.max(...values) - Math.min(...values)).toBeCloseTo(vo.value!, 10)
  })

  it('agrees with cadence about the rhythm, as a real run does', () => {
    expect(makeVerticalOscillation().fit!.frequencyHz * 60).toBeCloseTo(makeMetric('cadence').value!, 10)
  })

  it('applies overrides verbatim', () => {
    const vo = makeVerticalOscillation({ value: null, fit: null, series: [] })
    expect(vo.value).toBeNull()
    expect(vo.fit).toBeNull()
    expect(vo.series).toEqual([])
    expect(vo.metric).toBe('verticalOscillation')
  })
})

describe('makeVerticalOscillationCm', () => {
  it('is measured, so its calibration is non-null and agrees with its value', () => {
    const cm = makeVerticalOscillationCm()
    expect(cm.metric).toBe('verticalOscillationCm')
    expect(metricTier(cm)).toBe('normal')
    expect(cm.calibration).not.toBeNull()
    expect(cm.calibration!.verticalOscillationCm).toBe(cm.value)
    expect(cm.calibration!.fit!.peakToPeakAmplitudeCm).toBe(cm.value)
    expect(cm.calibration!.fitFailureReason).toBeNull()
    expect(cm.calibration!.sampleSize).toBe(cm.sampleSize)
    expect(cm.calibration!.sampleSize).toBe(Math.floor(cm.calibration!.observedCycles))
  })

  it('agrees with the pixel-space bounce through the calibration scale', () => {
    // 0.15 torso lengths × a 0.5 m torso = 7.5 cm. The same bounce, reached two ways.
    const cm = makeVerticalOscillationCm()
    const metresPerTorso = cm.calibration!.torsoMeters!
    expect(makeVerticalOscillation().value! * metresPerTorso * 100).toBeCloseTo(cm.value!, 10)
  })

  it('reaches the unmeasured primary-pass shape with four overrides', () => {
    const cm = makeVerticalOscillationCm({
      value: null,
      confidence: 0,
      calibration: null,
      caveat: 'No real-world scale could be measured for this clip.',
    })
    expect(metricTier(cm)).toBe('excluded')
    expect(cm.calibration).toBeNull()
  })

  it('lets makeCalibration describe a measured scale with a failed fit', () => {
    const calibration = makeCalibration({
      verticalOscillationCm: null,
      fit: null,
      fitFailureReason: 'below-quality-gate',
    })
    expect(calibration.fitFailureReason).toBe('below-quality-gate')
    expect(calibration.medianPixelsPerMeter).toBe(400)
  })
})

describe('makeView', () => {
  it('is a confidently side-on view whose plausibility sums to 1', () => {
    const view = makeView()
    expect(view.view).toBe('side')
    const { side, front, ambiguous } = view.plausibility
    expect(side + front + ambiguous).toBeCloseTo(1, 10)
  })
})

describe('makeHeuristics', () => {
  it('has every metric, each keyed under its own id and normal tier', () => {
    const heuristics: FormHeuristicsResult = makeHeuristics()
    expect(Object.keys(heuristics).sort()).toEqual(['view', ...METRIC_IDS].sort())
    for (const id of METRIC_IDS) {
      expect(heuristics[id].metric).toBe(id)
      expect(heuristics[id].unit).toBe(PRODUCTION_UNITS[id])
      expect(metricTier(heuristics[id])).toBe('normal')
    }
  })

  it('carries the wider result shapes for the two metrics that have them', () => {
    const heuristics = makeHeuristics()
    expect(heuristics.verticalOscillation.fit).not.toBeNull()
    expect(heuristics.verticalOscillation.series.length).toBeGreaterThan(0)
    expect(heuristics.verticalOscillationCm.calibration).not.toBeNull()
  })

  it('replaces whole slots from overrides and leaves the rest at their defaults', () => {
    const excluded = makeMetric('stepWidth', { value: null, confidence: 0 })
    const heuristics = makeHeuristics({ stepWidth: excluded })
    expect(heuristics.stepWidth).toBe(excluded)
    expect(metricTier(heuristics.stepWidth)).toBe('excluded')
    expect(metricTier(heuristics.cadence)).toBe('normal')
  })

  it('applies a uniform confidence to every metric and the view, but not to an overridden slot', () => {
    const cadence = makeMetric('cadence', { confidence: 0.2 })
    const heuristics = makeHeuristics({ cadence }, { confidence: 0.55 })
    expect(heuristics.view.confidence).toBe(0.55)
    for (const id of METRIC_IDS) {
      expect(heuristics[id].confidence).toBe(id === 'cadence' ? 0.2 : 0.55)
    }
  })

  it('builds fresh objects on every call, so one test mutating its fixture cannot leak into another', () => {
    const first = makeHeuristics()
    const second = makeHeuristics()
    expect(first).toEqual(second)
    expect(first.verticalOscillation.series).not.toBe(second.verticalOscillation.series)
    expect(first.verticalOscillation.fit).not.toBe(second.verticalOscillation.fit)
    expect(first.verticalOscillationCm.calibration).not.toBe(second.verticalOscillationCm.calibration)
    expect(first.view.diagnostics).not.toBe(second.view.diagnostics)

    first.verticalOscillation.series[0].value = 99
    expect(second.verticalOscillation.series[0].value).not.toBe(99)
  })
})
