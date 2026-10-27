# Runner tour, results summary and the model runner

> Written 2026-10-27 (`strides-trn2.6`) when epics `strides-ps19` (model runner) and `strides-trn2`
> (tour and summary) were archived. Specs: `openspec/specs/model-runner`, `runner-tour`,
> `results-summary`, `runner-feedback` and the routing requirements in `guided-results-view`.
> Decisions and their history: `openspec/changes/archive/*-add-model-runner/design.md` (D1–D15)
> and `*-add-runner-tour/design.md` (D1–D6). PRD: `docs/prd/runner-led-results.md`.

## What and where

| path | what |
|---|---|
| `src/runner/` | The model runner. Pure core: `gaitModel.ts` (`poseAt(phase, params)`, the procedural cycle over the 19 joints, stance foot pinned to y = 0), `runnerParams.ts` (`bindRunnerParams(metrics)`, `realizeParams`, neutral constants), `camera.ts` (orthographic presets and tweens), `runnerScene.ts` / `runnerAnnotations.ts` (styles, draw order, text alternative, annotation geometry). React: `ModelRunner.tsx` (one SVG, one rAF loop, ≤ 30 fps), `useRunnerIntro.ts` + `introFlash.ts` (the adopt-your-gait intro). Dev sandbox: `src/runner/dev/sandbox.html`. **Owned by the Epic A follow-ups (`strides-ps19.5`–`.7`).** |
| `src/guidance/focusAreas.ts` | Six focus areas (rhythm, arms, posture, knees, landing, footPath), fixed metric membership in headline-preference order, `focusAreaView` (headline = first non-excluded metric). `TourStopId` adds `oneThing`. |
| `src/guidance/feedbackPoints.ts` | `WHY_LINES`, `NON_POINTS` (each cited, verbatim sentence in design D2), `feedbackFor` (area cue or non-point), `selectOneThing` (`cue` / `nothingToChange` / `unclear` with a reason), `ONE_THING_PRIORITY`, word-budget constants. No import from `src/results` or `src/runner`. |
| `src/results/focusAreaCamera.ts` | `FOCUS_AREA_CAMERA` (camera preset + playback rate per area; landing and foot path at 0.4×), `NO_FOCUS_CAMERA`, `runnerFocusFor` (one key phase per still beat, below). Shared by tour and summary. |
| `src/results/tour/` | `RunnerTour.tsx` (sticky bar with heading, progress dots and Skip; one rail with ONE `ModelRunner`; the stop column; phone CSS), `tourPlan.ts` (pure stop plan + capture hint), `TourStop.tsx`, `useActiveStop.ts` (42% reading line, `focusin`), `useMostlyVisible.ts` (90% gate for the intro). |
| `src/results/summary/` | `ResultsSummary.tsx` (runner beside one `<details>` row per measured area, a final Not measured row, Replay tour / Classic table footer), `FocusAreaRow.tsx` (opens to full card depth with inline evidence), `summaryRows.ts` (pure; also returns all six `views` for `selectOneThing`), `useWideLayout.ts`. |
| `src/results/resultsViewMode.ts`, `resultsLanding.ts` | View routing and the remembered landing (below). Wiring: `MultiClipVideoSession.tsx`. |

Both the tour and the summary render inside `GuidedResultsView`'s children slot, so the
`Analysis complete.` status line and Start over exist once, and the `.guided-results` class hooks
still apply. The tour mounts no metric card and therefore no evidence canvas; the summary is the
first view to mount them (when a row opens).

## The model runner's honesty rules

From the PRD, enforced by `model-runner` spec requirements and tests:

1. **Every degree of freedom is bound to exactly one measured value or held at a documented neutral
   constant.** Binding is the metric's own unit times a scale (1 everywhere except the
   `verticalOscillationCm` fallback, ÷ 50 cm model torso), clamped to a drawable range. The tested
   rule is "measuring the model returns the bound value": `gaitModel.test.ts` runs each metric's
   own formula over `poseAt` output. A clamped or yielded value carries `clamped: true` and the true
   `metricValue`, so labels show the real number ("shown approximately").
2. **Neutral parts are dashed grey; measured parts solid.** At a stop the focus area's measured part
   is accented and annotated with its own metric's value (`formatGuidedValue`).
3. **Neutral constants are never targets** and no ghost "ideal" runner is drawn. A test requires
   every neutral to sit > 1% from any band midpoint, envelope midpoint or published central value.
   The limb-shaped guides of the first renderer read as a target pose and were removed
   (`strides-v2d` context); guides are short reference rays and ticks only.
4. **One fixed setting per measurement:** no left/right asymmetry, no stride-to-stride variability.
5. **The footage is one tap away**: the summary row's inline evidence frame.
6. Caption "Model built from your numbers", never "your body". The intro's legend reads "Dashed:
   not applied yet" while it runs, "Dashed: not measured" after.

The core is pure TypeScript, reads `src/heuristics/**` for types only and never changes a
measurement (the A/B gate below is the proof at the pipeline level).

## View routing

- **Three views: tour (default), summary, classic.** `resolveResultsViewMode(search, landing)`:
  exactly one `view` param equal to `tour`, `summary` or `classic` wins; legacy `guide` means tour;
  anything else (absent, unknown, `CLASSIC`, repeated) falls back to the remembered landing, else
  the tour.
- **Remembered landing:** Skip to summary (and the tour's end "see all" link) writes
  `localStorage['strides.resultsLanding'] = 'summary'`; later results open on the summary. Storage
  failures are swallowed (the reader just sees the tour again). An explicit `?view=` beats it.
- **Only classic is written to the address.** Tour and summary remove `view`, so a shared link
  opens on whatever the recipient would normally see.
- **No router.** Every switch `history.pushState`s an entry stamped `{ stridesView: mode }`; the
  initial entry is stamped at mount. `popstate` reads the stamp, not the address (tour and summary
  share an address). An unstamped entry (an in-page `#` link) keeps the view on screen. Back from
  classic therefore returns to the summary with the in-memory analysis intact.
- Each view marks one `[data-view-entry]` element that takes focus after a switch: the "Your runner
  model" heading (tour), the "Summary" heading, Show summary (classic). Replay tour scrolls the view
  region to the top instantly (the intro reads the scroll position) and bumps the replay count.

## Fidelity gate (A/B driver)

The tour's runner animates while the background scale pass runs, so the views must not perturb
measurement. Driver: `scripts/ab-person-selection.mjs` with a view plane and the scale-pass line:

```bash
node scripts/ab-person-selection.mjs \
  --view-arm 'tour={}' --view-arm 'classic={"view":"classic"}' --view-arm 'summary={"view":"summary"}' \
  --clips side-landscape,side-portrait,front-approach --trials 3 --evidence --scale-pass
```

`--view-arm` values are validated (`tour | summary | classic`; an unknown value would silently
resolve to the default). `{}` is the bare address, i.e. the tour in a fresh context.
`--scale-pass` (`strides-trn2.6`) adds `scalePass.*` rows: the whole
`[analysis-diagnostics:scale-pass]` line flattened (status, subject agreement, the scale pass's own
sampling/selection/metrics, arrays stringified) plus `scalePass.lines`. Before it, VO_cm and
stepWidthCm were covered only through `[evidence-coverage]`, since the primary line predates the
graft and reads them `null`.

**Result, 2026-10-27 (`strides-trn2.6`, source as of `83f71d06`), M4 Pro, ANGLE Metal, fresh
process per trial, three arms (tour = bare address, classic, summary), 3 trials each.** Each
trial's fields minus `elapsedMs` were canonicalised (sorted `key\tJSON` lines) and hashed; the
hashes were cross-checked with `md5 -r` and `cmp` through `rtk proxy sh -c` (both directions agree):

| clip | ok trials (tour / classic / summary) | rows per trial | of which `scalePass.*` | `evidence.*` | distinct hashes | scale pass | VO_cm | stepWidthCm |
|---|---|---|---|---|---|---|---|---|
| side-landscape | 3 / 3 / 3 | 429 | 208 | 110 | **1** | done, 1 line | 7.19338 | −14.2397 |
| side-portrait | 3 / 2 / 3 | 415 | 194 | 110 | **1** | done, 1 line | null (no VO family on this clip, known) | −5.03986 |
| front-approach | 3 / 3 / 3 | 415 | 201 | 103 | **1** | done, 1 line | 10.4866 | 3.47771 |

Every field but `elapsedMs` is bit-identical across arms and trials, including the whole scale-pass
line: the tour's animating runner and the summary perturb neither pass. In the printed report the
only rows whose three arm cells differ are `elapsedMs` and side-portrait's `trials` count.
Reports: scratchpad `trn26-ab1.{txt,json}` (not committed).

**Timeouts.** One trial in 27 (side-portrait, CLASSIC arm, trial 3) never reached "Analysis
complete" in 300 s. The earlier one (`strides-trn2.3`) was side-landscape on the TOUR arm. Two
different arms and clips, both rare, on a machine at load ≈ 2: the stall is not a tour effect.
A side-portrait re-run (`trn26-ab2`, 3 arms × 3 trials, `--timeout 150000`) reproduced run 1's
hash exactly in 8 of 9 trials. The ninth, again CLASSIC, reached "Analysis complete" with a
primary pass identical to the rest, but the scale pass never reported and no `[evidence-coverage]`
line arrived in the 180 s settle cap (`scalePass.lines` 0, `evidence.captured` false). So the
rare stall has two shapes (primary never completes; background scale pass never reports), the
cause is not established, and it is filed as `strides-qg86`. Tally across `strides-trn2.3` and
`trn2.6`: classic 2 stalls, tour 1, summary 0. A stalled trial now records a page snapshot in
its `# FAILED` row; the scale-pass shape still only warns on stderr.

## Gotchas

- **One mounted runner per view, never keyed per stop or row.** A stop or an opened row changes only
  the runner's `camera`, `focus` and `playbackRate`, so the figure tweens; a key would remount it
  and lose the reader's Pause (component state) and replay the intro.
- **`resultKey` is a string**, not the result object: the fused result is rebuilt on every session
  render and again when the scale pass lands. The tour passes `` `${clipIds.join(' ')}#${replays}` ``
  so Replay tour plays the intro again and the scale-pass graft does not. A module-level Set marks a
  key when step 0 begins (from the hold's timer), so StrictMode's simulated unmount and a runner
  never seen do not mark it. UI derives from `running`, never from `onDone`.
- **One keyed limb parameter per still beat** (`runnerFocusFor`). A still figure (paused, reduced
  motion) holds the first annotated limb parameter's key leg phase and draws a limb mark only at
  its own key phase, so a second limb parameter keyed elsewhere (knee drive beside knee flexion,
  swing-foot arc beside step width) would be accented with no mark. Focus is also built from the
  stop's HEADLINE metric only, so the figure never labels a number the stop does not state.
- **`data-runner-part` hooks** (`caption`, `stage`, `drawing`, `controls`) on `ModelRunner` are the
  only coupling for the phone layout: `RunnerTour`'s `max-lg:` classes style them from outside, so
  `src/runner` carries no phone code. Pinned by `runnerPhoneStructure.test.tsx`. Don't rename them.
- **The phone layout is sticky, not fixed.** Below `lg` the rail is `display: contents`; the stage
  (viewport-tall, edge to edge) and the opaque control row (Skip intro, Pause) each stick within
  the tour. `fixed` would paint over the page above the tour at scroll 0, and one element holding
  both would make a single stacking context, so the runner could not sit under the panels while
  its controls sit over them. The drawing is inset by `--rt-reserve` (the active panel's measured
  height). The document snaps (`y proximity`) to slot ends except the first.
- **The intro is gated on `useMostlyVisible`**: the runner's FIGURE (the svg,
  `[data-runner-part=drawing]`) must be ≥ 90% on screen (or fill 90% of the viewport), on top of the runner's own
  `onActiveChange` (tab visible and any part on screen). Gating on the whole rail held the intro at
  scroll 0 on 1280×800, where the Pause row and legend sit below the fold. Once step 0 has begun,
  the timers keep running while unseen (the renderer's tween is wall-clock). Leaving during the
  500 ms hold restarts the hold.
- **Reduced motion** never starts the intro (it marks the key and fires `onDone` once); camera
  changes jump instead of tweening; the figure holds a still pose.
- **Driving it:** wait for `/analysis complete/i` (exactly one `role="status"` in every view). The
  tour's rail carries `data-camera` and `data-active-stop`; stops are `[data-tour-stop=<id>]`;
  summary rows are `details[data-area=<id>]`; evidence inside an opened row is
  `.metrics-panel__evidence-figure canvas`. The runner's svg is itself `[data-runner-part=drawing]`.

## Live check, 2026-10-27 (`strides-trn2.6`)

Real GPU (ANGLE Metal), derived port. Each of park-side-landscape, park-side-portrait,
park-approach, multiperson-track (uploaded) and Demo (3 clips), at 1280×800 and 390×844, light and
dark (20 runs), plus reduced motion at 1280 light and 390 dark: tour → walk every stop → Skip to
summary → open the first row and wait for its evidence canvas → Classic table → browser Back.

- **"Analysis complete." exactly once** (one visible `role="status"`) in tour, summary, classic and
  after Back, in all 22 runs. No page errors or console errors.
- **Camera per stop** matched `FOCUS_AREA_CAMERA` everywhere (`data-camera` on the rail): side clips
  get rhythm/posture/knees/landing; approach gets rhythm/arms/footPath; the demo gets all six.
- **Skip** writes the landing and drops `view`; **Classic table** pushes `?view=classic`; **Back**
  returns to the summary with the analysis intact; evidence appeared in the opened row every time.
- **Remembered landing:** after one Skip, a second analysis in the same storage opened on the
  summary; `?view=tour` still opened the tour.
- **Intro gating:** with `document.visibilityState` overridden to `hidden` before analysis
  finished, Skip intro was still showing 9 s later (the intro had not run); 1.5 s after reveal it
  was still running and 9 s after reveal it had finished. Reduced motion never showed Skip intro.
  Scrolling to the page bottom does not take the figure off screen at 1280 or 390 (it is sticky).
- **Defect (`strides-xsl3`, P1):** below ~700 px of viewport height the phone runner's drawing gets
  0–53 px (375×548 and 375×600: 0 at every stop; 375×667: 53), because the sticky session header,
  tour bar and control row plus `--rt-reserve` leave it no room. `useMostlyVisible` passes for a
  zero-area svg, so the intro plays unseen there. Not fixed here: layout and gate belong together.
- Screenshots: `trn26-*.png` in the trn2.6 session scratchpad (not committed).
