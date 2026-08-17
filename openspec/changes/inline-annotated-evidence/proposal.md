# Evidence moves inline into annotated metric-card thumbnails (epic `strides-ac9`)

## Why

`metric-frame-evidence` shipped the right pictures in the wrong place, and deliberately withheld the
one thing that makes a picture answer the question it was shown for.

**Wrong place.** Evidence renders in a full-width gallery *below* the metric cards, reached by a "See
evidence ↓" anchor. The picture and the number it explains are never on screen together. A reader who
wants to check `kneeFlexion` follows a link out of the card, looks at a photograph, and then has to
find their way back. Live verification of that gallery measured 5–8 images across 4–6 sections per
clip — enough content that the round trip happens repeatedly.

**Withheld annotation.** The shipped rule is absolute:

> A ghosted image SHALL be a photographic opacity blend only. The system SHALL NOT draw a skeleton,
> angle arc, reference line, or any other annotation over an extracted image, and SHALL NOT overlay
> any reference or ideal posture — the only delta shown is the runner against themself.
> — `openspec/specs/results-view/spec.md:746`

That sentence bundles two different prohibitions. The second one is a product commitment and stays.
The first one costs the feature most of its value: an unannotated still of a runner mid-stride shows
*a moment*, not *what was measured in it*. Live verification of the gallery found this directly — a
`verticalOscillation` ghost on the side-view clip "reads as horizontal translation", because the
picture contains a large horizontal displacement and a small vertical one and nothing in the image
says which of the two the metric is about. A midpoint marker and a horizontal line at each instant
would have said it.

Annotation also turns a silent failure into a visible one. Person selection ships `enabled: true`
because "did this pipeline look at the right person?" is a live, measured failure mode; the gallery's
own verification found `armSwingSymmetry` on the front-view clip framing a bystander inside the crop.
An unannotated crop containing two people is ambiguous. A crop with the detected joints drawn on it
shows immediately which body the pipeline measured.

**And annotation is what makes the surviving prohibition mean something.** Drawing measured geometry
raises a question an unannotated photograph never had to answer: *is the thing drawn the thing the
card reports?* Researched against the calculations, usually not — a fitted amplitude is not a pixel
gap, a ratio between two images is in neither of them, an extreme instant is not a median, and an
interior knee angle is the supplement of the reported flexion. A picture that quietly restates the
card's number is already overclaiming; adding a target posture on top would be claiming to know
correct form. This change therefore reverses one prohibition and adds two: no reference posture (kept
verbatim in intent), and no mark labelled with a value it does not depict (new).

## What Changes

- **Evidence renders inside the metric card**, after the description: below it while the card is
  narrow, beside it once the card is wide. The split is driven by the **card's own width** via a
  container query, not the viewport's — `MetricsPanel`'s grid is already `@container` /
  `@lg:grid-cols-2` / `@3xl:grid-cols-3`, so a card on a wide screen in a three-column layout is a
  narrow card and a `md:` rule would place its thumbnail wrongly.
- **Images become thumbnails**, not 14rem gallery figures. Display size is CSS; nothing is
  re-extracted at a second resolution. The single shared aspect ratio survives untouched.
- **Every thumbnail is annotated** with the detected joints *plus* the measurement geometry that
  metric's own calculation forms — torso vector + vertical reference + arc for `trunkLean`;
  hip→knee→ankle chain + arc at the knee for `kneeFlexion`; plumb line + horizontal caliper for
  `overstriding` and `footStrikePattern`; per-frame midline + caliper for `stepWidth`; shoulder
  horizontal + two vertical bars for `armSwingSymmetry`; midpoint markers + horizontal lines for the
  bounce cycle. Detected joints read stronger than interpolated ones; unrecoverable ones are absent.
- **No mark is labelled with the card's value unless it *is* that value.** Marks are captioned as
  what was measured **at the depicted instant**. Where the reported quantity has no honest still
  depiction, the thumbnail carries geometry and no number — never an approximation.
- **`EvidenceGallery.tsx` is deleted**, along with the `onEvidenceMetricsChange` →
  `reportedEvidenceMetrics` → `MetricsPanel` round trip that existed only so a card could decide
  whether to render a deep link. The extraction engine (`evidenceFrames.ts`, `extractFrames.ts`,
  the per-clip cache, the one-decoder-at-a-time discipline) stays and is untouched by the move.
- **Annotation geometry is computed in the pure layer.** The existing purity rule — "no DOM, no
  canvas, and no video element" — extends to it. jsdom's `getContext('2d')` returns `null` and this
  repo deliberately refuses the `canvas` npm package (`src/test/canvasTestUtils.ts`), so geometry
  decided inside a draw call is geometry no unit test can reach. Only the final stroke is impure.

**Locked decisions** (settled on the epic; not re-opened here):

| Decision | Choice |
|---|---|
| Gallery | Deleted, not kept alongside. |
| Placement | Inside the card, after the description. |
| Breakpoint | Per-card container query. Never a viewport media query. |
| Annotation content | This runner's detected joints + this metric's own measurement geometry. |
| Reference/ideal overlay | **Still forbidden.** Unchanged from `metric-frame-evidence`. |
| Labelling | Never the card's value unless the drawn quantity is that value. |
| `cadence` | Emits nothing, enforced independently in two places. Unchanged. |
| Persistence | Session-only, in memory. Canvas element adopted into the DOM. Unchanged. |
| Reuse | The `skeletonGeometry.ts` `DrawOp` model, adapted — never a second skeleton renderer. |

**This change must not move a number.** No metric's `value`, `confidence`, `viewFit`, `sampleSize`,
or `caveat` changes, and no exemplar is selected differently. The regression anchor is the track
clip's `verticalOscillationCm` (4.4215 cm, `fit.frequencyHz × 60` = 91.2 matching `cadence.value`
exactly).

## Impact

- **Affected specs**: `results-view` only. One requirement MODIFIED (the purity/planning rule, kept
  and extended), two REMOVED with migrations (the gallery, the deep link), four ADDED (inline
  thumbnails, annotation-and-no-reference-posture, annotation honesty, the unchanged-card guarantee).
- **Not affected**: `form-heuristics` (exemplars are emitted exactly as they are today) and
  `multi-clip-analysis` (its "the interface SHALL indicate which clip a metric's evidence came from"
  requirement is surface-agnostic and is satisfied by a per-card provenance line instead of a
  per-section one). Neither needs a delta. See design D8 for the one condition that would change
  this.
- **Affected code**: `src/results/evidenceFrames.ts` (plan carries annotation inputs),
  `src/results/MetricsPanel.tsx` (inline placement, container query, deep link removed),
  `src/video/extractFrames.ts` (annotation drawn after the photographic layers),
  `src/results/MultiClipVideoSession.tsx` (gallery child and reporting channel removed), a new pure
  annotation-geometry module, and the deletion of `src/results/EvidenceGallery.tsx`.
- **No new runtime dependencies.** This repo hand-rolls its SVG chart rather than pulling a charting
  library; the same bar applies to drawing a line on a canvas.
- **`[analysis-diagnostics]` stays byte-identical.** Its shape is a live-verification harness
  contract. `[evidence-coverage]` remains the separate channel, and gains nothing image-shaped.

## Out of Scope

- **Ideal-form / reference-posture overlays.** Explicitly still forbidden, and re-stated as a
  requirement rather than left as an absence. This repo has no reference-form data and inventing it is
  a different product.
- **Export, download, or share of an annotated image.** Session-only, unchanged.
- **Re-deriving the crop constants.** `EVIDENCE_CROP_MIN_SIDE_PX = 320` and
  `EVIDENCE_OUTPUT_MAX_SIDE_PX = 640` were both sized against "a gallery image is on the order of
  200-400 CSS px". Thumbnails are smaller, so that rationale is stale — but GitHub #71 is explicit
  that the 320 floor must not simply be moved, and this change deliberately does not pick a new
  number. Flagged in design D9.
- **Fixing the +2-frame evidence seek offset (GitHub #69).** This change makes an existing latent bug
  newly *visible* — joints drawn from a sampled frame onto an image two frames later will float off
  the body. Measuring and deciding it is `strides-ac9.4`, sequenced after the annotation lands so
  there is something to measure.
- **Changing which instants a metric selects.** `overstriding` emits on no measured clip and
  `trunkLean` fails on one; that is GitHub #70 and stays there.
