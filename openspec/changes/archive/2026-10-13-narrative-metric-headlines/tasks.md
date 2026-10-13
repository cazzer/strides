# Tasks

## 0. Prerequisite

- [x] 0.1 `backfill-3f6-results-surfaces` (strides-v0k) archived first, so this change is stated
      against specs that describe the 3f6 surfaces.

## 1. Data layer

- [x] 1.1 Open Van Hooren et al. 2024 and its 2025 correction; confirm Table 2's cadence, vertical
      oscillation and step-length-normalised rows (design.md D2).
- [x] 1.2 `src/guidance/types.ts`: `MetricGuidance.economyConsequence`, with its rules in the doc
      comment.
- [x] 1.3 `src/guidance/metricGuidance.ts`: `VAN_HOOREN_2024_LINK`; added to cadence's and
      verticalOscillationCm's `research`; `economyConsequence` on every entry, non-null on those two.
- [x] 1.4 `metricGuidance.test.ts`: URL pinned in `VERIFIED_URLS`; non-null on exactly the two and the
      null set named; url in own links; every number in the summary; opens "Across runners"; no
      you/your, causal verb, grading word or "injur"; `costlySide` opposite `tryLine.direction`.

## 2. Selection

- [x] 2.1 `src/guidance/bandPosition.ts`: `describeBandPositionStandalone`;
      `src/results/formatGuidedValue.ts`: `guidedHeadlineParts(entry, { standalone })`.
- [x] 2.2 `src/results/guidedHeadlines.ts`: `STORY_SPOKESMEN`, `pastCostlySide`, `selectHeadlines`,
      `costlyThreshold`. Pure, no React.
- [x] 2.3 `guidedHeadlines.test.ts`: 10.4 → bounce; 4.42 / 8.0 / 9.5 → none; cadence 150 → yes,
      153 and 174 → no; excluded and withheld spokesmen → none, no fallback; large torso-relative
      bounce with null centimetres → none; order fixed when readings change.

## 3. View

- [x] 3.1 `GuidedMetricCard.tsx`: export `TryLine`, `CitationLine`, `ExternalLink` unchanged.
- [x] 3.2 `GuidedResultsView.tsx`: the "Running economy" section, first in `GuidedMeasurements`;
      empty state; bounce heading focusable for its link.
- [x] 3.3 `GuidedResultsView.test.tsx`: placement; 10.4 headline contents; 150 headline; order; both
      empty-state variants and the word budget; promoted cards still render; no canvases; no
      grading colour or word; furniture ≤ 50 words. Heading-outline test updated for the new h2.

## 4. Verification

- [x] 4.1 `npx tsc -b`, `npx eslint .`, `npx vitest run`, `npx vite build` — all green.
- [x] 4.2 `git diff 042dd5b --stat`: nothing under `src/pose`, `src/heuristics`, sampling or workers.
- [x] 4.3 Live browser at `?view=guide`, derived port, real GPU, one upload per clip, all three demo
      clips; headline text recorded at 1280 and 390 px, light and dark, plus forced colours.
- [x] 4.4 Screenshots of the section read back and checked for layout.

## 5. Close

- [x] 5.1 `openspec validate narrative-metric-headlines --strict`, then archive.
