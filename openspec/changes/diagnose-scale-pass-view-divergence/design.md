# Design — the MediaPipe/MoveNet view disagreement on Demo 2

## D1. Measured, on the default path

Read off `[analysis-diagnostics]` and `[analysis-diagnostics:scale-pass]` in one **default**
MoveNet-primary run — no backend override needed, because the scale pass IS MediaPipe. Headless
Chromium, real GPU, dev server on this checkout's derived port. Corroborated by a separate
`--backend-arm movenet/mediapipePoseLandmarker` matrix at 3 fresh trials per arm, zero spread.

| Demo 2 | primary (MoveNet) | scale pass (MediaPipe) | front bar | side bar |
|---|---|---|---|---|
| `view` | **front** | **ambiguous** | | |
| `confidence` | 0.5486 | 0.3 (the flat `0.3 × coverage` ambiguous value) | | |
| **BSR** | 0.5510 | **0.5229** | ≥ 0.45 → both vote FRONT | ≤ 0.30 |
| **SER** | 0.3284 | **1.5911** | ≤ 0.40 → MoveNet votes FRONT | ≥ 0.80 → **MediaPipe votes SIDE** |

`detectView` requires a 2–0 vote. MediaPipe scores `frontVotes = 1` (BSR) and `sideVotes = 1`
(SER), so neither reaches 2 and the label falls through to `ambiguous` at the flat confidence.

**The answer to the ticket's first question: the geometry is genuinely different, and it is
SPECIFICALLY the sagittal excursion ratio.** BSR agrees to within 5%. SER differs by **4.8×**, and
that single signal crosses two thresholds at once.

## D2. The disagreement is entirely in SER's numerator — the ankles

BSR and SER **share a denominator**: both divide by `estimateBodyScale`'s clip-wide
`torsoLengthPx`. BSR agrees to within 5%, so the two backends' torso estimates agree to within
about 5%. Therefore the 4.8× lives entirely in SER's numerator —
`percentile(ankle.x − hip.x, 0.95) − percentile(…, 0.05)`, averaged over the two legs. **MediaPipe's
ankles range ~4.8× further from their own hips, horizontally, than MoveNet's, on a clip where the
runner comes straight at the camera.**

The Demo 1 control is what makes this conclusive rather than suggestive:

| | MoveNet | MediaPipe | agreement |
|---|---|---|---|
| Demo 1 (side) BSR | 0.1335 | 0.1207 | within 10% |
| Demo 1 (side) SER | 1.5744 | 1.4147 | within 10% |
| Demo 2 (front) BSR | 0.5510 | 0.5229 | within 5% |
| Demo 2 (front) SER | 0.3284 | **1.5911** | **4.8×** |

On a side view the two backends agree on **both** signals within 10%. On a front view they agree on
BSR and diverge 4.8× on SER. And MediaPipe's front-view SER (1.5911) is **higher than its own
side-view SER** (1.4147): it reports more fore-aft ankle excursion on a dead-on approach than on a
dead-on side pass. That is anatomically impossible — a front view hides the leg's fore-aft reach in
depth, which is the entire premise of the signal — so the fault is MediaPipe's ankle placement, not
the scoring.

Consistent with the same run: MediaPipe detects **87/99** frames on this clip against MoveNet's
99/99. Hypothesis, stated as one and not measured here: MediaPipe Pose Landmarker predicts
landmarks for occluded and foreshortened parts rather than letting them collapse, so on a front
approach where the feet are foreshortened and periodically leave frame it extrapolates fore-aft
positions MoveNet does not.

## D3. `strides-2iw` is NOT implicated

The ticket's third point asked whether `strides-2iw`'s 2026-08-29 view-scoring change (margins now
ramp to what each signal can physically reach; `frontViewMinBilateralSpreadRatio` 0.55 → 0.45),
verified only on the MoveNet path, helps, hurts or does nothing on the MediaPipe path.

**It cannot reach this failure.** `strides-2iw` changed how a margin maps to a *confidence*; it did
not touch how a *vote* is cast, and Demo 2 fails on a vote — SER 1.5911 clears the `≥ 0.80` side
bar. `detectView`'s vote arithmetic is untouched by that work.

Its one threshold move (`frontViewMinBilateralSpreadRatio` 0.55 → 0.45) does not rescue the label
either, though it does change the route. MediaPipe's BSR is **0.5229**, which clears 0.45 but sits
*below* the old 0.55 — so before `strides-2iw` MediaPipe would have cast **no** BSR vote at all and
landed on `ambiguous` at 0–1 rather than at 1–1. Same label, different arithmetic.

Worth noting from the same numbers: **MoveNet's front label on this clip survived the old threshold
by 0.001.** Its BSR is 0.5510 against the old bar of 0.55. `strides-2iw` did not create MoveNet's
front label here, but it did move it off a knife edge.

So the answer to the ticket's third point is "does nothing here", and the reason is structural
rather than incidental.

## D4. Decision — the scale pass's view opinion should NOT gate grafted metrics, but removing the gate is UNSAFE today

### D4.1 Why the gate is wrong

`graftScalePassResult` copies the scale pass's `MetricResult` wholesale, `viewFit` included, while
explicitly discarding the scale pass's `view`: "Every other metric, and `view`, stay
reference-identical to `primary`'s." Measured consequence on Demo 2:

| | value | confidence | viewFit | tier |
|---|---|---|---|---|
| displayed `view` | `front` (MoveNet's) | 0.5486 | | |
| grafted `stepWidthCm` | **4.5309 cm** | 0.2 | **`unsuitable`** | **excluded** |
| grafted `verticalOscillationCm` | 10.4866 cm | 0.0500 | `tolerated` | caveated |

The panel tells the reader this is a front view, and simultaneously withholds a card because a
different, hidden pass thinks the view is ambiguous. Its caveat even says so —
*"Step width is a side-to-side measurement and is not reliable from a ambiguous view"* — naming a
view the panel never displays. A user cannot see the evidence for the exclusion, and the evidence
is wrong: **view is a property of the CLIP, not of a detector.** Both passes sample the same clip
on the same media clock. One camera angle. Two detectors disagreeing means one is mistaken, and D2
shows which.

### D4.2 Why removing it alone would make things worse

`stepWidthCm` is computed from **ankle positions at footstrike** — the exact thing D2 has just shown
MediaPipe gets wrong on this clip. The same run reports the two passes' own `stepWidth`:

| Demo 2 `stepWidth` (torso-normalised) | value | confidence | sampleSize |
|---|---|---|---|
| primary (MoveNet) | **0.2253** | 1.0 | 5 |
| scale pass (MediaPipe) | **0.4042** | 0.2 | 5 |

**1.79× apart**, same clip, same footstrike concept, same number of strikes. So the gate is reaching
a defensible OUTCOME — withhold a suspect number — for a FALSE REASON. Fixing the reason without
fixing the number would put `4.53 cm` on screen as a rendered card, sourced from keypoints measuring
the underlying quantity 1.79× away from the primary's own answer.

**Recorded decision: no, the scale pass's view opinion should not gate grafted metrics; and no, the
gate must not be removed as an isolated change.** Both halves matter. Filed as **`strides-wac`**
(a grafted metric inherits the primary's view), blocked on **`strides-boc`** (characterise
MediaPipe's front-view ankle placement) — which is what SHOULD gate `stepWidthCm` and currently
gates nothing.

## D5. `subjectAgreement` is structurally blind to this, and reads a perfect score

The same run: `subjectAgreement` `{ status: 'agreed', comparedInstants: 99, agreeingInstants: 99 }`.
A flawless 99/99.

#56 built that check to catch primary/scale-pass divergence, and it does exactly what it says: it
compares **which person** each pass selected. It is structurally incapable of seeing the two passes
disagree about the clip's **camera geometry**, or about a metric's **value** by 1.79×, because both
of those are compatible with looking at the same runner the whole time — which is precisely the
situation here. Worth knowing before reading a 99/99 as "the two passes agree". Filed as
`strides-lbg`.

## D6. Noticed in passing, not this ticket's subject

The generated caveat reads *"not reliable from **a ambiguous** view"*. User-facing copy, wrong
article. Filed as `strides-7wq` rather than folded in here, because it needs a verbatim-string test
update and does not belong in a diagnosis commit.
