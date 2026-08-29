# Tasks

## 1. The shared ranking helper

- [x] 1.1 Add `selectExtremePair` to `src/heuristics/exemplars.ts`, beside `scoreExemplarInstant` and
      `pairQuality`: rank every candidate by `scoreExemplarInstant(…, 'extreme', …)`, take the
      best-scoring candidate at or above the median and the best-scoring one at or below it, break
      exact quality ties by distance from the median, and return `{ base, ghost, quality }` with base
      the further-from-median end.
- [x] 1.2 Return `null` for the degenerate cases: either side empty, or the two ends resolving to the
      same instant or the same value.
- [x] 1.3 Document why the per-side argmax *is* the best-scoring pair (`pairQuality` is a minimum),
      why the median split is required, and why the deviation tie-break makes uniformly-tracked clips
      behave exactly as they did.

## 2. Call sites

- [x] 2.1 `src/heuristics/trunkLean.ts` — `buildExemplars` calls the helper, dropping its own
      extremes scan, its `cropDerivable`/`isOutlier` pre-filter and its base/ghost block.
- [x] 2.2 `src/heuristics/overstriding.ts` — same, keeping its `side`/`measuredSide`/
      `pairedMeasuredSide` and crop-keypoint construction off the returned base and ghost.
- [x] 2.3 Leave both labels, both `kind`s, and every non-exemplar field untouched.

## 3. Tests

- [x] 3.1 `src/heuristics/exemplars.test.ts` — direct coverage of `selectExtremePair`: the
      well-tracked near-extreme beating the interpolated value-extreme; the median split holding when
      the two best overall scores sit on one side; uniform tracking selecting the value extremes; the
      degenerate single-value and same-instant cases returning `null`.
- [x] 3.2 `src/heuristics/trunkLean.test.ts` — end-to-end: a clip whose most-forward frame has all
      four torso seeds interpolated emits an exemplar built from the next-best forward frame, where
      today it emits none.
- [x] 3.3 `src/heuristics/overstriding.test.ts` — the same shape through a strike fixture, and the
      existing exemplar assertions still pass unedited.

## 4. Verify

- [x] 4.1 `npx tsc -b` clean.
- [x] 4.2 `npx eslint` clean on every touched file.
- [x] 4.3 `npm test` green, with the pre-existing exemplar fixtures unedited — the proof that a
      uniformly-tracked clip is unaffected.
- [ ] 4.4 (owner, not this change's agent) Live headless-Chromium run on real GPU: `trunkLean` emits
      evidence on Demo 1 under the default sampler, Demo 1 coverage goes 7 images/5 sections → 8/6,
      Demo 2 and multiperson do not regress, read off the LAST `[evidence-coverage]` line.
