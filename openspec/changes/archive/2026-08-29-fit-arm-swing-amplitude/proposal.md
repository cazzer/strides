# Fit the arm-swing amplitude instead of counting extrema

## Why

`armSwingSymmetry` read each arm's amplitude as the MEDIAN of prominence-thresholded peak-to-trough
excursions in that arm's wrist-relative-to-shoulder-y trace (`findLocalExtrema` at
`armSwingMinProminenceRatio × torsoLengthPx`). Measured live on Demo 2 (`park-approach.mp4`,
2026-08-29, real GPU, three fresh-Chromium-process trials, bit-identical), that scan confirms
roughly **twice as many half-swings as the clip contains**:

| | left arm | right arm |
|---|---|---|
| fitted rhythm | 1.48 Hz (half-cycle **0.338 s**) | 1.52 Hz (half-cycle **0.329 s**) |
| cadence cross-check | 181.2 spm ÷ 2 = 1.51 Hz stride rate | same |
| half-swings the scan confirmed | 9 | 9 |
| half-swings the window actually holds | ~4.8 (2.40 cycles) | ~5.0 (2.49 cycles) |
| their spacings, s | `0.200 0.234 0.500 0.184 0.050 0.150 0.100 0.100 0.067` | `0.117 0.133 0.150 0.184 0.167 0.050 0.317 0.167 0.334` |
| their amplitudes, px | `54.9 72.4 42.8 109.8 11.5 35.1 63.1 35.1 13.5` | `49.9 7.9 19.7 25.8 65.7 9.5 23.4 16.3 159.7` |

Six of the left arm's nine span under two-thirds of a half-cycle and the shortest is three frames.
The reported per-side amplitude is therefore a median over a MIXTURE of real half-swings and
tracking wiggle, and the exemplar — the pair whose amplitude sits nearest that median — inherits the
same problem: on Demo 2 it put a **0.5005 s** left pair on screen under a caption promising one
swing, half again as long as the 0.331 s half-cycle it claims to show.

This is the identical failure `verticalOscillation` retired its own extrema-pairing estimator for
(#28), for the identical reasons, and the fix is the same shared primitive.

A second defect surfaced while measuring, and it is the one that decides whether the headline number
means anything. On `multiperson-track.mp4` the left arm fits 1.48 Hz at R² 0.676 while the right
fits **2.80 Hz** at R² 0.324 — the right arm had latched onto the STEP rhythm (cadence 174 spm =
2.90 Hz), cleared any per-side quality gate, and the 0.349 ratio published between them was a
comparison of two different oscillations. A per-side gate structurally cannot catch this; only
comparing the two sides to each other can.

Third, the metric's confidence pooled the two arms' interpolation and read no fit quality at all, so
Demo 2 published **54.6% at confidence 0.980 ("High confidence")** while its right arm — the
weaker-looking one, and the one measured while the runner is furthest from the camera — fitted at
R² 0.497 against the left's 0.778. A symmetry metric that averages away a one-sided measurement
deficit is reporting the deficit as a finding.

## What Changes

- **Estimator.** Each side's amplitude becomes the PEAK-TO-PEAK amplitude of a spectral sinusoid fit
  (`fitSpectralSinusoid`, the shared primitive `verticalOscillation` and `cadence` already use) over
  the same wrist-relative-to-shoulder-y trace, on the same frequency grid. The trend terms absorb
  whole-body drift instead of charging it to the swing, and the amplitude comes from a rhythm rather
  than from a count of whichever wiggles cleared a threshold.
- **Cross-side rhythm check.** Both arms belong to one body and swing on one rhythm. When the two
  fitted frequencies disagree by more than 25%, the two amplitudes are not comparable and the metric
  reports `null` with a caveat saying so, rather than publishing a ratio between two different
  oscillations.
- **Publish gate.** A new `armSwingMinFitR2` (default `0.3`, matching `verticalOscillationMinFitR2` /
  `cadenceMinFitR2`) is read against the WEAKER arm's fit. It replaces `armSwingMinProminenceRatio`,
  which is deleted along with the estimator that was its only consumer.
- **Confidence answers "were both arms measured equally well?"** Every aggregate becomes a
  weakest-side reading: `interpolatedFraction` stops pooling the two arms and takes the worse,
  joining `frameCoverage` which already did; `sampleSize` becomes the smaller side's observed
  arm-swing CYCLE count against a floor of 2 (the same real demand the retired "at least 4
  half-swings" encoded); and a new `fitQuality` factor ramps on the weaker arm's R². When the two
  arms' fit qualities differ by more than 0.2 the result is additionally caveated, because a reader
  looking at an asymmetry needs to know when part of it may belong to the footage.
- **Exemplar.** The ghosted pair per side comes from the fitted PHASE via the shared
  `selectBounceInstants`, so it spans half a fitted period by construction — the same mechanism the
  vertical-oscillation family uses, including its `maximumIs` sign discipline.
- **Body scale is no longer required.** The ratio is two amplitudes in the same pixel space, so
  torso length cancels exactly; it was only ever needed to size the retired prominence threshold. A
  clip with no resolvable shoulders/hips now reports a value it could always have measured.

## Impact

- Affected specs: `form-heuristics`
- Affected code: `src/heuristics/armSwingSymmetry.ts`, `src/heuristics/types.ts` (config key swap),
  `src/heuristics/armSwingSymmetry.test.ts`
- **User-visible metric changes**, measured live, 3 fresh-process trials per clip, all bit-identical:

  | clip | before | after |
  |---|---|---|
  | Demo 2 (front, **primary**) | 0.5464 @ conf **0.980** (`normal` tier, "High confidence") | 0.6066 @ conf **0.385** (`caveated` tier, "Low confidence") |
  | Demo 1 (side, unsuitable) | 0.8208 @ conf 0.0678 | 0.9052 @ conf 0.0105 |
  | multiperson (side, unsuitable) | 0.3490 @ conf 0.0824 | **null** @ conf 0 |

  Demo 1 and multiperson are `viewFit: 'unsuitable'` and therefore already tier-3 `excluded` from
  the panel on both sides of this change — their rows move a number nobody is shown. Demo 2's tier
  move is the intended correction: the metric was overstating what it knew.
- Evidence coverage on Demo 2 is unchanged in shape (2 images, both sides, quality 1.0, 320 px
  crops); only the instants move — left `0.5005 s` -> `0.35035 s`, right `0.3170 s` -> `0.33367 s`,
  against a 0.331 s half-cycle.
- Regression anchor unaffected: Demo 1 `verticalOscillationCm` = `4.421467928439415`,
  `fit.frequencyHz × 60` = 91.2 = `cadence.value`, `subjectAgreement` 52/53, on all three trials.
