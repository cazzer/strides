import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * `strides-jet8`: on a phone only the page scrolls. At 390 px no results panel (every tour stop,
 * the summary with every row open, the classic view, the save panel, the progress page) and not the
 * header's add-a-clip panel may be a scroll container of its own; the page never scrolls sideways;
 * a swipe that starts on a tour panel moves the page; and a tour panel taller than the room below
 * the runner can be read to its end by scrolling the page, without the snap pulling it back.
 *
 * The layout half of the guard (the source half, which runs in CI, is
 * `src/results/noInnerScroll.test.ts`). Runs the real 3-clip demo, so it needs the real-GPU
 * Chromium the config launches. Storage is the dev-only fake provider; nothing reaches Google.
 */

const WIDTH = 390
const HEIGHT = 844

test.use({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

interface Offender {
  kind: string
  element: string
  height: number
  scrollHeight: number
}

interface Audit {
  pageScrollWidth: number
  innerWidth: number
  offenders: Offender[]
}

/**
 * In the page. An offender is any element (outside a modal `<dialog>`) whose computed `overflow-y`
 * is `auto` or `scroll` and that either overflows vertically or sits in `<main>` (a scroller in the
 * results is wrong even while its content happens to fit), or that scrolls sideways other than the
 * header's clip strip, which the multi-clip spec has scroll within its own bounds.
 */
function auditInPage(): Audit {
  const describe = (el: Element) => {
    const classes = typeof el.className === 'string' ? el.className.split(/\s+/).filter((c) => /^[a-z][\w-]*(__[\w-]+)?$/.test(c)).slice(0, 3) : []
    return [el.tagName.toLowerCase(), el.id && `#${el.id}`, ...classes.map((c) => `.${c}`)].filter(Boolean).join('')
  }
  const offenders: Offender[] = []
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    if (el.closest('dialog')) continue
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.display === 'contents') continue
    const box = el.getBoundingClientRect()
    if (box.width <= 1 || box.height <= 1) continue
    const scrollsY = style.overflowY === 'auto' || style.overflowY === 'scroll'
    const overflowY = el.scrollHeight - el.clientHeight > 1
    const record = (kind: string) =>
      offenders.push({ kind, element: describe(el), height: Math.round(box.height), scrollHeight: el.scrollHeight })
    if (scrollsY && (overflowY || el.closest('main'))) record(overflowY ? 'scrolls vertically' : 'vertical scroller in main')
    const scrollsX = style.overflowX === 'auto' || style.overflowX === 'scroll'
    if (scrollsX && el.scrollWidth - el.clientWidth > 1 && !el.classList.contains('clip-strip')) record('scrolls sideways')
  }
  const root = document.scrollingElement!
  return { pageScrollWidth: root.scrollWidth, innerWidth: window.innerWidth, offenders }
}

async function expectPageOnlyScroll(page: Page, where: string) {
  const audit = await page.evaluate(auditInPage)
  expect(audit.offenders, `${where}: an element with a scroll of its own at ${WIDTH} px`).toEqual([])
  expect(audit.pageScrollWidth, `${where}: the page scrolls sideways`).toBeLessThanOrEqual(audit.innerWidth)
}

/** Every element's own scroll offset, other than the document's: a panel that took a swipe shows here. */
function innerScrollOffsets(): string[] {
  const moved: string[] = []
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    if (el.scrollTop > 0) moved.push(`${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/)[0]} scrollTop=${el.scrollTop}`)
  }
  return moved
}

test('at 390 px only the page scrolls, in every results view', async ({ page }) => {
  test.setTimeout(300_000)
  await page.addInitScript(() => {
    ;(window as unknown as { __STRIDES_STORAGE_PROVIDER_OVERRIDE__: string }).__STRIDES_STORAGE_PROVIDER_OVERRIDE__ = 'fake'
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.goto('/')
  await page.getByRole('button', { name: /demo/i }).first().click()
  await page.getByRole('status').filter({ hasText: /analysis complete/i }).waitFor({ timeout: 180_000 })

  // The tour, one stop at a time, at rest (snapped by its start, under the tour's bar).
  const stops = await page.locator('[data-tour-stop]').evaluateAll((els) => els.map((el) => el.getAttribute('data-tour-stop')!))
  expect(stops.length).toBeGreaterThan(1)
  for (const id of stops) {
    const stop = page.locator(`[data-tour-stop="${id}"]`)
    const panel = stop.locator('.runner-tour__panel')
    await stop.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(800)
    await expectPageOnlyScroll(page, `tour stop ${id}`)

    // A swipe that starts on the panel moves the page, and nothing else.
    const box = (await panel.boundingBox())!
    const before = await page.evaluate(() => window.scrollY)
    await page.mouse.move(box.x + box.width / 2, Math.min(HEIGHT - 20, box.y + 40))
    await page.mouse.wheel(0, -400)
    await page.waitForTimeout(600)
    expect(await page.evaluate(() => window.scrollY), `tour stop ${id}: a swipe on the panel did not move the page`).not.toBe(before)
    expect(await page.evaluate(innerScrollOffsets), `tour stop ${id}: a swipe scrolled an element`).toEqual([])

    // The panel's end can be brought on screen by scrolling the page, and stays there.
    await stop.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(800)
    await panel.evaluate((el) => window.scrollBy(0, Math.max(0, el.getBoundingClientRect().bottom - window.innerHeight + 4)))
    await page.waitForTimeout(1000)
    const bottom = await panel.evaluate((el) => el.getBoundingClientRect().bottom)
    expect(bottom, `tour stop ${id}: the panel's end is not reachable by scrolling the page`).toBeLessThanOrEqual(HEIGHT + 1)
  }

  // The summary, with every focus-area row open (each holds the guided cards and their evidence).
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.getByRole('button', { name: /skip to summary|^summary$/i }).first().click()
  await page.locator('details[data-area]').first().waitFor()
  for (const row of await page.locator('details[data-area]').all()) await row.evaluate((el) => ((el as HTMLDetailsElement).open = true))
  await page.waitForTimeout(1000)
  await expectPageOnlyScroll(page, 'summary')

  // The save panel, through connect and a save.
  await page.getByRole('button', { name: 'Connect Test storage' }).click()
  await page.getByRole('button', { name: 'Continue to Google' }).click()
  const save = page.getByRole('button', { name: 'Save to Test storage' })
  await expect(save).toBeEnabled({ timeout: 90_000 })
  await expectPageOnlyScroll(page, 'save panel, ready')
  await save.click()
  // The button leaves as soon as the save starts; the index is written only at the end.
  await page.getByText(/^Saved to Test storage/).waitFor({ timeout: 90_000 })
  await expectPageOnlyScroll(page, 'save panel, saved')

  // The progress page.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.getByRole('button', { name: 'Progress', exact: true }).click()
  await page.locator('[data-progress-state="loaded"]').waitFor({ timeout: 30_000 })
  await expectPageOnlyScroll(page, 'progress')
  await page.goBack()

  // The classic view.
  await page.getByRole('button', { name: 'Classic table' }).click()
  await page.waitForTimeout(1000)
  await expectPageOnlyScroll(page, 'classic')

  // The header's add-a-clip panel: uncapped, with the header unstuck so the page scrolls past it.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
  await page.getByRole('button', { name: 'Add a clip' }).click()
  const addClip = page.locator('#add-clip-panel')
  await addClip.waitFor()
  await page.waitForTimeout(300)
  await expectPageOnlyScroll(page, 'add a clip')
  expect(await page.locator('header').first().evaluate((el) => getComputedStyle(el).position)).toBe('static')
  expect(await page.getByRole('button', { name: 'Add a clip' }).boundingBox(), 'opening add-a-clip leaves its trigger on screen').not.toBeNull()
  await addClip.evaluate((el) => el.scrollIntoView({ block: 'end' }))
  await page.waitForTimeout(300)
  const panelBottom = await addClip.evaluate((el) => el.getBoundingClientRect().bottom)
  expect(panelBottom, "add-a-clip panel's end is reachable by scrolling the page").toBeLessThanOrEqual(HEIGHT + 1)

  expect(errors).toEqual([])
})
