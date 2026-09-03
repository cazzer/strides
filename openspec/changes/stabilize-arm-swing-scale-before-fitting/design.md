# Design — stabilize-arm-swing-scale-before-fitting

## D1 — Root cause (strides-101): the raw-pixel fit reads the clip's end, not its window

Measured on Demo 2 (`park-approach.mp4`), the arm-swing family's primary clip, via the
`strides-101` per-frame probe dump (`arm-swing-probe.json`: every wrist/shoulder track plus both
sides' fit internals):

- The **inter-shoulder span grows from ~120 px to ~358 px inside the fit window** — the subject
  approaches the camera, so every body-proportioned pixel quantity, the wrist-relative-to-shoulder
  excursion included, is amplitude-modulated ~3× across the very window one constant-amplitude
  sinusoid is fitted over.
- Shipped (raw-pixel) fits: **left 72.8 px @ 1.48 Hz, R² 0.778; right 44.2 px @ 1.52 Hz,
  R² 0.497; ratio 0.6066** (`armSwingSymmetry`'s standing Demo 2 value, confidence 0.385).
- Least squares minimizes squared PIXEL residuals, so a late frame at 3× scale carries ~9× the
  residual weight of an early one (**~9:1 RSS overweighting** toward the large-scale end). The
  fitted "amplitude" is therefore mostly a reading of the clip's end, and the systematic
  amplitude mismatch everywhere else is charged to the residual — depressing both sides' R² for a
  reason that is the estimator's premise violation, not the footage.

The two sides' fitted frequencies also straddle the true rhythm (1.48 vs 1.52 Hz) — each side's
grid search is pulled by where its scale-modulated envelope happens to bulge.

## D2 — The correction, and the confound in the bead's original reference number

`strides-egw` originally cited **~0.734** as the "scale-corrected" Demo 2 ratio, from a
quad-detrended p95−p5 reading of the body-unit series. **That reference was
estimator-confounded and is superseded**: p95−p5 reads each side's best-moment excursions, while
the shipped estimator reads a whole-window average amplitude — two different statistics of the
same series, so their gap is not the scale effect alone.

The clip's asymmetry is genuinely **time-varying**: in body units the right arm's swing envelope
ramps from ~16.5 up to ~61 while the left's falls from ~92 to ~52 across the window. The early
right-arm quietness is keyframe-confirmed REAL, not a tracking artifact — the right wrist is
detected in **98/99** frames against the left's **95/99**, i.e. the "weaker" arm is the
better-tracked one. A window-average estimator on the corrected series therefore reports a LOWER
ratio than the raw one, not a higher one: the raw fit's late-frame overweighting flatters the
right arm exactly when it swings biggest.

**Predicted by the log-quad port of the exact estimator** (the pre-registered expectation this
implementation must land on): ratio **~0.518**, both sides **1.50/1.50 Hz** (vs 1.48/1.52 raw),
weakest R² **0.497 → ~0.512**. The user approved this direction — Demo 2 moves DOWN — on
2026-09-03.

## D3 — The stabilizer's construction, piece by piece

- **Proxy: per-frame inter-shoulder distance, STRICT bilateral** (`resolveBilateralPair`, never
  `resolveMidpoint`'s single-side fallback). A scale needs two real points; a span against a
  fabricated stand-in is a fabricated length — the recorded fabricated-scale bug class
  (`pixelsPerMeter` is never interpolated for the same reason).
- **Trend: whole-window least-squares quadratic in LOG space**, `log(span) ≈ c + d·t + e·t²`,
  time centered at the proxy samples' mean before the basis is built (the same conditioning trick
  `spectralFit.ts` documents). Log space because scale is multiplicative and the exponentiated
  trend is positive by construction. Three degrees of freedom because a 3-dof polynomial cannot
  represent ANY in-band (1.2–4 Hz) frequency over a multi-second window: the stride-rate
  inter-shoulder wobble the span genuinely carries (trunk counter-rotation, **~5.8% rms**
  measured on Demo 2) structurally cannot leak into the divisor, where it would multiply straight
  into the swing series as in-band noise.
- **Factor `f(t) = exp(trend(t)) / referencePx`**, `referencePx` = median of the measured spans —
  so the divided series stays in px at the clip's reference scale, and downstream semantics are
  untouched: the symmetry ratio still cancels units, and `armSwingAmplitude`'s clip-median torso
  denominator pairs with a numerator standardized at the same median instant.
- **No clamp on `f(t)`** (decided): inside the observed window the exponentiated fit stays within
  the data's own range; the fallback ladder guards the degenerate cases.
- **Fallback ladder — every rung the CONSTANT 1**, an exact no-op equal to the pre-change
  raw-pixel computation: fewer than `MIN_SCALE_TREND_SAMPLES = 12` usable proxy frames (the same
  bar as `MIN_SPECTRAL_FIT_SAMPLES`, same reasoning); an unsolvable trend system; **a fitted
  trend flat to within `FLAT_TREND_LOG_RANGE = 1e-6`**; a non-finite/non-positive factor at
  evaluation (unreachable in practice, "never NaN" contract).

**The flat-trend rung is an implementation finding, added during this change** rather than
pre-registered: without it, a truly constant proxy leaves `d`/`e` at ~1e-14-level solver noise,
and dividing a CONSTANT series by `exp(~1e-14 wobble)` perturbs its values at the same order as
their own floating-point rounding — enough to turn a motionless-arm clip's honest
`'degenerate-signal'` ("no oscillating vertical motion to measure") into a spurious
below-quality-gate reading over pure rounding noise. Caught by the existing motionless-arm unit
test. 1e-6 is a degeneracy floor in `DEGENERACY_RELATIVE_FLOOR`'s spirit, not a tuning knob: a
one-part-in-a-million within-window scale change is meaningless to any amplitude while sitting
eight orders above the coefficient noise. This is what makes the load-bearing constant-scale
no-op EXACT (bit-identical) rather than ±fp-epsilon approximate.

## D4 — Invariants held, by construction and by test

- `seriesY`'s null pattern, `resolvedCount`, `interpolatedCount`: bit-identical to the raw
  computation — the trend evaluates at every timestamp, so a frame whose proxy is missing still
  gets a factor and no swing sample is ever dropped.
- Sign convention: the divisor is positive by construction, so ordering is preserved and
  `maximumIs: 'lowest'` (image-y grows downward → fitted maximum = wrist lowest on screen) stays
  truthful, captions included.
- Constant-scale fixtures: factor identically 1 (D3's flat-trend rung), so every pre-existing
  value assertion passes untouched; pinned explicitly by the new
  "constant-scale clip reads numerically as the raw-pixel computation" case, which compares the
  metric against an independent raw-pixel re-computation via `fitSpectralSinusoid`.
- Gates and policy constants untouched: `MIN_ARM_SWING_CYCLES`, `FIT_QUALITY_SATURATION_R2`,
  `MAX_SIDE_FREQUENCY_DISAGREEMENT`, `SIDE_FIT_QUALITY_DISPARITY_R2`, `armSwingMinFitR2`. The
  shared-gate-policy placement (constants in `armSwing.ts`, per the #36 one-gate-per-signal rule)
  is preserved.

## D5 — Offline verification against the strides-101 probe, and the expected live A/B

The real Demo 2 per-frame tracks from `arm-swing-probe.json` were replayed through the SHIPPED
`computeSideSwing` (a temporary scratch vitest file, added-measured-deleted per the repo's
probe cycle):

| | raw (shipped before) | predicted (log-quad port) | measured (this implementation) |
|---|---|---|---|
| left fit | 72.80 px @ 1.48 Hz, R² 0.7775 | @ 1.50 Hz | **71.60 @ 1.50 Hz, R² 0.77596** |
| right fit | 44.16 px @ 1.52 Hz, R² 0.4973 | @ 1.50 Hz, R² ~0.512 | **37.11 @ 1.50 Hz, R² 0.51175** |
| ratio | 0.6066 | ~0.518 | **0.51834** |

Every prediction lands: both sides converge on the same 1.50 Hz rhythm, the weaker side's R²
rises 0.497 → 0.512, and the ratio moves DOWN to 0.518.

**Expected drift in the orchestrator's post-implementation live A/B** (fresh-process,
`scripts/ab-person-selection.mjs`, all three clips):

- Demo 2 `armSwingSymmetry.value` 0.6066 → **~0.52**; `armSwingAmplitude.value` down **~7%**;
  `armSwingCycle` exemplar timestamps may move a frame or two (the fitted phase shifts with the
  frequency).
- Demo 1 and multiperson: arm-metric INTERNALS may drift, but both metrics' tier-3 **EXCLUDED
  status must not change** on those clips.
- **Every non-arm metric on all three clips: bit-identical.** Nothing outside
  `computeSideSwing`'s series changed.
- Standing anchors must hold: Demo 1 scale-pass `verticalOscillationCm`
  **4.421467928439415** cm, `cadence` **91.2** (`fit.frequencyHz × 60 = 91.2`).

## D6 — The caveat rewording (strides-ax3)

The disparity caveat fires on `|R²_left − R²_right| > SIDE_FIT_QUALITY_DISPARITY_R2` — a
FIT-quality gap, not a tracking-coverage gap — and D2 shows the two can point in opposite
directions (Demo 2's worse-FITTING arm is its better-TRACKED one). "One arm was tracked
noticeably better" therefore asserts something the trigger never measured. New wordings, exact:

- `armSwingSymmetry`: "One arm's swing rhythm fit its trace much less cleanly than the other's
  in this clip, so part of the difference between them may be measurement rather than form."
- `armSwingAmplitude`: "One arm's swing rhythm fit its trace much less cleanly than the other's
  in this clip, so part of this overall swing size may reflect measurement rather than form."

Shared head naming what fired (the fit disparity); each metric keeps its own tail (the
comparison vs the magnitude). The unsteady-rhythm and every other caveat are untouched.
