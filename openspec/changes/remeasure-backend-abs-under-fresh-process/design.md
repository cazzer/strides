# Design — the two backend-plane A/Bs, re-measured

## D0. Regime

`scripts/ab-person-selection.mjs`, `--backend-arm` (new in `strides-4oj`), 3 trials per arm, clips
`demo1,demo2`, **fresh Chromium process per trial** (the default), dev server started and
identity-verified by each run, real GPU: `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`.
Commit `1c159bb`. Both runs printed `3/3 ok` on every cell.

**Every field in both matrices has ZERO spread except `elapsedMs`** — 24 trials, no range column
anywhere else. That is `strides-b0y`'s fresh-process determinism reproducing on a third and fourth
independent invocation, and it is the precondition that makes the adjudications below meaningful:
there is no longer a range to read a conclusion out of.

Tier boundaries throughout are `metricConfidence.ts`'s: `excluded` when `value === null` or
`viewFit === 'unsuitable'`, `normal` at `confidence >= 0.7`, `caveated` otherwise.

---

## D1. Tracking crop — the pre-registered rule DOES NOT FIRE

Arms `{"trackingCrop":{"enabled":false}}` vs `{"trackingCrop":{"enabled":true}}`.

The 2026-08-13 rule was: **"any median tier degrades → default off"**. Re-adjudicated cell by cell
across all 11 metrics on both clips:

| clip | tiers that DEGRADE | tiers that IMPROVE |
|---|---|---|
| demo1 (track) | **none** | `cadence` caveated → **normal** (0.634 → 0.728) |
| demo2 (park) | **none** | none |

**The rule does not fire.** The stated basis for the shipped default-OFF is therefore retired.

### D1.1 What happened to the cell the decision turned on

The 2026-08-13 decision rested on park cadence/VO confidence going T2 → T3. Fresh:

| demo2 | off | on |
|---|---|---|
| `cadence.confidence` | 0.37247 | **0.155874** |
| `verticalOscillation.confidence` | 0.37247 | **0.155874** |
| `cadence.value` | 181.2 | 181.2 |
| `sampling.detectedFrames` | 99 / 99 | 99 / 99 |

The confidence degradation is REAL and reproduces — it more than halves. What has changed is that
it no longer crosses a tier boundary, because the **off-arm baseline itself moved down**: it read
0.63–0.69 on the 2026-08-13 commit and reads 0.372 today, already caveated. There is no longer a
tier for the on arm to lose.

The cold-trial artifact the ticket flagged is gone outright: the 2026-08-13 park `detectedFrames`
row read 62/75/76 (on) against 75/75/76 (off); fresh, **both arms are 99/99 with no spread**. The
throughput penalty that row recorded was the regime, not the arm.

### D1.2 demo1 says the opposite of demo2, clearly

| demo1 | off | on |
|---|---|---|
| `sampling.detectedFrames` | 53 | **59** |
| `personSelection.segmentCount` | 4 | **3** |
| `segments[0].endTimestamp` | 6.32 | **7.16** |
| `cadence.confidence` | 0.634 | **0.728** (tier ↑) |
| `kneeFlexion.confidence` | 0.8636 | **0.9915** |
| `trunkLean.confidence` | 0.9407 | **0.9915** |
| `footStrikePattern.confidence` | 0.875 | **1.000** |
| `overstriding.confidence` | 0.875 | **1.000** |
| `verticalOscillation.confidence` | 0.7192 | **0.8257** |
| `verticalRatio.confidence` | 0.4795 | **0.5504** |

Uniformly better, with a longer winner track and one fewer segment. This is the same direction the
original 2026-08-11 and 2026-08-13 verifications found on this clip.

### D1.3 The default stays OFF — on a NEW basis, and that distinction matters

The rule not firing is **not** evidence to turn the crop on. It was a one-way gate ("degrade →
off"), so its silence removes a reason to keep it off; it supplies no reason to switch it on.

And the fresh numbers surface something the 2026-08-13 A/B structurally could not see, because that
table reported confidences and not values:

| demo2, `normal` tier both arms | off | on | ratio |
|---|---|---|---|
| `stepWidth.value` @ confidence **1.000** both arms | 0.225311 | **0.0717871** | **3.1×** |

A metric the UI presents as a full-confidence card reads three times larger in one arm than the
other, on the same clip, and nothing in the confidence machinery notices. There is no ground truth
for which is right. Alongside it, `kneeFlexion.value` on demo2 goes 106.103° → **177.686°** — a
knee essentially straight at peak flexion, anatomically implausible — though at caveated confidence
in both arms.

Flipping a shipped default on evidence that simultaneously shows a normal-tier metric moving 3× is
not a defensible trade. **`trackingCrop.enabled` stays `false`**, and the file now says why on
today's terms rather than on a rule that no longer fires. The stepWidth divergence is filed
separately rather than buried here.

---

## D2. Person-of-interest — the cost figure is restated, and most of it is withdrawn

Arms `{"personOfInterest":{"enabled":false}}` vs `{"personOfInterest":{"enabled":true}}`. Per the
ticket, the **default is not under review**; only the cost figure is.

### D2.1 The 2026-08-15 figure was measured on a quantity that has since changed meaning

The claim was "track loses ~16% of detected frames (~4% of samples), park loses ~25% of both",
measured on `sampling.detectedFrames`. **That field became POST-person-selection on 2026-08-16**,
one day after that A/B — `retroactive-person-selection` shipped between them. The quantity
comparable to what 2026-08-15 measured is today's `personSelection.detectedSamplesIn`. Both are
reported below, because they say different things and only one of them is the user-visible number.

| | demo1 off → on | demo1 Δ | demo2 off → on | demo2 Δ |
|---|---|---|---|---|
| `detectedSamplesIn` (pre-selection — the 2026-08-15 quantity) | 84 → 66 | **−21.4%** | 99 → 99 | **0%** |
| `sampling.detectedFrames` (post-selection — what a user gets) | 47 → **53** | **+12.8%** | 99 → 99 | **0%** |
| `sampling.totalSamples` | 228 → 228 | **0%** | 99 → 99 | **0%** |
| `elapsedMs` | 3753 → 5765 | **+53.6%** | 2448 → 3134 | **+28.0%** |

Restated:

- **Track's pre-selection detection cost is real and slightly larger than claimed** — −21.4%
  against a claimed −16%.
- **Park's cost is WITHDRAWN.** Claimed −25% of both counts; measured **exactly 0** on both,
  with no spread across 3 trials per arm. It sits inside the magnitude the regime alone produces.
- **The "~4% of samples" cost is WITHDRAWN on both clips.** `totalSamples` is identical in every
  arm and trial: 228/228 and 99/99. The sampler covers the clip either way.
- **The user-visible throughput on track is a GAIN, not a loss** — +12.8%. Person selection keeps
  far more of what the POI path detects than of what it detects without it.
- **The real cost is wall-clock, and 2026-08-15 did not report it:** +28% to +54%.

### D2.2 Why the post-selection gain happens, and why it corroborates the ship decision

| demo1 | off | on |
|---|---|---|
| `personSelection.rejectedOtherSegment` | **32** | 10 |
| `personSelection.rejectedBelowFloor` | 3 | 0 |
| `segments[0].startTimestamp` | **4.36** | **0.08** |
| `segments[0].frameCount` | 47 | 53 |
| `personSelection.separationRatio` | 689.13 | **2374.07** |

With POI off, the winning segment does not begin until **4.36 s into the clip** and 32 detections
are attributed to somebody else. With it on, the winner runs from 0.08 s and only 10 are, at a
separation ratio 3.4× higher. The POI path detects fewer raw frames and then loses far fewer of
them to the wrong person — which is precisely the correctness claim the 2026-08-15 default rests
on, now visible directly in the selection counters rather than inferred.

### D2.3 One honest contradiction: "tiers hold" does not fully reproduce

The 2026-08-15 conclusion included "confidence tiers hold". Fresh, on demo1, **`cadence` degrades
`normal` → `caveated`** with POI on (0.7176 → 0.6341). No other tier moves on either clip.

That is recorded rather than smoothed over — but it should be read with the values beside it:

| demo1 `cadence` | off | on |
|---|---|---|
| `value` | 93.6 | **91.2** |
| `confidence` | 0.7176 | 0.6341 |

**91.2 is this repo's own standing anchor for this clip.** CLAUDE.md's regression anchor asserts
`fit.frequencyHz × 60 = 91.2 == cadence.value 91.2`, re-confirmed on three separate dates. So the
higher-confidence arm is the one whose number disagrees with the established ground truth. A tier
degradation onto the correct value is not a reason to revisit a default that exists to fix a
correctness bug; it is a reason to record that the tier is not measuring what "tiers hold" was
taken to mean. Filed separately.

---

## D3. What was NOT done

- **multiperson was not run.** The ticket specifies "both demo clips" for both A/Bs, and that is
  what was measured. `multiperson` would be the natural third clip for the POI arm specifically —
  it is the only fixture with a genuine second near-field person — and is left for whoever picks
  up the follow-up.
- **`POST_ACQUISITION_SETTLE_FRAMES` / `REVERIFICATION_INTERVAL_FRAMES` were not decomposed.**
  They still have no runtime override point, so the +28–54% wall-clock figure remains the combined,
  ship-relevant cost, exactly as 2026-08-15 recorded.
