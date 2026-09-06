# Design — surface a cross-clip metric disagreement

## D1. The chosen direction, and the two that were rejected before this change started

`strides-5hj`'s acceptance criterion offers three ways out: surface the disagreement, stop
tie-breaking by index order, or stop confidence saturating at 1.0. The user chose **surface it**.
The other two are not partially adopted here:

- **Not changing the tie-break.** Picking a different one of two answers is not more correct when
  one of them came from a fallback detector on a clip whose primary fit failed. It relocates the
  arbitrariness; it does not remove it.
- **Not changing confidence.** Making confidence encode which detector ran would move numbers on
  every clip and every metric that consumes `detectFootstrikes`, to fix a presentation problem.

## D2. The design constraint that decided everything: no magnitude threshold

The obvious implementation is a per-metric "materially disagrees by more than X". It was rejected
before it was written.

Twelve `MetricId`s in degrees, centimetres, steps/min, torso-ratios and dimensionless percents mean
twelve constants, each defensible only by the two clips it was tuned against. This repo has the
worked example: **the 4K area floor** (CLAUDE.md, "The 4K area floor cannot be re-derived"). A
threshold was measured, found to sit inside a factor-of-2.9 intra-clip squeeze with a factor-of-two
cliff on both sides, and the whole direction was abandoned rather than tuned — explicitly recorded
as *"do not re-litigate by picking a different number"*. A disagreement threshold picked to make
side-landscape and side-portrait light up would be the same mistake with a friendlier surface.

**The threshold-free substitute: surface where the losing clip would have given the reader a
DIFFERENT READING** — decidable from data already in the codebase, with no new constant.

## D3. What counts as a "reading", and the survey behind it

A reading is a **named category the value is already classified into by a band the metric owns and
ships**. Every one of the twelve was surveyed for one.

| MetricId | owns a value-keyed band? | verdict |
|---|---|---|
| `footStrikePattern` | **YES** — `classifyFootStrike` → `heel \| midfoot \| forefoot`, symmetric dead zone `footStrikeMidfootBandRatio = 0.05` | **COVERED** |
| `stepWidth` | boundary only — `stepWidth.ts` `if (value < 0)` → crossover-gait caveat, no named constant | declined, D4 |
| `stepWidthCm` | boundary only — `stepWidthCm.ts`, verbatim the same | declined, D4 |
| `cadence` | `isNearGridEdge` (module-private), 1.2–4.0 Hz ± one grid step | declined, D5 |
| `verticalOscillation` | no | nothing to compare |
| `verticalRatio` | no | nothing to compare |
| `verticalOscillationCm` | no | nothing to compare |
| `trunkLean` | no | nothing to compare |
| `overstriding` | no | nothing to compare |
| `kneeFlexion` | no | nothing to compare |
| `kneeDrive` | no | nothing to compare |
| `armSwingAmplitude` | no | nothing to compare |

Every "no" row was checked at source: their caveat branches key on `sampleSize`, `sinusoidR2`,
`viewFit`, `interpolatedFraction` and travel-direction knowledge — measurement-quality facts, never
the value's own magnitude. `trunkLean` and `overstriding` each switch an exemplar *caption* on
`baseIsHigh`, which compares two instants against the clip's own median, not the reported value
against any constant; that is not a band either.

**`footStrikePattern` is not merely the strongest case, it is qualitatively different: its card
value IS the word.** `MetricsPanel.formatValue` returns `"Heel strike (proxy)"`, never a number.
Two clips either side of the band therefore put two different *words* in the same slot — which is
"a different reading" in the most literal available sense.

## D4. Why `stepWidth`/`stepWidthCm`'s zero-crossing was weighed and declined

This is the closest call in D3. Both metrics genuinely own an interpretive boundary that the app
already commits to: below zero, the card carries *"This clip's footstrikes tend to cross the body's
midline (crossover gait)…"*. Mirroring it would have taken coverage from 1 metric to 3.

Declined, for two reasons that compound:

1. **No dead zone.** The boundary is exactly `0` with no band around it. A value indistinguishable
   from zero flips the reading on noise — and this corpus supplies the example: `overstriding` reads
   `-0.00809497` on side-portrait against `+0.512135` on side-landscape. A sign rule fires there on
   0.008 of a torso, and stays silent on two same-signed readings a whole torso apart. `strides-5hj`
   named this failure mode directly.
2. **The phrase is an annotation, not the reading.** These cards' value line stays a number; the
   crossover sentence sits beside it. Contesting a number with a category is a category error, and
   contesting the number itself is D2's forbidden magnitude threshold wearing a hat.

A metric gains coverage here by growing a real classifier — which would be a change to that
metric's own module, reviewed on its own terms — not by having the fusion layer infer one.

## D5. Why `cadence`'s `isNearGridEdge` is not a band either

It is a boolean over the fitted frequency's distance from the search grid's ends. It answers *"is
this value near the limit of what we can measure"*, not *"what kind of value is this"*: two clips
60 steps/min apart share its verdict, and two clips one grid step apart can differ on it. It also
never reaches the card as a category — it selects one caveat sentence. Different question.

## D6. Eligibility: reuse the panel's own display gate

A losing clip contests only where `metricTier(candidate) !== 'excluded'`
(`src/results/metricConfidence.ts`), and the winner must clear the same bar.

That gate is `value === null || viewFit === 'unsuitable'`. Both exclusions are load-bearing rather
than tidy-minded:

- **Null value**: there is no reading, and `strides-5hj` requires two clips to have actually
  resolved a value.
- **`viewFit: 'unsuitable'`**: `front-approach` is a front-view clip, and `footStrikePattern` is
  side-view-gated there. The panel already refuses to show that reading on its own. Quoting it back
  at the reader as a contradiction of a reading the panel *does* show would be worse than silence —
  it would manufacture a disagreement out of a measurement the app has already disowned.

An excluded WINNER short-circuits the whole check: there is no number on screen to be contested.

This gate is an existing function with an existing meaning, reused. It is not a new constant.

## D7. Message design

Rendered on the real three-clip demo session, `footStrikePattern`:

> Foot strike pattern is an approximation based on ankle position relative to the knee at
> footstrike, not a direct measurement of foot-ground angle. Treat the heel/midfoot/forefoot label
> as a rough indicator, not a clinical classification. Combined from clip 1 of 3. The clips
> disagree: clip 2 read a forefoot strike. Nothing here settles which clip is right.

Four properties, each deliberate:

- **It says what the other clip read**, not merely that a disagreement exists. A reader who cannot
  see the other number cannot act.
- **It names no winner.** "Which reading is closer to the truth is not established" is the literal
  epistemic state: one clip's footstrikes came from the fitted hip-bounce phase and the other's from
  the retained ankle-difference fallback, and there is no ground truth for this footage. (The
  corrected Demo 1 onsets from `strides-dly` are for retired footage and do not transfer.)
- **It composes.** It is appended last, space-joined, by the same `.filter(Boolean).join(' ')` the
  provenance sentence already rides on. `strides-pr1`'s unconditionally non-null `overstriding`
  caveat is untouched and cannot interact: `overstriding` owns no band, so it never receives this
  sentence.
- **Clip numbers are bare** ("clip 2", not "clip 2 of 3") because the provenance sentence
  immediately before has already established "of N". Multiple disagreeing clips are listed, each by
  number and reading.

## D8. Verification

**Negative control — the standard single-clip A/B must be byte-identical.**
`scripts/ab-person-selection.mjs` runs one clip per arm, and fusion of one result returns
`results[0]` by reference before `pickMetric` is ever called, so this change is structurally
invisible to it. That is exactly what makes it the right instrument for "no computed value moved":
any difference beyond `elapsedMs` would mean something leaked outside the fusion caveat.

Measured, `--arm 'base={}' --clips side-landscape,side-portrait,front-approach --trials 3
--evidence`, fresh Chromium per trial, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), dev server
started and identity-verified by each run, 611 lines each: **3 differing lines, all `elapsedMs`**,
one per clip. The `elapsedMs`-stripped body md5 is `56fea3d4ad358c1ef0294c52025beeb1` on BOTH
sides — nothing in `metrics.*`, `sampling.*`, `personSelection.*`, `view.*` or `evidence.*` moved.

Two verification notes worth keeping:

- **`strides-ef5` bit during this run.** `grep -v '^elapsedMs' | md5` returned two *different*
  digests through this machine's summarizing wrapper; the same computation through
  `rtk proxy sh -c "sed '/^elapsedMs/d' … | md5"` returned one identical digest. Do not trust a
  filtered pipeline's answer on this gate — re-run it raw.
- **The header's `# commit:` stamp cannot separate these two reports** (both read `4436b8b`),
  because neither run was committed. What separates them is that `before.txt` was captured on the
  clean tree and `after.txt` after the edits, in the same worktree, at the same derived port
  (5321), with the nonce identity check passing on both.

**Positive control — a real three-clip session, read out of the DOM.** The single-clip A/B cannot
observe the feature at all, so the caveat was confirmed by driving the *Demo (3 clips)* button and
reading `article.metrics-panel__card[aria-label="Foot strike pattern"]`'s `[role="note"]` text out
of the DOM, not by inferring it. Same port, identity verified, `ANGLE Metal Renderer: Apple M4 Pro`.

Eleven cards rendered. `footStrikePattern` read **"Heel strike (proxy)"**, High confidence, tier
`normal`, with:

> Foot strike pattern is an approximation based on ankle position relative to the knee at
> footstrike, not a direct measurement of foot-ground angle. Treat the heel/midfoot/forefoot label
> as a rough indicator, not a clinical classification. Combined from clip 1 of 3. **The clips
> disagree: clip 2 read a forefoot strike. Which reading is closer to the truth is not
> established.**

Three confirmations in that one reading:

1. **Clip 2 only.** Clip 3 is `front-approach`, whose `footStrikePattern` is `viewFit: 'unsuitable'`
   — D6's eligibility gate correctly declined to quote it.
2. **`overstriding` is untouched and does not run on.** Its card carried `strides-pr1`'s
   unconditional sentence plus `Combined from clip 1 of 3.` and nothing else, despite reading
   **51.2% of torso length** against side-portrait's ~0%. That is the D3/D4 rule holding: no band,
   no claim.
3. **No other card gained a sentence.** The other ten carry exactly the caveat text they carried
   before.
