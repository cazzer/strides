# Design — restrict boxless survival to the winner's evidenced interior

## Context

The bug, its inversion, and the remedy are all established in the archived
`2026-08-16-retroactive-person-selection/design.md`, section "Boxless survival inside the winner's
span (open)", and restated in issue #55. They are not re-derived here. This document records the
implementation decisions, the pre-registered A/B criteria, and the measured result.

The one thing worth restating, because every decision below follows from it: a boxless frame is not
"a weak detection". It is a detection about which **nothing at all has been checked** — no area, no
continuity, no identity. The area floor and the segmentation pass are both structurally
unreachable for it. So the question is not "how confident are we in this frame" but "is there any
evidence at all, from anywhere, that the winner was on screen at this moment". The winner's own
surviving detections are the only such evidence this stage has.

## Decisions

### D1 — The evidenced interior is the winner's `[first surviving index, last surviving index]`

Closed interval, index space, over the WINNING segment's surviving detections only. "Surviving"
already means post-floor and box-yielding, so the interval is defined without extra bookkeeping —
`surviving[i] !== null` is exactly the predicate.

Computed inside the loop that already walks each segment's indices to collect its areas, so it
costs nothing: the same pass records the first and last index at which it pushed an area. Computing
it per segment rather than only for the winner keeps the scored record self-describing and avoids a
second, differently-bounded scan later; only the winner's is ever read.

Alternatives rejected:
- **A distance/time radius around the nearest surviving detection** (e.g. "within
  `maxContinuityGapSeconds` of a surviving frame"). This introduces a second, independently-tunable
  bound governing the same question the segmentation bounds already answer, and its value would
  have no evidence behind it. The interior needs no threshold at all.
- **Interpolating identity across the boxless frame** — explicitly forbidden by the stage's own D3
  ("a gap is honestly missing data; a substitution is a plausible-looking lie").

### D2 — The partition still governs nulling and bucket attribution; only survival narrows

D6's total partition is untouched: every sample still belongs to exactly one segment, and a frame's
segment membership still decides whether it is a losing-segment rejection. The evidenced interior
is consulted **only** to decide survival, and only ever narrows it. Concretely the map becomes:

```
inEvidence  → survives (unless below floor)
inWinner, not inEvidence → nulled, counted in rejectedOutsideEvidence
not inWinner             → nulled, counted in rejectedOtherSegment   (unchanged)
belowFloor               → nulled, counted in rejectedBelowFloor      (unchanged)
```

Checking partition membership first means `rejectedOutsideEvidence` counts **exactly** the frames
this change newly nulls — nothing that was already being nulled moves bucket. That is what makes
the A/B readable: every field except the new counter and `detectedSamplesOut` must hold still.

### D3 — Boxed detections are unaffected by construction, not by a special case

Every surviving index inside the winner's partition is, by definition of first/last, inside the
winner's evidenced interior. So a single uniform test (`inEvidence && !belowFloor[i]`) is
simultaneously the old behaviour for boxed frames and the new, narrower behaviour for boxless ones.
No branch distinguishes them, and there is no way for the two paths to drift apart.

### D4 — One new counter, `rejectedOutsideEvidence`, kept separate from `rejectedOtherSegment`

`rejectedOtherSegment` means "lost its segment". A frame nulled by this rule did **not** lose its
segment — it won, and was still discarded. Folding the two would make the existing field's name a
lie and would make the change invisible in diagnostics, which is the same failure mode #54 added
`bridgedCuts` to avoid: without an observable, a clip where the rule fired and a clip where it had
nothing to do report identically.

It is also load-bearing for this change's single most likely surprise. Demo 2 is currently a
bit-identical no-op; whether it stays one is decided entirely by whether any boxless frame sits
outside its winner's evidenced interior, and `rejectedOutsideEvidence` answers that directly rather
than by inference from a moved `detectedFrames`.

`detectedSamplesOut` stays a subtraction, now over three buckets, so the buckets are provably
exhaustive:
`detectedSamplesIn - rejectedBelowFloor - rejectedOtherSegment - rejectedOutsideEvidence`.

Emitted as `0` on every skip path, uniform with every other field — never optional.

### D5 — The emitted segment span stays the partition span, and says so

`PersonSelectionSegmentDiagnostics.startTimestamp`/`endTimestamp` keep reporting the partition
span, so consecutive segments still tile the clip with no gaps and the field keeps the meaning
every existing reader assumes. But the window that now governs survival is a different, narrower
one, and after this change the two can differ — so the doc comment says that explicitly rather than
leaving a reader to assume the reported span is the span frames survived in.

The evidenced interior is deliberately **not** added to the per-segment diagnostics. The count of
frames it excluded is the decision-relevant fact and is reported; two more timestamps per segment
would be surface without a question attached to it.

### D6 — The winner is guaranteed to have at least one surviving detection

Verified rather than assumed, because the whole interval is undefined otherwise (and the issue
asked for it explicitly, given #54 changed the cut loop). `segmentStarts` is only ever pushed at an
index where `surviving[i] !== null`, in both branches of the cut loop; the splice-tolerance bridge
*declines* to push and never introduces a start at a non-surviving index. The partition then
assigns segment `k` a range that contains `segmentStarts[k]` (extended outward at the ends, never
inward). So every segment contains at least its own start, which is surviving —
`medianAreaPx`'s existing "impossible today: every segment starts at one" note still holds after
#54, and the interval is never empty.

This is asserted as a spec scenario rather than left as a comment.

## Pre-registered A/B criteria

Written **before** any measurement. Three clips (`demo1`, `demo2`, `multiperson`), 3 trials per
arm, `scripts/ab-person-selection.mjs --port 5199`, real GPU.

Both arms are **stage-on with default config** (`--arm 'base={}' --arm 'after={}'`); they differ
only in code, swapped in place per #54's single-file method, with the same provenance caveat: the
driver stamps the same commit for both reports because the base arm is produced by reverting
`src/results/retroactivePersonSelection.ts` to its pre-change blob, running, and restoring it. That
file is the only runtime file this change touches, so the swap is exact — but the commit line in
the base report is not a valid provenance record; the file's git blob is the real discriminator.

Baselines are **measured in this session's base arm, not imported**. #54's headline criterion
missed by one frame precisely because a constant was carried across sessions where sampling varies.

### Hard gates — a violation blocks the change

| id | criterion |
|---|---|
| **H1** | On all three clips, `segmentCount`, `bridgedCuts`, `rejectedBelowFloor`, `rejectedOtherSegment`, `separationRatio`, and every `segments[0].*` field have the **same median and the same `[min..max]`** between arms. This change cannot reach segmentation or scoring; a move here means the implementation touched something it must not. A difference is only ever explained, never accepted — and the one admissible explanation is a matching move in `sampling.totalFrames` (sampling jitter, not this change). |
| **H2** | On every clip and trial in the after arm, `detectedSamplesOut >= segments[0].frameCount`. Structural: a frame with box evidence in the winner is inside the evidenced interior by definition, so the rule can never null one. A violation is an implementation bug, not a tuning question. |
| **H3** | On every clip and trial in the after arm, `detectedSamplesOut == detectedSamplesIn - rejectedBelowFloor - rejectedOtherSegment - rejectedOutsideEvidence`, and `sampling.detectedFrames == detectedSamplesOut`. The buckets must exhaustively account for the output. |
| **H4** | `detectedSamplesOut(after) == detectedSamplesOut(base) - rejectedOutsideEvidence(after)` on every clip (medians, and per-trial where the ranges are tight). Every frame newly lost is accounted for by the new bucket and by nothing else. |
| **H5** | Multi-person: `separationRatio >= 3` and `segments[0].medianAreaPx` within 10% of the base arm. Inherited from #54's do-not-ship 1 — no bystander merged. This outranks every accept condition. |

### Accept criteria

| id | criterion |
|---|---|
| **A1** | Demo 1 keeps #54's healed winner: `segments[0]` one segment starting at the base arm's own measured start with the base arm's own `frameCount`, `bridgedCuts` unchanged. (Subsumed by H1; stated separately because it is an explicit acceptance criterion on the ticket.) |
| **A2** | Demo 1's `detectedSamplesOut` drops by at most `detectedSamplesOut(base) − segments[0].frameCount(base)` — i.e. at most the boxless-frames-inside-the-winner budget, which is the theoretical maximum this rule can remove. Anything larger is impossible and would mean H2 fired. |
| **A3** | Demo 2 either stays bit-identical to the base arm with `rejectedOutsideEvidence == 0`, **or** it moves by exactly `rejectedOutsideEvidence` frames of `detectedSamplesOut` and nothing else, and the delta is written up with the count. A Demo 2 move is **not** an automatic fail — nulling an unverified frame outside the winner's box evidence is this change's purpose — but Demo 2's `segmentCount`, winner span, or `segments[0].frameCount` moving **is** (that is H1). |
| **A4** | No metric that carried a non-null value in the base arm becomes null in the after arm, on any clip, in the median trial. |
| **A5** | No metric's median confidence drops by more than **0.10** absolute on any clip. |

### Do-not-ship conditions

1. **H1 fires** and the difference is not a matching `sampling.totalFrames` move — the change
   reached segmentation or scoring. Stop and re-trace; do not tune.
2. **H2 fires** — a frame with box evidence was nulled. Implementation bug.
3. **H3 fires** — the diagnostics buckets do not account for the output.
4. **H5 fires** — a bystander merged.
5. `detectedSamplesOut` drops by more than **20%** on any clip. That would be far beyond the
   boxless budget A2 bounds and would mean the interior is being computed over the wrong index set.

### The expected-zero case, pre-registered so it is not spun afterwards

If `rejectedOutsideEvidence == 0` on all three clips, this change is a **measured live no-op** and
its entire evidence base is the unit suite. That is recorded as exactly that — "the rule did not
fire on any available clip" — not as "verified live". The inversion it closes is real regardless
(it is a correctness fix for a case these three clips may simply not contain), but a no-op
measurement is not evidence that it works on footage that does contain it.

## Measured A/B results (2026-08-16, real GPU)

`scripts/ab-person-selection.mjs`, 3 trials × 3 clips × 2 arms, `--port 5199` (5173 was held by
another checkout's dev server — the exact hazard #53's reuse refusal exists for; both invocations
started their own server, `serverProvenance: started by this run`). Renderer confirmed
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`, not SwiftShader. Both arms are stage-on with
default config; they differ only in code.

**Provenance caveat, stated plainly:** both reports stamp commit `564ae38`, because the base arm
was produced by reverting `src/results/retroactivePersonSelection.ts` to `f665303`'s blob
(`4c9a0ef9`, hash-verified before and after), running, and restoring it. That file is the only
runtime file this change touches, so the swap is exact — but the commit line in the base report is
not a valid provenance record; the file's git blob is the real discriminator.

**Environment note:** `@playwright/test` was missing from the shared parent `node_modules` this
worktree resolves against, so the driver failed at `loadPlaywrightConfig` with its Node-version
message — a misleading error, since Node was 22.23.1 and the real cause was an unresolvable import.
Fixed by `npm install` inside the worktree (gitignored, isolated, parent untouched). Worth knowing
because the driver's error text names the wrong cause.

Medians with `[min..max]` where trials differed.

### Segmentation and scoring — untouched on every clip (H1)

| field | demo1 base | demo1 after | demo2 base | demo2 after | multi base | multi after |
|---|---|---|---|---|---|---|
| `segmentCount` | 3 [3..4] | 3 [3..4] | 1 | 1 | 2 | 2 |
| `bridgedCuts` | 1 | 1 | 0 | 0 | 4 | 4 |
| `rejectedBelowFloor` | 0 | 0 | 0 | 0 | 30 | 30 |
| `rejectedOtherSegment` | 7 [7..10] | 7 [7..10] | 0 | 0 | 47 | 47 |
| `separationRatio` | 2375.04 [2374.07..2375.04] | 2375.04 [2374.07..2375.04] | null | null | 33.5408 | 33.5408 |
| `segments[0].startTimestamp` | 0.08 | 0.08 | 0.033367 | 0.033367 | 1.75 | 1.75 |
| `segments[0].endTimestamp` | 7.16 [6.32..7.16] | 7.16 [6.32..7.16] | 1.66833 | 1.66833 | 3.90 | 3.90 |
| `segments[0].frameCount` | 53 | 53 | 99 | 99 | 123 | 123 |
| `segments[0].integratedAreaPx` | 24,976,600 [24,966,400..] | 24,976,600 [24,966,400..] | 19,241,700 | 19,241,700 | 3,569,130 | 3,569,130 |
| `segments[0].medianAreaPx` | 491,133 [491,133..492,789] | 491,133 [491,133..492,789] | 134,081 | 134,081 | 31,670.2 | 31,670.2 |

Identical medians **and identical ranges**, every field, every clip. The change did not reach
segmentation or scoring.

### What the rule actually did

| field | demo1 base | demo1 after | demo2 base | demo2 after | multi base | multi after |
|---|---|---|---|---|---|---|
| `detectedSamplesIn` | 65 [65..66] | 65 [65..66] | 99 | 99 | 204 | 204 |
| `detectedSamplesOut` | **58 [56..58]** | **53** | 99 | 99 | 127 | 127 |
| `sampling.detectedFrames` | **58 [56..58]** | **53** | 99 | 99 | 127 | 127 |
| `rejectedOutsideEvidence` | — (absent) | **5 [3..5]** | — | **0** | — | **0** |
| boxless budget (`out − segments[0].frameCount`, base) | 3 / 5 / 5 | — | 0 / 0 / 0 | — | 4 / 4 / 4 | — |

Per trial, the identity is exact rather than approximate:

| trial | base `out` | after `rejectedOutsideEvidence` | after `out` |
|---|---|---|---|
| demo1 #1 | 56 | 3 | 53 |
| demo1 #2 | 58 | 5 | 53 |
| demo1 #3 | 58 | 5 | 53 |

`56 − 3 = 53`, `58 − 5 = 53`, twice — including the jittery trial 1, where the detector found one
fewer frame. Demo 1's post-selection output is now pinned to `segments[0].frameCount`, with no
range at all: **every frame that survives is a frame the winner has box evidence for.** The
previous 56–58 spread was entirely unverified frames.

**The rule discriminates; it does not blanket-null.** The multi-person clip has a boxless budget of
4 (127 output frames against a 123-detection winner) and `rejectedOutsideEvidence: 0` — all four of
its boxless frames sit *inside* the winner's evidenced interior and were kept. Demo 1's 3–5 all sit
outside it and were nulled. Demo 2 has no boxless frames at all, so there was nothing to decide.

**Read the same four frames the other way round, because both readings are true.** Those four are
also four live instances of the **residual inversion**: the asymmetry is closed OUTSIDE the
evidenced interior and survives INSIDE it by design. A boxless frame between the winner's first and
last surviving detection is still kept unchecked, so a sub-floor intruder there is still nulled at
5 confident keypoints and still kept at 3. This measurement is the first evidence that the residue
is non-empty on real footage — 4 frames on one clip — rather than a theoretical corner. D1 rejected
a proximity bound rather than a narrower interval, and that judgement stands: a second, untunable
radius governing the same question the segmentation bounds already answer would be worse than the
residue it removes. But the residue is real, it is bounded by the winner's own evidence rather than
by nothing, and it is not zero.

### Metrics — nothing moved, anywhere

Every one of the nine metrics' `value` and `confidence` is **identical between arms on all three
clips**, medians and ranges alike (`armSwingSymmetry`, `cadence`, `footStrikePattern`,
`kneeFlexion`, `overstriding`, `stepWidth`, `stepWidthCm`, `trunkLean`, `verticalOscillation`,
`verticalOscillationCm`, `verticalRatio`). Worst median-confidence delta across the whole matrix:
**0.0000**. `view.view`, `view.confidence` and `view.diagnostics.frameCoverage` are unchanged too.

So Demo 1 gives up 5 detected frames and loses **nothing measurable** for them. The likely
mechanism — not separately instrumented, so stated as the plausible reading rather than a finding —
is that a boxless frame is by definition one whose keypoints mostly fail the same 0.3 confidence
gate `applyRobustness` applies downstream, and these particular frames sit at the clip's temporal
edges (outside the winner's first/last detection), which `trimToPresenceWindow` trims before any
metric is computed. Either way, the coverage number moved and no metric did.

### Verdict against the pre-registered criteria

| gate | result |
|---|---|
| **H1** segmentation/scoring identical | **PASS** — medians and ranges, all 10 fields, all 3 clips |
| **H2** `detectedSamplesOut >= segments[0].frameCount` | **PASS** — 9/9 trials (demo1 53≥53, demo2 99≥99, multi 127≥123) |
| **H3** three-bucket identity + `detectedFrames == detectedSamplesOut` | **PASS** — 9/9 trials, exact |
| **H4** `out(after) == out(base) − rejectedOutsideEvidence(after)` | **PASS** — exact per trial, not just at the median |
| **H5** multi-person `separationRatio >= 3`, `medianAreaPx` within 10% | **PASS** — 33.5408 and 31,670.2, both **unchanged**, 0% drift |
| **A1** Demo 1 keeps #54's healed winner | **PASS** — one winner at [0.08, …], 53 detections, `bridgedCuts` 1, `segmentCount` 3–4, all unchanged |
| **A2** Demo 1 drop ≤ boxless budget | **PASS** — drop *equals* the budget exactly (3/5/5), the theoretical maximum |
| **A3** Demo 2 no-op or explained | **PASS** — `rejectedOutsideEvidence: 0`, bit-identical on every captured field, 3/3 trials |
| **A4** no metric becomes null | **PASS** — no metric changed at all |
| **A5** no median confidence drops >0.10 | **PASS** — worst delta 0.0000 |
| **Do-not-ship 1–5** | none triggered |

**Demo 2 stayed a bit-identical no-op** — the single most likely surprise this A/B was run to
catch did not occur, and the reason is measurable rather than lucky: that clip's winner is one
segment covering all 99 samples with all 99 detections surviving, so it has no boxless frames for
the rule to judge.

**The expected-zero clause does not apply.** The rule fired live, on Demo 1, in all three trials.
Its effect there is exactly what the design predicted and nothing else moved — which is the
strongest form this measurement could have taken: a targeted change with a measured, bounded,
fully-accounted effect and a provably empty blast radius.

### What this does NOT establish

The 3–5 Demo 1 frames were nulled because they lie outside the winner's box evidence, not because
anyone confirmed they show a different person. No keyframe review was done, and none of these three
clips contains the motivating case in its sharpest form — a bystander that yields a box at 5
confident keypoints and none at 3, in the same span. That inversion is closed by construction
outside the evidenced interior, pinned by a paired unit fixture, and not separately confirmed on
real footage here.

**And the trade runs both ways, so state both.** Some of those 3–5 frames are quite likely the
runner mid-occlusion — a frame where limbs drop below the confidence gate at the clip's edges is at
least as easily a partly-hidden subject as an intruder — and they are now discarded. This change
does not distinguish the two cases and cannot: a boxless frame carries no evidence either way,
which is the whole premise. What it buys is that an unverifiable frame can no longer ride an
arbitrary distance from any evidence at all on the strength of a partition boundary. What it costs
is those frames when they were genuinely the subject. On these three clips the cost was measured at
zero metric movement, which is why it is a good trade here — not because the frames were shown to
be somebody else.
