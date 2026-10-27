# Guided results view

> Moved verbatim from CLAUDE.md on 2026-10-27 to keep the auto-loaded file under the size limit. Index: CLAUDE.md "Notes index". Cross-references like "above"/"below" may now point into a sibling file in this directory.

## The guided results view — `?view=guide` (2026-09-15, epic `strides-kgi`)

**A second results page** that sets each metric against a published reference band where one can
be cited. ⚠️ **Superseded 2026-10-27 (`strides-trn2.2`): the runner tour is the default now; see
"Driving it" below.** The rest of this callout is the 2026-10-16 state. **Guided was the DEFAULT from 2026-10-16** (`strides-8c3`, change
`results-ux-round-one`): `resolveResultsViewMode` selects classic only for exactly one
`?view=classic`; absent, `?view=guide`, unknown, `CLASSIC` or a repeated param all resolve guided.
The A/B harness and e2e suite therefore drive the guided view now — measured bit-identical to the
classic-default `main` on all three `--evidence` clips except `elapsedMs`. Everything below that
says "classic stays the default" or "opt-in" describes the pre-flip state. Spec:
`openspec/specs/guided-results-view/spec.md`; full provenance, derivations and refusals:
`openspec/changes/archive/2026-09-15-guided-results-view/design.md`.

- **Where:** `src/guidance/` (`METRIC_GUIDANCE` in `metricGuidance.ts`, `MetricScale.tsx`,
  `bandPosition.ts`, `formatBandValue.ts`, `types.ts`); `src/results/GuidedResultsView.tsx`,
  `GuidedMetricCard.tsx`, `guidedGroups.ts` (pure three-group partition; group 3 is
  `metricTier === 'excluded'`), `formatGuidedValue.ts`; `resultsViewMode.ts`
  (`history.pushState` per switch, no router; `ResultsViewToggle.tsx` was deleted by `strides-trn2.2`). The only wiring is one conditional in
  `MultiClipVideoSession.tsx`. `ResultsView.tsx` is untouched; `MetricsPanel.tsx` lost only
  `METRIC_DESCRIPTIONS`, moved verbatim to `metricDescriptions.ts` (`fd3d1f7`).
- **The governing rule: a band is cited or it does not ship.** No band is invented, pooled across
  studies, fitted to this repo's footage or tuned. **Five banded**: `cadence`, `verticalRatio`,
  `verticalOscillationCm`, `trunkLean`, `kneeFlexion`. **Seven deliberately not**: `overstriding`
  (nothing is normalised by torso length, no threshold exists in any unit, and the two published
  absolute figures disagree 3.4× — `strides-yg8`, still open, rejects picking a number for it), `verticalOscillation`,
  `stepWidth`, `stepWidthCm`, `footStrikePattern`, `kneeDrive`, `armSwingAmplitude` — reasons in
  design.md D5. An unbanded metric still renders its value and links, collapsed; banding decides
  whether a *scale* renders, never whether the metric does. **Do not add a band without a citation
  that states it** — `metricGuidance.test.ts` names the seven unbanded entries so adding one is a
  visible change.

⚠️ **Band bounds are stored in `MetricResult.value`'s domain, not the displayed one**:
`verticalRatio` 3.05% is stored as `0.0305`.

⚠️ **Three bands are not a straight transcription — do not "correct" them back.**
`verticalRatio`'s Garmin zones are **HALVED** (Garmin's "stride" is a step; this app's is a true
stride — D3) and relabelled in **value order**, because Garmin's percentile is a performance rank
that gives the lowest readings the highest percentile. `verticalOscillationCm`'s `6.0–9.5` cm is a
**derived union** of Malisoux 2023's sex-stratified P10/P90 (women's P10 to men's P90), not one
published range, and deliberately not Garmin (D4). `kneeFlexion` is Folland 2017's observed
**71.3–129°**; an earlier pooled `85–125°` was **withdrawn** because no source publishes it.

⚠️ **Exactly one results view is mounted at a time.** Evidence imagery is real canvas elements and
a node has one parent, so a second mounted view silently steals every canvas. `useSessionEvidence`
stays in `MultiClipVideoSession` and reaches both views as a prop; **the guided view must never call
it**. Toggling unmounts one view and mounts the other, and the canvases move across.

⚠️ **Both views must render `role="status"` starting "Analysis complete."** — the e2e suite and
`scripts/ab-person-selection.mjs` wait on that text, so either view can be driven.

**Driving it (since `strides-trn2.2`, 2026-10-27):** the bare `/strides/` on the derived port
opens the **runner tour** (`.runner-tour`), or the **summary** (`.results-summary`) once
`localStorage['strides.resultsLanding'] === 'summary'` (written by "Skip to summary"; a fresh
Playwright context has none). `?view=tour|summary|classic` selects one explicitly; `?view=guide`
maps to the tour. Both the tour and the summary are, for now, stubs wrapping exactly one
`GuidedResultsView`, so its hooks still apply: `.guided-results`, `.guided-results__group`
(`--banded` / `--unbanded` / `--not-measured`; the last two are `<details>`, collapsed),
`nav[aria-label="Measurements on this page"]`, `.metric-scale`. The motion stage (`.motion-story`)
renders beside the classic table only. The Guided/Classic toggle is gone; the controls are "Skip to
summary", "Replay tour", the summary footer's "Classic table" and classic's "Show summary". Each switch pushes a `{ stridesView }` history entry, so `page.goBack()`
steps to the previous view (the load entry is stamped too; an unstamped `#` entry keeps the view). The
A/B harness never passes `?view=`, so it drives the tour, and still finds exactly one "Analysis
complete." line.

**Live-verified 2026-09-15 (`strides-kgi.7`)** on all three demo clips, real GPU, one upload per
clip: every clip reaches "Analysis complete." at `?view=guide`, banded metrics render a scale with
citation text, the collapsed groups expand, and evidence survives guide → classic → guide. On
`park-side-portrait.mp4`, `verticalRatio` now **resolves** (post-`strides-b4f`,
so read the harness section's "no vertical-oscillation family" note as pre-b4f), while `cadence`
(withheld as retimed) and `verticalOscillationCm` land in "Not measured on this clip".

**Open follow-ups:** `strides-31k` (a retimed clip's cadence gets the generic capture hint),
`strides-ryi` ("a second look … added N more metrics" counts excluded metrics; pre-existing in
classic), `strides-366` (no error boundary — a crash takes the toggle down with it), `strides-xyc`
("this pipeline" in runner-facing copy), `strides-n12` (Folland's per-step/per-stride convention
would unblock a `verticalOscillation` band), `strides-8c3` (flip the default to guide — a product
decision), `strides-7s7` (migrate the eight hand-rolled test factories onto
`src/results/__fixtures__/metricResult.ts`).

### Decluttered on user feedback (2026-09-15, `strides-pip`, change `declutter-guided-results-view`)

First reader's verdict on the page above: **"significantly too verbose"**, and the grayscale scales
**"impossible to read"**. Both were measurable — `cadence`'s card carried **332 visible words**
(363 by the looser measure this change was scoped against, which counted `sr-only` text), and the
two alternating neutral zone tints differ by a contrast ratio of about **1.2:1**. Eight changes,
chosen by the user from a longer list; **the ones NOT chosen were deliberately not made** (the lower
two groups stay visible, published gaps keep their hatching, cards keep their frames).

- **A card leads with one headline**: `174 steps/min · 70th–95th percentile of Garmin's table`.
  `describeBandPositionBriefly` (`bandPosition.ts`) + `guidedHeadlineParts` (`formatGuidedValue.ts`).
  A gap names both zones, merging their shared tail: `between the 5th–29th and 30th–69th
  percentiles of …`. ⚠️ **`guidedHeadline` stays value-only** — the contents list is a three-column
  grid and a position fragment there wraps every row.
- **Zones are shaded by SHARE OF RUNNERS**, one hue family, three steps, darkest (light) / brightest
  (dark) = most runners, with a legend that flips word per theme because the ordering genuinely
  inverts. **Not a grade**: most is not best, and the spec still forbids any element that grades the
  runner. Tokens in `src/index.css` under **`@theme static`**.
  ⚠️ **The reason this file gave for `static` was BACKWARDS and is withdrawn** (review round 1): it
  said a token read as `var(--color-scale-…)` inside an arbitrary value would be pruned away.
  Compiled both ways, those are the ones pruning KEEPS — and there is no such usage left anyway,
  since a single published range is painted with one flat utility now. A plain `@theme` was built
  and `dist/` grepped: **all twelve tokens survive**. `static` stays as belt and braces, because
  Tailwind's pruning rules are not a contract this repo controls.
  ⚠️ **`BandZone.shareOfRunners` comes from Garmin's CUT POINTS (5/30/70/95 → `[.05,.25,.40,.25,.05]`),
  never from the restated integer labels — reading those as spans sums to 1.01.** All-or-none per
  band; every single-range band is `null` (`verticalOscillationCm`'s own derivation says "no
  percentile of the combined cohort is claimed"). The shading step is the share's RANK among the
  distinct shares → `[0,1,2,1,0]`, symmetric, so the two equally-rare tails draw identically.
  `src/guidance/scalePalette.test.ts` parses `index.css` and recomputes every contrast ratio.
- **The scale prints three numbers**: the band's two outer bounds and the value. Every interior bound
  is an unlabelled **seam** (`.metric-scale__seam`, renamed from `__tick`). `staggerRows`, the merged
  `163/164` gap labels and the `BOUND_LABEL_*` constants are **gone**.
  ⚠️ **The figcaption sentence and the zone list are now `sr-only`** — still the full text
  alternative, carrying every bound with its unit, just not repeated visibly beside a headline that
  says the same thing.
- **The speed caveat is a visible `Varies with pace` tag**; the two-part caveat moved into the
  disclosure. **Provenance is one citation line** — `Malisoux et al. 2023 · recreational runners ·
  n = 860 · derived`, from `citationParts`/`citationText` (`guidedGroups.ts`), new field
  `BandSource.populationShort`. ⚠️ **This narrows the archived change's D1 deliberately** (user
  request): the attribution stays on screen, the source's own *full* population sentence moves
  inside. **One `Try:` line per card**, `MetricGuidance.tryLine`, on four metrics only
  (`cadence`, `verticalOscillationCm`, `verticalOscillation`, `overstriding`) — pinned by name, its
  URL must be in that metric's own `remediation`, and every other study moved into the disclosure.
  ~~**No description on a banded card**~~ — **WITHDRAWN in review round 1, every card has one
  again**; and the three group intro paragraphs are gone.

**Measured on `park-side-landscape.mp4`, same clip and same measure both sides** (card
`textContent`, `<details>` subtree and `sr-only` removed, whitespace split): `cadence` **332 → 55**,
`trunkLean` **201 → 39**. Budget pinned at ≤ 70
for cadence, plus a ≤ 50 budget on every banded card's own *furniture* — a mandatory note's first
sentence is the SOURCE's sentence and its length is not the card's to spend
(`verticalOscillationCm`'s is 51 words in one sentence).

**Live-verified** on `park-side-landscape.mp4`, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`),
derived port 5262, at 390 and 1280 px in light and dark plus `forcedColors: 'active'`: bands visibly
coloured with the most-populated zone darkest/brightest, marker distinguishable from the seams,
hatched gaps still reading as gaps, headline one line at 1280 and wrapping to three at 390, and the
marker still present under forced colours (where the shading is dropped and the legend hidden).

#### Review round 1 — nine further changes, and three things not to re-derive

Two reviews (code + UX) of the above, implemented on the same branch. Full record: that change's
**design.md D8**. What a later reader most needs:

- ⚠️ **A single published range is drawn FLAT, and its legend slot names the range** (`Range across
  Folland's 97 runners`). It was a symmetric zone-2→zone-3→zone-2 ramp — the universal "optimal
  range" idiom — on exactly the three cards (`verticalOscillationCm`, `trunkLean`, `kneeFlexion`)
  whose one zone carries `shareOfRunners: null` and which render no legend to correct it. **Do not
  reintroduce a gradient there**; and note the "three printed numbers" rule is now explicitly about
  the TRACK, since a quoted range label may contain the source's own numbers.
- ⚠️ **A `Try:` line can be WITHHELD.** `MetricGuidance.tryLine` gained `direction: 'lower' |
  'higher'` and `tryLineApplies` (`guidedGroups.ts`) drops the line where the value is outside the
  band on that side — `verticalOscillationCm` reads **4.42 cm** on this clip against a 6.0–9.5 cm
  band and was being told to stay lower still. `overstriding`'s direction is `'lower'` although its
  cue RAISES step rate: the field is which way the line moves **the quantity that card reports**. An
  open-ended outer zone is inside the band, so cadence's line is never withheld.
- ⚠️ **`zoneOwner` reads `"of Garmin's table"`, not `"of Garmin's runners"`** — the same card's
  citation line says Garmin publishes no population, so "runners" named a cohort nobody described.
  And that citation line now collapses two absences into one field: `Garmin fenix 7 manual ·
  population and sample size not published · derived`.
- Smaller, all in design.md D8: cadence's Try line drops a superlative sourced to two OTHER studies;
  every unbanded card's `noBandReason` leads with ≤ 25 reader-first words and splits like a note (the
  rest inside the disclosure, under *why there is no range*); `--color-scale-zone-2` darkens to
  `#6fbccd` so the ramp's steps read 1.76 / 2.14 rather than 1.53 / 2.47; the legend is promoted to
  `text-xs`/`neutral-700` and gains `· hatched = not in the source's table`, with hatched spans also
  joining the `sr-only` zone list; the description is back on every card; notes and the Try line move
  into the reading grid's left column.
- ⚠️ **The furniture budget's MEASURE moved, its number did not.** Still ≤ 50, but now excluding four
  blocks of borrowed words rather than one — mandatory notes, the description, a single range's
  legend label and an unbanded card's reason — on the rule that *a sentence this page did not get to
  write is not a sentence it can spend*. Measured maximum **41**. Cadence's visible count is **68**
  against its unchanged ≤ 70 (it was 55 before this round; the description and the legend are the
  13). Unbanded cards all fell 24–44%: `overstriding` **229 → 142** by the same jsdom instrument.
- 🛠 **`scalePalette.test.ts` reads `index.css` by a path resolved against the test file.** Two
  traps, both hit: `?raw` comes back EMPTY under this project's CSS transform, and
  `new URL('../index.css', import.meta.url)` is rewritten by Vite into an asset URL, so
  `fileURLToPath` throws `The URL must be of scheme file`. `dirname(fileURLToPath(import.meta.url))`
  then `join` works. (`import.meta.url` itself IS a `file:` URL here — an older comment saying
  otherwise was wrong about the reason, right about the symptom.)

