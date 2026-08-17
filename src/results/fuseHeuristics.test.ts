import { describe, expect, it } from 'vitest'
import type {
  FormHeuristicsResult,
  MetricId,
  MetricResult,
  VerticalOscillationFit,
  VerticalOscillationResult,
  VerticalOscillationCmResult,
  ScaleCalibratedVerticalOscillation,
  ViewDetectionResult,
} from '../heuristics/types'
import {
  fuseFormHeuristicsResults,
  fusionProvenanceCaveat,
  fusionSourceIndices,
} from './fuseHeuristics'

function makeMetric<M extends MetricId>(
  metric: M,
  confidence: number,
  overrides: Partial<MetricResult> = {},
): MetricResult & { metric: M } {
  return {
    metric,
    value: 1,
    unit: 'ratio',
    confidence,
    viewFit: 'primary',
    interpolatedFraction: 0,
    frameCoverage: 1,
    sampleSize: 5,
    caveat: null,
    ...overrides,
  } as MetricResult & { metric: M }
}

function makeView(confidence: number): ViewDetectionResult {
  return {
    view: 'side',
    confidence,
    diagnostics: { bilateralSpreadRatio: null, sagittalExcursionRatio: null, frameCoverage: 1 },
  }
}

function makeVerticalOscillation(
  confidence: number,
  overrides: Partial<VerticalOscillationResult> = {},
): VerticalOscillationResult {
  return {
    ...makeMetric('verticalOscillation', confidence),
    series: [],
    fit: null,
    ...overrides,
  }
}

function makeVerticalOscillationCm(
  confidence: number,
  overrides: Partial<VerticalOscillationCmResult> = {},
): VerticalOscillationCmResult {
  return {
    ...makeMetric('verticalOscillationCm', confidence, { unit: 'centimeters' }),
    calibration: null,
    ...overrides,
  }
}

// Every metric at a uniform baseline confidence, easy to override per test.
function makeResult(
  confidence: number,
  overrides: Partial<FormHeuristicsResult> = {},
): FormHeuristicsResult {
  return {
    view: makeView(confidence),
    verticalOscillation: makeVerticalOscillation(confidence),
    verticalRatio: makeMetric('verticalRatio', confidence, { unit: 'percent' }),
    verticalOscillationCm: makeVerticalOscillationCm(confidence),
    trunkLean: makeMetric('trunkLean', confidence, { unit: 'degrees' }),
    overstriding: makeMetric('overstriding', confidence),
    cadence: makeMetric('cadence', confidence, { unit: 'stepsPerMinute' }),
    kneeFlexion: makeMetric('kneeFlexion', confidence, { unit: 'degrees' }),
    armSwingSymmetry: makeMetric('armSwingSymmetry', confidence, { unit: 'percent' }),
    footStrikePattern: makeMetric('footStrikePattern', confidence),
    stepWidth: makeMetric('stepWidth', confidence, { unit: 'percent' }),
    stepWidthCm: makeMetric('stepWidthCm', confidence, { unit: 'centimeters' }),
    ...overrides,
  }
}

describe('fusionProvenanceCaveat', () => {
  it('is 1-indexed for the reader even though sourceIndex is 0-based', () => {
    expect(fusionProvenanceCaveat(0, 2)).toBe('Combined from clip 1 of 2.')
    expect(fusionProvenanceCaveat(1, 2)).toBe('Combined from clip 2 of 2.')
  })
})

describe('fuseFormHeuristicsResults', () => {
  it('returns a single input by reference, unchanged', () => {
    const solo = makeResult(0.5)
    expect(fuseFormHeuristicsResults([solo])).toBe(solo)
  })

  it('throws on an empty array', () => {
    expect(() => fuseFormHeuristicsResults([])).toThrow()
  })

  it('picks each metric independently from whichever clip has higher confidence', () => {
    const clip0 = makeResult(0.5, {
      trunkLean: makeMetric('trunkLean', 0.9, { value: 5, unit: 'degrees' }),
      armSwingSymmetry: makeMetric('armSwingSymmetry', 0.2, { value: 0.1, unit: 'percent' }),
    })
    const clip1 = makeResult(0.5, {
      trunkLean: makeMetric('trunkLean', 0.3, { value: 99, unit: 'degrees' }),
      armSwingSymmetry: makeMetric('armSwingSymmetry', 0.8, { value: 0.7, unit: 'percent' }),
    })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.trunkLean.value).toBe(5)
    expect(fused.trunkLean.caveat).toBe('Combined from clip 1 of 2.')
    expect(fused.armSwingSymmetry.value).toBe(0.7)
    expect(fused.armSwingSymmetry.caveat).toBe('Combined from clip 2 of 2.')
  })

  it('surfaces a metric that resolves on only one of N clips rather than excluding it', () => {
    const resolvedElsewhereLow = makeMetric('footStrikePattern', 0, {
      value: null,
      confidence: 0,
    })
    const clip0 = makeResult(0.5, { footStrikePattern: resolvedElsewhereLow })
    const clip1 = makeResult(0.5, { footStrikePattern: resolvedElsewhereLow })
    const clip2 = makeResult(0.5, {
      footStrikePattern: makeMetric('footStrikePattern', 0.4, { value: 0.02 }),
    })

    const fused = fuseFormHeuristicsResults([clip0, clip1, clip2])

    expect(fused.footStrikePattern.value).toBe(0.02)
    expect(fused.footStrikePattern.caveat).toBe('Combined from clip 3 of 3.')
  })

  it('merges view independently of any metric confidence', () => {
    const clip0 = makeResult(0.9, { view: makeView(0.1) })
    const clip1 = makeResult(0.1, { view: makeView(0.9) })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    // Every metric wins from clip0 (higher metric confidence)...
    expect(fused.trunkLean.confidence).toBe(clip0.trunkLean.confidence)
    // ...but view is selected purely on its own confidence, from clip1, by reference (view has
    // no caveat to rewrite, so it is never cloned the way metrics are).
    expect(fused.view).toBe(clip1.view)
  })

  it('view carries no caveat field and gets no provenance suffix', () => {
    const clip0 = makeResult(0.5, { view: makeView(0.9) })
    const clip1 = makeResult(0.5, { view: makeView(0.1) })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.view).toBe(clip0.view)
    expect('caveat' in fused.view).toBe(false)
  })

  it('carries verticalOscillation.series/.fit by reference from the winning clip', () => {
    const fit: VerticalOscillationFit = {
      frequencyHz: 1.5,
      peakToPeakAmplitudePx: 40,
      sinusoidR2: 0.5,
      totalR2: 0.9,
      secondPeakRatio: 0.5,
      sampleCount: 50,
      spanSeconds: 2,
      observedCycles: 3,
    }
    const series = [{ timestamp: 0, value: 0.1 }]
    const clip0 = makeResult(0.2)
    const clip1 = makeResult(0.5, {
      verticalOscillation: makeVerticalOscillation(0.9, { series, fit }),
    })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.verticalOscillation.series).toBe(series)
    expect(fused.verticalOscillation.fit).toBe(fit)
  })

  it('carries verticalOscillationCm.calibration by reference from the winning clip', () => {
    const calibration: ScaleCalibratedVerticalOscillation = {
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
    }
    const clip0 = makeResult(0.2)
    const clip1 = makeResult(0.5, {
      verticalOscillationCm: makeVerticalOscillationCm(0.9, { value: 4.79, calibration }),
    })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.verticalOscillationCm.calibration).toBe(calibration)
  })

  it('appends the provenance caveat after an existing caveat, space-joined', () => {
    const clip0 = makeResult(0.2)
    const clip1 = makeResult(0.5, {
      trunkLean: makeMetric('trunkLean', 0.9, {
        unit: 'degrees',
        caveat: 'Some frames were interpolated.',
      }),
    })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.trunkLean.caveat).toBe(
      'Some frames were interpolated. Combined from clip 2 of 2.',
    )
  })

  it('omits the provenance caveat entirely at N=1', () => {
    const solo = makeResult(0.5, {
      trunkLean: makeMetric('trunkLean', 0.9, { unit: 'degrees', caveat: 'Some caveat.' }),
    })

    const fused = fuseFormHeuristicsResults([solo])

    expect(fused.trunkLean.caveat).toBe('Some caveat.')
  })

  it('picks the winner correctly across 3+ clips when the winner is neither clip 0 nor clip 1', () => {
    const clip0 = makeResult(0.2)
    const clip1 = makeResult(0.3)
    const clip2 = makeResult(0.9, {
      cadence: makeMetric('cadence', 0.95, { value: 180, unit: 'stepsPerMinute' }),
    })
    const clip3 = makeResult(0.4)

    const fused = fuseFormHeuristicsResults([clip0, clip1, clip2, clip3])

    expect(fused.cadence.value).toBe(180)
    expect(fused.cadence.caveat).toBe('Combined from clip 3 of 4.')
  })

  it('ties break in favor of the earlier (lower-index) clip', () => {
    const clip0 = makeResult(0.5, {
      trunkLean: makeMetric('trunkLean', 0.7, { value: 11, unit: 'degrees' }),
    })
    const clip1 = makeResult(0.5, {
      trunkLean: makeMetric('trunkLean', 0.7, { value: 22, unit: 'degrees' }),
    })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.trunkLean.value).toBe(11)
    expect(fused.trunkLean.caveat).toBe('Combined from clip 1 of 2.')
  })
})

// A winner per metric, chosen so no clip wins everything and no clip wins nothing — the map and
// the fuse agreeing on an all-clip-0 fixture would prove nothing.
const WINNER_BY_METRIC: Record<MetricId, number> = {
  verticalOscillation: 2,
  verticalRatio: 0,
  verticalOscillationCm: 3,
  trunkLean: 1,
  overstriding: 3,
  cadence: 0,
  kneeFlexion: 2,
  armSwingSymmetry: 1,
  footStrikePattern: 3,
  stepWidth: 2,
  stepWidthCm: 1,
}

const METRIC_KEYS = Object.keys(WINNER_BY_METRIC) as MetricId[]

/**
 * One clip of a 4-clip fixture. Every metric's `value` is the clip's own index, so the FUSED
 * value names the clip it was selected from without reading a caveat — which is what makes the
 * agreement assertion below independent of the prose.
 */
function makeIndexedClip(clipIndex: number): FormHeuristicsResult {
  const confidence = (metric: MetricId): number =>
    WINNER_BY_METRIC[metric] === clipIndex ? 0.9 : 0.1 + clipIndex * 0.05
  const value = clipIndex
  return makeResult(0.5, {
    verticalOscillation: makeVerticalOscillation(confidence('verticalOscillation'), { value }),
    verticalRatio: makeMetric('verticalRatio', confidence('verticalRatio'), {
      value,
      unit: 'percent',
    }),
    verticalOscillationCm: makeVerticalOscillationCm(confidence('verticalOscillationCm'), {
      value,
    }),
    trunkLean: makeMetric('trunkLean', confidence('trunkLean'), { value, unit: 'degrees' }),
    overstriding: makeMetric('overstriding', confidence('overstriding'), { value }),
    cadence: makeMetric('cadence', confidence('cadence'), { value, unit: 'stepsPerMinute' }),
    kneeFlexion: makeMetric('kneeFlexion', confidence('kneeFlexion'), { value, unit: 'degrees' }),
    armSwingSymmetry: makeMetric('armSwingSymmetry', confidence('armSwingSymmetry'), {
      value,
      unit: 'percent',
    }),
    footStrikePattern: makeMetric('footStrikePattern', confidence('footStrikePattern'), { value }),
    stepWidth: makeMetric('stepWidth', confidence('stepWidth'), { value, unit: 'percent' }),
    stepWidthCm: makeMetric('stepWidthCm', confidence('stepWidthCm'), {
      value,
      unit: 'centimeters',
    }),
  })
}

describe('fusionSourceIndices', () => {
  it('names the same winner fuseFormHeuristicsResults selected, for every metric', () => {
    const clips = [0, 1, 2, 3].map(makeIndexedClip)

    const indices = fusionSourceIndices(clips)
    const fused = fuseFormHeuristicsResults(clips)

    // The map itself is the fixture's own answer...
    expect(indices).toEqual(WINNER_BY_METRIC)
    for (const key of METRIC_KEYS) {
      // ...and the fused object independently agrees: its value IS the winning clip's index, so
      // the two comparators cannot have diverged without this failing.
      expect(fused[key].value).toBe(indices[key])
      // The machine-readable index and the prose caveat name the same clip, 0- vs 1-based.
      expect(fused[key].caveat).toBe(fusionProvenanceCaveat(indices[key], clips.length))
    }
  })

  it('maps every metric to clip 0 for a single clip, leaving the fuse by reference', () => {
    const solo = makeResult(0.5)

    expect(fusionSourceIndices([solo])).toEqual(
      Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])),
    )
    expect(fuseFormHeuristicsResults([solo])).toBe(solo)
  })

  it('follows the same tie-break as the fuse — the earlier clip wins', () => {
    const clip0 = makeResult(0.5, {
      trunkLean: makeMetric('trunkLean', 0.7, { value: 11, unit: 'degrees' }),
    })
    const clip1 = makeResult(0.5, {
      trunkLean: makeMetric('trunkLean', 0.7, { value: 22, unit: 'degrees' }),
    })

    expect(fusionSourceIndices([clip0, clip1]).trunkLean).toBe(0)
    expect(fuseFormHeuristicsResults([clip0, clip1]).trunkLean.value).toBe(11)
  })

  it('throws on an empty array, like the fuse it mirrors', () => {
    expect(() => fusionSourceIndices([])).toThrow()
  })
})
