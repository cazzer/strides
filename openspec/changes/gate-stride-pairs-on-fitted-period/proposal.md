# Gate stride pairs on the fitted step period

## Why

`estimateStrideLength` pairs **consecutive same-side footstrikes** and treats each pair's hip-mid
horizontal displacement as one stride. It has no way to check that a pair actually spans a stride.
On Demo 1 (the Pexels side-view track clip) it does not, and the resulting error is invisible.

Frame-by-frame ground-contact reading off the source clip (25 fps, static camera, contact onset =
shoe meeting its own shadow) puts contact **onsets** at ffmpeg `t = 3.90, 4.60, 5.16, 5.84 s`.
Contacts alternate feet, so the step interval is 0.65–0.70 s and a true same-foot stride is
**~1.25 s**. The app's three detected strikes map (via this clip's documented `app = ffmpeg + 0.08`
edit-list offset) to ffmpeg `3.92 / 4.96 / 5.52`. Only the first is a contact onset: **4.96 is
contact B's toe-off and 5.52 is late stance inside contact C — two different contacts, i.e. opposite
feet** — yet `detectFootstrikes` labels all three the same side, because a trailing leg produces a
secondary ankle-y maximum while the other foot is in stance.

So the two surviving same-side "strides" span **1.04 s and 0.56 s**, against a true 1.25 s. The
denominator is measured over roughly one *step*, and `verticalRatio` — which is
`bounce ÷ strideLengthPx` — therefore reads about **2× too high**, reported at High confidence
(0.72–0.73) with nothing in the UI surfacing the error.

Independent cross-check that the fault is in the denominator, not the numerator: at the reported
numbers the implied stride is 2.40 torso lengths ≈ 1.2 m, which at 46 strides/min is 0.92 m/s — far
slower than the clip visibly shows. Doubling the stride gives ~2.8 m and ~2.1 m/s, a plausible jog.

`cadence` is **correct** here (91.2 spm, independently confirmed at 92.7 spm by the same
frame-by-frame contact count) precisely because `cadence.ts` stopped consuming `detectFootstrikes`
for exactly this failure mode and moved to the spectral fit. `verticalRatio` never got that
treatment.

`strideLength.ts` already anticipated a *related* bias and rejected the obvious mitigation:

> **Fit-period multiplicity correction**: compare each pair's `d` against the median `d` and halve
> (or discard) any pair suspiciously close to 2x the median … Rejected: on a short clip a
> "suspicious 2x" threshold has no calibrated boundary.

That objection was about comparing pairs **to each other**, which on a short clip has no anchor. It
does not apply to an **external physical reference**, and one is now available at the exact call
site: `verticalRatio.ts` already calls `analyzeHipBounce`, whose fitted `frequencyHz` is the *step*
frequency (`cadence.ts` reports it as `frequencyHz × 60` spm, and cadence is the one number verified
correct on this clip). A stride is exactly two steps, so the expected stride **period** is
`2 / frequencyHz` — derived from physics, not tuned. On Demo 1 that is `2 / 1.52 = 1.316 s`, within
6% of the 1.25 s measured off the video, while the two surviving pairs sit at 0.79× and 0.43× of it.

## What Changes

- `estimateStrideLength` gains an optional `stepFrequencyHz` reference. When supplied, each
  candidate same-side pair's **time interval** is checked against the expected stride period
  `2 / stepFrequencyHz` before its displacement is admitted to the median. Pairs outside a
  log-symmetric `±STRIDE_PERIOD_TOLERANCE` band are dropped and counted separately.
- New failure reason `'no-period-consistent-pairs'` when every candidate pair is rejected that way,
  so "the detector found no real stride here" is distinguishable from "the pairs didn't advance".
- New success field `periodRejectedPairCount`, so a caller can caveat period rejections honestly
  instead of folding them into "couldn't be read cleanly".
- `verticalRatio.ts` supplies the reference (`fit.frequencyHz`, which it already has in hand) and
  gains two caveats: one naming the new failure reason, one reporting how many pairs the gate
  dropped.
- `strideLength.ts`'s bias documentation gains the missing direction: the **halving** bias (a
  spurious extra strike shortens the interval → stride reads LOW → the caller's ratio reads HIGH).
  Today it documents only the doubling bias, which pushes the ratio the other way.

Behaviour is **unchanged** when no `stepFrequencyHz` is supplied — the gate is inert, every count
and every reason is what it was.

## Impact

- Affected specs: `form-heuristics`
- Affected code: `src/heuristics/strideLength.ts`, `src/heuristics/verticalRatio.ts`, and their
  tests (plus `index.test.ts`'s drift guard, which must call the extractor the same way the metric
  now does).
- Not touched, deliberately: `cadence.ts` (correct on this clip, and the source of the reference),
  `footstrikes.ts` (the spurious-instant problem is upstream and out of scope), `overstriding.ts`
  and `footStrikePattern.ts` (also consume `detectFootstrikes`; exposure noted in `design.md` for a
  separate ticket).
