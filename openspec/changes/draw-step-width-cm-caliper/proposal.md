# Draw `stepWidthCm`'s ankle-offset caliper

## Why

`stepWidthCm`'s paired exemplar omits `measuredSide` and `pairedMeasuredSide`, so the one
annotation that depicts its measurement is never drawn.

The two step-width modules each carried a private `buildExemplars`. Stripped of comments they were
**identical except for exactly two lines** — 62 code lines against 60, and the diff is precisely:

```
<           measuredSide: base.side,
<           pairedMeasuredSide: ghost.side,
```

Neither module sets a pair-level `side`, deliberately: the two instants are opposite feet, so
naming one would be wrong about the other. With the per-instant fields absent too,
`resolveInstantSide` (`evidenceFrames.ts`) evaluates `measured ?? exemplar.side ?? null` to `null`
on **both** halves, and `buildStepWidthMarks` (`evidenceAnnotations.ts`) hits `if (side === null)
return` **before** `builder.caliper`. The hip-width segment and the hip-midline plumb are drawn
first and still appear, so the image looks deliberate rather than broken — it is simply missing the
ankle-offset caliper, which is the measurement itself.

Confirmed end to end rather than by reading: on one synthetic front-view fixture, planned and
annotated through the real `planMetricEvidence` → `planEvidenceAnnotations` path, `stepWidth`
produces two `ankleOffsetCaliper` ops (one per half) and `stepWidthCm` produces **zero**, with
`hipWidthSegment` and `hipMidlinePlumb` present in both.

Corroboration that this was never intended: `evidenceAnnotations.ts`'s own `GRAFTED_METRICS` doc
already asserts the opposite of what happens — "this suppresses `stepWidthCm`'s caliper POLARITY
(the caliper still draws, as the unsigned lateral span it honestly is)". The caliper does not draw
at all. That doc is describing the intended behaviour this change restores.

**The behaviour contract already required this.** `form-heuristics`'s requirement "Metrics emit
exemplar instants as timestamps, never frame indices" states that a metric pairing two instants
that need not share a side SHALL state each instant's own side, and its scenario "An opposite-side
pair states each instant's own side" covers this case exactly. `stepWidthCm` was non-conformant.
So the metric-layer delta here is a **correction to that requirement's own enumeration**, not a new
rule: it says "**Two** metrics are in this position" and names "step width" and "overstriding",
while three `MetricId`s actually have the shape — `stepWidth`, `stepWidthCm` and `overstriding`.
Counting the two step-width metrics as one is precisely the ambiguity that let the third module be
overlooked, twice: once when the copy was made, and once when the requirement was written.

What is genuinely unspecified is the *consequence*. Nothing said that a per-instant side is a
**precondition for drawing the measurement mark**, so its absence silently downgraded the image to
a partial one instead of failing anywhere a reader or a test would look. That is the added
requirement.

**Invisible on this repo's footage.** `stepWidthCm` is tier-3 (`metric-excluded`) on Demo 1, Demo 2
and `multiperson-track.mp4`, so it renders no card and plans no evidence. There is no live image to
inspect, which is why the evidence for this change is a unit test driven through the real planning
and annotation path, mutation-checked in both directions.

## What Changes

- `stepWidthCm`'s paired exemplar states `measuredSide`/`pairedMeasuredSide`, so both halves of its
  ghosted pair draw the ankle-offset caliper from the ankle each half was measured from.
- The two duplicated `buildExemplars` are replaced by one shared construction
  (`stepWidthExemplars.ts`) that both metrics call, so the two cannot state different facts about
  the same construction again. The extracted body is byte-identical to `stepWidth.ts`'s — the
  correct one — so the ratio metric's behaviour is preserved by construction.
- No metric `value`, `confidence`, `viewFit`, `sampleSize` or `caveat` changes. No display constant
  moves.

## Impact

- Affected specs: `form-heuristics` (enumeration correction), `results-view` (new requirement)
- Affected code: `src/heuristics/stepWidthCm.ts`, `src/heuristics/stepWidth.ts`, new
  `src/heuristics/stepWidthExemplars.ts`, `src/heuristics/stepWidthCm.test.ts`
- Not touched: `evidenceAnnotations.ts` and `evidenceFrames.ts` are correct as written — the defect
  is upstream of both, and the fix belongs where `measuredSide` is stated.
- `strides-3a1` (open) is adjacent and NOT addressed here: a grafted exemplar carries the scale
  pass's instants but the primary pass's frames, so `stepWidthCm`'s caliper geometry resolves off a
  MoveNet frame. That seam decides *where* the caliper lands; this change decides *whether it is
  drawn at all*. The existing polarity suppression for `GRAFTED_METRICS` already covers the
  direction half and is deliberately left in place — the restored caliper draws unoriented, exactly
  as that doc describes.
