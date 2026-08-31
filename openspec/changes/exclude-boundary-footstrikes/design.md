# Design

## D1. Where the rule goes, and why it is exactly one place

`detectFootstrikes` has two paths. The eligibility rule is applied **once, to whichever path won**,
in `detectFootstrikes` itself:

```ts
const fromPhase = detectFromBouncePhase(frames, fit, config)
const candidates =
  fromPhase.length > 0
    ? fromPhase
    : detectFootstrikesBetweenAnkles(frames, config, bodyScale.torsoLengthPx, fit)

return candidates.filter((candidate) => hasFramesEitherSide(candidate, frames.length))
```

Three placements were available and two are wrong.

**Not in `computeStepWidth`.** The defect is not a step-width defect; it is a footstrike defect that
step width happens to be the most sensitive consumer of. `overstriding`, `footStrikePattern`,
`stepWidthCm` and `strideLength` all read the same detector and all inherit the same unconfirmable
instant. Fixing it at one consumer would leave the other four wrong and would make the spec's
existing "the median, across all detected footstrikes" wording false — that sentence stays literally
true precisely because the filter is in the detector.

**Not inside either detector.** Both paths reach the boundary, for reasons that have nothing to do
with each other (D2), so a rule stated twice is a rule that can drift. Worse, putting it inside
`detectFromBouncePhase` would change what an empty return means: `detectFootstrikes` reads `[]` from
that path as "fall back", so a phase path that filtered its own output could hand the clip to the
ankle detector because its only instants happened to be boundary ones — silently redefining a
documented fallback condition.

**Order within `detectFootstrikes` is load-bearing in both directions.**

- **After path selection**, so the fallback condition stays "path 1 produced no instant at all".
- **After `attributeSides`**, so the parity vote still reads the excluded instant's ankles. That vote
  is one magnitude-weighted decision over every instant, and a boundary instant's ankle separation is
  real evidence about which foot is which even though its TIMING is unconfirmable. The two are
  separate claims about the same frame, and only the timing one is unsupported.

## D2. Both paths reach a boundary; only one does so by construction

| | how it gets there | frequency |
|---|---|---|
| `detectFootstrikesBetweenAnkles` | `findLocalExtrema` emits an unconfirmed trailing pivot at the end of **every** run, then `selectFootstrikes` ranks by DESCENDING value | every clip, every run |
| `detectFromBouncePhase` | `firstK`/`lastK` admit the span inclusively, so a predicted touchdown lands on an end frame when it falls within half a frame of one | ~2.5% per end |

The fallback's route is the damaging one, and the amplitude ranking is what makes it damaging: a
boundary pivot sitting on a contaminated frame does not merely get included, it gets included
**first**. Demo 2's scale pass emitted the clip's final frame at ratio **+1.38051** against a
primary-pass maximum of +0.37568.

`extrema.ts` is not at fault and is not changed. Its docstring defends the trailing pivot on
PROMINENCE grounds — "the trailing pivot's distance from the prior extremum is always *itself* at
least `minProminenceAbs`" — which is a claim about amplitude and is correct. It is simply not a
claim that the pivot is a ground contact. The footstrike layer is where that reading was made, so
that is where it is corrected; `hasFramesEitherSide` cross-references the note rather than rewriting
it.

## D3. Why there is no threshold, and no discount

The evidence for a ground contact is a REVERSAL: the striking ankle stops descending, the two ankles
stop separating, the fitted trajectory changes the sign of its curvature. A reversal is a statement
about both sides of an instant. At the first or last sampled frame only one side exists.

So this is not "near the edge" (a tolerance in seconds), not "less confident at the edge" (a weight),
and not "the edge is contaminated on this clip" (an empirical claim about Demo 2). An instant either
has a neighbour on each side or it does not. `strides-aah` listed "weight boundary strikes down"
among its options; a weight would need a number, and there is no quantity to derive one from — the
evidence is absent, not small.

**The boundary is the presence-trimmed window's edge.** `runClipAnalysisPipeline.ts:59` calls
`trimToPresenceWindow` before `computeFormHeuristics`, so the frames every heuristic sees already
start at the first frame the subject was present in. That is surprising in the reader's favour and is
documented at the predicate: the excluded frames are the edges of the SUBJECT's window, which is
exactly where a partially entered or exited body produces its least trustworthy geometry.

## D4. The sample-size bound, derived

With `n` samples of which `k` are contaminants all biased the same way, the contaminants occupy the
top `k` ranks. The median is untouched by them exactly when the middle of the sorted array still lies
strictly inside the clean subsample:

```
odd  n:  (n + 1) / 2  <  n − k    ->   n >= 2k + 2
even n:  n / 2 + 1    <  n − k    ->   n >= 2k + 3     <- binds
```

`k = 1` → `n >= 5`. `k = 2` → `n >= 7`.

**The old constant fails its own docstring.** It claimed 4 was where a *single* noisy detection stops
dominating. At `n = 4, k = 1` the median is `mean(rank2, rank3) = mean(clean median, clean MAX)` —
half the reported number is the worst clean sample. That is a correctness defect independent of any
clip, and it is pinned executably in `stepWidth.test.ts` on the real Demo 2 ratios.

**`k = 2` is a judgment call and is labelled as one in the docstring, not blended into the
derivation.** Two grounds, both from this repo's own corpus:

1. Two independent contamination mechanisms are documented on it — boundary strikes (`strides-aah`,
   fixed here) and detector-dropout windows where surviving detections collapse both ankles onto one
   point (`strides-boc`, **not** fixed and not fixable at this layer).
2. The only clip whose per-strike ratios have been measured carried exactly `k = 2` of `n = 5`.

**What the bound does not promise.** `2k + 3` is the point at which contaminants stop reaching the
middle slot, not the point at which they stop shifting it. The n = 7 test asserts the median is a
clean sample strictly inside the clean range, and explicitly asserts it is **not** the clean median —
claiming otherwise would claim a robustness the arithmetic does not deliver.

## D5. Why they had to ship together

The exclusion removes a sample. The minimum is what prices a missing sample.

- **Exclusion alone**: Demo 2's scale pass goes from `n = 5` to `n = 4`, and at `MIN = 4` that reports
  at full sample-size confidence — a thinner sample rewarded with the same confidence, off a median
  that is still half a clean extreme (`mean(0.16306, 0.40424) = 0.28365`).
- **Minimum alone**: the contaminated instants stay in the median the minimum exists to protect. The
  number would be no better; only the label on it would change.

## D6. `median` is kept, and no null floor is added

A trimmed statistic at n = 5 discards 40% of the sample, and the values it would trim are the ones
this change removes upstream anyway — a second, weaker guess at the same problem. `strides-h6r`
listed "refuse to report below some minimum strike count" as an option; that is rejected on the
shared contract this repo states for every metric — never a silent wrong number, and never a silently
withheld one. Below the minimum the value is reported, discounted by `min(1, n / 7)`, and caveated
with the count and the recommendation.

## D7. Sibling constants deliberately not swept

`stepWidthCm`, `footStrikePattern`, `kneeFlexion` and `overstriding` each carry
`MIN_*_SAMPLE_SIZE = 4`, and the identical arithmetic applies to each. They are **not** moved here:
each has its own estimator, its own contamination story and its own blast radius on every clip's
confidence tiers, and sweeping four constants inside a change measured on one is how a defensible
number becomes an undefended one. `computeMetricConfidence`'s shape is likewise untouched —
un-saturating `min(1, n / nMin)` would move every metric in the pipeline.

## D8. Test repairs: padded, never weakened

Ten tests failed. **None was repaired by weakening the rule** — no tolerance, no per-path exemption,
no conditional filter.

**Four small hand-traced fixtures were PADDED** so the extremum they assert on acquires a confirming
neighbour. Each then tests a CONFIRMED extremum, which is strictly better evidence for the property
it is about than the trailing pivot it used to assert on:

| test | before | after |
|---|---|---|
| keeps only maxima | `[0,1,2,3,4,5]`, max on the last frame | `[0,1,2,3,4,5,4,0,0]`, confirmed max at index 5 |
| drops a too-close same-side candidate | `[10,8,6,4,6,8,10,8,6]`, first max on frame 0 | `[6,8,10,8,6,4,6,8,10,8,6]`, maxima at 2 and 8 |
| combines both legs, timestamp-ordered | monotone rise/fall pair, BOTH maxima on boundaries | antiphase triangles, 1.5 cycles, maxima at 3 / 6 / 9 |
| scales the prominence threshold | shared the first fixture | shares the padded first fixture |

The third is the interesting one. A single half-cycle **cannot** be repaired by padding: whichever
side's differenced series begins by falling has the extremum scan's phase-1 maximum at index 0 by
construction, so one of the two sides always lands on a boundary. A cycle and a half gives each side
its own confirmed interior maximum — and the resulting instants interleave (left, right, left) where
detection appends both left candidates before the right one, which tests the timestamp re-sort more
strongly than the original two-candidate case did.

**Three `buildGait` tests had their expectations updated, not their rule.** That fixture deliberately
ends ON a left touchdown, so its closing contact sits on the final sampled frame and is no longer
emitted. Padding `buildGait` by one frame was tried and rejected: it perturbed the spectral fit
enough to break two unrelated pinned tests (the multi-modal contact-series case and the swing-apex
sweep) **and did not even fix the target**. The expectations now record six contacts with a comment
naming the boundary as the reason — which is the rule working, not a detection failure: the fixture
knows by construction that the contact is real, and the CLIP contains no evidence of it, which is the
only thing a detector can read.

One of those three compares `detectFootstrikes` against `detectFootstrikesBetweenAnkles` called
directly. Its reference is now that detector's output **with the same eligibility applied**, because
eligibility is applied once to whichever path won — comparing against the raw list would assert that
the fallback is exempt from a rule the spec states for both paths. What the test is about, and still
tests, is the fallback CONDITION.

**Two fixtures were shifted so their candidates stop landing on boundaries.**
`verticalRatio.test.ts`'s `framesWithAnkleBlock` put its ankle-y troughs — where the surviving
right-side candidates land — at frames 0 and 60 of a 120-frame clip, plus a trailing pivot at 119, so
every candidate was a boundary candidate and the clip lost its same-side pair entirely. A named
10-frame phase offset moves them to 50 and 110. The test's own measurement note is updated: one pair
at 2.000 s rather than two at 2.000 s and 1.967 s. It asserts the period gate rejects what it is
handed, not how much.

**Two exemplar expectations moved by one step.** `buildStrikeFrames({ alternateFeet: true })` puts
the right foot's first plant on frame 0, so the earliest opposite-foot pair now begins with the left
foot: `cropKeypoints` goes `['right_ankle', …, 'left_ankle']` → `['left_ankle', …, 'right_ankle']` in
both `stepWidth.test.ts` and `stepWidthCm.test.ts`. Which foot leads is incidental to the property
under test — that a pair is CONSTRUCTED from a list that does not hand one over — and both instants'
own feet are still asserted.

**`stepWidth.test.ts`'s `sampleSize >= 4` became `>= 7`.** It was written to mean "at or above this
metric's own minimum", which is what makes the `confidence > 0.9` assertion beside it read as
"nothing is discounting this".

**Checked and unchanged**: the phase path's `candidates.length` band
(`floor(span/period) ± 1`) still holds and was not loosened; `stepWidth.test.ts`'s
`sampleSize === cleanResult.sampleSize - 1` still holds; `src/heuristics/index.test.ts` and
everything under `src/results/` pin hand-built `MetricResult` literals rather than real detections
and are untouched.

## D9. New tests

Five in `footstrikes.test.ts`, in one block:

1. **last-frame candidate not emitted, interior untouched** — with the premise asserted first, via
   `ankleOnlyFrames`, that the unfiltered detector DOES emit it, and that it outranks the real
   contact (higher amplitude, so amplitude-ranked selection reaches it first).
2. **the symmetric first-frame case.**
3. **only-boundary-candidates yields `[]`** — on the bare monotonic rise the first test used to run
   on, which is a compact record of why that fixture needed padding.
4. **the phase path, asserted identically** — a synthetic gait clip sliced to 70 frames, whose own
   fit predicts a touchdown on frame 69. The prediction is recomputed from the fit inside the test
   rather than assumed, so it cannot degrade into "some other stage dropped it".
5. **the invariant, swept** — every prefix of a real gait clip from 45 frames up: no emitted
   candidate is ever index 0 or index `length - 1`, on whichever path each slice happens to take.

Six in `stepWidth.test.ts`: four pinning the `n >= 2k + 3` arithmetic on the real Demo 2 ratios
(n = 4 k = 1, n = 5 k = 2, n = 7 k = 2, and n = 6 k = 2 showing the even case is what binds), and two
at metric level — a five-strike clip reporting at exactly `5/7` with the "recommend at least 7"
caveat, and a seven-strike clip carrying neither.

## D10. Predictions

Pre-registered in `proposal.md` before any measurement, and not restated here so there is one copy to
check against.

## D11. Correction to an archived design

`openspec/changes/archive/2026-08-31-explain-the-step-width-pass-gap/design.md` **D2a** attributes
the two passes' differing instants to "two passes that fit different bounce curves". They came from
two different DETECTORS: the scale pass's hip fit fell below `cadenceMinFitR2`, so it ran the
ankle-difference fallback. A correction note is added beside the claim; the measurements are left
exactly as recorded. The distinction is load-bearing rather than clerical — it is what makes the
frame-100 outlier a structural product of the fallback rather than a coincidence of a fitted phase,
and therefore what put the fix in `detectFootstrikes` instead of in either detector.
