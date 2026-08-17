# Restrict boxless survival to the winner's evidenced interior (issue #55, epic #52 item 2)

## Why

`selectRetroactivePersonOfInterest`'s population pass skips a detection that yields no bounding
box:

```ts
const box = deriveBoundingBox(frame.keypoints, minKeypointConfidence, minConfidentKeypoints)
if (box === null) continue
```

`continue` leaves `belowFloor[i]` at `false` and `surviving[i]` at `null`, so that frame is
**never floor-checked and never segment-checked**. The final map then reads
`if (inWinner && !belowFloor[i]) return sample` — anywhere inside the winner's *partition* span it
passes through **by reference**, and downstream those keypoints carry `status: 'detected'`, the
strongest status this pipeline has, on what may be the wrong person's position. That is a softer
version of exactly what D3 exists to prevent, arriving through a path D3's reference-identity
invariant does not cover: the frame *is* its input by reference; it is simply the wrong person's
input.

The inversion is the clearest statement of the bug: **a bystander detected at 200 px² with 5
confident keypoints is nulled by the area floor; the same bystander with 3 confident keypoints is
kept.** Fewer confident points buys survival — the floor's protection is skipped precisely for the
detections least able to justify themselves.

Reach is bounded by the partition, not by evidence. Per D6 segment 0 extends back to index 0 and
the last segment forward to the end, so a boxless frame arbitrarily far from any surviving
detection can still be "in the winner". On Demo 1 that is the whole leading and trailing stretch.

This was documented as a hard prerequisite for `enabled: true`. The stage was enabled anyway by
explicit override, so it is live in production now.

## What Changes

- **Boxless survival narrows to the winner's evidenced interior** — the closed index interval
  `[first surviving index, last surviving index]` of the winning segment, the span that segment has
  actual box evidence for — rather than its partition span
  (`src/results/retroactivePersonSelection.ts`). The interval is computed in the pass that already
  walks each segment's surviving indices to score it; no second scan.
- **Nulling stays total.** Every frame outside the winner is nulled exactly as today. D6's "every
  sample belongs to exactly one segment" partition property is untouched, and the partition still
  governs *which* segment a frame belongs to and therefore whether it is a losing-segment
  rejection. Only the *survival* of an unverifiable frame narrows.
- **A boxed, above-floor detection is unaffected by construction.** Every surviving index inside
  the winner's partition is inside its evidenced interior by definition of first/last, so the new
  test is strictly narrower only for frames that had no box.
- **One new diagnostics field, `rejectedOutsideEvidence: number`** on `PersonSelectionDiagnostics`,
  counting exactly the detections this change newly nulls — inside the winner's partition, outside
  its evidenced interior. It is kept separate from `rejectedOtherSegment` (which keeps meaning
  "lost its segment") for the same reason #54 added `bridgedCuts`: without an observable, a clip
  where the rule fired and a clip where it had nothing to do are indistinguishable, which makes the
  A/B unreadable. It is also what answers the one question this change's A/B exists to ask — does
  Demo 2 stop being a bit-identical no-op, and if so, on how many frames.
- **The emitted segment span stays the partition span.** `PersonSelectionSegmentDiagnostics`'s
  `startTimestamp`/`endTimestamp` are unchanged; its doc comment now says explicitly that the
  reported span and the survival-governing evidenced interior are different windows, because after
  this change they can differ.

## Impact

- Affected specs: `person-selection` (MODIFIED ×1, ADDED ×1), `analysis-diagnostics` (MODIFIED ×1).
- Affected code: `src/results/retroactivePersonSelection.ts`, plus the two test fixtures that
  construct a whole `PersonSelectionDiagnostics` literal
  (`src/results/analysisDiagnostics.test.ts`, `src/results/runClipAnalysisPipeline.test.ts`).
  `src/results/analysisDiagnostics.ts` needs no edit — the block is type-level and by-reference
  pass-through. `scripts/ab-person-selection.mjs` needs no edit either: since #53 it flattens
  `personSelection` from whatever keys are present rather than an enumerated list.
- **`src/pose/backends/movenetCrop.ts` is NOT touched.** No predicate, no bound, and no
  `deriveBoundingBox` argument changes — this change only decides what to do with a frame
  `deriveBoundingBox` has already declined to box.
- Out of scope, deliberately: #56 (primary/scale-pass selection divergence), #57 (the 4K area
  floor), and #52's item 5 (Stage 2). The splice-tolerance rule and the continuity bounds #54 just
  landed are untouched.
- **Archive ordering.** This change and `splice-tolerant-segmentation` both MODIFY
  `analysis-diagnostics`'s "Person-selection diagnostics are always reported". This change's text
  is written as a superset of that one's — it keeps the declined-cuts clause and adds the new count
  — so archiving this one **last** is safe; archiving it first would let the other change's text
  drop `rejectedOutsideEvidence`. The two `person-selection` deltas touch disjoint requirements
  (that change modifies "Segments are cut at position, scale, and time discontinuities"; this one
  modifies "Every sample belongs to exactly one segment"), so their order does not matter there.
