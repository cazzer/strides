# Tasks

Task groups 1–8 mirror beads `strides-kgi.1` … `strides-kgi.8` one for one. Group 1 blocks every
other group: the band assignment is decided in `design.md` and taken verbatim downstream, never
re-derived.

## 1. The change itself (`strides-kgi.1`)

- [x] 1.1 `proposal.md` — why a readout is not guidance, and why the constraint is "cited or it
      does not ship".
- [x] 1.2 `design.md` — the five bands with bounds, source, population and sample size (D2); the
      `verticalRatio` halving derivation with all three corroborations (D3); why
      `verticalOscillationCm` uses Malisoux and not Garmin (D4); the seven refusals with reasons
      (D5); the known in-repo disagreement that is recorded rather than accommodated (D6); the nine
      architecture decisions (D7); the overstriding/cadence content decision (D8); what this design
      does not claim (D9); the pre-registered rules (D10).
- [x] 1.3 `specs/guided-results-view/spec.md` — a new capability, ADDED requirements only. No
      MODIFIED or REMOVED delta against `results-view` in this change.
- [x] 1.4 `openspec validate guided-results-view --strict` green.

## 2. `src/guidance/` — the twelve-entry guidance record (`strides-kgi.2`)

- [x] 2.1 `src/guidance/types.ts` — `MetricGuidance`, `ReferenceBand`, `GuidanceLink`, and the
      evidence-direction union. An uncited band should be unrepresentable (D7.7).
- [x] 2.2 `src/guidance/metricGuidance.ts` — the twelve-entry `Record<MetricId, MetricGuidance>`,
      taken verbatim from D2 and D5. Five banded in D2's rank order; seven with `band === null`.
- [x] 2.3 Each band's unit matches its metric's `MetricResult.unit`. `verticalRatio` is `'percent'`
      carrying a 0..1 value the panel renders ×100 — mind the factor of 100 (D3).
- [x] 2.4 The `cadence` entry also carries the overstriding remediation links, deliberately (D8).
- [x] 2.5 The three mandatory notes: `overstriding` (D5.1), `stepWidth`/`stepWidthCm` (D5.3/D5.4),
      `footStrikePattern` (D5.5).
- [x] 2.6 Capture hints for the not-measured group — one per cause (`captureHints.wrongAngle` /
      `captureHints.notEnoughData`), pinned against `DEFAULT_VIEW_FIT_TABLE` both ways (D7.6).
- [x] 2.7 `metricGuidance.test.ts`: exhaustive over the `MetricId` union; every banded entry names a
      source, population and sample size; every bound lies inside its own scale domain; the seven
      unbanded entries are named explicitly so adding a band is a visible change; display ranks
      unique and dense; the verified URL set pinned as a literal (R3).
- [x] 2.8 UX-review copy round: every rendered string free of implementation and shorthand leaks,
      labels naming the people measured, a pace beside each speed, no URL twice per metric, the
      Velocity Project handout removed, `shortTitle` on every link and source, and
      `remediationIntro`/`guidedDescription` (D7.10, D7.11, D8).

## 3. Shared test factory, additively (`strides-kgi.3`)

- [x] 3.1 `src/results/__fixtures__/metricResult.ts` — `makeMetric` and `makeHeuristics`, all twelve
      metrics present and valid by default.
- [x] 3.2 `src/results/__fixtures__/metricResult.test.ts` — smoke test.
- [x] 3.3 Additive only: none of the eight existing hand-rolled `makeMetric` helpers is refactored
      onto it in this change.

## 4. `MetricScale` (`strides-kgi.4`)

- [x] 4.1 `src/guidance/MetricScale.tsx` — track over the domain, band shaded within it, marker at
      the value, domain ends and band bounds labelled in the metric's own unit.
- [x] 4.2 Multi-zone bands render every published zone boundary, not an outer envelope.
- [x] 4.3 A value outside the domain clamps the marker **and says so in text** (D6).
- [x] 4.4 Accessible without the graphic: value, unit and band bounds reachable from the accessible
      name or an equivalent text alternative. Asserted.
- [x] 4.5 No verdict in colour (R2), asserted by a class-name test.
- [x] 4.6 `MetricScale.test.tsx`. Consumes `src/guidance/types.ts` only; imports nothing from
      `src/results/`.

## 5. `GuidedResultsView` (`strides-kgi.5`)

- [x] 5.1 `src/results/guidedGroups.ts` — pure partition and rank of the twelve metrics into the
      three groups. Group 3 is `metricTier(metric) === 'excluded'`.
- [x] 5.2 `src/results/GuidedResultsView.tsx` — props identical to `ResultsViewProps`, so the two
      views are interchangeable at the swap point (D7.1).
- [x] 5.3 Renders `role="status"` with the verbatim text "Analysis complete." (D7.5). Asserted.
- [x] 5.4 Does **not** call `useSessionEvidence`; evidence arrives as a prop (D7.3).
- [x] 5.5 Reuses `EvidenceCanvas` and `evidenceCaptions` rather than reimplementing the thumbnail.
- [x] 5.6 Its own value formatter, matching the classic panel's output conventions —
      `MetricsPanel.tsx` is not edited to export one (D7.2). A banded headline prints at the band's
      precision instead, so it cannot sit on a bound the scale says it does not reach (D7.10 (a)).
- [x] 5.7 Every link `target="_blank" rel="noopener noreferrer"` (R3). Asserted.
- [x] 5.8 `guidedGroups.test.ts` and `GuidedResultsView.test.tsx`, including the no-verdict
      assertion (R2).

## 6. Wiring and the toggle (`strides-kgi.6`)

- [x] 6.1 `src/results/resultsViewMode.ts` — resolve `'classic' | 'guide'` from `location.search`;
      anything unrecognised or absent resolves classic (R4).
- [x] 6.2 `src/results/ResultsViewToggle.tsx` — visible, keyboard-operable, accessible name naming
      both destinations; updates the URL via `history.replaceState`. No router dependency.
- [x] 6.3 One branch at `MultiClipVideoSession.tsx`'s existing `ResultsView` call site, plus the
      state the toggle needs. Nothing else in that component moves.
- [x] 6.4 A test that both views are never simultaneously in the DOM (D7.3).
- [x] 6.5 A test that toggling out and back preserves evidence imagery.
- [x] 6.6 `MultiClipVideoSession.test.tsx` — added cases only; the existing cases pass untouched.

## 7. Live verification (`strides-kgi.7`)

- [ ] 7.1 Per CLAUDE.md's harness: real GPU (`--headless=new --enable-gpu --ignore-gpu-blocklist`,
      renderer asserted not SwiftShader), the **derived** dev-server port, one clip per upload.
- [ ] 7.2 All three bundled demo clips at `?view=guide`: page reaches "Analysis complete."; Group 1
      shows a scale with visible citation text per banded metric that resolved; Groups 2 and 3 are
      present, collapsed, and expand; evidence thumbnails appear.
- [ ] 7.3 Toggle guide → classic → guide loses no imagery.
- [ ] 7.4 Default unaffected: with no `?view=` the classic page is unchanged and `npm run test:e2e`
      passes.
- [ ] 7.5 Screenshot per clip per group, and a per-clip report of which group each metric landed in.
      Expected and not a regression: `side-portrait` resolves no vertical-oscillation family and no
      `cadence` (bead `strides-aha`), so its Group 1 is nearly empty (R5).

## 8. Close out (`strides-kgi.8`)

- [ ] 8.1 `openspec validate guided-results-view --strict` once more against the implemented code.
- [ ] 8.2 Tick every item above.
- [ ] 8.3 `openspec archive guided-results-view --yes`; diff `openspec/specs/` before and after and
      check the requirement count — the archive step matches deltas by name and silently drops what
      it cannot match.
- [ ] 8.4 A short CLAUDE.md section: where the guided view lives, `?view=guide`, which five metrics
      carry bands and which seven deliberately do not, and the one-line reason.
- [ ] 8.5 File the deferred follow-ups as beads: resolving Folland's per-stride/per-step convention
      would unblock a `verticalOscillation` (% torso) band (D5.2); whether to flip the default from
      classic to guide; migrating the eight hand-rolled `makeMetric` helpers onto the shared factory.

## 9. Gates

- [ ] 9.1 `npx tsc -b`, `npm run lint`, `npm test` — the existing suite green and untouched.
- [ ] 9.2 Zero edits to `ResultsView.tsx`, `MetricsPanel.tsx`, `src/heuristics/`, `src/pose/`,
      `src/video/` (R4) — except the one recorded in D7.2: `METRIC_DESCRIPTIONS` moved verbatim
      into `src/results/metricDescriptions.ts` (`fd3d1f7`), with identical DOM.
