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

## Bounce composite reading (`strides-xki9`)

The rhythm area's three bounce metrics read as ONE reading in the summary (and a secondary value in
the tour), headlined by vertical ratio, with a line citing what vertical ratio was computed from.
Change: `openspec/changes/compose-bounce-reading` (design D1–D7, D3 and D6 revised in review
round 1). Classic view unchanged. A presentation grouping, never a score.

- **Presentation only:** `src/guidance/compositeReadings.ts` (`COMPOSITE_READINGS.bounce`: VR, VO_cm,
  VO; `areaReadings`; `bounceDerivation`). `FOCUS_AREAS`, `focusAreaView`'s headline, `feedbackFor`
  and `selectOneThing` never read it, so the area headline, why line, cue and one thing cannot move.
  `SummaryArea` gained `readings` and `bounce` beside an unchanged `entries`.
- **The From line cites only VR's own inputs** (`formatBounceDerivation`): `From hip bounce 15.3% of
  torso ÷ stride length 6.3 torsos (median of 3)`. VR = MoveNet hip-bounce px ÷ median stride px;
  VO (relative) is that same fit over the torso, so VO = bounce in torsos and VO / VR = stride in
  torsos, and the "÷" is true arithmetic. Count = VR's `sampleSize`, written "median of N" so
  "stride" only names the length. Figures only when VO is from VR's clip (`sourceIndices`) and the
  signal is `hipMid` (guarded on `DEFAULT_HEURISTICS_CONFIG`, since the result does not record it:
  `strides-1k3w`); otherwise `From hip bounce ÷ stride length (median of N)`. ⚠️ **Never VO_cm**: it
  is a separate MediaPipe fit (the scale pass), maybe of another subject, and VR does not read it.
  The first version cited "bounce 7.2 cm" and switched in place when the graft landed; review
  round 1 removed that. The line never changes when the scale pass lands.
- **Summary:** row headline = first reading's headline; "Also:" names the composite once ("Also:
  Vertical ratio"). Opened: `CompositeReading.tsx` = `div.results-summary__composite[role=group]
  [aria-label=Bounce][data-composite=bounce]`, the headline card with `p.guided-results__derived-from`
  (muted `text-sm`) under its headline (NOT `guided-results__derivation`: that class is the band's
  "Derived range" in the card's disclosure), then ONE `details.results-summary__composite-more` in
  the card disclosure's idiom, named "Same bounce in cm and % of torso length" (or the one unit).
- **Tour:** every stop keeps the area's own `view.headline` (feedback and runner focus as on base).
  When VR IS the headline (side-portrait) its From line (`p.runner-tour__derivation`) follows the
  bar and legend. Otherwise, with VR measured and heading the bounce reading, rhythm ends with
  `div.runner-tour__value.runner-tour__value--secondary[data-composite=bounce]`: "Vertical ratio",
  value with its band position VISIBLE, confidence when caveated; no bar, no From line. No block
  when VR is excluded (approach: cadence alone, as base). Both excluded from the 25-word budget; the
  From line ≤ 14 words.
- `MultiClipVideoSession` memoises `sourceIndices` on its content (a JSON key) so the downstream
  memos hold.

### Live re-check after review round 1, 2026-10-27 (`5ec01178`)

Real GPU, port 5231, fresh context per run, no page or console errors, one "Analysis complete."
status everywhere.

| run | tour rhythm stop (DOM order) | summary rhythm row |
|---|---|---|
| side-landscape 1280 light | Cadence 174 + bar, why line, then "Vertical ratio 2.46% · lowest 5% of Garmin's table"; no From line; identical before and after the scale pass | VR card, From "hip bounce 15.4% of torso ÷ stride length 6.3 torsos (median of 3)" in muted text; "Same bounce in cm and % of torso length" (44 px) opens to two canvases |
| side-landscape 390×844 dark | same; the panel (229 px, scrolls inside, as on base) shows the why line's first words at rest again, as base did | same (VR 2.40%, bounce 15.2%) |
| side-portrait 1280 light | VR 3.00% headline (Medium), bar, then From "hip bounce 17.2% of torso ÷ stride length 5.7 torsos (median of 2)" | "Same bounce in % of torso length" |
| park-approach 1280 light | Cadence 181 alone (VR excluded), as base | VO_cm headline card, no From line; "Same bounce in % of torso length" |

The round-0 phone cost (`strides-3v4t`: the VR block pushed the why line out of the panel at rest)
is gone with the block moved after the prose; the bead is closed. Screenshots: scratchpad
`xki9-live/r1-*.png`.

**Review round 2: the stride now prints to two decimals** ("6.30 torsos", not "6.3"). At one
decimal the printed division visibly missed the displayed ratio (the test fixture's 15.0 ÷ 3.8 =
3.95 sat next to "4.00%"); a reviewer simulation put 31% of realistic cases ≥ 0.05 points off. Two
decimals keeps every case inside 0.05 points, which `summaryLabels.test.ts` now sweeps. The live
strings above were captured before this change and show one decimal.

### Live check before review round 1, 2026-10-27 (`strides-xki9`, `dc438980`; superseded where round 1 changed the copy)

Real GPU (ANGLE Metal, M4 Pro), port 5231 (derived, `assertServesThisCheckout`), one browser
process, fresh context per run, no page or console errors in any run, exactly one "Analysis
complete." status in tour and summary every time.

| run | tour rhythm stop | summary rhythm row |
|---|---|---|
| side-landscape 1280 light/dark, 390 light/dark, 375×667 dark, 1280 reduced motion | Cadence 174 + secondary VR 2.40–2.46%; From line "bounce 15.2–15.4% of torso length …" before the scale pass, "bounce 7.2 cm and stride 6.3 torso lengths (3 strides)" after it; one bar | Cadence headline, "Also: Vertical ratio"; VR card with bar + From line; "Also: Vertical oscillation (cm), Vertical oscillation" closed (44 px at 1280, 56 px at 390), two evidence canvases render when opened; the row stays open |
| park-approach 1280 light | Cadence 181 (Medium) + secondary "Bounce 10.5 cm" (Low confidence), no From line (VR excluded) | Also: Vertical oscillation (cm); VO_cm card with Malisoux bar, no From line; nested holds VO |
| side-portrait 1280 light, 390 dark | cadence excluded: VR 3.00% is the stop headline, Medium confidence, bar, From "bounce 17.2% of torso length and stride 5.7 torso lengths (2 strides)" (VO_cm absent on this clip, so it never switches to cm) | VR headline, no Also line; nested holds VO |
| Demo (3 clips) 1280 light | as side-landscape | every rhythm card "Measured from Clip 1 of 3 · Side view": the VO family and VR share clip 1, so the same-clip guard did not bite live (it is unit-tested) |

- The From line switched from relative to cm in place when the scale pass grafted VO_cm, in every
  side-landscape run.
- **Phone panel (open):** the rhythm panel already scrolled inside itself on base at 390×844 (229 px,
  `role=group`) and 375×667 (164–170 px); the cap is unchanged. On base the why line's first words
  showed at rest; now the secondary VR block fills that space and the why line is below the fold of
  the panel at rest (the reader scrolls the panel to reach it). Filed as `strides-3v4t`.
- VR read 2.46% in the first context and 2.40% in later ones (one shared browser process: the
  cold/warm mix the harness notes describe). The stride figure is VR's own denominator in torso
  lengths (6.3 ≈ 3 m at a 0.5 m torso, which is what 7.2 cm ÷ 2.40% implies too).
- Screenshots: scratchpad `xki9-live/*.png` (base comparisons in `xki9-live/base/`), not committed.

**Fidelity A/B** (`--view-arm` tour/summary/classic × side-landscape, side-portrait, front-approach,
`--trials 1 --evidence --scale-pass`, fresh process per trial): base `10b3f54c` on its own derived
port 5258, branch `dc438980` on 5231, both "started by this run, identity verified". Each trial's
fields minus `elapsedMs` canonicalised (sorted `key\tJSON`, 430/415/415 rows): **one hash per clip
across both checkouts and all three arms**, the same three hashes as the `strides-zba4` re-run
(side-landscape `9091751e…16c6`, side-portrait `7d1699a3…677c`, front-approach `6ba8609e…bf91`);
`md5 -r` plus two-way `cmp -s` through `rtk proxy sh -c` agreed (18 identical, 0 differing; a
cross-clip control differed). One branch trial (side-portrait / tour) stalled with the
`strides-qg86` shape (video `readyState` 0, no status); its re-run hashed identically.

## Arm swing drawn as a sweep (`strides-eiil.4`)

Change: `openspec/changes/draw-arm-swing-as-sweep` (ADDED only; `compose-bounce-reading` MODIFIES
the tour/summary headline requirements). `armSwingAmplitude` is the wrist's vertical travel only
(`strides-eiil.1`–`.3`), so:

- **Label:** `SHORT_METRIC_LABELS.armSwingAmplitude` = `Arm swing (wrist up-and-down)`; the tour's
  arms stop (rendered uppercase) and the summary's arms row both read it. Outside the word budget.
- **Figure:** `armCentreDeg` 48 → 33 (upper arm centred ≈ 5° behind vertical), so the elbow passes
  behind the trunk on the backswing (neutral 0.3: upper arm −23°…+13°; front 0.33: −25°…+15°;
  side 0.51: −37°…+27°). At 48° it ran −3°…+23° at 0.3 and the arm pumped in front of the chest.
- **The pin:** above v* = 2R·sin²33° ≈ **0.523** a symmetric swing would take the wrist behind the
  shoulder, where the drop R·cos ψ shrinks again (the wrist rises) and the readback comes up short. `armAt` uses
  `centre = max(armCentreDeg, asin(√(v / 2R)))` (with A = c above v*), so ψ runs 0…2c, the wrist
  bottoms out straight below the shoulder, and travel is exactly v. Removing the `max` fails four
  existing readback tests plus the new wrist-behind-shoulder test. ⚠️ **Today's side-landscape
  readings (0.546–0.563) are above v*, so the pinned branch is what a side clip shows live.**

### Live check, 2026-10-27 (`19deaf39`)

Real GPU (ANGLE Metal, M4 Pro), port 5319 (derived, `assertServesThisCheckout`), one browser
process, fresh context per run, no page or console errors, one "Analysis complete." each run.

| run | `[analysis-diagnostics]` armSwingAmplitude (side / side / front) | stop label + value | figure label | summary headline |
|---|---|---|---|---|
| Demo 1280 light (1st context) | 0.56275 / null / 0.33522 | ARM SWING (WRIST UP-AND-DOWN), 56.3% of torso length | 56.3% of torso length | Arm swing (wrist up-and-down) 56.3% of torso length |
| Demo 390 dark | 0.54619 / null / 0.33695 | same label, 54.6% | 54.6% | same, 54.6% |
| side-landscape 1280 light | 0.54619 | same label, 54.6% | 54.6% | same, 54.6% |
| side-landscape 390 dark (cold) | 0.56275 | same label, 56.3% | 56.3% | — |
| park-approach 390 dark | 0.33522 (front) | same label, 33.5% | 33.5% | — |

The 0.5627 / 0.5462 split is the cold/warm browser-process mixture (`harness.md`), not this change.
The demo's arms value is the SIDE clip's (56.3%), not the front clip's 33.5%: that is the
measurement branch's clip choice, untouched here.

- **Elbow behind the trunk:** checked on the side-camera stops (rhythm `wholeBodySide`, posture
  `torsoSide`; orthographic along z, so the screen test is the sagittal one). Over ~40 frames the
  elbow's signed side of the shoulder→hip line spans both signs on both arms (−0.34…+0.33 and
  −1.12…+1.08 SVG units), and the wrist's forward reach of the shoulder bottoms out at 0.000–0.003
  (the pinned backswing, never behind). Visible in `*-posture-*.png`. The arms stop's front-¾
  camera does not show it clearly.
- **390 px label:** at the arms stop the phone panel overlays the rail from y = 602. Same clip,
  same value (0.5627): base label box 588–608, branch 598–618, because the pinned wrist now reaches
  a full R below the shoulder and the bracket's label hangs below it. The value line ("56.3%")
  still shows; its second line "of torso length" is now hidden behind the panel (on base it
  showed, just). A front value (0.335, unpinned) shows both lines (585–605). 1280 is clear
  (label 592–624 inside a stage ending at 658). **Fixed in review round 1, below.**
- Screenshots: scratchpad `eiil4-live/*.png` (3 frames ~150 ms apart + paused per run; base
  comparison in `eiil4-live/base/`), not committed.

### Review round 1: the arm label sits above the bracket (design D4)

`runnerAnnotations.ts` armSwing: label anchored at the bracket's TOP end, `side: 'above'` (it was
`below` the foot). The bracket itself is unchanged and spans exactly the value. Only this builder
changed, so no other label moves (the trunk-lean label at 390 sits where it did before).

- **Phone geometry at the arms stop (live, 390×844, side-landscape 0.5627):** the drawing renders
  at 84.4 px per viewBox unit (the SVG is 338 px tall), the bracket runs y 0.347–1.300 at x 0.80,
  and the panel edge (602 px) is at y 1.389. Only ~0.09 units (8 px) sit below the foot, so no
  below-placement can clear the panel. Labels render at about 8 px there, not 13: `pxPerUnit`
  comes from the stage box (130), not the drawn SVG (84). That predates this change and is not
  fixed here.
- **Rejected: right of the top end.** It clears the panel, but above about 0.45 the bracket sits
  so far right that `clampLabelX` pulls the label back over it (live box 255–315 with the bracket
  at 263), and its halo hides the top tick.
- In the front-¾ view the forearm crosses the region above and right of the top end in some
  phases, whichever upper placement is used. The halo keeps the label legible.

Label boxes (CSS px, live, real GPU, port 5319, fresh context per run, no errors):

| run | value | before (below foot) | after (above top) | panel top |
|---|---|---|---|---|
| side-landscape 390 dark | 0.5627 (pinned) | 233–293 × 598–618 (2nd line hidden) | 233–293 × 489–509 | 602 |
| park-approach 390 dark | 0.3352 | 221–281 × 585–605 | 221–281 × 509–529 | 602 |
| side-landscape 1280 light | 0.5627 | 338–430 × 592–624 | 338–430 × 452–484 | n/a (stage to 658) |

Screenshots: scratchpad `eiil4-live/r1-*.png`.

### Review round 2: the arms-stop camera reads as a crossover (open)

UX review: at `upperFrontQuarter` (yaw 45, pitch 5) the near forearm crosses the chest and the two
forearms form an X, which reads as "arms crossing the midline". Nothing measured says that.

Yaw convention (`camera.ts`): yaw 0 puts the camera on the runner's RIGHT, travel to screen right;
yaw 90 is the front. At 0 < yaw < 90 the right arm is near. A probe (pitch 5, zoom 1.7, neutral
params, 200 phases) measured the closest approach of each joint to the projected shoulder–hip quad,
in viewBox units; negative means inside.

| yaw | near elbow, forward swing | near elbow, backswing | far wrist | shoulder separation |
|---|---|---|---|---|
| 0 | −0.010 / +0.010 (the quad is a sliver) | +0.016 / +0.018 | +0.42 / +0.10 | 0 |
| 10 | −0.077 / −0.074 | +0.039 / +0.044 | +0.46 / +0.15 | 0.22 |
| 20 | −0.150 / −0.145 | +0.067 / +0.072 | +0.49 / +0.19 | 0.44 |
| 30 | −0.209 / −0.222 | +0.094 / +0.099 | +0.49 / +0.22 | 0.64 |
| 45 (today) | −0.117 / −0.301 | +0.130 / +0.134 | +0.48 / +0.26 | 0.90 |

(cells: v = 0.335 / v = 0.5627, neutral 4° lean)

- **The near elbow's FORWARD swing projects over the chest at every yaw above 0.** The arm sits
  at the near shoulder's depth, so the camera sees it in front of the torso. That is correct in
  depth, and it shrinks as the yaw falls. Its backswing is always outside the quad. The far wrist
  never enters at neutral lean; at a −15° lean it does at small yaws.
- So "neither the near elbow nor the far wrist crosses the torso outline over a full cycle"
  cannot hold at any yaw that still separates the arms in depth. At yaw 0 the arms superimpose.
  The camera change waits on choosing a criterion (e.g. the backswing never inside, the forward
  swing's overlap bounded, the X gone), not on a yaw.

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
