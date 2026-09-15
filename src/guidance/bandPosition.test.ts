import { describe, expect, it } from 'vitest'
import {
  bandBounds,
  bandExtent,
  describeBandPosition,
  formatMeasuredBandValue,
  locateInBand,
} from './bandPosition'
import type { BandPosition } from './bandPosition'
import { METRIC_GUIDANCE } from './metricGuidance'
import { referenceBandEnvelope } from './types'
import type { ReferenceBand } from './types'

type BandedMetric =
  | 'cadence'
  | 'verticalRatio'
  | 'verticalOscillationCm'
  | 'trunkLean'
  | 'kneeFlexion'

const BANDED: BandedMetric[] = [
  'cadence',
  'verticalRatio',
  'verticalOscillationCm',
  'trunkLean',
  'kneeFlexion',
]

function bandOf(metric: BandedMetric): ReferenceBand {
  const band = METRIC_GUIDANCE[metric].band
  if (band === null) throw new Error(`${metric} carries no band`)
  return band
}

/** The published label of the zone a value lands in, or a description of where it landed instead. */
function where(position: BandPosition): string {
  switch (position.kind) {
    case 'inZone':
      return position.zone.label
    case 'betweenZones':
      return `between ${position.lower.label} | ${position.upper.label}`
    case 'outside':
      return `${position.side} ${position.nearestBound}`
  }
}

describe('locateInBand — an open-ended zone is strict on its finite bound', () => {
  it.each([
    // cadence: Garmin publishes <153 and >183
    ['cadence', 152.999, 'Below the 5th percentile'],
    ['cadence', 153, '5th–29th percentile'],
    ['cadence', 183, '70th–95th percentile'],
    ['cadence', 183.001, 'Above the 95th percentile'],
    // verticalRatio: <3.05% and >5.05%, stored 0..1
    ['verticalRatio', 0.03049, 'Above the 95th percentile'],
    ['verticalRatio', 0.0305, '70th–95th percentile'],
    ['verticalRatio', 0.0505, '5th–29th percentile'],
    ['verticalRatio', 0.05051, 'Below the 5th percentile'],
  ] as const)('%s at %d lands in exactly “%s”', (metric, value, label) => {
    expect(where(locateInBand(bandOf(metric), value))).toBe(label)
  })

  it('never resolves a value to two zones: at and either side of every bound, one answer', () => {
    for (const metric of BANDED) {
      const band = bandOf(metric)
      for (const bound of bandBounds(band)) {
        for (const value of [bound - 1e-9, bound, bound + 1e-9]) {
          const position = locateInBand(band, value)
          if (position.kind !== 'inZone') continue
          // The zone it names really does admit the value under the published rule…
          const { min, max } = position.zone
          const closed = min !== null && max !== null
          if (closed) {
            expect(value).toBeGreaterThanOrEqual(min)
            expect(value).toBeLessThanOrEqual(max)
          } else {
            if (min !== null) expect(value).toBeGreaterThan(min)
            if (max !== null) expect(value).toBeLessThan(max)
          }
          // …and no closed zone other than it also admits the value.
          const alsoClosed = band.zones.filter(
            (zone) =>
              zone !== position.zone &&
              zone.min !== null &&
              zone.max !== null &&
              value >= zone.min &&
              value <= zone.max,
          )
          expect(alsoClosed).toEqual([])
        }
      }
    }
  })

  it('holds without a touching closed zone: an open zone excludes its own bound', () => {
    // Not a shipped shape — on the shipped bands every open bound is shared with a closed zone,
    // which would win first anyway. This pins the strictness itself.
    const band: ReferenceBand = {
      ...bandOf('cadence'),
      zones: [
        { label: 'low', min: null, max: 150 },
        { label: 'high', min: 190, max: null },
      ],
    }
    expect(where(locateInBand(band, 149.9))).toBe('low')
    expect(where(locateInBand(band, 150))).toBe('between low | high')
    expect(where(locateInBand(band, 190))).toBe('between low | high')
    expect(where(locateInBand(band, 190.1))).toBe('high')
    expect(where(locateInBand({ ...band, zones: [band.zones[0]] }, 150))).toBe(
      'above 150',
    )
  })

  it('checks closed zones before open ones, so even overlapping zones yield one answer', () => {
    const band: ReferenceBand = {
      ...bandOf('cadence'),
      zones: [
        { label: 'open', min: null, max: 160 },
        { label: 'closed', min: 153, max: 163 },
      ],
    }
    expect(where(locateInBand(band, 155))).toBe('closed')
    expect(where(locateInBand(band, 150))).toBe('open')
  })

  it('a closed zone is inclusive on both bounds', () => {
    expect(where(locateInBand(bandOf('cadence'), 163))).toBe(
      '5th–29th percentile',
    )
    expect(where(locateInBand(bandOf('cadence'), 164))).toBe(
      '30th–69th percentile',
    )
    expect(where(locateInBand(bandOf('trunkLean'), 1.8))).toBe(
      'Full range observed across the cohort',
    )
    expect(where(locateInBand(bandOf('kneeFlexion'), 125))).toBe(
      'Pooled across running speeds and across two measurement conventions',
    )
  })
})

describe('locateInBand — gaps and the outside', () => {
  it('cadence 163.5 and 173.5 fall in Garmin’s published one-step gaps', () => {
    expect(where(locateInBand(bandOf('cadence'), 163.5))).toBe(
      'between 5th–29th percentile | 30th–69th percentile',
    )
    expect(where(locateInBand(bandOf('cadence'), 173.5))).toBe(
      'between 30th–69th percentile | 70th–95th percentile',
    )
  })

  it('verticalRatio 0.0372 falls between 3.70% and 3.75% — compared in the 0..1 domain', () => {
    expect(where(locateInBand(bandOf('verticalRatio'), 0.0372))).toBe(
      'between 70th–95th percentile | 30th–69th percentile',
    )
    expect(where(locateInBand(bandOf('verticalRatio'), 0.0433))).toBe(
      'between 30th–69th percentile | 5th–29th percentile',
    )
  })

  it('an open-ended zone contains everything past the envelope on its side', () => {
    expect(where(locateInBand(bandOf('cadence'), 40))).toBe(
      'Below the 5th percentile',
    )
    expect(where(locateInBand(bandOf('verticalRatio'), 0.5))).toBe(
      'Below the 5th percentile',
    )
  })

  it('a closed band reports a value past it as outside, naming the nearest bound', () => {
    expect(
      locateInBand(bandOf('verticalOscillationCm'), 4.421467928439415),
    ).toEqual({ kind: 'outside', side: 'below', nearestBound: 6.0 })
    expect(locateInBand(bandOf('kneeFlexion'), 130)).toEqual({
      kind: 'outside',
      side: 'above',
      nearestBound: 125,
    })
    expect(locateInBand(bandOf('trunkLean'), 1.79)).toEqual({
      kind: 'outside',
      side: 'below',
      nearestBound: 1.8,
    })
  })
})

describe('bandBounds and bandExtent', () => {
  it('lists every distinct published bound once, ascending', () => {
    expect(bandBounds(bandOf('cadence'))).toEqual([
      153, 163, 164, 173, 174, 183,
    ])
    expect(bandBounds(bandOf('verticalRatio'))).toEqual([
      0.0305, 0.037, 0.0375, 0.043, 0.0435, 0.0505,
    ])
  })

  it.each(BANDED)('%s: extent equals referenceBandEnvelope', (metric) => {
    expect(bandExtent(bandOf(metric))).toEqual(
      referenceBandEnvelope(bandOf(metric)),
    )
  })

  it('takes both edges from every finite bound, of either kind', () => {
    const band: ReferenceBand = {
      ...bandOf('cadence'),
      zones: [
        { label: 'low', min: null, max: 3 },
        { label: 'high', min: 5, max: null },
      ],
    }
    expect(bandExtent(band)).toEqual({ min: 3, max: 5 })
    expect(
      bandExtent({ ...band, zones: [{ label: 'all', min: null, max: null }] }),
    ).toBeNull()
  })
})

describe('formatMeasuredBandValue', () => {
  it('prints at published precision when nothing collides', () => {
    expect(formatMeasuredBandValue(bandOf('cadence'), 172)).toBe(
      '172 steps/min',
    )
    expect(formatMeasuredBandValue(bandOf('verticalRatio'), 0.031)).toBe(
      '3.10%',
    )
    expect(
      formatMeasuredBandValue(
        bandOf('verticalOscillationCm'),
        4.421467928439415,
      ),
    ).toBe('4.4 cm')
  })

  it('adds a digit when the value would print as a bound it does not equal', () => {
    // 163.5 rounds to "164", which would read as inside 164–173.
    expect(formatMeasuredBandValue(bandOf('cadence'), 163.5)).toBe(
      '163.5 steps/min',
    )
    expect(formatMeasuredBandValue(bandOf('kneeFlexion'), 125.04)).toBe(
      '125.04°',
    )
    expect(formatMeasuredBandValue(bandOf('verticalRatio'), 0.03702)).toBe(
      '3.702%',
    )
  })

  it('prints a value that IS a bound at published precision', () => {
    expect(formatMeasuredBandValue(bandOf('cadence'), 153)).toBe(
      '153 steps/min',
    )
  })
})

describe('describeBandPosition', () => {
  it.each([
    [
      'cadence',
      172,
      '172 steps/min falls in the zone published as “30th–69th percentile” (164–173 steps/min).',
    ],
    [
      'cadence',
      153,
      '153 steps/min falls in the zone published as “5th–29th percentile” (153–163 steps/min).',
    ],
    [
      'cadence',
      140,
      '140 steps/min falls in the zone published as “Below the 5th percentile” (below 153 steps/min).',
    ],
    [
      'cadence',
      163.5,
      '163.5 steps/min falls between the zones published as “5th–29th percentile” (153–163 steps/min) and “30th–69th percentile” (164–173 steps/min), in a gap the published table leaves between them.',
    ],
    [
      'verticalRatio',
      0.031,
      '3.10% falls in the zone published as “70th–95th percentile” (3.05–3.70%).',
    ],
    [
      'verticalRatio',
      0.0372,
      '3.72% falls between the zones published as “70th–95th percentile” (3.05–3.70%) and “30th–69th percentile” (3.75–4.30%), in a gap the published table leaves between them.',
    ],
    [
      'verticalOscillationCm',
      4.421467928439415,
      '4.4 cm is below the published range (6.0–9.5 cm).',
    ],
    [
      'trunkLean',
      10,
      '10.0° falls in the range published as “Full range observed across the cohort” (1.8–21.4°).',
    ],
    ['kneeFlexion', 130, '130.0° is above the published range (85.0–125.0°).'],
  ] as const)('%s at %d', (metric, value, sentence) => {
    expect(describeBandPosition(bandOf(metric), value)).toBe(sentence)
  })

  it('names the nearest bound when the band has no finite range to quote', () => {
    const band: ReferenceBand = {
      ...bandOf('verticalOscillationCm'),
      zones: [{ label: 'open above', min: 6, max: null }],
    }
    expect(describeBandPosition(band, 4)).toBe(
      '4.0 cm is below the published range, which starts at 6.0 cm.',
    )
  })

  it('uses no grading word across a sweep of every band', () => {
    const GRADING_WORD =
      /\b(good|bad|poor|optimal|ideal|excessive|healthy|target|normal|abnormal|better|worse|should|recommended)\b/i
    for (const metric of BANDED) {
      const band = bandOf(metric)
      const extent = bandExtent(band)!
      const width = extent.max - extent.min
      for (let step = -20; step <= 40; step++) {
        const value = extent.min + (width * step) / 20
        expect(describeBandPosition(band, value)).not.toMatch(GRADING_WORD)
      }
    }
  })
})
