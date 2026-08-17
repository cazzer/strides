#!/usr/bin/env node
/**
 * Multi-trial A/B driver for `SamplingRobustnessConfig` variants (GitHub #53).
 *
 * Drives the real pipeline in a real browser across the three available clips, N trials per arm,
 * and prints medians + ranges — never a single run, because this repo's GPU/frame-timing
 * non-determinism makes one run non-evidence (CLAUDE.md, "Determinism caveat").
 *
 * Measurement tooling, not a test: it asserts nothing and is not wired into CI. It does reuse
 * `playwright.config.ts` for the launch args, the baseURL and the dev-server command, so there is
 * exactly one place in the repo that decides how this app gets driven.
 *
 * Usage:
 *   node scripts/ab-person-selection.mjs --arm '<label>=<json>' [--arm ...] [options]
 *
 *   --arm <label>=<json>  Repeatable. `<json>` is a partial SamplingRobustnessConfig
 *                         (src/results/samplingRobustnessConfig.ts) assigned to
 *                         window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ before any page
 *                         script runs. Use `{}` for an unmodified baseline arm.
 *   --clips <a,b,c>       demo1 | demo2 | multiperson (default: all three)
 *   --trials <n>          Trials per (clip, arm). Default 3.
 *   --timeout <ms>        Per-trial wait for "Analysis complete". Default 300000.
 *   --port <n>            Dev-server port. Default is playwright.config.ts's (5173). An already-
 *                         running server on that port is reused — pick a free port when another
 *                         worktree may be serving a different checkout on the default one.
 *   --json <path>         Also write the aggregate + every raw per-trial record here.
 *
 * Example:
 *   node scripts/ab-person-selection.mjs \
 *     --arm 'off={"personSelection":{"enabled":false}}' \
 *     --arm 'on={"personSelection":{"enabled":true}}' \
 *     --clips demo2 --trials 3
 *
 * Progress goes to stderr; only the report goes to stdout, with no timestamps and a fixed field
 * order, so `node scripts/ab-person-selection.mjs ... > before.txt` and a second run's
 * `after.txt` can be compared with `diff`.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CLIPS = {
  // Side-view track clip. Fetched live from Pexels by the demo button, so this one needs network.
  demo1: { kind: 'demo', button: /demo 1/i },
  // Front-approach clip, bundled at src/video/demo-clips/park-approach.mp4. Local and fast.
  demo2: { kind: 'demo', button: /demo 2/i },
  // Not wired into the UI — the e2e-only multi-person fixture, driven through the Upload tab.
  multiperson: {
    kind: 'upload',
    file: path.join(REPO_ROOT, 'e2e', 'fixtures', 'multiperson-track.mp4'),
  },
}

const DIAGNOSTICS_PREFIX = '[analysis-diagnostics]'

function parseArgs(argv) {
  const options = {
    arms: [],
    clips: Object.keys(CLIPS),
    trials: 3,
    timeoutMs: 300_000,
    port: null,
    jsonPath: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    switch (flag) {
      case '--arm': {
        const split = value?.indexOf('=') ?? -1
        if (split < 1) {
          throw new Error(`--arm needs <label>=<json>, got: ${value ?? '(nothing)'}`)
        }
        const label = value.slice(0, split)
        const json = value.slice(split + 1)
        let override
        try {
          override = JSON.parse(json)
        } catch (error) {
          throw new Error(`--arm ${label}: override is not valid JSON`, { cause: error })
        }
        if (override === null || typeof override !== 'object' || Array.isArray(override)) {
          throw new Error(`--arm ${label}: override must be a JSON object, got ${json}`)
        }
        options.arms.push({ label, override })
        i += 1
        break
      }
      case '--clips': {
        options.clips = value.split(',').map((name) => name.trim()).filter(Boolean)
        for (const name of options.clips) {
          if (!(name in CLIPS)) {
            throw new Error(`unknown clip "${name}" — known: ${Object.keys(CLIPS).join(', ')}`)
          }
        }
        i += 1
        break
      }
      case '--trials':
        options.trials = Number(value)
        if (!Number.isInteger(options.trials) || options.trials < 1) {
          throw new Error(`--trials needs a positive integer, got: ${value}`)
        }
        i += 1
        break
      case '--timeout':
        options.timeoutMs = Number(value)
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
          throw new Error(`--timeout needs a positive number of ms, got: ${value}`)
        }
        i += 1
        break
      case '--port':
        options.port = Number(value)
        if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
          throw new Error(`--port needs a valid port number, got: ${value}`)
        }
        i += 1
        break
      case '--json':
        options.jsonPath = value
        i += 1
        break
      default:
        throw new Error(`unknown flag: ${flag}`)
    }
  }

  if (options.arms.length === 0) {
    throw new Error('at least one --arm <label>=<json> is required (use `{}` for a baseline arm)')
  }
  const labels = new Set(options.arms.map((arm) => arm.label))
  if (labels.size !== options.arms.length) {
    throw new Error('arm labels must be unique')
  }
  return options
}

function withPort(url, port) {
  const parsed = new URL(url)
  parsed.port = String(port)
  return parsed.toString()
}

async function serverIsUp(url) {
  try {
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
}

/**
 * Starts the dev server the way `playwright.config.ts`'s `webServer` block would, reusing an
 * already-running one rather than fighting it for the port. Returns a stop function.
 */
async function startDevServer({ command, url, timeout }) {
  if (await serverIsUp(url)) {
    process.stderr.write(
      `dev server: reusing the one already serving ${url} — confirm it is THIS checkout, ` +
        'or re-run with --port on a free port.\n',
    )
    return () => {}
  }

  process.stderr.write(`dev server: starting \`${command}\`\n`)
  const child = spawn(command, { cwd: REPO_ROOT, shell: true, detached: true, stdio: 'ignore' })
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }

  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await serverIsUp(url)) return stop
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  stop()
  throw new Error(`dev server did not come up at ${url} within ${timeout}ms`)
}

async function readRendererString(browser) {
  const page = await browser.newPage()
  try {
    const renderer = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      if (!gl) return null
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      return info
        ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER)
    })
    return renderer
  } finally {
    await page.close()
  }
}

/**
 * One analysis run: fresh context (so the override is installed before any page script runs),
 * drive the clip, capture the PRIMARY diagnostics line, return the fields we compare on.
 */
async function runTrial(browser, { baseURL, clip, clipName, override, timeoutMs }) {
  const context = await browser.newContext()
  try {
    await context.addInitScript((value) => {
      window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = value
    }, override)

    const page = await context.newPage()

    let resolveDiagnostics
    const diagnosticsPromise = new Promise((resolve) => {
      resolveDiagnostics = resolve
    })
    page.on('console', (message) => {
      const text = message.text()
      // Exclusive: `[analysis-diagnostics:scale-pass]` also starts with the bare prefix.
      if (text.startsWith(DIAGNOSTICS_PREFIX) && !text.startsWith('[analysis-diagnostics:')) {
        resolveDiagnostics(JSON.parse(text.slice(DIAGNOSTICS_PREFIX.length).trim()))
      }
    })

    await page.goto(baseURL)

    const startedAt = Date.now()
    if (clip.kind === 'upload') {
      await page.getByRole('button', { name: 'Upload' }).click()
      await page.locator('input[type=file]').setInputFiles(clip.file)
    } else {
      await page.getByRole('button', { name: clip.button }).click()
    }

    const completed = page
      .getByText(/analysis complete/i)
      .waitFor({ timeout: timeoutMs })
      .then(() => 'complete')
    const downloadFailed = page
      .getByText(/couldn't load the demo video/i)
      .waitFor({ timeout: timeoutMs })
      .then(() => 'demo-download-failed')
    // Whichever loses the race settles later, after the page is gone; keep that handled.
    completed.catch(() => {})
    downloadFailed.catch(() => {})

    const outcome = await Promise.race([completed, downloadFailed])
    if (outcome !== 'complete') {
      throw new Error(`${clipName}: the demo clip failed to download`)
    }
    const elapsedMs = Date.now() - startedAt

    const diagnostics = await Promise.race([
      diagnosticsPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('no [analysis-diagnostics] line')), 15_000),
      ),
    ])

    return extractFields(diagnostics, elapsedMs)
  } finally {
    await context.close()
  }
}

/**
 * The comparison surface. Insertion order here IS the report's row order — keep it stable, and
 * keep the metrics last since their count varies with the pipeline, not with the arm.
 */
function extractFields(diagnostics, elapsedMs) {
  const sampling = diagnostics.sampling ?? {}
  const selection = diagnostics.personSelection ?? {}
  const winner = selection.segments?.[0] ?? {}
  const view = diagnostics.view ?? {}

  const fields = {
    'sampling.totalSamples': sampling.totalSamples ?? null,
    'sampling.detectedFrames': sampling.detectedFrames ?? null,
    'sampling.path': sampling.path ?? null,
    'personSelection.status': selection.status ?? null,
    'personSelection.skipReason': selection.skipReason ?? null,
    'personSelection.detectedSamplesIn': selection.detectedSamplesIn ?? null,
    'personSelection.detectedSamplesOut': selection.detectedSamplesOut ?? null,
    'personSelection.rejectedBelowFloor': selection.rejectedBelowFloor ?? null,
    'personSelection.rejectedOtherSegment': selection.rejectedOtherSegment ?? null,
    'personSelection.segmentCount': selection.segmentCount ?? null,
    'personSelection.separationRatio': selection.separationRatio ?? null,
    'segments[0].startTimestamp': winner.startTimestamp ?? null,
    'segments[0].endTimestamp': winner.endTimestamp ?? null,
    'segments[0].frameCount': winner.frameCount ?? null,
    'segments[0].integratedAreaPx': winner.integratedAreaPx ?? null,
    'segments[0].medianAreaPx': winner.medianAreaPx ?? null,
    'view.view': view.view ?? null,
    'view.confidence': view.confidence ?? null,
  }

  for (const id of Object.keys(diagnostics.metrics ?? {}).sort()) {
    const metric = diagnostics.metrics[id]
    fields[`metrics.${id}.value`] = metric.value ?? null
    fields[`metrics.${id}.confidence`] = metric.confidence ?? null
  }

  fields.elapsedMs = elapsedMs
  return fields
}

function median(sorted) {
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function formatNumber(value) {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(6)))
}

/** `median [min..max]` for numbers, `value×count` tallies for everything else. */
function summarize(values) {
  const present = values.filter((value) => value !== null && value !== undefined)
  const missing = values.length - present.length

  if (present.length === 0) return 'null'

  if (present.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    const sorted = [...present].sort((a, b) => a - b)
    const spread =
      sorted[0] === sorted[sorted.length - 1]
        ? ''
        : ` [${formatNumber(sorted[0])}..${formatNumber(sorted[sorted.length - 1])}]`
    const nulls = missing > 0 ? ` (${missing} null)` : ''
    return `${formatNumber(median(sorted))}${spread}${nulls}`
  }

  const counts = new Map()
  for (const value of values) {
    const key = value === null || value === undefined ? 'null' : String(value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => (count === values.length ? key : `${key}×${count}`))
    .join(' ')
}

function renderTable(header, rows) {
  const widths = header.map((_, column) =>
    Math.max(header[column].length, ...rows.map((row) => row[column].length)),
  )
  const line = (cells) =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column])))
      .join('  ')
      .trimEnd()
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)]
}

function report({ renderer, options, results }) {
  const armLabels = options.arms.map((arm) => arm.label)
  const lines = [
    '# scripts/ab-person-selection.mjs',
    `# renderer: ${renderer}`,
    `# trials: ${options.trials}`,
    ...options.arms.map((arm) => `# arm ${arm.label}: ${JSON.stringify(arm.override)}`),
  ]

  for (const clipName of options.clips) {
    lines.push('', `## ${clipName}`)

    const cells = new Map()
    const fieldOrder = []
    for (const label of armLabels) {
      const trials = results.get(`${clipName}|${label}`)
      const ok = trials.filter((trial) => trial.fields)
      cells.set(`trials|${label}`, `${ok.length}/${trials.length} ok`)
      for (const trial of ok) {
        for (const field of Object.keys(trial.fields)) {
          if (!fieldOrder.includes(field)) fieldOrder.push(field)
        }
      }
    }
    for (const field of fieldOrder) {
      for (const label of armLabels) {
        const trials = results.get(`${clipName}|${label}`).filter((trial) => trial.fields)
        cells.set(
          `${field}|${label}`,
          trials.length === 0 ? '—' : summarize(trials.map((trial) => trial.fields[field] ?? null)),
        )
      }
    }

    const rows = ['trials', ...fieldOrder].map((field) => [
      field,
      ...armLabels.map((label) => cells.get(`${field}|${label}`) ?? '—'),
    ])
    lines.push(...renderTable(['field', ...armLabels], rows))

    const failures = armLabels.flatMap((label) =>
      results
        .get(`${clipName}|${label}`)
        .filter((trial) => trial.error)
        .map((trial) => `# FAILED ${clipName}/${label} trial ${trial.trial}: ${trial.error}`),
    )
    lines.push(...failures)
  }

  return lines.join('\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  const { default: playwrightConfig } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'playwright.config.ts')).href
  )
  const launchArgs = playwrightConfig.use.launchOptions.args
  const webServer = { ...playwrightConfig.webServer }
  let baseURL = playwrightConfig.use.baseURL
  if (options.port !== null) {
    baseURL = withPort(baseURL, options.port)
    webServer.url = withPort(webServer.url, options.port)
    webServer.command = webServer.command.replace(/--port \d+/, `--port ${options.port}`)
  }

  const stopServer = await startDevServer(webServer)
  const browser = await chromium.launch({ args: launchArgs })

  try {
    const renderer = await readRendererString(browser)
    process.stderr.write(`renderer: ${renderer}\n`)
    if (renderer === null || /swiftshader|software|llvmpipe/i.test(renderer)) {
      throw new Error(
        `refusing to measure on "${renderer}" — that is software rendering, not the GPU. ` +
          'Every number this driver prints would be unrepresentative (CLAUDE.md, "real GPU").',
      )
    }

    // (clip, arm) -> trial records. Trial-major so the arms see comparable machine conditions
    // rather than one arm getting all the cold-start runs.
    const results = new Map()
    for (const clipName of options.clips) {
      for (const arm of options.arms) results.set(`${clipName}|${arm.label}`, [])
    }

    for (const clipName of options.clips) {
      for (let trial = 1; trial <= options.trials; trial += 1) {
        for (const arm of options.arms) {
          process.stderr.write(`run: ${clipName} / ${arm.label} / trial ${trial}… `)
          const record = { trial }
          try {
            record.fields = await runTrial(browser, {
              baseURL,
              clip: CLIPS[clipName],
              clipName,
              override: arm.override,
              timeoutMs: options.timeoutMs,
            })
            process.stderr.write(
              `detected ${record.fields['sampling.detectedFrames']}/${record.fields['sampling.totalSamples']} in ${record.fields.elapsedMs}ms\n`,
            )
          } catch (error) {
            record.error = error.message
            process.stderr.write(`FAILED: ${error.message}\n`)
          }
          results.get(`${clipName}|${arm.label}`).push(record)
        }
      }
    }

    process.stdout.write(`${report({ renderer, options, results })}\n`)

    if (options.jsonPath) {
      const target = path.resolve(options.jsonPath)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(
        target,
        `${JSON.stringify(
          {
            renderer,
            trials: options.trials,
            arms: options.arms,
            // One entry per (clip, arm), in the same order the report prints them.
            rows: options.clips.flatMap((clipName) =>
              options.arms.map((arm) => ({
                clip: clipName,
                arm: arm.label,
                trials: results.get(`${clipName}|${arm.label}`),
              })),
            ),
          },
          null,
          2,
        )}\n`,
      )
      process.stderr.write(`wrote ${target}\n`)
    }
  } finally {
    await browser.close()
    stopServer()
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  process.exitCode = 1
})
