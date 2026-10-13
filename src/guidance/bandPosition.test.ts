import { describe, expect, it } from 'vitest'
import {
  bandBounds,
  describeBandPosition,
  describeBandPositionBriefly,
  describeBandPositionStandalone,
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

/**
 * A zone's label, read from the band rather than transcribed: the labels are the data layer's copy
 * and move with it, while what these tests pin is WHICH zone a value resolves to.
 */
function label(metric: BandedMetric, zoneIndex: number): string {
  return bandOf(metric).zones[zoneIndex].label
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
    ['cadence', 152.999, label('cadence', 0)],
    ['cadence', 153, label('cadence', 1)],
    ['cadence', 183, label('cadence', 3)],
    ['cadence', 183.001, label('cadence', 4)],
    // verticalRatio: <3.05% and >5.05%, stored 0..1; labels restated in value order
    ['verticalRatio', 0.03049, label('verticalRatio', 0)],
    ['verticalRatio', 0.0305, label('verticalRatio', 1)],
    ['verticalRatio', 0.0505, label('verticalRatio', 3)],
    ['verticalRatio', 0.05051, label('verticalRatio', 4)],
  ] as const)('%s at %s lands in exactly “%s”', (metric, value, expected) => {
    expect(where(locateInBand(bandOf(metric), value))).toBe(expected)
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
        { label: 'low', min: null, max: 150, shareOfRunners: null },
        { label: 'high', min: 190, max: null, shareOfRunners: null },
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
        { label: 'open', min: null, max: 160, shareOfRunners: null },
        { label: 'closed', min: 153, max: 163, shareOfRunners: null },
      ],
    }
    expect(where(locateInBand(band, 155))).toBe('closed')
    expect(where(locateInBand(band, 150))).toBe('open')
  })

  it('a closed zone is inclusive on both bounds', () => {
    expect(where(locateInBand(bandOf('cadence'), 163))).toBe(
      label('cadence', 1),
    )
    expect(where(locateInBand(bandOf('cadence'), 164))).toBe(
      label('cadence', 2),
    )
    expect(where(locateInBand(bandOf('trunkLean'), 1.8))).toBe(
      label('trunkLean', 0),
    )
    expect(where(locateInBand(bandOf('kneeFlexion'), 129))).toBe(
      label('kneeFlexion', 0),
    )
    expect(where(locateInBand(bandOf('kneeFlexion'), 71.3))).toBe(
      label('kneeFlexion', 0),
    )
  })
})

describe('locateInBand — gaps and the outside', () => {
  it('cadence 163.5 and 173.5 fall in Garmin’s published one-step gaps', () => {
    expect(where(locateInBand(bandOf('cadence'), 163.5))).toBe(
      `between ${label('cadence', 1)} | ${label('cadence', 2)}`,
    )
    expect(where(locateInBand(bandOf('cadence'), 173.5))).toBe(
      `between ${label('cadence', 2)} | ${label('cadence', 3)}`,
    )
  })

  it('verticalRatio 0.0372 falls between 3.70% and 3.75% — compared in the 0..1 domain', () => {
    expect(where(locateInBand(bandOf('verticalRatio'), 0.0372))).toBe(
      `between ${label('verticalRatio', 1)} | ${label('verticalRatio', 2)}`,
    )
    expect(where(locateInBand(bandOf('verticalRatio'), 0.0433))).toBe(
      `between ${label('verticalRatio', 2)} | ${label('verticalRatio', 3)}`,
    )
  })

  it('an open-ended zone contains everything past the envelope on its side', () => {
    expect(where(locateInBand(bandOf('cadence'), 40))).toBe(label('cadence', 0))
    expect(where(locateInBand(bandOf('verticalRatio'), 0.5))).toBe(
      label('verticalRatio', 4),
    )
  })

  it('a closed band reports a value past it as outside, naming the nearest bound', () => {
    expect(
      locateInBand(bandOf('verticalOscillationCm'), 4.421467928439415),
    ).toEqual({ kind: 'outside', side: 'below', nearestBound: 6.0 })
    expect(locateInBand(bandOf('kneeFlexion'), 130)).toEqual({
      kind: 'outside',
      side: 'above',
      nearestBound: 129,
    })
    expect(locateInBand(bandOf('kneeFlexion'), 60)).toEqual({
      kind: 'outside',
      side: 'below',
      nearestBound: 71.3,
    })
    expect(locateInBand(bandOf('trunkLean'), 1.79)).toEqual({
      kind: 'outside',
      side: 'below',
      nearestBound: 1.8,
    })
  })
})

describe('bandBounds, and the envelope the scale is drawn over', () => {
  it('lists every distinct published bound once, ascending', () => {
    expect(bandBounds(bandOf('cadence'))).toEqual([
      153, 163, 164, 173, 174, 183,
    ])
    expect(bandBounds(bandOf('verticalRatio'))).toEqual([
      0.0305, 0.037, 0.0375, 0.043, 0.0435, 0.0505,
    ])
  })

  // Regression for the deleted `bandExtent`, which duplicated `referenceBandEnvelope` while that
  // helper read edges from `min`s and `max`es separately (fixed in f050977). The scale and the
  // "outside" sentence both take their extent from `referenceBandEnvelope` now, so pin it literally.
  it.each([
    ['cadence', { min: 153, max: 183 }],
    ['verticalRatio', { min: 0.0305, max: 0.0505 }],
    ['verticalOscillationCm', { min: 6.0, max: 9.5 }],
    ['trunkLean', { min: 1.8, max: 21.4 }],
    ['kneeFlexion', { min: 71.3, max: 129 }],
  ] as const)('%s is drawn over the literal extent %o', (metric, extent) => {
    expect(referenceBandEnvelope(bandOf(metric))).toEqual(extent)
  })

  it('takes both edges from every finite bound, of either kind', () => {
    const band: ReferenceBand = {
      ...bandOf('cadence'),
      zones: [
        { label: 'low', min: null, max: 3, shareOfRunners: null },
        { label: 'high', min: 5, max: null, shareOfRunners: null },
      ],
    }
    expect(referenceBandEnvelope(band)).toEqual({ min: 3, max: 5 })
    expect(
      referenceBandEnvelope({
        ...band,
        zones: [{ label: 'all', min: null, max: null, shareOfRunners: null }],
      }),
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
    expect(formatMeasuredBandValue(bandOf('kneeFlexion'), 129.04)).toBe(
      '129.04°',
    )
    expect(formatMeasuredBandValue(bandOf('verticalRatio'), 0.03702)).toBe(
      '3.702%',
    )
  })

  it('prints a value that IS a bound at source precision', () => {
    expect(formatMeasuredBandValue(bandOf('cadence'), 153)).toBe(
      '153 steps/min',
    )
  })

  it('states a value still printing as a bound at the precision cap relative to that bound', () => {
    // At three extra digits 163.99999999 still prints "164.000", which would contradict the
    // sentence placing it in the gap below 164. Bounded: the cap is checked once, never looped.
    expect(formatMeasuredBandValue(bandOf('cadence'), 163.99999999)).toBe(
      'just under 164 steps/min',
    )
    expect(formatMeasuredBandValue(bandOf('cadence'), 173.00000001)).toBe(
      'just over 173 steps/min',
    )
    expect(
      describeBandPosition(bandOf('cadence'), 163.99999999).startsWith(
        'Just under 164 steps per minute sits in the gap between the zones labelled',
      ),
    ).toBe(true)
  })

  it('spells the unit in the spoken style', () => {
    expect(formatMeasuredBandValue(bandOf('cadence'), 172, 'spoken')).toBe(
      '172 steps per minute',
    )
    expect(formatMeasuredBandValue(bandOf('kneeFlexion'), 105, 'spoken')).toBe(
      '105.0 degrees',
    )
  })
})

describe('describeBandPosition', () => {
  // Zone labels are read from the band (see `label`); the numbers, the units and the sentence
  // shapes are what these rows pin.
  const quoted = (metric: BandedMetric, zoneIndex: number) =>
    `“${label(metric, zoneIndex)}”`
  it.each([
    [
      'cadence',
      172,
      `172 steps per minute falls in the zone labelled ${quoted('cadence', 2)} (values from 164 to 173 steps per minute).`,
    ],
    [
      'cadence',
      153,
      `153 steps per minute falls in the zone labelled ${quoted('cadence', 1)} (values from 153 to 163 steps per minute).`,
    ],
    [
      'cadence',
      140,
      `140 steps per minute falls in the zone labelled ${quoted('cadence', 0)} (values below 153 steps per minute).`,
    ],
    [
      'cadence',
      163.5,
      `163.5 steps per minute sits in the gap between the zones labelled ${quoted('cadence', 1)} and ${quoted('cadence', 2)}; the source's table jumps from 163 steps per minute to 164 steps per minute.`,
    ],
    [
      'verticalRatio',
      0.031,
      `3.10% falls in the zone labelled ${quoted('verticalRatio', 1)} (values from 3.05 to 3.70%).`,
    ],
    [
      'verticalRatio',
      0.0372,
      `3.72% sits in the gap between the zones labelled ${quoted('verticalRatio', 1)} and ${quoted('verticalRatio', 2)}; the range shown jumps from 3.70% to 3.75%.`,
    ],
    [
      'verticalRatio',
      0.03,
      `3.00% falls in the zone labelled ${quoted('verticalRatio', 0)} (values below 3.05%).`,
    ],
    [
      'verticalRatio',
      0.052,
      `5.20% falls in the zone labelled ${quoted('verticalRatio', 4)} (values above 5.05%).`,
    ],
    [
      'verticalOscillationCm',
      4.421467928439415,
      '4.4 centimetres is below the range shown (6.0 to 9.5 centimetres).',
    ],
    [
      'trunkLean',
      10,
      `10.0 degrees falls in the range labelled ${quoted('trunkLean', 0)} (values from 1.8 to 21.4 degrees).`,
    ],
    [
      'kneeFlexion',
      105,
      `105.0 degrees falls in the range labelled ${quoted('kneeFlexion', 0)} (values from 71.3 to 129.0 degrees).`,
    ],
    [
      'kneeFlexion',
      60,
      '60.0 degrees is below the range shown (71.3 to 129.0 degrees).',
    ],
    [
      'kneeFlexion',
      130,
      '130.0 degrees is above the range shown (71.3 to 129.0 degrees).',
    ],
  ] as const)('%s at %s', (metric, value, sentence) => {
    expect(describeBandPosition(bandOf(metric), value)).toBe(sentence)
  })

  it("names the gap's two numbers from the zones, and credits the source's table only on an underived band", () => {
    const gapped: ReferenceBand = {
      ...bandOf('cadence'),
      derivation: null,
      zones: [
        { label: 'first', min: 10, max: 20, shareOfRunners: null },
        { label: 'second', min: 25, max: 30, shareOfRunners: null },
      ],
    }
    expect(describeBandPosition(gapped, 22)).toBe(
      "22 steps per minute sits in the gap between the zones labelled “first” and “second”; the source's table jumps from 20 steps per minute to 25 steps per minute.",
    )
    const derived = {
      ...gapped,
      derivation: { statement: 'Halved.', restsOn: [] },
    }
    expect(describeBandPosition(derived, 22)).toBe(
      '22 steps per minute sits in the gap between the zones labelled “first” and “second”; the range shown jumps from 20 steps per minute to 25 steps per minute.',
    )
  })

  it('never calls the band "the reference range" — the words are "the range shown"', () => {
    for (const metric of BANDED) {
      const band = bandOf(metric)
      const envelope = referenceBandEnvelope(band)!
      const width = envelope.max - envelope.min
      for (let step = -20; step <= 40; step++) {
        const value = envelope.min + (width * step) / 20
        expect(describeBandPosition(band, value)).not.toMatch(/reference range/)
      }
    }
  })

  it('names the nearest bound when the band has no finite range to quote', () => {
    const band: ReferenceBand = {
      ...bandOf('verticalOscillationCm'),
      zones: [{ label: 'open above', min: 6, max: null, shareOfRunners: null }],
    }
    expect(describeBandPosition(band, 4)).toBe(
      '4.0 centimetres is below the range shown, which starts at 6.0 centimetres.',
    )
  })

  it('never calls a band or zone "published" — a derived band was not published as such', () => {
    for (const metric of BANDED) {
      const band = bandOf(metric)
      const envelope = referenceBandEnvelope(band)!
      const width = envelope.max - envelope.min
      for (let step = -20; step <= 40; step++) {
        const value = envelope.min + (width * step) / 20
        expect(describeBandPosition(band, value)).not.toMatch(/publish/i)
      }
    }
    // Both derived bands, at a value in, between and outside their zones.
    for (const [metric, values] of [
      ['verticalRatio', [0.03, 0.0372, 0.09]],
      ['verticalOscillationCm', [7, 4.4, 12]],
    ] as const) {
      expect(bandOf(metric).derivation).not.toBeNull()
      for (const value of values) {
        expect(describeBandPosition(bandOf(metric), value)).not.toMatch(
          /publish/i,
        )
      }
    }
  })

  it('uses " to " between numbers and spells units, never an en dash or "steps/min"', () => {
    for (const metric of BANDED) {
      const band = bandOf(metric)
      const envelope = referenceBandEnvelope(band)!
      const width = envelope.max - envelope.min
      for (let step = -20; step <= 40; step++) {
        const sentence = describeBandPosition(
          band,
          envelope.min + (width * step) / 20,
        )
        // Strip the quoted labels — those are the source's text (cadence's "30th–69th").
        const own = sentence.replace(/“[^”]*”/g, '')
        expect(own).not.toMatch(/\d–|steps\/min|°| cm\b/)
      }
    }
  })

  it('uses no grading word across a sweep of every band', () => {
    const GRADING_WORD =
      /\b(good|bad|poor|optimal|ideal|excessive|healthy|target|normal|abnormal|better|worse|should|recommended)\b/i
    for (const metric of BANDED) {
      const band = bandOf(metric)
      const envelope = referenceBandEnvelope(band)!
      const width = envelope.max - envelope.min
      for (let step = -20; step <= 40; step++) {
        const value = envelope.min + (width * step) / 20
        expect(describeBandPosition(band, value)).not.toMatch(GRADING_WORD)
      }
    }
  })
})

describe('describeBandPositionBriefly — the card headline’s position fragment', () => {
  /**
   * The whole headline, value and position, exactly as the card prints it — so this table is read
   * against what a reader sees rather than against a fragment.
   */
  function headline(metric: BandedMetric, value: number): string {
    const band = bandOf(metric)
    return `${formatMeasuredBandValue(band, value)} · ${describeBandPositionBriefly(band, value)}`
  }

  it.each([
    [
      'cadence',
      172,
      "172 steps/min · 30th–69th percentile of Garmin's table",
    ],
    [
      'cadence',
      163.5,
      "163.5 steps/min · between the 5th–29th and 30th–69th percentiles of Garmin's table",
    ],
    [
      'cadence',
      150,
      "150 steps/min · below the 5th percentile of Garmin's table",
    ],
    [
      'cadence',
      190,
      "190 steps/min · above the 95th percentile of Garmin's table",
    ],
    ['verticalRatio', 0.0246, "2.46% · lowest 5% of Garmin's table"],
    [
      'verticalRatio',
      0.0372,
      "3.72% · between the 5th–30th and 31st–70th percentiles of Garmin's table",
    ],
    ['verticalRatio', 0.06, "6.00% · highest 5% of Garmin's table"],
    ['verticalOscillationCm', 4.42, '4.4 cm · below the range shown'],
    ['verticalOscillationCm', 7.2, '7.2 cm · within the range shown'],
    ['verticalOscillationCm', 10.5, '10.5 cm · above the range shown'],
    ['trunkLean', 4.2, '4.2° · within the range shown'],
    ['kneeFlexion', 60, '60.0° · below the range shown'],
    ['kneeFlexion', 102.9, '102.9° · within the range shown'],
  ] as const)('%s at %s reads "%s"', (metric, value, expected) => {
    expect(headline(metric, value)).toBe(expected)
  })

  it('names whose zones they are on every multi-zone band, at every sample value', () => {
    for (const metric of BANDED) {
      const band = bandOf(metric)
      if (band.zones.length === 1) continue
      for (const value of [
        ...bandBounds(band),
        ...bandBounds(band).map((bound) => bound + 0.5),
      ]) {
        const brief = describeBandPositionBriefly(band, value)
        if (/the range shown/.test(brief)) continue
        expect(/Garmin/.test(brief), `${metric} at ${value}: ${brief}`).toBe(
          true,
        )
      }
    }
  })

  it('applies no grading word and quotes no bound, on any band at any of its bounds', () => {
    const GRADING =
      /\b(good|bad|poor|optimal|ideal|excessive|healthy|target|normal|abnormal|better|worse|should|recommended)\b/i
    for (const metric of BANDED) {
      const band = bandOf(metric)
      for (const bound of bandBounds(band)) {
        for (const value of [bound - 0.5, bound, bound + 0.5]) {
          const brief = describeBandPositionBriefly(band, value)
          expect(brief, `${metric} at ${value}`).not.toMatch(GRADING)
          // The scale prints the bounds; the headline states a position, not a range.
          expect(brief, `${metric} at ${value}`).not.toMatch(/\d+\.\d/)
        }
      }
    }
  })

  it('quotes both labels whole where they share no tail to merge', () => {
    // Not a shipped shape — no rule should depend on two labels happening to rhyme.
    const band: ReferenceBand = {
      ...bandOf('cadence'),
      zoneOwner: null,
      zones: [
        { label: 'Low readings', min: 150, max: 160, shareOfRunners: null },
        { label: 'Often seen', min: 170, max: 180, shareOfRunners: null },
      ],
    }
    expect(describeBandPositionBriefly(band, 165)).toBe(
      'between “Low readings” and “Often seen”',
    )
  })

  it('agrees with the long sentence about which zone the value is in', () => {
    // The two are written separately, so this is where they are held to the same answer.
    for (const metric of BANDED) {
      const band = bandOf(metric)
      for (const bound of bandBounds(band)) {
        for (const value of [bound - 0.5, bound, bound + 0.5]) {
          const position = locateInBand(band, value)
          const brief = describeBandPositionBriefly(band, value)
          if (position.kind === 'inZone' && band.zones.length > 1) {
            expect(brief.startsWith(lowercaseFirst(position.zone.label))).toBe(
              true,
            )
          }
          if (position.kind === 'outside') {
            expect(brief).toBe(`${position.side} the range shown`)
          }
        }
      }
    }
  })
})

function lowercaseFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

describe('describeBandPositionStandalone — a position with no scale beside it', () => {
  it('names a single range by its own bounds rather than "the range shown"', () => {
    const band = bandOf('verticalOscillationCm')
    expect(describeBandPositionStandalone(band, 10.4)).toBe(
      'above the 6.0–9.5 cm range',
    )
    expect(describeBandPositionStandalone(band, 4.42)).toBe(
      'below the 6.0–9.5 cm range',
    )
    expect(describeBandPositionStandalone(band, 8)).toBe(
      'within the 6.0–9.5 cm range',
    )
  })

  it('reads as the brief fragment wherever a zone label already names its owner', () => {
    const band = bandOf('cadence')
    for (const value of [150, 163.5, 170, 190]) {
      expect(describeBandPositionStandalone(band, value), String(value)).toBe(
        describeBandPositionBriefly(band, value),
      )
    }
    expect(describeBandPositionStandalone(band, 150)).toBe(
      "below the 5th percentile of Garmin's table",
    )
  })

  it('never says "the range shown"', () => {
    for (const metric of BANDED) {
      const band = bandOf(metric)
      const envelope = referenceBandEnvelope(band)!
      const span = envelope.max - envelope.min
      for (const value of [
        envelope.min - span,
        (envelope.min + envelope.max) / 2,
        envelope.max + span,
      ]) {
        expect(
          describeBandPositionStandalone(band, value),
          `${metric} ${value}`,
        ).not.toMatch(/range shown/)
      }
    }
  })
})
