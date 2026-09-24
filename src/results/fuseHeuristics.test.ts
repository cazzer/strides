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
  fusionDisagreementCaveat,
  fusionProvenanceCaveat,
  fusionSourceIndices,
} from './fuseHeuristics'

/** Either side of `footStrikeMidfootBandRatio` (0.05) — the one band any metric currently owns. */
const HEEL = 0.115103
const FOREFOOT = -0.239589
const MIDFOOT = 0.001

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
    plausibility: { side: 1, front: 0, ambiguous: 0 },
    diagnostics: {
      bilateralSpreadRatio: null,
      sagittalExcursionRatio: null,
      sagittalExcursionSampleCount: { left: 0, right: 0 },
      sagittalExcursionInterpolatedFraction: { left: 0, right: 0 },
      frameCoverage: 1,
    },
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
    footStrikePattern: makeMetric('footStrikePattern', confidence),
    stepWidth: makeMetric('stepWidth', confidence, { unit: 'percent' }),
    stepWidthCm: makeMetric('stepWidthCm', confidence, { unit: 'centimeters' }),
    kneeDrive: makeMetric('kneeDrive', confidence, { unit: 'degrees' }),
    armSwingAmplitude: makeMetric('armSwingAmplitude', confidence, { unit: 'ratio' }),
    swingFootLateralExcursion: makeMetric('swingFootLateralExcursion', confidence, { unit: 'percent' }),
    ...overrides,
  }
}

describe('fusionProvenanceCaveat', () => {
  it('is 1-indexed for the reader even though sourceIndex is 0-based', () => {
    expect(fusionProvenanceCaveat(0, 2)).toBe('Combined from clip 1 of 2.')
    expect(fusionProvenanceCaveat(1, 2)).toBe('Combined from clip 2 of 2.')
  })
})

describe('fusionDisagreementCaveat', () => {
  it('names the clip and what it read, and claims no winner', () => {
    expect(fusionDisagreementCaveat([{ clipNumber: 2, reading: 'a forefoot strike' }])).toBe(
      'The clips disagree: clip 2 read a forefoot strike. Nothing here settles which clip is right.',
    )
  })

  it('lists every disagreeing clip', () => {
    expect(
      fusionDisagreementCaveat([
        { clipNumber: 2, reading: 'a forefoot strike' },
        { clipNumber: 3, reading: 'a midfoot strike' },
      ]),
    ).toBe(
      'The clips disagree: clip 2 read a forefoot strike and clip 3 read a midfoot strike. ' +
        'Nothing here settles which clip is right.',
    )
  })
})

/**
 * The `strides-5hj` behaviour: fusion keeps its picking rule, and says out loud when the clip it
 * did not pick would have put a different WORD on the card. Only `caveat` may move — every
 * assertion below that touches a computed field is asserting it did NOT.
 */
describe('fuseFormHeuristicsResults — cross-clip disagreement', () => {
  const footStrike = (confidence: number, value: number | null, overrides = {}) =>
    makeMetric('footStrikePattern', confidence, { value, ...overrides })

  it('names the losing clip and its reading when two clips land in different bands', () => {
    // The measured `strides-5hj` case: both side clips at the confidence ceiling, so the tie is
    // structurally unwinnable and the loser is invisible without this.
    const clip0 = makeResult(0.5, { footStrikePattern: footStrike(1, HEEL) })
    const clip1 = makeResult(0.5, { footStrikePattern: footStrike(1, FOREFOOT) })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.footStrikePattern.caveat).toBe(
      'Combined from clip 1 of 2. The clips disagree: clip 2 read a forefoot strike. ' +
        'Nothing here settles which clip is right.',
    )
  })

  it('moves no computed field when it fires', () => {
    const winner = footStrike(1, HEEL, { sampleSize: 5, interpolatedFraction: 0.25 })
    const clip0 = makeResult(0.5, { footStrikePattern: winner })
    const clip1 = makeResult(0.5, { footStrikePattern: footStrike(1, FOREFOOT) })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.footStrikePattern.value).toBe(winner.value)
    expect(fused.footStrikePattern.confidence).toBe(winner.confidence)
    expect(fused.footStrikePattern.viewFit).toBe(winner.viewFit)
    expect(fused.footStrikePattern.sampleSize).toBe(winner.sampleSize)
    expect(fused.footStrikePattern.interpolatedFraction).toBe(winner.interpolatedFraction)
  })

  it('appends after the metric’s own caveat and after provenance', () => {
    const clip0 = makeResult(0.5, {
      footStrikePattern: footStrike(1, HEEL, { caveat: 'Foot strike pattern is an approximation.' }),
    })
    const clip1 = makeResult(0.5, { footStrikePattern: footStrike(1, FOREFOOT) })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.footStrikePattern.caveat).toBe(
      'Foot strike pattern is an approximation. Combined from clip 1 of 2. The clips disagree: ' +
        'clip 2 read a forefoot strike. Nothing here settles which clip is right.',
    )
  })

  it('stays silent when both clips land in the same band, however far apart the numbers', () => {
    const clip0 = makeResult(0.5, { footStrikePattern: footStrike(1, 0.06) })
    const clip1 = makeResult(0.5, { footStrikePattern: footStrike(1, 5) })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.footStrikePattern.caveat).toBe('Combined from clip 1 of 2.')
  })

  it('stays silent when only one clip resolved a value', () => {
    const clip0 = makeResult(0.5, { footStrikePattern: footStrike(1, HEEL) })
    const clip1 = makeResult(0.5, { footStrikePattern: footStrike(0, null) })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.footStrikePattern.caveat).toBe('Combined from clip 1 of 2.')
  })

  it('ignores a clip the panel would not render a card for at all', () => {
    // A front-view clip's foot-strike reading is `viewFit: 'unsuitable'` — the app already
    // declines to show it on its own, so quoting it as a contradiction would be worse than
    // silence.
    const clip0 = makeResult(0.5, { footStrikePattern: footStrike(1, HEEL) })
    const clip1 = makeResult(0.5, {
      footStrikePattern: footStrike(0.2, FOREFOOT, { viewFit: 'unsuitable' }),
    })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.footStrikePattern.caveat).toBe('Combined from clip 1 of 2.')
  })

  it('says nothing when the winner itself is excluded', () => {
    const clip0 = makeResult(0.5, {
      footStrikePattern: footStrike(0.2, HEEL, { viewFit: 'unsuitable' }),
    })
    const clip1 = makeResult(0.5, {
      footStrikePattern: footStrike(0.1, FOREFOOT, { viewFit: 'unsuitable' }),
    })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.footStrikePattern.caveat).toBe('Combined from clip 1 of 2.')
  })

  it('lists each disagreeing clip across a three-clip session', () => {
    const clip0 = makeResult(0.5, { footStrikePattern: footStrike(1, HEEL) })
    const clip1 = makeResult(0.5, { footStrikePattern: footStrike(1, FOREFOOT) })
    const clip2 = makeResult(0.5, { footStrikePattern: footStrike(1, MIDFOOT) })

    const fused = fuseFormHeuristicsResults([clip0, clip1, clip2])

    expect(fused.footStrikePattern.caveat).toBe(
      'Combined from clip 1 of 3. The clips disagree: clip 2 read a forefoot strike and clip 3 ' +
        'read a midfoot strike. Nothing here settles which clip is right.',
    )
  })

  it('says nothing for a metric that owns no band, however far apart the clips read', () => {
    // The measured `strides-5hj` overstriding pair: +0.512135 against -0.00809497, both at the
    // confidence ceiling. The sign differs and the magnitudes differ by half a torso — and -0.008
    // is indistinguishable from zero, so a sign rule would fire on noise here and would miss two
    // same-signed readings a torso apart. No band, no claim.
    const clip0 = makeResult(0.5, {
      overstriding: makeMetric('overstriding', 1, { value: 0.512135 }),
    })
    const clip1 = makeResult(0.5, {
      overstriding: makeMetric('overstriding', 1, { value: -0.00809497 }),
    })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.overstriding.caveat).toBe('Combined from clip 1 of 2.')
  })

  it('says nothing on a single-clip session, which stays reference-identical', () => {
    const solo = makeResult(0.5, { footStrikePattern: footStrike(1, FOREFOOT) })

    expect(fuseFormHeuristicsResults([solo])).toBe(solo)
    expect(fuseFormHeuristicsResults([solo]).footStrikePattern.caveat).toBeNull()
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
      armSwingAmplitude: makeMetric('armSwingAmplitude', 0.2, { value: 0.1, unit: 'ratio' }),
    })
    const clip1 = makeResult(0.5, {
      trunkLean: makeMetric('trunkLean', 0.3, { value: 99, unit: 'degrees' }),
      armSwingAmplitude: makeMetric('armSwingAmplitude', 0.8, { value: 0.7, unit: 'ratio' }),
    })

    const fused = fuseFormHeuristicsResults([clip0, clip1])

    expect(fused.trunkLean.value).toBe(5)
    expect(fused.trunkLean.caveat).toBe('Combined from clip 1 of 2.')
    expect(fused.armSwingAmplitude.value).toBe(0.7)
    expect(fused.armSwingAmplitude.caveat).toBe('Combined from clip 2 of 2.')
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
  footStrikePattern: 3,
  stepWidth: 2,
  stepWidthCm: 1,
  kneeDrive: 3,
  armSwingAmplitude: 0,
  swingFootLateralExcursion: 0,
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
    footStrikePattern: makeMetric('footStrikePattern', confidence('footStrikePattern'), { value }),
    stepWidth: makeMetric('stepWidth', confidence('stepWidth'), { value, unit: 'percent' }),
    stepWidthCm: makeMetric('stepWidthCm', confidence('stepWidthCm'), {
      value,
      unit: 'centimeters',
    }),
    kneeDrive: makeMetric('kneeDrive', confidence('kneeDrive'), { value, unit: 'degrees' }),
    armSwingAmplitude: makeMetric('armSwingAmplitude', confidence('armSwingAmplitude'), {
      value,
      unit: 'ratio',
    }),
    swingFootLateralExcursion: makeMetric('swingFootLateralExcursion', confidence('swingFootLateralExcursion'), {
      value,
      unit: 'percent',
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
      // `toContain`, not `toBe`: this fixture gives each clip a different `value` for every
      // metric, so `footStrikePattern`'s four values straddle the midfoot band and the fused
      // caveat correctly carries a disagreement sentence after the provenance one. Nothing about
      // provenance changed — only that it is no longer guaranteed to be the whole string.
      expect(fused[key].caveat).toContain(fusionProvenanceCaveat(indices[key], clips.length))
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
