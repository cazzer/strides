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

## Measured A/B results

*(filled in after the run — see below)*
