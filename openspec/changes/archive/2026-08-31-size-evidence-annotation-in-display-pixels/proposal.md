# Size evidence annotation in display pixels, not only canvas fractions

## Why

Two open bugs — `strides-dt1` (amber measurement marks run below 3:1 against bright photographs at
the inline size) and `strides-60w` (a ghosted exemplar can stop reading as a body at the inline
size) — were both filed against the *inline* rendering and both survived every canvas-space check
the code has. They survived because every weight in `drawEvidenceAnnotations.ts` is a fraction of
the **output canvas**, and the defect lives at the other end of the pipeline: the card draws a
320–640 px canvas into a `w-36` box, 144 CSS px.

Resolved against the size a reader is actually served, two of those fractions are **sub-pixel**:

| feature | canvas px (640 canvas) | display px at 144 |
|---|---|---|
| halo, each side of a mark | 3.20 | **0.72** |
| visible gap in a dashed construction line | 2.88 | **0.65** |

A sub-pixel dark edge does not survive the compositor's downscale. Its darkness is averaged into
the mark on one side and the photograph on the other, so the boundary it exists to create **is not
in the delivered image at all**. A canvas-pixel floor cannot detect this: the mark stays correctly
proportioned right up to the point where it is averaged away.

That matters because the halo is not one mitigation among several — it is the **only** one
available. `EVIDENCE_MEASUREMENT_COLOR` (`#fbbf24`) has a relative luminance of 0.5790, so it
reaches 3:1 only against a background darker than **0.1597**; against the 0.50-luminance path under
Demo 2's `stepWidth` it is **1.14:1**. No amber, at any width or any opacity, reaches 3:1 there.
The dark edge between the mark and the photograph does — measured 3.0–4.6:1 over the same
backgrounds — and it is also what WCAG 1.4.11 means by an "adjacent colour". So the fix has to put
the halo into the **delivered** pixels, which is a rendering-scale decision, not a colour one.
(`EVIDENCE_JOINT_COLOR` sits at 0.5310 and has the identical problem, so the same edge carries both
layers.)

## What Changes

- **A display-pixel floor on the halo.** `evidenceAnnotationMetrics` takes the display side as an
  argument defaulting to `EVIDENCE_INLINE_DISPLAY_SIDE_PX = 144` — the one surface that exists —
  and floors the halo at `MIN_HALO_DISPLAY_PX = 1.5` display pixels. An argument rather than a
  constant so a larger surface relaxes the floor instead of inheriting a width only the smallest
  surface needed. Proportional sizing is untouched: the floor is itself proportional to the canvas
  side, so halving the canvas still halves every weight.
- **The same floor on a dashed construction line's gap**, `MIN_DASH_GAP_DISPLAY_PX = 1.5`, applied
  to the gap the reader **sees** rather than the dash pattern handed to the canvas. The halo pass
  strokes the same dashes at a greater width with round caps, so it extends every dash at both
  ends; that already ate all but 0.65 display px of the gap before this change, and a halo wide
  enough to see closes it completely.
- **The halo no longer scales with the mark's opacity.** It carried emphasis when it should carry
  separability: a ghost's interpolated mark was getting a halo at 0.6 × 0.175 effective alpha, so
  exactly the marks with the least contrast of their own had almost no edge.
- **Every halo is drawn before any mark colour.** Previously each op laid its own halo and colour
  down together, so op N+1's halo painted over op N's mark. Survivable at a hairline; not at a
  width that reaches the reader — measured on the multiperson clip's `trunkLean`, the interleaved
  order left the amber measurement layer almost entirely buried under its neighbours' halos.
- **The joint dot's ring moves outside the dot** rather than straddling its rim, so widening it
  outlines the dot instead of eating it.

Not changed, deliberately: `EVIDENCE_GHOST_BLEND_ALPHA` (0.35), every crop constant, every exemplar
gate, and both mark colours. This change moves no geometry and no planning decision — the
annotation-free photographs are **bit-identical** before and after across all 42 reference images.

## Impact

- Affected specs: `results-view`
- Affected code: `src/video/drawEvidenceAnnotations.ts`, `src/video/drawEvidenceAnnotations.test.ts`

Measured live (headless Chromium, real GPU `ANGLE Metal Renderer: Apple M4 Pro`, fresh process per
clip, contrast read on the **rendered 144 CSS px pixels** against a pixel-aligned annotation-free
reference): mark-versus-photograph contrast reaches 3:1 on **100% of mark positions in 19 of 21
images**, up from 17 of 21, with every median ≥ 4.94 and every minimum ≥ 3.09. Demo 1
`kneeFlexion`, the cell that was already comfortable, went **up** (7.12 → 8.18). Coverage is
unchanged at 8/7, 5/4 and 8/7, and the regression anchor is exact.

`strides-dt1` is closed on its acceptance criterion. **`strides-60w` is not** — see design D6.
