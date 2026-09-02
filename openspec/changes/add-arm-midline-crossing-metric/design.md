# Design — add-arm-midline-crossing-metric

D1–D8 were REGISTERED before the measurement probe ran. Sections marked **pending probe** /
**pending live run** are filled in only after the corresponding measurement, and the
pre-registered rules are not edited afterwards — a rule that fails STOPs the change, it does not
get retuned to fit the result.

## D1 — Signal and statistic: per-frame signed medial excursion, pooled p95

**The per-frame signal, per side.** For each frame and each side:

- Midline: the STRICT `resolveBilateralPair(frame, 'left_shoulder', 'right_shoulder')` — NEVER
  the tolerant `resolveMidpoint`, for stepWidth.ts:113-121's exact documented reason: a
  single-side fallback silently collapses the midline onto whichever shoulder resolved, and when
  that is the candidate wrist's OWN-side shoulder, `shoulderMid.x - wrist.x` degenerates to
  "wrist relative to its own shoulder" and the sign guard below cannot catch it because
  `sideShoulder` and `shoulderMid` become the same point. The crossing SIGN is the measured
  signal, so a frame where only one shoulder resolves is discarded, not approximated.
- Wrist: `resolvePoint(frame, WRIST_NAME[side])`, importing `WRIST_NAME`/`SHOULDER_NAME`/
  `ELBOW_NAME` from `armSwing.ts` rather than redeclaring them.
- `shoulderMid.x` = mean of the two shoulders' x.
- `outwardSign = Math.sign(sideShoulder.x - shoulderMid.x) || 1` — the same guard, with the same
  edge-case argument, as stepWidth.ts:176-189: post-strict-pair the product can only land on
  exactly 0 when both shoulders independently resolve to the same x, a narrow tie any real clip's
  view-fit discount already prices, not a load-bearing branch.
- `crossing = ((shoulderMid.x - wrist.x) * outwardSign) / shoulderWidthPx` — MEDIAL-POSITIVE: a
  wrist that has moved toward (and past) the midline from its own side reads positive, one that
  stays out on its own side reads negative, on BOTH screen orientations, because the sign is
  resolved per-frame from that frame's own-side shoulder — never from a clip-wide
  travel-direction constant, which solves a different, fore-aft problem and returns 0 on exactly
  the front-approach footage this metric is primary for.

Each side is an independent per-frame channel (the `kneeDrive.ts:196-218` two-channels-per-frame
convention): a frame where the strict pair resolves contributes up to two samples, one per
resolvable wrist.

**The statistic: the 95th percentile of the POOLED signed series** (both sides pooled,
`percentile(pooled, 0.95)` from `mathUtils.ts:29-38`). Alternatives considered and rejected:

- *Fraction of frames past the midline* — rejected: discards magnitude entirely (a grazing
  crossing and a sternum-deep sweep read identically) and is degenerate at 0 for every
  non-crossing runner, collapsing the metric's whole negative range into one value.
- *Median at anchored instants (footstrike- or swing-phase-anchored)* — rejected: an anchored
  sample on these clips is ~5 instants, and `strides-h6r` documents exactly what a median over
  five does when two are contaminated — the median IS the third value, and two outliers hand it a
  clean sample's maximum. The pooled per-frame series is n ≈ 196 on the reference front clip
  (2 sides × ~98 frames), two orders of magnitude more sample.
- *Per-side p95, then mean of the two sides* — rejected: an upper-tail statistic is OWNED by the
  more-medial arm. A runner who crosses with one arm only is a runner who crosses; averaging the
  crossing arm against the non-crossing one dilutes the signal toward "no crossing", which is the
  half-measurement shape `armSwingAmplitude`'s D6 rejected for a mean over unlike things.
- *Max* — rejected: the pooled maximum is one frame, and one frame is one tracking glitch.

p95 over a pooled n ≈ 196 series behaves as "the typical per-cycle deepest reach" without
requiring cycle segmentation: at ~3 arm-swing approaches per side per clip second, the top 5% of
frames is roughly the deepest few frames of each medial approach.

**Pre-registered small-n rule: `MIN_ARM_CROSSING_SAMPLE_SIZE = 61`.** Derived, in a
stepWidth.ts:18-84-style docstring split of derived-versus-judgment halves. The derived half:
the linear-interpolation `percentile` at p = 0.95 reads ranks `⌊0.95(n−1)⌋` and `⌈0.95(n−1)⌉` of
the sorted series. Take k same-direction contaminants (the shape contamination takes here — a
tracking dropout that flings a wrist medially inflates the tail, it does not scatter); they
occupy the top k ranks. Requiring BOTH read ranks to fall strictly interior to the clean
subsample (not merely clean, and not the clean subsample's own maximum either — the same
strict-interior requirement `MIN_STEP_WIDTH_SAMPLE_SIZE` registers) gives:

```
0.95 (n − 1) ≤ n − k − 2   →   n ≥ 20 k + 21
```

The judgment half: k = 2, on the same grounds as stepWidth's k (two documented contamination
mechanisms in this repo's corpus), giving n ≥ 61. The docstring states honestly that
contamination arrives in WINDOWS, not isolated frames, so k = 2 frames is optimistic — the
probe's tail-dwell check (D3 rule 3) is the empirical guard for exactly that. Below 61 the metric
is DISCOUNTED via `min(1, n / 61)` in `computeMetricConfidence` plus a caveat — never withheld.

**Unit: `'percent'`** — a fraction of shoulder width, exactly as `stepWidth`'s `'percent'` is a
fraction of hip width. NOT `'ratio'`: `formatValue` in MetricsPanel.tsx bakes "% of torso length"
into `'ratio'`'s formatting, which would misstate this quantity. The `MetricResult.unit` doc
(types.ts:282-293) widens from "Two metrics use it" to three, naming shoulder width.

## D2 — Denominator: clip-median shoulder width (`estimateShoulderWidth`)

A new `ShoulderWidth`/`estimateShoulderWidth` pair in `bodyScale.ts`, mirroring
`estimateHipWidth` (:56-71) verbatim: the strict `resolveBilateralPair` per frame, the median of
`|left.x − right.x|` across resolving frames, `{ shoulderWidthPx, sampleCoverage }`, null when
nothing resolves. Plus `bodyScale.test.ts` cases.

Why shoulder width and not the shared torso length:

- **Yaw robustness.** Under camera yaw (an off-axis front view) the medial excursion and the
  shoulder separation foreshorten by the same cos-factor, so their ratio is approximately
  invariant. Torso length does NOT foreshorten with yaw, so a torso-normalized crossing would
  silently understate crossing on every off-axis front clip — precisely the real-footage case.
- **Interpretability.** The midline is 0.5 shoulder widths from each shoulder by construction, so
  "+0.10 of shoulder width past the midline" reads directly against the body geometry it is
  measured in. A torso-relative number has no such landmark.
- **Degeneracy is self-consistent.** Shoulder width collapses toward zero in side view
  (`bodyScale.ts:16-22`'s own reasoning for rejecting it as the SHARED normalizer) — but that
  collapse coincides exactly with the strict midline's own degeneration and with this metric's
  side-unsuitable view gate. The denominator degrades in the same views the metric is already
  gated away from, rather than in views it is primary for.
- **One-consumer precedent.** `estimateHipWidth` exists as `stepWidth`'s single-consumer
  denominator on identical reasoning; this is its exact sibling, not a new pattern.

**Structural bonus, recorded because it simplifies the null paths:** the denominator resolves iff
the midline resolves — both are the strict shoulder pair — so "no denominator" and "no midline"
are ONE null path, not two which could disagree. The `shoulderWidthPx <= 0` guard is retained for
the never-NaN contract but is practically unreachable (a median of `|left.x − right.x|` over
strict pairs is 0 only if every resolving frame's two shoulders share an x), and the code says
so.

## D3 — The probe, and its pre-registered rules (registered BEFORE the probe ran)

A temporary `src/heuristics/armMidlineCrossing.experimental.ts` (add–measure–revert per
CLAUDE.md's cycle), reporting per clip:

- the per-side AND pooled signed series (computed exactly as D1, per-frame own-side sign);
- a percentile ladder {p50, p75, p90, p95, p99, max} per side and pooled;
- per-side resolvable sample counts and interpolated fractions;
- the strict-shoulder-pair frame count;
- the fraction of samples past the midline (value > 0), per side;
- the clip-median `shoulderWidthPx` AND `torsoLengthPx` (so D2's denominator choice is measured,
  not asserted);
- the timestamps and interpolated flags of the top ⌈0.05 n⌉ pooled frames (the tail the p95
  reads).

One dev-only `console.log('[arm-crossing-probe]', ...)` in `useVideoAnalysis.ts` after the
existing `[analysis-diagnostics]` line; a throwaway scratchpad Playwright driver, fresh Chromium
process per trial, real GPU. TWO fresh trials on Demo 2 (expected bit-identical under the
fresh-process regime), one trial each on Demo 1 and multiperson as corroboration.

**Pre-registered rules:**

1. **Plausibility:** the pooled p95 on every clip lies in [−1.0, +1.0] shoulder widths. A wrist a
   full shoulder width past the midline (or a "deepest reach" a full width lateral of it) is not
   anatomy — outside the band → STOP, do not implement.
2. **Sample gate:** pooled resolvable samples ≥ 61 on Demo 2 (the primary-view clip). Below it →
   STOP: the one clip the metric is designed for cannot clear its own confidence floor.
3. **Noise-tail check:** adopt p95 unless (a) more than 50% of the top ⌈0.05 n⌉ pooled frames are
   interpolated, OR (b) those frames form ONE contiguous run rather than spanning ≥ 2 medial
   approaches separated by > 0.25 s (a single dwell is one event, not a typical reach). Either
   failure → fall back to p90 and re-test the same two conditions on the top ⌈0.10 n⌉; p90 also
   fails → STOP. The adopted rung is pinned here and in the spec requirement title before
   implementation.
4. **The live anchor:** the measured Demo 2 pooled statistic at the pinned rung, ± 0.005, becomes
   the pre-registered STOP anchor for the live verification (D8 rule 2). A live miss → STOP and
   localize the discrepancy; never tune the implementation toward the expectation.
5. **Direction independence, by construction:** the probe imports no `estimateTravelDirection`.
   Demo 2's travel direction is 0 (`estimateTravelDirection` returns indeterminate on it, per
   CLAUDE.md), and this metric MUST emit there — any implementation path that needs a travel
   direction is a design error, not a tuning problem.

## D4 — Probe measurements and verdicts (recorded 2026-09-02) — **STOP: rule 3 fired**

Fresh Chromium process per trial, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), dev server
started on the derived port and identity-verified by the driver, `[arm-crossing-probe]` captured
after `[analysis-diagnostics]`, computed over `trimToPresenceWindow(robustFrames)` — the exact
frames the metric would see. Demo 2 ran twice: **bit-identical** (`cmp` on the two JSON reports,
full series included), on both probe invocations. Demo 1 and multiperson once each. One probe
deviation, corrected before adjudication: the first probe build omitted the full signed series
D3's registered report list requires; it was added to match the registration and the probe was
re-run — Demo 2's summary numbers were identical across the two builds to every digit.

| | Demo 2 (front, primary) | Demo 1 (side) | multiperson (side) |
|---|---|---|---|
| frames / strict-pair frames | 99 / 99 | 59 / 59 | 107 / 107 |
| pooled n | 197 | 108 | 203 |
| pooled p50 | −0.58482 | −0.92152 | −0.49725 |
| pooled p90 | −0.37776 | **+1.11950** | +0.50603 |
| pooled p95 | **−0.34213** | **+1.30819** | +0.83823 |
| pooled p99 | −0.28084 | +1.45570 | +1.65486 |
| pooled max | −0.27628 | +1.66499 | +2.15044 |
| pooled interp fraction | 0.0254 | 0.4907 | 0.2365 |
| left n / interp | 98 / 0.0306 | 53 / 0.5849 | 100 / 0.1400 |
| right n / interp | 99 / 0.0202 | 55 / 0.4000 | 103 / 0.3301 |
| fraction past midline L / R | **0.000 / 0.000** | 0.340 / 0.182 | 0.260 / 0.369 |
| shoulderWidthPx | 164.99 | 97.09 | 23.27 |
| torsoLengthPx | 232.65 | 418.13 | 96.47 |

**Demo 2 tail composition — the decisive measurement.** Top ⌈0.05 n⌉ = 10 pooled frames:
0 of 10 interpolated; instants `0.100 s (right)` and `0.300–0.434 s (left, 9 contiguous
frames)`. Top ⌈0.10 n⌉ = 20 frames (the p90 re-test): 0 of 20 interpolated; instants
`0.083–0.434 s`, **19 of 20 the left arm**, with no internal gap exceeding 0.067 s — one
time-cluster under the registered > 0.25 s separation criterion. **The entire upper tail of the
pooled distribution, at both rungs, lives in the clip's opening ~0.35 s** — a single left-arm
window (plus one stray right-arm frame at the same clip-opening moment), not a per-cycle typical
reach. The clip's fitted stride rhythm (~1.5 Hz) holds ~2.5 medial approaches per arm across its
1.65 s, so a tail representing "typical deepest reach" would span several of them; it spans one.

**Adjudication, rule by rule:**

1. **Plausibility — FIRED on Demo 1 as registered.** The rule was registered as "the pooled p95
   on every clip lies in [−1.0, +1.0]". Demo 2: −0.342, comfortably in-band. Demo 1: **+1.308**
   (p90 +1.120 — out of band at either rung); multiperson: +0.838 (in-band, but its p99/max run
   to +2.15). The out-of-band side-view readings are the documented mediolateral axis-collapse
   this metric is `unsuitable`-gated for — a fore-aft wrist swing read over a collapsed shoulder
   width (97 px against a 418 px torso on Demo 1; 23 px on multiperson), with half of Demo 1's
   samples interpolated. The plan's own text for this rule carried no per-clip scope, and rules
   2 and 4 are explicitly Demo-2-scoped; the "every clip" scope was this design's registration
   choice. Recorded as FIRED under the rule as registered; whether the scope should have been
   Demo 2 only is for the reviewer, not for a post-hoc edit here. It is moot for the outcome,
   because:
2. **Sample gate — PASS.** Demo 2 pooled n = 197 ≥ 61.
3. **Noise-tail — FIRED, at both rungs. This is the STOP.** At p95: the tail is not two medial
   approaches separated by > 0.25 s — its two side-labeled clusters sit 0.200 s apart (merged
   under the registered criterion), and substantively it is ONE left-arm approach plus a single
   right-arm frame. Fall back to p90 per the rule; at p90 the top-20 tail is unambiguously a
   SINGLE time-cluster (0.083–0.434 s, 19/20 one arm) — fails the same condition with no reading
   in its favor. "p90 also fails → STOP." The interpolation half of the rule passes at both rungs
   (0%); it is the dwell half that fails, which is exactly the failure mode D1's docstring
   pre-registered this check as the empirical guard for ("contamination arrives in windows, so
   k = 2 frames is optimistic").
4. **Live anchor — NOT PINNED.** No rung survived rule 3, so no D8 anchor exists.
5. **Direction independence — held by construction.** The probe imports no
   `estimateTravelDirection`; Demo 2 (indeterminate travel direction) produced every field.

**What the measurement says, beyond the verdicts.** Two findings a successor design must answer:

- **The reference front clip contains no crossing at all**: fraction past midline is 0.000 on
  both sides; the pooled maximum is −0.276 (the closest any wrist comes to the midline is ~0.28
  shoulder widths short of it). Every Demo 2 value the card would ever have shown is negative,
  the exemplar label would always be the "closest approach" branch, and the interpretive crossing
  caveat would never fire on the reference corpus — so the corpus cannot distinguish a working
  crossing detector from a broken one on the positive side.
- **The upper tail is an episode, not a rhythm**: the deepest medial reaches all sit in the
  clip's opening, where the runner is most distant (smallest on screen — the same clip-opening
  window `strides-boc` documents as MediaPipe's degraded zone, though these frames are
  MoveNet-detected, 0% interpolated). Whether that is genuine arm carriage at distance or
  scale-dependent measurement noise, a pooled upper-tail percentile reads it as the headline
  number. Any successor statistic needs either per-approach aggregation (a per-cycle extremum
  median, the shape `kneeDrive` uses) or an explicit guard against single-window tails.

**Denominator cross-check (D2), for the record:** Demo 2 shoulderWidthPx = 165.0 px vs
torsoLengthPx = 232.7 px. No verdict is drawn — the metric did not survive to need one — but the
measured side-view collapse (97 px and 23 px against torsos of 418 px and 96 px) confirms D2's
degeneracy-self-consistency claim as stated.

**Consequence: the change STOPS here.** Per D3's registered consequences, the implementation
(tasks 3–5) is not built. The probe instrumentation is reverted per the add–measure–revert
cycle; this record and the skeleton remain as the pre-registered, adjudicated record.

## D5 — Exemplar: one single-instant `'armCrossingInstant'`; a ghosted pair REJECTED

**ONE single-instant exemplar**: the resolvable frame whose signed value sits nearest the
reported statistic (tie → the earlier frame), on that sample's OWN side, scored
`scoreExemplarInstant(..., 'representative', describeDistribution(pooledValues))`. The
representative role is correct because the depicted instant IS what the card reports — the
typical deepest reach — not an extreme of a range.

**New `MetricExemplarKind` `'armCrossingInstant'`** with a doc comment, and a new builder in
`evidenceAnnotations.ts` beside `buildStepWidthMarks`/`buildArmSwingMarks`:

- `strictMidpoint(index, 'left_shoulder', 'right_shoulder')` → a **vertical guide** at the
  shoulder-mid x — the strict primitive, for `buildStepWidthMarks`'s exact reason: the metric
  gates on the strict pair, and a guide through a tolerant midpoint would put the line somewhere
  the metric never measured from.
- The **shoulder-width segment** left→right, with the `hipWidthSegment` precedent's comment
  (`evidenceAnnotations.ts:798-802`): the metric divides by the clip-MEDIAN `shoulderWidthPx`,
  not this frame's segment, so the segment is drawn as per-instant geometry and no quotient is
  implied on it.
- The **arm chain** shoulder→elbow→wrist, chained through the elbow or not at all
  (`buildArmSwingMarks:837-847`'s rule — a shoulder-to-wrist line with the elbow missing draws an
  arm segment that does not exist).
- A **horizontal caliper** from `derived(wrist, shoulderMid.x, wrist.y)` to the wrist — the raw
  pixel numerator. Its polarity is computed BUILDER-LOCALLY as
  `-(Math.sign(sideShoulder.x − shoulderMid.x)) || null`: medial (toward the midline from the
  own-side shoulder) is the calculation's positive, and `null` on the degenerate tie — NEVER the
  clip-wide `travelDirection` and never a plan-level hip-based `outwardSign`, neither of which is
  this metric's sign.

Registered in `INSTANT_MARK_BUILDERS` (a total record — the compiler enforces the entry).
**ADDED to `SINGLE_INSTANT_KINDS`** (`evidenceFrames.ts:347-354`): the card's number lives at a
single instant by construction, which is that set's own membership criterion, and the builder
emits its marks ungated by role so the set's membership loop test holds. `measuredAtInstant`
needs no new branch: with no ghost the default `true` is correct for the only instant there is.
`cropKeypoints`: seed `['left_shoulder', 'right_shoulder', WRIST_NAME[side]]`, context
`[ELBOW_NAME[side]]`; `annotationKeypoints` omitted (single-instant — the crop set IS the
per-instant set by contract).

**A ghosted pair is REJECTED**, with the reasons recorded so nobody re-adds one:

- The vertical guide IS the reference — the picture already contains the line the wrist is
  measured against, so a second instant adds no legibility the way a trough does for a peak.
- There is no principled neutral instant to ghost against: "the wrist at its most lateral" is not
  part of the measurement, and any choice would be arbitrary.
- The honesty rule: a p95 cannot be drawn — it exists in no single frame pair — but a SPECIFIC
  near-p95 reach can. One instant labeled as itself is honest; a pair invites reading the gap
  between the two instants as the reported value, which it is not.

The label is sign-branched, because "crossing" is a claim about the sign: value > 0 → e.g.
"Wrist crossing the body's midline (right arm)"; value ≤ 0 → "Wrist at its closest approach to
the midline (right arm)".

## D6 — View gating and direction independence

`viewFitTable.armMidlineCrossing` COPIES `stepWidth`'s row exactly (types.ts:857-861), with a
comment saying so: front primary/1.0, side unsuitable/0.1, ambiguous unsuitable/0.2. Identical
reasoning — a mediolateral quantity read from a side-on camera collapses along the viewing axis.
Computed-not-withheld on unsuitable views per "never a silent wrong number"; the caveat names the
camera angle via `viewPhrase(view)`.

**No travel-direction input, structurally** (D3 rule 5): the per-frame own-side `outwardSign`
resolves the medial direction from the frame's own geometry. `travelDirectionKnown` is left
defaulted in `computeMetricConfidence`. This is what lets the metric emit on Demo 2, where
`estimateTravelDirection` returns 0 — the clip class the metric is front-view-primary FOR.

## D7 — Null paths, caveats, and confidence

**Null paths, in check order, each with a TRUE-cause caveat:**

1. No frame with a strict shoulder pair → "No resolvable shoulder pair (left/right shoulder) to
   define the body's midline in this clip." (One path covers midline AND denominator — D2's
   structural bonus.)
2. A side with zero usable samples → null naming the wrists: a one-arm upper-tail presented as
   "the arms' crossing" is the same half-measurement shape `armSwingAmplitude`'s D6 rejected —
   the p95 of a pool with one arm missing is silently that one arm's p95.
3. `shoulderWidthPx <= 0` → the never-NaN guard (practically unreachable, D2).

**Non-null caveats, in order:**

1. Unsuitable view via `viewPhrase` ("Arm crossing is a mediolateral measurement and is not
   reliable from …" — stepWidth's sentence shape).
2. Sample shortfall n < 61 (stepWidth:240-247's discount wording shape).
3. Side imbalance: when the worse-tracked side contributes < 25% of the pooled samples, "One
   wrist was tracked far less often than the other, so this figure mostly reflects the
   better-tracked arm." — the per-side-quality concern the bead names, surfaced as prose because
   a pooled statistic hides it numerically.
4. Interpretive caveat when value > 0, mirroring stepWidth:248-252's shape: an observation about
   where the wrists travel in this one clip, "not a diagnosis", no injury or effectiveness
   language.

**Confidence inputs:** `viewFitMultiplier` from the resolved table; `frameCoverage` =
usedSamples / (frames.length × 2) (two channels per frame, kneeDrive's convention);
`interpolatedFraction` = max of the two sides' fractions (worse-side accounting, the arm-family
convention); `sampleSize` = pooled n with `minRequiredSampleSize` = 61; no `fitQuality` (nothing
is fitted); `travelDirectionKnown` defaulted (D6). Module constants
`ARM_CROSSING_PERCENTILE = 0.95` and `MIN_ARM_CROSSING_SAMPLE_SIZE = 61`; no new config keys.

## D8 — Pre-registered live verification rules (registered before the live run)

`scripts/ab-person-selection.mjs --arm 'base={}' --clips demo1,demo2,multiperson --trials 3
--evidence`, fresh process, real GPU, identity-verified server, diffed against the Step-0
baseline at `dc48f56`; plus the scale-pass anchor driver.

1. **Zero cross-trial spread** on every `armMidlineCrossing` field (fresh-process regime).
2. **Demo 2:** `value` = the D4 anchor +0.10648 ± 0.005 (primary criterion), `viewFit` primary.
   Soft expectations (report, not STOP): confidence ≥ 0.7 (tier 1), exactly one
   `evidence.armMidlineCrossing` exemplar row of kind `armCrossingInstant`, no `pairedTimestamp`,
   and the exemplar renders.
3. **Demo 1:** `value` non-null (computed-not-withheld), `viewFit` unsuitable → tier 3, evidence
   `metric-excluded`.
4. **multiperson:** computed, unsuitable → tier 3, no exemplar rows. If it surfaces as a card,
   STOP and inspect the view rows — do not tune.
5. **Diff discipline:** the baseline diff contains ONLY the header commit line, `elapsedMs` rows,
   and ADDED `armMidlineCrossing` rows. `armSwingSymmetry` and `armSwingAmplitude` explicitly
   bit-identical — they share `armSwing.ts` imports with nothing this change touches, and any
   movement there is a regression, not noise.
6. **Anchor unchanged:** `verticalOscillationCm 4.421467928439415`,
   `fit.frequencyHz × 60 = 91.2 == cadence.value 91.2`.

### D8 — Adjudication: **MOOT — the change stopped at D4**

D3 rule 3 fired at both rungs (see D4), so the implementation was never built and no live run
exists to adjudicate. The rules above are left as registered, unedited, as part of the record.
