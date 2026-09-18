# Tasks

## 1. Data layer — the consequence

- [ ] 1.1 `src/guidance/types.ts`: add `MetricGuidance.consequence: { text: string; url: string } |
      null`, documented with the three rules its tests enforce — subject is the quantity not the
      runner, `url` ∈ that metric's own `research` ∪ `remediation`, every number in `text` appears
      in that source's `summary`. Mirror the doc-comment discipline `tryLine` already carries.
- [ ] 1.2 `src/guidance/metricGuidance.ts`: write `consequence` on all twelve entries, per design.md
      D2 — non-null on `cadence`, `verticalOscillationCm`, `verticalOscillation`, `overstriding`,
      `trunkLean`, `stepWidth`, `stepWidthCm`; `null` on `verticalRatio`, `kneeFlexion`, `kneeDrive`,
      `armSwingAmplitude`.
- [ ] 1.3 Resolve design.md D2 row 10: does either `BOVALINO_2021_LINK` or `BURKE_2021_LINK` state
      the load-redistribution claim `EvidenceDirection`'s doc attributes to `footStrikePattern`? If
      neither does, `consequence` stays `null` there — **do not add a citation to make the row
      work.** Record the answer in design.md.
- [ ] 1.4 `metricGuidance.test.ts`: `consequence.url` ∈ that metric's own links; every number in
      `text` appears in the cited summary; the null-consequence set pinned **by name**, as the seven
      unbanded entries already are; no grading word in any `text`; no "should", "target" or "aim".
- [ ] 1.5 `metricGuidance.test.ts`: assert `cadence.consequence.text` contains no injury-outcome
      language (design.md D6), and that the Anderson 2022 mandatory note is unchanged.

## 2. Selection — stories, eligibility, order

- [ ] 2.1 `src/results/guidedGroups.ts`: add a `storyGroup` mapping — `cadence` + `overstriding` →
      step rate; `verticalOscillationCm` + `verticalOscillation` → bounce; every other metric its
      own story. Pure, no React.
- [ ] 2.2 `src/results/guidedGroups.ts`: `selectHeadlines(...)` — filter on resolved value ∧
      `consequence` ∧ `tryLine` ∧ existing `tryLineApplies`; collapse to one per `storyGroup` by
      lowest `displayRank`; sort by `displayRank`. Returns `[]` freely.
- [ ] 2.3 Unit tests: a withheld cue withholds the headline; a consequence without a cue does not
      promote; both VO units eligible → exactly one headline and the other still below the fold;
      spokesman falls back to `overstriding` when `cadence` did not resolve; order is `displayRank`
      and does not move when values are swapped; zero eligible → `[]`.

## 3. View

- [ ] 3.1 `src/results/GuidedHeadline.tsx`: value, optional band position, consequence + citation,
      Try line + citation. No scale, no icon, no pass/fail colour, no new colour tokens.
- [ ] 3.2 `src/results/GuidedResultsView.tsx`: render the headline group above the existing three;
      honest empty state when `selectHeadlines` returns `[]` (design.md D5). The three existing
      groups and their contents are otherwise untouched.
- [ ] 3.3 `GuidedResultsView.test.tsx`: an unbanded metric's headline renders without a position; a
      banded one's states its position; the empty state renders and the groups below are unaffected;
      a promoted metric still appears in its group below.
- [ ] 3.4 Accessibility: the headline group is a labelled region; both views still render
      `role="status"` starting "Analysis complete." — the e2e suite and
      `scripts/ab-person-selection.mjs` wait on that text.

## 4. Verification

- [ ] 4.1 `npx tsc -b` and `npx eslint` clean on every touched file; `npm test` green.
- [ ] 4.2 **A/B gate: bit-identical.** `node scripts/ab-person-selection.mjs --arm 'base={}' --clips
      side-landscape,side-portrait,front-approach --trials 3 --evidence`, before and after. Expect
      differing lines on `elapsedMs` only. ⚠️ Compare with `rtk proxy diff` **and** cross-check with
      `md5` — `strides-ef5`, and run the whole pipeline through `rtk proxy sh -c`.
- [ ] 4.3 Live-browser verification at `?view=guide` on all three demo clips (derived port, real GPU,
      one upload per clip): record how many headlines each clip yields and which metric speaks for
      each story. `park-side-landscape` is expected to yield the step-rate headline and **no** bounce
      headline (`verticalOscillationCm` reads 4.42 cm below its band, `'lower'` cue withheld).
      `front-approach` is expected to yield the empty state.
- [ ] 4.4 Check the headline group at 390 px and 1280 px, light and dark, plus
      `forcedColors: 'active'` — the declutter change's own check list.
- [ ] 4.5 Re-read the rendered headlines against the grading prohibition: no grading word on any
      value, no target, no pass/fail colour, no icon.

## 5. Close

- [ ] 5.1 `openspec validate narrative-metric-headlines --strict`, then archive once shipped and
      verified — `openspec/specs/` drifts if this waits.
- [ ] 5.2 File follow-ups as beads; close `strides-83m`.
