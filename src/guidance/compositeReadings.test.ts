import { describe, expect, it } from 'vitest'
import { computeFormHeuristics } from '../heuristics/index'
import { estimateBodyScale } from '../heuristics/bodyScale'
import { estimateStrideLength } from '../heuristics/strideLength'
import { DEFAULT_HEURISTICS_CONFIG } from '../heuristics/types'
import type { FormHeuristicsResult, MetricId } from '../heuristics/types'
import { generateSyntheticGait } from '../heuristics/__fixtures__/syntheticGait'
import {
  makeHeuristics,
  makeMetric,
  makeVerticalOscillation,
  makeVerticalOscillationCm,
} from '../results/__fixtures__/metricResult'
import { metricTier } from '../results/metricConfidence'
import {
  COMPOSITE_READINGS,
  areaReadings,
  bounceDerivation,
  compositeOf,
  readingHeadline,
} from './compositeReadings'
import { FOCUS_AREAS } from './focusAreas'
import type { MetricTier } from './types'

function tiersOf(heuristics: FormHeuristicsResult): Record<MetricId, MetricTier> {
  return Object.fromEntries(
    (Object.keys(FOCUS_AREAS) as (keyof typeof FOCUS_AREAS)[])
      .flatMap((area) => FOCUS_AREAS[area].metricIds)
      .map((id) => [id, metricTier(heuristics[id])]),
  ) as Record<MetricId, MetricTier>
}

const UNMEASURED = { value: null, confidence: 0 }

/** The rhythm area's measured metrics, in `FOCUS_AREAS` order, as `summaryRows` hands them over. */
function rhythmMeasured(heuristics: FormHeuristicsResult): MetricId[] {
  const tiers = tiersOf(heuristics)
  return FOCUS_AREAS.rhythm.metricIds.filter((id) => tiers[id] !== 'excluded')
}

function shape(ids: MetricId[]) {
  return areaReadings(ids, (id) => id).map((reading) =>
    reading.kind === 'single'
      ? reading.item
      : { [reading.id]: [reading.headline, ...reading.members] },
  )
}

const ONE_CLIP: Record<MetricId, number> = Object.fromEntries(
  FOCUS_AREAS.rhythm.metricIds.map((id) => [id, 0]),
) as Record<MetricId, number>

describe('COMPOSITE_READINGS', () => {
  it('only groups metrics of its own area, and each metric into at most one composite', () => {
    for (const spec of Object.values(COMPOSITE_READINGS)) {
      for (const id of spec.metricIds) {
        expect(FOCUS_AREAS[spec.area].metricIds, id).toContain(id)
        expect(compositeOf(id)).toBe(spec)
      }
    }
    expect(COMPOSITE_READINGS.bounce.metricIds).toEqual([
      'verticalRatio',
      'verticalOscillationCm',
      'verticalOscillation',
    ])
    expect(compositeOf('cadence')).toBeNull()
  })
})

describe('areaReadings', () => {
  it('reads rhythm as cadence, then one bounce reading headlined by vertical ratio', () => {
    expect(shape(rhythmMeasured(makeHeuristics()))).toEqual([
      'cadence',
      { bounce: ['verticalRatio', 'verticalOscillationCm', 'verticalOscillation'] },
    ])
  })

  it('reads rhythm as the bounce reading alone when cadence is excluded', () => {
    const heuristics = makeHeuristics({ cadence: makeMetric('cadence', UNMEASURED) })
    const readings = areaReadings(rhythmMeasured(heuristics), (id) => id)
    expect(readings).toHaveLength(1)
    expect(readingHeadline(readings[0])).toBe('verticalRatio')
  })

  it('falls back from vertical ratio to centimetres, then to the relative bounce', () => {
    const noRatio = makeHeuristics({ verticalRatio: makeMetric('verticalRatio', UNMEASURED) })
    expect(shape(rhythmMeasured(noRatio))).toEqual([
      'cadence',
      { bounce: ['verticalOscillationCm', 'verticalOscillation'] },
    ])
    const relativeOnly = makeHeuristics({
      verticalRatio: makeMetric('verticalRatio', UNMEASURED),
      verticalOscillationCm: makeVerticalOscillationCm({ ...UNMEASURED, calibration: null }),
    })
    expect(shape(rhythmMeasured(relativeOnly))).toEqual(['cadence', { bounce: ['verticalOscillation'] }])
  })

  it('keeps a composite where its first member sat, and leaves other areas as singles', () => {
    expect(shape(['verticalOscillation', 'cadence', 'verticalRatio'])).toEqual([
      { bounce: ['verticalRatio', 'verticalOscillation'] },
      'cadence',
    ])
    expect(shape([...FOCUS_AREAS.footPath.metricIds])).toEqual([...FOCUS_AREAS.footPath.metricIds])
  })
})

describe('bounceDerivation', () => {
  it('cites the relative hip bounce and the stride in torso lengths, so the division checks', () => {
    const heuristics = makeHeuristics()
    const derivation = bounceDerivation(heuristics, tiersOf(heuristics), ONE_CLIP)!
    // 0.15 torso lengths of bounce over a 4% ratio: a 3.75-torso stride (the fixture's 750 / 200 px).
    expect(derivation.figures!.bounceTorsoLengths).toBe(0.15)
    expect(derivation.figures!.strideTorsoLengths).toBeCloseTo(3.75, 10)
    expect(derivation.figures!.bounceTorsoLengths / derivation.figures!.strideTorsoLengths).toBeCloseTo(
      heuristics.verticalRatio.value!,
      12,
    )
    expect(derivation.strideCount).toBe(7)
    // `null` sourceIndices is one clip.
    expect(bounceDerivation(heuristics, tiersOf(heuristics), null)).toEqual(derivation)
  })

  it('never cites the centimetre bounce: it is a separate fit vertical ratio does not read', () => {
    const withCm = makeHeuristics()
    const withoutCm = makeHeuristics({
      verticalOscillationCm: makeVerticalOscillationCm({ ...UNMEASURED, calibration: null }),
    })
    expect(bounceDerivation(withCm, tiersOf(withCm), ONE_CLIP)).toEqual(
      bounceDerivation(withoutCm, tiersOf(withoutCm), ONE_CLIP),
    )
  })

  it('drops the figures when the relative bounce comes from another clip', () => {
    const heuristics = makeHeuristics()
    expect(
      bounceDerivation(heuristics, tiersOf(heuristics), { ...ONE_CLIP, verticalOscillation: 1 }),
    ).toEqual({ figures: null, strideCount: 7 })
  })

  it('drops the figures unless vertical oscillation reads the same hip fit (hipMid)', () => {
    const heuristics = makeHeuristics()
    expect(bounceDerivation(heuristics, tiersOf(heuristics), ONE_CLIP, 'earMid')).toEqual({
      figures: null,
      strideCount: 7,
    })
  })

  it('is null when vertical ratio is excluded', () => {
    const heuristics = makeHeuristics({ verticalRatio: makeMetric('verticalRatio', UNMEASURED) })
    expect(bounceDerivation(heuristics, tiersOf(heuristics), ONE_CLIP)).toBeNull()
  })

  it('cites no figures without the relative bounce', () => {
    const heuristics = makeHeuristics({
      verticalOscillation: makeVerticalOscillation({ ...UNMEASURED, fit: null }),
    })
    expect(bounceDerivation(heuristics, tiersOf(heuristics), ONE_CLIP)).toEqual({ figures: null, strideCount: 7 })
  })

  it('reads the stride in torso lengths exactly as the heuristics measure it (VO / VR = stride / torso)', () => {
    // The identity the stride figure rests on (design.md D3): under the default hip-pinned signal,
    // vertical oscillation and vertical ratio divide the SAME fitted amplitude by the torso and by
    // the stride. If that ever stops holding, the From line's stride figure would be wrong.
    const frames = generateSyntheticGait({
      durationSec: 4,
      fps: 30,
      cadenceStepsPerMin: 170,
      strideAmplitudePx: 80,
      verticalBouncePx: 20,
      trunkLeanDeg: 8,
      view: 'side',
    })
    const result = computeFormHeuristics(frames)
    const stride = estimateStrideLength(frames, DEFAULT_HEURISTICS_CONFIG, {
      stepFrequencyHz: result.verticalOscillation.fit!.frequencyHz,
    })
    const scale = estimateBodyScale(frames)
    expect(stride.ok).toBe(true)
    expect(scale).not.toBeNull()
    if (!stride.ok || scale === null) return
    const derivation = bounceDerivation(result, tiersOf(result), null)
    expect(derivation).not.toBeNull()
    expect(derivation!.figures!.strideTorsoLengths).toBeCloseTo(stride.strideLengthPx / scale.torsoLengthPx, 9)
    expect(derivation!.strideCount).toBe(stride.pairCount)
  })
})
