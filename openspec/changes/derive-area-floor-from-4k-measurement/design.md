# Design — re-derive the bounding-box area floor from 4K measurement

**Status of this document.** Everything below the "Pre-registered criteria" heading was written
**before any measurement was taken**, with the four endpoints as named unknowns (`G4`, `S4`, `G1`,
`S1`) and the chosen value as `f`. That ordering is the point: this repo has a cautionary record of
a criterion renegotiated after a measurement, and a floor is exactly the kind of number that can be
tuned until a favourable table appears. The criteria are never edited to match a result; a fired
gate is recorded as fired and adjudicated separately.

---

## D1 — Keep the fraction model; change only the number

**Decision: the area floor stays a fraction of frame area. Only the fraction's value changes.** No
delta on `### Requirement: The area floor is a fraction of frame area, not an absolute pixel count`.

**Why the pro-fraction argument still holds (D4's, untouched by this change).** Keypoints are in
source-video pixels on both sampling paths, so an *absolute* px² floor is 4× more permissive at 4K
than at 1080p for the same physical subject at the same distance. A fraction is resolution-
independent by construction. Nothing measured for this change disturbs that.

**Rejected — a per-resolution-class table**, the only alternative #52's follow-up 2 named. It fails
on a sharp fact about this repo's own footage: Demo 2 (`park-approach.mp4`) is **2160×3840 —
portrait 4K**; Demo 1 is **3840×2160 landscape**. Same frame area (8,294,400 px²), transposed
dimensions. A "resolution class" therefore cannot key on width or height; it must key on **frame
area** — at which point the table is a step function of exactly the quantity the fraction model
already uses continuously. Strictly more machinery for strictly less resolution, justified only if
the true relationship is non-linear in frame area, which is precisely what is unmeasured.

**Rejected — `max(fraction × area, absoluteMinPx)`.** The absolute term binds only below ~1080p,
and there is no sub-1080p fixture in this repo. Its value would be a pure guess in the one regime
where it acts alone — a knob with no evidence behind it and no test that can fail if it is wrong.

**Rejected — `floor ∝ area^k, k ≠ 1`.** Two measured frame areas fit any two-parameter law exactly,
so the fit is unfalsifiable with the data available. Both areas are clip-confounded anyway (see the
evidence-base statement below), so the exponent would be fitting scene differences, not resolution.

**Pre-registered condition that overturns D1.** The fraction model predicts that **one** value sits
inside the admissible window at *both* measured frame areas simultaneously. If the two windows come
out **disjoint**, the model is empirically refuted on this repo's own footage — in that case the
delta switches to the REMOVE + ADD branch drafted at the end of this document, and the controlled
downscale pair (below) is run first.

## D2 — Derivation method: probe first (distributional), sweep second (behavioural plateau)

**Both, in that order — not one or the other.**

**Why a `--arm` sweep alone cannot be the derivation.** It cannot say *whose* frame was rejected: a
`rejectedBelowFloor > 0` on Demo 2 is ambiguous between a genuine far-approach frame and a phantom
nobody has looked for, and Demo 2 has never been probed — its single segment would hide phantoms
*inside* the winner. Each bisection step costs a full 3-trial × 3-clip matrix, the flip point is
itself noisy, and the resulting number's justification would be "it sits between two behavioural
thresholds on three clips", with margins unquantified in the units the floor is actually expressed
in.

**What the probe gives.** Per-detection `(t, area, centre, w, h, confidentKeypoints,
meanConfidence)` for every box-yielding detection, **with no floor applied** — which is what makes
the trace independent of the value under test. Each entry is keyframe-classifiable at its own
timestamp, the same technique that produced the original 2,279–8,432 px² figures.

### The four endpoints, as named unknowns

```
A_4K   = 8,294,400 px²   (both demo clips — landscape and portrait alike)
A_1080 = 2,073,600 px²   (multiperson-track.mp4)

G4 = largest keyframe-confirmed PHANTOM box at 4K            (believed ~8,432; re-measure, max over 3 trials)
S4 = smallest keyframe-confirmed WINNER-SUBJECT box at 4K    (NEVER MEASURED — the missing ceiling)
G1 = largest keyframe-confirmed PHANTOM box at 1080p         (measure pre-floor)
S1 = smallest keyframe-confirmed WINNER-SUBJECT box at 1080p (measure pre-floor)

window = ( max(G4/A_4K, G1/A_1080) , min(S4/A_4K, S1/A_1080) )
f      = geometric mean of the window's endpoints, 2 s.f.
```

| symbol | value | clip | timestamp | keyframe verdict |
|---|---|---|---|---|
| `G4` | *TBD — Phase 2* | | | |
| `S4` | *TBD — Phase 2* | | | |
| `G1` | *TBD — Phase 2* | | | |
| `S1` | *TBD — Phase 2* | | | |
| `f` | *TBD — Phase 3* | — | — | derived, not chosen |

**Where the never-measured ceiling comes from.** Demo 2 *is* the measurement: its subject
approaches the camera and changes on-screen size ~3× across the clip, so its smallest genuine box
is a genuinely distant real person at 4K. Demo 1 gives a second reading — post-#54 its winner spans
`[0.08, 6.32]` and includes the prefix where the runner is further from camera (which is why
`medianAreaPx` fell 515,680 → 491,133). Nobody had a reason to look at the *minimum* of the
winner's distribution before; the probe makes it a one-line order statistic.

**Operative definition of "smallest real subject", which differs from D4's.** The ceiling is the
smallest box belonging to **the subject the clip is about** (the winner), not to any real human in
frame. Floor-rejecting a bystander is acceptable-to-desirable — D5 makes it harmless, since a floor
rejection neither starts nor cuts a segment; floor-rejecting a *winner* frame is the harm. This
matters at 1080p: D7 records the multiperson clip's bystanders at ~1/9 the runner's area (≈3,548 px²
against a median of 31,937), so a value near 1.7e-3 absorbs them. That is a **recorded consequence,
not a failure** — criterion C's second limb below is explicit permission for it.

### What this number's evidence base actually is

- It **is**: two order statistics per frame-area class, from three clips at two frame areas, pooled
  over three trials, each endpoint classified by direct keyframe inspection at its own timestamp,
  plus a behavioural plateau check at `f/2` and `f×2`.
- It is **not**: a distribution over footage in general (n = 3 scenes), a resolution-scaling law, or
  a bound on any clip outside the fixture set. Defensible for this app's known footage, explicitly
  provisional beyond it.
- It specifically **cannot** distinguish "phantoms are larger at 4K" from "Demo 1 happens to have
  larger phantoms than the old 1080p repro clip". The two existing phantom measurements (5–183 px²
  at 1080p on the repro clip; 2,279–8,432 px² at 4K on Demo 1) are **different clips, different
  scenes, different noise** — not a controlled pair. **This document asserts nothing about how
  phantoms scale with resolution**, and neither should anything downstream of it.

**Conditional controlled pair.** `ffmpeg -vf scale=...` to half linear resolution gives the same
scene at a quarter frame area — the controlled pair that does not exist today. Run it **only if**
the two windows come out disjoint or thin, since that is the only branch where the answer changes a
decision. If it is run, record the limitation: encoder generation loss and the detector's differing
internal resize make it *near*-controlled, not perfectly controlled.

### SHIP RULE on the margin — pre-registered

Require the window ratio

```
min(S4/A_4K, S1/A_1080) / max(G4/A_4K, G1/A_1080)  >=  4
```

i.e. `f` sits **≥2× above the largest measured phantom and ≥2× below the smallest measured genuine
subject** — matching D4's own "~2.3× above the noise" discipline. **If the ratio is < 4, do not ship
a number.** Record the measurement, re-accept `2e-4`, close #57 with the evidence written down, and
reopen with a proposal that is not a single global fraction. That is an accepted outcome, not a
failure.

*(Noted while re-reading D4: its own stated ratios do not reconcile — 415 px² is 2.27× above 183 px²
but 2.4×, not "~40×", below "~1,000 px²". Reuse D4's **method**, not its arithmetic, and keep this
change's arithmetic self-checking: every ratio quoted here is computable from the four endpoints in
the table above.)*

## D3 — Demo 2 is the canary and must stay bit-identical

Three pieces of evidence are required before the floor is called safe. All three, not a majority.

1. **Demo 2 bit-identical.** `rejectedBelowFloor === 0`, `detectedSamplesOut === 99`,
   `segmentCount === 1`, and every field and metric identical to baseline, 3/3 trials. It is the
   only clip whose subject sweeps ~3× in on-screen size, so a too-high floor shows there first.
2. **Quantified margin**, recorded per clip: `S4 / (f × A_4K) >= 2` and `S1 / (f × A_1080) >= 2`.
3. **Demo 1's healed track intact**: `segments[0].frameCount >= 53` and
   `startTimestamp <= 0.10`. #54's recovered prefix frames are the smallest genuine boxes on
   Demo 1 — if the new floor eats them, #57 has undone #54.

## D4 — Why the pinning tests are two-sided, and why they bypass the test-local config

Modelled on the existing `pins maxCenterSpeedSidesPerSecond` case: a fixture that passes at the
shipped value and fails at the old one, with every other term held far from its bounds so none of
them can be what decides.

All four run against `DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG` **directly**, not the test-local
`CONFIG` — the default already ships `enabled: true`, so nothing needs overriding, and reading the
default is the whole point of a pinning test.

- **P1 — the floor catches the largest measured 4K phantom.** At 3840×2160: a continuous run of
  large boxes, then one box of exactly `G4` placed *after* the track, far away, discontinuous — the
  geometry Demo 1 actually has. At the shipped default: `rejectedBelowFloor === 1`,
  `segmentCount === 1`, `rejectedOtherSegment === 0`, `bridgedCuts === 0` (the phantom is last, so
  `nextSurvivingIndex` returns −1 and the bridge provably cannot be what decided).
  **Counterfactual** at `{ ...DEFAULT, minBoundingBoxAreaFraction: 2e-4 }`: `segmentCount === 2`,
  `rejectedBelowFloor === 0` — this is the assertion that fails if anyone reverts the number.
- **P2 — the floor keeps the smallest measured genuine subject at 4K.** Same frame size, one box at
  `S4` placed *inside* and continuous with the track. `rejectedBelowFloor === 0` and it survives by
  reference. No counterfactual needed: it fails the moment anyone raises the default past the
  measured ceiling. **This is what stops "just raise it more" from passing CI**, and what makes the
  derivation two-sided in the suite rather than one-sided.
- **P3 / P4 — the same pair at 1920×1080** using `G1` and `S1`, so the model is pinned at *both*
  measured frame areas. P4 fails if a future re-derivation looks only at 4K.

**Nothing in the unit suite can tell you the number is right.** `npm test` green is necessary, not
sufficient; the live A/B is the check. The resolution-independence test in particular is
arm-to-arm against a test-local config and passes through any floor change — it is not the safety
net.

## D5 — Decoupling the algorithm suite from the shipped number is a prerequisite

The ticket (and this repo's own notes) said a default change touches none of the unit tests. **That
is false.** `retroactivePersonSelection.test.ts` defines

```ts
const CONFIG: RetroactivePersonSelectionConfig = {
  ...DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG,
  enabled: true,
}
```

— it spreads the shipped default and overrides **only `enabled`**, so every fixture's above/below-
floor status is a live function of `minBoundingBoxAreaFraction`. At 1920×1080:

| fixture | area | flips below the floor when the fraction exceeds |
|---|---|---|
| the 12-segment alternating fixture (`40 + i*10` sides) | 1,600 px² (smallest) | **7.72e-4** |
| the 60×60 "bystander" used in eight cases | 3,600 px² | **1.736e-3** |
| `ABOVE_FLOOR_SIDE = 25` | 625 px² | **3.01e-4** |
| `FLOOR_1080P = 414.72`, asserted directly | — | any change at all, fails loudly |

Any admissible new value is `> 1.0166e-3` (that is `G4 = 8,432 px² ÷ A_4K`, the known lower bound
before measurement), so **at minimum three of those reclassify**. Pinning
`minBoundingBoxAreaFraction: 2e-4` explicitly in the test-local `CONFIG`, alongside `enabled: true`
and for the same stated reason, keeps every one of those fixtures meaning what its comment says —
permanently, not just through this change. `FLOOR_1080P`'s direct assertion is the tripwire that
would have caught the coupling; the decoupling removes the need for it to fire again.

---

# Pre-registered criteria

3 trials/arm, all three clips, one session, one verification lane, real GPU confirmed by the
driver's own renderer check, `--port 5199` on every invocation, baseline re-measured in the same
session. Per-trial self-consistency, confirmed against the current code
(`retroactivePersonSelection.ts` — #55 added the fourth bucket):

```
detectedSamplesOut === detectedSamplesIn
                       − rejectedBelowFloor
                       − rejectedOtherSegment
                       − rejectedOutsideEvidence
```

### A. Demo 1 — the epic-closing gate

| # | Criterion | Baseline (post-#54/#55) |
|---|---|---|
| A1 | **`segmentCount === 1`**, all 3 trials | 3 [3..4] |
| A2 | **`rejectedOtherSegment === 0`**, all 3 trials | 7 [7..10] |
| A3 | `rejectedBelowFloor` equals the probe's phantom count on this clip, ±1 | 0 |
| A4 | `segments[0].frameCount >= 53` — #54's healed track intact | 53 |
| A5 | `segments[0].startTimestamp <= 0.10`; `medianAreaPx` within 1% | 0.08 / 491,133 |
| A6 | Every metric `value` inside the baseline arm's own trial range | — |

**A1 + A2 together are epic #52's amended headline criterion.**

**Observation, not a gate — `sampling.detectedFrames`.** With phantoms demoted to
`rejectedBelowFloor`, the single remaining segment's partition extends to the clip end (D6), so
trailing boxless detections currently counted as `rejectedOtherSegment` move inside the winner.
**But #55 has landed**, and its evidenced-interior restriction nulls those same frames as
`rejectedOutsideEvidence` instead — so the prediction is **no increase**. Named before measuring so
a surprise is legible either way. `separationRatio` goes `null` (one segment) and
`segments[0].endTimestamp` jumps to the clip's last sample; both predicted, neither a regression.

### B. Demo 2 — the real-subject canary

`rejectedBelowFloor === 0`, `segmentCount === 1`, `rejectedOtherSegment === 0`,
`detectedSamplesOut === 99`, every field and metric **bit-identical** to baseline, 3/3 trials.

### C. Multiperson (1080p) — second-resolution check

`segments[0].frameCount` / `medianAreaPx` / span within 1%; `separationRatio >= 3` **or**
`segmentCount === 1` with `separationRatio: null`; `detectedSamplesOut` does not decrease; every
metric inside the baseline trial range. C's second limb is explicit permission for the floor to
absorb the ~3,548 px² bystanders — the floor doing its job at 1080p, made harmless by D5 — but it
must be **recorded**, not a surprise.

### D. Plateau

The `half` (`f/2`) and `double` (`f×2`) arms both satisfy A1–A3 and B. Both passing means `f` sits
on a ≥2×-wide plateau in both directions rather than on a cliff. Either failing is recorded as a
thin margin on that side, **with the number** — not hidden, not tuned around.

### Do NOT ship if (any one fires)

1. **Demo 2 shows `rejectedBelowFloor > 0`, or any field differs from baseline, in any trial.** The
   floor is eating a genuine distant subject. **Outranks every accept condition, including A1/A2.**
2. Demo 1 `segments[0].frameCount < 53` or `startTimestamp > 0.10` — the new floor undid #54.
3. Multiperson `medianAreaPx` moves > 1%, or the winner loses frames.
4. Any metric `value` on any clip moves outside the baseline arm's measured trial range.
5. **Window ratio `min(S…)/max(G…) < 4`** at either frame area — re-accept `2e-4` with the
   measurement recorded, and reopen with a proposal that is not a single global fraction.
6. `skipReason: 'no-detection-above-floor'` on any clip in any trial.
7. A1 or A2 fails — a floor change that misses its one purpose does not ship.

**A fired gate is recorded as fired** and adjudicated separately, with evidence, if it is accepted
anyway. Criteria are never edited to match a result.

---

# Risks

| # | Risk | Detected by |
|---|---|---|
| R1 | The floor rejects genuine distant subjects on footage we do not have (n = 3 scenes) | Demo 2's canary and the ≥2× margin. **Residual and real** — recorded, not claimed away. Live signal if it ever happens: `skipReason: 'no-detection-above-floor'` |
| R2 | Phantom size is not stationary; a later run produces one above the new floor | Max over 3 trials for `G4`/`G1`, plus the `double` plateau arm |
| R3 | The windows are an artifact of these three clips, not of the model | The conditional controlled downscale pair. If it is not run, assert nothing about resolution scaling and say so |
| R4 | Raising the floor changes boxless survival on Demo 1 | #55 has landed; cross-check `detectedSamplesOut` against both `segments[0].frameCount` and `rejectedOutsideEvidence` |
| R5 | Unit fixtures silently reclassify (the `CONFIG` coupling, D5) | `FLOOR_1080P`'s direct assertion fails loudly — that is the tripwire. Step 4.2 removes the coupling permanently |
| R6 | Probe scaffolding left in the tree | `grep -rn "bbox-trace" src scripts e2e` empty; `git status` clean of `*.experimental.ts` and the harvest script |
| R7 | The A/B measures a foreign checkout | `--port 5199` always; the driver's own refusal to reuse a server it did not start; the report header's commit stamp |
| R8 | GPU contention with a concurrent live run undercounts `detectedFrames` in both | Single-lane discipline — one GPU, one port, and the lane is held by another ticket until released |
| R9 | The probe perturbs the numbers used to justify it | The probe is reverted **before** any A/B arm runs |
| R10 | Demo 1 needs network (Pexels) for both the A/B and the keyframe download | Download the clip once to the scratchpad up front |

---

# Measured results

*TBD — Phase 2 (harvest + keyframe classification), Phase 3 (derivation), Phase 5 (live A/B).*

# Gate-by-gate verdict

*TBD — Phase 5.*

---

# Alternative delta branch (only if the two windows come out disjoint)

Recorded here so the branch is pre-drafted rather than improvised under a surprising measurement.
If no single fraction sits inside both frame areas' admissible windows, the fraction requirement's
central claim **reverses**: "the same physical subject at the same distance is judged identically
regardless of capture resolution" becomes false under a per-frame-area table, and its scenario
becomes an assertion that no longer holds. A MODIFIED block may not drop a scenario, so the delta
becomes:

```
## REMOVED Requirements
### Requirement: The area floor is a fraction of frame area, not an absolute pixel count
**Reason**: <the measured evidence that no single fraction fits both frame areas, with the numbers>
**Migration**: See the new "<new requirement name>" requirement below.
```

followed by `## ADDED Requirements` with a scenario asserting the *measured* two-frame-area
behaviour rather than the identity that no longer holds. The MODIFIED block on the floor
requirement is carried in this branch too. The controlled downscale pair is run **before** taking
this branch — a disjoint pair of windows from two confounded clips is not yet evidence about
resolution.
