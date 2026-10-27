# Tasks

## 1. Search arm swing around the stride rate (`strides-eiil.1`, design D1)

- [ ] 1.1 `resolveStrideRateHz(frames, config)` in `armSwing.ts`: hip-bounce frequency / 2, gated on
      `cadenceMinFitR2`, `null` otherwise
- [ ] 1.2 `computeSideSwing` searches `[0.8, 1.2] × strideHz` at `0.02 × strideHz`
      (`ARM_SWING_BAND_HALF_WIDTH`, `ARM_SWING_BAND_STEP_FRACTION`); the config grid is no longer read
- [ ] 1.3 `armSwingAmplitude`: no anchor → `null` with the running-rhythm caveat
- [ ] 1.4 Tests: 1.0/1.1 Hz swings recovered; a 0.2 Hz retimed swing recovered; a step-rate
      component cannot be chosen; no-anchor null; fixtures carry a whole-body bounce at 2× the swing
- [ ] 1.5 Live arm snapshot after this fix (Phase E)

## 2. Report per-stride travel (`strides-eiil.2`, design D2)

- [ ] 2.1 `fitTrendAtFrequency` in `spectralFit.ts` (additive; existing tests unedited)
- [ ] 2.2 `SideSwing.travelPx`: trend-removed, 3-point-median, median over complete stride windows
- [ ] 2.3 `armSwingAmplitude` value = mean of the two sides' travel / torso; `null` travel → too-short
      caveat
- [ ] 2.4 Tests: pure sine, sine + 2nd harmonic, triangle, single-frame spike, jitter, realistic
      fixture
- [ ] 2.5 Live arm snapshot after this fix (Phase E)

## 3. Side view reads the near arm (`strides-eiil.3`, design D3)

- [ ] 3.1 `resolveScaleStabilizer` takes a proxy (`shoulderSpanAt` | `torsoLengthAt`); fallback ladder
      unchanged
- [ ] 3.2 `computeSideSwing(frames, side, { strideHz, scaleProxy })`
- [ ] 3.3 `armSwingAmplitude` side branch: near arm by directly-detected count, torso proxy,
      near-arm gates/confidence/caveat/exemplar; tie → both-arms rule
- [ ] 3.4 `viewFitTable.armSwingAmplitude.side = { fit: 'tolerated', multiplier: 0.6 }`; doc updates
      in `types.ts`
- [ ] 3.5 `metricDescriptions.ts` copy
- [ ] 3.6 Tests: near-arm value/caveat/exemplar, far arm cannot null, tie, torso proxy vs
      superimposed shoulders, exact no-op for both proxies; existing side-unsuitable assertions
      updated
- [ ] 3.7 `npx tsc -b`, lint, full vitest, `vite build`, `openspec validate --strict`

## 4. Verification and record

- [ ] 4.1 Live A/B main vs branch on side-landscape, side-portrait, front-approach, multiperson:
      every non-arm field bit-identical
- [ ] 4.2 Arm value/confidence/viewFit/caveat per clip, base and after each fix
- [ ] 4.3 Keyframe sanity: near arm on side-landscape (left) and side-portrait (right)
- [ ] 4.4 `docs/agent-notes/mediapipe-front-view.md` table + rationale; CLAUDE.md "Current facts" line
