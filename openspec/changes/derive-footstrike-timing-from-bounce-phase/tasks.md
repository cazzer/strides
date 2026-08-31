# Tasks

## 1. Detector

- [x] 1.1 In `src/heuristics/footstrikes.ts`, add a phase-derived timing path: fitted low points at
  `tMean + (π/2 − φ)/ω + k·T`, touchdown at `low − T/4`, one per bounce cycle inside the frames'
  own span.
- [x] 1.2 Snap each predicted instant to the nearest sampled frame within half the median frame
  interval; drop any that cannot be snapped. Deduplicate on frame index.
- [x] 1.3 Attribute side from the ankles. **Superseded during measurement by 7.1** — the per-instant
  reading planned here was measured failing on Demo 1.
- [x] 1.4 Gate the path on `fit.ok && fit.sinusoidR2 >= config.cadenceMinFitR2` — the key
  `resolveStepFrequencyHz` already reads. No new config key, no new constant.
- [x] 1.5 Retain the existing ankle-difference detector verbatim as the fallback, exported for the
  unit suite so both paths can be measured on the same fixture. Fall back when the gate fails **or**
  when the phase path yields no candidate.
- [x] 1.6 Confirm `src/heuristics/stridePeriod.ts` needs no change, and that
  `spectralFit.ts` / `hipBounce.ts` / `bounceInstants.ts` are untouched.

## 2. Fixture correction

- [x] 2.1 In `src/heuristics/__fixtures__/syntheticGait.ts`, shift the hip/shoulder/head bounce term
  by half a period so the body's lowest point falls after contact rather than before it. Document
  the resulting duty factor and why the old phase was impossible.
- [x] 2.2 Verify amplitude- and frequency-derived expectations elsewhere in the suite are unchanged
  by the shift.

## 3. Unit evidence

- [x] 3.1 Rewrite the swing-apex sweep in `footstrikes.test.ts` to run **both** paths on the same
  fixtures and assert: the ankle path's lag is `[1, 3, 5, 6, 11]`; the phase path's is constant.
- [x] 3.2 Add a **stance sweep** asserting the phase path's lag follows `(stance − T/2)/2` and the
  ankle path's does not.
- [x] 3.3 Assert the phase path emits one instant per step and alternating feet, and that one
  swapped-ankle instant cannot flip the assignment (see 7.1).
- [x] 3.4 Assert the fallback fires below `cadenceMinFitR2` and on a single-resolvable-ankle clip,
  producing exactly the pre-change instants.
- [x] 3.5 Update the four consumers' tests for the moved instants; keep every hand-computed
  expectation hand-computed.

## 4. Gates

- [x] 4.1 `npx tsc -b` clean.
- [x] 4.2 `npx eslint src/` clean.
- [x] 4.3 `npm test` green.

## 5. Live verification

- [x] 5.1 Headless Chromium, real GPU, fresh process per trial, ≥3 trials, all three clips, before
  and after.
- [x] 5.2 Record every consumer metric's value, confidence and tier per clip, before and after.
- [x] 5.3 Probe the emitted instants on Demo 1 and compare against the measured onsets
  3.98 / 4.68 / 5.24 / 5.92 s. Revert the probe.
- [x] 5.4 Adjudicate da8's falsifiable prediction (overstriding on Demo 1 should rise by order
  0.5–0.9) and record the verdict either way.
- [x] 5.5 Check the regression anchor: Demo 1 `verticalOscillationCm` = `4.421467928439415`,
  `fit.frequencyHz × 60` = 91.2 = `cadence.value`.
- [x] 5.6 Fill in design.md D10/D11/D12.

## 6. Wrap-up

- [x] 6.1 `openspec validate derive-footstrike-timing-from-bounce-phase --strict`.
- [x] 6.2 Update the module docs in `footstrikes.ts` and any consumer doc comment that describes the
  old timing as the only timing. Do **not** archive.

## 7. Found while measuring (added after the plan)

- [x] 7.1 Side attribution moved from a per-instant ankle read to clip-wide alternation with a
  magnitude-weighted parity vote. The per-instant read emitted two consecutive same-side instants on
  Demo 1 and took `verticalRatio` to `null`; see design D2, W5 and D11.2.
- [x] 7.2 Demo 1's contact onsets re-measured from keyframes. `strides-da8`'s recorded onsets are
  1.5-4 frames early and irregularly spaced; the corrected set is uniform at the clip's own step
  period. Recorded in design D11.1 — the acceptance criterion and the falsifiable prediction were
  both stated against the wrong numbers.
