import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { formatMeasuredBandValue } from './bandPosition'
import { formatBandNumber } from './formatBandValue'
import { MetricScale } from './MetricScale'
import { METRIC_GUIDANCE } from './metricGuidance'
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

/** Real bands only — a hand-built fake could not catch a defect in how the real data is shaped. */
function bandOf(metric: BandedMetric): ReferenceBand {
  const band = METRIC_GUIDANCE[metric].band
  if (band === null) throw new Error(`${metric} carries no band`)
  return band
}

/** For each band: a value inside, one just outside the envelope, and one far beyond it. */
const SAMPLE_VALUES: Record<BandedMetric, number[]> = {
  cadence: [172, 163.5, 153, 100, 260],
  verticalRatio: [0.031, 0.0372, 0.02, 0.052, 0.09],
  verticalOscillationCm: [7.1, 4.421467928439415, 1, 30],
  trunkLean: [10, -3, 60],
  kneeFlexion: [105, 130, 60, 20, 260],
}

/** Transcribed rather than imported, so the formatter under test cannot supply its own oracle. */
const UNIT_TEXT: Record<ReferenceBand['unit'], string> = {
  stepsPerMinute: ' steps/min',
  percent: '%',
  centimeters: ' cm',
  degrees: '°',
  ratio: '% of torso length',
}

/** The same, as a sentence spells it for a screen reader. */
const SPOKEN_UNIT_TEXT: Record<ReferenceBand['unit'], string> = {
  stepsPerMinute: ' steps per minute',
  percent: '%',
  centimeters: ' centimetres',
  degrees: ' degrees',
  ratio: '% of torso length',
}

function distinctBounds(band: ReferenceBand): number[] {
  const all = band.zones.flatMap((zone) =>
    [zone.min, zone.max].filter((bound) => bound !== null),
  )
  return [...new Set(all)].sort((a, b) => a - b)
}

function renderScale(metric: BandedMetric, value: number) {
  const label = `Metric ${metric}`
  const result = render(
    <MetricScale band={bandOf(metric)} value={value} label={label} />,
  )
  const figure = screen.getByRole('figure')
  return { ...result, figure, label }
}

/**
 * The figure's caption, which is its accessible name in every browser (HTML-AAM: a `<figure>` is
 * named by its `<figcaption>`). Read directly rather than through `toHaveAccessibleName`, because
 * `dom-accessibility-api` does not implement figcaption naming — and the component deliberately no
 * longer repeats it with an `aria-labelledby` that some screen readers announce twice.
 */
function captionOf(figure: HTMLElement): string {
  expect(figure).not.toHaveAttribute('aria-labelledby')
  expect(figure).not.toHaveAttribute('aria-label')
  return one(figure, 'figcaption').textContent ?? ''
}

/** Everything a reader who cannot see the graphic receives: the figure minus aria-hidden subtrees. */
function textWithoutGraphic(root: Element): string {
  const clone = root.cloneNode(true) as Element
  clone
    .querySelectorAll('[aria-hidden="true"]')
    .forEach((node) => node.remove())
  return clone.textContent ?? ''
}

function percentOf(element: Element): number {
  return parseFloat((element as HTMLElement).style.left)
}

function one(root: Element, selector: string): HTMLElement {
  const found = root.querySelectorAll<HTMLElement>(selector)
  expect(found).toHaveLength(1)
  return found[0]
}

describe('MetricScale — every published zone boundary renders', () => {
  it.each(BANDED)(
    '%s: a zone per published zone, a tick and a label per bound',
    (metric) => {
      const band = bandOf(metric)
      const bounds = distinctBounds(band)
      const { container, figure } = renderScale(
        metric,
        SAMPLE_VALUES[metric][0],
      )

      expect(container.querySelectorAll('.metric-scale__zone')).toHaveLength(
        band.zones.length,
      )
      expect(container.querySelectorAll('.metric-scale__tick')).toHaveLength(
        bounds.length,
      )
      const labels = [
        ...container.querySelectorAll('.metric-scale__bound-label'),
      ].map((node) => node.textContent)
      expect(labels).toEqual(
        bounds.map((bound) => formatBandNumber(bound, band.unit)),
      )

      // ...and the same bounds, with their unit, survive with the graphic removed.
      const text = textWithoutGraphic(figure)
      for (const zone of band.zones) {
        expect(text).toContain(zone.label)
        for (const bound of [zone.min, zone.max]) {
          if (bound !== null)
            expect(text).toContain(formatBandNumber(bound, band.unit))
        }
      }
    },
  )

  it('cadence renders all five zones rather than collapsing to 153–183', () => {
    const { figure } = renderScale('cadence', 172)
    const items = [...figure.querySelectorAll('.metric-scale__zone-item')].map(
      (node) => node.textContent,
    )
    expect(items).toEqual([
      'below 153 steps per minute: Below the 5th percentile',
      '153 to 163 steps per minute: 5th–29th percentile',
      '164 to 173 steps per minute: 30th–69th percentile',
      '174 to 183 steps per minute: 70th–95th percentile',
      'above 183 steps per minute: Above the 95th percentile',
    ])
  })

  it('verticalRatio lists its zones with labels in value order, lowest value first', () => {
    const { figure } = renderScale('verticalRatio', 0.031)
    const items = [...figure.querySelectorAll('.metric-scale__zone-item')].map(
      (node) => node.textContent,
    )
    expect(items).toEqual([
      "below 3.05%: Lowest 5% of values in Garmin's table",
      '3.05 to 3.70%: 5th–30th percentile by value',
      '3.75 to 4.30%: 31st–70th percentile by value',
      '4.35 to 5.05%: 71st–95th percentile by value',
      "above 5.05%: Highest 5% of values in Garmin's table",
    ])
  })

  it('keeps list semantics on the zone list, which a CSS list reset strips in Safari', () => {
    const { figure } = renderScale('cadence', 172)
    expect(one(figure, '.metric-scale__zones')).toHaveAttribute('role', 'list')
    expect(screen.getByRole('list')).toHaveAccessibleName(
      'Reference zones, lowest value first',
    )
  })

  it('draws a published gap as a gap: adjacent zones that do not touch do not touch on the track', () => {
    for (const metric of ['cadence', 'verticalRatio'] as const) {
      const { container, unmount } = renderScale(
        metric,
        SAMPLE_VALUES[metric][0],
      )
      const zones = [
        ...container.querySelectorAll<HTMLElement>('.metric-scale__zone'),
      ]
      const edges = zones.map((zone) => ({
        left: parseFloat(zone.style.left),
        right: parseFloat(zone.style.left) + parseFloat(zone.style.width),
      }))
      const band = bandOf(metric)
      for (let i = 1; i < band.zones.length; i++) {
        const touches = band.zones[i - 1].max === band.zones[i].min
        if (touches) expect(edges[i].left).toBeCloseTo(edges[i - 1].right, 6)
        else expect(edges[i].left).toBeGreaterThan(edges[i - 1].right)
      }
      unmount()
    }
  })

  it('extends open-ended zones to the ends of the track', () => {
    const { container } = renderScale('cadence', 172)
    const zones = [
      ...container.querySelectorAll<HTMLElement>('.metric-scale__zone'),
    ]
    expect(parseFloat(zones[0].style.left)).toBe(0)
    const last = zones[zones.length - 1]
    expect(
      parseFloat(last.style.left) + parseFloat(last.style.width),
    ).toBeCloseTo(100, 6)
  })
})

describe('MetricScale — the position is available without the graphic', () => {
  it('captions the figure with the value, its unit and the containing zone for cadence at 172', () => {
    const { figure, container } = renderScale('cadence', 172)
    expect(captionOf(figure)).toBe(
      'Metric cadence: 172 steps per minute falls in the zone labelled “30th–69th percentile” (values from 164 to 173 steps per minute).',
    )
    expect(one(container, '.metric-scale__graphic')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })

  it('carries value, unit and every bound in text for every band and sample value', () => {
    for (const metric of BANDED) {
      const band = bandOf(metric)
      for (const value of SAMPLE_VALUES[metric]) {
        const { figure, unmount } = renderScale(metric, value)
        const text = textWithoutGraphic(figure)
        const valueLabel =
          one(figure, '.metric-scale__value-label').textContent ?? ''
        // The graphic's label is the compact form; the text alternative carries the spoken one.
        const printedValue = valueLabel.replace(/[◂▸]/g, '').trim()
        expect(printedValue).toBe(formatMeasuredBandValue(band, value))
        expect(printedValue.endsWith(UNIT_TEXT[band.unit])).toBe(true)
        const spokenValue = formatMeasuredBandValue(band, value, 'spoken')
        expect(spokenValue.endsWith(SPOKEN_UNIT_TEXT[band.unit])).toBe(true)
        expect(text).toContain(spokenValue)
        for (const bound of distinctBounds(band)) {
          expect(text).toContain(formatBandNumber(bound, band.unit))
        }
        unmount()
      }
    }
  })

  it('verticalRatio: 0.031 prints as 3.10% and lands in the 3.05–3.70% zone', () => {
    const { figure, container } = renderScale('verticalRatio', 0.031)
    expect(captionOf(figure)).toBe(
      'Metric verticalRatio: 3.10% falls in the zone labelled “5th–30th percentile by value” (values from 3.05 to 3.70%).',
    )
    const text = figure.textContent ?? ''
    expect(text).not.toMatch(/310(\.0+)?%/)
    expect(text).not.toMatch(/\b0\.03%/)

    // On the track, too: the marker sits between the 3.05 and 3.70 ticks.
    const ticks = [...container.querySelectorAll('.metric-scale__tick')].map(
      percentOf,
    )
    const marker = percentOf(one(container, '.metric-scale__marker'))
    expect(marker).toBeGreaterThan(ticks[0])
    expect(marker).toBeLessThan(ticks[1])
  })

  it('a value in a gap in the source table says it falls between the two zones', () => {
    const { figure } = renderScale('verticalRatio', 0.0372)
    expect(captionOf(figure)).toBe(
      "Metric verticalRatio: 3.72% falls between the zones labelled “5th–30th percentile by value” (values from 3.05 to 3.70%) and “31st–70th percentile by value” (values from 3.75 to 4.30%), in a gap the source's table leaves between them.",
    )
  })

  it('verticalRatio above 5.05%: the zone label, the values and the position all run the same way', () => {
    const { figure } = renderScale('verticalRatio', 0.052)
    expect(captionOf(figure)).toBe(
      "Metric verticalRatio: 5.20% falls in the zone labelled “Highest 5% of values in Garmin's table” (values above 5.05%).",
    )
  })

  it('a cadence in the 163→164 gap prints a decimal rather than a "164" that reads as inside 164–173', () => {
    const { figure } = renderScale('cadence', 163.5)
    expect(captionOf(figure)).toBe(
      "Metric cadence: 163.5 steps per minute falls between the zones labelled “5th–29th percentile” (values from 153 to 163 steps per minute) and “30th–69th percentile” (values from 164 to 173 steps per minute), in a gap the source's table leaves between them.",
    )
    expect(one(figure, '.metric-scale__value-label').textContent).toBe(
      '163.5 steps/min',
    )
  })

  it('a value on a bound an open zone shares belongs to the closed zone, never to both', () => {
    const { figure } = renderScale('cadence', 153)
    expect(captionOf(figure)).toBe(
      'Metric cadence: 153 steps per minute falls in the zone labelled “5th–29th percentile” (values from 153 to 163 steps per minute).',
    )
  })

  it('never says "published" of a band, including the two derived ones', () => {
    for (const metric of BANDED) {
      for (const value of SAMPLE_VALUES[metric]) {
        const { container, unmount } = renderScale(metric, value)
        expect(container.textContent ?? '').not.toMatch(/publish/i)
        for (const element of container.querySelectorAll('[aria-label]')) {
          expect(element.getAttribute('aria-label')).not.toMatch(/publish/i)
        }
        unmount()
      }
    }
  })
})

describe('MetricScale — a value outside its band is reported, never silently clamped', () => {
  it('verticalOscillationCm at the 4.42 cm regression anchor: below the range, drawn where it falls', () => {
    const { figure, container } = renderScale(
      'verticalOscillationCm',
      4.421467928439415,
    )
    expect(captionOf(figure)).toBe(
      'Metric verticalOscillationCm: 4.4 centimetres is below the reference range (6.0 to 9.5 centimetres).',
    )
    const marker = one(container, '.metric-scale__marker')
    expect(marker).not.toHaveAttribute('data-clamped')
    expect(percentOf(marker)).toBeGreaterThan(0)
    const [lowerTick] = [
      ...container.querySelectorAll('.metric-scale__tick'),
    ].map(percentOf)
    expect(percentOf(marker)).toBeLessThan(lowerTick)
    expect(figure.textContent).not.toMatch(/drawn scale/)
  })

  it('a value far below the domain pins the marker to the lower edge and says so', () => {
    const { figure, container } = renderScale('verticalOscillationCm', 1)
    const marker = one(container, '.metric-scale__marker')
    expect(marker).toHaveAttribute('data-clamped', 'below')
    expect(percentOf(marker)).toBe(0)
    expect(captionOf(figure)).toBe(
      'Metric verticalOscillationCm: 1.0 centimetres is below the reference range (6.0 to 9.5 centimetres). It lies beyond the lower end of the drawn scale, so its marker is pinned at that end.',
    )
  })

  it('a value far above the domain pins the marker to the upper edge and says so', () => {
    const { figure, container } = renderScale('kneeFlexion', 260)
    const marker = one(container, '.metric-scale__marker')
    expect(marker).toHaveAttribute('data-clamped', 'above')
    expect(percentOf(marker)).toBe(100)
    expect(captionOf(figure)).toBe(
      'Metric kneeFlexion: 260.0 degrees is above the reference range (71.3 to 129.0 degrees). It lies beyond the upper end of the drawn scale, so its marker is pinned at that end.',
    )
  })

  it('verticalRatio far above the domain: one direction throughout, no word contradicting another', () => {
    const { figure, container } = renderScale('verticalRatio', 0.09)
    expect(one(container, '.metric-scale__marker')).toHaveAttribute(
      'data-clamped',
      'above',
    )
    expect(captionOf(figure)).toBe(
      "Metric verticalRatio: 9.00% falls in the zone labelled “Highest 5% of values in Garmin's table” (values above 5.05%). It lies beyond the upper end of the drawn scale, so its marker is pinned at that end.",
    )
    expect(captionOf(figure)).not.toMatch(/\b(below|lowest|lower)\b/i)
  })

  it('never leaves an unclamped marker at the edge, where it would read as clamped', () => {
    // Sweeps through the padding and the extension on both sides. Before the margin applied
    // inside the padded edge too, 10.37 cm drew at 99.9% — indistinguishable from a pinned marker.
    for (let value = 1.5; value <= 14; value += 0.01) {
      const { container, unmount } = renderScale('verticalOscillationCm', value)
      const marker = one(container, '.metric-scale__marker')
      if (!marker.hasAttribute('data-clamped')) {
        expect(percentOf(marker), `at ${value}`).toBeGreaterThanOrEqual(1.9)
        expect(percentOf(marker), `at ${value}`).toBeLessThanOrEqual(98.1)
      }
      unmount()
    }
  })

  it('inside an open-ended zone but beyond the drawn track: still the zone, and still says it is clamped', () => {
    const { figure, container } = renderScale('cadence', 100)
    expect(one(container, '.metric-scale__marker')).toHaveAttribute(
      'data-clamped',
      'below',
    )
    expect(captionOf(figure)).toBe(
      'Metric cadence: 100 steps per minute falls in the zone labelled “Below the 5th percentile” (values below 153 steps per minute). It lies beyond the lower end of the drawn scale, so its marker is pinned at that end.',
    )
  })

  it('never prints a number for the ends of the drawn domain — only published bounds and the value', () => {
    for (const metric of BANDED) {
      const band = bandOf(metric)
      const allowed = new Set(
        distinctBounds(band).map((bound) => formatBandNumber(bound, band.unit)),
      )
      for (const value of SAMPLE_VALUES[metric]) {
        const { container, unmount } = renderScale(metric, value)
        const graphic = one(container, '.metric-scale__graphic')
        const valueLabel =
          one(graphic, '.metric-scale__value-label').textContent ?? ''
        // Per text node: adjacent labels' textContent runs together into one bogus number.
        const walker = document.createTreeWalker(graphic, NodeFilter.SHOW_TEXT)
        const numbers: string[] = []
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          numbers.push(...(node.textContent?.match(/-?\d+(\.\d+)?/g) ?? []))
        }
        expect(numbers.length).toBeGreaterThan(distinctBounds(band).length)
        const valueNumbers: string[] = valueLabel.match(/-?\d+(\.\d+)?/g) ?? []
        for (const number of numbers) {
          expect(
            allowed.has(number) || valueNumbers.includes(number),
            `unexpected number ${number} on the ${metric} scale at ${value}`,
          ).toBe(true)
        }
        unmount()
      }
    }
  })
})

describe('MetricScale — no verdict in colour or words', () => {
  const COLOUR_CLASS =
    /\b(bg|text|border|fill|stroke|ring|outline|shadow|from|via|to|decoration|accent)-(red|green|emerald|rose|amber|yellow|lime|orange)-/
  const GRADING_WORD =
    /\b(good|bad|poor|optimal|ideal|excessive|healthy|target|normal|abnormal|better|worse|should|recommended)\b/i

  it.each(BANDED)(
    '%s carries no hue-graded class on any element, for any sample value',
    (metric) => {
      for (const value of SAMPLE_VALUES[metric]) {
        const { container, unmount } = renderScale(metric, value)
        for (const element of container.querySelectorAll('*')) {
          expect(element.getAttribute('class') ?? '').not.toMatch(COLOUR_CLASS)
        }
        unmount()
      }
    },
  )

  it.each(BANDED)(
    '%s applies no grading word, in visible text or in any aria attribute',
    (metric) => {
      for (const value of SAMPLE_VALUES[metric]) {
        const { container, unmount } = renderScale(metric, value)
        expect(container.textContent ?? '').not.toMatch(GRADING_WORD)
        for (const element of container.querySelectorAll('*')) {
          for (const attribute of ['aria-label', 'title', 'alt']) {
            expect(element.getAttribute(attribute) ?? '').not.toMatch(
              GRADING_WORD,
            )
          }
        }
        expect(container.textContent ?? '').not.toMatch(/[✓✔✗✘×]/)
        unmount()
      }
    },
  )

  it('does not draw the published central tendency as a mark', () => {
    const { container } = renderScale('trunkLean', 10)
    const numbers = [
      ...container.querySelectorAll('.metric-scale__bound-label'),
    ].map((node) => node.textContent)
    expect(numbers).not.toContain('10.3')
    expect(container.textContent).not.toContain('10.3')
  })
})

describe('MetricScale — a band with no finite extent', () => {
  it('draws no graphic but still states the position and the zones in text', () => {
    const band: ReferenceBand = {
      ...bandOf('cadence'),
      zones: [{ label: 'Open zone', min: null, max: null }],
    }
    const { container } = render(
      <MetricScale band={band} value={170} label="Cadence" />,
    )
    expect(container.querySelector('.metric-scale__graphic')).toBeNull()
    expect(captionOf(screen.getByRole('figure'))).toBe(
      'Cadence: 170 steps per minute falls in the range labelled “Open zone” (any value).',
    )
  })
})

describe('MetricScale — legibility of the marks', () => {
  function classesOf(element: Element): string[] {
    return (element.getAttribute('class') ?? '').split(/\s+/)
  }

  it('restates every mark in system colours under forced colours, so High Contrast does not erase it', () => {
    const { container } = renderScale('cadence', 172)
    expect(classesOf(one(container, '.metric-scale__track'))).toEqual(
      expect.arrayContaining([
        'forced-colors:forced-color-adjust-none',
        'forced-colors:bg-[Canvas]',
        'forced-colors:border-[CanvasText]',
      ]),
    )
    for (const tick of container.querySelectorAll('.metric-scale__tick')) {
      expect(classesOf(tick)).toContain('forced-colors:bg-[CanvasText]')
    }
    for (const zone of container.querySelectorAll('.metric-scale__zone')) {
      expect(classesOf(zone)).toEqual(
        expect.arrayContaining([
          'forced-colors:bg-[Canvas]',
          'forced-colors:border-x',
          'forced-colors:border-[CanvasText]',
        ]),
      )
    }
    expect(classesOf(one(container, '.metric-scale__marker'))).toEqual(
      expect.arrayContaining([
        'forced-colors:bg-[Highlight]',
        'forced-colors:ring-[Canvas]',
      ]),
    )
  })

  it('rings the marker so it clears 3:1 against either zone tint in both themes', () => {
    // Unringed, brand-700 on neutral-400 is 2.38:1 and brand-400 on neutral-500 is 2.10:1. Against
    // its own ring the marker is 6.17:1 (brand-700 on white) and 9.34:1 (brand-400 on black).
    const { container } = renderScale('cadence', 172)
    expect(classesOf(one(container, '.metric-scale__marker'))).toEqual(
      expect.arrayContaining(['ring-1', 'ring-white', 'dark:ring-black']),
    )
  })

  it('never overprints two bound labels in one row, at a 280 px track with a widened verticalRatio domain', () => {
    // 0.075 widens the domain almost to its limit, which squeezes the six bounds — and the two
    // pairs 3.70/3.75 and 4.30/4.35 sit about 1% apart — into under half the track.
    const TRACK_PX = 280
    // Generous for an 11 px sans-serif digit or point, so the check errs toward failing.
    const CHAR_PX = 7
    const { container } = renderScale('verticalRatio', 0.075)
    const labels = [
      ...container.querySelectorAll<HTMLElement>('.metric-scale__bound-label'),
    ].map((label) => {
      const width = (label.textContent ?? '').length * CHAR_PX
      // `anchorAt`: the label's left edge sits at percent × (track − label width).
      const left = (percentOf(label) / 100) * (TRACK_PX - width)
      return { row: Number(label.dataset.row), left, right: left + width }
    })
    expect(labels).toHaveLength(6)
    expect(Math.max(...labels.map((label) => label.row))).toBeGreaterThan(0)
    for (const a of labels) {
      for (const b of labels) {
        if (a === b || a.row !== b.row) continue
        const overlaps = a.left < b.right && b.left < a.right
        expect(
          overlaps,
          `row ${a.row}: ${a.left}–${a.right} vs ${b.left}–${b.right}`,
        ).toBe(false)
      }
    }
    // The label strip is as tall as the rows it uses.
    const rows = new Set(labels.map((label) => label.row)).size
    const strip = container.querySelector<HTMLElement>(
      '.metric-scale__bound-label',
    )!.parentElement!
    expect(strip.style.height).toBe(`${rows}rem`)
  })
})
