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
