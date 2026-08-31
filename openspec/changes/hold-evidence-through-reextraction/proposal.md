# Hold evidence on screen through a re-extraction

## Why

After analysis completes, every metric card's evidence thumbnails appear, vanish, and reappear.
Live-reproduced three times (`strides-3ui`), headless Chromium on real GPU, a 13.2 s uploaded clip:

```
10.09s  ANALYSIS COMPLETE
11.78s  canvases 0 -> 4      first appear
17.89s  [analysis-diagnostics:scale-pass] status=done
17.94s  canvases 4 -> 0      vanish, 50 ms after the graft
18.76s  canvases 0 -> 4      reappear
```

Blank window 815 / 816 / 817 ms across three runs, and the two `[evidence-coverage]` payloads were
**byte-identical** — the second extraction rebuilt exactly what it had just destroyed.

Two independent defects stack:

1. **The reuse key is one level too high.** The background scale pass grafts its two centimetre
   metrics and writes a new `heuristics` object (`useVideoAnalysis.ts`). `graftScalePassResult`
   returns `{ ...primary, verticalOscillationCm, stepWidthCm }`, so the other nine metric objects
   are carried through **reference-identical** — but `sameClipInputs` compares the wrapping
   `heuristics` object, not its contents, so "two metrics changed" is indistinguishable from
   "everything changed" and the whole clip's cached evidence is discarded.

2. **The state transition is destructive.** `EXTRACTING_STATE` is a module constant with no
   `sections` field, so entering it throws away the sections that are on screen; the consumer maps
   any non-`settled` status to no evidence at all, session-wide, for every clip. Cards switch
   render branches, so the canvas subtree unmounts and the layout collapses from two columns to
   one and back.

The demo clips hide it. Whether it is visible is a race: the scale pass's wall clock scales with
clip length while extraction's is roughly constant, so on Demo 1 (2.1 s vs 3.8 s) and Demo 2
(1.6 s vs 3.3 s) the graft lands *before* the first extraction settles and the first run is
superseded before it ever paints. It reproduces on clips long enough to invert that ordering.

This is not a regression. The state machine dates to the evidence feature's first commit and the
trigger to the scale pass shipping; moving the imagery into the cards widened the blast radius from
one page section to every card. No design doc ever weighed the visual consequence — the archived
designs record only the harness-facing half ("take the LAST `[evidence-coverage]` line").

## What Changes

- Reuse a clip's extracted evidence when the newly computed **plan** and the clip's **source blob**
  are both unchanged, instead of when the upstream `heuristics`/`frames` object references are.
  These two are exactly the inputs `extractSessionEvidence` reads, so the reuse is sound by
  construction rather than by judgement.
- Carry the previously extracted sections through an in-flight re-extraction, so evidence already
  on screen stays on screen while a new pass runs, and is replaced only when the new pass settles.
- Sections are carried only while the clip set is unchanged. A clip added or removed re-derives
  from scratch, because a section's `clipIndex` addresses a position in the clip list and a stale
  index would mis-attribute imagery.

## Impact

- `src/results/useSessionEvidence.ts` — the reuse key, the cache entry, the state type.
- `src/results/MultiClipVideoSession.tsx` — reads sections from both non-idle states.
- Spec: `results-view` gains one requirement covering evidence continuity across a re-extraction.
- No change to the pure planning layer, the extractor, the annotation layer, or any metric.
