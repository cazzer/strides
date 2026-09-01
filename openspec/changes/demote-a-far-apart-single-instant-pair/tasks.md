# Tasks

## 1. Classify the two range kinds as single-instant

- [x] 1.1 Add `overstrideRange` and `trunkLeanRange` to `SINGLE_INSTANT_KINDS`
      (`src/results/evidenceFrames.ts`), and rewrite the docstring: remove the false clause listing
      a range among difference-quantities, and state that the kind's NAME describes how the
      exemplar was BUILT, not what the card REPORTS. Cite `strides-r41` and `strides-ddj`.
- [x] 1.2 Keep `bounceCycle`, `armSwingCycle` and `stridePair` out, and record why `stridePair`
      cannot join: its only measurement mark, `strideCaliper`, is drawn only when
      `plan.ghost !== null`.

## 2. Route the far-apart rejection through that classification

- [x] 2.1 In `planExemplarFrames`, compute `pairTooFarApart` rather than returning early, and
      `return null` only for a kind not in `SINGLE_INSTANT_KINDS`.
- [x] 2.2 Rewrite `isTooFarApartPair`'s docstring: keep the criterion and its calibration exactly,
      replace the "refuses demotion" justification.

## 3. Make demotion the fallback walk's last resort

- [x] 3.1 `planExemplarWithFallback` returns the first candidate that renders AS A PAIR, remembers
      the first demoted plan, and returns that only if no candidate renders as a pair.
- [x] 3.2 Update its docstring paragraph that currently says a far-apart pair is still dropped.

## 4. Carry the demotion reason to the caption and the coverage line

- [x] 4.1 `EvidenceDemotion = 'collapsed-pair' | 'far-apart-pair'`; `EvidenceFramePlan.demotion`
      replaces `demotedFromPair`.
- [x] 4.2 `captionFor` switches through a `Record<EvidenceDemotion, string>`; the collapsed
      sentence is unchanged byte-for-byte.
- [x] 4.3 `EvidenceCoverageExemplar.demotedFromPair` → `demotion`; `cropGrowth` stays `null`.

## 5. Name the base instant in a paired label (`strides-8i4`)

- [x] 5.1 `ExtremePair<T>` gains `baseIsHigh`, set from the comparison `selectExtremePairs` already
      performs. No ranking, ordering or tie-break change.
- [x] 5.2 `overstriding.ts` and `trunkLean.ts` pick their label from `baseIsHigh`.

## 6. Tests

- [x] 6.1 `evidenceFrames.test.ts`: move the two range kinds out of the near-identical drop loop;
      split the far-apart "EVERY kind" test into a drops-case and a demotes-case; rework the
      fallback ordering tests; rename `demotedFromPair` assertions.
- [x] 6.2 `evidenceCaptions.test.ts`: a `'far-apart-pair'` caption says "too far away to share a
      legible crop" and NOT "too similar".
- [x] 6.3 `evidenceAnnotations.test.ts`: for every kind in `SINGLE_INSTANT_KINDS`, a demoted plan
      emits at least one `layer === 'measurement'` op. Export `SINGLE_INSTANT_KINDS`.
- [x] 6.4 `exemplars.test.ts`: `baseIsHigh` agrees with `base`, both orderings and the exact tie.
- [x] 6.5 `overstriding.test.ts` / `trunkLean.test.ts`: a below-median-extreme distribution emits
      that end's timestamp AND a label leading with it.
- [x] 6.6 Mechanical renames in `extractFrames.test.ts`, `drawEvidenceAnnotations.test.ts`,
      `MetricsPanel.test.tsx`.

## 7. Gates and live verification

- [x] 7.1 `tsc -b`, eslint, full `npm test`, `openspec validate --strict`.
- [x] 7.2 `scripts/ab-person-selection.mjs --arm 'base={}' --clips demo1,demo2,multiperson
      --trials 3 --evidence` against a `0817ca9` baseline; diff.
- [x] 7.3 Pull Demo 1's Overstriding canvas as a PNG from the harness and LOOK at it.
- [x] 7.4 Ground-truth the rendered instant against the source frame.
- [x] 7.5 Update CLAUDE.md's `[evidence-coverage]` contract paragraph.
