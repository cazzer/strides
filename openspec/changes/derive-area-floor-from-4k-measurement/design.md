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

Measured 2026-08-17, commit `fee2ff5`, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`, confirmed
by the driver's own renderer check — not SwiftShader), dev server started by the run on
`--port 5199`, 3 trials per clip, no config override. Frame geometry re-confirmed with `ffprobe`:
Demo 1 3840×2160 landscape, Demo 2 **2160×3840 portrait**, multiperson 1920×1080 — so both demo
clips really do share a frame area of 8,294,400 px² with transposed dimensions, as D1 assumed.

## Trace shape

| clip | samples | detected | boxless | boxes | segmentCount | winner span |
|---|---|---|---|---|---|---|
| demo1 | 228/228/228 | 66/65/65 | 8/8/8 | 58/57/57 | 4/3/3 | [0.08, 6.32] / [0.08, 7.16] ×2 |
| demo2 | 99/99/99 | 99/99/99 | 0/0/0 | 99/99/99 | 1/1/1 | [0.0334, 1.6683] ×3 |
| multiperson | 233 ×3 | 204 ×3 | 26 ×3 | 178 ×3 | 2/2/2 | [1.75, 3.90] ×3 |

Demo 2 and multiperson were **bit-identical across all three trials**. Demo 1 varied by exactly
one detection: trial 1 found a box at t=6.36 that trials 2–3 did not, which is the whole reason
its `segmentCount` reads 4 there and 3 in the others.

## The four endpoints, keyframe-classified

Every endpoint below was extracted with `ffmpeg -i clip.mp4 -ss <t> -frames:v 1` (output seeking)
and inspected as an image, both as a full frame and as a grid-overlaid crop centred on the
reported bounding-box centre.

| symbol | value | fraction | clip | timestamp | box | keyframe verdict |
|---|---|---|---|---|---|---|
| `G4` | **8,432.19 px²** | 1.01661e-3 | demo1 | 8.36 | 49.9×169.1 at (2943, 790), n=9, s=0.323 | **PHANTOM** — the frame is an empty track; the crop is stadium seating and fence |
| `S4` | **24,473.2 px²** | 2.95057e-3 | demo1 | 4.32 | 58.6×417.8 at (896, 606), n=4, s=0.258 | **GENUINE SUBJECT** — the runner mid-frame; the box has collapsed onto his front-arm/chest column |
| `G1` | *see below* | — | multiperson | — | — | **no clean phantom endpoint exists at 1080p** |
| `S1` | **8,835.6 px²** | 4.26100e-3 | multiperson | 1.75 | 43.9×201.4 at (1576, 716), n=11, s=0.367 | **GENUINE SUBJECT** — the runner entering frame right; box collapsed to his torso column |

**Demo 1's out-of-winner population is entirely phantom, and reproduces the ticket exactly.** The
five timestamps are t = 6.36, 7.20, 7.28, 7.44, 8.36 at 3,539 / 4,448 / 3,789 / 2,279 / 8,432 px²
— the same five the ticket named. Keyframes at 6.36, 7.20 and 8.36 all show a completely empty
track: no person anywhere in frame. `G4` is stationary to six significant figures across all three
trials (8432.18 / 8432.18 / 8432.19), so R2 (non-stationary phantom size) does not bite here.

**Demo 2 contributes no phantom endpoint at all** — one segment spanning the clip, every detection
inside the winner. Its smallest box is 50,000.5 px² at t=0.2002 (141×354 at (823, 1922), n=11,
s=0.666), keyframe-confirmed as **the runner at his most distant point in the approach**: a real,
genuinely distant subject at 4K. `S4 = min(24,473.2, 50,000.5) = 24,473.2`.

**`G1` cannot be pinned to one number, and the ambiguity is recorded rather than resolved by
fiat.** Multiperson's non-subject detections fall into three keyframe-classified groups:

- **A real near-field bystander** (the walker in white, x ≈ 50–130): 9,431.7 px² down to ~482 px²,
  confirmed at t=0.0333 (a clearly visible person) and again at t=3.80. A bystander is **not** a
  phantom — under D2's operative definition, floor-rejecting one is a permitted casualty, not a
  lower bound the floor must clear.
- **A facade box**: 4,646.9 px² at t=1.2833, a 30.8×150.9 column at (820, 105) — above the fence
  line, across a building facade, whose bottom ~20 px grazes one distant background head. Not a
  person box. **Spurious.**
- **Degenerate slivers** at two fixed screen positions, c ≈ (492, 604–614) and c ≈ (1030, 602):
  227.8 px² down to 7.9 px², the largest being 227.8 at t=0.6333. Keyframe at t=0.6833 shows empty
  court. **Spurious** — this is the same 5–183 px² fixed-position garbage D4 originally measured on
  the repro clip, reproduced.

So `G1` is either **227.8 px²** (1.09857e-4, strict: the largest detection on genuinely empty
pixels) or **4,646.9 px²** (2.24098e-3, inclusive: the largest box that does not enclose a person).
Both readings are carried forward below; neither changes the verdict.

## Windows and the margin rule

```
4K:     window ( G4/A_4K , S4/A_4K ) = ( 1.01661e-3 , 2.95057e-3 )   ratio 2.902
1080p:  window ( G1/A_1080, S1/A_1080 )
          strict    G1 = 227.8   → ( 1.09857e-4 , 4.26100e-3 )       ratio 38.79
          inclusive G1 = 4,646.9 → ( 2.24098e-3 , 4.26100e-3 )       ratio 1.901

combined, strict    ( 1.01661e-3 , 2.95057e-3 )   ratio 2.902
combined, inclusive ( 2.24098e-3 , 2.95057e-3 )   ratio 1.317
```

**The pre-registered ship rule requires a window ratio ≥ 4. The measured ratio is 2.902 on the
most generous reading and 1.317 on the strictest. Do-not-ship condition 5 FIRES.**

Had a value been shipped, it would have been `f = √(1.01661e-3 × 2.95057e-3) = 1.7319e-3`, i.e.
**1.7e-3** to 2 s.f. — 14,100 px² at 4K, 3,525 px² at 1080p. D3's criterion 2 fails there too, and
by how much is worth recording: `f × A_4K / G4 = 1.672` and `S4 / (f × A_4K) = 1.736`, both short
of the required 2. At 1080p the same value clears `S1` by 2.506× (fine) but sits *below* the
inclusive `G1`, so it would not reject the facade box.

## Why the window is narrow — the finding that matters

**The squeeze is intra-clip, not cross-resolution.** `G4` and `S4` both come from Demo 1: the same
clip, the same scene, the same 4K frame. The largest spurious detection and the smallest genuine
subject detection on that one clip are only **2.90× apart**. No resolution model — a fraction, a
per-frame-area table, a hybrid, or a power law — can widen a gap that exists *within* a single
frame area. This is a stronger and more general result than "this particular fraction is wrong",
and it retires the whole "re-derive the number" direction rather than just this attempt.

**The binding constraint is not the one the ticket assumed.** The ticket, and D2, expected the
ceiling to be "a distant real subject" — and Demo 2 supplies exactly that at 50,000 px², a
comfortable 5.9× above the largest phantom. A floor sized purely against distant subjects would
have had plenty of room. What actually binds is a **collapsed box on a near subject**: the t=4.32
wedge, where `deriveBoundingBox` hulls only 4 confident keypoints and returns a 58×418 px sliver on
a runner who occupies roughly 240×705 px. Phantom boxes and collapsed-subject boxes both come out
as narrow vertical slivers of a few thousand px², because both are the *same kind of failure* — a
box hulled from too few, badly-placed points. Area cannot separate them, because area is not what
distinguishes them.

**Confidence cannot separate them either — measured, and this rules out the obvious follow-up.**
The probe carried `meanConfidence` and confident-keypoint count for free precisely so this could be
checked. The largest phantom (t=8.36) has **n=9, s=0.323**. The genuine collapsed subject frame
(t=4.32) has **n=4, s=0.258**. The phantom is detected with *more* confident keypoints and a
*higher* mean confidence than the real subject frame. A confidence gate layered on top of, or
instead of, the area floor would reject the subject before the phantom. That is a negative result,
but a load-bearing one: it removes the cheapest alternative from the table before anyone spends a
cycle on it.

**Why keeping the wedge frame is not negotiable.** One could argue `S4` should exclude t=4.32 as a
"detection failure rather than a genuine small subject" — and doing so would lift the ceiling to
Demo 2's 50,000 px², giving a ratio of 5.93 and a passing window. That argument is refused on
pre-registered grounds: criterion **A4** requires `segments[0].frameCount >= 53` and do-not-ship
condition **2** fires if Demo 1's healed track loses frames. Floor-rejecting t=4.32 drops the
winner to 52 detections and takes `bridgedCuts` to 0 — #54's healed wedge, undone. The gate binds
regardless of how the frame is labelled, so the ceiling is 24,473.2 px². Criteria are not edited to
match a result.

## Live A/B — recorded evidence, explicitly NOT a ship justification

The margin rule had already fired before this ran. It was run anyway because the reopened proposal
needs to know whether the thin margin is *thin-but-harmless* or *actually harmful*, and because a
plateau sweep is the behavioural form of the same question the arithmetic asks. **Nothing here can
un-fire gate 5**, and the verdict below was written before the table was read.

`scripts/ab-person-selection.mjs` (unmodified), commit `fee2ff5` **with the probe already
reverted**, 4 arms × 3 clips × 3 trials, `--port 5199`, dev server started by the run, real GPU.
Baseline spells the old value out rather than using `{}`. One trial failed
(multiperson/half/trial 1, a 300 s `analysis complete` timeout); the same arm succeeded on trials
2 and 3, so it is a flake, not an arm property.

| | base `2e-4` | chosen `1.7e-3` | half `8.5e-4` | double `3.4e-3` |
|---|---|---|---|---|
| **demo1** floor px² | 1,658.88 | 14,100.5 | 7,050.24 | 28,201 |
| `segmentCount` | 3 [3..4] | **1** | 2 | 1 |
| `rejectedOtherSegment` | 7 [7..10] | **0** | 3 | 0 |
| `rejectedBelowFloor` | 0 | 4 | 3 | 5 |
| `rejectedOutsideEvidence` | 5 [3..5] | 8 | 6 | 8 |
| `detectedSamplesOut` | 53 | 53 | 53 | **52** |
| `segments[0].frameCount` | 53 | **53** | 53 | **52** |
| `segments[0].medianAreaPx` | 491,133 [..492,789] | 491,133 | 491,133 | 492,704 |
| `bridgedCuts` | 1 | 1 | 1 | **0** |
| **demo2** everything | — | **bit-identical to base** | bit-identical | bit-identical |
| **multiperson** floor px² | 414.72 | 3,525.12 | 1,762.56 | 7,050.24 |
| `detectedSamplesOut` | 127 | 122 | 125 | 115 |
| `segments[0].frameCount` | 123 | **119** | 121 | **112** |
| `segments[0].medianAreaPx` | 31,670.2 | 31,937 (+0.84%) | 31,902.9 | **33,190.9 (+4.80%)** |
| `separationRatio` | 33.5 | 41.7 | 35.2 | 75.3 |

**Demo 1 at `chosen` reaches the epic gate.** `segmentCount === 1` and
`rejectedOtherSegment === 0`, 3/3 trials — A1 and A2, epic #52's amended headline criterion —
with the healed track fully intact (`frameCount` 53, `startTimestamp` 0.08, `medianAreaPx`
491,133, `bridgedCuts` 1) and **every metric value identical to baseline**. A3 lands exactly:
`rejectedBelowFloor` is 4 against a probe phantom count of 4 on the 65-detection trials. The
`detectedFrames` prediction holds precisely — 53 → 53, with the 7 former `rejectedOtherSegment`
frames redistributing into `rejectedBelowFloor` (4) and `rejectedOutsideEvidence` (5→8), and the
accounting identity closing at 65 − 4 − 0 − 8 = 53. `separationRatio` → `null` and
`endTimestamp` → 9.16, both predicted.

**And the plateau collapses on both sides, exactly as the arithmetic said it would.** This is the
finding, not an aside:

- **`half` (f/2) misses the phantom.** The largest measured phantom is 8,432 px²; f/2 resolves to
  7,050 px². `segmentCount` 2, `rejectedOtherSegment` 3 — A1 and A2 both fail. The floor is back
  to not doing its job.
- **`double` (f×2) eats the subject.** f×2 resolves to 28,201 px², above the 24,473 px² wedge.
  `segments[0].frameCount` drops to 52 and `bridgedCuts` to 0 — **#54's healed wedge, undone**,
  which is do-not-ship condition 2 firing on measurement rather than on prediction. Demo 1's
  metrics move well outside the baseline trial range with it: `overstriding` 0.215 → 0.052,
  `footStrikePattern` −0.159 → −0.259, `armSwingSymmetry` 0.756 → 0.862, `view.confidence`
  0.774 → 0.730.

So `f` is not sitting on a plateau at all — it is balanced between two failures a factor of two
away in either direction, and the pre-registered gate D fails on **both** sides. That is the same
2.9×-wide window, measured behaviourally instead of arithmetically, and the two agree.

**Multiperson costs the winner frames at `chosen`, and the adjudication is nuanced.**
`segments[0].frameCount` 123 → 119 and `detectedSamplesOut` 127 → 122, so criterion C's "does not
decrease" and do-not-ship 3's "the winner loses frames" both **fire**. The adjudication, from the
trace: the four boxes inside the winner that fall under 3,525 px² are at t = 3.6333 (1,603 px²),
3.80 (1,095), 3.8167 (2,000) and 3.90 (1,976) — all at c ≈ (110–120, 615–655), all **after** the
runner has exited frame left at t ≈ 3.55, and t=3.80 is keyframe-confirmed as **the standing
bystander**, not the runner. So the floor is removing bystander frames from the winner's tail,
which is desirable. The criterion was written before anyone knew the winner's partition tail
contained bystander detections; it fires anyway and is recorded as fired rather than reworded.
`medianAreaPx` moves +0.84%, inside the 1% bound. At `double` it moves **+4.80%**, breaching it.

**Do-not-ship 4 fires at `chosen` on multiperson**, but weakly and for a measurement-design
reason worth naming: the multiperson baseline is bit-identical across all three trials, so its
"baseline trial range" is a single point and *any* movement is outside it. `trunkLean`
4.104 → 4.182, `armSwingSymmetry` 0.420 → 0.378, `stepWidth` 1.376 → 1.395. These are small and
consistent with dropping four bystander frames; the criterion as written has no tolerance band
for a deterministic baseline. Recorded as fired, with that caveat, rather than reinterpreted.

# Gate-by-gate verdict

**VERDICT: do not ship a new number. `minBoundingBoxAreaFraction` stays at `2e-4`.** This is the
outcome D2 and Phase 3.3 explicitly pre-authorised: *"If the ratio is < 4, do not ship a number.
Record the measurement, re-accept `2e-4`, and reopen with a proposal that is not a single global
fraction."*

The stop is **overdetermined**, not marginal — three independent pre-registered conditions fire,
one at the derivation and two on live measurement:

| gate | outcome at `chosen = 1.7e-3` |
|---|---|
| **5 — window ratio ≥ 4** | **FIRED.** 2.902 (generous reading) / 1.317 (strict). Blocks on its own; no A/B result can overturn arithmetic. |
| **3 — multiperson winner keeps its frames** | **FIRED.** `frameCount` 123 → 119, `detectedSamplesOut` 127 → 122. Adjudication: the four lost frames are keyframe-confirmed bystander detections in the winner's tail. `medianAreaPx` +0.84%, within bound. |
| **4 — metric values inside the baseline range** | **FIRED** (weakly) on multiperson: the baseline is deterministic, so its range is a point and any movement is outside it. Demo 1 and Demo 2: no movement at all. |
| **D — ≥2× plateau either side** | **FAILED BOTH SIDES.** `half` misses the phantom (`segmentCount` 2, `rejectedOtherSegment` 3); `double` eats the wedge (`frameCount` 52, `bridgedCuts` 0). |
| 1 — Demo 2 canary | **PASS.** Bit-identical to baseline in every arm, including `double`. Its smallest genuine box (50,000 px²) is far above every candidate floor, so this clip never constrained anything. |
| 2 — Demo 1 `frameCount >= 53` | **PASS at `chosen`** (53). **FAILS at `double`** (52) — the wedge, eaten. |
| 6 — `no-detection-above-floor` | Not observed on any clip, in any arm. |
| 7 — A1 / A2 | **PASS at `chosen`** — `segmentCount === 1`, `rejectedOtherSegment === 0`, 3/3 trials. Epic #52's amended headline criterion *is* reachable at this value; gate 5 outranks it. |

**The honest summary of the tension**: a value exists (`1.7e-3`) that closes epic #52's headline
gate on Demo 1 with every metric unmoved and Demo 2 untouched. It is not shipped because it sits
in a 2.9×-wide window with no margin on either side, and the plateau sweep confirms behaviourally
that halving it re-breaks the phantom rejection while doubling it destroys #54's healed track. A
threshold with a factor-of-two cliff in both directions, derived from three scenes, is a
liability on footage nobody has measured — which is exactly what the margin rule was written to
refuse, and refusing it is the rule working, not the rule being inconvenient.

The spec delta drafted for this change is **withdrawn, not weakened**. Its added paragraph
requires the floor to sit above the largest measured spurious detection *and* below the smallest
measured genuine subject; the measurement shows those two constraints admit only a 2.9×-wide band,
so shipping that requirement while the code stays at `2e-4` would ship a contract the
implementation knowingly violates.

**What DOES ship from this change:** the test-suite decoupling (step 4.2), which is independent of
the number and prevents the next re-derivation from silently reclassifying a dozen fixtures, plus
this measurement record and the updated derivation comment in `retroactivePersonSelection.ts`.

## Where the next attempt should start

Not with a different number, and not with a different resolution model — both are ruled out above.
The measurement points at three directions, in rough order of promise:

1. **Reject on box SHAPE, not box area — but only as half of a rule.** Every phantom measured on
   Demo 1 is a narrow vertical sliver: 49.9×169.1, 25.1×177.3, 22.2×170.9, 21.0×108.6, 27.7×127.6
   — height:width from 3.4:1 to 7.7:1, all at y ≈ 750–790 (the seating/fence band). Well-detected
   genuine subject boxes are 238×705, 264×806, 141×354 — 2.5:1 to 3.1:1, a cleanly separated band.
   **But the t=4.32 wedge is 58.6×417.8, i.e. 7.1:1, and multiperson's `S1` is 43.9×201.4, i.e.
   4.6:1** — both genuine, both squarely inside the phantom band. Shape fails on exactly the same
   frames area fails on, and for the same reason: a collapsed hull over four keypoints is a sliver
   whoever it belongs to. Shape is only useful combined with something else.
2. **Reject on POSITION persistence.** Demo 1's phantoms cluster at two fixed screen positions
   (x ≈ 1710–1713 across t = 7.20/7.28/7.44, and x ≈ 2943/3185) with near-zero motion, and
   multiperson's slivers sit at exactly c ≈ (492, 604) and c ≈ (1030, 602) for ~0.5 s. A real
   subject moves. This is the one discriminator the data supports that area does not, and it is
   the same observation D4 made about the original repro clip ("at a fixed screen position, for
   ~0.5s") without acting on it.
3. **Nothing based on confidence.** Measured and ruled out above: the largest phantom has n=9 /
   s=0.323 against the genuine wedge's n=4 / s=0.258.

Note that (1) and (2) both describe the *segmentation* stage's job rather than the floor's — a
fixed-position, non-moving cluster is precisely what a continuity bound is for. The most likely
correct conclusion is that **the area floor should stay a coarse degenerate-box filter at `2e-4`
and phantom rejection should move to a stage that can see motion**, which is a different proposal
from this one and should be scoped as such.

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
