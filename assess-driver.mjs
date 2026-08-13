import { chromium } from 'playwright'

const clip = process.argv[2] // 'track' | 'park'
const backend = process.argv[3] // 'movenet' | 'mediapipePoseLandmarker'

const browser = await chromium.launch({
  args: ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage()

let diagnostics = null
page.on('console', (msg) => {
  const text = msg.text()
  if (text.startsWith('[analysis-diagnostics]')) {
    diagnostics = text.slice('[analysis-diagnostics]'.length).trim()
  }
})

if (backend !== 'movenet') {
  await page.addInitScript((b) => {
    window.__STRIDES_POSE_BACKEND_OVERRIDE__ = { backend: b }
  }, backend)
}

await page.goto('http://localhost:5173')
const buttonName = clip === 'park' ? /try another demo/i : /^try a demo video$/i
const t0 = Date.now()
await page.getByRole('button', { name: buttonName }).click()
await page.getByText(/analysis complete/i).waitFor({ timeout: 240000 })
const elapsedMs = Date.now() - t0
await page.waitForTimeout(800)

const d = JSON.parse(diagnostics)
const out = {
  clip,
  backend,
  elapsedMs,
  detectedFrames: d.sampling?.detectedFrames,
  totalSamples: d.sampling?.totalSamples,
  hasScaleCalibration: 'scaleCalibration' in d,
  voCm: d.metrics?.verticalOscillationCm?.value ?? null,
  metrics: Object.fromEntries(
    Object.entries(d.metrics ?? {}).map(([k, v]) => [
      k,
      { value: v.value, conf: v.confidence },
    ]),
  ),
}
console.log('===ASSESS===' + JSON.stringify(out))
await browser.close()
