import type { FullConfig } from '@playwright/test'
import { chromium } from 'playwright'
import {
  assertHardwareRenderer,
  assertServesThisCheckout,
  readRendererInPage,
} from '../scripts/lib/harnessProvenance.mjs'

/**
 * Two refusals, both unconditional, that run once before any spec does.
 *
 * They exist because this suite's failure mode is not a crash. It drives real pose detection and
 * asserts on the numbers that come back, so a run against the wrong dev server or on a software
 * rasteriser returns a full set of plausible numbers — observed for real as both a false PASS
 * (an A/B arm's code simply absent from the foreign checkout, reading as "no effect") and a false
 * FAIL (`1 failed` on a docs-only commit; 3/3 green once re-run on a dedicated port). Beads
 * `strides-zpb` and `strides-9wp`.
 *
 * Playwright starts `webServer` before global setup, so by here the server is up whether this run
 * started it or attached to an existing one — which is exactly the point at which its identity can
 * still be checked before a spec believes it. Neither refusal is behind a flag: the reason the
 * old `reuseExistingServer: !process.env.CI` cost six agents a session each is that nobody knew to
 * opt out of it.
 */
export default async function globalSetup(config: FullConfig) {
  const project = config.projects[0]
  const baseURL = project?.use.baseURL
  if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL')

  await assertServesThisCheckout(baseURL)
  process.stderr.write(`e2e: dev server at ${baseURL} verified as this checkout\n`)

  // A throwaway browser on about:blank — the renderer string comes from a bare WebGL context and
  // needs no app, so this costs a launch rather than a navigation. Launched with the config's own
  // args so it is the same browser the specs will get, not a lookalike.
  const browser = await chromium.launch({ args: project.use.launchOptions?.args })
  try {
    const page = await browser.newPage()
    const renderer = await page.evaluate(readRendererInPage)
    assertHardwareRenderer(renderer)
    process.stderr.write(`e2e: renderer ${renderer}\n`)
  } finally {
    await browser.close()
  }
}
