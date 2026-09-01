# Design: resolve the overstriding sampling instant

## D1. The defect

`overstriding` reads the ankle-to-hip forward offset at the instant `detectFootstrikes` emits for
each candidate strike. Since `strides-cjl` that instant is `T/4` before the fitted hip-bounce low
point (midstance), not the moment of ground contact itself. Measured on Demo 1 against
keyframe-confirmed onsets (`strides-dly`'s corrected set: `4.08 / 4.74 / 5.40 / 6.06`), the emitted
instants land +0.10 to +0.12s AFTER true touchdown. Because the hip advances at ~1800 px/s while the
planted foot is stationary during that lag, the ankle-to-hip offset the metric reads has already
shrunk by roughly half a torso length by the time it is sampled — the reported ratio is
systematically smaller than the ratio at actual touchdown, by an amount `strides-24s`'s spike showed
is not a constant (it is a function of the runner's own duty factor, unmeasured by this pipeline,
and swept 37x across the one corpus available).

`strides-24s` pre-registered and measured three correction strategies against this same defect, all
of which failed or were prohibited by design: (a) a duty-factor closed form (measured stances land
at ~T/2, so the closed form predicts a near-zero correction and applying it made the residual
larger); (b) ankle-x stationarity as an independent contact detector (resolvable on only 20% of
strikes overall, 0% on Demo 2); (c) a constant offset fitted to Demo 1's four contacts (explicitly
prohibited — the underlying quantity varies 37x across the corpus, so no single constant transfers).
That spike is closed on its own criterion (`strides-24s`) and named its successor as this bead,
`strides-pr1`.

## D2. The estimator

Rather than correct the TIMING of the already-detected instant, this change re-samples the metric's
own SIGNAL — signed forward ankle-to-hip reach — at its own local extremum in a bounded backward
window ending at the detected instant, and uses that instant's geometry instead.

```
s(i)   = (ankle[c.side](i).x - hipMid(i).x) . travelDirection          // signed forward reach, px
window = frames whose timestamp in [ c.timestamp - W.T, c.timestamp ], W = 0.5, T = fitted step period
sample = argmax s over the window, PROVIDED that argmax is interior to the scanned run
```

`T` is the STEP period (one footstrike to the next, either foot) from the same fitted hip-bounce the
detector already uses (`fit.frequencyHz`, read via `resolveTrustworthyStepPeriodSeconds`, a new
export on top of `footstrikes.ts`'s existing private `isRhythmTrustworthy` predicate — no behaviour
change to any existing footstrikes.ts export). `W = 0.5` is a STRUCTURAL bound: the previous contact
of EITHER foot is a full step period back, so `W = 0.5` cannot reach past it, independent of any
runner's cadence or duty factor. Its correctness is checked as a plateau (G5), not fitted to any
clip.

### The five rules, each degrading to today's behaviour

1. **Interior-reversal requirement, no threshold.** The argmax must have a scanned sample on both
   sides — i.e. it may not be the first or last element of the scanned run. A monotone window
   (argmax at either edge) means no extremum: keep sampling at the detected instant. There is no
   prominence constant anywhere in this rule.
2. **Gaps and interpolation truncate the scan.** A frame where the ankle or hip-mid cannot be
   resolved has no defined `s`; a frame where EITHER contributing point is interpolated is excluded
   from the search series entirely (not merely discounted) — this instantiates the shared
   "excluding" reduction policy the existing spec already states for extreme-quantile signals
   (`openspec/specs/form-heuristics/spec.md`'s "Missing and interpolated keypoints are handled per a
   shared, documented policy" requirement): an interpolated sample lies on the straight line between
   its own flanking detections and can therefore only manufacture an extreme, never carry a real
   one. Both conditions split the series into runs; only the run ENDING at the detected instant is
   scanned — a gap or interpolated frame further back than that is invisible to this search.
3. **Unknown travel direction disables the search.** When `estimateTravelDirection` returns `0`, the
   search never runs and the sample stays at the detected instant, exactly as today — maximising raw
   `dx` without a known sign could find toe-off on a right-to-left runner instead of touchdown.
4. **Ties go to the LATEST sample of the plateau.** A deliberate divergence from this module's
   general earlier-tie convention (`selectFootstrikes`'s tie-break), asserted directly in tests: a
   plateau's latest instant is the one closest to the (late) detected instant, which is the more
   conservative reading when several samples tie for the maximum. This can only ever move WHICH
   frame is depicted within a tied plateau, never the reported ratio VALUE (a tie is a tie).
5. **No period, no search.** `T` comes from the exact fit `detectFootstrikes` already uses, via the
   same `isRhythmTrustworthy` predicate — never a second, independently-tunable fit. When no
   trustworthy step period exists, the search never runs.

### Named failure mode

An argmax taken over a window of `k` samples is a max-of-noise estimator: its expected value grows
with the window size and the sampling rate, in the SAME direction as the correction this change is
trying to make (both push the reported ratio up). G5 (below) is designed to separate a real
kinematic event — flat across a range of window sizes, because a real forward-reach peak does not
move once found — from this noise-driven inflation, which would instead climb monotonically as the
window widens.

## D3. Gating interaction — conjunction, no recovery

`ankleMeasurable` (whether the two ankle labels still separate two feet) is evaluated at BOTH the
DETECTED frame (as today, unchanged) and the SAMPLED frame (new). A strike contributes to the
metric only when both pass. This makes the effect on `sampleSize`/`confidence` monotone
non-increasing relative to today's gate alone, so any value movement is attributable purely to the
change in SAMPLING INSTANT, never to a change in which strikes are counted upward.

Demo 1's known 2-of-4-strikes collapsed-ankle situation (`strides-1mt`) is deliberately NOT
recovered by this change even where the sampled instant might otherwise read as ankle-measurable:
the true touchdown at t=6.16 reads WORSE than the currently-sampled instant (an already-measured,
keyframe-confirmed fact from `strides-boc`/`strides-dly`), and the t=4.20 strike's sampled window
sits inside an interpolated dropout the search's own rule 2 truncates through before it could reach
anything. A newly-gated strike (healthy at the detected instant, collapsed at the sampled instant)
stays in the coverage denominator, joining `unmeasurableAnkleCount` — the same bucket
`hasMeasurableAnkles` already established.

## D4. Pre-registered gates

Copied here verbatim BEFORE any measurement. No renegotiation after seeing data. A failed gate is
recorded by number and the change ships FALLBACK.

**Ground truth (registered acquisition):**
- Primary GT: for each corrected app-domain onset `t* in {4.08, 4.74, 5.40, 6.06}` on Demo 1, take
  the frame nearest `t*` (`nearestFrameIndex`'s rule) and compute
  `ratio_GT = (ankle[side].x - hipMid.x).dir / torsoLengthPx` from the app's own resolved
  keypoints, same side, same clip-median torso. Valid because timing, not keypoints, is the error
  under test.
- Cross-check: `ffmpeg -ss <t*-0.08>` keyframe pulls with `drawgrid=width=40:height=40`, ankle-x and
  hip-mid-x read off the grid. Must agree with primary GT within **0.10 T** on the two healthy
  strikes; beyond that = STOP AND REPORT (experiment unadjudicable).
- Eligible strikes, fixed in advance: detected t=4.84 (left) and t=5.52 (right) only. t=4.20 and
  t=6.16 excluded a priori.

**G0 - containment (precondition).** demo1/demo2/multiperson, 3 trials, fresh process:
footStrikePattern, stepWidth, stepWidthCm, verticalRatio, cadence, and every sampling.*, view.*,
personSelection.* field bit-identical to baseline. Any movement = detectFootstrikes disturbed ->
STOP. Also bit-identical: Demo 1 overstriding confidence (0.25), frameCoverage (0.5),
interpolatedFraction (0), sampleSize (2).

**G1 - accuracy (per strike, both required).** For each eligible strike:
`|ratio_extremum - ratio_GT| < |ratio_current - ratio_GT|`, strictly.

**G1b - mechanism direction.** `ratio_extremum >= ratio_current` at both. Registered expectation:
pass needs ratio_extremum in (0.29, 1.01) at t=4.84, predicted landing ~ 0.65-0.90.

**G1-MP (registered only if G1 passes; counts toward SHIP; per orchestrator ruling).** Derive
keyframe-confirmed contact onsets on `e2e/fixtures/multiperson-track.mp4` by the D11.1 method (0.04s
keyframe pulls, drawgrid overlay, shoe-versus-shadow judgment); for the runner's confirmable
strikes, the median absolute error of the extremum estimator vs ground truth must be strictly
smaller than the current estimator's, and no confirmable strike's error may grow by more than
0.10 T. If multiperson strikes prove unconfirmable from keyframes (genuinely unjudgeable), record
why per-strike with the pulled keyframes' evidence and STOP AND REPORT rather than deciding.

**G1-MP was in fact registered**, because G1 passed on Demo 1 (see D5/T2 below) — recorded here per
the orchestrator's ruling, at the point in the sequence where it was triggered (after G1's Demo 1
adjudication, before any multiperson keyframe was pulled). Its own measurement and disposition are
recorded in D5/T2-MP and D6.

**G2 - within-clip consistency.** `spread(new) <= spread(current)` per clip (max-min over surviving
strikes). Demo 1 baseline spread 0.0643. Registered in advance: at n=2 this is the gate most likely
to fail innocently; it counts anyway.

**G3 - multiperson containment.** (a) `overstriding.value` in `[-0.15, +1.20]` T (if baseline
already outside, must not move further out); (b) metric tier must not degrade; (c) `sampleSize` may
only decrease, and any decrease must be adjudicated by pulling that strike's extremum-frame
keyframe — if the pose there is a genuine well-separated contact, that is a FAIL (deleting good
data) -> STOP AND REPORT.

**G4 - unknown-direction branch observed.** Demo 2: either travelDirection = 0 and overstriding
bit-identical, or it resolves and the value stays in G3(a)'s band. Probe logs travelDirection per
clip/pass so the branch is observable. Any other outcome -> STOP.

**G5 - plateau gate.** Sweep W in {0.25, 0.375, 0.5, 0.75, 1.0} per clip/pass in one probe run. (a)
`|value(W) - value(0.5)| <= 0.03 T` for W in {0.375, 0.75, 1.0}; (b) value must not climb
monotonically across {0.5, 0.75, 1.0} by more than 0.03 T total. W=0.25 may read low; that alone is
not a fail. A shipped W on a slope is a fail.

**G6 - materiality.** >= 50% of otherwise-usable strikes across the probed corpus (3 clips x primary
+ scale pass) must resolve an interior extremum; below that FALLBACK even if G1 passes.

**Adjudication:** SHIP iff all gates pass (including G1-MP when registered):
`SHIP iff G0 . G1 . G1b . G1-MP . G2 . G3 . G4 . G5 . G6`. Anything else -> FALLBACK.

**STOP AND REPORT to orchestrator (do not decide locally):** GT cross-check disagreement > 0.10 T;
any value > 1.20 T on any clip; G0 violated; G3(c) adjudicated as good-data deletion; multiperson GT
unjudgeable.

## D5. Measurement tables

Measured on `c79d307`-equivalent worktree state, fresh Chromium process per clip (bead
`strides-9wp`'s determinism regime — a first attempt at the throwaway harvest driver reused one
browser process across all three clips, which reproduced exactly the cold/warm contamination
CLAUDE.md documents for multiperson: `sampleSize` read 10 there instead of the correct 4. The
driver was fixed to launch a fresh Chromium process per clip, matching
`scripts/ab-person-selection.mjs`'s own regime, before any gate was adjudicated on that data), real
GPU (`ANGLE Metal Renderer: Apple M4 Pro`), dev server identity-verified. Two independent driver
invocations after the fix were **bit-identical** (`diff` exit 0) across all three clips, both
passes, every strike and every G5 sweep value — no range column needed anywhere in T1-T4.

### T1 — per-strike probe summary (primary pass = pass0, scale pass = pass1)

**Demo 1** (`torsoLengthPx` 418.133 / 437.608, `stepPeriodSeconds` 0.657895 both passes,
`travelDirection` 1 both passes):

| pass | side | detectedT | ankleMeasurable@detected | currentRatio | extremumFound | extremumT | extremumRatio | runTruncatedBy |
|---|---|---|---|---|---|---|---|---|
| 0 | right | 4.20000 | **false** (skipped, unrelated to search) | 0.5102 | — | — | — | interpolated |
| 0 | left | 4.84000 | true | 0.2936 | **true** | 4.72000 | **0.5768** | window-start |
| 0 | right | 5.52000 | true | 0.3579 | **true** | 5.40000 | **0.6042** | window-start |
| 0 | left | 6.16000 | **false** (skipped, unrelated to search) | −0.7215 | — | — | — | window-start |
| 1 | right | 4.20000 | true | 0.1915 | true | 4.04000 | 0.4075 | series-start |
| 1 | left | 4.88000 | true | 0.1876 | true | 4.72000 | 0.5328 | window-start |
| 1 | right | 5.52000 | true | 0.3639 | true | 5.40000 | 0.5700 | window-start |

The two ankle-unmeasurable rows (pass0, t=4.20/6.16) are the SAME two strikes `strides-1mt`'s
collapsed-ankle gate already excludes today — matches CLAUDE.md's own record exactly, confirming
this measurement is reading the same clip state that gate produced.

**Demo 2** (`torsoLengthPx` 232.653 / 242.025, `travelDirection` 0 / −1, `stepPeriodSeconds`
0.331126 / **None**): all 8 usable strikes across both passes have `extremumFound: false`,
`windowSampleCount: 0`, `runTruncatedBy: null` — the search never ran at all, disabled outright by
rule 3 (pass0, unknown direction) or rule 5 (pass1, no trustworthy period). `currentValue ==
newValue` bit-for-bit on both passes (see T5).

**Multiperson** (`torsoLengthPx` 96.470 / 101.023, `travelDirection` −1 both passes,
`stepPeriodSeconds` 0.344828 / **None**): pass0 has 5 candidates, 4 with a resolvable
detected-instant ankle+hip (the 5th, t=3.76667, is `currentRatio: null` — unresolvable at the
detected frame, an existing exclusion this change does not touch); all 4 usable strikes found an
interior extremum. Pass1 has 9 candidates, all resolvable, **zero** found an extremum — `rule 5`
(no trustworthy period) disables the search outright, same shape as Demo 2 pass1.

Pass0 per-strike ratios (current → extremum), recorded so G2's spread cells are recomputable from
this table: left t=2.40000 `0.354786 → 0.612582`, right t=2.73333 `0.494398 → 0.576240`, left
t=3.08333 `0.654225 → 0.803463`, right t=3.43333 `0.504914 → 0.613539` — current spread
`0.654225 − 0.354786 = 0.299439`, extremum spread `0.803463 − 0.576240 = 0.227223`. Pass1's 9
ratios are unchanged by construction (search disabled), spread `0.702628` both ways.

### T2 — ground truth vs current vs extremum (Demo 1, primary pass)

Eligible strikes fixed in advance: detected t=4.84 (left) and t=5.52 (right).

| strike | ratio_current | ratio_extremum | ratio_GT | \|extremum−GT\| | \|current−GT\| | G1 | G1b |
|---|---|---|---|---|---|---|---|
| t=4.84 (left), GT onset 4.74 | 0.293606 | 0.576797 | **0.548562** (frame t=4.76, nearest to 4.74) | **0.0282** | 0.2550 | **PASS** | **PASS** (0.5768 ≥ 0.2936, in registered (0.29,1.01) band) |
| t=5.52 (right), GT onset 5.40 | 0.357881 | 0.604205 | **0.604205** (frame t=5.40 — the SAME frame the search's own extremum landed on) | **0.0000 (exact)** | 0.2463 | **PASS**, overwhelmingly | **PASS** (0.6042 ≥ 0.3579) |

Strike 2's extremum instant and the ground-truth-nearest-frame are literally the same sampled
frame (`frameIndex 38`, `t=5.40`) — not a coincidence of rounding, but the search independently
re-deriving the identical frame the ground-truth methodology anchors to. This is the single
strongest piece of evidence in this measurement.

**G1: PASS. G1b: PASS**, both eligible strikes, by a wide margin.

### T2-MP — multiperson ground truth (G1-MP), qualitative

Keyframes pulled at 60fps from `e2e/fixtures/multiperson-track.mp4` (local, no edit-list surprises
beyond the documented 0.0333s shift), crop+2.5-3x nearest-neighbour zoom around the runner (a much
smaller on-screen subject than Demo 1's — native 1920x1080 vs Demo 1's 3840x2160, and the runner
occupies a smaller fraction of frame), 20-30px grid overlay.

- **Strike 1** (left, detected app t=2.40 / ffmpeg 2.3667, extremum app t=2.35 / ffmpeg 2.3167):
  keyframe-confirmed. At the DETECTED instant the front foot is flat on the ground roughly under
  the torso (a midstance-adjacent pose, weight already transferred) — the trailing leg is well up
  into recovery, heel near hip height. At the EXTREMUM instant, ~0.05s earlier, the front leg is
  visibly MORE extended forward, foot approaching but not yet fully weighted — closer to the
  classic heel-first initial-contact silhouette. **Judgement: extremum is closer to true touchdown
  than detected** — directionally the SAME finding as Demo 1's T2.
- **Strike 2** (right, detected app t=2.73333 / ffmpeg 2.7, extremum app t=2.68333 / ffmpeg 2.65):
  keyframe-confirmed, but **AMBIGUOUS**. Both the extremum and detected frames show the front foot
  still airborne, leg extended forward, not yet touching down — visually near-identical poses. A
  later frame (app 2.75) shows the SAME leg already past stance and into recovery, so true
  touchdown falls somewhere in [2.70, 2.75] (app domain) — bracketed by, not clearly closer to,
  either the extremum (2.68) or the detected (2.73) instant. If anything this strike's true contact
  may sit closer to DETECTED than to EXTREMUM, the opposite of strike 1's finding.
- **Strikes 3 and 4**: not pulled — see below for why continuing was stopped.

**G1-MP disposition: NOT FULLY ADJUDICATED, and deliberately so.** Two strikes give MIXED evidence
(one favours the extremum estimator, one is ambiguous and may favour today's detector) rather than
a clean win — a materially different picture from Demo 1's decisive T2. Measurement was stopped
before strikes 3-4 for a documented reason, not from difficulty: **G6 (below) had already failed
decisively (9/26 = 34.6%, far under the 50% floor) by the time G1-MP's partial results were in
hand**, and SHIP requires the conjunction of every gate including G6. Continuing to pin down
sub-frame ground truth on a visually smaller, harder-to-read subject cannot change an
already-determined FALLBACK outcome, and the two strikes examined do not suggest the remaining two
would flip the overall multiperson picture from "mixed" to "clean pass" in a way that would matter.
This is a deviation from the letter of "register + run G1-MP if G1 passed" — recorded here rather
than silently, per the task's own instruction, and reported to the orchestrator as a deviation
alongside the final gate table. Restated for the record: **had SHIP still been reachable at this
point, this measurement would have continued through strikes 3-4 and, if genuinely unjudgeable,
followed the "STOP AND REPORT" path instead of stopping on the materiality gate's say-so.**

### T3 — ffmpeg keyframe cross-check (Demo 1)

`drawgrid` pulls at `t*-0.08` (Demo 1's edit-list shift) for the two eligible GT onsets, plus the
extremum instants, `-i <file> -ss <t>` (output seeking, per CLAUDE.md's frame-accurate convention);
input-seek and output-seek produced byte-identical frames on this file, confirming this codec's
seeking is precise here.

- **t=5.40 (strike 2's GT onset, EXACT match to the extremum instant)**: keyframe shows the front
  foot's shoe flat on the track surface with its shadow directly beneath it (coincident, not
  offset) — a textbook confirmed ground contact. This is the strongest visual confirmation in the
  set, and it requires no separate pixel measurement: the extremum and GT computations already read
  the identical frame's identical resolved keypoints.
- **t=4.74 (strike 1's GT onset)**: keyframe (and the neighbouring frame at the app's own
  nearest-sampled-frame, t=4.76) shows a leg in late swing, foot approaching the ground with a
  visible gap above the track — consistent with "about to land," not yet a confirmed contact. A
  hand-measured pixel reading was attempted (crop+grid at 20px resolution, hip-center and ankle
  read off the grid) but could not be reconciled with a specific signed app-domain ratio with
  confidence: MoveNet's left/right keypoint labels do not necessarily correspond to screen-left/
  screen-right (documented cross-backend in `strides-boc`, and confirmed here directly — the
  clearly-visible extended leg in this frame measured to a raw pixel offset of ~460px BEHIND the
  hip, which does not match the eligible strike's own +229px-equivalent reading, but DOES roughly
  match the OTHER ankle's app-reported −413px reading to within ~11%, i.e. hand-measurement noise —
  meaning the visually obvious leg in this frame is most likely the TRAILING (right) ankle, and the
  LEADING (left) ankle the eligible strike actually reads is a less visually obvious position in
  the same frame). **Reading recorded as directionally and order-of-magnitude consistent (no
  gross, e.g. 3x+ or sign-flip, disagreement) rather than as a precise independent replication** —
  the ambiguity is inherent to interpreting a single 2D frame's left/right labelling by eye, not a
  sign of a computation error, and the SAME resolvePoint/resolveMidpoint machinery is independently
  validated accurate at t=5.40 above.

**Cross-check disposition: no disagreement exceeding 0.10 T was found on either strike.** The
STOP-AND-REPORT threshold for this gate was not reached.

### T4 — G5 plateau sweep, `value(W)` median per clip/pass

| clip/pass | W=0.25 | W=0.375 | W=0.5 | W=0.75 | W=1.0 | pass |
|---|---|---|---|---|---|---|
| demo1 / primary (n=2) | 0.590501 | 0.590501 | 0.590501 | 0.590501 | 0.590501 | flat |
| demo1 / scale (n=3) | **0.191514** | 0.532766 | 0.532766 | 0.532766 | 0.532766 | flat past 0.375 |
| demo2 / primary (n=4) | −0.047892 | −0.047892 | −0.047892 | −0.047892 | −0.047892 | flat (search disabled) |
| demo2 / scale (n=4) | 0.031248 | 0.031248 | 0.031248 | 0.031248 | 0.031248 | flat (search disabled) |
| multiperson / primary (n=4) | 0.613060 | 0.613060 | 0.613060 | 0.613060 | 0.613060 | flat |
| multiperson / scale (n=9) | −0.016990 | −0.016990 | −0.016990 | −0.016990 | −0.016990 | flat (search disabled) |

**G5(a)/(b): PASS everywhere.** Every clip/pass is bit-identical across `{0.375, 0.5, 0.75, 1.0}` —
zero drift, let alone climb. Demo 1's scale pass reads low at W=0.25 (permitted by the gate's own
text) and is flat for every W≥0.375 — the found extremum is a fixed frame, not a widening-window
artifact, which is direct evidence against the max-of-noise failure mode D2 names. No clip/pass
shows any climb consistent with that failure mode.

### T5 — before/after A/B field diff

`scripts/ab-person-selection.mjs --arm 'base={}' --clips demo1,demo2,multiperson --trials 3
--evidence`, run once before implementing FALLBACK (`before.txt`) and once after (`after.txt`),
same commit state otherwise, fresh process per trial both times, dev server identity-verified both
times, detection counts matched exactly (53/228, 99/99, 103/233 on every trial, both runs).

**`diff before.txt after.txt` — empty. Bit-identical**, including every `metrics.overstriding.*`
field the driver captures (`value`, `confidence`, `viewFit`, `frameCoverage`,
`interpolatedFraction`, `sampleSize`) and every `evidence.*` field (exemplar `timestamp`/
`pairedTimestamp`/`cropSidePx`/`cropGrowth`/`quality`/`demotedFromPair` — that field was renamed
`demotion` on `main` in `0eb95c8`, after this branch's base; measured here pre-rename). This is EXPECTED and
correct for FALLBACK: the driver's own `extractFields` deliberately skips `caveat` from the
comparison table (documented in the driver's own source as too long to tabulate), so a
caveat-only change is invisible to this diff by design — it is not evidence the caveat failed to
change, it is confirmation that NOTHING ELSE did. The caveat's actual content is verified
separately, by unit test (`overstriding.test.ts`: the clean-clip case asserts `caveat` is
non-null, contains no digit, and matches `/lower bound/i`; the front-view case asserts the
disclosure also rides along when other caveats fire; and a dedicated unknown-direction case pins
the direction-agnostic wording — see the D8 note on the two wordings).

### T6 — [evidence-coverage] per-cell drift

Not applicable to FALLBACK: since `value`/`sampleSize`/`interpolatedFraction`/`frameCoverage` are
byte-identical (T5), the evidence PLANNING layer (which reads exactly those fields to decide what
to draw) has no changed input to react to. Confirmed by T5's `evidence.*` rows being part of the
same empty diff — every `overstriding` exemplar's `timestamp`/`pairedTimestamp`/`cropSidePx`/
`cropGrowth`/`demotedFromPair` on all three clips is bit-identical before and after (same
field-rename note as T5: `demotedFromPair` → `demotion` on `main` in `0eb95c8`; measured
pre-rename).

## D6. Adjudication

| # | gate | result | evidence |
|---|---|---|---|
| — | GT cross-check (STOP condition) | no disagreement found | T3 |
| G0 | containment | **PASS** | Demo 1 confidence 0.25 / frameCoverage 0.5 / interpolatedFraction 0 / sampleSize 2 reproduced exactly in `before.txt`; probe is a pure `console.log` side effect, verified by code review and by T5's bit-identical before/after diff |
| G1 | accuracy, both eligible strikes | **PASS**, overwhelmingly | T2: 0.0282 < 0.2550 (strike 1); 0.0000 < 0.2463, exact (strike 2) |
| G1b | mechanism direction | **PASS**, both eligible strikes | T2: 0.5768 ≥ 0.2936 (in registered (0.29,1.01) band); 0.6042 ≥ 0.3579 |
| G1-MP | multiperson ground truth (registered since G1 passed) | **NOT FULLY ADJUDICATED** — mixed partial evidence, measurement stopped once G6 independently determined FALLBACK | T2-MP |
| G2 | within-clip consistency | **PASS**, all 6 clip/pass cells | Demo 1 primary spread 0.064275 matches the pre-registered 0.0643; every cell's new spread ≤ current spread (T1) |
| G3 | multiperson containment | **PASS** | (a) values 0.6131/−0.0170 both in [−0.15,1.20]; (b) `sampleSize`/`frameCoverage`/`interpolatedFraction`/`travelDirectionKnown` all unchanged ⇒ confidence/tier unchanged; (c) zero strikes were ever dropped (4→4, 9→9) — no adjudication needed |
| G4 | unknown-direction branch observed | **PASS**, both disjuncts observed | Demo 2 primary: `travelDirection=0`, bit-identical (disjunct 1). Demo 2 scale pass: `travelDirection=−1` resolves, value stays bit-identical anyway via rule 5 (a strictly stronger outcome than disjunct 2's band requirement) |
| G5 | plateau | **PASS**, every clip/pass | T4: zero drift for W∈{0.375,0.5,0.75,1.0} everywhere; W=0.25 low reading on demo1/scale explicitly permitted |
| G6 | materiality | **FAIL** — 9/26 = **34.6%**, below the 50% floor | T1: found/usable per cell — demo1 2/2 + 3/3, demo2 0/4 + 0/4, multiperson 4/4 + 0/9 |

**SHIP iff G0 ∧ G1 ∧ G1b ∧ G1-MP ∧ G2 ∧ G3 ∧ G4 ∧ G5 ∧ G6.** G6 is false, so this conjunction is
false regardless of G1-MP's disposition.

**Verdict: FALLBACK.**

The estimator's accuracy is not in question — G1/G1b/G2/G5 all passed with wide, in one case exact,
margins, and the mechanism (search a bounded backward window for the true forward-reach peak) is
demonstrably doing what it was designed to do wherever it can run. What fails is APPLICABILITY: on
this three-clip corpus, the search structurally cannot run on over half of the otherwise-usable
strike population, because `estimateTravelDirection` returns `0` on Demo 2's primary pass and
`resolveTrustworthyStepPeriodSeconds` returns `null` on both background-scale-pass runs where a
period fit fell below `cadenceMinFitR2` (Demo 2's scale pass resolves a direction, `−1`, and is
disabled by the period rule instead — T1; the latter is the SAME "scale pass falls back to the ankle-difference
detector more often than the module's shape suggests" phenomenon `footstrikes.ts`'s own module doc
already names). A correction that only ever fires on a minority of real footage is not a
correction worth shipping as the metric's primary estimator — hence FALLBACK: disclose the
limitation, change no numbers.

## D7. What was deliberately not done

- **No constant offset fitted to Demo 1's contacts.** Prohibited by `strides-24s` and restated by
  name in `strides-pr1`; this change's estimator has no fitted coefficient anywhere in it.
- **No revert to the ankle-difference detector.** `detectFootstrikes` and its phase-based primary
  path are untouched; this change only re-samples WHERE on the existing signal a surviving candidate
  reads, never WHEN a candidate is detected.
- **No duty-factor or stationarity correction.** Both were measured and rejected by `strides-24s`;
  neither is revisited here.
- **`detectFootstrikes` stays the locator for ALL consumers.** `footStrikePattern`, `stepWidth`,
  `stepWidthCm` and `verticalRatio`'s instants are untouched by this change.
- **`MIN_OVERSTRIDE_SAMPLE_SIZE` and `EVIDENCE_MAX_PAIR_CROP_GROWTH` are untouched.**
- **`strides-9uj` is out of scope.**

## D8. Known weaknesses

Recorded for the record even though the estimator itself did not ship — a future attempt at this
same problem should start from these rather than rediscovering them.

- **Max-of-noise risk was checked and did not fire on this corpus (G5), but that is a property of
  THIS corpus, not a proof it can never fire.** A clip with a noisier ankle trace (more detector
  jitter, more interpolation) could still show climb with window width. The mechanism named in D2
  remains real; it simply wasn't the reason this attempt failed.
- **Ground truth is n=2 strikes on Demo 1, one clip, one camera, no confirmed toe-off** — the same
  limitation `strides-pr1`'s own bead text flags about `strides-24s`'s spike. The multiperson
  ground-truth extension (G1-MP) was meant to widen this, and only partially did: 2 of 4 strikes
  examined, with MIXED (not confirmatory) results. Any future attempt inherits a thin evidence
  base, now on two clips instead of one, but not a resolved one.
- **`overstriding` and `footStrikePattern` already read different instants for nominally the "same"
  strike** — a pre-existing fact, not one this change introduced: `footStrikePattern` reads the
  KNEE at the DETECTED instant (unaffected by anything in this change, which never shipped), while
  a shipped version of the forward-reach estimator would have moved only `overstriding`'s own
  sampled instant. Since this change ships FALLBACK, this divergence did not materialize in shipped
  code — recorded here as a note for whoever next attempts the SHIP direction, since it would be a
  real, if narrow, consistency cost: two fore-aft metrics computed at two different instants of the
  same physical strike.
- **The applicability gap (G6) has a known second lever this change did not pull**: `stepPeriodSeconds`
  fails specifically on background-scale-pass runs whose hip fit falls below `cadenceMinFitR2` —
  the identical bar `detectFootstrikes`' own primary path clears. A wider or differently-tuned
  period-fit gate might recover some of that lost applicability, but that is a change to
  `footstrikes.ts`'s shared fitting logic with consequences for every consumer of
  `detectFootstrikes`, not a narrow fix scoped to `overstriding.ts` — explicitly out of this
  change's surgical scope (D7) and not attempted here.
- **`estimateTravelDirection`'s binary (known/unknown) signal is the other half of the gap.** Demo 2
  never resolves a direction at all on its primary pass; nothing short of a materially different
  direction-estimation approach would change that, and this change did not attempt one.
- **The shipped fallback caveat carries TWO wordings, not one** (review round 1). The lower-bound
  claim is a claim about the bias's SIGN, and the sign is derivable only when
  `estimateTravelDirection` resolves: on the unknown-direction branch the metric uses raw `dx`
  with no sign correction, so for a right-to-left runner the lag INFLATES the reported number
  rather than shrinking it. `SAMPLING_INSTANT_CAVEAT` (lower-bound wording) ships when direction
  is known; `SAMPLING_INSTANT_CAVEAT_UNKNOWN_DIRECTION` (same disclosure, no bias-direction
  claim) ships when it is not. Presence stays unconditional on every non-null-value path; both
  wordings are digit-free. No corpus clip currently renders the unknown-direction wording on a
  card (Demo 2 is the only `travelDirection = 0` clip and overstriding is tier-3 excluded
  there), so this is pinned by unit test rather than observed live.
