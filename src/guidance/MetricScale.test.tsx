import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
  verticalRatio: [0.031, 0.0372, 0.02, 0.09],
  verticalOscillationCm: [7.1, 4.421467928439415, 1, 30],
  trunkLean: [10, -3, 60],
  kneeFlexion: [110, 130, 20, 200],
}

/** Transcribed rather than imported, so the formatter under test cannot supply its own oracle. */
const UNIT_TEXT: Record<ReferenceBand['unit'], string> = {
  stepsPerMinute: ' steps/min',
  percent: '%',
  centimeters: ' cm',
  degrees: '°',
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
      'below 153 steps/min — Below the 5th percentile',
      '153–163 steps/min — 5th–29th percentile',
      '164–173 steps/min — 30th–69th percentile',
      '174–183 steps/min — 70th–95th percentile',
      'above 183 steps/min — Above the 95th percentile',
    ])
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
  it('names the figure with the value, its unit and the containing zone for cadence at 172', () => {
    const { figure, container } = renderScale('cadence', 172)
    expect(figure).toHaveAccessibleName(
      'Metric cadence: 172 steps/min falls in the zone published as “30th–69th percentile” (164–173 steps/min).',
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
        const printedValue = valueLabel.replace(/[◂▸]/g, '').trim()
        expect(text).toContain(printedValue)
        expect(printedValue.endsWith(UNIT_TEXT[band.unit])).toBe(true)
        for (const bound of distinctBounds(band)) {
          expect(text).toContain(formatBandNumber(bound, band.unit))
        }
        unmount()
      }
    }
  })

  it('verticalRatio: 0.031 prints as 3.10% and lands in the 3.05–3.70% zone', () => {
    const { figure, container } = renderScale('verticalRatio', 0.031)
    expect(figure).toHaveAccessibleName(
      'Metric verticalRatio: 3.10% falls in the zone published as “70th–95th percentile” (3.05–3.70%).',
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

  it('a value in a published gap says it falls between the two zones', () => {
    renderScale('verticalRatio', 0.0372)
    expect(screen.getByRole('figure')).toHaveAccessibleName(
      'Metric verticalRatio: 3.72% falls between the zones published as “70th–95th percentile” (3.05–3.70%) and “30th–69th percentile” (3.75–4.30%), in a gap the published table leaves between them.',
    )
  })

  it('a cadence in the 163→164 gap prints a decimal rather than a "164" that reads as inside 164–173', () => {
    const { figure } = renderScale('cadence', 163.5)
    expect(figure).toHaveAccessibleName(
      'Metric cadence: 163.5 steps/min falls between the zones published as “5th–29th percentile” (153–163 steps/min) and “30th–69th percentile” (164–173 steps/min), in a gap the published table leaves between them.',
    )
  })

  it('a value on a bound an open zone shares belongs to the closed zone, never to both', () => {
    const { figure } = renderScale('cadence', 153)
    expect(figure).toHaveAccessibleName(
      'Metric cadence: 153 steps/min falls in the zone published as “5th–29th percentile” (153–163 steps/min).',
    )
  })
})

describe('MetricScale — a value outside its band is reported, never silently clamped', () => {
  it('verticalOscillationCm at the 4.42 cm regression anchor: below the range, drawn where it falls', () => {
    const { figure, container } = renderScale(
      'verticalOscillationCm',
      4.421467928439415,
    )
    expect(figure).toHaveAccessibleName(
      'Metric verticalOscillationCm: 4.4 cm is below the published range (6.0–9.5 cm).',
    )
    const marker = one(container, '.metric-scale__marker')
    expect(marker).not.toHaveAttribute('data-clamped')
    expect(percentOf(marker)).toBeGreaterThan(0)
    const [lowerTick] = [
      ...container.querySelectorAll('.metric-scale__tick'),
    ].map(percentOf)
    expect(percentOf(marker)).toBeLessThan(lowerTick)
    expect(figure.textContent).not.toMatch(/rendered range/)
  })

  it('a value far below the domain pins the marker to the lower edge and says so', () => {
    const { figure, container } = renderScale('verticalOscillationCm', 1)
    const marker = one(container, '.metric-scale__marker')
    expect(marker).toHaveAttribute('data-clamped', 'below')
    expect(percentOf(marker)).toBe(0)
    expect(figure).toHaveAccessibleName(
      "Metric verticalOscillationCm: 1.0 cm is below the published range (6.0–9.5 cm). It is below the rendered range of this scale, so its marker is pinned to the scale's lower end.",
    )
  })

  it('a value far above the domain pins the marker to the upper edge and says so', () => {
    const { figure, container } = renderScale('kneeFlexion', 200)
    const marker = one(container, '.metric-scale__marker')
    expect(marker).toHaveAttribute('data-clamped', 'above')
    expect(percentOf(marker)).toBe(100)
    expect(figure).toHaveAccessibleName(
      "Metric kneeFlexion: 200.0° is above the published range (85.0–125.0°). It is above the rendered range of this scale, so its marker is pinned to the scale's upper end.",
    )
  })

  it('inside an open-ended zone but beyond the drawn track: still the zone, and still says it is clamped', () => {
    const { figure, container } = renderScale('cadence', 100)
    expect(one(container, '.metric-scale__marker')).toHaveAttribute(
      'data-clamped',
      'below',
    )
    expect(figure).toHaveAccessibleName(
      "Metric cadence: 100 steps/min falls in the zone published as “Below the 5th percentile” (below 153 steps/min). It is below the rendered range of this scale, so its marker is pinned to the scale's lower end.",
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
    expect(screen.getByRole('figure')).toHaveAccessibleName(
      'Cadence: 170 steps/min falls in the range published as “Open zone” (any value).',
    )
  })
})
