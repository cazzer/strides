# Design — detect retimed clips below the gait floor

Everything below was measured in headless Chromium on real GPU (`ANGLE Metal Renderer: Apple M4
Pro`, never SwiftShader), fresh Chromium process per trial, on a dev server this run started and
identity-verified on the derived port (5310), at base commit `14b438d`.

---

## D1. Ground truth on `park-side-portrait.mp4`, measured before any code changed

Frames pulled at 5 fps with a leg-band crop (`ffmpeg -vf "fps=5,crop=1080:400:0:980,tile=3x8"`) and
read directly, across three windows covering the whole clip.

| contact | keyframe estimate |
|---|---|
| 1 | ≈ 1.4 s (runner enters mid-stance; touchdown extrapolated) |
| 2 | ≈ 3.9 s (front shoe near ground 3.8, planted 4.0) |
| 3 | ≈ 6.4 s (landing 6.4, stance 6.6) |
| 4 | ≈ 8.9 s (near ground 8.8, planted 9.0) |

**Uniform 2.5 s step period ⇒ ≈ 0.40 Hz ⇒ ≈ 24 spm on screen.** Four contacts in the presence
window. The regularity is itself the evidence, the same argument `strides-dly` used on Demo 1.

Container: 1080×1920, `r_frame_rate=30/1`, `avg_frame_rate=2070/73` ≈ 28.36 fps, 345 frames,
12.167 s. Nominal 30 fps with no capture rate anywhere — the baked-iOS shape, which is exactly why
`slowMotionDetection.ts`'s `nominalFps >= 100` predicate cannot fire on it.

---

## D2. The two-pass fit engages, and the phase path takes over

Temporary `[b4f-passes]` / `[b4f-sides]` / `[b4f-strikes]` probes, added-measured-reverted per
CLAUDE.md's cycle (`git grep b4f- src/` is clean).

**Primary pass (MoveNet), `park-side-portrait.mp4`, n = 280 samples over a 9.767 s span:**

| | frequency | sinusoidR2 | secondPeakRatio | observedCycles |
|---|---|---|---|---|
| pass 1 (in band) | 1.24 Hz | **0.0231** | 0.479 | 12.11 |
| pass 2 (sub-floor) | **0.39 Hz** | **0.7561** | **0.0354** | 3.81 |

Pass 2 adopted. **0.39 Hz against the keyframe-derived 0.40 Hz — 2.5% apart.** R² 0.756 is not
marginal; `secondPeakRatio` 0.035 says the sub-floor rhythm is unambiguous among its own
competitors.

**`detectFootstrikes` flips from the ankle-difference fallback to the bounce-phase path:**

| | before | after |
|---|---|---|
| path | `ankle-fallback` | **`phase`** |
| strikes | **13** | **4** |
| instants | — | 1.933 / 4.500 / 7.067 / 9.633 s |
| sides | — | left / right / left / right |
| spacing | irregular | **2.567 s, uniform** (= 1 / 0.39) |
| `ankleMeasurable` | — | true on all four |

The instants sit a uniform **+0.6 s** after the keyframe onsets. That is the standing `strides-24s`
systematic (+0.11 s on Demo 1), scaled by this clip's own retiming factor (0.11 × ~6.6 ≈ 0.73) — a
per-clip bias every instant shares, not scatter, and shipped uncorrected on the same principle
`strides-24s` closed on.

**`attributeSides` returns a non-zero vote** (question 3): evidence −322.12, from four instants
carrying ankle differences +81.2 / −93.7 / +72.3 / −74.9 px. It is not close to the tie that would
make `detectFromBouncePhase` return `[]`, and the alternation is decided by all four rather than
per-instant.

---

## D3. What moved, and what did not

Three-clip `--evidence` A/B, 3 trials, before at `14b438d` and after on this branch.

**`side-landscape` and `front-approach`: 0 fields moved outside `elapsedMs`.** Two independent
instruments agree — a per-trial field-by-field comparison of the `--json` records (which cannot
hide a field that moved on only one trial), and md5 of the elapsedMs-stripped report sections
(`d1b5036d…` and `bc14c1a3…`, identical before and after, over 218 and 190 lines). The reason is
structural rather than lucky: on both clips pass 1 clears the gate, so pass 2 is never formed.

**`side-portrait`, primary pass:**

| field | before | after |
|---|---|---|
| `footStrikePattern.sampleSize` | 13 | **4** |
| `footStrikePattern.value` | −0.2396 @ 1.0 | **+0.0973** @ 1.0 |
| `overstriding.sampleSize` | 13 | **4** |
| `overstriding.value` | **−0.0081** @ 1.0 | **+0.4781** @ 1.0 |
| `verticalOscillation.value` | `null` | **0.17134** @ 0.907 |
| `verticalRatio.value` | `null` | **0.02992** @ 0.605 |
| `stepWidth.value` | −0.1807 | −1.5042 (view-excluded either way) |
| `cadence.value` | `null` | `null`, new caveat |
| `trunkLean` | 10.3371 | unchanged (reads no footstrikes) |

Plausibility check against the corpus: `verticalOscillation` 0.171 sits between `side-landscape`'s
0.154 and `front-approach`'s 0.204; `verticalRatio` 0.0299 against `side-landscape`'s 0.0246;
`overstriding` 0.478 against 0.512. The before-values were the outliers.

Evidence coverage gains four sections — `verticalOscillation`, `verticalRatio`,
`verticalOscillationCm` and `overstriding` all move `no-evidence` → `planned`.

---

## D4. ⚠️ THE BLOCKER: the sub-floor band is where red noise lives

**A pre-registered negative control fired.** The two synthetic controls the plan specified — white
noise and pure quadratic drift — both PASS. Neither is the shape that matters.

### D4.1 The measurement

300 seeded random walks (`v[k] = v[k−1] + U(−0.5, 0.5)`) — a series with **no rhythm at any
frequency** — at each of this corpus's own sample counts:

| series shape | `subFloor` adopted | cycles p50 / p95 | R² p50 / p95 | `secondPeakRatio` p50 / p05 | cycles ≥ 3 |
|---|---|---|---|---|---|
| 288 @ 30 fps (side-portrait scale pass) | **275/300 (91.7%)** | 1.82 / 3.73 | 0.519 / 0.788 | 0.126 / 0.033 | 33 |
| 280 @ 30 fps (side-portrait primary) | **277/300 (92.3%)** | 1.95 / 3.81 | 0.522 / 0.788 | 0.130 / 0.037 | 38 |
| 138 @ 30 fps (2× control scale pass) | **224/300 (74.7%)** | 1.87 / 3.70 | 0.531 / 0.792 | 0.288 / 0.069 | 30 |
| 106 @ 60 fps (side-landscape primary) | 37/300 (12.3%) | 1.35 / 1.87 | 0.633 / 0.833 | 0.865 / 0.000 | 0 |

### D4.2 Why the gate does not protect here

Integrated white noise is red noise (≈ 1/f²), so its power is concentrated at exactly the low
frequencies the sub-floor grid searches. `verticalOscillationMinFitR2`'s own doc states its
calibration explicitly: a **2000-seed pure-noise floor, p95 ≈ 0.22 at n ≈ 50** — a WHITE-noise
floor. It was never calibrated for this band, and the doc's own warning ("a fixed R² threshold is
NOT n-invariant… any other caller operating at low sample counts must set its own policy") turns
out to understate the problem: the regime that breaks it here is the FREQUENCY band, not n.

### D4.3 No threshold on any reported field separates signal from noise

`park-side-portrait`'s genuine primary detection sits inside the noise distribution on **every**
field `SpectralFitSuccess` reports:

| field | genuine detection | red-noise distribution | verdict |
|---|---|---|---|
| `sinusoidR2` | 0.7561 | p95 = 0.788 | inside |
| `observedCycles` | 3.81 | p95 = 3.81 | **exactly at p95** |
| `secondPeakRatio` | 0.0354 | p05 = 0.037 | inside |

This is the same shape of result as `derive-area-floor-from-4k-measurement`: the endpoints overlap,
so **no threshold exists**, and the direction needs a different KIND of discriminator — an F-test
against residual degrees of freedom (the n-invariant upgrade `verticalOscillationMinFitR2`'s doc
already names), a red-noise null model, or cross-validation against the other pass's independent
series. Do not re-derive by picking a cycles minimum: 33–38 of 300 pure-noise walks reach 3 cycles.

### D4.4 It reaches the user on real footage

`verticalOscillationCm.calibrate` fits a **cumulative integral of per-frame deltas** — a random walk
by construction, which is the worst possible series to put this grid on. Measured on
`park-side-portrait`'s background MediaPipe scale pass:

| | value |
|---|---|
| pass 1 | 2.06 Hz, R² **0.0078** |
| pass 2 | **0.15 Hz** (the grid's own bottom edge), R² **0.398**, 1.515 cycles |
| grafted `verticalOscillationCm` | **46.41 cm** |
| `torsoMeters` | 0.4938 |

46.4 cm is **0.94 torso lengths** of vertical bounce, against a 6–13 cm literature band and against
the primary's own pixel path, which implies ≈ 8.5 cm on the same clip. The A/B confirms the card
renders: `evidence.clips[0].metrics.verticalOscillationCm.status` moves `no-evidence` →
`planned`. **That trades one actively-wrong output on this clip for another.**

The same mechanism fires on the negative control's scale pass (0.31 Hz, R² 0.630, 2 strikes instead
of 5). It is invisible there only because `stepWidthCm` is view-excluded on a side view.

### D4.5 What is NOT affected

Exposure requires pass 1 to fail first, which bounds it — but that is precisely the population pass
2 exists to serve. Both other clips are untouched because their pass-1 fits succeed. The
`106 @ 60 fps` row above shows the second bound: short spans cannot complete a sub-floor cycle, so
`fitSpectralSinusoid`'s `observedCycles >= 1` rule does most of the work on short clips and none of
it on a 12 s one. **Exposure grows with clip length.**

---

## D5. The negative control, and what it establishes

`ffmpeg -itsscale 2` on the 60 fps `park-side-landscape.mp4` → `r_frame_rate=30/1`, 233 frames,
7.75 s, 2× slow, ~87 spm — real footage, container-faithful, still in band.

**Every user-visible value is bit-identical to baseline**, to full precision:

| | baseline (`14b438d`) | after |
|---|---|---|
| `cadence` | **87.6** @ 0.90560 | **87.6** @ 0.90560 |
| `verticalOscillation` | 0.156303372200495 | 0.156303372200495 |
| `verticalRatio` | 0.02475361294716431 | 0.02475361294716431 |
| `overstriding` | 0.561615228403369 | 0.561615228403369 |
| `footStrikePattern` | 0.1037128043828595 | 0.1037128043828595 |
| `trunkLean` | 4.124474200694092 | 4.124474200694092 |

**An in-band rhythm at half speed is not called retimed.** The criterion passes on the primary path.
It does not pass on the background scale pass (D4.4), which the criterion as written did not reach.

---

## D6. Design decisions, for the record

**Why a separate module rather than inside `fitSpectralSinusoid`.** That file's doc reserves it for
well-posedness and pushes policy to callers; "human gait does not happen below 1.2 Hz" is gait
policy. Changing it would also silently alter `armSwing.ts`, which fits a different signal.

**Why not inline in `analyzeBounceSignal`.** `verticalOscillationCm.calibrate` fits its own per-run
metre series; a rule reaching only the pixel path would let the family disagree with itself. (D4.4
shows this coupling is also how the defect reaches a rendered metric — the coupling is right, the
adoption rule is not.)

**Why two disjoint grids rather than one union.** A union grid lets a low-frequency candidate WIN
outright on a clip whose in-band rhythm is real. Under the disjoint arrangement a sub-floor
candidate is never formed unless the in-band band has already failed, so it is structurally
incapable of displacing a winning in-band peak.

**Why `MAX_RETIMING_FACTOR = 8`.** iPhone's 240 fps against a 30 fps timeline — the device class
this is about. 32 (Android's 960 fps tier) was rejected: it triples the grid, and the architect's
stated pruning argument for the added points — `observedCycles >= 1` — **is false on this corpus**
(D4.1: at 0.15 Hz over 10.1 s the winner completes 1.515 cycles and clears the rule). A clip retimed
past 8× keeps today's honest null.

**Why no new threshold for `subFloor`.** The human-gait floor already IS
`spectralFitMinFrequencyHz`, whose doc says 1.2 Hz sits "comfortably below any running cadence"; the
frequency comparison is a structural consequence of the disjoint grid.

---

## D7. Follow-ups filed

- **`strides-mc1`** — the red-noise adoption gap. **Blocks this change.**
- **`strides-24s` / `strides-pr1`** are unaffected: the +0.6 s residual on this clip is the same
  systematic, scaled, and is disclosed by `overstriding`'s existing unconditional caveat.

---

## D8. The blocker resolved: an AR(1) red-noise null, scoped to the sub-floor adoption decision

`strides-mc1`. D4 stands as measured; this section records what closed it.

### D8.1 What was refuted first, so nobody re-derives it

Measured under `strides-mc1` before any code was written, and recorded here because each of these
looks like the obvious fix:

- **Confining the two-pass to the pixel path is refuted.** D4.4 blames the metre series for being a
  cumulative integral, but the primary hip-POSITION series is red too: φ 0.795–0.936, log-log slope
  ≈ −1.5 on all three clips, against white controls at φ ≈ −0.2 / slope ≈ +0.5. Both consumers sit
  on the random-walk control, not the white one. The colour gap between them is too small to build
  on.
- **An F-test does not fix it.** Against a random walk a low-frequency sinusoid genuinely explains
  large variance, so the F statistic is large too. It fixes the gate's n-dependence, not its
  noise-colour assumption. Removed from D4.3's candidate list.
- **Cross-pass agreement is not a validator.** On the only genuinely retimed clip the two passes
  disagree (primary 0.390 Hz, scale pass 0.150 Hz), so requiring agreement would reject the
  **correct** detection along with the wrong one — the pass that fell for the noise casts the second
  vote. It is a disagreement flag, not a validator.
- **Measuring φ naively is confounded.** A quadratic detrend alone gives φ 0.88–0.98 on *every*
  series, because at 60 fps a clean 2.9 Hz sinusoid by itself produces lag-1 ≈ 0.95. The rhythm has
  to be removed before colour is measurable — which is why the shipped estimator reads colour off
  the *spectrum*, where a peak is one point among many, rather than off a residual.

### D8.2 The rule

Sub-floor adoption now requires the family gate **and** a significance test against an AR(1)
red-noise null (`src/heuristics/redNoiseNull.ts`), at a conventional 95%:

1. Fit the AR(1) shape `S(f) ∝ (1 − φ²) / (1 + φ² − 2φ·cos(2πfΔt))` to the sub-floor band's own
   periodogram, by an L1-in-log scan over φ. L1 because a genuine peak is an outlier by
   construction and must not be allowed to help set the bar it is judged against.
2. Divide every grid point's explained sum of squares by that shape and take the MEDIAN as the
   background level.
3. Adopt only if `2·ln2 · (peak/S(f*)) / median` exceeds the χ²₂ quantile at 95%, corrected for the
   number of INDEPENDENT frequencies the span resolves (`bandwidth × span`, ≈ 10 on a 10 s clip)
   because the peak was chosen by maximization.

**Why the level is estimated from the band rather than from the theoretical normalization.** The
textbook form ties the null to the series' TOTAL variance, and `fitSpectralSinusoid` removes a
`c + d·t + e·t²` trend first, which guts exactly the f→0 end that dominates a red series' variance.
Measured: the variance-normalized form still adopted **33.7%** of random walks; estimating the level
from the band takes that to **3.5%**. This is Mann & Lees' robust background, and here it is
required rather than a refinement.

**Why the R² condition is kept alongside.** The null answers "is this peak distinguishable from this
series' own noise"; `verticalOscillationMinFitR2` answers "will the consumers of this fit take it".
Dropping the second would let `fitBounceSpectrum` return a sub-floor fit every downstream metric
then rejects — a clip reported as retimed while showing no numbers, worse than today's honest
failure, and it would break D6's arbitration argument.

**Why it discriminates, by construction.** The AR(1) null is HIGHER at low frequency (≈ 1/f²), so a
peak at the grid's bottom edge faces a HIGHER bar than one a few tenths of a Hz up — and the false
adoptions pile at that bottom edge, while the genuine one does not. Measured at Δt = 1/30:

| φ | null at 0.15 Hz | null at 0.39 Hz | ratio |
|---|---|---|---|
| 0.70 | 5.624 | 5.387 | 1.04 |
| 0.80 | 8.826 | 7.941 | 1.11 |
| 0.90 | 17.450 | 11.874 | 1.47 |
| 0.95 | 28.363 | 11.036 | 2.57 |
| 0.99 | 18.477 | 2.970 | **6.22** |

The asymmetry is asserted directly in `redNoiseNull.test.ts`, not assumed — it is the one property
the whole design leans on.

### D8.3 Adoption rates, through the shipped `fitBounceSpectrum`, 300 seeds each

| rhythmless series | before | after |
|---|---|---|
| random walk, 288 @ 30 fps (side-portrait metre series) | **91.7%** | **4.3%** |
| random walk, 280 @ 30 fps (side-portrait hip series) | **92.3%** | **5.7%** |
| random walk, 138 @ 30 fps (2× control scale pass) | **74.7%** | **3.7%** |
| random walk, 106 @ 60 fps (side-landscape primary) | 12.3% | **0.0%** |
| AR(1) φ = 0 (white) | 0.0% | 0.0% |
| AR(1) φ = 0.3 | 0.0% | 0.0% |
| AR(1) φ = 0.6 | 0.0% | 0.0% |
| AR(1) φ = 0.9 | 33.3% | **4.0%** |
| AR(1) φ = 0.99 | 91.0% | **6.0%** |

The after column sits at the 5% the null is stated at, across the whole colour range — which is what
a correctly calibrated significance test does, and is the reason this is not a tuned number.

### D8.4 The confidence level was not tuned

0.95 is the level the red-noise-significance literature states its results at (Gilman 1963; Mann &
Lees 1996; Torrence & Compo 1998). It was fixed before the genuine detection was tested, and the
genuine detection clears it by a factor of 3–15 rather than marginally, so no adjustment was
available to be tempted by. The pre-registered rule was that if 95% rejected the real 0.39 Hz
detection, that would be reported as a finding — that the signal is not separable from the clip's own
noise — and would kill `strides-b4f`'s premise. It did not fire.

Nothing else was added: no second constant, no clip special case, and
`verticalOscillationMinFitR2` / `cadenceMinFitR2` are untouched. The φ search resolution (0.002) and
the φ ceiling (0.998, where the normalized spectrum degenerates to zero) are numerics, not
thresholds; the independent-frequency count is derived from the band and the span.

### D8.5 Live verification of the null

`scripts/ab-person-selection.mjs --arm 'base={}' --clips side-landscape,side-portrait,front-approach
--trials 3 --evidence`, run three times — once per commit — each starting and identity-verifying its
own dev server on the derived port, fresh Chromium per trial, real GPU
(`ANGLE Metal Renderer: Apple M4 Pro`). Compared field by field over the per-trial JSON, not by
diffing the rendered table (`strides-ef5`), and cross-checked by md5 of the elapsedMs-stripped report
sections.

**The two short clips do not move, against either reference.**

| clip | vs base `14b438d` | vs pre-null `a96bffa` | md5 of report section |
|---|---|---|---|
| `side-landscape` | identical, all **183** fields | identical, all 183 fields | `e138354879b96882e91890514046b900` on all three commits |
| `front-approach` | identical, all **167** fields | identical, all 167 fields | `37dec37df64d1e7e0427a2d3884112ae` on all three commits |

⚠️ Neither clip could have witnessed this defect in the first place — at 1.75 s and 1.63 s neither
span can complete a cycle at 0.15 Hz, so `observedCycles >= 1` rejects the sub-floor pass outright.
They are a blast-radius control, not evidence about the null.

**`side-portrait`: the genuine detection is untouched and the false one is gone.** Against
`a96bffa`, **8 of 188** fields differ and every one of them is `verticalOscillationCm` evidence:

| field | `a96bffa` | with the null |
|---|---|---|
| `evidence.clips[0].metrics.verticalOscillationCm.status` | **`planned`** (the 46.4 cm card rendered) | **`no-evidence`** |
| …`.reason` | — | `metric-excluded` |
| …`.exemplars[0]` (6 rows) | present | absent |
| every `metrics.*` value and confidence | — | **identical** |

Read directly off the scale-pass console line, which the A/B harness does not capture:
`scaleCalibration.verticalOscillationCm` **46.41 cm → `null`**, `fitFailureReason`
`below-quality-gate`, `fit` `null`. `torsoMeters` 0.4938, `medianPixelsPerMeter` 205.1 and
`scaleCoverage` 0.931 are unchanged — the clip's real-world scale is still measured; only the
noise fit is refused. `subjectAgreement` 270/270.

And against base `14b438d`, everything §D3 claimed still holds: `overstriding` **−0.008 → +0.478**,
`footStrikePattern` **−0.240 → +0.097**, both at `sampleSize` **13 → 4**, `verticalOscillation`
`null` → **0.1713 @ 0.907**, `verticalRatio` `null` → **0.0299 @ 0.605**, `cadence` still `null` with
the retiming caveat verbatim.

**Negative control, `ffmpeg -itsscale 2` on the 60 fps side clip (30 fps, 2× slow, ~87 spm), driven
through the Upload tab at base and on this commit: bit-identical on every captured field.** `cadence`
**87.6 @ 0.9056**, non-null, and its caveat is the ordinary "wasn't perfectly steady" wording rather
than the retiming one — the detector does not fire. `verticalOscillation` 0.156303372200495,
`overstriding` 0.561615228403369, `footStrikePattern` 0.1037128043828595, and the scale pass's own
`verticalOscillationCm` 7.7302638422339145 cm from an IN-BAND fit at 1.44 Hz, R² 0.8585213330501436
— identical to base to every digit.

**Reproducibility**: two independent invocations on this commit agreed on every field of all three
clips except `elapsedMs`.
