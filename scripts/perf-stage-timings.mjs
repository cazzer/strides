#!/usr/bin/env node
/**
 * Captures the dev-only `[perf-timings]` console lines (`src/results/perfTimings.ts`) across the
 * demo corpus and prints a median per stage field — the desktop wall-clock baseline for epic
 * `strides-e4c` (ticket `strides-e4c.1`). Measurement only: no override is installed, so every run
 * is the shipped default pipeline.
 *
 * Scenarios: each clip uploaded on its own (`side-landscape`, `side-portrait`, `front-approach`,
 * `multiperson`), and `demo3` — the header's one demo button, which loads all three demo clips into
 * one session. A trial ends when every clip's scale pass has reported a terminal status AND the
 * `[evidence-coverage]` stream has been quiet for `SETTLE_MS` (the graft re-extracts; take the
 * last line, CLAUDE.md "Take the LAST [evidence-coverage] line").
 *
 * The same guards as `ab-person-selection.mjs`, for the same reasons: the dev server is started by
 * this run on the checkout-derived port and identity-checked by nonce, Chromium launches with
 * `playwright.config.ts`'s real-GPU args, a software renderer is refused, and every trial gets a
 * fresh browser process (`strides-9wp`).
 *
 *   node scripts/perf-stage-timings.mjs [--scenarios a,b] [--trials 3] [--json out.json]
 *
 * Needs Node >= 22.18 (imports playwright.config.ts directly). Progress on stderr, table on stdout.
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import {
  REPO_ROOT,
  assertHardwareRenderer,
  assertServesThisCheckout,
  readRendererInPage,
} from './lib/harnessProvenance.mjs'

const DEMO_CLIP_DIR = path.join(REPO_ROOT, 'src', 'video', 'demo-clips')
const SCENARIOS = {
  'side-landscape': { upload: path.join(DEMO_CLIP_DIR, 'park-side-landscape.mp4'), clips: 1 },
  'side-portrait': { upload: path.join(DEMO_CLIP_DIR, 'park-side-portrait.mp4'), clips: 1 },
  'front-approach': { upload: path.join(DEMO_CLIP_DIR, 'park-approach.mp4'), clips: 1 },
  multiperson: { upload: path.join(REPO_ROOT, 'e2e', 'fixtures', 'multiperson-track.mp4'), clips: 1 },
  demo3: { demoButton: true, clips: 3 },
}

const PERF_PREFIX = '[perf-timings]'
const SCALE_PASS_PREFIX = '[analysis-diagnostics:scale-pass]'
const EVIDENCE_PREFIX = '[evidence-coverage]'
const SETTLE_MS = 8_000
const TRIAL_TIMEOUT_MS = 300_000

function parseArgs(argv) {
  const options = { scenarios: Object.keys(SCENARIOS), trials: 3, jsonPath: null }
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]]
    if (value === undefined) throw new Error(`${flag} needs a value`)
    if (flag === '--scenarios') {
      options.scenarios = value.split(',').map((name) => name.trim()).filter(Boolean)
      for (const name of options.scenarios) {
        if (!(name in SCENARIOS)) throw new Error(`unknown scenario "${name}"`)
      }
    } else if (flag === '--trials') {
      options.trials = Number(value)
      if (!Number.isInteger(options.trials) || options.trials < 1) throw new Error('bad --trials')
    } else if (flag === '--json') {
      options.jsonPath = value
    } else {
      throw new Error(`unknown flag: ${flag}`)
    }
  }
  return options
}

async function serverIsUp(url) {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

/** Refuses a server this run did not start — see `ab-person-selection.mjs`'s startDevServer. */
async function startDevServer({ command, url, timeout }) {
  if (await serverIsUp(url)) {
    throw new Error(`${url} is already being served and this run did not start it — stop it first.`)
  }
  const child = spawn(command, { cwd: REPO_ROOT, shell: true, detached: true, stdio: 'ignore' })
  child.unref()
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await serverIsUp(url)) {
      await assertServesThisCheckout(url).catch((error) => {
        stop()
        throw error
      })
      return stop
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  stop()
  throw new Error(`dev server did not come up at ${url}`)
}

async function runTrial(launchArgs, baseURL, scenario) {
  const browser = await chromium.launch({ args: launchArgs })
  try {
    const page = await browser.newPage()
    const perfLines = []
    let scalePassLines = 0
    let lastEvidenceAt = 0
    let evidenceLines = 0
    let startedAt = 0
    let lastScalePassAtMs = null
    let lastEvidenceAtMs = null
    page.on('console', (message) => {
      const text = message.text()
      const now = Date.now()
      if (text.startsWith(PERF_PREFIX)) {
        try {
          perfLines.push(JSON.parse(text.slice(PERF_PREFIX.length).trim()))
        } catch {
          // A throw in a Playwright listener kills the process; a malformed line costs its rows.
          process.stderr.write(`\n  WARNING: unparseable ${PERF_PREFIX} line\n`)
        }
      } else if (text.startsWith(SCALE_PASS_PREFIX)) {
        scalePassLines += 1
        lastScalePassAtMs = now - startedAt
      } else if (text.startsWith(EVIDENCE_PREFIX)) {
        evidenceLines += 1
        lastEvidenceAt = now
        lastEvidenceAtMs = now - startedAt
      }
    })

    await page.goto(baseURL)
    // The clock starts right after this, while the app's MoveNet detector (created at App mount)
    // is still cold-loading in this fresh process — so the primary pass's start time includes
    // whatever of that load is left. Deliberate: a real first upload pays it too.
    const renderer = assertHardwareRenderer(await page.evaluate(readRendererInPage))
    // The page's own clock at the trigger, so each line's `atMs` can be rebased onto it.
    const triggerAtMs = await page.evaluate(() => performance.now())
    startedAt = Date.now()
    if (scenario.demoButton) {
      await page.getByRole('button', { name: /demo \(3 clips\)/i }).click()
    } else {
      await page.getByRole('button', { name: 'Upload' }).click()
      await page.locator('input[type=file]').setInputFiles(scenario.upload)
    }

    let analysisCompleteMs = null
    page
      .getByText(/analysis complete/i)
      .first()
      .waitFor({ timeout: TRIAL_TIMEOUT_MS })
      .then(() => {
        analysisCompleteMs = Date.now() - startedAt
      })
      .catch(() => {})

    const deadline = Date.now() + TRIAL_TIMEOUT_MS
    for (;;) {
      const settled =
        scalePassLines >= scenario.clips &&
        evidenceLines > 0 &&
        Date.now() - lastEvidenceAt > SETTLE_MS
      if (settled) break
      if (Date.now() > deadline) {
        throw new Error(
          `did not settle: ${scalePassLines}/${scenario.clips} scale-pass lines, ` +
            `${evidenceLines} evidence lines`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return {
      renderer,
      perfLines,
      triggerAtMs,
      session: { analysisCompleteMs, lastScalePassAtMs, lastEvidenceAtMs },
    }
  } finally {
    await browser.close()
  }
}

/**
 * One row key per line: stage, pass, which clip (by byte size — the only identity every stage can
 * report), and its occurrence index among identical keys in the trial, so the pre- and post-graft
 * evidence extractions stay separate rows.
 */
function keyLines(perfLines) {
  const seen = new Map()
  const keyed = []
  for (const line of perfLines) {
    const base = `${line.stage}${line.pass ? `:${line.pass}` : ''}@${line.bytes ?? '-'}`
    const occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    keyed.push([`${base}#${occurrence}`, line])
  }
  return keyed
}

const KEY_FIELDS = new Set(['stage', 'pass', 'atMs', 'bytes', 'width', 'height', 'durationSec'])

function flattenNumbers(prefix, value, out) {
  if (typeof value === 'number') out[prefix] = value
  else if (typeof value === 'boolean') out[prefix] = Number(value)
  else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value)) flattenNumbers(prefix ? `${prefix}.${key}` : key, value[key], out)
  }
  return out
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function summarizeScenario(trials) {
  const rows = new Map()
  for (const trial of trials) {
    const fields = flattenNumbers('session', trial.session, {})
    for (const [key, line] of keyLines(trial.perfLines)) {
      // Identity and emission time are in the key or are not durations; everything else is.
      const durations = Object.fromEntries(
        Object.entries(line).filter(([name]) => !KEY_FIELDS.has(name)),
      )
      // When the stage finished, on the trigger's clock — lines up stages across clips.
      durations.sinceTriggerMs = line.atMs - trial.triggerAtMs
      flattenNumbers(key, durations, fields)
    }
    for (const [field, value] of Object.entries(fields)) {
      if (!rows.has(field)) rows.set(field, [])
      rows.get(field).push(value)
    }
  }
  return [...rows.entries()].map(([field, values]) => ({
    field,
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    n: values.length,
  }))
}

const format = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(1))

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const config = (await import(pathToFileURL(path.join(REPO_ROOT, 'playwright.config.ts')).href)).default
  const launchArgs = config.use.launchOptions.args
  const baseURL = config.use.baseURL
  const stop = await startDevServer({ ...config.webServer, url: config.webServer.url ?? baseURL })
  const results = {}
  try {
    // Warm vite's transform cache so the first scenario does not absorb it alone.
    const warm = await chromium.launch({ args: launchArgs })
    const warmPage = await warm.newPage()
    await warmPage.goto(baseURL)
    await warmPage.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
    process.stderr.write(`renderer: ${assertHardwareRenderer(await warmPage.evaluate(readRendererInPage))}\n`)
    await warm.close()

    for (let trial = 0; trial < options.trials; trial += 1) {
      for (const name of options.scenarios) {
        process.stderr.write(`run: ${name} / trial ${trial + 1}… `)
        const result = await runTrial(launchArgs, baseURL, SCENARIOS[name])
        ;(results[name] ??= []).push(result)
        process.stderr.write(`${result.perfLines.length} lines, settled ${result.session.lastEvidenceAtMs}ms\n`)
      }
    }
  } finally {
    stop()
  }

  for (const name of options.scenarios) {
    process.stdout.write(`\n## ${name} (${results[name].length} trials, median [min..max] ms)\n`)
    for (const row of summarizeScenario(results[name])) {
      const spread = row.min === row.max ? '' : ` [${format(row.min)}..${format(row.max)}]`
      const partial = row.n === results[name].length ? '' : ` (n=${row.n})`
      process.stdout.write(`${row.field}\t${format(row.median)}${spread}${partial}\n`)
    }
  }
  if (options.jsonPath) writeFileSync(options.jsonPath, JSON.stringify(results, null, 2))
}

main().catch((error) => {
  process.stderr.write(`\n${error.stack ?? error}\n`)
  process.exit(1)
})
