#!/usr/bin/env node
/**
 * TEMPORARY harvest driver for issue #57's `[bbox-trace]` probe. Added, measured, and DELETED
 * along with `src/results/boundingBoxTrace.experimental.ts` and the log line in
 * `useVideoAnalysis.ts` — before any A/B arm runs, per CLAUDE.md's experimental-probe cycle.
 *
 * Deliberately NOT a change to `scripts/ab-person-selection.mjs`: that driver is shared by four
 * #52 tickets and every A/B in the epic has to stay comparable, so it does not grow a one-ticket
 * mode. This one mirrors its scaffolding (same `playwright.config.ts` import for launch args /
 * baseURL / dev-server command, same refusal to measure against a server it did not start, same
 * refusal to measure on software rendering) and captures a different console prefix.
 *
 * Usage:
 *   node scripts/bbox-trace-harvest.mjs --clip demo1 --trials 3 --port 5199 --json out.json
 *
 *   --clip <name>     demo1 | demo2 | multiperson. Repeatable. Default: all three.
 *   --file <path>     Extra clip driven through the Upload tab. Repeatable.
 *   --trials <n>      Trials per clip. Default 3.
 *   --timeout <ms>    Per-trial wait for "Analysis complete". Default 300000.
 *   --port <n>        Dev-server port. Default is playwright.config.ts's.
 *   --reuse-server    Measure against a dev server this run did not start. Refused by default.
 *   --json <path>     Write every raw trace here. Without it only the summary is printed.
 *
 * Progress goes to stderr; the summary (per clip: sample counts, the area distribution's order
 * statistics, and the N smallest/largest detections with their timestamps) goes to stdout. The
 * timestamps in that tail are the ones to hand to `ffmpeg -ss` for keyframe classification.
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CLIPS = {
  demo1: { kind: 'demo', button: /demo 1/i },
  demo2: { kind: 'demo', button: /demo 2/i },
  multiperson: {
    kind: 'upload',
    file: path.join(REPO_ROOT, 'e2e', 'fixtures', 'multiperson-track.mp4'),
  },
}

const TRACE_PREFIX = '[bbox-trace]'
/** Captured alongside the trace so each detection can be labelled inside/outside the winner's
 * span in the same run. Without it the "N smallest inside the winner, N largest outside it" split
 * the classification step needs would take a second, differently-sampled run to produce. */
const DIAGNOSTICS_PREFIX = '[analysis-diagnostics]'
/** How many extreme detections to print per clip — the candidates for keyframe classification. */
const TAIL = 12

function requireValue(flag, value) {
  if (value === undefined) throw new Error(`${flag} needs a value`)
  return value
}

function parseArgs(argv) {
  const options = {
    clips: [],
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
      case '--clip': {
        const name = requireValue(flag, value)
        if (!(name in CLIPS)) {
          throw new Error(`unknown clip "${name}" — known: ${Object.keys(CLIPS).join(', ')}`)
        }
        options.clips.push({ name, clip: CLIPS[name] })
        i += 1
        break
      }
      case '--file': {
        const file = path.resolve(requireValue(flag, value))
        options.clips.push({ name: path.basename(file), clip: { kind: 'upload', file } })
        i += 1
        break
      }
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

  if (options.clips.length === 0) {
    options.clips = Object.keys(CLIPS).map((name) => ({ name, clip: CLIPS[name] }))
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

/** Same refusal, and the same reason, as `scripts/ab-person-selection.mjs`: a dev server from a
 * different checkout answers just as happily and yields a plausible trace from code nobody is
 * reviewing. Worktrees routinely leave a server on 5173. */
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

/** Warms vite's on-demand transform of the tfjs/MediaPipe graph AND reads the renderer string. */
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

/** One analysis run. No config override at all — the trace applies no floor, so it is the same
 * whatever `minBoundingBoxAreaFraction` currently is, and the default arm is the honest one. */
async function runTrial(browser, { baseURL, clip, clipName, timeoutMs }) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()

    const capture = () => {
      let settle
      let fail
      const promise = new Promise((resolve, reject) => {
        settle = resolve
        fail = reject
      })
      // Keeps a rejection that lands before the await below from surfacing as unhandled.
      promise.catch(() => {})
      return { promise, settle, fail }
    }
    const trace = capture()
    const diagnostics = capture()

    page.on('console', (message) => {
      const text = message.text()
      const target = text.startsWith(TRACE_PREFIX)
        ? { sink: trace, prefix: TRACE_PREFIX }
        : // Exclusive: `[analysis-diagnostics:scale-pass]` also starts with the bare prefix, and
          // that pass runs its own selection — #56's subject, not this ticket's.
          text.startsWith(DIAGNOSTICS_PREFIX) && !text.startsWith('[analysis-diagnostics:')
          ? { sink: diagnostics, prefix: DIAGNOSTICS_PREFIX }
          : null
      if (target === null) return
      try {
        target.sink.settle(JSON.parse(text.slice(target.prefix.length).trim()))
      } catch (error) {
        // Throwing inside an EventEmitter listener escapes Playwright's dispatch as an uncaught
        // exception and kills the process, losing every completed trial. Fail this one instead.
        target.sink.fail(
          new Error(`${target.prefix} line was not parseable JSON`, { cause: error }),
        )
      }
    })

    await page.goto(baseURL)

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
    completed.catch(() => {})
    downloadFailed.catch(() => {})

    const outcome = await Promise.race([completed, downloadFailed])
    if (outcome !== 'complete') {
      throw new Error(`${clipName}: the demo clip failed to download`)
    }

    const deadline = (prefix) =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`no ${prefix} line`)), 15_000),
      )
    return {
      trace: await Promise.race([trace.promise, deadline(TRACE_PREFIX)]),
      personSelection: (
        await Promise.race([diagnostics.promise, deadline(DIAGNOSTICS_PREFIX)])
      ).personSelection,
    }
  } finally {
    await context.close()
  }
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null
  const position = (sorted.length - 1) * q
  const low = Math.floor(position)
  const high = Math.ceil(position)
  return low === high
    ? sorted[low]
    : sorted[low] + (sorted[high] - sorted[low]) * (position - low)
}

function fmt(value) {
  if (value === null || value === undefined) return 'null'
  if (!Number.isFinite(value)) return String(value)
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)))
}

/**
 * `[t0, t1]` of the winning segment, or `null` when the stage skipped. This is the PARTITION span
 * (`retroactivePersonSelection.ts` documents the distinction) — good enough to sort candidates
 * into "the winner's stretch" and "somewhere else", which is all the classification step needs
 * before a human looks at the keyframes.
 */
function winnerSpan(personSelection) {
  const winner = personSelection?.segments?.[0]
  return winner ? [winner.startTimestamp, winner.endTimestamp] : null
}

function summarizeClip(clipName, trials) {
  const lines = [`## ${clipName}`]
  if (trials.length === 0) {
    lines.push('(no successful trials)')
    return lines
  }

  const first = trials[0].trace
  lines.push(
    `frame: ${first.frameWidth}x${first.frameHeight} = ${first.frameArea} px²`,
    `samples/trial:  ${trials.map((t) => t.trace.totalSamples).join(' ')}`,
    `detected/trial: ${trials.map((t) => t.trace.detectedSamples).join(' ')}`,
    `boxless/trial:  ${trials.map((t) => t.trace.boxlessSamples).join(' ')}`,
    `boxes/trial:    ${trials.map((t) => t.trace.detections.length).join(' ')}`,
    `winner span/trial: ${trials
      .map((t) => {
        const span = winnerSpan(t.personSelection)
        return span === null ? 'skipped' : `[${span[0]},${span[1]}]`
      })
      .join(' ')}`,
    `segmentCount/trial: ${trials.map((t) => t.personSelection?.segmentCount ?? '?').join(' ')}`,
  )

  // Pooled across trials, exactly as the derivation reads it: the endpoints are a MAX (for
  // spurious boxes) and a MIN (for genuine subject boxes) over the trials, never a per-trial
  // average — a phantom that only shows up in one trial still has to be below the floor.
  const pooled = trials.flatMap(({ trace, personSelection }, index) => {
    const span = winnerSpan(personSelection)
    return trace.detections.map((d) => ({
      ...d,
      trial: index + 1,
      inWinner: span !== null && d.t >= span[0] && d.t <= span[1],
    }))
  })
  const areas = pooled.map((d) => d.a).sort((a, b) => a - b)
  lines.push(
    `pooled boxes: ${areas.length}`,
    `area px²  min ${fmt(areas[0])}  p05 ${fmt(quantile(areas, 0.05))}  ` +
      `p25 ${fmt(quantile(areas, 0.25))}  median ${fmt(quantile(areas, 0.5))}  ` +
      `p75 ${fmt(quantile(areas, 0.75))}  max ${fmt(areas[areas.length - 1])}`,
    `as a fraction of frame area:  min ${fmt(areas[0] / first.frameArea)}  ` +
      `median ${fmt(quantile(areas, 0.5) / first.frameArea)}  ` +
      `max ${fmt(areas[areas.length - 1] / first.frameArea)}`,
  )

  const byArea = [...pooled].sort((a, b) => a.a - b.a)
  const row = (d) =>
    `  t=${d.t.toFixed(4)}  a=${fmt(d.a)}  frac=${fmt(d.a / first.frameArea)}  ` +
    `c=(${fmt(d.cx)},${fmt(d.cy)})  ${fmt(d.w)}x${fmt(d.h)}  n=${d.n}  s=${fmt(d.s)}  ` +
    `trial ${d.trial}  ${d.inWinner ? 'inWinner' : 'OUTSIDE'}`

  const inside = byArea.filter((d) => d.inWinner)
  const outside = byArea.filter((d) => !d.inWinner)
  lines.push(
    `smallest ${TAIL} INSIDE the winner's span (candidates for the genuine-subject ceiling S):`,
    ...inside.slice(0, TAIL).map(row),
    `largest ${TAIL} OUTSIDE the winner's span (candidates for the spurious floor G):`,
    ...outside.slice(-TAIL).reverse().map(row),
    `smallest ${TAIL} overall, span-agnostic:`,
    ...byArea.slice(0, TAIL).map(row),
  )
  return lines
}

async function loadPlaywrightConfig() {
  const href = pathToFileURL(path.join(REPO_ROOT, 'playwright.config.ts')).href
  try {
    return (await import(href)).default
  } catch (error) {
    throw new Error(
      `could not import playwright.config.ts on node ${process.version}. This driver reads the ` +
        'TypeScript config directly rather than duplicating its launch args, which needs Node ' +
        '>=22.18 (or >=22.6 with --experimental-strip-types) for native type stripping.',
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

    const records = []
    for (const { name, clip } of options.clips) {
      for (let trial = 1; trial <= options.trials; trial += 1) {
        process.stderr.write(`run: ${name} / trial ${trial}… `)
        try {
          const { trace, personSelection } = await runTrial(browser, {
            baseURL,
            clip,
            clipName: name,
            timeoutMs: options.timeoutMs,
          })
          records.push({ clip: name, trial, trace, personSelection })
          process.stderr.write(
            `${trace.detections.length} boxes / ${trace.detectedSamples} detected / ` +
              `${trace.totalSamples} samples\n`,
          )
        } catch (error) {
          records.push({ clip: name, trial, error: error.message })
          process.stderr.write(`FAILED: ${error.message}\n`)
        }
      }
    }

    const commit = headCommit()
    const lines = [
      '# scripts/bbox-trace-harvest.mjs (TEMPORARY — issue #57)',
      `# baseURL: ${baseURL} (${provenance})`,
      `# commit: ${commit}`,
      `# renderer: ${renderer}`,
      `# trials: ${options.trials}`,
      '# NOTE: no area floor is applied to this trace — every box-yielding detection is reported.',
    ]
    for (const { name } of options.clips) {
      const trials = records.filter((record) => record.clip === name && record.trace)
      lines.push('', ...summarizeClip(name, trials))
      for (const failed of records.filter((r) => r.clip === name && r.error)) {
        lines.push(`# FAILED ${name} trial ${failed.trial}: ${failed.error}`)
      }
    }
    process.stdout.write(`${lines.join('\n')}\n`)

    if (options.jsonPath) {
      const target = path.resolve(options.jsonPath)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(
        target,
        `${JSON.stringify(
          { baseURL, serverProvenance: provenance, commit, renderer, trials: options.trials, records },
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
