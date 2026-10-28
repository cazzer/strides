# Tasks

## 1. Search arm swing around the stride rate (`strides-eiil.1`, design D1)

- [x] 1.1 `resolveStrideRateHz(frames, config)` in `armSwing.ts`: hip-bounce frequency / 2, gated on
      `cadenceMinFitR2`, `null` otherwise
- [x] 1.2 `computeSideSwing` searches `[0.8, 1.2] × strideHz` at `0.02 × strideHz`
      (`ARM_SWING_BAND_HALF_WIDTH`, `ARM_SWING_BAND_STEP_FRACTION`); the config grid is no longer read
- [x] 1.3 `armSwingAmplitude`: no anchor → `null` with the running-rhythm caveat
- [x] 1.4 Tests: 1.0/1.1 Hz swings recovered; a 0.2 Hz retimed swing recovered; a step-rate
      component cannot be chosen; no-anchor null; fixtures carry a whole-body bounce at 2× the swing
- [x] 1.5 Live arm snapshot after this fix (Phase E)

## 2. Report per-stride travel (`strides-eiil.2`, design D2)

- [x] 2.1 `fitTrendAtFrequency` in `spectralFit.ts` (additive; existing tests unedited)
- [x] 2.2 `SideSwing.travelPx`: trend-removed, 3-point-median, median over complete stride windows
- [x] 2.3 `armSwingAmplitude` value = mean of the two sides' travel / torso; `null` travel → too-short
      caveat
- [x] 2.4 Tests: pure sine, sine + 2nd harmonic, triangle, single-frame spike, jitter, realistic
      fixture
- [x] 2.5 Live arm snapshot after this fix (Phase E)

## 3. Side view reads the near arm (`strides-eiil.3`, design D3)

- [x] 3.1 `resolveScaleStabilizer` takes a proxy (`shoulderSpanAt` | `torsoLengthAt`); fallback ladder
      unchanged
- [x] 3.2 `computeSideSwing(frames, side, { strideHz, scaleProxy })`
- [x] 3.3 `armSwingAmplitude` side branch: near arm by directly-detected count, torso proxy,
      near-arm gates/confidence/caveat/exemplar; tie → both-arms rule
- [x] 3.4 `viewFitTable.armSwingAmplitude.side = { fit: 'tolerated', multiplier: 0.6 }`; doc updates
      in `types.ts`
- [x] 3.5 `metricDescriptions.ts` copy
- [x] 3.6 Tests: near-arm value/caveat/exemplar, far arm cannot null, tie, torso proxy vs
      superimposed shoulders, exact no-op for both proxies; existing side-unsuitable assertions
      updated
- [x] 3.7 `npx tsc -b`, lint, full vitest, `vite build`, `openspec validate --strict`

## 4. Verification and record

- [x] 4.1 Live A/B main vs branch on side-landscape, side-portrait, front-approach, multiperson:
      every non-arm field bit-identical
- [x] 4.2 Arm value/confidence/viewFit/caveat per clip, base and after each fix
- [x] 4.3 Keyframe sanity: near arm on side-landscape (left) and side-portrait (right)
- [x] 4.4 `docs/agent-notes/mediapipe-front-view.md` table + rationale; CLAUDE.md "Current facts" line

## 5. Review round 1

- [x] 5.1 Travel needs ≥ 2 complete hip-anchored strides; caveat names "fewer than 2 complete arm swings"
- [x] 5.2 Windows `1/strideHz`, sliding by a quarter period; median of max − min
- [x] 5.3 Hampel spike guard (half-width 2, k = 3) replaces the 3-point median; tested at 60 fps and ~26 Hz
- [x] 5.4 MoveNet L/R label-swap fixture; behaviour stated in design.md
- [x] 5.5 Side-view tie caveat; body scale checked before the stride anchor
- [x] 5.6 Wrong-angle hint copy; exemplar requirement MODIFIED; docs and CLAUDE.md line
- [x] 5.7 Live A/B on the final commit: non-arm fields bit-identical to base; arm readings recorded

## 6. Review round 2

- [x] 6.1 Stride count documented as a hard floor only (confidence values unchanged)
- [x] 6.2 Hampel scale floored at 0.1 × the series' own MAD; plateau-beside-peak test
- [x] 6.3 A non-stride travel failure gets its own caveat (`TOO_SPARSE_SWINGS_CAVEAT`)
- [x] 6.4 The two-stride check uses the window loop's boundary slack
- [x] 6.5 Hipless clip asserts the body-scale caveat, not the rhythm one
