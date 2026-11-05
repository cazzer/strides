## 1. Core

- [x] 1.1 Move `LOCAL_TORSO_HALF_WINDOW_SECONDS` to `bodyScale.ts`, exported, doc generalized; `viewDetection.ts` imports it
- [x] 1.2 `fitBounceSpectrum` optional scale-normalized thunk; `BounceSpectrumResult.scaleNormalized`; module-doc section
- [x] 1.3 `hipBounce.ts`: `buildScaleNormalizedSamples`, `HipBounceAnalysis.scaleNormalized`, family-verdict doc amended
- [x] 1.4 `verticalOscillationCm.ts`: comment that the thunk is deliberately omitted
- [x] 1.5 `types.ts`: `VerticalOscillationFit.scaleNormalized`, `peakToPeakAmplitudePx` doc; `verticalOscillation.ts` passes it through
- [x] 1.6 Fixtures constructing `VerticalOscillationFit` literals carry `scaleNormalized: false`
- [x] 1.7 `verticalRatio` withholds on a scale-normalized fit (mixed-scale caveat)

## 2. Tests

- [x] 2.1 `bounceSpectrum.test.ts`: raw pass wins and thunk not called; sub-floor wins and thunk not called; third pass adopts; third pass fails; null/omitted thunk
- [x] 2.2 `hipBounce.test.ts`: synthetic approach fixture adopts (raw preconditions asserted); shuffled timestamps decline; hips-only declines; existing tests assert `scaleNormalized === false`
- [x] 2.3 `cadence.test.ts`, `verticalOscillation.test.ts` and `verticalRatio.test.ts` on the approach fixture
- [x] 2.5 `hipBounce.test.ts`: fitted max-of-sin instant pinned to the fixture's (sign); gap variants (whole-body dropout, shoulder gap longer than the torso window)
- [x] 2.4 `npm test`, `tsc -b`, `npm run lint`, `npm run build`, `openspec validate --strict`

## 3. Live verification

- [x] 3.1 A/B main vs branch on the four public clips (`--evidence --scale-pass`): identical apart from `elapsedMs` and the new `scaleNormalized: false` field
- [x] 3.2 Private `IMG_9349`: diff every metric between base and branch and justify each change (cadence and VO publish, `verticalOscillationFit.scaleNormalized` true on the primary line)
- [x] 3.3 `docs/agent-notes/vertical-oscillation.md` section with the live numbers
- [x] 3.4 Archive the change
