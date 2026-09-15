# Design — declutter the guided results view

Eight changes, chosen by the user from a longer list. **Improvements not on that list are
deliberately not made here**: the lower two groups stay visible rather than hidden, published gaps
keep their hatching, and cards keep their frames. Each was considered and each is somebody else's
change.

## D1 — What this reverses, and why that is legitimate

Two decisions in the shipped change are partly superseded, both deliberately and both at the user's
request after reading the shipped page.

**D1 of the archived change** — *"a band renders only with its source, population and sample size
visible on screen — not in a tooltip, not behind a disclosure, not in a footnote"* — is **narrowed,
not abandoned**. The attribution stays on screen: who published it, over roughly whom, at what
sample size, and whether this system did arithmetic on them. What moves into the disclosure is the
source's own *full* population sentence, which for Garmin is 210 characters of methodological
absence:

> Not stated. Garmin says only that it "has researched many runners of all different levels"; no
> protocol and no peer review are published.

The load-bearing property that paragraph defends is that **a reader can tell a cited number from an
invented one without clicking**. `Garmin fenix 7 manual · population not stated · sample size not
published` discharges that completely — arguably better than the three-row definition list did,
because it is read rather than skimmed past. The full sentence is a *detail of* an attribution the
reader has already seen, not the attribution itself.

**D7.10 (e)** of the archived change, which enumerated what stays visible per card, is superseded in
four of its clauses: the description leaves banded cards, the speed caveat becomes a tag plus
disclosure content, the first-sentence-of-each-note rule loses its visible "(continued below)"
marker, and "the first few remediation studies" becomes exactly one Try line. The rest of that
clause — one disclosure per card, every link's kind and summary reachable, no link dropped for
sharing a URL — is untouched and still holds.

**What is NOT reversed.** Nothing about what the page is allowed to *claim*: no grading word, no
verdict, no invented number, no preferred end on a band, no target. The 8 changes are about how much
of the true material is on screen at once and how the true material is drawn.

## D2 — The measured problem

Word counts, card `textContent` with the `<details>` subtree removed and screen-reader-only text
excluded, whitespace-split, measured against `park-side-landscape.mp4` on `d6a05c2` and on this
branch through the identical harness:

| card | before | after |
|---|---|---|
| `cadence` | **332** | **55** |
| `trunkLean` | 201 | 39 |

⚠️ **`cadence`'s "before" is 332, not the 363 this change was scoped against.** Both were measured
honestly; they differ because this one excludes screen-reader-only text, which the earlier reading
appears to have counted. The 363 is left as the scoping figure it was, and 332 is the number to
compare 55 against — the two measures are only comparable to themselves.

The budget set for this change: **`cadence` ≤ 70 visible words.** It is the worst card and the one
the user named; it is the only one carrying a remediation intro, two speed halves and a 90-word
mandatory note.

**A second budget, on the card's own furniture: ≤ 50 words for every banded card**, with the
mandatory notes excluded from the count. A mandatory note's first sentence is the SOURCE's sentence
and its length is not the card's to spend — `verticalOscillationCm`'s is **51 words in one sentence**
and cannot be shortened without editing a claim, which is why that card reads 80 in the measure above
and is not a failure. Splitting the two is what makes the budget measure this change's own work.

The legibility problem is a contrast ratio. `bg-neutral-300` against `bg-neutral-400` is **1.22:1**;
`dark:bg-neutral-600` against `dark:bg-neutral-500` is **1.29:1**. A five-zone table drawn in two
tints that far apart is a solid bar.

## D3 — Share of runners: the arithmetic, and where it may not be taken from

Garmin publishes percentile **cut points**, and the zones are the intervals between them. For
cadence the cut points are 5 / 30 / 70 / 95:

| zone | percentile span | share |
|---|---|---|
| `Below the 5th percentile` | 0 → 5 | 0.05 |
| `5th–29th percentile` | 5 → 30 | 0.25 |
| `30th–69th percentile` | 30 → 70 | 0.40 |
| `70th–95th percentile` | 70 → 95 | 0.25 |
| `Above the 95th percentile` | 95 → 100 | 0.05 |

Sum 1.00 exactly. `verticalRatio`'s zones are the same table read in the opposite direction
(design D3 of the archived change), so its shares are the same five numbers in the same value order:
0.05 / 0.25 / 0.40 / 0.25 / 0.05.

⚠️ **The shares are derived from the CUT POINTS, never from the restated integer labels.** Reading
`5th–30th`, `31st–70th`, `71st–95th` as spans and summing gives **1.01** — the restatement writes
half-open intervals as inclusive integers, and the extra point is a rounding artefact of English, not
a property of the table. Deriving from the labels would put a 1% error into a number rendered as a
shade.

**A single-range band publishes no share and gets `null` on its one zone.**
`verticalOscillationCm` is the one that has to be checked rather than assumed: its derivation says in
so many words that *"no percentile of the combined cohort is claimed"* — it runs from women's P10 to
men's P90, which is not 80% of anything. `trunkLean` and `kneeFlexion` are observed ranges, not
percentile spans, so likewise `null`.

`shareOfRunners` is therefore all-or-none per band, and a test pins both that and the sum.

## D4 — The colour, and why one hue family

Six tokens, each with a dark twin (twelve declarations), in `src/index.css`'s **`@theme static`** —
static because two of them are read as `var(--color-scale-…)` inside an arbitrary gradient rather
than through a `bg-*` utility, and a usage-pruned theme drops exactly those, leaving a transparent
band with nothing failing. Measured contrast ratios (WCAG
2.x relative luminance, computed rather than eyeballed):

| pair | light | dark |
|---|---|---|
| most-populated zone vs track | **4.61** | **4.96** |
| marker vs least-populated zone | 14.68 | 12.16 |
| marker vs middle zone | 9.60 | 7.09 |
| marker vs most-populated zone | **3.89** | **3.66** |
| marker vs track | 17.93 | 18.16 |
| marker ring vs marker | 17.93 | 18.16 |
| gap hatching vs track | 7.81 | 7.85 |

The two floors that matter are the bolded ones: the marker has to stay visible on the darkest zone it
can land on (3.89 / 3.66, both over 3:1) and the darkest zone has to be distinguishable from bare
track (4.61 / 4.96). Seams are drawn in the marker's own colour, so they inherit its floor.

**One hue family (a desaturated cyan-teal), three steps.** Not two hues, not a ramp through a second
hue: two hues would invite reading one as favourable, which is exactly the thing the band may not do.
Teal was picked because it is the furthest available family from both the forbidden set
(red/green/amber/emerald/lime/orange/rose/yellow, all of which carry pass/fail semantics in this
app's own spec) and from brand orange, which is reserved for interactive elements.

**The legend flips word in dark mode** — *"Darker = more runners"* light, *"Brighter = more runners"*
dark — because the ordering genuinely inverts: on a near-black track the most-populated zone has to be
the *brightest* to clear its contrast floor, and a legend saying "darker" on a page where the
most-populated zone is the lightest thing on the track would be false. Both spans ship, one hidden
per scheme, and both are hidden under forced colours where neither is true.

**The step is a RANK, not the share itself.** Shares `[0.05, 0.25, 0.40, 0.25, 0.05]` have three
distinct values, so the steps are the first, second and third of three — `[0, 1, 2, 1, 0]` as
`shadeSteps` indexes them into `ZONE_SHADES`, which is `zone-1 / zone-2 / zone-3` in the token names.
Symmetric, which is the point: the two tails are equally rare and are drawn identically. Mapping the share to an opacity instead would make 0.05
nearly invisible and would imply a continuum the source does not publish.

## D5 — The headline, and the one place it has to be careful

`describeBandPositionBriefly(band, value)` produces the fragment after the `·`. Three shapes:

- **In a zone**: the zone's label with its first letter lowercased, plus the band's `zoneOwner` where
  the labels do not already say whose table it is. `cadence`'s labels are Garmin's own and say only
  "30th–69th percentile", so it carries `zoneOwner: "of Garmin's runners"`. `verticalRatio`'s labels
  already end "of Garmin's table", so its `zoneOwner` is `null` — appending an owner would produce
  "of Garmin's table of Garmin's runners".
- **A single range**: `within` / `below` / `above the range shown`. Never the range's own label,
  which for `verticalOscillationCm` is a 90-character sentence naming two percentiles of two sexes.
- **A gap**: the two zone labels merged where they share a tail — `between the 5th–29th and 30th–69th
  percentiles of Garmin's runners` — and quoted whole where they do not. The merge is what keeps a
  gap headline to one line; the fallback exists because no rule should depend on two labels happening
  to rhyme.

The value half is `formatMeasuredBandValue`, unchanged, which already adds the extra precision that
stops `163.5` printing as `164` directly above a sentence saying it is in the gap *before* 164.

**`guidedHeadline` stays value-only.** The contents list at the top of the page prints one value per
row in a three-column grid; a position fragment there would wrap every row.

## D6 — Try lines: what they may say, and the four that ship

A Try line is one sentence, ≤ 100 characters, stating a change **relative to the runner's own
value**, linking a study already in that metric's own `remediation` list. It is not a new claim: each
is a compression of the linked study's own summary, which is already on the card.

| metric | text | link |
|---|---|---|
| `cadence` | a metronome 5–10% above your own step rate — the most-studied way to reduce overstriding | Huber & Verhoff 2024 |
| `verticalOscillationCm` | cueing yourself to stay as low to the ground as possible without slouching | Adams et al. 2018 |
| `verticalOscillation` | cueing yourself to stay as low to the ground as possible without slouching | Adams et al. 2018 |
| `overstriding` | a step rate 10% above your own, which brought the foot's landing closer to the body | Heiderscheit et al. 2011 |

The other eight are `null`, each for a reason:

- `verticalRatio` — nothing in the record reports an intervention on the *ratio*; its one remediation
  link targets the numerator, and is already the `verticalOscillation` line.
- `trunkLean` — `evidenceDirection: 'contested'`. Four outcomes point in different directions; any
  Try line would pick a side.
- `stepWidth`, `stepWidthCm` — contested, and the injury link is modelling-only in uninjured runners.
- `kneeFlexion` — `remediation` is empty; no intervention literature surfaced.
- `footStrikePattern` — `remediation` is **empty by finding**, not by omission: the best available
  systematic review rates the injury link as low evidence, so there is nothing to change toward.
- `kneeDrive`, `armSwingAmplitude` — nothing surfaced at all.

"5–10% above your own step rate" is a change from wherever the runner is, so it is not a target; the
number is the *size of the change the study made*, which is what the study measured. A test pins the
metric set by name, so adding a fifth Try line is a deliberate act.

## D7 — What this does NOT claim

1. **The shading is not a target.** The darkest zone is the most common zone. Most is not best: the
   same table says 40% of runners are there, and says nothing about whether they should be.
2. **A Try line is a studied change, not a prescription.** It names what a study did and what it
   measured, to one runner's own baseline. The strongest review in this record still reports
   insufficient evidence that changing step rate affects injury or performance at all — which is why
   cadence's mandatory note, saying exactly that, stays on screen even under a 70-word budget.
3. **Nothing here is a new source.** No URL, no title, no population, no sample size and no numeric
   claim is added. `populationShort` is a compression of `population`; each Try line is a compression
   of a summary already rendered.
4. **The word counts are a budget, not a measurement of quality.** 70 words that answer the question
   beat 363 that bury it, but the change is that the 293 moved behind one disclosure — they were not
   deleted, and a reader who wants them is one click away.
