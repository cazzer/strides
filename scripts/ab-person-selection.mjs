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
 *   --view-arm <label>=<json>
 *                         Repeatable. The third plane: which results view the page opens on,
 *                         `{"view":"tour"|"summary"|"classic"}`, written to the address as
 *                         `?view=<value>`. Joined by LABEL like --backend-arm. `{}` (or an arm
 *                         that never names this plane) opens the bare address: the default view.
 *                         For fidelity gates — a view must never change what gets measured.
 *   --clips <a,b,c>       side-landscape | side-portrait | front-approach | multiperson
 *                         (default: all four). ⚠️ These keys were `demo1`/`demo2` and now name
 *                         the footage instead — `demo1` was the Pexels stock clip, which the UI
 *                         no longer bundles, so its readings do not transfer to `side-landscape`.
 *                         `side-portrait` is new coverage (345 frames, 12.17 s — the longest clip
 *                         in the corpus) and joins the default, so a default run is longer than
 *                         it used to be; name `--clips` explicitly to get the old three-clip cost.
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
 *   --scale-pass          Also capture the `[analysis-diagnostics:scale-pass]` line (the background
 *                         MediaPipe pass VO_cm and stepWidthCm come from) as `scalePass.*` rows:
 *                         its status, subject agreement and full diagnostics, plus
 *                         `scalePass.lines` (how many arrived; the last is the one flattened).
 *                         Waits for the line like --evidence does. Off by default so a report
 *                         without it stays byte-identical to one taken before the flag existed;
 *                         a view fidelity gate passes `--evidence --scale-pass`.
 *   --outline-pass        Also capture the `[analysis-diagnostics:outline-pass]` line (the
 *                         background outline pass sideways foot travel comes from, strides-uz48)
 *                         as `outlinePass.*` rows, plus `outlinePass.lines`. Waits for the line;
 *                         with --evidence, evidence quiescence is also gated on it, since the
 *                         outline graft re-extracts evidence after the scale pass's.
 *   --perf                Also capture every dev-only `[perf-timings]` line as `perf.*` rows
 *                         (`src/results/perfTimings.ts`). Same settle wait as --evidence. Every
 *                         row is wall-clock, so expect spread; off by default so a report without
 *                         it stays byte-identical to one taken before the line existed.
 *   --json <path>         Also write the aggregate + every raw per-trial record here.
 *   --android [serial]    Drive Chrome on an adb-attached Android phone instead of a local Chromium
 *                         (serial defaults to $ANDROID_SERIAL). Opt-in; without it nothing below
 *                         applies and a desktop report is byte-identical to one taken before the
 *                         flag existed. The dev server starts here as usual and is reached from the
 *                         phone through `adb reverse`, so the phone opens the same
 *                         http://localhost:<port>/strides/ address (a secure context, which
 *                         WebCodecs needs). CDP rides `adb forward tcp:9222
 *                         localabstract:chrome_devtools_remote` + `connectOverCDP`. "Fresh process
 *                         per trial" becomes `am force-stop` + relaunch + reconnect, one new tab per
 *                         trial in Chrome's default context (Android Chrome cannot create browser
 *                         contexts), with this origin's localStorage/IndexedDB/service workers
 *                         cleared before each trial; the HTTP cache and Cache Storage (model files)
 *                         are NOT cleared, so a phone trial is a cold process with warm model
 *                         caches. Clips go over CDP as byte buffers (Playwright's 50 MB cap), and
 *                         `elapsedMs` starts when that upload resolves — wireless adb moves ~1.5 MB/s,
 *                         which would otherwise dominate it. Adds `device.*` rows: battery/skin
 *                         temperature and thermal status before and after each trial, the upload
 *                         time, page-clock time from the file input's `change` to "Analysis
 *                         complete" and to each background pass, and main-thread long-task totals.
 *                         The header's renderer line becomes a device line (model, Chrome version,
 *                         WebGL renderer — software rendering still refuses — battery temperature).
 *                         Keeps the screen on for the run (`svc power stayon`, restored after).
 *   --decoder-hint <h>    `prefer-software` | `prefer-hardware` | `no-preference`, written into every
 *                         `VideoDecoder.configure()` the page makes (init script; app code unchanged).
 *                         A same-device PERTURBATION arm (strides-p1qt.16): on the M4 Pro,
 *                         `prefer-software` swaps VideoToolbox NV12 for FFmpeg I420, which moves the
 *                         drawn pixels by ~0.005 levels on average — and moves the metrics about as
 *                         much as running on a Galaxy S21 does. Use it to tell "this change is
 *                         robust" from "this change happened to land on one decoder's rounding". On
 *                         Android, `prefer-software` is also the only route to YUV bytes: the
 *                         hardware decoder hands out already-converted RGBA frames. Opt-in; the
 *                         header gains a `# decoder hint:` line only when it is set.
 *   --cool-below <°C>     Android only: before each trial, wait (phone idle, Chrome stopped) until
 *                         the battery reads below this and thermal status is 0. Default 36.
 *
 * Example:
 *   node scripts/ab-person-selection.mjs \
 *     --arm 'off={"personSelection":{"enabled":false}}' \
 *     --arm 'on={"personSelection":{"enabled":true}}' \
 *     --clips front-approach --trials 3
 *
 *   node scripts/ab-person-selection.mjs \
 *     --backend-arm 'off={"trackingCrop":{"enabled":false}}' \
 *     --backend-arm 'on={"trackingCrop":{"enabled":true}}' \
 *     --clips side-landscape,front-approach --trials 3
 *
 * Progress goes to stderr; only the report goes to stdout, with no timestamps and a fixed field
 * order, so `node scripts/ab-person-selection.mjs ... > before.txt` and a second run's
 * `after.txt` can be compared with `diff`. The report's header stamps the baseURL, whether the
 * server was this run's, and the commit, so a diff surfaces a provenance mismatch on line 2
 * rather than leaving it to be inferred from the numbers.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

const DEMO_CLIP_DIR = path.join(REPO_ROOT, 'src', 'video', 'demo-clips')

/**
 * Every clip is driven through the Upload tab, including the three the UI bundles as its demo.
 *
 * That is a consequence of the demo becoming ONE action that loads three clips at once: a button
 * that produces a fused three-clip session cannot serve as a per-clip measurement arm, because
 * every arm would then measure the same fusion rather than the clip under test. Uploading each
 * bundled file individually restores per-clip measurement — and removes the last network
 * dependency in this harness, since the side-view clip used to be fetched live from Pexels.
 *
 * ⚠️ The keys name the FOOTAGE, not a button. They were `demo1`/`demo2`, and `demo1` meant the
 * Pexels stock clip, which is no longer reachable from the UI at all. Reusing that key for
 * different footage would make two incomparable measurements look comparable in a `before.txt` /
 * `after.txt` diff — which is precisely the failure this harness's provenance header exists to
 * catch — so the keys were renamed rather than repointed. Every anchor CLAUDE.md records under
 * "Demo 1" was measured on the Pexels clip and does not transfer to `side-landscape`.
 */
const CLIPS = {
  // Landscape 4K side pass, 3840x2160, 233 frames, 3.88 s.
  'side-landscape': {
    kind: 'upload',
    file: path.join(DEMO_CLIP_DIR, 'park-side-landscape.mp4'),
  },
  // Portrait side pass, 1080x1920, 345 frames, 12.17 s — the longest clip in the corpus.
  'side-portrait': {
    kind: 'upload',
    file: path.join(DEMO_CLIP_DIR, 'park-side-portrait.mp4'),
  },
  // Front-approach clip, portrait 4K, 99 frames, 1.65 s. Formerly `demo2`; same bytes, same file.
  'front-approach': {
    kind: 'upload',
    file: path.join(DEMO_CLIP_DIR, 'park-approach.mp4'),
  },
  // Not wired into the UI — the e2e-only multi-person fixture.
  multiperson: {
    kind: 'upload',
    file: path.join(REPO_ROOT, 'e2e', 'fixtures', 'multiperson-track.mp4'),
  },
}

/**
 * Private clips — gitignored, never in the default set, since this repo is public and they
 * exist only on machines that have pulled them. Registered as `private-<basename>` from
 * whatever H.264 copies sit in `fixtures-private/clips/`, so `--clips` must name them.
 */
const PRIVATE_CLIP_DIR = path.join(REPO_ROOT, 'fixtures-private', 'clips')
const PUBLIC_CLIP_NAMES = Object.keys(CLIPS)
if (existsSync(PRIVATE_CLIP_DIR)) {
  for (const entry of readdirSync(PRIVATE_CLIP_DIR).sort()) {
    if (!entry.endsWith('.mp4')) continue
    CLIPS[`private-${path.basename(entry, '.mp4')}`] = {
      kind: 'upload',
      file: path.join(PRIVATE_CLIP_DIR, entry),
    }
  }
}

const DIAGNOSTICS_PREFIX = '[analysis-diagnostics]'
const SCALE_PASS_PREFIX = '[analysis-diagnostics:scale-pass]'
const OUTLINE_PASS_PREFIX = '[analysis-diagnostics:outline-pass]'
const EVIDENCE_PREFIX = '[evidence-coverage]'
const PERF_PREFIX = '[perf-timings]'

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
    shrinkReferenceWindowSeconds: null,
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
      shrinkReferenceWindowSeconds: null,
    },
    identityChallenge: {
      enabled: null,
      tentativeIntervalFrames: null,
      confirmationsToSettle: null,
      tentativeMinAreaRatio: null,
      settledIntervalFrames: null,
      minAreaRatio: null,
      minConsecutiveWins: null,
    },
    seedHandOff: null,
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
 * The THIRD plane: not an override global but the address. `view` is `resolveResultsViewMode`'s
 * closed set (src/results/resultsViewMode.ts); any other value would silently fall back to the
 * default view there and read as a clean "no effect", so it is refused here.
 */
const VIEW_ARM_KEYS = { view: null }
const VIEW_ARM_ENUMS = { view: ['tour', 'summary', 'classic'] }

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
  'scalePass.',
  'outlinePass.',
  'perf.',
  // Android only (--android). Last, so a desktop report's row order is unchanged.
  'device.',
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
 * Parses one `<label>=<json>` arm on any of the three planes. `flag`, `schema` and `enums` are what
 * differ; everything else — the label split, the JSON parse, the object check, the recursive key
 * check — is shared, so the planes cannot drift into validating to different standards.
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
const parseViewArm = (value) => parseArmOnPlane('--view-arm', VIEW_ARM_KEYS, VIEW_ARM_ENUMS, value)

function parseArgs(argv) {
  const options = {
    arms: [],
    backendArms: [],
    viewArms: [],
    clips: PUBLIC_CLIP_NAMES,
    trials: 3,
    timeoutMs: 300_000,
    port: null,
    reuseServer: false,
    reuseBrowser: false,
    evidence: false,
    scalePass: false,
    outlinePass: false,
    perf: false,
    jsonPath: null,
    android: null,
    coolBelowC: 36,
    decoderHint: null,
  }
  let timeoutGiven = false

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
      case '--view-arm':
        options.viewArms.push(parseViewArm(requireValue(flag, value)))
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
        timeoutGiven = true
        i += 1
        break
      case '--android':
        // The serial is optional: a following value that is not itself a flag is the serial.
        if (value !== undefined && !value.startsWith('--')) {
          options.android = { serial: value }
          i += 1
        } else {
          options.android = { serial: process.env.ANDROID_SERIAL || null }
        }
        if (!options.android.serial) {
          throw new Error('--android needs a device serial, or ANDROID_SERIAL set in the environment')
        }
        break
      case '--decoder-hint':
        options.decoderHint = requireValue(flag, value)
        if (!['prefer-software', 'prefer-hardware', 'no-preference'].includes(options.decoderHint)) {
          throw new Error(
            `--decoder-hint needs prefer-software | prefer-hardware | no-preference, got: ${value}`,
          )
        }
        i += 1
        break
      case '--cool-below':
        options.coolBelowC = Number(requireValue(flag, value))
        if (!Number.isFinite(options.coolBelowC) || options.coolBelowC <= 0) {
          throw new Error(`--cool-below needs a temperature in °C, got: ${value}`)
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
      case '--scale-pass':
        options.scalePass = true
        break
      case '--outline-pass':
        options.outlinePass = true
        break
      case '--perf':
        options.perf = true
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
    ['--view-arm', options.viewArms],
  ]) {
    const labels = new Set(parsed.map((arm) => arm.label))
    if (labels.size !== parsed.length) {
      throw new Error(`${flag} labels must be unique`)
    }
  }
  if (options.arms.length === 0 && options.backendArms.length === 0 && options.viewArms.length === 0) {
    throw new Error(
      'at least one --arm, --backend-arm or --view-arm <label>=<json> is required (use `{}` for a baseline arm)',
    )
  }

  // Arms are joined by LABEL across the three planes (sampling, backend, view), so one arm can carry
  // any combination of them, and an arm not named on a plane gets `{}` there. Order is first
  // appearance, sampling plane first, then backend, then view, so a report's column order is a
  // property of the command line rather than of which plane happened to be parsed first.
  const byLabel = new Map()
  for (const [plane, parsed] of [
    ['override', options.arms],
    ['backendOverride', options.backendArms],
    ['viewOverride', options.viewArms],
  ]) {
    for (const arm of parsed) {
      const existing = byLabel.get(arm.label)
      if (existing) existing[plane] = arm.override
      else
        byLabel.set(arm.label, {
          label: arm.label,
          override: {},
          backendOverride: {},
          viewOverride: {},
          [plane]: arm.override,
        })
    }
  }
  options.arms = [...byLabel.values()]
  // Kept only so the report can tell "this arm set no backend override" from "this run used no
  // backend plane at all" — the latter suppresses the header lines entirely.
  options.usesBackendPlane = options.backendArms.length > 0
  options.usesViewPlane = options.viewArms.length > 0
  if (options.android) {
    if (options.reuseBrowser) throw new Error('--reuse-browser is not supported with --android')
    // A phone takes ~10-20x as long as an M-series desktop; the desktop default would cut off a
    // trial that is merely slow.
    if (!timeoutGiven) options.timeoutMs = 900_000
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

// ---------------------------------------------------------------------------------------------
// --android: an adb-attached phone's Chrome, driven over CDP. Nothing below runs without the flag.
// ---------------------------------------------------------------------------------------------

const ANDROID_CHROME_PACKAGE = 'com.android.chrome'
const ANDROID_CHROME_ACTIVITY = `${ANDROID_CHROME_PACKAGE}/com.google.android.apps.chrome.Main`
const ANDROID_CDP_PORT = 9222
/** How long a cooling wait may last before the trial runs anyway (and says so in its rows). */
const ANDROID_COOL_MAX_WAIT_MS = 15 * 60_000
/** Phone-scale versions of the settle constants above: every background pass is ~10-20x slower. */
const ANDROID_EVIDENCE_SETTLE_MS = 15_000
const ANDROID_EVIDENCE_MAX_WAIT_MS = 600_000
const ANDROID_DIAGNOSTICS_WAIT_MS = 60_000

function adb(serial, args, { timeout = 60_000 } = {}) {
  // stderr piped, not inherited: an expected failure (removing a forward that does not exist)
  // would otherwise print into the progress log. It still reaches the thrown error.
  return execFileSync('adb', ['-s', serial, ...args], {
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** Battery temperature, thermal status and the HAL's skin/AP readings — one snapshot. */
function readThermal(serial) {
  const battery = adb(serial, ['shell', 'dumpsys', 'battery'])
  const tenths = Number(/temperature:\s*(-?\d+)/.exec(battery)?.[1])
  const thermal = adb(serial, ['shell', 'dumpsys', 'thermalservice'])
  const status = Number(/Thermal Status:\s*(\d+)/.exec(thermal)?.[1])
  // The "Current temperatures from HAL" block; the cached block above it can be stale.
  const hal = thermal.split('Current temperatures from HAL:')[1] ?? thermal
  const halTemp = (name) => {
    const match = new RegExp(`mValue=(-?[\\d.]+), mType=\\d+, mName=${name},`).exec(hal)
    return match ? Number(match[1]) : null
  }
  return {
    batteryC: Number.isFinite(tenths) ? tenths / 10 : null,
    thermalStatus: Number.isFinite(status) ? status : null,
    skinC: halTemp('SKIN'),
    apC: halTemp('AP'),
  }
}

/**
 * Waits, with Chrome stopped so the phone is idle, until the battery reads below `belowC` and the
 * thermal service reports no throttling. A throttled SoC slows every timing row and none of them
 * look it. Gives up after ANDROID_COOL_MAX_WAIT_MS and runs anyway — the waited time and the
 * temperature at start are rows, so a hot trial is visible rather than silent.
 */
async function waitForCool(serial, belowC) {
  const startedAt = Date.now()
  let reading = readThermal(serial)
  const cool = () =>
    (reading.batteryC === null || reading.batteryC < belowC) && !(reading.thermalStatus > 0)
  if (!cool()) {
    adb(serial, ['shell', 'am', 'force-stop', ANDROID_CHROME_PACKAGE])
    process.stderr.write(
      `(cooling: battery ${reading.batteryC} °C, thermal status ${reading.thermalStatus}) `,
    )
  }
  while (!cool() && Date.now() - startedAt < ANDROID_COOL_MAX_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 20_000))
    reading = readThermal(serial)
  }
  return { ...reading, waitedMs: Date.now() - startedAt, cooled: cool() }
}

async function cdpIsUp() {
  try {
    const response = await fetch(`http://localhost:${ANDROID_CDP_PORT}/json/version`)
    return response.ok
  } catch {
    return false
  }
}

/**
 * The phone's "fresh process": force-stop Chrome, relaunch it on about:blank, re-forward the
 * DevTools socket (the abstract socket is recreated by the new process) and reconnect. Tabs a
 * previous harness run left on a localhost /strides/ address are closed — Chrome restores tabs
 * across a force-stop, and a stale copy of this app would otherwise share the process.
 */
async function launchAndroidChrome(serial) {
  adb(serial, ['shell', 'am', 'force-stop', ANDROID_CHROME_PACKAGE])
  try {
    adb(serial, ['forward', '--remove', `tcp:${ANDROID_CDP_PORT}`])
  } catch {
    // No forward yet.
  }
  adb(serial, ['shell', 'am', 'start', '-n', ANDROID_CHROME_ACTIVITY, '-d', 'about:blank'])
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      adb(serial, ['forward', `tcp:${ANDROID_CDP_PORT}`, 'localabstract:chrome_devtools_remote'])
    } catch {
      // The socket may not exist yet; retried below.
    }
    if (await cdpIsUp()) break
    if (Date.now() > deadline) throw new Error('phone Chrome DevTools socket never came up')
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const browser = await chromium.connectOverCDP(`http://localhost:${ANDROID_CDP_PORT}`, {
    timeout: 60_000,
  })
  const context = browser.contexts()[0]
  for (const stale of context.pages()) {
    if (/^https?:\/\/localhost:\d+\/strides\//.test(stale.url())) {
      await stale.close().catch(() => {})
    }
  }
  return { browser, context }
}

/** One-time device setup: reverse the dev-server port, keep the screen on, read the stamp. */
function prepareAndroid(serial, baseURL) {
  const port = new URL(baseURL).port
  adb(serial, ['reverse', `tcp:${port}`, `tcp:${port}`])
  const stayOnBefore = adb(serial, ['shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in'])
  // A screen that times out hides the tab, which pauses rAF and video and stalls the analysis.
  adb(serial, ['shell', 'svc', 'power', 'stayon', 'true'])
  const chromeVersion =
    /versionName=(\S+)/.exec(adb(serial, ['shell', 'dumpsys', 'package', ANDROID_CHROME_PACKAGE]))?.[1] ??
    'unknown'
  return {
    serial,
    port,
    model: adb(serial, ['shell', 'getprop', 'ro.product.model']),
    androidVersion: adb(serial, ['shell', 'getprop', 'ro.build.version.release']),
    chromeVersion,
    restore() {
      try {
        adb(serial, ['shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', stayOnBefore || '0'])
        adb(serial, ['reverse', '--remove', `tcp:${port}`])
        adb(serial, ['forward', '--remove', `tcp:${ANDROID_CDP_PORT}`])
      } catch {
        // Best effort; the device may have dropped.
      }
    },
  }
}

/** The phone's warmup: same job as `warmUpAndReadRenderer` (vite transforms, renderer string). */
async function androidWarmUpAndReadRenderer(device, baseURL) {
  const { browser, context } = await launchAndroidChrome(device.serial)
  try {
    const page = await context.newPage()
    await page.goto(baseURL, { timeout: 180_000 })
    await page.waitForLoadState('networkidle', { timeout: 180_000 }).catch(() => {})
    const renderer = await page.evaluate(readRendererInPage)
    await page.close()
    return renderer
  } finally {
    await browser.close().catch(() => {})
  }
}

/**
 * Installed on the phone's trial page only. Records when the file input fires `change` (the
 * analysis start, on the page clock — unlike the driver's clock it excludes the CDP upload) and
 * every main-thread long task, which is the UI-freeze measure (strides-6i6).
 */
function installDeviceProbes() {
  window.__stridesDevice = { changeAt: null, longTasks: [] }
  document.addEventListener(
    'change',
    (event) => {
      if (event.target?.type === 'file' && window.__stridesDevice.changeAt === null) {
        window.__stridesDevice.changeAt = performance.now()
      }
    },
    true,
  )
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__stridesDevice.longTasks.push([entry.startTime, entry.duration])
      }
    }).observe({ type: 'longtask', buffered: true })
  } catch {
    // No longtask support: the rows read null rather than zero.
    window.__stridesDevice.longTasks = null
  }
}

/** Runs in the page: elapsed since `change`, visibility, and long tasks since `change`. */
function readDeviceProbes() {
  const probe = window.__stridesDevice
  if (!probe || probe.changeAt === null) return null
  const now = performance.now()
  const since = probe.longTasks?.filter(([start]) => start >= probe.changeAt) ?? null
  return {
    sinceChangeMs: Math.round(now - probe.changeAt),
    changeAt: probe.changeAt,
    hidden: document.hidden,
    longTaskCount: since ? since.length : null,
    longTaskTotalMs: since ? Math.round(since.reduce((sum, [, d]) => sum + d, 0)) : null,
    longTaskMaxMs: since ? Math.round(Math.max(0, ...since.map(([, d]) => d))) : null,
  }
}

/**
 * One analysis run: fresh context (so the override is installed before any page script runs),
 * drive the clip, capture the PRIMARY diagnostics line, return the fields we compare on.
 *
 * **`browser` is a fresh process per trial unless `--reuse-browser` says otherwise**, and that is
 * a measurement decision rather than hygiene (`strides-9wp`). Reusing one Chromium across trials
 * shifts Demo 2's sampling from trial 2 onward: the `armSwingCycle` exemplar moves from
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
  {
    baseURL,
    clip,
    clipName,
    override,
    backendOverride,
    viewOverride,
    timeoutMs,
    evidence,
    scalePass,
    outlinePass,
    perf,
    decoderHint = null,
    device = null,
  },
) {
  // --android: the phone's default context (Android Chrome cannot create browser contexts), one
  // new tab, init scripts on the PAGE so they cannot accumulate on the shared context. `browser`
  // is then `{ context }` from launchAndroidChrome.
  const context = device ? browser.context : await browser.newContext()
  const androidPage = device ? await context.newPage() : null
  try {
    // Both override planes go in via `addInitScript`, never `evaluate` (the view plane is the
    // address `goto` opens, below): auto-analyze can start before an
    // `evaluate()` after `goto()` lands, and the backend override is read once per detector
    // creation — earlier still than the sampling one.
    const scriptTarget = androidPage ?? context
    await scriptTarget.addInitScript((value) => {
      window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = value
    }, override)
    await scriptTarget.addInitScript((value) => {
      window.__STRIDES_POSE_BACKEND_OVERRIDE__ = value
    }, backendOverride)
    // --decoder-hint: every VideoDecoder the page configures (primary, scale pass, evidence,
    // posters) gets this hint. See the flag's doc block for why it is a perturbation arm.
    if (decoderHint) {
      await scriptTarget.addInitScript((hint) => {
        const configure = VideoDecoder.prototype.configure
        VideoDecoder.prototype.configure = function (config) {
          return configure.call(this, { ...config, hardwareAcceleration: hint })
        }
      }, decoderHint)
    }

    if (androidPage) {
      await androidPage.addInitScript(installDeviceProbes)
      androidPage.setDefaultTimeout(180_000)
      // A fresh desktop context has empty storage; the phone's default context does not. The
      // results landing view, for one, is remembered in localStorage. Cache Storage (model files)
      // and the HTTP cache are left warm — see the --android doc.
      const cdp = await context.newCDPSession(androidPage)
      await cdp.send('Storage.clearDataForOrigin', {
        origin: new URL(baseURL).origin,
        storageTypes: 'local_storage,session_storage,indexeddb,service_workers,file_systems',
      })
      await cdp.detach()
    }
    const page = androidPage ?? (await context.newPage())
    // A renderer that dies mid-trial goes silent rather than failing: every later console line
    // is simply absent, which reads exactly like a pass that hung (strides-p1qt.4).
    let pageCrashed = false
    page.on('crash', () => {
      pageCrashed = true
    })

    let resolveDiagnostics
    let rejectDiagnostics
    const diagnosticsPromise = new Promise((resolve, reject) => {
      resolveDiagnostics = resolve
      rejectDiagnostics = reject
    })
    // Keeps a rejection that lands before the await below from surfacing as unhandled.
    diagnosticsPromise.catch(() => {})

    const evidenceLines = []
    const perfLines = []
    const scalePassLines = []
    let lastEvidenceAt = 0
    let scalePassSeen = false
    const outlinePassLines = []

    // The last few console lines, kept only to explain a trial that never completes.
    const recentConsole = []

    // --android: a phone renderer killed for memory is reloaded by Chrome, and a dev-server full
    // reload replaces the document too; either reads as a stall until the full timeout. Detected
    // by the page's own probe: every document gets a fresh `__stridesDevice` with no `change`
    // recorded, so once the upload has landed, a probe without one means the document the
    // analysis ran in is gone. (Counting navigation events races the new tab's own about:blank
    // load, and the app's History API rewrites fire `framenavigated` — both tried, both wrong.)
    const pageLoss = { crashed: false, replaced: false }
    if (androidPage) {
      page.on('crash', () => {
        pageLoss.crashed = true
      })
    }
    let lossCheckedAt = 0
    const pageLost = async () => {
      if (!androidPage) return false
      if (pageLoss.crashed || pageLoss.replaced) return true
      if (Date.now() - lossCheckedAt < 5_000) return false
      lossCheckedAt = Date.now()
      // Bounded: an evaluate against a wedged renderer never settles, and an unbounded one here
      // stalls this loop past its own deadline (hit on the S21: a trial hung 41 min, strides-p1qt.22).
      // No answer is not evidence of a replaced document; the deadline below handles a wedge.
      pageLoss.replaced = await evaluateWithin(
        page,
        () => !window.__stridesDevice || window.__stridesDevice.changeAt === null,
        PAGE_LIVENESS_TIMEOUT_MS,
        false,
      )
      return pageLoss.replaced
    }

    page.on('console', (message) => {
      const text = message.text()
      recentConsole.push(`${message.type()}: ${text.slice(0, 160)}`)
      if (recentConsole.length > 8) recentConsole.shift()
      if (text.startsWith(SCALE_PASS_PREFIX)) {
        scalePassSeen = true
        try {
          scalePassLines.push(JSON.parse(text.slice(SCALE_PASS_PREFIX.length).trim()))
        } catch {
          // A malformed scale-pass line costs the scalePass rows, not the trial.
        }
        return
      }
      if (text.startsWith(OUTLINE_PASS_PREFIX)) {
        try {
          outlinePassLines.push(JSON.parse(text.slice(OUTLINE_PASS_PREFIX.length).trim()))
        } catch {
          // A malformed outline-pass line costs the outlinePass rows, not the trial.
        }
        return
      }
      if (text.startsWith(PERF_PREFIX)) {
        try {
          perfLines.push(JSON.parse(text.slice(PERF_PREFIX.length).trim()))
        } catch {
          // A malformed perf line costs its rows, not the trial.
        }
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

    await page.goto(viewURL(baseURL, viewOverride))

    let startedAt = Date.now()
    // Every clip routes through Upload now — see CLIPS. The demo-button branch, and the
    // "couldn't load the demo video" race that guarded it, are both gone: nothing this harness
    // drives fetches over the network any more, so a download simply cannot be what fails.
    await page.getByRole('button', { name: 'Upload' }).click()
    let uploadMs
    if (device) {
      // A path would make the phone's Chrome look for a file on the PHONE; bytes go over CDP
      // instead, and the clock restarts once they have landed (see the --android doc).
      const uploadStartedAt = Date.now()
      await page.locator('input[type=file]').setInputFiles({
        name: path.basename(clip.file),
        mimeType: 'video/mp4',
        buffer: readFileSync(clip.file),
      })
      startedAt = Date.now()
      uploadMs = startedAt - uploadStartedAt
    } else {
      await page.locator('input[type=file]').setInputFiles(clip.file)
    }

    try {
      if (androidPage) {
        const deadline = Date.now() + timeoutMs
        for (;;) {
          if (await pageLost()) throw new Error(`page lost (${JSON.stringify(pageLoss)})`)
          const done = await page
            .getByText(/analysis complete/i)
            .waitFor({ timeout: Math.min(5_000, Math.max(1, deadline - Date.now())) })
            .then(() => true, (waitError) => {
              if (Date.now() >= deadline) throw waitError
              return false
            })
          if (done) break
        }
      } else {
        await page.getByText(/analysis complete/i).waitFor({ timeout: timeoutMs })
      }
    } catch (error) {
      // A bare Playwright timeout names a selector, not a clip. On a four-clip matrix that leaves
      // the reader to work out which trial died from the progress log's ordering.
      // The page's state at the deadline goes in the message (it reaches the report's `# FAILED`
      // row), since a stalled trial does not reproduce on demand (strides-trn2.6).
      const snapshot = await evaluateWithin(page, () => ({
          status: [...document.querySelectorAll('[role=status]')]
            .map((element) => element.textContent?.trim().slice(0, 120))
            .filter(Boolean),
          videos: [...document.querySelectorAll('video')].map((video) => ({
            t: Number(video.currentTime.toFixed(3)),
            paused: video.paused,
            ended: video.ended,
            readyState: video.readyState,
          })),
          hidden: document.hidden,
        }), PAGE_LIVENESS_TIMEOUT_MS, { snapshotError: 'page did not answer (renderer wedged?)' })
      throw new Error(
        `${clipName}: never reached "Analysis complete" — page ${JSON.stringify(snapshot)}; ` +
          `last console ${JSON.stringify(recentConsole)}` +
          // On a phone the cause is often not the timeout (a lost page), so it is named.
          (device ? `; cause: ${error.message.split('\n')[0].slice(0, 200)}` : ''),
        { cause: error },
      )
    }
    const elapsedMs = Date.now() - startedAt
    const atComplete = device ? await evaluateWithin(page, readDeviceProbes, PAGE_LIVENESS_TIMEOUT_MS, null) : null

    const diagnostics = await Promise.race([
      diagnosticsPromise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('no [analysis-diagnostics] line')),
          device ? ANDROID_DIAGNOSTICS_WAIT_MS : 15_000,
        ),
      ),
    ])
    const settleMs = device ? ANDROID_EVIDENCE_SETTLE_MS : EVIDENCE_SETTLE_MS
    const maxWaitMs = device ? ANDROID_EVIDENCE_MAX_WAIT_MS : EVIDENCE_MAX_WAIT_MS

    // Wait for the evidence stream to go quiet rather than for a line count: see
    // EVIDENCE_SETTLE_MS. Quiescence is gated on the scale pass having reported, so a fast machine
    // cannot settle in the gap before the graft's re-extraction starts.
    // `--scale-pass` alone waits only for its own line; with --evidence or --perf the stricter
    // evidence quiescence below already implies it.
    // Set only when the settle wait below gives up, so a settled trial's rows are unchanged.
    let pageAtSettleTimeout
    if (evidence || perf || scalePass || outlinePass) {
      const deadline = Date.now() + maxWaitMs
      let settled = false
      // The outline pass runs after the scale pass and grafts (and re-extracts) after it.
      const outlineSeen = () => !outlinePass || outlinePassLines.length > 0
      while (!settled && Date.now() < deadline && !(await pageLost())) {
        settled =
          evidence || perf
            ? evidenceLines.length > 0 &&
              scalePassSeen &&
              outlineSeen() &&
              Date.now() - lastEvidenceAt > settleMs
            : (!scalePass || scalePassSeen) && outlineSeen()
        if (!settled) await new Promise((resolve) => setTimeout(resolve, 250))
      }
      // The cap yields whatever arrived rather than failing the trial, so say so — an
      // un-settled capture may be the pre-graft line, which reports a grafted metric as
      // `metric-excluded`, and that must not be mistaken for a coverage regression.
      if (!settled) {
        pageAtSettleTimeout = await probePageLiveness(page, () => pageCrashed)
        process.stderr.write(
          `\n  WARNING: [evidence-coverage] did not settle in ${maxWaitMs}ms ` +
            `(${evidenceLines.length} line(s), scale pass ${scalePassSeen ? 'reported' : 'SILENT'}` +
            `${outlinePass ? `, outline pass ${outlinePassLines.length > 0 ? 'reported' : 'SILENT'}` : ''}; ` +
            `page ${pageAtSettleTimeout}` +
            `${(await pageLost()) ? `, PAGE LOST ${JSON.stringify(pageLoss)}` : ''}; ` +
            `last console ${JSON.stringify(recentConsole)}) `,
        )
      }
    }

    // `undefined` means "not asked for"; `null` means "asked for and none arrived" — distinct
    // states that must not both render as an absent row.
    const fields = extractFields(
      diagnostics,
      elapsedMs,
      evidence ? (evidenceLines.at(-1) ?? null) : undefined,
    )
    if (scalePass) {
      // The whole line, flattened like the primary one: `diagnostics` carries the scale pass's own
      // sampling, selection and metrics, which is where VO_cm and stepWidthCm are measured, so a
      // view that perturbed the background pass would show here even if the graft hid it.
      // Arrays stay stringified (flatten's default) — one cell per array still compares exactly.
      Object.assign(fields, {
        'scalePass.lines': scalePassLines.length,
        ...(scalePassLines.length > 0 ? flatten('scalePass.', scalePassLines.at(-1)) : {}),
      })
    }
    if (outlinePass) {
      Object.assign(fields, {
        'outlinePass.lines': outlinePassLines.length,
        ...(outlinePassLines.length > 0 ? flatten('outlinePass.', outlinePassLines.at(-1)) : {}),
      })
    }
    if (pageAtSettleTimeout !== undefined) fields['harness.pageAtSettleTimeout'] = pageAtSettleTimeout
    if (device) {
      const atSettled = await evaluateWithin(page, readDeviceProbes, PAGE_LIVENESS_TIMEOUT_MS, null)
      // Page-clock milestones relative to the input's `change`, from the perf lines' `atMs`.
      const changeAt = atComplete?.changeAt ?? atSettled?.changeAt ?? null
      const perfAt = (match) => {
        const line = perfLines.findLast(match)
        return line && changeAt !== null ? Math.round(line.atMs - changeAt) : null
      }
      Object.assign(fields, {
        'device.uploadMs': uploadMs,
        'device.pageCrashed': pageLoss.crashed,
        'device.pageReplaced': pageLoss.replaced,
        'device.pageHiddenAtComplete': atComplete?.hidden ?? null,
        'device.completeSinceChangeMs': atComplete?.sinceChangeMs ?? null,
        'device.primaryReadySinceChangeMs': perfAt(
          (line) => line.stage === 'analysis-pass' && line.pass === 'primary',
        ),
        'device.scalePassDoneSinceChangeMs': perfAt(
          (line) => line.stage === 'analysis-pass' && line.pass === 'scale',
        ),
        'device.outlinePassDoneSinceChangeMs': perfAt(
          (line) => line.stage === 'analysis-pass' && line.pass === 'outline',
        ),
        'device.lastEvidenceExtractionSinceChangeMs': perfAt(
          (line) => line.stage === 'evidence-extraction',
        ),
        // Driver clock: when the last [evidence-coverage] line arrived, from the upload landing.
        'device.evidenceSettledMs': lastEvidenceAt > 0 ? lastEvidenceAt - startedAt : null,
        'device.longTasks.toComplete.count': atComplete?.longTaskCount ?? null,
        'device.longTasks.toComplete.totalMs': atComplete?.longTaskTotalMs ?? null,
        'device.longTasks.toComplete.maxMs': atComplete?.longTaskMaxMs ?? null,
        'device.longTasks.toSettled.count': atSettled?.longTaskCount ?? null,
        'device.longTasks.toSettled.totalMs': atSettled?.longTaskTotalMs ?? null,
        'device.longTasks.toSettled.maxMs': atSettled?.longTaskMaxMs ?? null,
      })
    }
    return perf ? { ...fields, ...flattenPerfLines(perfLines) } : fields
  } finally {
    // Bounded on the phone: closing a wedged tab can hang too, and the next trial force-stops
    // Chrome anyway.
    if (androidPage) {
      await Promise.race([
        androidPage.close().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, PAGE_LIVENESS_TIMEOUT_MS)),
      ])
    } else await context.close()
  }
}

/** How long a page that is still running JS gets to answer the liveness probe. */
const PAGE_LIVENESS_TIMEOUT_MS = 5_000

/**
 * Why a trial's console went quiet, asked once its settle wait has given up: `crashed` (the
 * renderer died), `unresponsive` (alive but its main thread did not run a trivial evaluate within
 * PAGE_LIVENESS_TIMEOUT_MS), or `live` (the page answers, so the silence is the app's own).
 */
/**
 * `page.evaluate` with a deadline. Playwright gives `evaluate` no timeout of its own, so against a
 * renderer whose main thread never yields it neither resolves nor rejects. `fallback` is returned
 * on a timeout or a rejection.
 */
async function evaluateWithin(page, fn, ms, fallback) {
  let timer
  try {
    return await Promise.race([
      page.evaluate(fn).catch(() => fallback),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function probePageLiveness(page, crashed) {
  if (crashed()) return 'crashed'
  let timer
  const answer = await Promise.race([
    page.evaluate(() => performance.now()).then(
      () => 'live',
      () => (crashed() ? 'crashed' : 'unresponsive'),
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(crashed() ? 'crashed' : 'unresponsive'), PAGE_LIVENESS_TIMEOUT_MS)
    }),
  ])
  clearTimeout(timer)
  return answer
}

/** The address a trial opens: the bare baseURL, or with `?view=` when the arm names a view. */
function viewURL(baseURL, viewOverride = {}) {
  if (viewOverride.view === undefined) return baseURL
  const url = new URL(baseURL)
  url.searchParams.set('view', viewOverride.view)
  return url.toString()
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

/**
 * One row per field per `[perf-timings]` line, keyed `perf.<stage>[.<pass>][<n>].<field>` where
 * `<n>` counts that key's occurrences in the trial — the pre- and post-graft evidence extractions
 * are two lines of one stage and must stay two rows.
 */
function flattenPerfLines(lines) {
  const seen = new Map()
  const fields = {}
  for (const { stage, pass, ...rest } of lines) {
    const key = `perf.${stage}${pass ? `.${pass}` : ''}`
    const occurrence = seen.get(key) ?? 0
    seen.set(key, occurrence + 1)
    // `atMs` is emission time on the page clock, not a duration — skipped as a noise row.
    Object.assign(fields, flatten(`${key}[${occurrence}].`, rest, ['atMs']))
  }
  return fields
}

/** Group rank first, then name — with `.value` ahead of `.confidence` for the same metric. */
function fieldSortKey(field) {
  const group = FIELD_GROUPS.findIndex((prefix) => field.startsWith(prefix))
  const name = field.replace(/\.value$/, '.0').replace(/\.confidence$/, '.1')
  // Zero-padded: the keys compare as strings, and with ten or more groups an unpadded "10|" would
  // sort before "2|" (the ungrouped `elapsedMs` row jumped to the middle when `device.` was added).
  const rank = String(group === -1 ? FIELD_GROUPS.length : group).padStart(2, '0')
  return `${rank}|${name}`
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

function report({ renderer, baseURL, provenance, commit, options, results, device = null }) {
  const armLabels = options.arms.map((arm) => arm.label)
  const lines = [
    '# scripts/ab-person-selection.mjs',
    `# baseURL: ${baseURL} (${provenance})`,
    `# commit: ${commit}`,
    // On a phone the device IS the renderer's provenance; the temperature is the run's starting
    // point (each trial's own reading is a `device.*` row).
    device
      ? `# device: ${device.model} (Android ${device.androidVersion}), Chrome ${device.chromeVersion}, ` +
        `renderer ${renderer}, battery ${device.startThermal.batteryC} °C / skin ` +
        `${device.startThermal.skinC} °C / thermal status ${device.startThermal.thermalStatus} at start`
      : `# renderer: ${renderer}`,
    // Provenance, same as the baseURL and commit lines above it: the browser regime changes what
    // gets measured on Demo 2 (strides-9wp), so a diff of two reports has to surface it on a line
    // rather than leave it to be inferred from the numbers.
    device
      ? '# browser: fresh Chrome process per trial (am force-stop + relaunch, new tab, origin ' +
        'storage cleared; HTTP cache + Cache Storage warm); elapsedMs from upload landing, ' +
        `cooled below ${options.coolBelowC} °C between trials`
      : `# browser: ${options.reuseBrowser ? 'ONE process reused across trials (--reuse-browser)' : 'fresh process per trial'}`,
    `# trials: ${options.trials}`,
    // Only when set, so a report without the flag stays byte-identical to one taken before it.
    ...(options.decoderHint ? [`# decoder hint: hardwareAcceleration=${options.decoderHint}`] : []),
    ...options.arms.map((arm) => `# arm ${arm.label}: ${JSON.stringify(arm.override)}`),
    // Emitted only when this run used the backend plane at all, so a report produced without
    // `--backend-arm` is byte-identical to one produced before that flag existed — `> before.txt`
    // / `> after.txt` diffs spanning this change stay clean on the sampling plane.
    ...(options.usesBackendPlane
      ? options.arms.map(
          (arm) => `# backend-arm ${arm.label}: ${JSON.stringify(arm.backendOverride)}`,
        )
      : []),
    // Same rule as the backend plane: absent unless this run used the view plane.
    ...(options.usesViewPlane
      ? options.arms.map((arm) => `# view-arm ${arm.label}: ${JSON.stringify(arm.viewOverride)}`)
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
  let device = null
  try {
    if (options.android) {
      device = prepareAndroid(options.android.serial, baseURL)
      device.startThermal = readThermal(device.serial)
      process.stderr.write(
        `device: ${device.model} Android ${device.androidVersion} Chrome ${device.chromeVersion}, ` +
          `battery ${device.startThermal.batteryC} °C, thermal status ${device.startThermal.thermalStatus}\n`,
      )
    }
    const renderer = device
      ? await androidWarmUpAndReadRenderer(device, baseURL)
      : await warmUpAndReadRenderer(launchArgs, baseURL)
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
          let before = null
          let browser
          if (device) {
            try {
              before = await waitForCool(device.serial, options.coolBelowC)
              // `{ browser, context }`, which runTrial takes in place of a Browser.
              browser = await launchAndroidChrome(device.serial)
            } catch (error) {
              record.error = `launch: ${error.message}`
              process.stderr.write(`FAILED: ${record.error}\n`)
              results.get(`${clipName}|${arm.label}`).push(record)
              continue
            }
          } else {
            browser = sharedBrowser ?? (await chromium.launch({ args: launchArgs }))
          }
          try {
            record.fields = await runTrial(browser, {
              device,
              baseURL,
              clip: CLIPS[clipName],
              clipName,
              override: arm.override,
              backendOverride: arm.backendOverride,
              viewOverride: arm.viewOverride,
              timeoutMs: options.timeoutMs,
              evidence: options.evidence,
              scalePass: options.scalePass,
              outlinePass: options.outlinePass,
              perf: options.perf,
              decoderHint: options.decoderHint,
            })
            if (device) {
              const after = readThermal(device.serial)
              Object.assign(record.fields, {
                'device.batteryBeforeC': before.batteryC,
                'device.skinBeforeC': before.skinC,
                'device.apBeforeC': before.apC,
                'device.thermalStatusBefore': before.thermalStatus,
                'device.coolWaitMs': before.waitedMs,
                'device.cooledBeforeTrial': before.cooled,
                'device.batteryAfterC': after.batteryC,
                'device.skinAfterC': after.skinC,
                'device.apAfterC': after.apC,
                'device.thermalStatusAfter': after.thermalStatus,
              })
            }
            process.stderr.write(
              `detected ${record.fields['sampling.detectedFrames']}/${record.fields['sampling.totalSamples']} in ${record.fields.elapsedMs}ms\n`,
            )
          } catch (error) {
            record.error = error.message
            process.stderr.write(`FAILED: ${error.message}\n`)
          } finally {
            if (device) await browser.browser.close().catch(() => {})
            else if (!sharedBrowser) await browser.close()
          }
          results.get(`${clipName}|${arm.label}`).push(record)
        }
      }
    }

    const commit = headCommit()
    process.stdout.write(
      `${report({ renderer, baseURL, provenance, commit, options, results, device })}\n`,
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
            // Present only on an --android run, so a desktop JSON keeps its shape.
            ...(device
              ? {
                  device: {
                    serial: device.serial,
                    model: device.model,
                    androidVersion: device.androidVersion,
                    chromeVersion: device.chromeVersion,
                    startThermal: device.startThermal,
                    coolBelowC: options.coolBelowC,
                  },
                }
              : {}),
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
    device?.restore()
    stopServer()
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  process.exitCode = 1
})
