import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `strides-jet8`: on a phone only the PAGE scrolls. No results panel (the tour, the summary and its
 * guided cards, the classic view, the save panel, the progress page) and not the header's
 * add-a-clip panel may have a scroll area of its own, because a swipe that starts on one moves it
 * instead of the page. This is the CI half of the guard: it reads the sources for a utility or rule
 * that makes a box scroll vertically or caps its height. The layout half, which needs a real
 * browser at 390 px, is `e2e/phonePageScroll.spec.ts`.
 *
 * A token is allowed when every variant on it is a desktop breakpoint (`lg:`, `xl:`, `2xl:`), since
 * those never apply at phone widths. Anything else needs an entry in `ALLOWED` with its reason.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const SCANNED_DIRS = ['src/results', 'src/guidance', 'src/storage', 'src/progress', 'src/runner']
const SCANNED_FILES = ['src/video/AddClipAction.tsx', 'src/index.css']
/** Not shipped UI: the runner's dev-only sandbox page. */
const SKIPPED_DIRS = ['src/runner/dev']

/** `file → tokens` that are deliberate, each with the reason. */
const ALLOWED: Record<string, { tokens: string[]; why: string }> = {
  'src/results/MotionStoryStage.tsx': {
    tokens: ['max-h-[85vh]', 'overflow-y-auto'],
    why: 'the expanded form is a modal <dialog>: the page behind it is inert, so the dialog is the only thing that can scroll',
  },
}

const TAILWIND_SCROLL = /^(overflow|overflow-y)-(auto|scroll)$/
const TAILWIND_CAP = /^max-h-/
const CSS_RULE = /\b(overflow(-y)?\s*:\s*(auto|scroll)|max-height\s*:)/
const DESKTOP_VARIANT = /^(lg|xl|2xl|min-\[[^\]]+\])$/

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    if (SKIPPED_DIRS.includes(path.relative(ROOT, dir))) return
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(tsx?|css)$/.test(name) && !/\.test\.|\.experimental\./.test(name)) out.push(full)
    }
  }
  SCANNED_DIRS.forEach((dir) => walk(path.join(ROOT, dir)))
  return [...out, ...SCANNED_FILES.map((file) => path.join(ROOT, file))]
}

/** Splits a utility into its variants and base, minding brackets (`max-lg:[&_x]:overflow-y-auto`). */
function splitVariants(token: string): { variants: string[]; base: string } {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < token.length; i++) {
    const ch = token[i]
    if (ch === '[') depth++
    else if (ch === ']') depth--
    else if (ch === ':' && depth === 0) {
      parts.push(token.slice(start, i))
      start = i + 1
    }
  }
  return { variants: parts, base: token.slice(start) }
}

/** Every Tailwind-looking token in the file's string literals that scrolls or caps a box below `lg`. */
export function offendingTokens(source: string): string[] {
  const found = new Set<string>()
  for (const literal of source.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? []) {
    for (const token of literal.slice(1, -1).split(/\s+/)) {
      const { variants, base } = splitVariants(token)
      if (!TAILWIND_SCROLL.test(base) && !TAILWIND_CAP.test(base)) continue
      if (variants.length > 0 && variants.every((variant) => DESKTOP_VARIANT.test(variant))) continue
      found.add(token)
    }
  }
  return [...found]
}

describe('no results panel scrolls inside itself on a phone (strides-jet8)', () => {
  const files = sourceFiles()

  it('scans the results, guidance, storage, progress and runner sources', () => {
    expect(files.some((file) => file.endsWith(path.join('tour', 'TourStop.tsx')))).toBe(true)
    expect(files.some((file) => file.endsWith('SaveAssessmentPanel.tsx'))).toBe(true)
    expect(files.some((file) => file.endsWith('ProgressPage.tsx'))).toBe(true)
  })

  it.each(files.map((file) => [path.relative(ROOT, file), file]))('%s', (relative, file) => {
    const source = readFileSync(file, 'utf8')
    if (file.endsWith('.css')) {
      const rules = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => CSS_RULE.test(line))
      expect(rules, `${relative}: a scrolling or height-capping CSS rule`).toEqual([])
      return
    }
    const allowed = ALLOWED[relative]?.tokens ?? []
    const offending = offendingTokens(source).filter((token) => !allowed.includes(token))
    expect(offending, `${relative}: a utility that gives a box its own vertical scroll or caps its height below lg`).toEqual([])
  })

  it('catches the cap the tour panel used to carry, and ignores desktop-only tokens', () => {
    expect(
      offendingTokens(
        "'runner-tour__panel max-lg:max-h-[max(6rem,calc(100dvh_-_var(--rt-top)))] max-lg:overflow-y-auto'",
      ),
    ).toEqual(['max-lg:max-h-[max(6rem,calc(100dvh_-_var(--rt-top)))]', 'max-lg:overflow-y-auto'])
    expect(offendingTokens('"basis-full max-h-[60vh] overflow-y-auto"')).toEqual(['max-h-[60vh]', 'overflow-y-auto'])
    expect(offendingTokens("'lg:max-h-96 lg:overflow-y-auto overflow-x-auto overflow-hidden'")).toEqual([])
  })
})
