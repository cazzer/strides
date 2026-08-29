import { defineConfig } from '@playwright/test'
import {
  DEV_PORT_ENV_VAR,
  REUSE_SERVER_ENV_VAR,
  resolveDevServerPort,
} from './scripts/lib/harnessProvenance.mjs'

/**
 * Separate from `npm test` (vitest, mocked detector, fast, CI-friendly) — this drives the real
 * pose-detection pipeline in a real browser against real video, which is slow and GPU-dependent.
 * Opt-in only: `npm run test:e2e`. See CLAUDE.md's "Live-browser verification harness" for why
 * this exists and the conventions it follows (real GPU, not SwiftShader; analysisDiagnostics
 * console capture; dev-only config overrides via page.addInitScript).
 *
 * **This config is also the single source of truth for how this app gets driven.**
 * `scripts/ab-person-selection.mjs` imports it rather than duplicating the launch args, the
 * baseURL or the dev-server command, so there is exactly one place that decides.
 *
 * Two things here are guards, not preferences (beads `strides-zpb`, `strides-9wp`):
 *
 * - **The port is derived from this checkout's absolute path**, not hardcoded to vite's 5173.
 *   Parallel worktrees on this machine routinely leave a dev server on 5173, and a foreign server
 *   answers a spec's every assertion and an A/B's every arm — producing a clean, plausible,
 *   wrong result rather than an error. Override with `STRIDES_DEV_PORT=<n>` if the derived port
 *   collides with something.
 * - **`reuseExistingServer` is off unless you ask for it**, by env var rather than by `!CI`, so
 *   the safe regime is what you get for not knowing about the flag. Measured cost of not reusing:
 *   under one second (vite boot to first 200 is ~0.7s; cold dep pre-bundling adds ~0.1s) against
 *   a suite whose single spec runs real pose detection for tens of seconds. Asking for reuse does
 *   NOT ask for trust: `e2e/globalSetup.ts` still verifies the server serves this checkout.
 */
const PORT = resolveDevServerPort()
const BASE_URL = `http://localhost:${PORT}/strides/`

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // Runs after `webServer` is up and before any worker starts (playwright orders plugin setup
  // ahead of global setup), which is the only window where the server can be identity-checked
  // before a spec has had the chance to believe it.
  globalSetup: './e2e/globalSetup.ts',
  use: {
    baseURL: BASE_URL,
    launchOptions: {
      args: ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    // `--strictPort` so an occupied port fails instead of quietly moving to another one, which
    // would leave the suite driving whatever already held this one.
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: process.env[REUSE_SERVER_ENV_VAR] === '1',
    timeout: 60_000,
  },
})

export { BASE_URL, DEV_PORT_ENV_VAR, PORT, REUSE_SERVER_ENV_VAR }
