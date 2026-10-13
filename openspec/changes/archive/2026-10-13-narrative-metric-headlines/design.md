# Design — running-economy headlines

Rewritten 2026-10-13 to the plan approved after `strides-1ce` (Option A). The first draft's D1–D8
are superseded where noted; its decisions that survive are restated here rather than referenced.

## D1 — The field: `economyConsequence`, on two metrics

```ts
economyConsequence: { text: string; url: string; costlySide: 'below' | 'above' } | null
```

Non-null on exactly `cadence` (`'below'`) and `verticalOscillationCm` (`'above'`); null on the other
eleven, and the null set is named one metric at a time in `metricGuidance.test.ts`, so a third is a
reviewable diff.

Those two are the only quantities in the record with an economy association that is (a) significant,
(b) stated between runners in a pooled analysis, and (c) in the unit this app reports.

## D2 — The source: Van Hooren et al. 2024, checked against its correction

`VAN_HOOREN_2024_LINK` (`https://pmc.ncbi.nlm.nih.gov/articles/PMC11127892/`, peer-reviewed),
opened 2026-10-13. Abstract: 51 studies, n = 1115. Table 2, pooled correlations with oxygen or
energy cost:

| row | k | n | r (95% interval) |
|---|---|---|---|
| Cadence (step frequency) | 37 | 593 | −0.20 (−0.35 to −0.05) |
| Vertical oscillation | 23 | 317 | 0.35 (0.19 to 0.49) |
| Vertical oscillation normalised for step length | 2 | 24 | 0.20 (−1.00 to 1.00), not significant |

**The 2025 correction** (Sports Med 2025;55(3):779, PMC11985672) was opened too. It replaces Fig. 8
— the review's schematic summary of associations — for "two minor errors", and states no change to
any pooled number. Every number above is Table 2's, and the Discussion restates r = −0.20 and
r = 0.35 and the k = 2 caveat in its own text. Nothing was dropped.

The link's summary carries every number either sentence quotes, and the test enforces that each
number in `text` appears in that summary.

**`verticalOscillation` (torso-normalised) is null.** The review's only normalised row is
normalised to STEP length, over two studies, and not significant; nothing reports bounce per torso
length. Borrowing the absolute-distance row for a different unit is exactly the import the "a band is
cited or it does not ship" rule refuses for bands.

### Copy

- cadence: *"Across runners, a higher step rate goes with a slightly lower energy cost — a
  correlation of −0.20 over 37 studies, an association rather than the effect of changing it."*
- verticalOscillationCm: *"Across runners, less vertical oscillation goes with a lower energy cost
  — a correlation of 0.35 over 23 studies, measured as a distance."*

Both open "Across runners"; neither says "you", uses a causal verb (raises, reduces, causes,
improves), a grading word, or anything about injury. Pinned by test.

**Cadence's sentence does not contradict its mandatory note.** The note says a review found
insufficient evidence that *changing* step rate affects injury or performance; this sentence is a
between-runner association with energy cost and says it is not the effect of changing.

## D3 — Supersedes the first draft's D2: joint-load consequences are out

The first draft gave seven metrics a `consequence` built from Heiderscheit, Lenhart, Braun and
Wang — joint mechanics, not economy. The user's question was efficiency, and mixing two outcome
families in one headline section would let a reader take a knee-load finding for an economy one.
Dropped. The economy consequence renders **only in the headline**, never on a card, so the cards are
unchanged.

## D4 — The trigger: strictly beyond the outermost finite bound on the costly side

One rule for both stories (`pastCostlySide`): the value lies strictly beyond the band's outermost
finite bound (`bandBounds`) on `costlySide`.

- cadence: below 153 — Garmin's 5th-percentile cut. 153 itself is in `153–163` and does not trigger.
- verticalOscillationCm: above 9.5 cm — the top of Malisoux's derived range. 9.5 does not trigger.

The band is still an observed range. The trigger names the outermost position in the cited
population on the side the association points away from — a statement about where the reading sits
and what a published association says about that side, not a target. Note cadence's `<153` zone is
*inside* the band (`locateInBand` says `inZone`), so "outside the band" would never fire for it; the
outermost finite bound is the rule that treats both stories alike.

**`costlySide` is the opposite of `tryLine.direction`'s side** (cadence's cue raises, costly side is
below; bounce's cue lowers, costly side is above), pinned by test — so whenever a headline fires, the
card's studied-change line points back toward the band and `tryLineApplies` lets it render.

**The pace confound.** Cadence climbs within a runner with speed, and this app cannot measure speed.
It is mitigated, not removed: every headline carries the "Varies with pace" tag, and cadence's first
mandatory-note sentence — "180 steps per minute is not a target." — renders in the headline.

## D5 — Supersedes the first draft's D3: one fixed spokesman, no fallback

| story | spokesman | members (never speak) |
|---|---|---|
| step rate | `cadence` | `overstriding` |
| bounce | `verticalOscillationCm` | `verticalOscillation`, `verticalRatio` |

The first draft let `overstriding` speak when `cadence` did not resolve. That fallback is gone: the
members carry no economy consequence, and a fallback would let a missing measurement change which
claim the page makes. A story whose spokesman is not measured yields no headline, and the empty state
names it.

## D6 — Order is `displayRank`, never the readings (first draft's D4, unchanged)

Headlines sort by the spokesman's `displayRank` — cadence (1) before verticalOscillationCm (3) —
never by distance past the bound or by magnitude. Two headlines always appear in the same order.

## D7 — Only the banded group triggers

A spokesman triggers only from the banded group. A withheld band (missing provenance) puts it in the
unbanded group, an excluded tier in the not-measured group; neither triggers. A position against a
band the page will not show is a position the reader cannot check.

## D8 — Supersedes the first draft's D8: position-based selection is now the rule

The first draft rejected "headline selection by band position" as reading too much like grading and
as surfacing unactionable metrics. **The user overrode that on 2026-10-13 (`strides-1ce`)**: a
headline is wanted exactly where a reading sits at the far edge of the cited population on the side
economy research points away from. The two objections are answered by construction, not by
argument: only two metrics can fire, both carry a cited association and a studied change, and the
selection is a published threshold rather than this app's judgement. Ranking by distance stays
rejected (D6).

## D9 — Rendering

- `<section class="guided-results__headlines" aria-labelledby>` with h2 "Running economy", first child
  of `GuidedMeasurements`, so it sits after the `role="status"` completion line (unchanged) and before
  the contents list.
- Each headline is a labelled `role="group"` `<div>` — not an `<article>`, so the cards' role and
  accessible names are unchanged — with an h3 of the metric label, then: value · self-contained
  position + "Varies with pace"; the band's citation line; consequence · Van Hooren et al. 2024
  (linked); the first sentence of each mandatory note; `TryLine` where `tryLineApplies`; and a link —
  "Open its card" (step rate) or "All three bounce measures" (bounce, to `#guided-bounce-heading`,
  the existing introduction; no parallel grouping). The bounce heading gains `tabIndex={-1}` so that
  link can move focus.
- **A self-contained position**: the card's headline says "above the range shown", which leans on a
  scale; here there is none, so `describeBandPositionStandalone` names the range — "above the 6.0–9.5
  cm range". A zone label with its owner ("below the 5th percentile of Garmin's table") already names
  its table and reads as on the card.
- `TryLine`, `CitationLine` and `ExternalLink` are exported from `GuidedMetricCard.tsx` unchanged and
  reused. No new colour, no icon, no scale, **no evidence canvas** — a node has one parent, and the
  card owns its imagery.

### Empty state

> No headline for this clip. One appears only when step rate reads below the 5th percentile of
> Garmin's table or bounce reads above 9.5 cm — where running-economy research points one way.
> [Neither reading is past that point here. | {names} could not be measured on this clip.] That is a
> position, not a grade. Every measurement is below.

**Deviation from the approved copy:** the plan had "— the two positions where running-economy
research points one way". As written that is 53 words in the "could not be measured" variant against
the plan's own ≤ 50 budget; dropping "the two positions" brings both variants to 50 and 49 (counting
tokens that carry a letter or digit, metric names excluded as labels). The thresholds are derived from
the bands (`costlyThreshold`), not typed in.

### Deviation: the card's confidence label and caveat ride along

The approved headline contents did not list them. The live run showed why they are needed:
`park-approach.mp4`'s grafted `verticalOscillationCm` reads 10.49 cm and triggers the bounce headline,
but its card is tier `caveated` — "Low confidence", with a caveat that the bounce rhythm was not steady
and scale was measured in 89% of frames. A headline that dropped those would read more certain than
the card it summarises. So a headline renders `ConfidenceLabel` (now exported from
`GuidedMetricCard.tsx`; the card renders the same component, identical output) when the tier is
caveated, and the metric's own caveat. Both are pipeline text, not page-authored copy.

## D10 — What the grading prohibition still forbids, and why it needs no exception

A headline is a position plus a between-runner association whose subject is the quantity. It names no
target, grades nothing, shades nothing. The trigger chooses *whether* to speak, not *what to call*
the runner, and its threshold is a published cut, not a preferred value. Pinned by the existing
no-grading tests over the whole view and by new ones over the section's own furniture.

## Verification record (2026-10-13)

- `npx tsc -b`, `npx eslint .`, `npx vite build` clean; `npx vitest run` 110 files, 2337 tests, all
  passing. The diff against `042dd5b` touches nothing under `src/pose`, `src/heuristics`, sampling
  or workers.
- Live, `?view=guide`, derived port 5368, identity verified, `ANGLE Metal Renderer: Apple M4 Pro`,
  one fresh Chromium per clip, one upload per clip, waiting for the scale pass to be terminal. Same
  text at 1280 and 390 px, light and dark, and under forced colours; no horizontal overflow; the
  section precedes the contents list and holds no canvas.

| clip | completion line | section |
|---|---|---|
| `park-side-landscape.mp4` | added 1 more metric | empty — "Neither reading is past that point here." |
| `park-side-portrait.mp4` | couldn't add the extra metrics | empty — "Cadence and Vertical oscillation (cm) could not be measured on this clip." |
| `park-approach.mp4` | added 1 more metric | one headline: Vertical oscillation (cm), 10.5 cm · above the 6.0–9.5 cm range, Low confidence with its caveat |

The first draft expected `park-approach` to be empty; the grafted centimetre bounce (10.49 cm, tier
`caveated`) now triggers the bounce story, which is what made the confidence deviation above
necessary.
