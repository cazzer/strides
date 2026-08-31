# Tasks

## 1. Detector eligibility

- [x] 1.1 Add a module-private `hasFramesEitherSide(candidate, frameCount)` to
  `src/heuristics/footstrikes.ts`, near `nearestFrameIndex`. Docstring: the reversal/inflection
  argument; that it carries no threshold; that the boundary is the **presence-trimmed** window's edge
  (`runClipAnalysisPipeline.ts:59`); and that both paths can land there for unrelated reasons,
  cross-referencing `extrema.ts`'s own trailing-pivot note rather than disputing it.
- [x] 1.2 Restructure `detectFootstrikes`'s tail to select the path FIRST and filter once. Comment
  why filtering before the `length > 0` test would silently redefine the documented fallback
  condition.
- [x] 1.3 Comment why the filter runs AFTER `attributeSides`: a boundary instant's ankle separation
  is real evidence about which foot is which, even though its timing is unconfirmable.
- [x] 1.4 Record finding (A) on `detectFootstrikesBetweenAnkles`'s docstring — Demo 2's scale pass
  reached this path, not the phase path, and its deltas 20/22/19/14 prove it.
- [x] 1.5 Record finding (B) on `detectFromBouncePhase`'s docstring — it reaches a boundary only when
  a prediction snaps within half a frame of an end, ~2.5% per end, by coincidence not by mechanism.

## 2. Sample-size minimum

- [x] 2.1 `MIN_STEP_WIDTH_SAMPLE_SIZE` 4 → 7 in `src/heuristics/stepWidth.ts`. No other code change —
  the caveat string already interpolates the constant.
- [x] 2.2 Rewrite its docstring: drop the now-false "chosen for the same reason as overstriding's
  identical minimum"; state `n >= 2k + 3` with the rank arithmetic; label `k = 2` as a judgment call
  with its grounds; record that 4 fails at `k = 1`; note Demo 2's post-exclusion `n = 4` as a live
  instance of exactly that.
- [x] 2.3 Confirm `median` is kept and no null floor added — below the minimum the metric is
  discounted, never withheld.

## 3. Repair the broken tests — by padding, never by weakening

- [x] 3.1 `footstrikes.test.ts`: pad the four hand-traced fixtures (`keeps only maxima`, `drops a
  same-side candidate`, `combines both legs`, `scales the prominence threshold`) so each asserts a
  CONFIRMED extremum.
- [x] 3.2 `footstrikes.test.ts`: update the three `buildGait`-based expectations, which lose the
  fixture's closing contact because it sits on the final sampled frame by that fixture's own design.
  Comment the reason at each. (Padding `buildGait` itself was tried, broke two unrelated pinned tests
  and did not fix the target — see design D8.)
- [x] 3.3 `footstrikes.test.ts`: the fallback-condition test compares against
  `detectFootstrikesBetweenAnkles` with the same eligibility applied, since eligibility is applied
  once to whichever path won.
- [x] 3.4 `verticalRatio.test.ts`: give `framesWithAnkleBlock` a named phase offset so its candidates
  stop landing on frames 0/60/119, and correct its measurement note.
- [x] 3.5 `stepWidth.test.ts` / `stepWidthCm.test.ts`: update the two exemplar `cropKeypoints`
  expectations, which shift by one plant because `buildStrikeFrames`'s first right plant is on
  frame 0.
- [x] 3.6 Verify the three call-outs rather than assuming: `confidence > 0.9` (unchanged, still
  passes), `sampleSize === cleanResult.sampleSize - 1` (unchanged, still passes), `alternateFeet:
  true` (changed — 3.5). Also raise that test's `sampleSize >= 4` to `>= 7`, which is what it meant.
- [x] 3.7 Check the phase path's `candidates.length` band still holds without widening. It does.
- [x] 3.8 Check `src/heuristics/index.test.ts` and `src/results/` for anything pinning a strike
  count. Nothing does — those pin hand-built `MetricResult` literals.

## 4. New tests

- [x] 4.1 Last-frame candidate not emitted, interior unchanged, with the unfiltered premise asserted.
- [x] 4.2 The symmetric first-frame case.
- [x] 4.3 A clip whose only candidates are boundary candidates yields `[]`.
- [x] 4.4 Both paths asserted identically — the fallback via `ankleOnlyFrames`, the phase path via a
  clip sliced to end on a predicted instant, with the prediction recomputed inside the test.
- [x] 4.5 The invariant swept across every prefix of a real gait clip.
- [x] 4.6 `stepWidth.test.ts`: pin `n >= 2k + 3` executably beside the constant, on the real Demo 2
  ratios — n = 4 k = 1, n = 5 k = 2, n = 7 k = 2, n = 6 k = 2. No `mathUtils.test.ts` is created.
- [x] 4.7 `stepWidth.test.ts`: a five-strike clip reports at `5/7` with the "recommend at least 7"
  caveat; a seven-strike clip carries neither.

## 5. Documentation

- [x] 5.1 Add a correction note beside D2a in
  `openspec/changes/archive/2026-08-31-explain-the-step-width-pass-gap/design.md`, recording finding
  (A). Do not rewrite its measurements.

## 6. Spec

- [x] 6.1 MODIFIED `Footstrike timing is derived from the fitted hip-bounce phase` — its scenario
  asserting "exactly one instant is emitted per bounce cycle inside the analysed span" is false once
  a boundary-snapped cycle is dropped.
- [x] 6.2 MODIFIED `Footstrikes are ground-contact onsets detected between the two ankles` — two
  scenarios assert "every true touchdown in the clip is still emitted" / "the same set of contacts is
  emitted".
- [x] 6.3 ADDED a footstrike-eligibility requirement, stated after path selection so both detectors
  are covered identically.
- [x] 6.4 ADDED a step-width sample-size requirement: `n >= 2k + 3` as the estimator property,
  `k = 2` as the judgment call, and discounted-never-withheld below the minimum.
- [x] 6.5 Confirm NOT modified: `Step width reports the signed per-footstrike lateral offset from the
  hip midline` (its "median across all detected footstrikes" stays literally true because the filter
  is in the detector), `Step width follows the shared output contract` (no new null trigger), and
  `Footstrike candidates are selected by amplitude at the clip's own stride rhythm` (constrains
  ordering and spacing, not eligibility — cross-referenced, not modified).

## 7. Gates

- [x] 7.1 `npx tsc -b` clean.
- [x] 7.2 `npm run lint` clean.
- [x] 7.3 `npm test -- --run` green.
- [x] 7.4 `openspec validate exclude-boundary-footstrikes --strict` passes.
- [x] 7.5 Live-browser A/B against the predictions in `proposal.md`, run by the coordinator against
  `d0e4eff` → `e0c6118`. Exactly three fields moved, all `stepWidth.confidence`, with demo2 landing
  on the pre-registered 0.714286 exactly. No value, `sampleSize` or tier moved. Two corrections to
  this change's assumptions came out of it — recorded in design D12. A confirming re-run after the
  round-2 fix is the coordinator's.

## 8. Review round 2

- [x] 8.1 🔴 **Fixed, not accepted.** Apply eligibility to the extrema BEFORE `selectFootstrikes`
  ranks them on the ankle-difference path: its greedy amplitude-ranked suppression let an ineligible
  boundary pivot delete a confirmed interior contact before being dropped itself. One predicate, two
  enforcement points, each commented with why it exists. Design D1a; regression test pins it;
  mutation-checked at 5 failing tests.
- [x] 8.2 🟡 `stepWidth.ts` no longer labels a prediction "measured" — the five measured ratios stay
  as measured, the post-exclusion `n = 4` is marked PREDICTED and not yet confirmed.
- [x] 8.3 🟡 `footstrikes.ts` no longer over-claims coverage: the rule reaches the series' final run's
  pivot only, and interior run-end pivots (from `buildContactSeries`'s gaps) are stated as knowingly
  out of scope.
- [x] 8.4 🟡 `stepWidth.ts` drops the false biconditional — `n >= 2k + 3` is a sufficient condition on
  the reported number's provenance, is not "exactly when", and does not return the clean median.
- [x] 8.5 🟡 `buildGait`'s rationale corrected, with the reverted one-frame padding attempt recorded
  so nobody retries it.
- [x] 8.6 🟡 `detectFootstrikes`'s exported JSDoc states the eligibility contract, where its five
  consumers look.
- [x] 8.7 🟢 `verticalRatio.test.ts`'s new constant moved above the fixture doc it had separated from
  its function; the ADDED requirement's "SHALL be derived, not chosen" narrowed to the shape;
  `footstrikes.test.ts`'s inline predicate extracted to one `interiorOnly` helper; the "2.5% per end"
  figure re-stated as a property of fps × cadence (≈3.0% on Demo 1, ≈2.5% on Demo 2).
