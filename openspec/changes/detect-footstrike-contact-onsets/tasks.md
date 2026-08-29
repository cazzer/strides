# Tasks

## 1. Detector

- [x] 1.1 Add `buildContactSeries` to `src/heuristics/footstrikes.ts`: per side, the ankle's y minus
  the opposite ankle's y, `null` where either is unresolvable, and a documented fallback to raw
  ankle-y when the opposite ankle is resolvable in no frame of the clip.
- [x] 1.2 Detect on that series instead of raw ankle-y, leaving `footstrikeMinProminenceRatio` and
  `footstrikeMinIntervalSeconds` untouched and read exactly as before.
- [x] 1.3 Reject a maximum whose value is negative on the relative series (the striking foot was
  above the other), and skip that check on the fallback series where the sign is meaningless.
- [x] 1.4 Rewrite the module docs to state the contact-onset semantics, the derivative argument for
  why the maximum lands on touchdown, the `d_left ≡ −d_right` complement, and what the gap/fallback
  rules cost.

## 2. Tests

- [x] 2.1 Add an alternating two-leg gait fixture with an explicit stance/swing split: the planted
  foot pinned to the ground (it cannot bounce), the swinging foot carrying the body's oscillation at
  full strength, joined continuously.
- [x] 2.2 Test: a trailing leg's airborne ankle-y maximum is not emitted. Assert first that the
  fixture's raw ankle-y series really does contain it (three of them, 36 px above the ground), then
  that only the true contacts survive.
- [x] 2.3 Test: on a flat stance plateau the raw series' maximum lands nine frames after touchdown
  and the detector's lands one frame after it.
- [x] 2.4 Test: unchanged on a clean signal whose raw ankle-y already has one maximum per stride at
  the true contact.
- [x] 2.5 Test: every candidate on all three fixture shapes is within two sampled frames of a true
  touchdown, with alternating sides.
- [x] 2.6 Test: no candidate is ever reported on the foot that is above the other.
- [x] 2.7 Re-express the "hold the opposite ankle flat to isolate one side" idiom as an
  *unresolvable* opposite ankle, in `footstrikes.test.ts` and in `strideLength.test.ts`'s
  `buildHandFrames`. No assertion or expected value changes.

## 3. Verification

- [x] 3.1 `npx tsc -b` clean.
- [x] 3.2 `npx eslint` clean on every touched file.
- [x] 3.3 `npm test` green — 1224 passing, up from the 1219 baseline by the five tests added here.
- [x] 3.4 Confirm, by measurement rather than inspection, that the new signal is bit-identical to
  the old one on `generateSyntheticGait` and on `buildStrikeFrames` in both its forms.
- [x] 3.5 `openspec validate detect-footstrike-contact-onsets --strict`.

## 4. Round 2 — after live verification falsified two predictions

- [x] 4.1 Diagnose the 2.3x over-detection: the body's vertical motion survives the difference
  during single support (planted foot carries none, swinging foot carries all), so a stance can
  carry two confirmed maxima. Signature checked against Demo 1's own stance durations.
- [x] 4.2 Establish that the only derivable gate correction (sqrt(2), for the differenced signal's
  noise) is provably insufficient, and that a sufficient gate would have to exceed the runner's own
  vertical oscillation. Prominence left untouched.
- [x] 4.3 Reconcile the overstriding drop with the sign argument: the argument is an ordering claim,
  never a uniqueness claim, and a falling median with a widening spread is the expected reading of
  an over-detected mixture.
- [x] 4.4 Extract `STRIDE_PERIOD_TOLERANCE` and its helpers into `stridePeriod.ts` so
  `footstrikes.ts` can share the declaration without an import cycle; re-export from
  `strideLength.ts` so nothing else changes.
- [x] 4.5 Replace the chronological dedup with amplitude-descending greedy selection, excluding
  within the longer of `footstrikeMinIntervalSeconds` and the clip's shortest plausible stride.
- [x] 4.6 Derive the step frequency inside `detectFootstrikes` from the shared hip-bounce fit,
  gated at `cadenceMinFitR2`; fall back to the configured floor when it fails.
- [x] 4.7 Add `ARTIFACT_SHAPE` — a bouncier runner with a long mid-swing hang, whose contact series
  really does carry three confirmed maxima per stride (43.9 / 32.7 / -23.0) — and assert only the
  contacts are emitted.
- [x] 4.8 Add a test pinning the no-fittable-rhythm fallback path.
- [x] 4.9 Update the three downstream tests whose subject changed, recording in each what was
  measured rather than adjusting a tolerance: verticalRatio's clean-clip caveat is now null, its
  period-gate test moves to the doubling direction (the halving direction is now structurally
  unreachable), and cadence's cross-check uses the mean because the median is quantization-biased
  at 30fps. No tolerance moved.
- [ ] 3.6 Live verification round 2 on all three clips (owner runs this serially): emitted instants against
  the Demo 1 ground truth, `overstriding`'s per-instance MAD, whether `verticalRatio` returns, and
  `cadence` unchanged at 91.2 spm. Predictions are pre-registered in design.md D9.
- [ ] 3.7 Re-check `footStrikePattern`'s class label against keyframes rather than assuming it —
  the ticket's acceptance asks for this explicitly.
