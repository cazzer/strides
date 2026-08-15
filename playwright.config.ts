import { defineConfig } from '@playwright/test'

/**
 * Separate from `npm test` (vitest, mocked detector, fast, CI-friendly) — this drives the real
 * pose-detection pipeline in a real browser against real video, which is slow and GPU-dependent.
 * Opt-in only: `npm run test:e2e`. See CLAUDE.md's "Live-browser verification harness" for why
 * this exists and the conventions it follows (real GPU, not SwiftShader; analysisDiagnostics
 * console capture; dev-only config overrides via page.addInitScript).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173/strides/',
    launchOptions: {
      args: ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173/strides/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
