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
 *   --backend-arm <label>=<json>
 *                         Repeatable. The second override plane: a partial PoseDetectorConfig
 *                         (src/pose/detector.ts) assigned to
 *                         window.__STRIDES_POSE_BACKEND_OVERRIDE__ the same way. Arms are joined
 *                         to --arm by LABEL, so one arm may set either plane or both; a label
 *                         named on only one plane gets `{}` on the other.
 *   --clips <a,b,c>       demo1 | demo2 | multiperson (default: all three)
 *   --trials <n>          Trials per (clip, arm). Default 3.
 *   --timeout <ms>        Per-trial wait for "Analysis complete". Default 300000.
 *   --port <n>            Dev-server port. Default is playwright.config.ts's, which derives one
 *                         per checkout so parallel worktrees stop colliding.
 *   --reuse-server        Attach to a dev server this run did not start. Refused by default —
 *                         see startDevServer for why that refusal is not pedantry. Reuse is still
 *                         identity-checked; the flag buys a shortcut, not trust.
 *   --reuse-browser       Run every trial in ONE Chromium process. Off by default because it
 *                         changes what gets measured — see the runTrial comment.
 *   --evidence            Also capture the `[evidence-coverage]` line (exemplar timestamps, crop
 *                         sides, per-metric status). Costs a wait for the scale-pass re-extraction.
 *   --json <path>         Also write the aggregate + every raw per-trial record here.
 *
 * Example:
 *   node scripts/ab-person-selection.mjs \
 *     --arm 'off={"personSelection":{"enabled":false}}' \
 *     --arm 'on={"personSelection":{"enabled":true}}' \
 *     --clips demo2 --trials 3
 *
 *   node scripts/ab-person-selection.mjs \
 *     --backend-arm 'off={"trackingCrop":{"enabled":false}}' \
 *     --backend-arm 'on={"trackingCrop":{"enabled":true}}' \
 *     --clips demo1,demo2 --trials 3
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
import {
  assertHardwareRenderer,
  assertServesThisCheckout,
  DEV_PORT_ENV_VAR,
  readRendererInPage,
} from './lib/harnessProvenance.mjs'

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
const SCALE_PASS_PREFIX = '[analysis-diagnostics:scale-pass]'
const EVIDENCE_PREFIX = '[evidence-coverage]'

/**
 * How long `--evidence` waits for the `[evidence-coverage]` stream to go quiet before taking the
 * last line. There can be TWO lines per run: on a MoveNet-primary run the background MediaPipe
 * scale pass grafts `verticalOscillationCm` in after `phase: 'ready'`, which changes the evidence
 * input signature and correctly triggers a re-extraction. Taking the first line reports a metric
 * as `metric-excluded` that the second reports as `planned`, so whether a harness sees one line or
 * two is a race — settled here by waiting rather than by winning it.
 */
const EVIDENCE_SETTLE_MS = 8_000
const EVIDENCE_MAX_WAIT_MS = 180_000

/**
 * Every key an arm override may set, at any depth. `null` marks a leaf; an object marks a nested
 * plane whose own keys are checked in turn. The app merges an override key-by-key and ignores what
 * it doesn't recognise, so a typo produces an arm bit-identical to baseline — indistinguishable in
 * the report from a real "no effect", which is the conclusion these A/Bs exist to reach honestly.
 * Checking only the top level would miss the likeliest typo of all (`{personSelection: {enable:
 * true}}`), since the misspelling lives one level down.
 *
 * The shape is recursive rather than a fixed two levels because the backend plane below goes
 * three deep (`personOfInterest.continuityGate.enabled`), and a validator that stops short of a
 * plane's depth is a validator that waves through exactly the typos it was written to catch.
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
  robustness: { minKeypointConfidence: null, maxGapSeconds: null },
  sequentialSampling: { enabled: null, targetSamplesPerSecond: null },
  personSelection: {
    enabled: null,
    minBoundingBoxAreaFraction: null,
    minKeypointConfidence: null,
    minConfidentKeypoints: null,
    maxAreaRatio: null,
    maxCenterSpeedSidesPerSecond: null,
    maxContinuityGapSeconds: null,
  },
}

/**
 * The same, for the SECOND override plane: `window.__STRIDES_POSE_BACKEND_OVERRIDE__`, a partial
 * `PoseDetectorConfig` (src/pose/detector.ts) resolved by `resolvePoseDetectorConfig`
 * (src/pose/poseBackendConfig.ts). `trackingCrop` and `personOfInterest` merge shallowly one level
 * deep over the default, and `personOfInterest.continuityGate` one level deeper still — the only
 * field on either plane that is itself an object, and the reason this schema is walked recursively.
 *
 * Mirrors `TrackingCropConfig` (src/pose/backends/trackingCropConfig.ts) plus
 * `PersonOfInterestConfig`/`ContinuityGateConfig` (src/pose/backends/personOfInterestConfig.ts).
 */
const BACKEND_ARM_KEYS = {
  backend: null,
  movenetModelType: null,
  trackingCrop: {
    enabled: null,
    minKeypointConfidence: null,
    minConfidentKeypoints: null,
    paddingMultiplier: null,
    minCropSidePx: null,
    reacquisitionLossThreshold: null,
  },
  personOfInterest: {
    enabled: null,
    continuityGate: {
      enabled: null,
      maxCenterSpeedSidesPerSecond: null,
      maxAreaRatio: null,
    },
  },
}

/**
 * Closed unions whose VALUES are checkable, so they are checked. The sampling plane has no
 * equivalent — its leaves are all open numerics — but `backend` and `movenetModelType` each admit
 * a fixed set, and an unrecognised id is the same silent failure as an unrecognised key:
 * `createPoseDetector` falls through to its default and the arm reads as baseline.
 *
 * `blazepose` and `posenet` are admitted despite both being known-broken in this environment
 * (CLAUDE.md, "Known issues"). The driver's job is to run the arm it was asked for; refusing an id
 * the app itself accepts would make the harness disagree with the app about what is expressible,
 * and such a trial fails loudly on its own.
 */
const BACKEND_ARM_ENUMS = {
  backend: ['movenet', 'blazepose', 'posenet', 'mediapipePoseLandmarker'],
  movenetModelType: ['lightning', 'thunder'],
}

/**
 * Field groups, in report order. Within a group fields sort alphabetically, so the row order is a
 * property of the field NAMES rather than of which arm happened to produce which keys first —
 * without that, an arm whose run skipped the selection stage (no `segments[0].*` at all) would
 * shift every later row and make two reports diff on ordering instead of on values.
 */
const FIELD_GROUPS = [
  'sampling.',
  'personSelection.',
  'segments[0].',
  'view.',
  'metrics.',
  'evidence.',
]

function requireValue(flag, value) {
  if (value === undefined) throw new Error(`${flag} needs a value`)
  return value
}

/**
 * Walks `value` against a recursive key schema, throwing on the first key the app would silently
 * ignore. `where` names the flag and label so the error identifies which arm is wrong, and `path`
 * accumulates the dotted key so a failure three levels down still says exactly where.
 */
function assertKnownKeys(schema, value, where, path = '') {
  for (const key of Object.keys(value)) {
    const dotted = path ? `${path}.${key}` : key
    if (!(key in schema)) {
      throw new Error(
        `${where}: unknown key "${dotted}" — known: ${Object.keys(schema)
          .map((known) => (path ? `${path}.${known}` : known))
          .join(', ')}`,
      )
    }
    const nestedSchema = schema[key]
    if (nestedSchema === null) continue
    const nested = value[key]
    if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) {
      throw new Error(`${where}: "${dotted}" must be a JSON object`)
    }
    assertKnownKeys(nestedSchema, nested, where, dotted)
  }
}

/** Checks the leaves whose value sets are closed (see `BACKEND_ARM_ENUMS`). */
function assertKnownValues(enums, value, where) {
  for (const [key, allowed] of Object.entries(enums)) {
    if (!(key in value)) continue
    if (!allowed.includes(value[key])) {
      throw new Error(
        `${where}: "${key}" must be one of ${allowed.join(' | ')}, got ${JSON.stringify(value[key])}`,
      )
    }
  }
}

/**
 * Parses one `<label>=<json>` arm on either override plane. `flag` and `schema` are what differ;
 * everything else — the label split, the JSON parse, the object check, the recursive key check —
 * is shared, so the two planes cannot drift into validating to different standards.
 */
function parseArmOnPlane(flag, schema, enums, value) {
  const split = value.indexOf('=')
  if (split < 1) throw new Error(`${flag} needs <label>=<json>, got: ${value}`)
  const label = value.slice(0, split)
  const json = value.slice(split + 1)
  const where = `${flag} ${label}`

  let override
  try {
    override = JSON.parse(json)
  } catch (error) {
    throw new Error(`${where}: override is not valid JSON`, { cause: error })
  }
  if (override === null || typeof override !== 'object' || Array.isArray(override)) {
    throw new Error(`${where}: override must be a JSON object, got ${json}`)
  }
  assertKnownKeys(schema, override, where)
  if (enums) assertKnownValues(enums, override, where)
  return { label, override }
}

const parseArm = (value) => parseArmOnPlane('--arm', ARM_KEYS, null, value)
const parseBackendArm = (value) =>
  parseArmOnPlane('--backend-arm', BACKEND_ARM_KEYS, BACKEND_ARM_ENUMS, value)

function parseArgs(argv) {
  const options = {
    arms: [],
    backendArms: [],
    clips: Object.keys(CLIPS),
    trials: 3,
    timeoutMs: 300_000,
    port: null,
    reuseServer: false,
    reuseBrowser: false,
    evidence: false,
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
      case '--backend-arm':
        options.backendArms.push(parseBackendArm(requireValue(flag, value)))
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
      case '--reuse-browser':
        options.reuseBrowser = true
        break
      case '--evidence':
        options.evidence = true
        break
      case '--json':
        options.jsonPath = requireValue(flag, value)
        i += 1
        break
      default:
        throw new Error(`unknown flag: ${flag}`)
    }
  }

  for (const [flag, parsed] of [
    ['--arm', options.arms],
    ['--backend-arm', options.backendArms],
  ]) {
    const labels = new Set(parsed.map((arm) => arm.label))
    if (labels.size !== parsed.length) {
      throw new Error(`${flag} labels must be unique`)
    }
  }
  if (options.arms.length === 0 && options.backendArms.length === 0) {
    throw new Error(
      'at least one --arm or --backend-arm <label>=<json> is required (use `{}` for a baseline arm)',
    )
  }

  // Arms are joined by LABEL across the two planes, so one arm can carry a sampling override, a
  // backend override, or both, and an arm named on only one plane gets `{}` on the other. Order is
  // first appearance, sampling plane first, so a report's column order is a property of the
  // command line rather than of which plane happened to be parsed first.
  const byLabel = new Map()
  for (const [plane, parsed] of [
    ['override', options.arms],
    ['backendOverride', options.backendArms],
  ]) {
    for (const arm of parsed) {
      const existing = byLabel.get(arm.label)
      if (existing) existing[plane] = arm.override
      else byLabel.set(arm.label, { label: arm.label, override: {}, backendOverride: {}, [plane]: arm.override })
    }
  }
  options.arms = [...byLabel.values()]
  // Kept only so the report can tell "this arm set no backend override" from "this run used no
  // backend plane at all" — the latter suppresses the header lines entirely.
  options.usesBackendPlane = options.backendArms.length > 0
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
 *
 * `--reuse-server` no longer means "take my word for it". The caller used to have to confirm the
 * running server served this checkout by eye; `assertServesThisCheckout` now confirms it by nonce,
 * so the flag skips a startup rather than a guard. That check then runs on the started-it path
 * too — it is one localhost fetch, and a guard exercised only by a rarely-passed flag is a guard
 * nobody notices has stopped working.
 */
async function startDevServer({ command, url, timeout }, reuse) {
  if (await serverIsUp(url)) {
    if (!reuse) {
      throw new Error(
        `${url} is already being served and this run did not start it. Refusing to measure ` +
          'against a checkout that may not be this one. Stop that server, re-run with --port ' +
          `<free port> (or ${DEV_PORT_ENV_VAR}=<free port>), or pass --reuse-server to have this ` +
          'run verify it serves THIS checkout before measuring.',
      )
    }
    process.stderr.write(`dev server: attaching to ${url} (--reuse-server)\n`)
    await assertServesThisCheckout(url)
    return { stop: () => {}, provenance: 'reused, NOT started by this run, identity verified' }
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
    if (await serverIsUp(url)) {
      await assertServesThisCheckout(url).catch((error) => {
        // Don't leave a server behind that this run started but will not measure against.
        stop()
        throw error
      })
      return { stop, provenance: 'started by this run, identity verified' }
    }
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
 *
 * Runs in its own throwaway browser rather than in the first trial's, because the first trial's
 * process is not allowed to be special — that privilege is the whole of `strides-9wp`.
 */
async function warmUpAndReadRenderer(launchArgs, baseURL) {
  const browser = await chromium.launch({ args: launchArgs })
  try {
    const page = await browser.newPage()
    await page.goto(baseURL)
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
    return await page.evaluate(readRendererInPage)
  } finally {
    await browser.close()
  }
}

/**
 * One analysis run: fresh context (so the override is installed before any page script runs),
 * drive the clip, capture the PRIMARY diagnostics line, return the fields we compare on.
 *
 * **`browser` is a fresh process per trial unless `--reuse-browser` says otherwise**, and that is
 * a measurement decision rather than hygiene (`strides-9wp`). Reusing one Chromium across trials
 * shifts Demo 2's sampling from trial 2 onward: `armSwingSymmetry`'s exemplar moves from
 * t=0.984317 with a 320 px crop (the `EVIDENCE_CROP_MIN_SIDE_PX` floor, subject 264.7 px) to
 * t=1.468133 with a 398.7 px crop (subject 449.4 px). Only the fresh-process regime reproduces
 * the coverage CLAUDE.md records for that clip. The damage is the same shape as measuring against
 * a foreign server: in the reused regime the subject is WIDER than the crop, so a subject-centring
 * rule correctly declines to fire, and a driver reusing a browser would have reported "no effect"
 * for a fix that demonstrably works. The defect reproduces either way; it is the FIX that goes
 * invisible. A context is not enough — the shift survives `browser.newContext()`.
 */
async function runTrial(
  browser,
  { baseURL, clip, clipName, override, backendOverride, timeoutMs, evidence },
) {
  const context = await browser.newContext()
  try {
    // Both planes go in via `addInitScript`, never `evaluate`: auto-analyze can start before an
    // `evaluate()` after `goto()` lands, and the backend override is read once per detector
    // creation — earlier still than the sampling one.
    await context.addInitScript((value) => {
      window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = value
    }, override)
    await context.addInitScript((value) => {
      window.__STRIDES_POSE_BACKEND_OVERRIDE__ = value
    }, backendOverride)

    const page = await context.newPage()

    let resolveDiagnostics
    let rejectDiagnostics
    const diagnosticsPromise = new Promise((resolve, reject) => {
      resolveDiagnostics = resolve
      rejectDiagnostics = reject
    })
    // Keeps a rejection that lands before the await below from surfacing as unhandled.
    diagnosticsPromise.catch(() => {})

    const evidenceLines = []
    let lastEvidenceAt = 0
    let scalePassSeen = false

    page.on('console', (message) => {
      const text = message.text()
      if (text.startsWith(SCALE_PASS_PREFIX)) {
        scalePassSeen = true
        return
      }
      if (text.startsWith(EVIDENCE_PREFIX)) {
        try {
          evidenceLines.push(JSON.parse(text.slice(EVIDENCE_PREFIX.length).trim()))
          lastEvidenceAt = Date.now()
        } catch {
          // A malformed evidence line costs the evidence columns, not the trial.
        }
        return
      }
      // Exclusive: `[analysis-diagnostics:scale-pass]` also starts with the bare prefix, and is
      // already returned above.
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

    // Wait for the evidence stream to go quiet rather than for a line count: see
    // EVIDENCE_SETTLE_MS. Quiescence is gated on the scale pass having reported, so a fast machine
    // cannot settle in the gap before the graft's re-extraction starts.
    if (evidence) {
      const deadline = Date.now() + EVIDENCE_MAX_WAIT_MS
      let settled = false
      while (!settled && Date.now() < deadline) {
        settled =
          evidenceLines.length > 0 && scalePassSeen && Date.now() - lastEvidenceAt > EVIDENCE_SETTLE_MS
        if (!settled) await new Promise((resolve) => setTimeout(resolve, 250))
      }
      // The cap yields whatever arrived rather than failing the trial, so say so — an
      // un-settled capture may be the pre-graft line, which reports a grafted metric as
      // `metric-excluded`, and that must not be mistaken for a coverage regression.
      if (!settled) {
        process.stderr.write(
          `\n  WARNING: [evidence-coverage] did not settle in ${EVIDENCE_MAX_WAIT_MS}ms ` +
            `(${evidenceLines.length} line(s), scale pass ${scalePassSeen ? 'reported' : 'SILENT'}) `,
        )
      }
    }

    // `undefined` means "not asked for"; `null` means "asked for and none arrived" — distinct
    // states that must not both render as an absent row.
    return extractFields(diagnostics, elapsedMs, evidence ? (evidenceLines.at(-1) ?? null) : undefined)
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
 *
 * `arrays` defaults to stringifying, which is what every pre-existing caller got and must keep
 * getting — descending into an array here would renumber rows in reports this driver has already
 * produced. `[evidence-coverage]` is array-shaped to its core (clips, exemplars) and opts into
 * `'index'`, which walks them as `prefix[n].`.
 */
function flatten(prefix, source, skip = [], arrays = 'stringify') {
  const flattened = {}
  for (const key of Object.keys(source).sort()) {
    if (skip.includes(key)) continue
    const value = source[key]
    if (Array.isArray(value) && arrays === 'index') {
      value.forEach((entry, index) => {
        if (isPlainObject(entry)) {
          Object.assign(flattened, flatten(`${prefix}${key}[${index}].`, entry, [], arrays))
        } else {
          flattened[`${prefix}${key}[${index}]`] = scalarize(entry)
        }
      })
    } else if (isPlainObject(value)) {
      Object.assign(flattened, flatten(`${prefix}${key}.`, value, [], arrays))
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
function extractFields(diagnostics, elapsedMs, evidenceCoverage) {
  const selection = diagnostics.personSelection ?? {}
  const winner = selection.segments?.[0]

  const fields = {
    ...flatten('sampling.', diagnostics.sampling ?? {}),
    ...flatten('personSelection.', selection, ['segments']),
    ...(winner ? flatten('segments[0].', winner) : {}),
    ...flatten('view.', diagnostics.view ?? {}),
  }

  // The same "flatten whatever is there" rule as the block above, and it was stated there while
  // this loop did the opposite: a hardcoded pair of keys meant `viewFit`, `sampleSize`,
  // `frameCoverage` and `interpolatedFraction` — the fields that say WHY a value or a confidence
  // moved — never reached the table, so a ticket adding one had to edit this driver first.
  //
  // `caveat` is the single skip, expressed through `flatten`'s existing skip-list idiom (the
  // `personSelection` block above skips `segments` the same way). It is derived prose restating
  // `sampleSize` and `viewFit`, it is unconditionally non-null for `footStrikePattern`, and it
  // would put a ~200-character cell per metric per clip into a terminal table.
  for (const id of Object.keys(diagnostics.metrics ?? {}).sort()) {
    Object.assign(fields, flatten(`metrics.${id}.`, diagnostics.metrics[id], ['caveat']))
  }

  // Same "flatten whatever is there" rule as the block above, for the same reason: the fields that
  // discriminate a fresh-process run from a reused one (exemplar `timestamp`, `cropSidePx`) are
  // not enumerated here, so a ticket adding one gets it measured without editing this driver.
  if (evidenceCoverage !== undefined) {
    Object.assign(
      fields,
      evidenceCoverage === null
        ? { 'evidence.captured': false }
        : { 'evidence.captured': true, ...flatten('evidence.', evidenceCoverage, [], 'index') },
    )
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
    // Provenance, same as the baseURL and commit lines above it: the browser regime changes what
    // gets measured on Demo 2 (strides-9wp), so a diff of two reports has to surface it on a line
    // rather than leave it to be inferred from the numbers.
    `# browser: ${options.reuseBrowser ? 'ONE process reused across trials (--reuse-browser)' : 'fresh process per trial'}`,
    `# trials: ${options.trials}`,
    ...options.arms.map((arm) => `# arm ${arm.label}: ${JSON.stringify(arm.override)}`),
    // Emitted only when this run used the backend plane at all, so a report produced without
    // `--backend-arm` is byte-identical to one produced before that flag existed — `> before.txt`
    // / `> after.txt` diffs spanning this change stay clean on the sampling plane.
    ...(options.usesBackendPlane
      ? options.arms.map(
          (arm) => `# backend-arm ${arm.label}: ${JSON.stringify(arm.backendOverride)}`,
        )
      : []),
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
  let sharedBrowser
  try {
    const renderer = await warmUpAndReadRenderer(launchArgs, baseURL)
    process.stderr.write(`renderer: ${renderer}\n`)
    assertHardwareRenderer(renderer)

    // Fresh per trial unless asked otherwise — see runTrial for what reuse costs. The shared
    // browser is launched here rather than reusing the warmup one so that under --reuse-browser
    // every trial including the first sees an equally-used process.
    sharedBrowser = options.reuseBrowser ? await chromium.launch({ args: launchArgs }) : null
    process.stderr.write(
      `browser: ${sharedBrowser ? 'ONE process reused across trials' : 'fresh process per trial'}\n`,
    )

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
          const browser = sharedBrowser ?? (await chromium.launch({ args: launchArgs }))
          try {
            record.fields = await runTrial(browser, {
              baseURL,
              clip: CLIPS[clipName],
              clipName,
              override: arm.override,
              backendOverride: arm.backendOverride,
              timeoutMs: options.timeoutMs,
              evidence: options.evidence,
            })
            process.stderr.write(
              `detected ${record.fields['sampling.detectedFrames']}/${record.fields['sampling.totalSamples']} in ${record.fields.elapsedMs}ms\n`,
            )
          } catch (error) {
            record.error = error.message
            process.stderr.write(`FAILED: ${error.message}\n`)
          } finally {
            if (!sharedBrowser) await browser.close()
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
            browserProvenance: options.reuseBrowser ? 'one process reused' : 'fresh per trial',
            commit,
            renderer,
            trials: options.trials,
            // Each entry carries BOTH planes (`override`, `backendOverride`), so a record read
            // back months later says which arm set what without needing the command line.
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
    await sharedBrowser?.close()
    stopServer()
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  process.exitCode = 1
})
