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

/**
 * A zone's label, read from the band: the labels are the data layer's copy and move with it, while
 * these tests pin which zone is named and how the sentence around it reads.
 */
function zoneLabel(metric: BandedMetric, zoneIndex: number): string {
  return bandOf(metric).zones[zoneIndex].label
}

/**
 * The only numbers printed under the track: the band's lowest and highest bound. Every interior
 * bound is an unlabelled seam, and the zone list beneath prints all of them with their units.
 */
function expectedBoundLabels(band: ReferenceBand): string[] {
  const bounds = distinctBounds(band)
  return [bounds[0], bounds[bounds.length - 1]].map((bound) =>
    formatBandNumber(bound, band.unit),
  )
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
    '%s: a zone per published zone, a seam per bound, and a label per bound or narrow gap',
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
      expect(container.querySelectorAll('.metric-scale__seam')).toHaveLength(
        bounds.length,
      )
      const labels = [
        ...container.querySelectorAll('.metric-scale__bound-label'),
      ].map((node) => node.textContent)
      expect(labels).toEqual(expectedBoundLabels(band))

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
    // The two gap rows are the hatched spans on the track, which a screen reader cannot see: without
    // them the list steps from `163` to `164` with nothing saying the span between is uncovered
    // rather than merely unmentioned.
    expect(items).toEqual([
      `below 153 steps per minute: ${zoneLabel('cadence', 0)}`,
      `153 to 163 steps per minute: ${zoneLabel('cadence', 1)}`,
      "163 to 164 steps per minute: not in the source's table",
      `164 to 173 steps per minute: ${zoneLabel('cadence', 2)}`,
      "173 to 174 steps per minute: not in the source's table",
      `174 to 183 steps per minute: ${zoneLabel('cadence', 3)}`,
      `above 183 steps per minute: ${zoneLabel('cadence', 4)}`,
    ])
  })

  it('verticalRatio lists its zones with labels in value order, lowest value first', () => {
    const { figure } = renderScale('verticalRatio', 0.031)
    const items = [...figure.querySelectorAll('.metric-scale__zone-item')].map(
      (node) => node.textContent,
    )
    expect(items).toEqual([
      `below 3.05%: ${zoneLabel('verticalRatio', 0)}`,
      `3.05 to 3.70%: ${zoneLabel('verticalRatio', 1)}`,
      "3.70 to 3.75%: not in the source's table",
      `3.75 to 4.30%: ${zoneLabel('verticalRatio', 2)}`,
      "4.30 to 4.35%: not in the source's table",
      `4.35 to 5.05%: ${zoneLabel('verticalRatio', 3)}`,
      `above 5.05%: ${zoneLabel('verticalRatio', 4)}`,
    ])
  })

  it('keeps list semantics on the zone list, which a CSS list reset strips in Safari', () => {
    const { figure } = renderScale('cadence', 172)
    expect(one(figure, '.metric-scale__zones')).toHaveAttribute('role', 'list')
    expect(screen.getByRole('list')).toHaveAccessibleName(
      'Observed zones, lowest value first',
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
  it.each(BANDED)('%s visibly and accessibly distinguishes an observed band from a target', (metric) => {
    const { figure } = renderScale(metric, SAMPLE_VALUES[metric][0])
    const scope = one(figure, '.metric-scale__scope')
    expect(scope).toHaveTextContent('Observed, not a target')
    expect(scope.classList).not.toContain('sr-only')
    expect(textWithoutGraphic(figure)).toContain(
      'Observed, not a target',
    )
  })

  it('captions the figure with the value, its unit and the containing zone for cadence at 172', () => {
    const { figure, container } = renderScale('cadence', 172)
    expect(captionOf(figure)).toBe(
      `Metric cadence: 172 steps per minute falls in the zone labelled “${zoneLabel('cadence', 2)}” (values from 164 to 173 steps per minute).`,
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
      `Metric verticalRatio: 3.10% falls in the zone labelled “${zoneLabel('verticalRatio', 1)}” (values from 3.05 to 3.70%).`,
    )
    const text = figure.textContent ?? ''
    expect(text).not.toMatch(/310(\.0+)?%/)
    expect(text).not.toMatch(/\b0\.03%/)

    // On the track, too: the marker sits between the 3.05 and 3.70 seams.
    const seams = [...container.querySelectorAll('.metric-scale__seam')].map(
      percentOf,
    )
    const marker = percentOf(one(container, '.metric-scale__marker'))
    expect(marker).toBeGreaterThan(seams[0])
    expect(marker).toBeLessThan(seams[1])
  })

  it('a value in a gap in the source table says it falls between the two zones', () => {
    const { figure } = renderScale('verticalRatio', 0.0372)
    expect(captionOf(figure)).toBe(
      `Metric verticalRatio: 3.72% sits in the gap between the zones labelled “${zoneLabel('verticalRatio', 1)}” and “${zoneLabel('verticalRatio', 2)}”; the range shown jumps from 3.70% to 3.75%.`,
    )
  })

  it('verticalRatio above 5.05%: the zone label, the values and the position all run the same way', () => {
    const { figure } = renderScale('verticalRatio', 0.052)
    expect(captionOf(figure)).toBe(
      `Metric verticalRatio: 5.20% falls in the zone labelled “${zoneLabel('verticalRatio', 4)}” (values above 5.05%).`,
    )
  })

  it('a cadence in the 163→164 gap prints a decimal rather than a "164" that reads as inside 164–173', () => {
    const { figure } = renderScale('cadence', 163.5)
    expect(captionOf(figure)).toBe(
      `Metric cadence: 163.5 steps per minute sits in the gap between the zones labelled “${zoneLabel('cadence', 1)}” and “${zoneLabel('cadence', 2)}”; the source's table jumps from 163 steps per minute to 164 steps per minute.`,
    )
    expect(one(figure, '.metric-scale__value-label').textContent).toBe(
      '163.5 steps/min',
    )
  })

  it('a value on a bound an open zone shares belongs to the closed zone, never to both', () => {
    const { figure } = renderScale('cadence', 153)
    expect(captionOf(figure)).toBe(
      `Metric cadence: 153 steps per minute falls in the zone labelled “${zoneLabel('cadence', 1)}” (values from 153 to 163 steps per minute).`,
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

  it('authors no number of its own in the legend: a single range quotes its label verbatim', () => {
    for (const metric of [
      'verticalOscillationCm',
      'trunkLean',
      'kneeFlexion',
    ] as const) {
      const band = bandOf(metric)
      const { container, unmount } = renderScale(
        metric,
        SAMPLE_VALUES[metric][0],
      )
      expect(one(container, '.metric-scale__legend').textContent, metric).toBe(
        band.zones[0].label,
      )
      unmount()
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
      'Metric verticalOscillationCm: 4.4 centimetres is below the range shown (6.0 to 9.5 centimetres).',
    )
    const marker = one(container, '.metric-scale__marker')
    expect(marker).not.toHaveAttribute('data-clamped')
    expect(percentOf(marker)).toBeGreaterThan(0)
    const [lowerSeam] = [
      ...container.querySelectorAll('.metric-scale__seam'),
    ].map(percentOf)
    expect(percentOf(marker)).toBeLessThan(lowerSeam)
    expect(figure.textContent).not.toMatch(/drawn scale/)
  })

  it('a value far below the domain pins the marker to the lower edge and says so', () => {
    const { figure, container } = renderScale('verticalOscillationCm', 1)
    const marker = one(container, '.metric-scale__marker')
    expect(marker).toHaveAttribute('data-clamped', 'below')
    expect(percentOf(marker)).toBe(0)
    expect(captionOf(figure)).toBe(
      'Metric verticalOscillationCm: 1.0 centimetres is below the range shown (6.0 to 9.5 centimetres). It lies beyond the lower end of the drawn scale, so its marker is pinned at that end.',
    )
  })

  it('a value far above the domain pins the marker to the upper edge and says so', () => {
    const { figure, container } = renderScale('kneeFlexion', 260)
    const marker = one(container, '.metric-scale__marker')
    expect(marker).toHaveAttribute('data-clamped', 'above')
    expect(percentOf(marker)).toBe(100)
    expect(captionOf(figure)).toBe(
      'Metric kneeFlexion: 260.0 degrees is above the range shown (71.3 to 129.0 degrees). It lies beyond the upper end of the drawn scale, so its marker is pinned at that end.',
    )
  })

  it('verticalRatio far above the domain: one direction throughout, no word contradicting another', () => {
    const { figure, container } = renderScale('verticalRatio', 0.09)
    expect(one(container, '.metric-scale__marker')).toHaveAttribute(
      'data-clamped',
      'above',
    )
    expect(captionOf(figure)).toBe(
      `Metric verticalRatio: 9.00% falls in the zone labelled “${zoneLabel('verticalRatio', 4)}” (values above 5.05%). It lies beyond the upper end of the drawn scale, so its marker is pinned at that end.`,
    )
    // The label is the data layer's; the direction words checked are the sentence's own.
    expect(
      captionOf(figure).replace(zoneLabel('verticalRatio', 4), ''),
    ).not.toMatch(/\b(below|lowest|lower)\b/i)
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
  }, 10_000)

  it('inside an open-ended zone but beyond the drawn track: still the zone, and still says it is clamped', () => {
    const { figure, container } = renderScale('cadence', 100)
    expect(one(container, '.metric-scale__marker')).toHaveAttribute(
      'data-clamped',
      'below',
    )
    expect(captionOf(figure)).toBe(
      `Metric cadence: 100 steps per minute falls in the zone labelled “${zoneLabel('cadence', 0)}” (values below 153 steps per minute). It lies beyond the lower end of the drawn scale, so its marker is pinned at that end.`,
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
        const graphic = one(container, '.metric-scale__graphic').cloneNode(
          true,
        ) as HTMLElement
        // The rule is about what is printed ON THE TRACK — a scale number the reader will try to
        // read against a mark. The legend beneath it is prose, and where it quotes a single range's
        // own label (`…women's 10th to men's 90th percentile in Malisoux's 860 runners…`) the
        // numbers in it are the source's own words, pinned verbatim by the test below.
        graphic
          .querySelectorAll('.metric-scale__legend')
          .forEach((node) => node.remove())
        const valueLabel =
          one(graphic, '.metric-scale__value-label').textContent ?? ''
        // Per text node: adjacent labels' textContent runs together into one bogus number.
        const walker = document.createTreeWalker(graphic, NodeFilter.SHOW_TEXT)
        const numbers: string[] = []
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          numbers.push(...(node.textContent?.match(/-?\d+(\.\d+)?/g) ?? []))
        }
        // Guard against a vacuous pass: the graphic always prints the value and both outer bounds.
        expect(numbers.length).toBeGreaterThanOrEqual(3)
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

  it('authors no number of its own in the legend: a single range quotes its label verbatim', () => {
    for (const metric of [
      'verticalOscillationCm',
      'trunkLean',
      'kneeFlexion',
    ] as const) {
      const band = bandOf(metric)
      const { container, unmount } = renderScale(
        metric,
        SAMPLE_VALUES[metric][0],
      )
      expect(one(container, '.metric-scale__legend').textContent, metric).toBe(
        band.zones[0].label,
      )
      unmount()
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
        // The scope label explicitly negates "target". Check the position and zones for grading
        // language while the separate scope test pins that one intentional use of the word.
        const withoutScope = container.cloneNode(true) as Element
        withoutScope.querySelector('.metric-scale__scope')?.remove()
        expect(withoutScope.textContent ?? '').not.toMatch(GRADING_WORD)
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
      zones: [
        { label: 'Open zone', min: null, max: null, shareOfRunners: null },
      ],
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
    for (const seam of container.querySelectorAll('.metric-scale__seam')) {
      expect(classesOf(seam)).toContain('forced-colors:bg-[CanvasText]')
    }
    for (const zone of container.querySelectorAll('.metric-scale__zone')) {
      expect(classesOf(zone)).toEqual(
        expect.arrayContaining([
          'forced-colors:bg-[Canvas]',
          'forced-colors:bg-none',
          'forced-colors:border-x',
          'forced-colors:border-[CanvasText]',
        ]),
      )
    }
    // The clause explaining the SHADING goes with the shading forced colours has just dropped; the
    // clause explaining the HATCHING does not, because `currentColor` hatching survives.
    const legend = one(container, '.metric-scale__legend')
    expect(classesOf(legend)).not.toContain('forced-colors:hidden')
    for (const span of legend.querySelectorAll('span')) {
      const hidden = classesOf(span).includes('forced-colors:hidden')
      expect(hidden, span.textContent ?? '').toBe(
        !classesOf(span).includes('metric-scale__legend-gap'),
      )
    }
    expect(one(legend, '.metric-scale__legend-gap')).toHaveTextContent(
      "not in the source's table",
    )
    expect(classesOf(one(container, '.metric-scale__marker'))).toEqual(
      expect.arrayContaining([
        'forced-colors:bg-[Highlight]',
        'forced-colors:ring-[Canvas]',
      ]),
    )
  })

  it('draws the marker in the mark colour, not the brand colour, ringed in the track so it clears a seam', () => {
    // `--color-scale-mark` against the most heavily shaded zone is 3.89:1 light and 3.66:1 dark, and
    // 17.9:1 / 18.2:1 against bare track — the ring, which is the track colour, is what keeps it
    // distinct from a seam drawn in the very same mark colour. Ratios live in `src/index.css`.
    const { container } = renderScale('cadence', 172)
    const classes = classesOf(one(container, '.metric-scale__marker'))
    expect(classes).toEqual(
      expect.arrayContaining([
        'bg-scale-mark',
        'dark:bg-scale-mark-dark',
        'ring-2',
        'ring-scale-track',
        'dark:ring-scale-track-dark',
      ]),
    )
    expect(classes.join(' ')).not.toMatch(/brand-/)
  })

  it('hatches a published gap, and draws one hatched sliver per gap and none where zones touch', () => {
    for (const metric of BANDED) {
      const band = bandOf(metric)
      const gaps = band.zones.filter(
        (zone, z) =>
          z > 0 &&
          band.zones[z - 1].max !== null &&
          zone.min !== null &&
          band.zones[z - 1].max! < zone.min,
      ).length
      const { container, unmount } = renderScale(
        metric,
        SAMPLE_VALUES[metric][0],
      )
      const slivers = [
        ...container.querySelectorAll<HTMLElement>('.metric-scale__gap'),
      ]
      expect(slivers, metric).toHaveLength(gaps)
      for (const sliver of slivers) {
        expect(sliver.style.backgroundImage).toMatch(
          /repeating-linear-gradient/,
        )
        expect(classesOf(sliver)).toContain('forced-colors:text-[CanvasText]')
      }
      unmount()
    }
    // cadence and verticalRatio each carry two published gaps, so the check above is not vacuous.
    expect(
      bandOf('cadence').zones.some(
        (zone, z) => z > 0 && zone.min !== bandOf('cadence').zones[z - 1].max,
      ),
    ).toBe(true)
  })

  it("prints exactly three numbers: the band's two outer bounds and the value", () => {
    for (const metric of BANDED) {
      const band = bandOf(metric)
      const bounds = distinctBounds(band)
      for (const value of SAMPLE_VALUES[metric]) {
        const { container, unmount } = renderScale(metric, value)
        const labels = [
          ...container.querySelectorAll('.metric-scale__bound-label'),
        ].map((node) => node.textContent)
        expect(labels, `${metric} at ${value}`).toEqual([
          formatBandNumber(bounds[0], band.unit),
          formatBandNumber(bounds[bounds.length - 1], band.unit),
        ])
        // ...and one seam per bound all the same, interior ones included.
        expect(
          container.querySelectorAll('.metric-scale__seam'),
          `${metric} at ${value}`,
        ).toHaveLength(bounds.length)
        unmount()
      }
    }
    // Not vacuous: two bands publish six bounds each, so four of them go unprinted.
    expect(distinctBounds(bandOf('cadence'))).toHaveLength(6)
    expect(distinctBounds(bandOf('verticalRatio'))).toHaveLength(6)
  })

  it('shades zones by share of runners: the largest share darkest, equal shares alike', () => {
    for (const metric of ['cadence', 'verticalRatio'] as const) {
      const band = bandOf(metric)
      const { container, unmount } = renderScale(
        metric,
        SAMPLE_VALUES[metric][0],
      )
      const zones = [
        ...container.querySelectorAll<HTMLElement>('.metric-scale__zone'),
      ]
      const steps = zones.map((zone) => Number(zone.dataset.shade))
      // Garmin's 5 / 30 / 70 / 95 cut points: 0.05, 0.25, 0.40, 0.25, 0.05.
      expect(
        band.zones.map((zone) => zone.shareOfRunners),
        metric,
      ).toEqual([0.05, 0.25, 0.4, 0.25, 0.05])
      expect(steps, metric).toEqual([0, 1, 2, 1, 0])
      // Equal shares are drawn identically, and the fullest step is the most-populated zone.
      expect(classesOf(zones[0]), metric).toEqual(classesOf(zones[4]))
      expect(classesOf(zones[1]), metric).toEqual(classesOf(zones[3]))
      expect(classesOf(zones[2]).join(' '), metric).toContain('scale-zone-3')
      expect(
        one(container, '.metric-scale__legend').textContent,
        metric,
      ).toContain('more runners')
      unmount()
    }
  })

  it('shades a single published range without claiming a distribution inside it', () => {
    for (const metric of [
      'verticalOscillationCm',
      'trunkLean',
      'kneeFlexion',
    ] as const) {
      const band = bandOf(metric)
      expect(band.zones, metric).toHaveLength(1)
      expect(band.zones[0].shareOfRunners, metric).toBeNull()
      const { container, unmount } = renderScale(
        metric,
        SAMPLE_VALUES[metric][0],
      )
      const zone = one(container, '.metric-scale__zone')
      expect(zone.dataset.shade, metric).toBe('range')
      // FLAT, at one step — no ramp of any shape. A symmetric ramp (which this was: zone-2 easing
      // to zone-3 across the middle and back) is the universal "optimal range" idiom, and these are
      // exactly the bands whose source publishes no distribution at all.
      expect(classesOf(zone).join(' '), metric).not.toContain('linear-gradient')
      expect(classesOf(zone), metric).toContain('bg-scale-zone-3')
      expect(classesOf(zone), metric).toContain('dark:bg-scale-zone-3-dark')
      // The freed legend slot names the range instead of claiming a distribution in it: the
      // headline can only say "within the range shown", so without this nothing says of what.
      expect(one(container, '.metric-scale__legend'), metric).toHaveTextContent(
        band.zones[0].label,
      )
      expect(
        one(container, '.metric-scale__legend').textContent,
        metric,
      ).not.toContain('more runners')
      unmount()
    }
  })

  it('states the shading order per theme, because it inverts between them, and says what hatching is', () => {
    const { container } = renderScale('cadence', 172)
    const legend = one(container, '.metric-scale__legend')
    const spans = [...legend.querySelectorAll('span')]
    expect(spans.map((span) => span.textContent)).toEqual([
      'Darker = more runners',
      'Brighter = more runners',
      ' · ',
      "hatched = not in the source's table",
    ])
    expect(classesOf(spans[0])).toContain('dark:hidden')
    expect(classesOf(spans[1])).toEqual(
      expect.arrayContaining(['hidden', 'dark:inline']),
    )
  })

  it('explains hatching only where the band has a gap to explain', () => {
    // `trunkLean` publishes one range and no gaps, so there is no hatching on its track and the
    // clause would name a mark that is not there.
    const { container } = renderScale('trunkLean', 10)
    expect(container.querySelector('.metric-scale__legend-gap')).toBeNull()
  })

  it('keeps the text alternative for screen readers, not as visible prose', () => {
    // The card's headline states the position in words, and the graphic prints the band's outer
    // bounds with a seam at every interior one — so the caption and the zone list would repeat, in
    // a second wording, what a sighted reader has already met. They stay in the accessibility tree.
    const { container } = renderScale('cadence', 172)
    for (const selector of [
      '.metric-scale__zones',
      '.metric-scale__position',
    ]) {
      expect(classesOf(one(container, selector)), selector).toContain('sr-only')
    }
    // Still text, and still carrying every bound with its unit: sr-only hides nothing from AT.
    const zones = one(container, '.metric-scale__zones')
    expect(zones).not.toHaveAttribute('aria-hidden')
    expect(zones.textContent).toContain('164 to 173 steps per minute')
  })

  it('keeps the two printed bounds clear of each other at a 280 px track', () => {
    // The old scale printed a label per bound and stacked them into rows to stop them overprinting.
    // With two labels there are no rows: the check is simply that they do not touch, at the
    // narrowest track a 390 px viewport gives this card.
    const TRACK_PX = 280
    // Generous for an 11 px sans-serif digit or point, so the check errs toward failing.
    const CHAR_PX = 7
    for (const [metric, value] of [
      ['verticalRatio', 0.075],
      ['cadence', 163.5],
      ['cadence', 100],
      ['cadence', 260],
      ['kneeFlexion', 20],
    ] as const) {
      const { container, unmount } = renderScale(metric, value)
      const [left, right] = [
        ...container.querySelectorAll<HTMLElement>(
          '.metric-scale__bound-label',
        ),
      ].map((label) => {
        const width = (label.textContent ?? '').length * CHAR_PX
        // `anchorAt`: the label's left edge sits at percent × (track − label width).
        const start = (percentOf(label) / 100) * (TRACK_PX - width)
        return { start, end: start + width }
      })
      expect(left.end, `${metric} at ${value}`).toBeLessThan(right.start)
      unmount()
    }
  })
})
