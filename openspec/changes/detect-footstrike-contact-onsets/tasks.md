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
- [ ] 3.6 Live verification on all three clips (owner runs this serially): emitted instants against
  the Demo 1 ground truth, `overstriding`'s per-instance MAD, whether `verticalRatio` returns, and
  `cadence` unchanged at 91.2 spm. Predictions are pre-registered in design.md D9.
- [ ] 3.7 Re-check `footStrikePattern`'s class label against keyframes rather than assuming it —
  the ticket's acceptance asks for this explicitly.
