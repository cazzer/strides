import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The reference scale's palette, held to the contrast floors it was chosen against.
 *
 * Reads the hex values out of `src/index.css` — from disk, because the project's CSS transform
 * hands `?raw` back empty — and recomputes every ratio, so a "nicer" colour that
 * breaks a floor fails here rather than on somebody's screen. The ratios themselves are transcribed
 * from declutter-guided-results-view design.md D4 — computed there, asserted here — rather than
 * derived from the same code that computes them, which would only prove the formula agrees with
 * itself.
 *
 * Why these floors and not others: the scale's shading is the one thing on this page allowed to
 * order the zones, and it orders them by how many runners each holds. That is worth nothing if the
 * marker vanishes on the darkest zone, or if the darkest zone cannot be told from bare track.
 */

// From the repo root: vitest runs with `process.cwd()` there, and `import.meta.url` is not a
// file: URL under this setup.
const css = readFileSync('src/index.css', 'utf8')

/** WCAG 2.x relative luminance of an `#rrggbb` string. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (at) => parseInt(hex.slice(at, at + 2), 16) / 255,
  )
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4),
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

/** The value of one `--color-…` custom property declared in `src/index.css`. */
function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(
    css,
  )
  if (match === null)
    throw new Error(`src/index.css declares no --color-${name}`)
  return match[1]
}

describe('the reference scale palette', () => {
  it('declares every token the scale paints with, light and dark', () => {
    for (const name of [
      'scale-zone-1',
      'scale-zone-2',
      'scale-zone-3',
      'scale-track',
      'scale-mark',
      'scale-hatch',
    ]) {
      expect(token(name), name).toMatch(/^#[0-9a-f]{6}$/i)
      expect(token(`${name}-dark`), `${name}-dark`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('emits them statically, so a token used only inside a gradient is not pruned away', () => {
    // Two of these are read as `var(--color-scale-…)` in an arbitrary gradient rather than through a
    // `bg-*` utility. A usage-pruned `@theme` would drop exactly those and leave a transparent band
    // with nothing failing — which is why the block is `@theme static`.
    expect(css).toMatch(/@theme static\s*\{[^}]*--color-scale-zone-3-dark/)
  })

  it.each([
    [
      'the most-populated zone against bare track',
      'scale-zone-3',
      'scale-track',
      4.61,
      4.96,
    ],
    [
      'the marker against the most-populated zone',
      'scale-mark',
      'scale-zone-3',
      3.89,
      3.66,
    ],
    [
      'the marker against the middle zone',
      'scale-mark',
      'scale-zone-2',
      9.6,
      7.09,
    ],
    [
      'the marker against the least-populated zone',
      'scale-mark',
      'scale-zone-1',
      14.68,
      12.16,
    ],
    [
      'the marker against bare track',
      'scale-mark',
      'scale-track',
      17.93,
      18.16,
    ],
    [
      'the gap hatching against bare track',
      'scale-hatch',
      'scale-track',
      7.81,
      7.85,
    ],
  ])('%s reads as design.md D4 computed it', (_name, a, b, light, dark) => {
    expect(contrast(token(a), token(b))).toBeCloseTo(light, 2)
    expect(contrast(token(`${a}-dark`), token(`${b}-dark`))).toBeCloseTo(
      dark,
      2,
    )
  })

  it('clears 3:1 for every mark against everything it can be drawn on', () => {
    // Seams are drawn in the marker's own colour, so they inherit its floor. The ring is the track
    // colour, which is what keeps the marker distinct from a seam it overlaps.
    for (const ground of [
      'scale-zone-1',
      'scale-zone-2',
      'scale-zone-3',
      'scale-track',
    ]) {
      expect(
        contrast(token('scale-mark'), token(ground)),
        ground,
      ).toBeGreaterThanOrEqual(3)
      expect(
        contrast(token('scale-mark-dark'), token(`${ground}-dark`)),
        `${ground}-dark`,
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps the most-populated zone distinguishable from bare track in both themes', () => {
    expect(
      contrast(token('scale-zone-3'), token('scale-track')),
    ).toBeGreaterThanOrEqual(3)
    expect(
      contrast(token('scale-zone-3-dark'), token('scale-track-dark')),
    ).toBeGreaterThanOrEqual(3)
  })

  it('orders the three steps monotonically, and inverts that order between themes', () => {
    // Light: more runners = darker, so luminance falls across the three steps. Dark: the opposite,
    // which is why the legend states a different sentence per theme.
    const light = [1, 2, 3].map((step) =>
      luminance(token(`scale-zone-${step}`)),
    )
    const dark = [1, 2, 3].map((step) =>
      luminance(token(`scale-zone-${step}-dark`)),
    )
    expect(light[0]).toBeGreaterThan(light[1])
    expect(light[1]).toBeGreaterThan(light[2])
    expect(dark[0]).toBeLessThan(dark[1])
    expect(dark[1]).toBeLessThan(dark[2])
  })

  it('stays in one hue family, so no step can read as a preferred end', () => {
    // Two hues would invite reading one as favourable, which is the one thing a band may not do.
    // Hue in degrees; the whole set sits inside a 30° window of cyan-teal.
    const hues = [1, 2, 3]
      .flatMap((step) => [`scale-zone-${step}`, `scale-zone-${step}-dark`])
      .map((name) => {
        const hex = token(name)
        const [r, g, b] = [1, 3, 5].map(
          (at) => parseInt(hex.slice(at, at + 2), 16) / 255,
        )
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        const span = max - min
        if (span === 0) return 0
        const raw =
          max === r
            ? ((g - b) / span) % 6
            : max === g
              ? (b - r) / span + 2
              : (r - g) / span + 4
        return (raw * 60 + 360) % 360
      })
    expect(Math.max(...hues) - Math.min(...hues)).toBeLessThanOrEqual(30)
    // Cyan-teal: as far from the forbidden pass/fail hues, and from brand orange, as this gets.
    for (const hue of hues) {
      expect(hue).toBeGreaterThan(170)
      expect(hue).toBeLessThan(210)
    }
  })

  it('uses none of the forbidden pass/fail hues and none of the brand colours', () => {
    const brand = ['#ff8f5c', '#ff5011', '#d9420a', '#b23507', '#8f2b06'].map(
      (hex) => hex.toLowerCase(),
    )
    for (const step of [1, 2, 3]) {
      for (const name of [`scale-zone-${step}`, `scale-zone-${step}-dark`]) {
        expect(brand, name).not.toContain(token(name).toLowerCase())
      }
    }
  })
})
