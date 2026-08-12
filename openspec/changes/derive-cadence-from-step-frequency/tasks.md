## 1. OpenSpec change

- [x] 1.1 `openspec new change derive-cadence-from-step-frequency`; write `proposal.md`,
      `design.md` (D1–D7 + relied-on-not-modified list), `specs/form-heuristics/spec.md` delta
      (REMOVE + ADD, see design.md D7 for why REMOVE+ADD over MODIFIED).
- [x] 1.2 `openspec validate derive-cadence-from-step-frequency --strict` passes. Do NOT archive —
      epic-level archiving happens post-merge, in dependency order.

## 2. Shared hip-bounce signal

- [x] 2.1 `src/heuristics/hipBounce.ts` (new): `analyzeHipBounce(frames, config)` per design.md
      D2 — owns `resolveMidpoint('left_hip', 'right_hip')` traversal, resolved/interpolated
      counts, `SpectralSample[]` build, `fitSpectralSinusoid` call over the shared `spectralFit*`
      config keys. Returns `{ hipY, resolvedCount, interpolatedCount, frameCoverage,
      interpolatedFraction, fit }`. Guards `frames.length === 0` and `resolvedCount === 0` against
      `0/0`. Module doc: shared signal, not a metric; policy stays in callers.
- [x] 2.2 `src/heuristics/hipBounce.test.ts` (new): empty frames → `frameCoverage: 0` +
      too-few-samples fit failure; interpolated hips raise `interpolatedFraction` without
      changing `frameCoverage`.

## 3. Vertical oscillation refactor (zero-assertion-change gate)

- [x] 3.1 `src/heuristics/verticalOscillation.ts`: replace the inline
      traversal/counting/`SpectralSample[]`-build/`fitSpectralSinusoid` call with
      `analyzeHipBounce`. `runMeanHipY` (chart baseline) computed from the returned `hipY`.
- [x] 3.2 `src/heuristics/__fixtures__/hipTraceFrames.ts` (new): promote `framesFromHipTrace`,
      `mulberry32`, `seededNormals` out of `verticalOscillation.test.ts`. Keep the
      `pixelsPerMeter: null` field `framesFromHipTrace`'s frame literals already carry.
- [x] 3.3 `verticalOscillation.test.ts`: import the promoted helpers from
      `__fixtures__/hipTraceFrames.ts` instead of defining them locally. **Gate: every existing
      assertion passes unchanged — only import lines move.**

## 4. Types and config

- [x] 4.1 `src/heuristics/types.ts`: add `cadenceMinFitR2: 0.30` with full doc (calibration
      transfer from vertical oscillation's, n-dependence warning, F-test upgrade-path note — D3).
      Reword `spectralFitMinFrequencyHz`/`MaxFrequencyHz`/`FrequencyStepHz` doc comments as shared
      across both callers, stating the steps/min equivalence (D5).
- [x] 4.2 `MetricResult.sampleSize` doc: note cadence's unit is now steps (from the fit's observed
      cycle count), replacing the old footstrike-count description.
- [x] 4.3 `viewFitTable.cadence.front.multiplier` 0.8 → 0.85; rewrite the `cadence` comment block
      (D7) — the old ankle-occlusion justification no longer applies.

## 5. Cadence rewrite

- [x] 5.1 `src/heuristics/cadence.ts`: stop importing `detectFootstrikes`/`estimateBodyScale`/
      `resolvePoint`. Call `analyzeHipBounce`; gate on `cadenceMinFitR2`; `value =
      fit.frequencyHz * 60`; `sampleSize = Math.floor(fit.observedCycles)`; confidence fed the
      unrounded `fit.observedCycles`; `fitQuality` ramp (`FIT_QUALITY_SATURATION_R2 = 0.8` module
      constant); band-edge caveat (D5); joined multi-caveat text (D4). Rename
      `MIN_CADENCE_SAMPLE_SIZE` → `MIN_CADENCE_STEPS`, value unchanged (4), doc rewritten (D4).
- [x] 5.2 Module doc: why `f* × 60` is spm (physical basis), why no fallback/cross-check (D1), the
      ~30%-high measurement that motivated this, the n-regime note on `cadenceMinFitR2` (D3).

## 6. Tests

- [x] 6.1 `cadence.test.ts` (rewrite) — see spec below for the 13 cases.
- [x] 6.2 `hipBounce.test.ts` — see 2.2.
- [x] 6.3 `index.test.ts`: add the drift-guard assertion — on the clean fixture,
      `cadence.value / 60 === verticalOscillation.fit.frequencyHz` EXACTLY, and
      `cadence.sampleSize === verticalOscillation.sampleSize`.
- [x] 6.4 Regression check: `verticalOscillation.test.ts` imports-only change (3.3);
      `footstrikes.test.ts`, `overstriding.test.ts`, `footStrikePattern.test.ts` untouched and
      passing.

## 7. Doc-only follow-up commit (separate from the above)

- [x] 7.1 Fix "complete gait cycles" → "bounce cycles" (= steps, per this ticket's physical
      basis) mislabels in: `verticalOscillation.ts` module doc, `types.ts`
      (`verticalOscillationMinCycles` doc, `MetricResult.sampleSize` doc), and the one "complete
      gait cycles" line in `openspec/changes/adopt-spectral-vo-estimator/specs/form-heuristics/
      spec.md`. Do NOT change the number `3`. User-visible caveat strings already say "bounce
      cycle" — leave those.
- [x] 7.2 `openspec validate adopt-spectral-vo-estimator --strict` passes after the wording fix.

## 8. Verification

- [x] 8.1 `npx tsc -b` — no errors.
- [x] 8.2 `npx vitest run` — all passing.
- [x] 8.3 `npx eslint .` — no issues.
- [x] 8.4 Live verification, 5 trials/clip, both demo buttons, MoveNet default, real GPU. Results
      below.

### cadence.test.ts case list (13)

1. `generateSyntheticGait({cadenceStepsPerMin:170, verticalBouncePx:20, durationSec:4, fps:30,
   view:'side'})` → value within 1.2 spm of 170; `sampleSize` 11; confidence>0.9; caveat null.
2. Same, parameterized over 120/170/200 spm.
3. On the clean fixture, old-path `60/median(detectFootstrikes intervals)` agrees with the new
   value within a couple spm (documents divergence only where the old path was wrong).
4. Gaps: contiguous ~0.3s hole AND every-third-frame dropout → value unchanged vs. ungapped;
   `frameCoverage < 1`.
5. Port the existing dead-time/padding test verbatim (padding contributes no samples).
6. Sub-one-cycle (1.4Hz over 0.6s) → null, confidence 0, caveat `/too short to contain a complete
   step/`.
7. Seeded noise-only n=90 → null, caveat names measured quality AND 0.30.
8. Sine + 0.6x noise → non-null, confidence equals the ramp exactly (other factors 1), fit-quality
   caveat present.
9. Clean sine spanning 2.25 steps → `sampleSize` 2, confidence ≈ 0.5625 (2.25/4 unrounded,
   fitQuality saturated) — locks unrounded-vs-floored.
10. Clean 4.0Hz → ≈240 + band-edge caveat naming the range; same at 1.2Hz.
11. Front view: 0.85 multiplier, `viewFit` `'tolerated'`, AND front value === side value exactly;
    ambiguous 0.6.
12. Never-throws/never-NaN sweep: `[]`, clean, `verticalBouncePx:0`, front, noise, 5-frame ramp ×
    three views.
13. No resolvable hips → null, caveat `/hip position/` (replaces the old body-scale test).

## Live verification results

5 trials per clip, MoveNet default (no backend override), headless Chromium with real GPU
(`--headless=new --enable-gpu --ignore-gpu-blocklist`, `Google Chrome for Testing` binary), dev
server on port 5283. Zero `sampling.totalSamples === 1` flakes encountered (0/10 trials) — no
exclusions or re-runs needed.

### Track clip (`try a demo video`)

| trial | cadence value | confidence | sampleSize | f* (Hz) | sinusoidR² | caveat |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 93.60 | 0.7332 | 2 | 1.56 | 0.818 | step-count shortfall |
| 2 | 94.80 | 0.7268 | 2 | 1.58 | 0.823 | step-count shortfall |
| 3 | 93.60 | 0.7176 | 2 | 1.56 | 0.813 | step-count shortfall |
| 4 | 93.60 | 0.7314 | 2 | 1.56 | 0.799 | step-count shortfall + fit-quality (R² 0.80 just under saturation) |
| 5 | 93.60 | 0.6876 | 2 | 1.56 | 0.779 | step-count shortfall + fit-quality |

**Track medians**: cadence value **93.6** spm, confidence **0.7268**, sampleSize **2**, f* **1.56 Hz**.

### Park clip (`try another demo (park, front view)`)

| trial | cadence value | confidence | sampleSize | f* (Hz) | sinusoidR² | caveat |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 180.00 | 0.6706 | 4 | 3.00 | 0.694 | fit-quality |
| 2 | 181.20 | 0.6803 | 4 | 3.02 | 0.700 | fit-quality |
| 3 | 181.20 | 0.6443 | 4 | 3.02 | 0.679 | fit-quality |
| 4 | 180.00 | 0.6548 | 4 | 3.00 | 0.685 | fit-quality |
| 5 | 181.20 | 0.6180 | 4 | 3.02 | 0.664 | fit-quality |

**Park medians**: cadence value **181.2** spm, confidence **0.6548**, sampleSize **4**, f* **3.02 Hz**.

### Medians vs. acceptance criteria

| criterion | target | measured | verdict |
| --- | --- | --- | --- |
| track cadence median | 85–105 spm (expect ≈93.6) | **93.6** | pass, exact match to the predicted value |
| park cadence median | 175–195 spm (expect ≈180) | **181.2** | pass |
| `cadence.value === verticalOscillationFit.frequencyHz × 60`, every non-null trial | exact | true on all 10/10 trials | pass |
| other six metrics' medians within their recorded cross-trial spread | — | verticalOscillation track median 0.1774 (prior baseline session: 0.1758), park median 0.2334 (prior: 0.2375) — both inside the previously-recorded spread; trunkLean/overstriding/kneeFlexion/armSwingSymmetry/footStrikePattern all landed in their usual per-view confidence/value bands (unsuitable-view metrics stayed low-confidence, primary-view metrics stayed high-confidence) | pass |
| `sampling.totalSamples === 1` flake | known ~2/9 rate | 0/10 | no flakes hit this run |

### Pre-declared D4 effects, observed

- Track: confidence moved from the old footstrike-path's ≈1.00 (saturated) to a median **0.7268**
  — matches the ≈0.72 predicted in design.md D4. `sampleSize` moved from the old footstrike count
  (5) to the floored step count, **2**, exactly as predicted.
- Park: confidence moved from ≈0.80 to a median **0.6548** (≈0.65) — matches the ≈0.66 predicted
  in design.md D4, and crosses `MetricsPanel`'s 0.7 High/Medium display threshold as expected.
- The previously-observed track outlier trial (partial R² 0.397, 104.4 spm) did not recur in this
  5-trial sample — an intermittent anomaly, not something every run hits; not a pass/fail
  criterion for this verification.

**Verdict: PASS.** Both clips land inside their acceptance bands, the drift-guard exact-equality
check holds on every trial, and every pre-declared confidence/sampleSize shift in D4 is confirmed
as expected, not a regression.
