import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The phone tour's panels (and the runner's notes, drawn on the same surface) scroll over the model
 * runner, so their text sits on a translucent colour over whatever is under it: the page, or one of
 * the runner's strokes. This holds every piece of text on that surface to WCAG AA (4.5:1, the floor
 * for the small text the citations use) against the surface composited over the page and over
 * every colour the runner paints with, in both themes.
 *
 * Nothing is transcribed. The surface's opacities are read from the tour's own source, the text
 * colours from the components that render inside a panel, the runner's colours from
 * `ModelRunner.tsx`, and every Tailwind colour from Tailwind's own `theme.css` (OKLCH, converted
 * here), so a "nicer" panel or stroke colour that breaks the floor fails here rather than on a
 * phone. The backdrop blur is ignored: it only mixes a stroke with what is around it, which can
 * only bring the stroke closer to the panel, so a solid stroke is the worst case.
 *
 * Read from disk rather than imported, as in `scalePalette.test.ts`, and resolved from this file's
 * directory for the same reason given there.
 */
const here = dirname(fileURLToPath(import.meta.url))
const source = (path: string) => readFileSync(join(here, path), 'utf8')
const themeCss = readFileSync(createRequire(import.meta.url).resolve('tailwindcss/theme.css'), 'utf8')
/** The app's own colours (`brand-*`), declared beside Tailwind's. */
const appCss = source('../../index.css')

const SURFACE_SOURCES = ['RunnerTour.tsx', 'TourStop.tsx'] as const
/** Every component whose text renders on a panel or a note. */
const TEXT_SOURCES = [
  'TourStop.tsx',
  'RunnerTour.tsx',
  '../FeedbackLine.tsx',
  '../BandLegend.tsx',
  '../../guidance/MetricScale.tsx',
] as const
/** `ExternalLink` (the citations' links) lives in a file with many other colours; its own pair. */
const LINK_TEXT = { light: 'black', dark: 'white' } as const
const RUNNER_SOURCE = '../../runner/ModelRunner.tsx'

/** The page under the tour: the default canvas (no element paints a background behind it). Dark
 * is Chrome's dark canvas; a lighter one only helps the dark theme's light text further. */
const PAGE = { light: '#ffffff', dark: '#121212' } as const
/** Text with no colour class inherits the canvas text colour. */
const INHERITED_TEXT = { light: 'black', dark: 'white' } as const
const AA = 4.5
const MIN_OPACITY = 0.85

type Theme = 'light' | 'dark'
type Rgb = readonly [number, number, number]

/** A colour name (`neutral-900`, `cyan-300`, `brand-600`, `black`) as sRGB 0–1, from Tailwind's
 * theme or the app's. Throws on a name neither declares, so no colour is silently skipped. */
function tailwindColour(name: string): Rgb {
  const pattern = new RegExp(`--color-${name}:\\s*([^;]+);`)
  const match = pattern.exec(themeCss) ?? pattern.exec(appCss)
  if (match === null) throw new Error(`neither tailwindcss/theme.css nor src/index.css declares --color-${name}`)
  return parseColour(match[1].trim())
}

function parseColour(value: string): Rgb {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1]
    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16) / 255) as unknown as Rgb
  }
  const oklch = /^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+|none)\)$/.exec(value)
  if (!oklch) throw new Error(`unparsed colour ${value}`)
  return oklchToSrgb(Number(oklch[1]) / 100, Number(oklch[2]), oklch[3] === 'none' ? 0 : Number(oklch[3]))
}

/** OKLCH to gamma-encoded sRGB, clamped to the gamut (Björn Ottosson's OKLab matrices). */
function oklchToSrgb(l: number, c: number, hueDeg: number): Rgb {
  const a = c * Math.cos((hueDeg * Math.PI) / 180)
  const b = c * Math.sin((hueDeg * Math.PI) / 180)
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ]
  return linear.map((v) => {
    const x = Math.min(1, Math.max(0, v))
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
  }) as unknown as Rgb
}

/** WCAG 2.x relative luminance. */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

/** `top` at `alpha` over `under`, in gamma-encoded sRGB, as browsers composite. */
function over(top: Rgb, alpha: number, under: Rgb): Rgb {
  return top.map((v, i) => alpha * v + (1 - alpha) * under[i]) as unknown as Rgb
}

/**
 * Colour classes of one property in a source: `prop-name` for the light theme (a bare class, no
 * variant) and `dark:prop-name` for the dark one. Hover, focus and `max-lg:` forms are excluded
 * except `max-lg:` (and `max-lg:dark:`) for surfaces, which are phone-only by design.
 */
function colourClasses(text: string, prop: string, theme: Theme): string[] {
  const variant = theme === 'light' ? '(?:max-lg:)?' : '(?:max-lg:)?dark:'
  // Every `<family>-<shade>` colour, whatever the family: each is then resolved by
  // `tailwindColour`, which throws on one it cannot find, rather than a family list skipping it.
  const re = new RegExp(`(?<=[\\s"'\`])${variant}${prop}-([a-z]+-\\d{2,3}|black|white)(?:/(\\d+))?(?=[\\s"'\`])`, 'g')
  return [...text.matchAll(re)].map((m) => (m[2] ? `${m[1]}/${m[2]}` : m[1]))
}

/** Arbitrary stroke or fill colours (`stroke-[…]`, `fill-[…]`) not under `forced-colors:`, which
 * the extraction above cannot resolve and so would silently leave unchecked. */
function arbitraryPaints(text: string): string[] {
  return [...text.matchAll(/(?<=[\s"'`])((?:[a-z-]+:)*)(?:stroke|fill)-\[[^\]]*\]/g)]
    .filter((m) => !m[1].split(':').includes('forced-colors'))
    .map((m) => m[0])
}

/** The surfaces (panel and note backgrounds) the tour declares, per theme: colour and opacity. */
function surfaces(theme: Theme): { colour: string; alpha: number }[] {
  return SURFACE_SOURCES.flatMap((file) =>
    colourClasses(source(file), 'bg', theme)
      .filter((cls) => cls.includes('/'))
      .map((cls) => {
        const [colour, percent] = cls.split('/')
        return { colour, alpha: Number(percent) / 100 }
      }),
  )
}

function textColours(theme: Theme): string[] {
  const found = TEXT_SOURCES.flatMap((file) => colourClasses(source(file), 'text', theme))
  return [...new Set([...found, LINK_TEXT[theme], INHERITED_TEXT[theme]])]
}

/** Everything the runner paints, in either theme: a light figure can sit under a dark panel only
 * through a theme switch mid-frame, but counting both themes' colours costs nothing and is safer. */
function runnerColours(): string[] {
  const runner = source(RUNNER_SOURCE)
  const all = (['light', 'dark'] as const).flatMap((theme) =>
    ['stroke', 'fill'].flatMap((prop) => colourClasses(runner, prop, theme)),
  )
  return [...new Set(all.map((cls) => cls.split('/')[0]))]
}

describe('the phone tour panels', () => {
  it('declare a surface in both themes, at least 85% opaque', () => {
    for (const theme of ['light', 'dark'] as const) {
      const found = surfaces(theme)
      expect(found.length, theme).toBeGreaterThanOrEqual(2) // the panel and the runner's notes
      for (const { colour, alpha } of found) {
        expect(colour, theme).toBe(theme === 'light' ? 'white' : 'black')
        expect(alpha, `${theme} ${colour}`).toBeGreaterThanOrEqual(MIN_OPACITY)
      }
    }
  })

  it('paint with no arbitrary stroke or fill colour the check cannot resolve', () => {
    for (const file of [RUNNER_SOURCE, ...TEXT_SOURCES]) expect(arbitraryPaints(source(file)), file).toEqual([])
    expect(arbitraryPaints(' stroke-[#123456] ')).toEqual(['stroke-[#123456]'])
    expect(arbitraryPaints(' forced-colors:stroke-[color:Highlight] ')).toEqual([])
  })

  it('resolve every colour they name (an unknown one throws)', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const name of [...runnerColours(), ...textColours(theme)]) {
        expect(() => tailwindColour(name), name).not.toThrow()
      }
    }
    expect(() => tailwindColour('nonsense-500')).toThrow()
  })

  it('find the runner colours and panel text colours they are checked against', () => {
    // A guard on the extraction itself: an empty list would pass every check below.
    expect(runnerColours()).toEqual(expect.arrayContaining(['neutral-900', 'neutral-100', 'cyan-700', 'cyan-300']))
    expect(textColours('light')).toEqual(expect.arrayContaining(['neutral-600', 'neutral-900']))
    expect(textColours('dark')).toEqual(expect.arrayContaining(['neutral-400', 'neutral-100']))
  })

  it('converts Tailwind colours as browsers do (spot checks against Tailwind v3 hexes)', () => {
    // Tailwind v4's OKLCH neutrals are v3's hexes to within a unit; a broken conversion is not.
    const hex = (rgb: Rgb) => rgb.map((v) => Math.round(v * 255))
    expect(hex(tailwindColour('neutral-900'))).toEqual([23, 23, 23])
    expect(hex(tailwindColour('neutral-600'))).toEqual([82, 82, 82])
    expect(hex(tailwindColour('white'))).toEqual([255, 255, 255])
  })

  for (const theme of ['light', 'dark'] as const) {
    it(`keep every text colour at WCAG AA over the page and every runner colour (${theme})`, () => {
      const unders = [
        { name: 'page', rgb: parseColour(PAGE[theme]) },
        ...runnerColours().map((name) => ({ name, rgb: tailwindColour(name) })),
      ]
      const rows: string[] = []
      let worst = Infinity
      for (const { colour, alpha } of surfaces(theme)) {
        for (const under of unders) {
          const backdrop = over(tailwindColour(colour), alpha, under.rgb)
          for (const text of textColours(theme)) {
            const ratio = contrast(tailwindColour(text), backdrop)
            worst = Math.min(worst, ratio)
            if (ratio < AA) rows.push(`${text} on ${colour}/${alpha} over ${under.name}: ${ratio.toFixed(2)}`)
          }
        }
      }
      expect(rows, rows.join('\n')).toEqual([])
      expect(worst).toBeGreaterThanOrEqual(AA)
    })
  }
})
