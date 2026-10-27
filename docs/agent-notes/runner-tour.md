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
first view to mount them (when a row opens). The runner's footage plate (`strides-zba4`, below)
does not change that: it COPIES a canvas's pixels to a blob URL and never mounts the canvas.

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
5. **The footage is one tap away**: the summary row's inline evidence frame. On a still beat of a
   side stop (knees, landing), the headline's evidence IMAGE (the measured moment, with the card's
   fainter second moment ghosted over it where it has one) also sits faintly (0.26, greyscale)
   behind the figure, placed by a similarity transform only, never reshaped, labelled "Faint photo:
   your clip, not a target", never a target ("Footage plate" below).
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

**Re-run for the footage plate, 2026-10-27 (`strides-zba4`, branch `4ce2f821` vs base `7a8b9e1e`).**
Same three arms and clips, `--trials 1` (fresh process per trial), `--evidence --scale-pass`, each
checkout's own derived port (5302 branch, 5241 base, both "started by this run, identity verified"),
ANGLE Metal on M4 Pro. Canonicalised as above (all fields but `elapsedMs`; 429 / 415 / 415 rows):
**one hash per clip across both checkouts and all three arms** (18 trials). `md5 -r`:
side-landscape `9091751e…16c6`, side-portrait `7d1699a3…677c`, front-approach `6ba8609e…bf91`;
`cmp -s` in both directions against each clip's base/tour file through `rtk proxy sh -c` agreed.
Scale-pass anchors unchanged (side-landscape VO_cm 7.19338, stepWidthCm −14.2397). One branch trial
(side-landscape / tour) never started analysing: the MoveNet weights fetch from kaggle.com failed
(`net::ERR_FAILED`, CORS on the redirect), a network flake; its re-run hashed identically. (A
`… | md5` pipeline through `rtk proxy sh -c` is refused by the worktree-isolation guard in an agent
worktree; `md5 -r` on the files plus two-way `cmp` stood in.)

## Footage plate (`strides-zba4`)

A faint copy of the shown stop's (or opened row's) headline evidence image, behind a still runner.
It is the card's picture as it is: the measured moment and, for a paired metric, a fainter second
moment ghosted over it (kept deliberately: the plate brings the evidence ghosting to the runner).
Never call it "the measured instant": the fit reads the measured (base) moment's joints, the
picture holds both. Change: `openspec/changes/add-runner-footage-plate` (design decisions 1–7,
D1–D12).

- **Gating, in `runnerFootageFor` (`src/results/runnerFootagePlate.ts`, pure):** a focus; the
  first focus metric whose evidence from its winning clip (`sourceIndices`) has arrived is the
  headline and must be overstriding, foot strike, knee flexion or knee drive (never skips to the
  next one); camera `landingSide` or `legsSide`; the winning clip's raw `View` (`clipViewKinds`,
  not the `clipViews` label, and indexed like `clips`, as `sourceIndices` is) is `'side'`;
  `travelDirection` ≠ 0 (−1 mirrors); the measured moment has a hip AND a knee or ankle; the
  measured side resolves (`plan.base.side`, else the one side all sided non-hip joints
  share). Foot strike never qualifies (no hip in its frame). The tour passes none while the intro
  runs; the summary has none below `lg` (no focus there).
- **Still-beat rule, in `ModelRunner`:** shown only when React-level `!playing` (paused, or
  reduced motion before play; the landing loop's 300/150 ms holds do NOT count), the phase is the
  held phase, no camera tween and no value tween, AND the footage metric's key leg phase on the
  near leg equals the held phase. Pausing with any limb-keyed (non-beat) focus now snaps to the
  held phase (it used to only on `landingSide`; this reaches the front Foot path stop too);
  cadence pauses where it is. Forced colours: no plate and no words.
- **Fit (`src/runner/footagePlate.ts`, pure):** hip-mid onto drawn hip-mid; scale = Σ drawn /
  Σ footage over hip-mid → knee → ankle (hip-mid → ankle without a knee; feet excluded); mirror for
  a right-to-left clip; `matrix(a 0 0 d e f)`, `|a| = d`. Never least squares (it would turn an
  angle difference into scale and hide it). Written by `drawRef` every still draw from the pose as
  drawn (lift, live camera); while hidden the transform is left alone, so it fades out in place.
  **Clutter cap** (`placeFootagePlate`, `MAX_PLATE_SIDE_IN_FRAME_WIDTHS = 2.5`): no plate when the
  placed image is wider than 2.5 drawing widths (`|a| / 3`). Measured: knee-flexion images 1.55–1.64
  (readable), side-portrait's far-apart overstride pair 4.18 (cluttered); design D10.
- **Pixels:** the evidence canvas is COPIED (`toBlob` → blob URL), only while still, once per source
  canvas, revoked on source change and unmount; never adopted (the summary's card owns it, and the
  tour still mounts no evidence canvas). The baked evidence marks come with it (accepted, decision
  5), greyscale (`grayscale`) so they never read as a second cyan limb.
- **Words, only while on offer** (`plateShown`: the same placement run at render, so the cap and
  the fit gate the words too): the legend row's `[data-plate-legend]` line "Faint photo: your clip,
  not a target" (+ " · flipped" when mirrored), and the `p.sr-only` ending "Faint behind the still
  model: your clip's <metric> evidence image, the measured moment[, with a fainter second moment
  over it][, flipped to face the way the model runs], scaled to fit. Your footage, not a target."
- **Driving it:** `image[data-footage-plate]` is the runner svg's first child; `[data-shown]` while
  shown (opacity 0.26 via `data-[shown]:opacity-[0.26]`, 240 ms fade, also on first appearance via
  `starting:opacity-0!`, none under reduced motion, `display: none` under forced colours). Tour:
  `.runner-tour__rail image[data-footage-plate][data-shown]`; summary:
  `.results-summary__runner image[…]`. Wait for `[data-shown]` rather than a fixed delay: the copy
  took ~0.8–1.8 s after Pause in the summary live (accepted latency; a fixed 1.2 s read missed it
  once), a few ms in the tour.
- **Accepted, by recorded decision (design.md):** the thigh-angle offset at the knee-flexion
  moment (an honest one-stride vs one-setting difference the fit keeps visible); the hard square
  edge; discoverability (only paused or under reduced motion); the summary's copy latency.

### Live check, 2026-10-27 (`strides-zba4`, `4ce2f821`)

Real GPU (ANGLE Metal, M4 Pro), port 5302 (derived, identity-checked). Each of park-side-landscape,
park-side-portrait, park-approach uploaded alone; 1280×800 and 390×844, light and dark, plus reduced
motion at 1280 light and 390 dark (18 runs, one browser process, a fresh context each). Tour: every
stop scrolled to, Pause, wait for `[data-shown]` (≤ 6 s), Play. Summary: Knees then Landing opened,
Pause, Play, closed.

| clip | tour knees | tour landing | other stops | summary 1280 knees / landing | summary 390 |
|---|---|---|---|---|---|
| side-landscape | shown, all 6 runs | **none** (overstriding `no-candidates`) | none | shown / none | none |
| side-portrait | shown, all 6 | shown, all 6 (overstriding frame) | none | shown / shown | none |
| approach | (no stop) | (no stop) | none (rhythm, arms, foot path, one thing) | no rows | no rows |

- Play removed `data-shown` and the note every time; no page or console errors in any run.
- **Landing's headline is overstriding** (the stop's first entry; tour focus is that metric only).
  On side-landscape it has no evidence (`no-candidates`, as recorded in `evidence.md`), so the tour
  landing stop has no plate; in the summary the landing headline falls to foot strike, which has no
  hip, so none there either. side-portrait's overstriding frame exists, so landing showed there
  (withheld since review round 1 by the clutter cap, below).
- **First appearance popped** in every case (fixed in round 1): computed opacity went from no
  element to 0.26 in one frame (the copy mounts the `<image>` already marked shown). Later toggles fade as designed: Play
  0.26 → 0 and Pause 0 → 0.26 over ~240 ms, ease-in-out; reduced motion cuts.
- **Alignment.** side-landscape knees (the clip runs right to left, so the plate is mirrored and
  the photo faces the model's way): hips meet, thigh lengths agree within ~4%, the folded swing leg
  has the same shape; the photo's thigh sits ~20° further forward, so the shins do not overlap. Reads
  as the same pose a little ahead, not as a wrong model. side-portrait knees: same scale agreement,
  but the photo's thigh is ~30–40° ahead of the model's at that instant (the model's thigh at its
  peak-knee-bend phase is its own curve, not the footage's): the legs visibly part, which could read
  as "the model's leg is behind". side-portrait landing: hip, knee and ankle marks fall on the
  model's leg almost exactly, but the far-apart overstride crop is a small subject, so the fit
  magnifies it ~4–5×: the photo blurs and the baked marks become fat blobs and a thick dashed plumb
  line that dominate the drawing, clearly cluttered (worst at 390 dark).
- **Phone:** at 390×844 the plate shows above the stop panel at both stops; its hard square edge is
  visible (a vertical edge inside the drawing on side-landscape knees). Dark mode dims the photo,
  baked yellow marks read more strongly there.
- **One unexplained run:** side-landscape 1280 dark, mid-walk, `[data-tour-stop="knees"]` was not
  found for 30 s after rhythm and posture had been visited. Re-run twice (the matrix cell and a
  separate walk): all five stops present, plate as above. Not reproduced; cause not established.
- Displayed knee flexion differed between these runs, which are outside the A/B's regime (one shared
  browser process, different viewports, DPR and starting view): side-landscape 102.9° (1280) vs
  104.4° (390); side-portrait 114.7° (a separate 2× DPR run) vs 115.7° (1280 matrix). Not checked
  against base live; the fresh-process A/B above, the regime that is deterministic, is bit-identical
  between base and branch, so the plate does not move a measurement.
- Screenshots: `zba4-live/*.png` in the zba4 session scratchpad (not committed).

### Live re-check after review round 1, 2026-10-27 (`d6c3c013`)

Same harness; side-landscape at 1280×800 light, 390×844 dark and 375×667 dark (a short phone);
side-portrait at 1280×800 light, 390×844 dark and 1280 light reduced motion. No page or console
errors.

- **Greyscale applied:** computed `filter: grayscale(1)` on the SVG `<image>` in every run; the
  baked marks read as grey, no longer as a second cyan limb.
- **First appearance fades:** opacity from 0 rising over the frames after the copy lands (e.g.
  0.000 0.001 0.003 0.007 0.014 0.024 0.038 … 0.26); reduced motion at 0.26 at once.
- **Legend line fits:** one line at 1280 (240 px); inside the note chip at 390×844; two lines
  inside the 14rem chip on the 375×667 short phone; no overflow anywhere. "· flipped" on
  side-landscape (right-to-left clip), absent on side-portrait.
- **Clutter cap:** side-portrait landing now shows no plate, no legend line and no note, in the
  tour and the summary (the copy exists; the placement is refused). Both knee plates unchanged
  (`|a|` 4.64–4.84 and 4.93). So on the side demo clips today, landing never shows a plate.
- Screenshots: `zba4-live/r1-*.png`.

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
  height) but never below its floor `--rt-draw-min` = `max(40svh, 200px)`; a longer panel overlaps
  the drawing's bottom and is capped (`max-h`, scrolls inside) to leave the top 85% of the floor
  (`--rt-clear`) uncovered: the focus joints measured live reach 74–82% of the drawing's height,
  posture lowest (`strides-xsl3`). The document snaps (`y proximity`) to slot ends except the first.
- **A short phone (< 64rem wide, ≤ 720 px tall, `useShortPhoneLayout`) has no separate control
  row.** The dots and Skip render in a sticky row that is a cell of the BODY's grid (the bar keeps
  only the sr-only heading, 0 px), and the runner's controls are laid over that row's start
  (`--rt-controls-width`, measured; `--rt-controls` = the row's measured height). Not the other way
  round: a sticky element only moves within its containing block, so controls placed over the
  tour's bar from inside the runner sat below it until the tour reached the top. Only the dots and
  Skip move between the two places; the runner never remounts. Skip reads "Summary" there (name
  unchanged); Pause is icon-only (`button[aria-label]` text at 0 px).
- **The reading line never sits above the stuck bar** (`useActiveStop`): max(42%, a quarter of the
  way down under the bar's STUCK bottom = its sticky `top` + height). Before `strides-xsl3`, below
  ~620 px tall the 42% line was inside the chrome and the runner showed the stop before the one at
  rest.
- **The intro is gated on `useMostlyVisible`**: the runner's FIGURE (the svg,
  `[data-runner-part=drawing]`) must be ≥ 90% on screen (or fill 90% of the viewport) AND ≥ 120 px
  tall (an IntersectionObserver reports ratio 1 for a zero-area target; a resize re-observes), on top of the runner's own
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
  **Fixed in `strides-xsl3`** (change `fix-short-phone-runner`): 40% of the viewport at every stop
  at 375×548/600/667 and 390×844, focus above the panel; the panel window at 375×548 is 96 px
  (scrolls inside) until `strides-pmvo` slims the 200 px session header.
- Screenshots: `trn26-*.png` in the trn2.6 session scratchpad (not committed).
