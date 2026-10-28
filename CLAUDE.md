# Strides — notes for Claude sessions working in this repo

Browser-only React/TypeScript app: webcam/upload/demo video → MoveNet pose detection (TF.js,
WebGL) → running-form heuristics → results UI. No backend.

This file is auto-loaded, so it holds only the rules every session needs. The full measurement
record lives in **`docs/agent-notes/`** (moved there verbatim; see "Notes index" below). **Read
the relevant note before changing or measuring anything in its area** — most of them record
numbers that look wrong but aren't, and directions already measured and closed.

## Spec-driven changes: openspec

This repo uses [openspec](openspec/) for anything beyond a trivial fix. Convention established
across this project's history:

```
openspec new change "<kebab-case-name>"
# write proposal.md, specs/<capability>/spec.md (delta), design.md, tasks.md
openspec validate <name> --strict
# implement against tasks.md, checking items off as you go
openspec archive <name> --yes   # folds the delta into openspec/specs/, do this once shipped
```

- `openspec/specs/` is the current, authoritative behavior contract per capability.
- `openspec/changes/` holds in-flight change proposals; `openspec/changes/archive/` holds
  completed ones. **Archive promptly after a change ships and is verified** — letting several
  changes pile up unarchived means `openspec/specs/` drifts out of sync with what's actually in
  the codebase (this happened once this session; six changes had to be archived in a batch to
  catch the main spec back up before a later change could reference what they'd added).
- If a change removes every requirement from a capability, delete that capability's spec file
  entirely rather than archiving to an empty stub — `openspec validate` rejects a spec with zero
  requirements, and an empty file doesn't mean anything anyway.
- MODIFIED/REMOVED requirement deltas must reuse the **exact existing requirement/scenario
  title text** — the archive step matches by name, not content, and silently drops anything it
  can't match. If a requirement's behavior fully reverses (not just changes), it's usually
  cleaner to REMOVE the old one (with Reason/Migration) and ADD a new one under a fresh name,
  rather than fighting the validator over a MODIFIED block that no longer resembles the
  original.
- **A MODIFIED block REPLACES the whole requirement body, so two in-flight changes that MODIFY
  the same requirement will clobber each other — last archive wins, silently.** Hit for real on
  2026-08-18: `navbar-clip-shell` and `inline-annotated-evidence` both carried a MODIFIED
  "Evidence frames are planned purely, then extracted from a detached video element", each
  authored independently against the same original, so **neither was a superset** and no archive
  order alone was correct. Before archiving a batch, diff the changes' delta headers against each
  other, not just against `openspec/specs/`. The fix is to archive the older-worded one first,
  then **reconcile the second change's MODIFIED block against the now-current spec** (carry the
  first one's edits forward into it) before archiving it — a MODIFIED delta is only meaningful
  stated against the spec it will actually be applied to. `openspec validate --strict` will not
  catch this: both blocks validate fine, and the loss is invisible in the archive output's
  `~ 1 modified` line.

## Live-browser verification — essentials

Full detail, tables and history: `docs/agent-notes/harness.md`.

Unit tests mock the detector, so **verify UI/pipeline changes live** before calling them done.

- **Chromium with real GPU**: `args: ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist']`.
  Never `--use-angle=swiftshader`. Renderer should read `ANGLE Metal Renderer`, not SwiftShader.
  If `chromium.launch()` can't find its binary, point `executablePath` at a cached
  `~/Library/Caches/ms-playwright/chromium-<rev>/…/Google Chrome for Testing`.
- **Dev-server port is derived from the checkout path, never 5173.** A foreign server answers every
  arm of an A/B and reads as a clean "no effect".
  ```bash
  node -e "import('./scripts/lib/harnessProvenance.mjs').then(m=>console.log(m.resolveDevServerPort()))"
  npm run dev -- --port <that port> --strictPort &   # app at http://localhost:<port>/strides/
  ```
  `assertServesThisCheckout` (nonce in `public/`) and the e2e SwiftShader check run
  unconditionally — **don't work around either guard**. `STRIDES_E2E_REUSE_SERVER=1` skips a
  startup, not a guard.
- **The one demo button ("Demo (3 clips)", `src/video/ClipPicker.tsx`) loads THREE clips** into one
  fused session. To drive ONE clip, upload it (Upload tab, `input[type=file]`, `setInputFiles`):

  | file (`src/video/demo-clips/`) | dims | frames | duration | view | A/B key |
  |---|---|---|---|---|---|
  | `park-side-landscape.mp4` | 3840×2160 | 233 | 3.88 s | side | `side-landscape` |
  | `park-side-portrait.mp4` | 1080×1920 | 345 | 12.17 s | side (~7× slow-mo, baked in) | `side-portrait` |
  | `park-approach.mp4` | 2160×3840 | 99 | 1.65 s | front | `front-approach` |
  | `e2e/fixtures/multiperson-track.mp4` | 1920×1080 | 233 | 3.88 s | side, bystanders | `multiperson` |

  ⚠️ **"Demo 1" anywhere in the notes is the retired Pexels track clip** — its numbers do not
  transfer to `park-side-landscape.mp4`. "Demo 2" is `park-approach.mp4` and its numbers stand.
- Analysis starts automatically. Wait for `/analysis complete/i` (`role="status"`, exactly one in
  every view). The runner tour is the default (`strides-trn2.2`), then the summary once a reader has
  pressed Skip (`localStorage` `strides.resultsLanding`); `?view=classic` for classic. The tour and
  summary currently wrap the guided view, so `.guided-results` hooks still work there.
- **Never conceal a clip's `<video>`** (offscreen/`inert`) — costs ~20% of sampled frames on the
  playback path. Visible at 60 CSS px is fine. Clip videos stay mounted while hidden.
- **Read results from dev-only console lines, not card text** (`import.meta.env.DEV`-gated; absent
  from `vite build`). `JSON.parse` the rest of each line:
  - `[analysis-diagnostics]` — match with `startsWith('[analysis-diagnostics]') &&
    !startsWith('[analysis-diagnostics:')`. Primary pass. `sampling.detectedFrames` is
    POST-person-selection; `personSelection.detectedSamplesIn` is pre-selection.
  - `[analysis-diagnostics:scale-pass]` — background MediaPipe scale pass, arrives ~one replay
    after "Analysis complete". Carries `subjectAgreement` (which person, NOT whether the passes
    agree on geometry or values).
  - `[evidence-coverage]` — **take the LAST line**; the scale-pass graft can emit a second one.
- **Config overrides** (dev-only; set with `page.addInitScript()`, never `page.evaluate()`):
  `window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__` (incl. `sequentialSampling`,
  `personSelection`), `window.__STRIDES_POSE_BACKEND_OVERRIDE__` (`backend`, `movenetModelType`,
  `trackingCrop`, `personOfInterest`), `window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__`
  (`{ enabled }`). No heuristics-config override exists yet.
- **Backends**: `movenet` (default) and `mediapipePoseLandmarker` work; `blazepose` (NaN keypoints)
  and `posenet` (`roi width cannot be 0`) are broken. The scale pass is always MediaPipe.
- **A/B driver — prefer it over hand-rolled scripts**: `scripts/ab-person-selection.mjs` (Node
  ≥ 22.18). `--arm 'label=<json>'` (repeatable, keys validated), `--clips <keys>`, `--trials N`,
  `--evidence` (adds `[evidence-coverage]` rows), `--backend-arm`, `--json <path>`. Fresh Chromium
  process per trial by default — keep it.
- **Determinism**: fresh-process trials are exactly reproducible (every field but `elapsedMs`).
  Ranges recorded in older notes were mostly a cold/warm browser-process mixture under the old
  reused-browser regime, not physical spread. Fresh = the COLD operating point, not what a warm
  user browser sees.
- ⚠️ **This shell's `diff`/pipelines can lie** (`strides-ef5`): use `rtk proxy diff a b`, run whole
  pipelines through `rtk proxy sh -c '…'`, and cross-check with `md5` in either direction.
- **Probe cycle for a candidate calc**: standalone `*.experimental.ts` → temporary dev-only
  `console.log('[my-probe]', …)` in `useVideoAnalysis.ts` → measure → **revert and delete**.
- Keyframes: `ffmpeg -i clip.mp4 -ss <t> -frames:v 1 -q:v 3 out.png` (add
  `drawgrid=width=40:height=40` for a ruler) and look at them with `Read`. Note
  `select='eq(n\,N)'` indexes coded pictures, not the edit-list timeline.

## Current facts that older notes contradict

- `MetricId` has **thirteen** members (the thirteenth is `swingFootLateralExcursion`); `armSwingSymmetry` was withdrawn → read as `armSwingAmplitude`.
- `COMMON_KEYPOINT_NAMES` is **19** (heel/foot_index added), not 12 or 15.
- The evidence gallery is gone; evidence is inline, annotated, in each card (`w-36`, ~142 px).
- `view.confidence` was rescaled (`strides-2iw`) — front-label confidences before 2026-08-29 aren't
  comparable to today's.
- Footstrikes are timed from the fitted hip-bounce phase (`strides-cjl`); ankle detector is fallback.
- The VO_cm anchor on today's default path is 4.4215 cm — on the retired Demo 1 footage.
- `armSwingAmplitude` is searched within ±20% of hip-bounce freq/2 (clip time; anchored even where
  cadence is withheld) and reports per-stride travel; side view reads the near arm (tolerated ×0.6).
  Arm-swing numbers before `strides-eiil` are fundamental p2p, not comparable.

## Do not re-litigate (measured and closed — reasons in the notes)

- **4K area floor** `minBoundingBoxAreaFraction: 2e-4` — no number separates phantoms from real
  frames; next attempt is motion/persistence in segmentation (`area-floor.md`).
- **`EVIDENCE_MAX_PAIR_CROP_GROWTH = 2.5`** — don't raise; **`MIN_EXEMPLAR_QUALITY`** — don't shave
  (`evidence.md`).
- **Evidence seek offset**: the edit-list term is correct; the midpoint term stays (`evidence.md`).
- **Tracking crop ships OFF**, **person-of-interest ships ON**, **retroactive person selection
  ships ON** — by recorded decisions (`backlog.md`, `harness.md`).
- **Guided-view bands**: a band is cited or it doesn't ship; three bands are deliberately not
  straight transcriptions (`guided-results-view.md`).
- **`MetricsPanel` one-column grid (`strides-49e`)** is an open product decision, not a typo
  (`app-shell.md`).
- **`slowMotionDetection.ts`** is deliberately unwired (iOS bakes retiming in); the sub-floor
  rhythm detector needs the AR(1) red-noise null (`slow-motion.md`).
- **Perf**: never trade pose-input fidelity for speed (see `bd memories perf`).

## Notes index — `docs/agent-notes/`

| file | read before… |
|---|---|
| `harness.md` | driving the app, writing a driver, any A/B; full determinism caveat, concealment table, backend comparison |
| `vertical-oscillation.md` | touching VO / VO_cm / vertical ratio / `spectralFit` / `hipBounce`; earMid vs hipMid |
| `area-floor.md` | touching `retroactivePersonSelection.ts` thresholds |
| `app-shell.md` | header clip strip, `ClipStripEntry`, add-a-clip, presentation/playback |
| `guided-results-view.md` | `src/guidance/`, guided cards, bands, scale palette, word budgets |
| `runner-tour.md` | `src/runner`, `src/results/tour`, `src/results/summary`, focus areas, view routing, the view A/B gate |
| `metric-layer-changes.md` | a reading that disagrees with a number quoted in the notes |
| `mediapipe-front-view.md` | `viewDetection.ts`, SER/BSR, `stepWidth`/`stepWidthCm`, scale-pass graft |
| `evidence.md` | `evidenceFrames.ts`, `extractFrames.ts`, annotations, crops, seek offset, coverage tables |
| `model-downloads.md` | `modelAssetCache.ts`, model-load header entry, prefetch |
| `backlog.md` | tracking crop, person-of-interest, deferred VO normalization work |
| `slow-motion.md` | `containerTiming.ts`, `slowMotionDetection.ts`, `bounceSpectrum.ts`, `redNoiseNull.ts` |
| `dynamic-valgus.md` | segmentation-based lower-leg proxies (no-go record) |

New long-form findings go in the matching note (or a new one added to this index), not here.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
