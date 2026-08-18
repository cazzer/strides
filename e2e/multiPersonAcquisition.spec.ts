import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'multiperson-track.mp4')

/**
 * Real-browser regression coverage for the `multi-person-acquisition` openspec change
 * (openspec/changes/multi-person-acquisition/). This clip is NOT wired into the app's UI (no
 * demo button) — it's a user-supplied fixture reported to occasionally show more than one person
 * in frame, kept e2e-only per instruction. There's no ground truth for this clip's correct metric
 * values, so this test only asserts qualitative sanity (analysis completes, frames get detected)
 * plus whether multi-pose acquisition/reacquisition actually dispatched — the concrete signal
 * that this clip reproduces the "occasionally detected as multi person" condition it was
 * reported for. It does not and cannot assert the tracked skeleton favored the correct subject —
 * that would need either ground-truth annotations or per-frame visual review, neither done here.
 */
test('multi-person clip: analysis completes and reports diagnostics with personOfInterest enabled', async ({
  page,
}) => {
  await page.addInitScript(() => {
    ;(
      window as unknown as { __STRIDES_POSE_BACKEND_OVERRIDE__: unknown }
    ).__STRIDES_POSE_BACKEND_OVERRIDE__ = {
      personOfInterest: { enabled: true },
    }
  })

  const diagnosticsPromise = new Promise<Record<string, unknown>>((resolve) => {
    page.on('console', (msg) => {
      const text = msg.text()
      if (text.startsWith('[analysis-diagnostics]') && !text.startsWith('[analysis-diagnostics:')) {
        resolve(JSON.parse(text.slice('[analysis-diagnostics]'.length).trim()))
      }
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Upload' }).click()
  await page.locator('input[type=file]').setInputFiles(FIXTURE_PATH)

  // Per-clip progress moved out of the session status line and onto each clip's own header strip
  // entry (`strides-kyu.4`), carrying the identical strings. `.first()` because the strings are
  // now per clip rather than per session: with one clip there is exactly one node, but the wait
  // should not become a strict-mode violation the day this fixture grows a second one.
  await page
    .getByText(/analyzing|processing results/i)
    .first()
    .waitFor({ timeout: 30_000 })
  // Still exactly one node, and deliberately so: "Analysis complete." is a SESSION fact and stays
  // in `ResultsView`'s single status line — no strip entry is allowed to repeat it.
  await page.getByText(/analysis complete/i).waitFor({ timeout: 90_000 })

  const diagnostics = await diagnosticsPromise

  const sampling = diagnostics.sampling as { detectedFrames?: number } | undefined
  expect(sampling?.detectedFrames ?? 0).toBeGreaterThan(0)
})
