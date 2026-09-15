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
- [x] 4.3 `src/results/GuidedMetricCard.tsx`: headline row, pace tag, citation line, Try line, no
      description on banded cards, everything else into the one `<details>`.
- [x] 4.4 `src/results/GuidedResultsView.tsx`: drop the three group intro paragraphs.
- [x] 4.5 `GuidedResultsView.test.tsx`: pace tag iff `speedSensitivity`, across all twelve; no
      description on a banded card; ≤ 1 Try link per card; cadence's visible word count ≤ 70.

## 5. Verify

- [x] 5.1 `npx tsc -b`, `npm test`, `npm run lint`, `openspec validate --all --strict`.
- [x] 5.2 `npm run build`, then grep `dist/` for a scale token to prove Tailwind kept it.
- [x] 5.3 Live check per CLAUDE.md's harness: 390 and 1280, light and dark, plus forced colours; read
      the screenshots.
- [x] 5.4 Update CLAUDE.md's guided-view notes to match.
