## Why

On front-approach footage where the runner grows several-fold in frame, the shared hip-bounce fit
withholds cadence and vertical oscillation even though the rhythm is plainly there. On private
`IMG_9349` (live probe, `strides-p1qt`) the raw pixel hip-mid fit lands on the right frequency
(3.08 Hz) but scores a partial R² of 0.100 / 0.087 against a gate of 0.30: the pixel bounce grows
~9× with the approach, and the fit's quadratic trend cannot follow the perspective descent, so the
residual the sinusoid is judged against is dominated by everything the trend missed. An offline
replica of the series below scores 0.379 / 0.357 there and changes no other clip in the 9-clip set.

## What Changes

- `fitBounceSpectrum` gains an optional, lazily-built **scale-normalized** series, consulted only
  when neither the in-band pass nor the sub-floor pass is adopted. It is fitted on the in-band grid
  only and adopted only if it clears the same `verticalOscillationMinFitR2` gate; otherwise pass 1's
  result is returned untouched. No new threshold, no gate or grid change.
- `analyzeBounceSignal` supplies the series: frame-to-frame changes in the raw signal y divided by
  the mean of the two frames' local torso lengths (±0.5 s windowed median), integrated with the
  image-y sign kept and no reset across gaps, times the clip-median torso. `hipY` stays raw.
- `HipBounceAnalysis.scaleNormalized` and `VerticalOscillationFit.scaleNormalized` report adoption;
  the diagnostics export carries it through `verticalOscillationFit`.
- `verticalRatio` withholds (value null, plain caveat) when the bounce fit is scale-normalized,
  rather than dividing a median-scale amplitude by a raw-pixel stride length.
- `verticalOscillationCm` deliberately does not take the fallback: its metre series is already
  delta-integrated over per-frame scale.
- `LOCAL_TORSO_HALF_WINDOW_SECONDS` moves from `viewDetection.ts` to `bodyScale.ts` (no behaviour
  change) so both users share it.

## Capabilities

### New Capabilities

### Modified Capabilities
- `form-heuristics`: the two-pass bounce fit gains a last-resort scale-normalized pass; cadence's
  fit clause names it.
- `analysis-diagnostics`: `verticalOscillationFit.scaleNormalized` in the export.

## Impact

`src/heuristics/bounceSpectrum.ts`, `hipBounce.ts`, `bodyScale.ts`, `viewDetection.ts`,
`verticalOscillation.ts`, `verticalOscillationCm.ts` (comment only), `types.ts`;
`src/results/analysisDiagnostics.ts` (doc only) and three test fixtures that construct
`VerticalOscillationFit` literals. Every clip whose first or second pass is adopted today is
bit-identical apart from the new `scaleNormalized: false` field; only clips that currently
withhold the bounce family can change.

On `IMG_9349`, adopting the fallback has side effects beyond cadence and VO, because the bounce fit
now clears `cadenceMinFitR2`:

- footstrikes switch from the ankle-difference fallback to the bounce-phase path, so
  `overstriding`, `footStrikePattern`, `stepWidth`, and the scale pass's grafted `stepWidthCm` can
  move;
- the `armSwingAmplitude` frequency anchor and the `swingFootLateralExcursion` outline windows
  become available;
- `verticalRatio` withholds with the mixed-scale caveat.

`src/heuristics/verticalRatio.ts` is touched for that gate, and `footstrikes.ts` for a doc line.
