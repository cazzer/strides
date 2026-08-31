# Tasks

## 1. Detector

- [ ] 1.1 In `src/heuristics/footstrikes.ts`, add a phase-derived timing path: fitted low points at
  `tMean + (π/2 − φ)/ω + k·T`, touchdown at `low − T/4`, one per bounce cycle inside the frames'
  own span.
- [ ] 1.2 Snap each predicted instant to the nearest sampled frame within half the median frame
  interval; drop any that cannot be snapped. Deduplicate on frame index.
- [ ] 1.3 Attribute side from the ankles: the striking foot is the lower one at the snapped frame.
  Drop the instant when either ankle is unresolvable there.
- [ ] 1.4 Gate the path on `fit.ok && fit.sinusoidR2 >= config.cadenceMinFitR2` — the key
  `resolveStepFrequencyHz` already reads. No new config key, no new constant.
- [ ] 1.5 Retain the existing ankle-difference detector verbatim as the fallback, exported for the
  unit suite so both paths can be measured on the same fixture. Fall back when the gate fails **or**
  when the phase path yields no candidate.
- [ ] 1.6 Confirm `src/heuristics/stridePeriod.ts` needs no change, and that
  `spectralFit.ts` / `hipBounce.ts` / `bounceInstants.ts` are untouched.

## 2. Fixture correction

- [ ] 2.1 In `src/heuristics/__fixtures__/syntheticGait.ts`, shift the hip/shoulder/head bounce term
  by half a period so the body's lowest point falls after contact rather than before it. Document
  the resulting duty factor and why the old phase was impossible.
- [ ] 2.2 Verify amplitude- and frequency-derived expectations elsewhere in the suite are unchanged
  by the shift.

## 3. Unit evidence

- [ ] 3.1 Rewrite the swing-apex sweep in `footstrikes.test.ts` to run **both** paths on the same
  fixtures and assert: the ankle path's lag is `[1, 3, 5, 6, 11]`; the phase path's is constant.
- [ ] 3.2 Add a **stance sweep** asserting the phase path's lag follows `(stance − T/2)/2` and the
  ankle path's does not.
- [ ] 3.3 Assert the phase path emits one instant per step, alternating feet, and never attributes a
  strike to the higher foot.
- [ ] 3.4 Assert the fallback fires below `cadenceMinFitR2` and on a single-resolvable-ankle clip,
  producing exactly the pre-change instants.
- [ ] 3.5 Update the four consumers' tests for the moved instants; keep every hand-computed
  expectation hand-computed.

## 4. Gates

- [ ] 4.1 `npx tsc -b` clean.
- [ ] 4.2 `npx eslint src/` clean.
- [ ] 4.3 `npm test` green.

## 5. Live verification

- [ ] 5.1 Headless Chromium, real GPU, fresh process per trial, ≥3 trials, all three clips, before
  and after.
- [ ] 5.2 Record every consumer metric's value, confidence and tier per clip, before and after.
- [ ] 5.3 Probe the emitted instants on Demo 1 and compare against the measured onsets
  3.98 / 4.68 / 5.24 / 5.92 s. Revert the probe.
- [ ] 5.4 Adjudicate da8's falsifiable prediction (overstriding on Demo 1 should rise by order
  0.5–0.9) and record the verdict either way.
- [ ] 5.5 Check the regression anchor: Demo 1 `verticalOscillationCm` = `4.421467928439415`,
  `fit.frequencyHz × 60` = 91.2 = `cadence.value`.
- [ ] 5.6 Fill in design.md D10/D11/D12.

## 6. Wrap-up

- [ ] 6.1 `openspec validate derive-footstrike-timing-from-bounce-phase --strict`.
- [ ] 6.2 Update the module docs in `footstrikes.ts` and any consumer doc comment that describes the
  old timing as the only timing. Do **not** archive.
