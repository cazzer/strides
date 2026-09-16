# Tasks

## 1. Data layer

- [x] 1.1 `src/guidance/types.ts`: add `BandSource.populationShort` (right after `population`),
      `BandZone.shareOfRunners`, `ReferenceBand.zoneOwner`, `MetricGuidance.tryLine`.
- [x] 1.2 `src/guidance/metricGuidance.ts`: `populationShort` on all six sources; `zoneOwner` on the
      five bands; `shareOfRunners` on every zone; `tryLine` on all twelve entries.
- [x] 1.3 `src/results/guidedGroups.ts`: `sourceHasProvenance` also requires `populationShort`.
- [x] 1.4 `metricGuidance.test.ts`: shares sum to 1; all-or-none per band; cadence's shares follow the
      cut points; verticalRatio's are Garmin's reversed; `tryLine.url` ∈ that metric's remediation;
      the Try-line metric set pinned by name; Try text ≤ 100 chars and free of grading words;
      `populationShort` ≤ 40 chars, no digits, no pace.

## 2. Pure presentation layer

- [x] 2.1 `src/guidance/bandPosition.ts`: `describeBandPositionBriefly`.
- [x] 2.2 `bandPosition.test.ts`: the 13-row expected-output table.
- [x] 2.3 `src/results/formatGuidedValue.ts`: `guidedHeadlineParts`; `guidedHeadline` unchanged.
- [x] 2.4 `formatGuidedValue.test.ts`: parts split correctly; contents-list headline stays value-only.
- [x] 2.5 `src/results/guidedGroups.ts`: `cardReferences` → one `tryLink` + all other remediation
      deferred; drop `VISIBLE_REMEDIATION_LIMIT`; add `citationText`.
- [x] 2.6 `guidedGroups.test.ts`: at most one visible link; citation line shape for a study source and
      for a source with no published sample size; derived bands say so.

## 3. Colour

- [x] 3.1 `src/index.css`: eight scale tokens with dark twins.
- [x] 3.2 A test reading `src/index.css` and asserting the design.md D4 contrast table.

## 4. View layer

- [x] 4.1 `src/guidance/MetricScale.tsx`: share-ranked zone shading, legend, outer-bounds-only
      numbers, seams at every interior bound; remove `staggerRows`, merged gap labels, `ZONE_TINTS`
      and the `BOUND_LABEL_*` constants.
- [x] 4.2 `MetricScale.test.tsx`: exactly `{envelope min, envelope max, value}` printed; seam per
      bound; identical shares shade identically; single range shades with no legend.
      ⚠️ The last clause is reversed by 6.1: a single range is flat and its legend names the range.
- [x] 4.3 `src/results/GuidedMetricCard.tsx`: headline row, pace tag, citation line, Try line, no
      description on banded cards, everything else into the one `<details>`.
      ⚠️ The description clause is reversed by 6.9: it is back on every card.
- [x] 4.4 `src/results/GuidedResultsView.tsx`: drop the three group intro paragraphs.
- [x] 4.5 `GuidedResultsView.test.tsx`: pace tag iff `speedSensitivity`, across all twelve; no
      description on a banded card; ≤ 1 Try link per card; cadence's visible word count ≤ 70.
      ⚠️ The description clause is reversed by 6.9; the word budget still holds, at 68.

## 5. Verify

- [x] 5.1 `npx tsc -b`, `npm test`, `npm run lint`, `openspec validate --all --strict`.
- [x] 5.2 `npm run build`, then grep `dist/` for a scale token to prove Tailwind kept it.
- [x] 5.3 Live check per CLAUDE.md's harness: 390 and 1280, light and dark, plus forced colours; read
      the screenshots.
- [x] 5.4 Update CLAUDE.md's guided-view notes to match.

## 6. Review round 1 (design.md D8)

- [x] 6.1 `MetricScale.tsx`: a single published range is flat, and the freed legend slot names the
      range in the source's own words; the gradient is deleted. Spec: the three-number rule is about
      the track, and a caption may quote a label but may author no number.
- [x] 6.2 `types.ts` / `metricGuidance.ts` / `guidedGroups.ts` / `GuidedMetricCard.tsx`:
      `tryLine.direction`, and `tryLineApplies` withholds a line that points further out of the band.
      Tests: both suppression branches and the inside-band case, at the real 4.42 cm value.
- [x] 6.3 `metricGuidance.ts`: cadence's `zoneOwner` reads "of Garmin's table"; its Try line drops a
      superlative sourced to two other studies.
- [x] 6.4 `metricGuidance.test.ts`: the compression test asserts the relationship it claims (every
      number in a Try line is in its own study's summary; no superlative); `verticalRatio`'s shares
      are asserted against cut points, with the 1.01 label reading pinned as the trap it is.
- [x] 6.5 `index.css` + `scalePalette.test.ts`: the `@theme static` rationale corrected in all three
      places (CLAUDE.md included), the CSS read by a path resolved against this file, zone-2 darkened
      to `#6fbccd`, and every ratio re-derived.
- [x] 6.6 `guidedGroups.ts`: the Try link's URL uniqueness is structural (`!claim(url)` withholds the
      line); `guidedGroups.test.ts` flipped from pinning the double-anchor state.
- [x] 6.7 `guidedGroups.ts`: two adjacent absences collapse to one citation field.
- [x] 6.8 `metricGuidance.ts` + `GuidedMetricCard.tsx`: every unbanded metric's `noBandReason` leads
      with ≤ 25 reader-first words and is split like a note, the rest inside the disclosure.
- [x] 6.9 `GuidedMetricCard.tsx`: the description returns to every card; the `·` hides below `sm`;
      notes and the Try line move into the reading grid's left column; the Try line's citation is
      ` · ` at attribution size; `<summary>` gains `py-1`; `MetricScale.tsx`'s legend is promoted and
      gains the hatching clause, and hatched spans join the text alternative.
- [x] 6.10 Gates re-run, and the live check re-taken at 390 and 1280, light and dark, plus forced
      colours.
