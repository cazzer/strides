# Metric-layer changes that moved quoted numbers

> Moved verbatim from CLAUDE.md on 2026-10-27 to keep the auto-loaded file under the size limit. Index: CLAUDE.md "Notes index". Cross-references like "above"/"below" may now point into a sibling file in this directory.

## Three metric-layer changes that moved numbers this file quotes (2026-08-29/31)

Every "expected value" recorded elsewhere in this file predates at least one of these. Check a
surprising reading against them before filing it as a regression.

**1. `view.confidence` is now comparable between a side label and a front label** (`strides-2iw`,
`a468fdb`, archived `2026-08-29-compare-view-confidence-across-labels`). It was not: the old
`marginAwayFromZero(value, threshold)` saturated at 2× the threshold, and for the bilateral-spread
ratio that point (1.10) sits at roughly twice the signal's ANATOMICAL maximum — so a perfect front
view structurally topped out around 0.51–0.61 while a side view could reach 1. Every per-(view,
signal) margin now ramps from its threshold to what that signal reads with the camera dead-on for
that view. **`frontViewMinBilateralSpreadRatio` moved 0.55 → 0.45**, forced rather than preferred:
0.55 sat BETWEEN a narrow build's dead-on value (0.4712) and the central one (0.5612), so it was
unreachable at any camera angle for a narrow-built runner. A threshold sweep is **flat across
0.35–0.50** — a plateau, the opposite of the 4K-area-floor's factor-of-two cliff, and the reason
this one was shippable. Measured effect: Demo 2 **0.0771 → 0.5343**, side controls untouched to
every digit, and **no metric changed value, confidence, `viewFit` or tier on any clip**.
- **Consequence for this file:** every `view confidence` figure recorded above this section — the
  pipeline-comparison table's `~0.76-0.79`, the tracking-crop A/B's park `0.073–0.136` — is on the
  OLD scale. Side-label numbers survive the rescale essentially unchanged; **front-label numbers do
  not** and must not be compared against a reading taken today. Current fresh-process values on
  `c79d307`: Demo 1 **0.7615**, Demo 2 **0.5486**, multiperson **0.7132**.
- Established in passing and worth knowing: `view.confidence` has exactly TWO readers —
  `fuseHeuristics.ts`'s cross-clip view pick and the dev diagnostics line. Everything user-facing
  gates on `view.plausibility` instead, since `strides-ich`.

⚠️ **The two backends disagree about Demo 2's view, and it is MediaPipe's ANKLES, not the scoring**
(`strides-fn4`, 2026-08-31). This matters on the DEFAULT path, not only under an override: the
background scale pass **is** MediaPipe, so every grafted centimetre metric arrives carrying
MediaPipe's view opinion. Measured in one default MoveNet-primary run, both console lines:

| Demo 2 | primary (MoveNet) | scale pass (MediaPipe) | bars |
|---|---|---|---|
| `view` | **front** | **ambiguous** | needs a 2–0 vote |
| `confidence` | 0.5486 | 0.3 (the flat `0.3 × coverage`) | |
| **BSR** | 0.5510 | **0.5229** | ≥ 0.45 → both vote FRONT |
| **SER** | 0.3284 | **1.5911** | ≤ 0.40 front; **≥ 0.80 side** → MediaPipe votes SIDE |

1–1, so `ambiguous`. **BSR agrees to within 5%; SER differs 4.8×.**

⚠️ **RETRACTION (`strides-boc`, 2026-08-31).** This paragraph used to argue: "BSR and SER share a
denominator (`torsoLengthPx`), so the entire 4.8× is in SER's numerator." **The premise is true and
the conclusion does not follow.** BSR agreeing pins the *ratio* `N_bsr / T`, not `T` — algebraically
`(N_ser,mp / N_ser,mn) = 4.61 × (N_bsr,mp / N_bsr,mn)`, so the ankle-range ratio is 4.8× only if the
two backends' shoulder/hip spreads also agree, which nobody had measured. The conclusion SURVIVES
measurement (`torsoLengthPx` ratio mp/mn = **1.058–1.075×**, measured `strides-boc`), so the numbers
here stand — but the reasoning was luck, and the same argument would have concealed a hip-side or
torso-side error. Two over-claims went with it: the `stepWidth` figure below is **not** independent
corroboration (it is the same quantity `ankle.x − hipMid.x` with a different denominator), and
`COMMON_KEYPOINT_NAMES` is **19** and includes heel/foot_index since `72b0564` (#44), not the 15
recorded elsewhere in this file. The Demo 1 control settles it: on a side view the two agree on **both** signals within 10%
(BSR 0.1335 vs 0.1207, SER 1.5744 vs 1.4147) — and MediaPipe's FRONT-view SER (1.5911) is **higher
than its own SIDE-view SER** (1.4147), which is anatomically impossible. Alongside it in the same run — the same
quantity seen through a different reduction, NOT independent corroboration: the two passes' own
`stepWidth` reads **0.2253** (MoveNet, conf 1.0) vs **0.4042** (MediaPipe, conf 0.2), **1.79×
apart**. `strides-boc` diagnosed the SER gap and **did not explain that 1.79×** — see below.

**`strides-2iw` is not implicated** — it changed how a margin maps to a *confidence*, not how a
*vote* is cast, and this fails on a vote. (Its threshold move does change the route: MediaPipe's
0.5229 sits below the old 0.55, so before `strides-2iw` it would have landed on `ambiguous` at 0–1
rather than 1–1. Same label. Separately worth knowing: **MoveNet's front label here cleared the old
0.55 bar by 0.001** — `strides-2iw` did not create it, but it did move it off a knife edge.)

**Consequence — `stepWidthCm` is structurally unable to render on the one clip it is designed for.**
`graftScalePassResult` copies the scale pass's `MetricResult` wholesale, `viewFit` included, while
explicitly discarding the scale pass's `view`. On Demo 2 the panel therefore shows **front** while
withholding a card whose caveat names a view the panel never displays:

| | value | confidence | viewFit | tier |
|---|---|---|---|---|
| grafted `stepWidthCm` | **4.5309 cm** | 0.2 | **`unsuitable`** (`ambiguous` → 0.2) | **excluded** |
| grafted `verticalOscillationCm` | 10.4866 cm | 0.0500 | `tolerated` (`ambiguous` → 0.6) | caveated |

**Recorded decision: the scale pass's view opinion should NOT gate grafted metrics — AND the gate
must not be removed as an isolated change.** View is a property of the CLIP, and the panel already
commits to the primary's answer for everything else the reader sees. But `stepWidthCm` is computed
from ankle positions at footstrike, which is exactly what MediaPipe gets wrong here, so the gate is
reaching a defensible OUTCOME for a FALSE REASON. Removing the false reason alone would put 4.53 cm
on screen sourced from keypoints measuring the underlying quantity 1.79× away from the primary's own
answer. `strides-wac` carries the fix, **blocked on `strides-boc`**.

⚠️ **`subjectAgreement` reads a flawless 99/99 through all of this.** #56's check compares **which
person** each pass selected, and is structurally blind to the two passes disagreeing about the
clip's camera geometry or about a metric's value — both entirely compatible with watching the same
runner throughout, which is what happens here. Do not read a 1.0 as "the two passes agree". Filed as
`strides-lbg`.

