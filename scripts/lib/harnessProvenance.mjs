/**
 * Provenance guards shared by every live-browser harness in this repo — `playwright.config.ts` /
 * `e2e/globalSetup.ts` and `scripts/ab-person-selection.mjs`.
 *
 * These exist for ONE failure class, and it is not a crash: a harness that measures the wrong
 * thing produces a clean, plausible number. Two members of that class have been observed here for
 * real (beads `strides-zpb` and `strides-9wp`):
 *
 *   1. A dev server from a DIFFERENT checkout answers on the port under test. Arms of an A/B
 *      differ only by a `window` global, so a foreign server answers both of them; when the arm
 *      under test is a code change behind a flag, the foreign checkout does not contain the code
 *      at all, both arms collapse to old-code-plus-a-flag, and the honest reading of the output is
 *      "no effect" — a manufactured false negative for exactly the hypothesis being tested. The
 *      same trap has also produced a false FAIL on a docs-only commit.
 *   2. Software rendering. SwiftShader is slow enough to sample a handful of frames from a whole
 *      clip; every throughput and coverage number measured on it is unrepresentative, and none of
 *      them look wrong.
 *
 * So each guard here REFUSES rather than warns, and each is on by default rather than opt-in — a
 * guard you have to remember to switch on does not protect the person who did not know it existed.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Overrides the derived port, for the collision case and for driving a hand-started server. */
export const DEV_PORT_ENV_VAR = 'STRIDES_DEV_PORT'
/** Set to `1` to let Playwright attach to an already-running dev server. Still identity-checked. */
export const REUSE_SERVER_ENV_VAR = 'STRIDES_E2E_REUSE_SERVER'

// Deliberately not vite's 5173: that is the port every hand-started `npm run dev` lands on, and
// sharing it with the harness is what made a collision routine rather than rare in the first place.
const PORT_RANGE_START = 5200
const PORT_RANGE_SIZE = 200

/**
 * The dev-server port for a checkout, derived from its absolute path.
 *
 * Deriving rather than hardcoding is the structural half of guard 1: parallel worktrees stop
 * landing on the same port, so the collision this repo hit every session becomes rare. It is not
 * the guard itself — a hash into 200 slots can still collide, and something unrelated can still
 * hold the port — which is why {@link assertServesThisCheckout} verifies identity regardless of
 * how the port was chosen. Stable per checkout, so a rerun reaches the same server.
 */
export function resolveDevServerPort(repoRoot = REPO_ROOT) {
  const override = process.env[DEV_PORT_ENV_VAR]
  if (override !== undefined && override !== '') {
    const parsed = Number(override)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(`${DEV_PORT_ENV_VAR}=${override} is not a valid port number`)
    }
    return parsed
  }
  return PORT_RANGE_START + (createHash('sha256').update(repoRoot).digest().readUInt16BE(0) % PORT_RANGE_SIZE)
}

/**
 * Written into `public/` for the length of one check and deleted again. `public/` because vite
 * serves it byte-for-byte with no transform, no module graph and no TypeScript involvement, and
 * because sirv stats the directory per request in dev, so a file created after the server booted
 * is served without a restart (verified).
 */
const IDENTITY_FILE_NAME = '.strides-harness-identity.json'

export function identityMarkerPath(repoRoot = REPO_ROOT) {
  return path.join(repoRoot, 'public', IDENTITY_FILE_NAME)
}

function joinBase(baseURL, file) {
  return `${baseURL.endsWith('/') ? baseURL : `${baseURL}/`}${file}`
}

/**
 * Refuses unless the dev server answering `baseURL` is serving THIS checkout's working tree.
 *
 * **The check has to be content-based; a status code cannot answer this.** Vite's SPA fallback
 * returns HTTP 200 with `index.html` for any unmatched path, so a foreign vite server rooted at a
 * different checkout returns 200 for every probe URL you can invent — including this one.
 * Playwright's own `reuseExistingServer` probe is exactly that kind of status-code probe, which is
 * why no choice of `webServer.url` can close this hole and why this function exists.
 *
 * The mechanism is a nonce this process writes and then demands back: only a server rooted at
 * `repoRoot` can hand it over. That makes the check independent of vite's, React's and Playwright's
 * internals — nothing here parses a transform artefact that a dependency bump could reshape.
 *
 * Cheap enough (one file write, one localhost fetch, one unlink) to run unconditionally rather
 * than only on the reuse path, and it is run unconditionally on purpose: a guard that only fires
 * behind a rarely-used flag is a guard nobody notices has stopped working.
 */
export async function assertServesThisCheckout(baseURL, { repoRoot = REPO_ROOT, timeoutMs = 5_000 } = {}) {
  const markerPath = identityMarkerPath(repoRoot)
  const url = joinBase(baseURL, IDENTITY_FILE_NAME)
  const nonce = randomUUID()

  mkdirSync(path.dirname(markerPath), { recursive: true })
  writeFileSync(markerPath, `${JSON.stringify({ nonce, repoRoot, pid: process.pid })}\n`)

  // Always written before the loop can break, and it is what names the failure to the caller.
  let observed
  try {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        const response = await fetch(url, { cache: 'no-store' })
        const body = await response.text()
        let parsed = null
        try {
          parsed = JSON.parse(body)
        } catch {
          parsed = null
        }
        if (parsed !== null && parsed.nonce === nonce) return { url, repoRoot }
        observed =
          parsed !== null && typeof parsed.repoRoot === 'string'
            ? `a marker from a DIFFERENT checkout (${parsed.repoRoot})`
            : `HTTP ${response.status} with a body that is not this run's marker` +
              " — vite's SPA fallback answers 200 with index.html for any path it does not have, " +
              'which is what a foreign checkout looks like from here'
      } catch (error) {
        observed = `no response (${error.message})`
      }
      if (Date.now() >= deadline) break
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  } finally {
    rmSync(markerPath, { force: true })
  }

  throw new Error(
    `${url} did not return this run's identity marker — got ${observed}.\n` +
      `The dev server answering ${baseURL} is NOT serving ${repoRoot}.\n` +
      'Refusing to measure against it. A foreign checkout answers every arm of an A/B and every ' +
      'assertion in a spec, so the result reads as a clean "no effect" or an unexplained failure ' +
      'rather than as the wrong-checkout error it is (bead strides-zpb).\n' +
      `Stop that server, or run against a free port with ${DEV_PORT_ENV_VAR}=<port>.`,
  )
}

/** Matches the strings a software rasteriser reports; `--enable-gpu` on Apple silicon reports ANGLE Metal. */
const SOFTWARE_RENDERER_PATTERN = /swiftshader|software|llvmpipe/i

/**
 * Refuses on software rendering. `--headless=new --enable-gpu --ignore-gpu-blocklist` is supposed
 * to get real hardware acceleration; when it silently does not, every frame-throughput and
 * coverage number the run produces is unrepresentative and none of them look wrong (CLAUDE.md,
 * "real GPU, not SwiftShader").
 */
export function assertHardwareRenderer(renderer) {
  if (renderer === null || renderer === undefined || SOFTWARE_RENDERER_PATTERN.test(renderer)) {
    throw new Error(
      `refusing to run on "${renderer}" — that is software rendering, not the GPU. Numbers ` +
        'measured on it are unrepresentative and do not look it (CLAUDE.md, "real GPU").',
    )
  }
  return renderer
}

/**
 * Runs in the PAGE, not here. Passed to `page.evaluate` by both harnesses so there is one
 * definition of how this repo reads the renderer string.
 */
export function readRendererInPage() {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  if (!gl) return null
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
}
