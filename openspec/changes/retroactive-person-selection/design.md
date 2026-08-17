# Design — retroactive person-of-interest selection (Stage 1)

## Context

Issue #51. Prerequisite already merged: `43adebb` made WebCodecs sequential decode the default
sampler, so extra work in the analysis pipeline converts to longer wall clock rather than lost
frames. The in-flight `anchor-continuity-gate` change contributed the geometry helpers
(`isBoundingBoxAreaRatioWithin`, `isWithinCenterSpeedBound`, `computeBoundingBoxIoU`,
`deriveBoundingBox`) this stage reuses as its segmentation criterion.

## Goals / Non-Goals

**Goals.** Choose the analysed subject from whole-clip evidence. Attribute no other person's
keypoints to the runner. Be a no-op on single-subject footage. Add no inference and no decode.

**Non-Goals.** Picking one person out of a genuine crowd; two runners side by side at similar
cadence (explicitly unsolvable, see issue #51); ReID embeddings; camera-motion compensation;
replacing the online continuity gate (different job — it keeps the tracker, crop framing and
overlay sane *during* the run).

## Decisions

### D1 — Retroactive, not causal

Online selection is irreversible by construction, which is the root cause, not a symptom. The
measured trace shows acquisition committing to a bystander on frame 1 because the runner is not in
frame yet. Offline the whole sequence is available, so the decision is simply made later.

### D2 — Score by integrated bounding-box area

`Σ bboxArea` over a segment's frames. One number, no weights to tune; it folds "how big" and "for
how long" together, which is exactly the near-vs-far discrimination this problem actually needs.
Published ablations rate size weakly as a *general* main-subject cue, but the target here is
background people at a distance, where it is strongest. Measured separation on the repro clip:
39–46x. Gait-periodicity scoring is the pre-scoped secondary cue, deferred until area proves
insufficient — it has not.

### D3 — Losing frames become `null`, never a substituted pose

`applyRobustness` interpolates across gaps with **no identity check whatsoever**. Substituting
would produce a lerp from person A to person B labelled `'interpolated'` — a fabricated position
wearing a trusted status. A gap is honestly missing data. Enforced as a reference-identity
invariant, not just a value check: every surviving output entry `===` its input entry, and every
rejected one is exactly `{ timestamp, frame: null }`.

### D4 — The floor is a fraction of frame area, not absolute px²

Keypoints are in source-video pixels on both sampling paths, so an absolute floor is 4x more
permissive at 4K than at 1080p — the same physical subject at the same distance produces four times
the pixel area. `2e-4` = 415 px² at 1080p, 1659 px² at 4K, derived as roughly the geometric mean of
the largest measured garbage detection on the repro clip (183 px²) and the smallest measured real
person on it (~1000 px²): ~2.3x above the noise, ~40x below the smallest real subject, nowhere near
either boundary. A resolution-independence unit test asserts identical decisions on identical
geometry at 1080p and 4K with every coordinate doubled.

### D5 — Sub-floor detections are dropped unconditionally and never start or cut a segment

Integrated area alone already discards the degenerate 5–183 px² stretch (its own segment, negligible
score). The floor exists for a second reason: a floor rejection is *not evidence about anybody's
continuity*, so letting one participate in segmentation would let noise cut a real track in half.
They are therefore nulled in every segment, including the winning one, and skipped entirely when
looking for the previous surviving detection.

### D6 — Segments form a total contiguous index partition

Segment k owns `[segmentStarts[k], segmentStarts[k+1] - 1]`, with segment 0 extended back to index 0
and the last extended forward to the end. Every sample belongs to exactly one segment, including
leading/trailing/interior ones carrying no usable detection — those ride with whichever segment
contains them and contribute nothing to its score. Without the total partition, "null every frame
outside the winner" would be ambiguous for exactly the frames most likely to be junk.

### D7 — `maxAreaRatio: 4` here, versus the online gate's 3

Asymmetric false-reject cost. Online, a false reject skips **one** anchor update and the next frame
gets another try. Here, a false cut can strand the rest of the clip in a losing segment. Loosening
the scale bound from 3 to 4 buys margin against a spurious split at no measured cost — the repro
clip's bystanders are ~1/9 the runner's area, far outside either bound.

**But the margin was sized for the wrong threat, and it is not what failed on Demo 1.** The
original justification here (and in `DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG`'s comment) said
the bound "only has to separate people at genuinely different distances." That is the easy half.
The bound also has to *tolerate intra-person keypoint-dropout noise*, and the measured Demo 1 wedge
is a **6.9x intra-person area swing with a simultaneous ~400px centroid jump** — one person, two
consecutive frames. Nothing about that is a between-people discrimination problem.

**The Demo 1 split is a POSITION failure, not a scale one, and no value of `maxAreaRatio` can heal
it.** Traced frame by frame:

- **4.24 → 4.32 (the cut that strands the 5-frame prefix): position.** The two boxes are disjoint
  in x — the wedge is centred at x=896, the 167,867 px² box at x=574 and roughly 400px wide — so
  `computeBoundingBoxIoU` is **0** and the overlap term cannot rescue it. The speed term then has
  to carry it alone: ~403px of centre displacement in 0.08s against a ~410px reference side is
  **~12 sides/s, against a 3 sides/s bound**. Both halves of the position test fail, so
  `isBoundingBoxContinuous` short-circuits on `positionContinuous && …` before the area test is
  consulted at all. The area ratio on this pair also fails (6.9 vs 4), but that is *redundant*:
  position alone is decisive here, and position is the half no `maxAreaRatio` value can address.
  Reading the 6.9 as "the scale bound was too tight" is the mis-diagnosis this decision record
  originally made.
- **4.32 → 4.36: scale.** Ratio 108,121 / 24,473 = **4.4 against the bound of 4** — the only one of
  the two cuts `maxAreaRatio` actually governs.

This is exactly why the override-plane experiments at `maxAreaRatio` **12 and 30** merged the wedge
frame into the winner but left the 5-frame prefix stranded: they healed the second cut and could
never have touched the first. The earlier reading of that result ("the margin is still not enough")
was wrong about the mechanism — more margin is not the missing ingredient on this clip at any
value.

**The structural cause.** `deriveBoundingBox` is a hull over *confidence-gated* keypoints, so a
frame that drops limbs does not merely shrink the box — it **translates the centroid** as well,
because the hull re-forms around whichever joints survived the gate. One dropout event therefore
perturbs the scale term and the position term at the same time and in correlated directions, which
is precisely the input the two-term predicate has no defence against.

And the predicate was never designed for this job. It is a **per-frame anchor validator**: online,
a false reject costs one anchor update and the next frame retries, so a noise-driven `false` is
self-healing within ~16ms. Reused here as a **partition criterion**, the identical false reject
costs an entire prefix — the cut is permanent, and everything before it is scored as a separate,
losing segment. Same predicate, same inputs, same answer; the *consequence* is what changed, and
the consequence is what this change under-weighted.

**The right fix is the splice-tolerant bridge rule**, not a bound. Confirmed against the traced
frames: **t=4.24 and t=4.36 are continuous with each other on both terms** — area ratio ~1.55
(inside 4) and overlapping boxes (IoU > 0, so position passes without needing the speed term at
all). A rule that bridges across a single non-continuous frame when the frames on either side of it
are continuous with *each other* heals this case exactly, with no threshold change anywhere. See
Follow-up 1.

### D8 — A separate time-gap cut (`maxContinuityGapSeconds: 1.0`)

The speed bound is a speed, so across a long enough gap it degenerates to "anything is reachable".
A full second without a single usable detection is a different scene, not a stride.

### D9 — Config folded into `SamplingRobustnessConfig`, no new `window` global

This stage runs inside the analysis pipeline, which already resolves exactly one
`SamplingRobustnessConfig` per run, with a dev-only override point. A second global would be a
second lifetime to reason about for no gain. Same nested-partial override type extension and same
one-level-deep merge `sequentialSampling` already has.

### D10 — `personSelection` diagnostics are always present, unlike `scaleCalibration`

`scaleCalibration` is conditionally spread because a MoveNet run has to serialize to exactly the
JSON it did before that key existed. `personSelection` is the opposite case: "this stage did
nothing, and here is why" is the answer to the question a reader has when they see a surprising
`sampling.detectedFrames`. Absence would be the one shape that makes the diagnostics harder to
read. `sampling.detectedFrames` becomes post-selection by design (it is what the rest of the
pipeline sees); `personSelection.detectedSamplesIn` preserves the pre-selection number, so the two
together distinguish "the detector found nothing" from "the detector found somebody else".

### D11 — The continuity predicate is extracted, and the extraction is behaviour-neutral

`isBoundingBoxContinuous(candidate, reference, elapsedSeconds, bounds)` moves into
`movenetCrop.ts` as `(IoU > 0 || withinSpeedBound) && withinAreaRatio` — that composition and
nothing else. `movenet.ts`'s `isContinuousWithAnchor` keeps its own `gate.enabled` / `anchor ===
null` / `personOfInterestSuspended` early returns and delegates the geometry. Those three decide
*whether* continuity is consulted, which the offline stage answers differently and must not
inherit. Every pre-existing test in `movenet.test.ts` stayed green with no edits to any assertion,
which is the acceptance criterion for "behaviour-neutral"; `pose-detection` therefore gets no spec
delta.

## Live-browser A/B results (2026-08-16, real GPU)

Headless Chromium, `--headless=new --enable-gpu --ignore-gpu-blocklist`, renderer confirmed
`ANGLE Metal Renderer: Apple M4 Pro` (not SwiftShader) on every trial. Overrides via
`page.addInitScript`. Read from the `[analysis-diagnostics]` console line, matched with the
exclusive prefix test. No probe was needed for the A/B itself; a temporary `[bbox-trace]` probe was
added only for the root-cause analysis below and reverted (`git diff` clean on that file).

### Arm A — `e2e/fixtures/multiperson-track.mp4` (1920x1080), stage ON, 3 trials

| | trial 1 | trial 2 | trial 3 |
|---|---|---|---|
| `status` | selected | selected | selected |
| `segmentCount` | 8 | 8 | 8 |
| winner span / frames | 2.13–3.62, n=88 | 1.75–3.82, n=119 | 1.75–3.82, n=119 |
| winner `integratedAreaPx` | 2.759M | 3.546M | 3.546M |
| winner `medianAreaPx` | 31,905 | 31,937 | 31,937 |
| `separationRatio` | 39.08 | 45.75 | 45.75 |
| `rejectedBelowFloor` | 22 | 30 | 30 |
| `rejectedOtherSegment` | 87 | 52 | 52 |
| `detectedSamplesIn` → `sampling.detectedFrames` | 199 → 90 | 204 → 122 | 204 → 122 |

The winner's median bbox area (31,905–31,937 px²) matches issue #51's measured runner span
(~32,000 px²) to within 0.3%, and the runner-vs-bystander separation is 39–46x against the issue's
predicted ~12x. Every acceptance criterion for arm A passes: selected, `segmentCount >= 3`, winner
is the runner at order-1e6 integrated area, `separationRatio >= 3`, `rejectedBelowFloor > 0`,
`detectedFrames` materially below `detectedSamplesIn`.

The metric effect is visible and in the expected direction: with the stage off, `trunkLean` reads
**−2.88°** and `footStrikePattern` **+0.05**; with it on, **+4.28°** and **−0.20**. The bystander
frames were flipping the sign of the answer.

### Arm B — same clip, `{ personSelection: { enabled: false } }`, 3 trials

`status: 'skipped'`, `skipReason: 'disabled'`, `detectedFrames === detectedSamplesIn === 204`,
bit-identical across all three trials. Confirmed again after the default was flipped: the shipped
default reproduces this arm exactly.

### Arm C — no-op regression on the single-subject demo clips, 3 trials each

| | Demo 2 (front view, `park-approach.mp4`, 3840x2160) | Demo 1 (side view, Pexels track, 3840x2160) |
|---|---|---|
| `segmentCount` | **1**, all 3 trials | **5–6** |
| `rejectedBelowFloor` | 0 | 0 |
| `rejectedOtherSegment` | **0** | **13–16** |
| `detectedFrames` on vs off | 99 vs 99 | 50–52 vs 65 |
| metric values on vs off | bit-identical, all 3 trials | shifted (see below) |

**Demo 2 passes cleanly.** One segment, zero rejections, output bit-identical to the disabled arm.

**Demo 1 fails.** Every metric's *confidence* actually improved with the stage on (vertical
oscillation 0.96 vs 0.73, cadence 0.72 vs 0.64, knee flexion 0.92–0.98 vs 0.89, trunk lean 1.00 vs
0.94), but the stage discarded frames it should not have.

### What went wrong on the track demo — root-caused, not guessed

A temporary per-frame `[bbox-trace]` probe (added, measured, reverted) gave the raw derived-box
series. The runner is genuinely in frame from t=3.88 to t=6.20 — 55 continuous detections, box
areas 167K–755K px², centre x sweeping 144 → 3664. Keyframes at t=4.28 and t=4.36 confirm one
uninterrupted shot with the subject in nearly the same place; there is no cut in the video.

The three frames at the split:

| t | bbox area | centre |
|---|---|---|
| 4.24 | 167,867 | (574, 849) |
| **4.32** | **24,473** | **(896, 606)** |
| 4.36 | 108,121 | (824, 738) |

One badly-collapsed detection at t=4.32 — a fragment of the runner, displaced ~400px from where the
runner actually is — fails the continuity bounds against BOTH neighbours. It acts as a wedge,
splitting one person's continuous track into 5 + 1 + 49 frames, and the 5-frame piece loses.

The two cuts fail for **different reasons**, which is the whole point (full derivation in D7):
the 4.24 → 4.32 cut is a **position** failure — IoU 0 (disjoint in x) and ~12 sides/s against a
3 sides/s bound — that no `maxAreaRatio` value can heal; only the 4.32 → 4.36 cut is scale-driven
(ratio 4.4 vs the bound of 4). Raising `maxAreaRatio` to 12 and 30 via the override plane merged
the wedge frame into the winner but did **not** recover the 5-frame piece — exactly what that
split diagnosis predicts, and the measurement that rules out "the scale bound was too tight" as
the explanation.

The rest of Demo 1's rejections are correct and desirable: t=6.36, 7.20, 7.28, 7.44 and 8.36 carry
detections of 2,279–8,432 px² on frames that keyframe extraction shows are **visibly empty** —
phantom poses the 4K floor (1,659 px²) is too low to catch. Segment scoring discards them anyway.

So Demo 1 mixes a real win (5 phantom frames rejected) with a real defect (5 genuine runner frames
lost to a single-bad-frame wedge). The defect is what decides the ship rule.

## Pre-registered ship rule and its outcome

> Ships `enabled: true` ONLY IF arm C passes on BOTH demo clips (segmentCount 1, zero rejections, 3
> trials each) AND arm A's winner is the runner with `separationRatio >= 3`. If any single-subject
> clip loses a frame to this stage, ship `enabled: false` and say so plainly.

- Arm A condition: **PASS** (winner is the runner, `separationRatio` 39–46).
- Arm C on Demo 2: **PASS** (segmentCount 1, zero rejections, bit-identical, 3 trials).
- Arm C on Demo 1: **FAIL** (segmentCount 5–6, 13–16 rejections, five genuine runner frames lost).

**Rule outcome: FIRED — the rule's own verdict was `enabled: false`.** The confidence improvements
on Demo 1 are real, and they are exactly the kind of favourable-looking shift the rule was written
to refuse as an excuse for a demonstrated false cut.

**Shipped outcome: `enabled: true`, by explicit user decision on 2026-08-16, overriding the rule.**
Recorded as an override rather than by rewriting the rule to fit, because a ship rule that gets
reworded whenever it fires is not a ship rule. What is knowingly accepted as the default:

- Demo 1 (side view — this app's most common footage) loses 13–16 detected frames per run to a
  false cut, and five of those are genuine runner frames.
- The two open correctness items in the Risks table below — boxless survival inside the winner's
  span, and primary/scale-pass selection divergence — were documented as prerequisites for
  enabling. They are now **live rather than pending**.

Against that, on the repro clip the stage picks the runner by a 39–46x margin and corrects the
SIGN of `trunkLean` (−2.88° → +4.28°) and `footStrikePattern` (+0.05 → −0.20).

Revert per-run via
`window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = { personSelection: { enabled: false } }`,
or permanently by flipping `DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG.enabled`. The real fix is
follow-up 1 (splice-tolerant segmentation), confirmed against the trace to heal the Demo 1 case.

## Risks / Trade-offs

| Risk | Status |
|---|---|
| A single collapsed detection wedges one person's track apart | **Confirmed on real footage** (Demo 1, t=4.32). Fired the ship rule; shipping ON anyway is an explicit user override, so this cost is live. Follow-up 1 is the fix. |
| Segmentation splits one person on a genuine fast move | Not observed; the observed splits were all wedge-shaped, not motion-shaped. |
| Integrated area picks a near bystander who lingers longer than a distant subject | Not observed (39–46x margin the right way). Periodicity is the scoped fallback. |
| The area floor is too low at 4K | **Confirmed**: 1,659 px² does not catch 2,279–8,432 px² phantom detections on empty frames. Segment scoring caught them anyway, so no correctness impact — but the floor is not doing the job it was sized for at that resolution. |
| Stage 1 rejects wrong-person frames but cannot recover the runner during them | Correct behaviour — a gap beats a wrong number. Stage 2 recovers them if it proves to matter. |
| **A boxless detection inside the winner's span survives as another person's keypoints** | **Open, unmitigated, and now LIVE** — this was documented as a prerequisite for `enabled: true`, which has since been enabled by user override. See below. |
| **The primary run and the background scale pass each select a subject independently, with no divergence check before the graft** | **Open, and now LIVE** — previously unreachable because both passes skipped identically; enabling the stage by user override made it reachable. See below. Follow-up 5. |

### Boxless survival inside the winner's span (open)

`retroactivePersonSelection.ts`'s final map reads `if (inWinner && !belowFloor[i]) return sample`.
A frame that carries a detection but fewer than `minConfidentKeypoints` confident points yields no
box, so it is **never floor-checked and never segment-checked** — `belowFloor[i]` stays `false` and
`surviving[i]` stays `null`. Anywhere inside the winner's *partition* span it therefore passes
through **intact**, and downstream those keypoints carry `status: 'detected'` — a wrong-person
position wearing the STRONGEST status this pipeline has. That is a softer version of exactly what
D3 exists to prevent, arriving through a path D3's reference-identity invariant does not cover
(the frame is its input by reference; it is simply the wrong person's input).

Note the inversion this produces: a bystander detected at 200 px² with 5 confident keypoints is
nulled by the area floor, but **the same bystander with 3 confident keypoints is kept** — fewer
confident points buys survival. The floor's protection is skipped precisely for the detections
least able to justify themselves.

Reach is bounded by the partition, not by the winner's evidence: segment 0 extends back to index 0
and the last segment forward to the end (D6), so a boxless frame arbitrarily far from any surviving
detection can still be "in the winner". On Demo 1 that is the whole leading and trailing stretch.

**Suggested fix (not implemented here).** Restrict boxless survival to the window
`[first surviving index, last surviving index]` **of the winner** — the span the winner has actual
box evidence for — rather than its partition span. The partition still governs *nulling*, which
stays total: every frame outside the winner is nulled exactly as today, so D6's "no frame is
ambiguous" property is untouched. Only the *survival* of an unverifiable frame narrows, from
"anywhere in the winner's partition" to "inside the winner's evidenced interior". This needs its
own A/B (it changes Demo 2's currently-bit-identical arm if any boxless frame sits outside the
evidenced interior) and is a hard prerequisite for default-on, alongside Follow-up 1.

### Primary/scale-pass selection divergence (open)

`useVideoAnalysis.ts` runs `runClipAnalysisPipeline` twice per analysis: once for the primary pass
(~:321) and once for the background MediaPipe scale pass (~:545). Each call runs its own
`selectRetroactivePersonOfInterest` over its own sample sequence, produced by a **different
backend** at a **different sampling cadence**. Nothing reconciles the two identities.

So with the stage enabled: if MoveNet-primary's winner is the runner and the scale pass's own
integrated-area winner is the bystander, `graftScalePassResult` (~:563) writes **that bystander's**
`verticalOscillationCm` and `stepWidthCm` onto a result whose other seven metrics describe the
runner — silently, with no caveat, and displayed as one person's form report. The graft's existing
gate only asks whether the pass measured a real-world scale at all; it has no notion of *whose*
scale.

This is latent today only because the stage ships off: both passes take the `skipReason:
'disabled'` path and agree trivially. Enabling the stage activates it.

Cheap to detect: both `AnalysisDiagnostics` objects are in hand at the graft site (the scale pass's
as `scaleDiagnostics`, the primary's on `state.diagnostics`), and each carries its winner's span as
`personSelection.segments[0]`'s `startTimestamp`/`endTimestamp`. Comparing the two winners' spans
for overlap is a few lines and no new computation. What to *do* on divergence — fail the pass,
graft with a caveat, or graft anyway — is the real design question and is deferred with it.
Follow-up 5.

## Follow-ups (not in this change)

1. **A splice-tolerant segmentation rule** — the one thing blocking default-on. Candidates: require
   N consecutive discontinuous frames before cutting; or bridge across a single non-continuous
   frame when the frames on either side of it are continuous with *each other*. The second one is
   confirmed to heal the measured Demo 1 wedge specifically: t=4.24 and t=4.36 are continuous with
   each other on **both** terms (see D7). Both are cheap; both need their own A/B.
2. **Re-derive the area floor per resolution class**, given the measured 4K phantom detections at
   2,279–8,432 px².
3. **Stage 2** (issue #51): multipose identity pass, gait-periodicity scoring, non-causal smoothed
   crop trajectory.
4. **Restrict boxless survival to the winner's evidenced interior** — the second hard prerequisite
   for default-on, alongside Follow-up 1. See "Boxless survival inside the winner's span" above.
5. **A primary/scale-pass selection divergence check at the graft site** — compare the two passes'
   winner spans before `graftScalePassResult` writes the scale pass's centimetre metrics onto the
   primary result, and decide what divergence should do. See "Primary/scale-pass selection
   divergence" above. Only reachable once the stage is enabled, so it is not a blocker for shipping
   off, but it is one for shipping on.
6. **Spec-archive coordination**: `add-webcodecs-sequential-sampling` is also in flight and also
   MODIFIES `analysis-diagnostics`'s "Diagnostics aggregation" and both
   `sampling-robustness-config` requirements. This change's MODIFIED text is written as a superset
   of that change's, so archiving this one last is safe; archiving it first would let the other
   change's text drop `personSelection`. Archive `add-webcodecs-sequential-sampling` first.
