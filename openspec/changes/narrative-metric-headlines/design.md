# Design — narrative headlines above the fold

## D1 — Narrative without a verdict: why the grading prohibition needs no exception

The governing requirement of this capability is that no element grades the runner: not by colour,
not by a word such as good, poor, optimal or excessive applied to the runner's own value, not by an
icon, and the band carries no preferred end. The request that produced this change asked for
"well-founded opinions" — flagging a big bounce, naming what it costs, saying what to do about it.

Those two survive together because a headline is built from three things that are each already
true of the record, and none of which is a verdict:

| part | what it is | example |
|---|---|---|
| position | where the value fell, stated as a position | "11.2 cm, above the 6.0–9.5 cm range Malisoux measured across 860 runners" |
| consequence | a measured outcome attributed to the **quantity**, never to this runner | "Greater vertical oscillation raises oxygen consumption" (Moore 2016) |
| cue | a studied change, relative to the runner's own value, with its citation | "cueing yourself to stay as low to the ground as possible without slouching" (Adams 2018) |

The load-bearing distinction is the middle row. *"Greater vertical oscillation raises oxygen
consumption"* is a property of the quantity, sourced, and true whoever is reading. *"Your bounce is
excessive"* applies a grading word to this runner's value and is exactly what the requirement
forbids. A `consequence` sentence SHALL be of the first kind, and its subject is the metric.

**A reader will nonetheless infer a direction, and that is acceptable where the record supports
one.** Moore measured a cost to greater oscillation; a reader concluding that less is cheaper has
read the citation correctly. What the page must not do is assert it *about them*, print a target, or
shade a zone favourably. `EvidenceDirection` stays as it is — it still has no `'lower-is-better'`
member, and this change adds none.

**Selection is not grading either, but it is value-dependent, and that deserves naming.** A metric
enters the headline group partly because `tryLineApplies` says its cue points the right way from
where the value sits — so a value below its band withholds a "go lower" cue and loses its headline.
That is not a judgement about the runner; it is the refusal to give advice that would be wrong for
them, and it is behaviour this view already ships. It is recorded here because it reads at first
glance like ranking by the runner's numbers, which is separately forbidden — see D4.

## D2 — The consequence table, per metric

Built from links already in `metricGuidance.ts`, all verified during the original research pass. A
`consequence` may exist on a metric whose evidence is *contested* — a measured outcome is still a
measured outcome — so this table is wider than the headline-eligible set in D3.

| rank | metric | consequence available | source | notes |
|---|---|---|---|---|
| 1 | `cadence` | knee energy absorption fell ~20% and ~34% at +5% and +10% step rate; patellofemoral force fell 14%; dropping step rate 10% loaded every joint more | Heiderscheit 2011, Lenhart 2014 | must be worded as joint mechanics, not injury — see D6 |
| 2 | `verticalRatio` | **none** | — | `none-established`; its only remediation link is borrowed from the bounce family |
| 3 | `verticalOscillationCm` | greater vertical oscillation raises oxygen consumption | Moore 2016 | |
| 4 | `trunkLean` | per degree of forward lean, hip loading rose about three times as fast as knee loading fell | Braun 2024 | contested; no cue, so no headline |
| 5 | `kneeFlexion` | **none** | — | no intervention literature in the record at all |
| 6 | `overstriding` | closing foot-to-centre-of-mass from 9.2 cm to 7.0 cm is what cut knee load; a reduced step rate *is* overstriding | Heiderscheit 2011, Lenhart 2014 | same story as `cadence` — see D3 |
| 7 | `verticalOscillation` | greater vertical oscillation raises oxygen consumption | Moore 2016 | same story as `verticalOscillationCm` |
| 8 | `stepWidth` | narrower step width goes with greater hip adduction and knee internal rotation; modelled iliotibial band strain rises as width narrows | Wang 2024 | contested — crossover "may be normal in a healthy population" (Stiffler-Joachim 2020) |
| 9 | `stepWidthCm` | as `stepWidth` | Wang 2024 | |
| 10 | `footStrikePattern` | **resolve during implementation** | Burke 2021 / Bovalino 2021 | the redistribution claim in `EvidenceDirection`'s doc is not obviously carried by either link's summary. If no link states it, this stays `null` rather than acquiring a new citation |
| 11 | `kneeDrive` | **none** | — | no research links at all |
| 12 | `armSwingAmplitude` | **none** | — | no research links at all |

Non-null on seven (or six, pending D2's row 10), null on five. `metricGuidance.test.ts` already
names the seven unbanded entries by name so adding a band is a visible change; the null-consequence
set is pinned the same way, for the same reason.

**Every `consequence.url` MUST be one of that metric's own `research` or `remediation` links**, and
every number in the sentence must appear in that link's own `summary`. Both pinned by test, mirroring
the five rules already enforced on `tryLine`.

## D3 — Two stories, not four cards

Filtering by "has a `tryLine`" yields exactly four metrics — `cadence`, `verticalOscillationCm`,
`overstriding`, `verticalOscillation`. They are not four findings. They are **two**, each stated
twice:

- **step rate and stride geometry** — `cadence` and `overstriding`. The record already says so:
  design.md D8 of the original change has `cadence` deliberately carrying `overstriding`'s
  remediation links, because the evidenced intervention for overstriding *is* a step-rate increase.
- **bounce** — `verticalOscillationCm` and `verticalOscillation` are the same physical quantity in
  centimetres and as a fraction of torso length, fitted from the same spectral fit.

Left unhandled, the fold would carry two pairs of headlines saying the same thing in different
units, which reads as four problems. Each story therefore yields **at most one headline**.

**The spokesman is the lowest-`displayRank` eligible member of the story**, so `cadence` speaks for
the step-rate story where it resolved and `overstriding` speaks where it did not, and
`verticalOscillationCm` speaks for bounce ahead of `verticalOscillation`. Deterministic, and
independent of the runner's values.

**A story's non-spokesman members are not hidden.** They render below the fold in the group they
already occupy — this change promotes a representative, it does not suppress a metric.

Expected yield: **0, 1 or 2 headlines.** On `park-side-landscape`, `verticalOscillationCm` reads
4.42 cm against a 6.0–9.5 cm band with a `'lower'` cue, so `tryLineApplies` withholds it and bounce
yields nothing — one headline, not two. This is the correct outcome, and it is the reason the empty
state in D5 is not a rare path.

## D4 — Ordering is `displayRank`, never the runner's numbers

The existing record states that ranks 1–5 order the banded metrics by **strength of the evidence
behind the band**, explicitly not by how interesting the metric is and never by its value on the
clip, because "ranking by the runner's own numbers would make the page's structure a judgement about
the runner".

Headlines inherit that rule unchanged: they render in ascending `displayRank` of their spokesman. A
headline is **not** ordered by how far outside its band the value sits, by how large the value is, or
by how much room the cue implies. Two headlines therefore always appear in the same order.

## D5 — Zero headlines is a real outcome and gets an honest empty state

A clip can produce no headline at all: `park-approach` excludes almost everything at tier 3, and a
clip where every applicable cue is withheld produces none by construction.

The page SHALL NOT manufacture one — not by relaxing the filter, not by promoting a metric with no
cue, and not by inventing a sentence. It states that this clip produced nothing actionable and sends
the reader to the measurements below. The below-the-fold content is unchanged and complete, so
nothing is lost; the reader is told why the top of the page is quiet rather than left to wonder.

## D6 — `cadence`'s consequence must not contradict its own mandatory note

`cadence` carries a mandatory note stating that a review of 37 studies found "insufficient evidence
to determine the effects of changing running step rate on injury or performance" (Anderson 2022).
Heiderscheit and Lenhart measured **joint mechanics** — energy absorption, patellofemoral force —
not injury outcomes. A consequence sentence saying raising step rate "reduces injury" would
contradict the note rendered on the same card.

The sentence therefore names the measured mechanical quantity and nothing further, and the mandatory
note continues to render with it. This is the single highest-risk wording in the change and its test
asserts the absence of injury-outcome language specifically.

## D7 — What a headline renders

One headline is: the metric's name and value, its position relative to its band **where it has
one**, the consequence sentence with its citation, and the Try line with its citation. Two of the
four eligible metrics are unbanded, so the position line is optional by construction and a headline
must read correctly without it.

No new visual vocabulary: no colour with pass/fail semantics, no icon, no scale (the scale stays on
the card below), and the furniture budget discipline from the declutter change applies — a headline
is a few lines, not a restatement of the card.

## D8 — Rejected alternatives

- **A `direction` member on `EvidenceDirection`** (`'lower-is-better'`). Rejected: it would make the
  band carry a preferred end, which the spec forbids in terms, and it would have to be invented for
  metrics whose evidence is contested.
- **Headline selection by band position** ("show what is outside the range"). Rejected in favour of
  opportunity-first: `kneeFlexion` can be well outside its band with no intervention literature at
  all, so position-first surfaces the least actionable metric on the page. It also reads much more
  like grading than a cue-availability rule does.
- **Ranking headlines by distance outside the band.** Rejected — D4.
- **A generated summary paragraph across metrics.** Rejected: every sentence on this page is
  traceable to a verified citation, and a synthesised paragraph is the one place a claim could enter
  without one.
