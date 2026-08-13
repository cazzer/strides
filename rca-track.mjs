import { chromium } from 'playwright'

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

await page.goto('http://localhost:5173')
await page.getByRole('button', { name: /try a demo video/i }).click()
await page.getByText(/analysis complete/i).waitFor({ timeout: 120000 })
await page.waitForTimeout(1000)

console.log('===DIAGNOSTICS===')
console.log(diagnostics)
console.log('===UI_TEXT===')
const main = await page.locator('main').innerText().catch(() => null)
console.log(main ?? (await page.locator('body').innerText()))

await browser.close()
