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
 * exactly one place in the repo that decides how this app gets driven. Importing that TypeScript
 * config directly needs **Node >=22.18** (or >=22.6 with `--experimental-strip-types`), which is
 * above the `>=20.19.0` floor package.json declares.
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
 *   --port <n>            Dev-server port. Default is playwright.config.ts's (5173).
 *   --reuse-server        Measure against a dev server this run did not start. Refused by
 *                         default — see startDevServer for why that refusal is not pedantry.
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
 * `after.txt` can be compared with `diff`. The report's header stamps the baseURL, whether the
 * server was this run's, and the commit, so a diff surfaces a provenance mismatch on line 2
 * rather than leaving it to be inferred from the numbers.
 */
import { execFileSync, spawn } from 'node:child_process'
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

/**
 * Every key an arm override may set, nested planes included. The app merges an override key-by-key
 * and ignores what it doesn't recognise, so a typo produces an arm bit-identical to baseline —
 * indistinguishable in the report from a real "no effect", which is the conclusion these A/Bs
 * exist to reach honestly. Checking only the top level would miss the likeliest typo of all
 * (`{personSelection: {enable: true}}`), since the misspelling lives one level down.
 *
 * Mirrors `SamplingRobustnessConfig` (src/results/samplingRobustnessConfig.ts) and the three
 * nested shapes it composes: `RobustnessConfig` (src/pose/robustness/types.ts),
 * `SequentialSamplingConfig` (src/results/sequentialSamplingStep.ts) and
 * `RetroactivePersonSelectionConfig` (src/results/retroactivePersonSelection.ts). A ticket that
 * adds a config key adds it here too — the failure is a loud, self-describing error rather than a
 * silent wrong measurement, which is the right way round.
 */
const ARM_KEYS = {
  maxConsecutiveErrors: null,
  detectionTimeoutMs: null,
  robustness: ['minKeypointConfidence', 'maxGapSeconds'],
  sequentialSampling: ['enabled', 'targetSamplesPerSecond'],
  personSelection: [
    'enabled',
    'minBoundingBoxAreaFraction',
    'minKeypointConfidence',
    'minConfidentKeypoints',
    'maxAreaRatio',
    'maxCenterSpeedSidesPerSecond',
    'maxContinuityGapSeconds',
  ],
}

/**
 * Field groups, in report order. Within a group fields sort alphabetically, so the row order is a
 * property of the field NAMES rather than of which arm happened to produce which keys first —
 * without that, an arm whose run skipped the selection stage (no `segments[0].*` at all) would
 * shift every later row and make two reports diff on ordering instead of on values.
 */
const FIELD_GROUPS = ['sampling.', 'personSelection.', 'segments[0].', 'view.', 'metrics.']

function requireValue(flag, value) {
  if (value === undefined) throw new Error(`${flag} needs a value`)
  return value
}

function parseArm(value) {
  const split = value.indexOf('=')
  if (split < 1) throw new Error(`--arm needs <label>=<json>, got: ${value}`)
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
  for (const key of Object.keys(override)) {
    if (!(key in ARM_KEYS)) {
      throw new Error(
        `--arm ${label}: unknown key "${key}" — known: ${Object.keys(ARM_KEYS).join(', ')}`,
      )
    }
    const nestedKeys = ARM_KEYS[key]
    if (nestedKeys === null) continue
    const nested = override[key]
    if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) {
      throw new Error(`--arm ${label}: "${key}" must be a JSON object`)
    }
    for (const nestedKey of Object.keys(nested)) {
      if (!nestedKeys.includes(nestedKey)) {
        throw new Error(
          `--arm ${label}: unknown key "${key}.${nestedKey}" — known: ${nestedKeys.join(', ')}`,
        )
      }
    }
  }
  return { label, override }
}

function parseArgs(argv) {
  const options = {
    arms: [],
    clips: Object.keys(CLIPS),
    trials: 3,
    timeoutMs: 300_000,
    port: null,
    reuseServer: false,
    jsonPath: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    switch (flag) {
      case '--arm':
        options.arms.push(parseArm(requireValue(flag, value)))
        i += 1
        break
      case '--clips':
        options.clips = requireValue(flag, value)
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
        for (const name of options.clips) {
          if (!(name in CLIPS)) {
            throw new Error(`unknown clip "${name}" — known: ${Object.keys(CLIPS).join(', ')}`)
          }
        }
        i += 1
        break
      case '--trials':
        options.trials = Number(requireValue(flag, value))
        if (!Number.isInteger(options.trials) || options.trials < 1) {
          throw new Error(`--trials needs a positive integer, got: ${value}`)
        }
        i += 1
        break
      case '--timeout':
        options.timeoutMs = Number(requireValue(flag, value))
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
          throw new Error(`--timeout needs a positive number of ms, got: ${value}`)
        }
        i += 1
        break
      case '--port':
        options.port = Number(requireValue(flag, value))
        if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
          throw new Error(`--port needs a valid port number, got: ${value}`)
        }
        i += 1
        break
      case '--reuse-server':
        options.reuseServer = true
        break
      case '--json':
        options.jsonPath = requireValue(flag, value)
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

function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'unknown'
  }
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
 * Starts the dev server the way `playwright.config.ts`'s `webServer` block would.
 *
 * Refuses an already-running server unless `reuse` is set, and that refusal is the point: arms
 * differ only by a `window` global, so a server from a DIFFERENT checkout still answers both arms
 * and yields a plausible table with a plausible delta computed from code nobody is reviewing.
 * Where the arm is a code change gated behind a flag, the foreign checkout doesn't contain the
 * code at all, both arms reduce to old-code-plus-a-flag, and the honest reading of the output is
 * "no effect" — a manufactured false negative for the exact hypothesis under test. Three seconds
 * of startup is not worth that.
 */
async function startDevServer({ command, url, timeout }, reuse) {
  if (await serverIsUp(url)) {
    if (!reuse) {
      throw new Error(
        `${url} is already being served and this run did not start it. Refusing to measure ` +
          'against a checkout that may not be this one. Stop that server, re-run with --port ' +
          '<free port>, or pass --reuse-server once you have confirmed it serves THIS checkout.',
      )
    }
    process.stderr.write(`dev server: reusing ${url} (--reuse-server)\n`)
    return { stop: () => {}, provenance: 'reused, NOT started by this run' }
  }

  process.stderr.write(`dev server: starting \`${command}\`\n`)
  const child = spawn(command, { cwd: REPO_ROOT, shell: true, detached: true, stdio: 'ignore' })
  // Without this the parent stays alive until the child exits, so any throw below leaves the
  // driver hanging after printing its stack instead of exiting non-zero.
  child.unref()

  let exit = null
  child.on('exit', (code, signal) => {
    exit = { code, signal }
  })
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }

  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await serverIsUp(url)) return { stop, provenance: 'started by this run' }
    // `--strictPort` makes vite exit immediately rather than pick another port, so a busy port
    // shows up here as a dead child — report that instead of burning the full timeout.
    if (exit !== null) {
      throw new Error(
        `dev server exited immediately (code ${exit.code}, signal ${exit.signal}) — with ` +
          `--strictPort that usually means ${url}'s port is occupied by something that is not ` +
          'answering as this app. Free it or pass --port <free port>.',
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  stop()
  throw new Error(`dev server did not come up at ${url} within ${timeout}ms`)
}

/**
 * Reads the renderer string AND warms the server. Vite transforms and pre-bundles the tfjs /
 * MediaPipe module graph on first request — server-side work, shared by every later page, so
 * whichever (clip, arm) ran first would otherwise absorb all of it alone and read systematically
 * wide in the range column. Trial-major ordering cannot balance a cost that is only ever paid
 * once. (Model and WebGL warmup is per-context and already symmetric across arms.)
 */
async function warmUpAndReadRenderer(browser, baseURL) {
  const page = await browser.newPage()
  try {
    await page.goto(baseURL)
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
    return await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      if (!gl) return null
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      return info
        ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER)
    })
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
    let rejectDiagnostics
    const diagnosticsPromise = new Promise((resolve, reject) => {
      resolveDiagnostics = resolve
      rejectDiagnostics = reject
    })
    // Keeps a rejection that lands before the await below from surfacing as unhandled.
    diagnosticsPromise.catch(() => {})

    page.on('console', (message) => {
      const text = message.text()
      // Exclusive: `[analysis-diagnostics:scale-pass]` also starts with the bare prefix.
      if (!text.startsWith(DIAGNOSTICS_PREFIX)) return
      if (text.startsWith('[analysis-diagnostics:')) return
      try {
        resolveDiagnostics(JSON.parse(text.slice(DIAGNOSTICS_PREFIX.length).trim()))
      } catch (error) {
        // Throwing inside an EventEmitter listener escapes Playwright's dispatch as an uncaught
        // exception and kills the process, losing every completed trial. Fail this one instead.
        rejectDiagnostics(
          new Error('[analysis-diagnostics] line was not parseable JSON', { cause: error }),
        )
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

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Table cells hold scalars; an array (nothing produces one today) is stringified to stay legible. */
function scalarize(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/**
 * Recursive so a nested diagnostic (`view.diagnostics`) becomes one comparable row per number
 * instead of one unreadable JSON blob that never medians. Keys sort at every level, so the row
 * order stays a property of the names.
 */
function flatten(prefix, source, skip = []) {
  const flattened = {}
  for (const key of Object.keys(source).sort()) {
    if (skip.includes(key)) continue
    const value = source[key]
    if (isPlainObject(value)) {
      Object.assign(flattened, flatten(`${prefix}${key}.`, value))
    } else {
      flattened[`${prefix}${key}`] = scalarize(value)
    }
  }
  return flattened
}

/**
 * The comparison surface. `personSelection` and its winning segment are flattened from whatever
 * keys the diagnostics object actually carries rather than enumerated here — a ticket adding a
 * field to that block (#54's `bridgedCuts` is its only observable) must not have to edit the
 * harness built to measure it, and a field silently missing from the table is worse than an
 * unexpected row.
 */
function extractFields(diagnostics, elapsedMs) {
  const selection = diagnostics.personSelection ?? {}
  const winner = selection.segments?.[0]

  const fields = {
    ...flatten('sampling.', diagnostics.sampling ?? {}),
    ...flatten('personSelection.', selection, ['segments']),
    ...(winner ? flatten('segments[0].', winner) : {}),
    ...flatten('view.', diagnostics.view ?? {}),
  }

  for (const id of Object.keys(diagnostics.metrics ?? {}).sort()) {
    const metric = diagnostics.metrics[id]
    fields[`metrics.${id}.value`] = scalarize(metric.value)
    fields[`metrics.${id}.confidence`] = scalarize(metric.confidence)
  }

  fields.elapsedMs = elapsedMs
  return fields
}

/** Group rank first, then name — with `.value` ahead of `.confidence` for the same metric. */
function fieldSortKey(field) {
  const group = FIELD_GROUPS.findIndex((prefix) => field.startsWith(prefix))
  const name = field.replace(/\.value$/, '.0').replace(/\.confidence$/, '.1')
  return `${group === -1 ? FIELD_GROUPS.length : group}|${name}`
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

function report({ renderer, baseURL, provenance, commit, options, results }) {
  const armLabels = options.arms.map((arm) => arm.label)
  const lines = [
    '# scripts/ab-person-selection.mjs',
    `# baseURL: ${baseURL} (${provenance})`,
    `# commit: ${commit}`,
    `# renderer: ${renderer}`,
    `# trials: ${options.trials}`,
    ...options.arms.map((arm) => `# arm ${arm.label}: ${JSON.stringify(arm.override)}`),
  ]

  for (const clipName of options.clips) {
    lines.push('', `## ${clipName}`)

    const succeeded = (label) =>
      results.get(`${clipName}|${label}`).filter((trial) => trial.fields)

    const fieldOrder = [
      ...new Set(armLabels.flatMap((label) => succeeded(label).flatMap((t) => Object.keys(t.fields)))),
    ].sort((a, b) => fieldSortKey(a).localeCompare(fieldSortKey(b)))

    const rows = [
      [
        'trials',
        ...armLabels.map((label) => {
          const all = results.get(`${clipName}|${label}`)
          return `${succeeded(label).length}/${all.length} ok`
        }),
      ],
      ...fieldOrder.map((field) => [
        field,
        ...armLabels.map((label) => {
          const trials = succeeded(label)
          return trials.length === 0
            ? '—'
            : summarize(trials.map((trial) => trial.fields[field] ?? null))
        }),
      ]),
    ]
    lines.push(...renderTable(['field', ...armLabels], rows))

    lines.push(
      ...armLabels.flatMap((label) =>
        results
          .get(`${clipName}|${label}`)
          .filter((trial) => trial.error)
          .map((trial) => `# FAILED ${clipName}/${label} trial ${trial.trial}: ${trial.error}`),
      ),
    )
  }

  return lines.join('\n')
}

async function loadPlaywrightConfig() {
  const href = pathToFileURL(path.join(REPO_ROOT, 'playwright.config.ts')).href
  try {
    return (await import(href)).default
  } catch (error) {
    throw new Error(
      `could not import playwright.config.ts on node ${process.version}. This driver reads the ` +
        'TypeScript config directly rather than duplicating its launch args, which needs Node ' +
        '>=22.18 (or >=22.6 with --experimental-strip-types) for native type stripping — above ' +
        "package.json's declared >=20.19.0 floor.",
      { cause: error },
    )
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const playwrightConfig = await loadPlaywrightConfig()

  const launchArgs = playwrightConfig.use.launchOptions.args
  const webServer = { ...playwrightConfig.webServer }
  let baseURL = playwrightConfig.use.baseURL
  if (options.port !== null) {
    baseURL = withPort(baseURL, options.port)
    webServer.url = withPort(webServer.url, options.port)
    webServer.command = webServer.command.replace(/--port \d+/, `--port ${options.port}`)
  }

  const { stop: stopServer, provenance } = await startDevServer(webServer, options.reuseServer)
  let browser
  try {
    browser = await chromium.launch({ args: launchArgs })

    const renderer = await warmUpAndReadRenderer(browser, baseURL)
    process.stderr.write(`renderer: ${renderer}\n`)
    if (renderer === null || /swiftshader|software|llvmpipe/i.test(renderer)) {
      throw new Error(
        `refusing to measure on "${renderer}" — that is software rendering, not the GPU. ` +
          'Every number this driver prints would be unrepresentative (CLAUDE.md, "real GPU").',
      )
    }

    // (clip, arm) -> trial records. Trial-major so no arm collects a disproportionate share of
    // whatever the machine is doing at one moment.
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

    const commit = headCommit()
    process.stdout.write(
      `${report({ renderer, baseURL, provenance, commit, options, results })}\n`,
    )

    if (options.jsonPath) {
      const target = path.resolve(options.jsonPath)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(
        target,
        `${JSON.stringify(
          {
            baseURL,
            serverProvenance: provenance,
            commit,
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
    await browser?.close()
    stopServer()
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  process.exitCode = 1
})
