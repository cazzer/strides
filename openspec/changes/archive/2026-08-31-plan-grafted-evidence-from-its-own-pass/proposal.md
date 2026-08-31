# Plan a grafted metric's evidence from the pass that measured it

## Why

The background MediaPipe scale pass measures `verticalOscillationCm` and `stepWidthCm` from its own
frames, and `scalePassGraft.ts` then writes those numbers onto a result whose every other metric —
and, until now, whose only `RobustPoseFrame[]` — is the primary MoveNet pass's. The evidence planner
resolved a grafted exemplar's timestamp by snapping it into the **primary** pass's frames, so the
joints an annotation draws, the crop it is drawn through, and the hip **polarity** a caliper's
direction is read from all came from a detector that did not take the measurement.

`strides-ac9.7` mitigated the polarity half at the consumer, by refusing to orient any mark for a
grafted metric (`GRAFTED_METRICS`, `evidenceAnnotations.ts`). That is correct and cheap, and it is
a workaround at the consumer rather than a fix at the seam. `strides-3a1` exists so it is not
mistaken for one.

**The defect is not theoretical.** Measured live on 2026-08-31 (headless Chromium, real GPU —
`ANGLE Metal Renderer: Apple M4 Pro` — with both passes' frames captured at the graft site, 3 clips):

| clip | instants where both passes resolved both hips | ordered **oppositely** | median hip separation |
|---|---|---|---|
| Demo 1 (side view) | 57 | **15 (26.3%)** | 31.6 px |
| Demo 2 (front view) | 98 | **0** | 92.6 px |
| multiperson | 87 | **15 (17.2%)** | 8.9 px |

The pattern is mechanical: a front view separates the two hips by ~93 px and the ordering is stable;
a side view leaves them 9–32 px apart, where a few pixels of detector disagreement flips it. Of the
**twelve** grafted exemplar instants those three clips actually plan, **three carry the inverse
ordering** — including a Demo 1 `stepWidthCm` strike whose two hips the scale pass placed 4.4 px
apart. That is exactly the case the bead describes: a caliper that would label a crossover strike as
landing on its own side, contradicting `stepWidth.ts`'s own crossover caveat in the same viewport.

Positions disagree materially too, and no existing mechanism suppresses those: hip-mid lands a
median **31.5 px** apart on Demo 1, about **7% of a torso length**.

**`scalePassSubjectAgreement.ts` (`strides-56`) does not already cover this, and reusing it would be
a category error.** It asks whether the two passes selected the same *person*, by comparing bounding
box *hulls* — which are identical under a left/right relabelling, and blind to a few pixels of joint
displacement. On the same Demo 1 run it reports `'agreed'` at **52/53** while 26% of that clip's
instants order the hips oppositely. Both statements are true simultaneously: the passes agree about
**who**, and disagree about **which side**. Nothing in this change duplicates it.

## What Changes

- The scale pass's own `RobustPoseFrame[]` are retained on the analysis state alongside the metrics
  it grafted, written in the **same** state literal as the graft.
- `planClipEvidence` accepts them and plans every grafted metric against them — their frames, their
  snap tolerance, their travel direction. Every other metric is planned exactly as before.
- Their **presence**, not membership of a metric-id set, is what says a graft happened. A
  MediaPipe-primary run grafts nothing, carries no scale-pass frames, and correctly plans its
  centimetre metrics against the primary frames, which already are the ones that measured them.
- `scalePassGraft.ts` gains `GRAFTED_METRIC_IDS`, pinned by test against what
  `graftScalePassResult` and `dropGraftedExemplars` actually touch, so the set cannot drift from the
  functions it describes.

## Impact

- Affected specs: `results-view`
- Affected code: `src/results/scalePassGraft.ts`, `src/results/evidenceFrames.ts`,
  `src/results/useSessionEvidence.ts`, `src/results/useVideoAnalysis.ts`, `src/results/types.ts`
- **Not** affected, deliberately: `src/results/evidenceAnnotations.ts`. `GRAFTED_METRICS`'s polarity
  suppression is left in place by this change and is now over-suppression rather than protection —
  see design D4 and the follow-up bead. Removing it is a separate, single-file change.
- No metric value moves. The regression anchor is re-verified unchanged.
