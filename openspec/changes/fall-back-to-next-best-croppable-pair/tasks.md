# Tasks

## 1. Rank pairs instead of only the winner

- [x] 1.1 Add `EXEMPLAR_PAIR_ENDS_PER_SIDE = 6` to `src/heuristics/exemplars.ts`, documenting why the
      bound is per side rather than per pair.
- [x] 1.2 Add `selectExtremePairs`: rank both sides of the median with the existing `betterEnd`
      preference, keep the best `endsPerSide` on each, enumerate every pair, skip pairs whose two
      ends share a value, and order by `pairQuality` desc then summed per-side rank asc.
- [x] 1.3 Reimplement `selectExtremePair` as `selectExtremePairs(..., 1)[0] ?? null` so the two
      cannot disagree about which pair is best.
- [x] 1.4 Add `attachPairAlternates`, the one place the winner-plus-alternates shape is built and
      the emission-quality gate is applied to alternates.

## 2. Carry the alternatives

- [x] 2.1 Add the optional `alternates` field to `MetricExemplar` in `src/heuristics/types.ts`,
      documented as one level deep. **Flagged in design.md — this file was reserved for
      `strides-ich`.**
- [x] 2.2 `trunkLean.ts`: build every ranked pair into an exemplar and attach the alternates.
- [x] 2.3 `overstriding.ts`: same, keeping its per-pair `side` / `measuredSide` /
      `pairedMeasuredSide` derivation inside the per-pair builder.

## 3. Walk the list in the evidence layer

- [x] 3.1 Add `planExemplarWithFallback` to `src/results/evidenceFrames.ts`: walk
      `[exemplar, ...alternates]`, re-assert `MIN_EXEMPLAR_QUALITY` per candidate, return the first
      non-null `planExemplarFrames` result.
- [x] 3.2 Call it from `planMetricEvidence` in place of the direct `planExemplarFrames` call, with
      the per-metric budget still applied after the walk.

## 4. Tests

- [x] 4.1 `exemplars.test.ts`: the head of `selectExtremePairs` equals `selectExtremePair` on the
      existing fixtures; the list is ranked by pair quality; every pair spans the median; the list is
      bounded by the per-side cap on a large candidate set; both ends have distinct alternatives;
      alternates below `MIN_EXEMPLAR_QUALITY` are not attached.
- [x] 4.2 `evidenceFrames.test.ts`: an admissible winner is planned and no alternate is examined; an
      inadmissible winner falls back to a lower-ranked admissible alternate and the plan reports the
      *fallback's* instants, quality and `cropGrowth`; no admissible pair anywhere yields
      `all-gated-out`; falling back does not enlarge the per-metric budget.
- [x] 4.3 `trunkLean.test.ts` / `overstriding.test.ts`: the emitted exemplar still carries the
      strides-9mb winner as its primary, and its alternates are ranked and gated.

## 5. Verification

- [x] 5.1 `npx tsc -b` clean.
- [x] 5.2 `npx eslint` clean on every touched file.
- [x] 5.3 `npm test` green, above the 1222-test baseline.
- [x] 5.4 Confirm the five constants are byte-identical via `git diff`.
- [x] 5.5 `openspec validate fall-back-to-next-best-croppable-pair --strict`.
- [ ] 5.6 Live GPU verification is the reviewer's, run serially — not run here.
