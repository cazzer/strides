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
three of its clauses: the speed caveat becomes a tag plus disclosure content, the
first-sentence-of-each-note rule loses its visible "(continued below)" marker, and "the first few
remediation studies" becomes exactly one Try line. The rest of that clause — one disclosure per
card, every link's kind and summary reachable, no link dropped for sharing a URL — is untouched and
still holds.

⚠️ **It was four clauses. The fourth — the description leaving a banded card — was reversed by
review (D8.2) and D7.10 (e) is intact on that point.** The reasoning that dropped it was that a
scale, a headline naming the zone and a citation line have already said what the metric is. They
have not: `110° · within the range shown` never says 110° of what, and `verticalRatio`'s headline is
a percentile of a ratio whose two terms the reader has not been told. A scale says where a number
sits; only the description says what the number is.

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

Six tokens, each with a dark twin (twelve declarations), in `src/index.css`'s **`@theme static`**.

⚠️ **The reason recorded here for `static` was backwards, and is corrected in D8.4.** It claimed a
token read as `var(--color-scale-…)` inside an arbitrary value would be pruned away; compiled both
ways, those are the ones pruning keeps. There is no such usage left in any case (D8.1 replaced the
gradient with one flat utility), and a plain `@theme` was built and grepped: all twelve tokens reach
`dist/`. `static` stays as belt and braces, not as a fix for a named failure.

Measured contrast ratios (WCAG 2.x relative luminance, computed rather than eyeballed):

| pair | light | dark |
|---|---|---|
| most-populated zone vs track | **4.61** | **4.96** |
| marker vs least-populated zone | 14.68 | 12.16 |
| marker vs middle zone | 8.32 | 7.09 |
| marker vs most-populated zone | **3.89** | **3.66** |
| marker vs track | 17.93 | 18.16 |
| marker ring vs marker | 17.93 | 18.16 |
| gap hatching vs track | 7.81 | 7.85 |

⚠️ **The middle-zone row moved, 9.60 → 8.32**, because `--color-scale-zone-2` darkened from
`#86c8d6` to `#6fbccd` (D8.6). Every other row is untouched: the two floors do not involve zone-2.

The two floors that matter are the bolded ones: the marker has to stay visible on the darkest zone it
can land on (3.89 / 3.66, both over 3:1) and the darkest zone has to be distinguishable from bare
track (4.61 / 4.96). Seams are drawn in the marker's own colour, so they inherit its floor.

**A third property, added by review: the ramp has to be even.** Step to step the light ramp read
1.53 then 2.47 — the middle step was a variant of the lightest one and the jump to the darkest did
all the work. It now reads **1.76 then 2.14** (dark: 1.72 then 1.94), and a test holds the two steps
of each theme within a factor of two of each other. That is a property of the ramp, not a floor
against a mark, which is why it is stated separately from the table above.

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
  "30th–69th percentile", so it carries `zoneOwner: "of Garmin's table"`. `verticalRatio`'s labels
  already end in those same words, so its `zoneOwner` is `null` — appending an owner would produce
  "of Garmin's table of Garmin's table".
  ⚠️ **It read `"of Garmin's runners"` and was changed by review (D8.3)**: that card's own citation
  line, three lines below the headline, says Garmin publishes no population and no sample size, so
  "Garmin's runners" named a cohort nobody has described. The table is the thing that exists.
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

| metric | text | link | direction |
|---|---|---|---|
| `cadence` | a phone metronome 5–10% above your own step rate, 2–3 runs a week | Huber & Verhoff 2024 | `higher` |
| `verticalOscillationCm` | cueing yourself to stay as low to the ground as possible without slouching | Adams et al. 2018 | `lower` |
| `verticalOscillation` | cueing yourself to stay as low to the ground as possible without slouching | Adams et al. 2018 | `lower` |
| `overstriding` | a step rate 10% above your own, which brought the foot's landing closer to the body | Heiderscheit et al. 2011 | `lower` |

⚠️ **`cadence`'s text changed under review (D8.5)**: it ended "— the most-studied way to reduce
overstriding", which is `remediationIntro`'s claim, sourced to Heiderscheit and Lenhart, hanging off
a link to Huber, whose summary is only the protocol. The superlative still ships, in
`remediationIntro`, beside the two studies that measured it. A test now pins the compression
numerically — every number in a Try line appears in its own study's summary — where it previously
asserted only that the linked study has a non-empty summary, which every link does.

**`direction` is which way the line moves the quantity THAT CARD reports**, and it is what lets the
view withhold a line rather than point a runner further out of range. `overstriding`'s is `lower`
although its cue raises step rate: the cue is the means, overstriding is what the card reports and
what the study measured falling, 9.2 cm to 7.0 cm. A line is withheld only where the value is
outside the band on that side — `verticalOscillationCm` reads 4.42 cm on this repo's own side-view
clip against a 6.0–9.5 cm band, and the card told it to stay lower still. Inside the band, in a
published gap, or on a metric with no band, the line renders. Note an open-ended outer zone
(cadence's `<153`, `>183`) is INSIDE the band by construction, so cadence's line is never withheld:
a runner above Garmin's 95th percentile is in the band's top zone, not past its end.

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

## D8 — The review round: nine changes, and what they cost

Two reviews of the shipped branch, one code and one UX. Everything here is a change to what D1–D6
above specified, and each is stated there too rather than only here.

**D8.1 — A single published range is drawn FLAT.** It was a symmetric ramp: zone-2 → zone-3 at 20% →
zone-3 at 80% → zone-2, heaviest across the middle and easing at both ends. That is the universal
"optimal range" idiom — a unimodal hump reads as a distribution with a preferred centre — and it was
drawn on exactly the three cards that render no legend to correct it (`verticalOscillationCm`,
`trunkLean`, `kneeFlexion`). Their own data disclaims it: each carries `shareOfRunners: null`, and
`verticalOscillationCm`'s derivation statement, rendered on that same card, says *no percentile of
the combined cohort is claimed*. `shadeSteps`'s own doc calls claiming an unpublished distribution
"the one thing this scale may not do", and the `singleRange` branch went round it.

Flat, at the same one step a most-populated zone gets. **And the freed legend slot now names the
range**, in the source's own words — `Range across Folland's 97 runners` — so the headline's "within
the range shown" finally refers to something named. The gradient is deleted.

⚠️ That label can contain numbers (`verticalOscillationCm`'s names two percentiles, a cohort size
and a speed), and the spec's "at most three numbers" rule is therefore restated as being about the
TRACK. The rule's own rationale is boundary labels stacking a fraction of a unit apart; a caption
beneath the track is an attribution, is positioned against no mark, and may not author a number of
its own — which a test pins by requiring the legend's text to equal the band's own label verbatim.

**D8.2 — The description comes back, to every card.** See D1.

**D8.3 — `cadence`'s `zoneOwner` reads "of Garmin's table".** See D5.

**D8.4 — The `@theme static` rationale was backwards.** See D4.

**D8.5 — `cadence`'s Try line no longer carries a superlative it cannot cite.** See D6.

**D8.6 — Colour and legend legibility.** `--color-scale-zone-2` darkens `#86c8d6` → `#6fbccd`, for
the even ramp in D4. The legend moves from `text-[11px]` / `neutral-600` — the faintest text on the
card, explaining the one thing on it a reader cannot otherwise decode — to `text-xs` /
`neutral-700 dark:neutral-300`, and gains a clause for the hatching: *Darker = more runners ·
hatched = not in the source's table*. The hatching clause renders only where the band has a gap to
explain, and unlike the shading clause it is NOT hidden under forced colours, because hatching is
drawn in `currentColor` and survives a palette the user chose.

**Hatched spans also join the scale's text alternative**, unconditionally: `163 to 164 steps per
minute: not in the source's table`, in value order between the zones. Hatching is invisible to a
screen reader, and without this the list stepped from `153 to 163` to `164 to 173` with nothing
saying the values between are uncovered rather than merely unmentioned.

**D8.7 — Two negations collapse to one citation field.** `Garmin fenix 7 manual · population not
stated · sample size not published · derived` spends more than half its line, and the reader's whole
attention, restating one silence as two findings. It is now `population and sample size not
published`. Narrow by construction: a source that states a population keeps both fields.

**D8.8 — Layout.** The `·` between value and position is hidden below `sm`, where the position wraps
onto its own line and a leading middot reads as a bullet. The notes and the Try line move INTO the
reading grid's left column, which had been leaving 100–250 px of blank paper beside the 9 rem
evidence thumbnail. The Try line's citation is separated by ` · ` at the card's attribution size
rather than by an em dash at body size — the stored text can itself contain an em dash, and a second
one read as a further clause of the instruction. `<summary>` gains `py-1`.

**D8.9 — An unbanded card's reason is split like a note.** First sentence visible, the rest inside
the same disclosure everything else secondary is behind, named in the summary as *why there is no
range* so the continuation cannot end up behind a disclosure that would not otherwise exist. And
each of the seven leads was rewritten to answer "why is there no bar here" in ≤ 25 words, reader
first — `overstriding`'s was 101 words rendered whole on the card with the most to read already.
**No claim was dropped**: every lead is a compression, and the previous text follows it intact.

### What the round cost in words

Same instrument as D2 (card `textContent`, `<details>` subtree removed, screen-reader-only text and
the evidence figure excluded), measured in jsdom on `85e0f84` and on this branch:

| card | visible before | visible after |
|---|---|---|
| `cadence` | 55 | **68** |
| `kneeFlexion` | 18 | **36** |
| `trunkLean` | 39 | 56 |
| `verticalRatio` | 30 | 76 |
| `verticalOscillationCm` | 80 | 151 |
| `overstriding` | 229 | **142** |
| `verticalOscillation` | 115 | 76 |
| `stepWidth` | 208 | 139 |
| `stepWidthCm` | 252 | 153 |
| `footStrikePattern` | 96 | 66 |
| `kneeDrive` | 98 | 72 |
| `armSwingAmplitude` | 91 | 65 |

Banded cards grew — they are what gained a description and a legend — and every unbanded card fell,
by 24% to 44%, because its reason was split. `cadence` stays inside its 70-word budget at 68.

**The furniture budget's MEASURE moved; its number did not.** D2 held every banded card to 50 words
excluding mandatory notes, on the rule that *a sentence this page did not get to write is not a
sentence it can spend*. The same rule now excludes three more blocks of borrowed words: the
description (shared verbatim with the classic view; `verticalOscillationCm`'s is 53 words), a single
range's legend label (the source's own, 16 words on that card), and an unbanded card's reason. On
that measure the maximum is **41** against the same budget of 50. Left as it was, the budget would
have read 112 on `verticalOscillationCm` and failed for words this view did not author.
