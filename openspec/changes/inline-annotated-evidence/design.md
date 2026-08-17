# Design — inline-annotated-evidence

This document is the contract the seven sibling tickets of `strides-ac9` implement against. Every
decision below is made once, here, so it is not re-litigated per-ticket.

Every source claim in D2 was verified against the code at the commit this change was authored on, and
carries its `file:line`. Where research carried on the epic or on a child ticket turned out to be
wrong, the corrected fact is stated inline and marked **[correction]** rather than silently fixed —
the epic's own text is what an implementer reads first, so a divergence needs to be visible.

---

## Context

`metric-frame-evidence` (archived `2026-08-17`) built the whole extraction pipeline and rendered it in
a standalone gallery. That pipeline is **not** what this change touches. The split that matters:

| Layer | File | This change |
|---|---|---|
| Exemplar emission (which instants) | the eleven metric modules, `exemplars.ts` | **untouched** |
| Pure planning (timestamps, crops, blends) | `src/results/evidenceFrames.ts` | extended — carries annotation inputs |
| Impure extraction (seek, draw, composite) | `src/video/extractFrames.ts` | extended — draws annotation after the photographic layers |
| Presentation | `src/results/EvidenceGallery.tsx` | **deleted** |
| Card | `src/results/MetricsPanel.tsx` | evidence moves in; deep link removed |

Two facts from that change are load-bearing here and must not be re-derived:

- **`toDrawOps` already exists and is already pure.** `src/results/skeletonGeometry.ts:121-164` maps a
  `RobustPoseFrame` to `PointDrawOp`/`EdgeDrawOp` with `DETECTED_OPACITY 1` /
  `INTERPOLATED_OPACITY 0.35` (`:41-43`) and an edge opacity of `Math.min` of its endpoints (`:159`).
  Unrecoverable points, and any edge touching one, are skipped entirely (`:129`, `:140-149`). That is
  the model to reuse. See D5 for why it cannot be reused verbatim.
- **The pure/impure split is a testability constraint, not a style preference.** jsdom's
  `HTMLCanvasElement.getContext('2d')` returns `null`, and this repo deliberately refuses the `canvas`
  npm package as a native-binary CI/sandbox risk — stated in `src/test/canvasTestUtils.ts:3-9` and
  again in `evidenceFrames.ts:30-34`. Geometry decided inside a draw call is geometry no unit test can
  reach.

---

## D1 — One sentence, two prohibitions. Only the first reverses.

`openspec/specs/results-view/spec.md:746-748` reads:

> A ghosted image SHALL be a photographic opacity blend only. The system SHALL NOT draw a skeleton,
> angle arc, reference line, or any other annotation over an extracted image, and SHALL NOT overlay
> any reference or ideal posture — the only delta shown is the runner against themself.

These are two independent claims that happen to share a sentence:

| Clause | Prohibits | Status |
|---|---|---|
| "SHALL NOT draw a skeleton, angle arc, reference line, or any other annotation" | drawing **the runner's own** detected and measured geometry | **REVERSED** — now required |
| "SHALL NOT overlay any reference or ideal posture" | drawing geometry **the runner did not produce** | **KEPT** |
| "the only delta shown is the runner against themself" | comparing the runner to a standard | **KEPT** |

They are separable because they answer different questions. The first is *"can the picture explain the
measurement?"* — the answer was no, and the cost of that no is measured (a bounce ghost on the
side-view clip reads as horizontal translation, because the image contains a large horizontal
displacement and a small vertical one and nothing says which one the metric is about). The second is
*"does the product claim to know correct form?"* — the answer is no and stays no, because this
application holds no reference-form data and synthesizing one would be inventing a clinical claim.

**The replacement requirement states the surviving prohibition in its own words rather than by
reference.** A REMOVE that deletes both halves and an ADD that restores only one would quietly change
what the product claims, and nothing in the archive step would catch it — the archive matches
requirement *titles*, and the title says nothing about posture. The new text is deliberately stronger
than the original: it names reference posture, ideal, target, model/template skeleton and
"correct-form" outline explicitly, and adds "SHALL NOT synthesize one in order to draw it", because
the failure mode is not someone importing reference data — it is someone drawing a plumb line and
calling it "upright".

---

## D2 — The honesty rule, and the per-metric table it comes from

**Rule: an annotation depicts what was measured at the depicted instant. It is never labelled with the
card's reported value unless the drawn quantity IS that value.**

This is not a stylistic preference about captions. Drawing measured geometry creates an implicature
that unannotated photography did not: a reader who sees an arc next to a card reading "17°" will read
the arc as 17°. Researched against the calculations, that reading is wrong for nearly every metric,
and wrong in a *different way* each time.

### The table

Verified per row. `pixel gap` means "a distance measurable with a ruler on the rendered image".

| Metric | What the card reports | What a still can actually show | Same quantity? |
|---|---|---|---|
| `verticalOscillation` | `fit.peakToPeakAmplitudePx / torsoLengthPx` (`verticalOscillation.ts:246`) | pixel gap between two midpoints, ÷ nothing | **No** — fit vs. sample, and a clip-median denominator |
| `verticalOscillationCm` | `winningFit.peakToPeakAmplitude * 100` over **integrated metre deltas** of one winning run (`verticalOscillationCm.ts:174-176`, `:374`, `:391-392`, `:402`) | a pixel gap | **No** — different unit, different series |
| `verticalRatio` | `fit.peakToPeakAmplitude / stride.strideLengthPx` (`verticalRatio.ts:270`) | one factor per image, across **two different exemplars** (`:332-335`) | **No** — the quotient is in neither image |
| `trunkLean` | `median(leanValues)` (`trunkLean.ts:189`) of `atan2(dx, -dy) × travelDirection` (`:170-173`) | the screen-relative tilt at one **extreme** instant | **No** — median vs. extreme, **and the sign flips** |
| `overstriding` | `median(overstrideRatios)` (`overstriding.ts:200`) of `horizontalOffsetPx / torsoLengthPx` (`:178`) | the signed pixel offset at one **extreme** instant | **No** — median vs. extreme, clip-median denominator |
| `cadence` | steps/min | — | **emits nothing**, by design |
| `kneeFlexion` | `median(flexionValues)` (`kneeFlexion.ts:258`) of `180 − jointAngleDeg` (`:198`) | the **interior** angle at one peak | **No** — supplement, and median vs. one peak |
| `armSwingSymmetry` | `min(L,R)/max(L,R)` of two per-side medians (`armSwingSymmetry.ts:264-271`) | one side's swing per image | **No** — the ratio is *between* the images |
| `footStrikePattern` | `horizontalOffsetPx / torsoLengthPx` (`footStrikePattern.ts:193`) | the signed pixel offset at one strike | **Partly** — numerator yes, denominator no |
| `stepWidth` | `(dx × outwardSign) / hipWidthPx` (`stepWidth.ts:224`), `hipWidthPx` a clip median (`bodyScale.ts:68`) | offset **and** a hip-to-hip segment | **Partly, deceptively** — see below |
| `stepWidthCm` | `(dx × outwardSign) / frame.pixelsPerMeter × 100` (`stepWidthCm.ts:248`) | the offset | **No** — a per-frame scale that is not visible |

### Corrections to the epic's research

- **[correction]** The epic and `strides-ac9.7` say `overstriding`, `footStrikePattern` and `stepWidth`
  "all divide by a CLIP-MEDIAN body scale (`bodyScale.ts:41`, `:68`)". Two different normalizers are
  being collapsed. `estimateBodyScale` (`bodyScale.ts:41`) returns **only** `torsoLengthPx`;
  `estimateHipWidth` (`bodyScale.ts:56-68`) is a **separate function** returning `hipWidthPx`, and
  `bodyScale.ts:46-55` insists they stay separate. `overstriding` and `footStrikePattern` divide by
  torso length; `stepWidth` divides by hip width.
- **This makes `stepWidth` the most dangerous row, not the safest.** `strides-ac9.7` notes correctly
  that "the `left_hip`→`right_hip` segment IS the normalizer and is drawable in-frame". It is drawable
  — but the segment in the picture is *that frame's* hip width, while the value divided by the
  **clip median**. A visible, plausible-looking denominator that is not the denominator used is worse
  than an invisible one, because it invites the reader to check the arithmetic and get a different
  answer. Draw it (it is genuine per-instant geometry); do not label the quotient.
- **[correction]** `armSwingSymmetry`'s value is at `armSwingSymmetry.ts:271`, not `:117`. Line 117 is
  the per-side series (`v: wrist.y - shoulder.y`) — which is, usefully, exactly the quantity the two
  vertical bars in that metric's mark set depict.
- **New finding, not in any ticket: `trunkLean`'s sign flips with the direction of travel.**
  `trunkLean.ts:171-173` — `forwardLeanDeg = travelDirectionKnown ? leanAngleDeg * travelDirection :
  leanAngleDeg`. On a right-to-left runner the on-screen tilt and the reported number carry **opposite
  signs**. An arc labelled with the card's value would therefore not merely be imprecise, it would
  point the wrong way. This is now a scenario in the honesty requirement.
- **New finding: the depicted bounce cycle is not even the biggest one.** `bounceInstants.ts:171-180`
  chooses the cycle minimising `Math.abs((maximum + minimum) / 2 - spanCenterSeconds)` — the
  best-supported cycle, not the largest excursion — and its instants are **continuous extrema of the
  fitted sinusoid** snapped to the nearest sampled frame (`:162`, `:183-186`). The exemplar carries no
  `value` at all and is scored on `detectionFactor` alone (`:200-206`, `:217`), precisely because "a
  fitted amplitude has no per-instance values". Nothing downstream can honestly turn that pair into a
  number.
- **`kneeFlexion`'s ghost carries no measurement.** `kneeFlexion.ts:104-108` scores the trough with the
  `value` field **absent**, so `scoreExemplarInstant` skips typicality entirely
  (`exemplars.ts:183-185`). `kneeFlexion.ts:74-77`: "The trough is not itself a measurement… A caption
  must not imply the trough was measured." The spec now states this as a general rule
  ("legibility-only instant"), not a `kneeFlexion` special case.

### What the rule permits

The rule bans **labelling**, not **drawing**. Every row above still gets its marks — the geometry is
real, it was formed at that instant, and showing it is the entire point of the change. What it does
not get is a number stamped on it. Where the drawn quantity happens to be exactly the reported one,
labelling is permitted; at authoring time **no metric qualifies**, and adding one requires naming the
identity in this document rather than asserting it in a component.

### Rejected alternative: label everything and add a hedging caveat

Rejected. The gallery's own live verification is the evidence: the caption on `armSwingSymmetry`'s
Demo 2 image insists "not two people" while the image contains a bystander. A sentence does not
un-say a picture. If the number cannot be shown, the honest move is not to show a number.

### Rejected alternative: only annotate metrics whose value is directly drawable

That set is empty (see table), so this reduces to shipping no annotation.

---

## D3 — Where annotation geometry is decided, and the transform

**Pure layer.** Every mark's position, orientation and extent is computed in the plan and asserted by
unit tests. The impure layer receives a list of draw ops and strokes them.

**In which coordinate space, precisely.** The plan stores positions in **native video pixels** — the
same space `crop` is in, and the space `resolvePoint` returns. It does **not** pre-bake output-canvas
coordinates, because the output side depends on `maxOutputSidePx`, a runtime extractor option no plan
can see (`extractFrames.ts`'s `EVIDENCE_OUTPUT_MAX_SIDE_PX` is a default the caller may override).
The conversion is itself pure and lives in the same module — `toEvidenceOutputSpace(point, crop,
outputSide)`, with `evidenceOutputSide(cropSide, maxOutputSidePx)` — so geometry and pixels are scaled
by one number by construction, and both are unit-testable with no canvas.

> **Revision (`strides-ac9.6` review).** This paragraph originally said marks are computed "in the
> **output image's** coordinate space", which the implementation does not do and should not. Left
> uncorrected it is a live trap for `ac9.7`: an implementer who takes `plan.base.keypoints` as
> already-canvas coordinates and strokes them directly would, on a 4K clip with `crop.side = 1200`
> capped to a 640 px canvas, draw a hip at native `x = 1900` onto a 640-wide canvas — every mark off
> the image, yielding a silently unannotated but otherwise correct-looking thumbnail that no existing
> test would catch. **Call `toEvidenceOutputSpace`; do not assume.**

**The transform, verified.** `extractFrames.ts:354-357` and `:327-337`:

```
outputSide = max(1, round(min(crop.side, maxOutputSidePx)))   // maxOutputSidePx = 640
s          = outputSide / crop.side
cx         = (kp.x - crop.x) * s
cy         = (kp.y - crop.y) * s
```

Two traps, both real:

- **`s` is not `640 / crop.side`.** The rounding is in the numerator only, and `computeCropRect`
  returns **float** sides, so `s ≠ 1` even when `crop.side ≤ 640`. A test fixture must include a
  fractional `crop.side`.
- **No forward point-mapping helper exists today.** The forward transform is implicit in the
  nine-argument `drawImage` at `extractFrames.ts:327-337`. The exact **inverse** already exists at
  `movenet.ts:86-95` (`toVideoSpaceKeypoints`: `cropRect.x + (k.x / targetInputSize) * cropRect.side`)
  — same algebra, opposite direction. Write the forward one next to the plan, not next to the draw.

**The `globalAlpha` trap.** `drawInstant` sets `ctx.globalAlpha = instant.opacity`
(`extractFrames.ts:326`) and `extractFrame` never resets it before returning (`:349-378`). Annotation
drawn on that context after a ghosted pair silently inherits `globalAlpha = 0.5`. Reset explicitly;
do not read the current value. This is now a spec scenario, because it is a defect that produces a
plausible-looking result rather than an error.

---

## D4 — What the plan must carry that it does not carry today

`EvidenceFramePlan` (`evidenceFrames.ts:139-154`) carries `{metric, kind, side?, quality, label, base,
ghost, crop, demotedFromPair}`. It carries **no positions**: `cropKeypoints` is consumed inside
`planExemplarFrames` (`:404-429`) and dropped. `MetricExemplar` (`types.ts:97-128`) carries names
only, and neither `travelDirection` nor `outwardSign`. `ClipEvidenceInput`
(`extractFrames.ts:121-124`) is `{sourceBlob, plan}` — `robustFrames` never reaches the extractor.

**Decision: resolve in `planExemplarFrames`.** It already holds both `RobustPoseFrame`s at `:401-410`
and already derives crop rects from them; resolving positions there keeps everything in the pure,
unit-testable half. The two alternatives are rejected:

- *Carry `cropKeypoints` forward and re-resolve at draw time* — puts resolution in the impure layer,
  which is the thing D3 exists to prevent.
- *Add `frames` to `ClipEvidenceInput`* — same objection, plus it widens a boundary that is currently
  narrow on purpose.

**Resolution is exact, not approximate.** `base.timestamp`/`ghost.timestamp` are the **sampled
frame's own** timestamp (`evidenceFrames.ts:438-445`), so `findNearestFrame` returns that same frame
object. There is no interpolation and no second snapping step.

**Preserve the three-state status.** `resolvePoint` (`keypoints.ts:23-30`) treats `'detected'` **and**
`'interpolated'` as resolvable; only `'unrecoverable'` is null. The plan must carry which of the two
it was — collapsing to "resolvable" would erase exactly the distinction the thumbnails should show.

**The sign.** `travelDirection` signs `overstriding.ts:177`, `footStrikePattern.ts:192`,
`trunkLean.ts:171` and `strideLength.ts:182`; `outwardSign` signs `stepWidth.ts:222-224` and
`stepWidthCm.ts:246-248`. Two properties matter:

- `outwardSign = Math.sign(sideHip.x - hipMid.x) || 1` is **per-frame**, not clip-wide
  (`stepWidth.ts:153`, `:222-223`), and its `|| 1` fallback is recorded as `degenerate` and hard-rejects
  that exemplar (`:230`). The plan can recompute it per drawn frame from positions it already has.
- `travelDirection` is **clip-wide** and comes from `estimateTravelDirection(frames, bodyScale)`
  (`travelDirection.ts:16-19`) — note it needs a body scale, so the plan must also call
  `estimateBodyScale`. Metrics compute it over the **presence-trimmed** frames while the plan holds
  the **untrimmed** array, so a naive plan-side recomputation can disagree with the metric's. The
  plan therefore trims first, reproducing exactly what `runClipAnalysisPipeline.ts:59-60` hands
  `computeFormHeuristics`, so the two signs agree **by construction** rather than by argument.

  > **Revision (`strides-ac9.6`).** This paragraph originally accepted the disagreement as
  > unreachable, reasoning that it "requires the trimmed and untrimmed hip-x displacements to differ
  > in sign — possible only on a clip where net displacement is near the indeterminate threshold,
  > which is exactly the clip where `estimateTravelDirection` returns `0`". **That reasoning was
  > wrong, and the implementation disproved it.** The two readings do not share endpoints:
  > `estimateTravelDirection` uses the first and last frame where **hip-mid** resolves, while
  > `trimToPresenceWindow` additionally requires **shoulder-mid** plus a run of ≥3 consecutive
  > present frames. A frame with resolvable hips but no shoulders — a bystander, or the subject with
  > an occluded torso — therefore sits *outside* the presence window yet still supplies an endpoint
  > to the untrimmed reading. Parked at the far edge it reverses the sign with **both** readings far
  > clear of the half-torso threshold and neither returning `0`. Constructed and pinned by test in
  > `evidenceFrames.test.ts` ("matches the metrics by using their presence-trimmed frames, on a clip
  > where the untrimmed array disagrees outright"): naive untrimmed `-1`, metric-side `+1`. The risk
  > is removed rather than accepted.

---

## D5 — Reuse the `DrawOp` model; do not reuse `toDrawOps`

`toDrawOps` cannot be called as-is. Three concrete reasons, all verified:

1. **Coordinates are video-native with no transform hook** (`skeletonGeometry.ts:130`, `:155-158`).
2. **It emits all 22 `SKELETON_EDGES`** (`:8-38`), not the exemplar's own keypoint subset. A
   `kneeFlexion` crop would receive a whole skeleton, nearly all of it outside the crop.
3. **There is no frame-level opacity multiplier.** A ghosted pair needs the base skeleton at 1.0 and
   the ghost's at `EVIDENCE_GHOST_OPACITY 0.5` (`evidenceFrames.ts:82`), composed with each point's own
   detected/interpolated opacity.

What to reuse: the `PointDrawOp`/`EdgeDrawOp` shape, `DETECTED_OPACITY`/`INTERPOLATED_OPACITY`, the
`Math.min` edge rule, and the skip-unrecoverable-entirely rule. **Do not write a second skeleton
renderer.** Note also that `SkeletonOverlay` the *component* is coupled to a live `<video>` and its
media events and cannot render against a static image — the reusable half is the geometry, not the
component.

**Sizing.** `SkeletonOverlay`'s constants (`SKELETON_COLOR '#22d3ee'`, `POINT_RADIUS_PX 6`,
`STROKE_WIDTH_PX 3`) were sized for a full-frame video overlay. They are **not** the thumbnail's
constants. Stroke weights and mark radii must be expressed against the output canvas side and
verified by looking at the result, not by reasoning about it.

**The joint layer and the measurement layer must be visually separable.** A reader has to be able to
tell "these are the joints the pipeline found" from "this is the thing that was measured". Two layers
in one colour is one layer.

---

## D6 — The breakpoint is a container query, not a media query

`MetricsPanel.tsx:288` is `<div className="@container grid gap-4 @lg:grid-cols-2 @3xl:grid-cols-3">`
— the only container-query usage in the application. A card is therefore 1, 2 or 3 across depending
on the width available to the panel.

That makes the naive rule wrong in a way that is easy to miss in review: **a card on a 27-inch display
at three-column density is a narrow card.** A `md:` viewport rule would put the thumbnail beside the
description in a card with no room for it, and it would look correct on the reviewer's laptop at
two-column density. The rule must key on the card's own width.

Card anatomy today, in DOM order (`MetricsPanel.tsx:158-197`): tier-styled `<article>` (`:163-169`),
title (`:170-172`), value (`:173-175`), **description (`:176-178`) — evidence goes after this**,
confidence label (`:179-181`), optional caveat (`:182-193`), chart slot (`:194`).

The chart slot currently carries `VerticalOscillationChart` and/or `EvidenceDeepLink` via `cardSlot`
(`:130-138`), whose `undefined` branch is what keeps a card without evidence rendering exactly the DOM
it rendered before. That branch is the mechanism behind the "no placeholder, no layout shift"
guarantee and must survive the deep link's removal.

---

## D7 — Thumbnails are a display decision, not a second extraction

Today's figures are `w-56` (14rem) in a wrapping flex list (`EvidenceGallery.tsx:359-364`). Inline
thumbnails are meaningfully smaller. Two rules:

- **Do not re-extract.** The output is capped at `EVIDENCE_OUTPUT_MAX_SIDE_PX = 640`
  (`extractFrames.ts:64`) and every crop shares one aspect ratio by spec, so display sizing is CSS.
- **Do not serialize.** The canvas element is adopted into the DOM via `host.replaceChildren(canvas)`
  (`EvidenceGallery.tsx:296-316`); `toDataURL`/`toBlob` are deliberately absent (`:283-287`). Whatever
  component renders a thumbnail must adopt the node the same way.

---

## D8 — Which capabilities need a delta

**`results-view` only.** Reasoning, so a reviewer can check it rather than take it:

- **`form-heuristics`** — **the flagged condition fired; it now has a delta.** The original reasoning
  held for positions and signs, which D4 resolves in the *plan*: `strides-ac9.6` took seam (a) as
  preferred and needed nothing on `MetricExemplar`. It did **not** hold for the per-instant SIDE,
  which `strides-ac9.7` found missing and `strides-ac9.9` fixed. Unlike a position or a sign, that
  fact is not recomputable from a `RobustPoseFrame`: which ankle a footstrike metric measured is a
  choice the metric made, and the only trace of it left in the exemplar is the order of
  `cropKeypoints` — which is a private detail of two modules, not a contract, and reading it was
  refused. So the side had to ride on `MetricExemplar` (`measuredSide`/`pairedMeasuredSide`), and per
  this bullet's own rule the requirement at `form-heuristics/spec.md:1256-1262` — *"Metrics emit
  exemplar instants as timestamps, never frame indices"* — is MODIFIED in the same pass rather than
  leaving a downstream reader to find a field the spec does not describe. Flagged, not assumed away,
  and then honoured. See D12.2's resolution block.
- **`multi-clip-analysis`** — untouched. Its binding sentence is "When more than one clip is present,
  the interface SHALL indicate which clip a metric's evidence came from"
  (`multi-clip-analysis/spec.md:176`), and its scenario at `:179-183` says "the interface indicates
  which clip the evidence came from". Both are surface-agnostic: a per-card provenance line satisfies
  them exactly as the gallery's per-section line did. The rule at `:198-203` — a diverged second pass
  drops its exemplars entirely — is likewise unaffected, and is the one place where "no imagery" is
  already required for a reason that has nothing to do with layout.
- **`analysis-diagnostics`** — untouched, and must stay so. `results-view/spec.md:795-803` keeps
  exemplar data out of the diagnostics payload; annotation adds positions, which is *more* tempting to
  log and equally forbidden.

---

## D9 — What this change deliberately does not fix

Three known defects interact with annotation. All are recorded here so a reviewer can see they were
considered rather than missed.

- **GitHub #69 — the evidence seek lands +2 frames late on every MP4.** Ground-truthed by ffmpeg/PSNR
  argmax: 0.0800 s on Demo 1 (25 fps), 0.033367 s on Demo 2 (59.94 fps), 0.033333 s on the 60 fps
  multiperson clip; **exactly 0** under `{ sequentialSampling: { enabled: false } }`, so it is isolated
  to the WebCodecs timestamp domain, not to seeking. Today this is invisible — an unannotated
  photograph two frames late is still a photograph. **Annotation makes it visible**: joints drawn from
  the sampled frame's keypoints onto an image two frames later will float off the body, and 80 ms is
  ~12% of a step cycle. `strides-ac9.4` owns it, sequenced after the annotation lands so there is
  something to measure. `DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS` (`extractFrames.ts:80`) must **not** be
  set to a constant: #69 establishes the correct value is per-clip *and* per-sampler, and must be
  exactly 0 for every WebM/webcam clip and every MP4 where `canUseSequentialDecode` says no.
- **GitHub #71 — bad crops.** `trunkLean` on the multiperson clip unions two extremes 1.25 s apart and
  hits the `min(frameWidth, frameHeight)` cap (side 1080 on a 1920×1080 clip); `armSwingSymmetry` on
  Demo 2 has the `EVIDENCE_CROP_MIN_SIDE_PX = 320` floor inflate a small limb box until it swallows a
  bystander. Annotation **partly subsumes** this: drawn joints show immediately which body was
  measured, which is what the bystander case actually needed. It does not fix the far-apart-pair crop.
  Not in scope, and **the 320 floor must not simply be moved** — it came from display reasoning, and
  the fact that thumbnails are smaller than gallery figures makes that rationale stale rather than
  makes 320 wrong. Re-deriving it needs its own measurement.
- **GitHub #70 — `overstriding` emits on no measured clip.** `maxDevMads = 1.389` on the multiperson
  clip against a `1.5·MAD` requirement, so it is unreachable at any `detectionFactor`. That card gets
  no thumbnail regardless of anything in this change. Not in scope.

---

## D10 — Delta mechanics: why each requirement is treated the way it is

CLAUDE.md is emphatic that MODIFIED/REMOVED blocks must reuse the **exact** existing title text,
because the archive matches by name and silently drops what it cannot match. Every title below was
copied from `openspec/specs/results-view/spec.md`, not retyped.

| Existing requirement | Treatment | Why |
|---|---|---|
| "Evidence frames are planned purely, then extracted from a detached video element" (L648) | **MODIFIED** | Nothing reverses. The purity rule gains annotation geometry; the plan gains annotation inputs; one dangling word ("gallery") is re-pointed. All six existing scenarios are reproduced verbatim and three are added. |
| "An evidence gallery renders below the results, grouped by metric" (L735) | **REMOVE + ADD** | Full reversal. Its scenario "A ghosted image shows one runner at two instants" asserts "with no drawn annotation of any kind" — a MODIFIED block cannot drop a scenario, and cannot keep this one. |
| "Metric cards deep-link to their evidence, and are otherwise unchanged" (L770) | **REMOVE + ADD** | The first half is meaningless once the imagery is in the card. The second half is fully preserved in the ADD, quoted in the Migration so the carry-over is checkable. |
| "Evidence never enters the analysis diagnostics payload" (L795) | untouched | Still binding, unchanged. |

The three new requirements are ADDED under fresh names:

- "Evidence renders as annotated thumbnails inside the metric card"
- "Evidence thumbnails annotate the runner's own measured geometry and never a reference posture"
- "An annotation depicts what was measured at the depicted instant, never the card's reported value"
- "A metric card without evidence is unchanged, and an excluded metric gets none"

The reference-posture prohibition is carried by the second of these, in its own words, and the
Migration note on the removed gallery requirement says so explicitly — so a reader diffing the
archive can see the clause did not lapse.

---

## D11 — Pre-registered decision rules

Registered before implementation so the outcome cannot be adjudicated after the fact.

1. **Legibility.** `strides-ac9.5` pulls every rendered thumbnail out of the DOM and looks at it, at
   the real inline display size, on all three clips. **Rule:** a metric whose measurement marks are
   unreadable, or indistinguishable from the joint layer, on **2 or more of the 3 clips** ships
   **joints-only** for that metric rather than shipping an illegible mark. Illegible annotation is
   worse than none: it adds visual noise to an image whose whole job is clarity.
2. **Misregistration (#69 gate, `strides-ac9.4`).** Measure the displacement between drawn joints and
   the visible body **in pixels of the drawn crop**, not in frames. **Rule:** if the median
   displacement of the drawn joints exceeds **5% of the output canvas side** on either demo clip, #69
   is fixed before this epic ships. 5% of a 640 px output is 32 px — at a ~200 px display that is ~10
   CSS px of visible float, which reads as "the skeleton is wrong" rather than "the skeleton is
   approximate". The threshold is a judgment call and is labelled as one; what is not negotiable is
   that it is decided from a measurement rather than from a look.
3. **Labelling.** No mark ships with a numeric label at all. The exception list is empty at authoring
   time; adding a metric to it requires stating the identity between the drawn quantity and the
   reported value **in this document**, with the `file:line` of both sides.
4. **No number moves.** `strides-ac9.5` re-measures the track-clip anchor: `verticalOscillationCm`
   **4.4215 cm**, `fit.frequencyHz × 60` = **91.2** equal to `cadence.value` **91.2**. Any change to
   either fails the epic, because this change touches nothing upstream of presentation.
5. **Contract integrity.** `[analysis-diagnostics]` must remain free of exemplar, position, canvas and
   blob data; `[evidence-coverage]` must remain free of anything image-shaped; a `vite build` must
   contain zero occurrences of any dev-only console prefix. Annotation adds coordinates, which are
   cheap to log and equally forbidden.

---

## D12 — Decisions taken while building the annotation-geometry layer (`strides-ac9.7`)

Four calls the earlier sections left open or got wrong. All four are implemented in
`src/results/evidenceAnnotations.ts` and pinned by `evidenceAnnotations.test.ts`.

### D12.1 — Grafted metrics get no signed or oriented mark. **Option (a).**

`stepWidthCm` and `verticalOscillationCm` arrive by graft from the background MediaPipe scale
pass, which carries its exemplars' timestamps but not its `RobustPoseFrame[]` — `scalePassGraft.ts`
records that "the only frames any consumer holds are the primary pass's", and `EvidenceGallery`
duly hands `planClipEvidence` `clip.analysis.robustFrames` (MoveNet). Both metrics' joint positions
**and** their hip polarity are therefore resolved off a primary-pass frame snapped to the grafted
timestamp — never the frame that measured them.

Positions survive that: they are the primary detector's own estimate of the same body at the same
instant, and they land on the image the extractor draws. A **polarity** does not. At a near-frontal
step-width strike the two hips sit a few pixels apart, which is exactly where two detectors' orderings
become a coin flip; a caliper carrying the inverse polarity would label a crossover strike as landing
on its own side, contradicting `stepWidth.ts:273-277`'s crossover caveat in the same viewport.

- **(c) accept it** has no argument available. The mechanism is confirmed, not hypothetical, and it
  lands precisely where the metric lives rather than in a tail case.
- **(b) joints only** overpays. It would strip `verticalOscillationCm` — the one grafted metric
  measured as reaching the gallery on all three test clips — of marks that carry no polarity at all.

So: `GRAFTED_METRICS` suppresses polarity, not geometry. `stepWidthCm`'s caliper still draws, as the
unsigned lateral span it honestly is; `verticalOscillationCm` is bit-identical to
`verticalOscillation` on the same exemplar. `resolveOutwardSigns`' doc comment, which claimed to be
`stepWidth.ts:222-223` "verbatim, not an approximation", now names this exception — true for the
primary pass, false for these two.

**Not fixed here**: the clean fix is for a grafted exemplar to carry its own pass's frames, or for
the graft to be dropped when no primary frame corroborates it. Both are `scalePassGraft.ts`'s
business, not this layer's.

### D12.2 — No caliper where the exemplar records no per-instant side.

`overstriding` (`:99-101`) and `stepWidth` (`:91-93`) both omit `side` when their two instants are
different feet — the usual case for both. `EvidenceInstantPlan` records no per-instant side either,
so **which ankle this instant's strike was is not derivable from the plan**. The exemplar's
`cropKeypoints` happens to order the base's ankle before the ghost's, but that is a private detail
of two metric modules, and reading it would make "which foot was measured" a silent function of an
array order nobody is testing. A caliper drawn to the other foot is a measurement that was never
taken, which is the same class of error as a guessed sign.

Those pairs therefore ship the per-instant truths only — the hip midline (per frame, so a pair
carries two), the hip-width segment, and the joints — and no caliper. Singles and demoted pairs,
which do carry a `side`, get the full mark set.

**The fix, if the caliper turns out to matter**: a per-instant `side` on `EvidenceInstantPlan`,
resolved in `planExemplarFrames` from the exemplar the same way its positions already are. That is a
widening of `strides-ac9.6`'s seam, not a new one.

> **Resolution (`strides-ac9.9`).** It mattered — the pair is the *common* case for both metrics, so
> this deviation cost the majority path, not an edge. The fix landed as described above, with one
> addition the paragraph above did not anticipate: **the side is not derivable from the exemplar as
> it stood**, so resolving it in the plan was not sufficient on its own. `MetricExemplar` gained
> `measuredSide`/`pairedMeasuredSide` — the per-instant fact, stated by the two metrics that took the
> measurement — and `resolveInstantSide` reads those, falling back to the pair-level `side` whose own
> contract already covers both instants (which is why the four same-side metrics needed no change).
> `EvidenceInstantPlan.side` is `'left' | 'right' | null`, a required key, so an instant with no
> stated side is an explicit absence rather than a missing property that could read as a default.
> The `cropKeypoints`-ordering inference stayed refused, and is now pinned by a test that gives the
> crop set the *opposite* leading ankle and asserts the stated side still wins.
>
> This fired **D8's single named condition**: the side rides on `MetricExemplar`, so
> `form-heuristics`' "Metrics emit exemplar instants as timestamps, never frame indices" requirement
> is MODIFIED in the same pass rather than silently widened.
>
> One thing the fix does **not** buy, recorded so it is not re-derived: `overstriding` still emits no
> mixed-foot exemplar on any constructible fixture. Its most/least strikes sit either side of a
> near-zero median on an alternating-foot clip, which puts them under the 1.5-MAD typicality ramp,
> and any spread wide enough to clear the ramp trips `isOutlier`'s 3-MAD reject instead — both scale
> off the same MAD. That is the same squeeze CLAUDE.md records for `overstriding` on all three real
> clips. The mixed-foot path is therefore asserted at the plan layer, where it is reachable, and the
> metric layer asserts only the emission.

### D12.3 — `footStrikePattern` draws no midfoot band.

`strides-ac9.7`'s description asks for "the ±0.05·torso midfoot band as guide lines". Dropped, on the
requirement this change itself adds: *"Every mark SHALL be derived from **this runner's own keypoints
in the depicted frames**"*, and the system *"SHALL NOT overlay a reference posture, an ideal, a
target, … or any other geometry the runner did not produce."*

The band fails both halves. Its half-width is `midfootBandRatio × torsoLengthPx`, and `torsoLengthPx`
is the clip-median body scale (`bodyScale.ts:41`) — a length that exists in no depicted frame, which
is the same undrawable denominator D2 already refuses to label. And a ±5% band around the knee's
vertical reads as a target zone: "land inside here" is a claim about correct form, which is the
claim D1's surviving prohibition exists to prevent. That it is the classifier's own decision boundary
is exactly why it looks authoritative.

What is drawn instead is the honest numerator: the shank, the plumb at the knee, and the horizontal
caliper `ankle.x − knee.x` (`footStrikePattern.ts:191-193`). Still no shank-versus-vertical arc — the
metric forms a horizontal offset, not an angle.

### D12.4 — Which instants were measured, as data.

The spec requires that "an instant carried purely for legibility … SHALL NOT be captioned as
measured", and the caption layer cannot see that from the geometry. `EvidenceAnnotation` therefore
carries `valueMeasuredAtInstant` per instant, sourced from the metric modules rather than from what
looks measured:

| kind | base | ghost | source |
|---|---|---|---|
| `bounceCycle` | **false** | **false** | the exemplar carries no `value` on either instant, "precisely because a fitted amplitude has no per-instance values" (`bounceInstants.ts:193-200`) |
| `kneeFlexionPeak` | true | **false** | the trough is scored with `value` absent (`kneeFlexion.ts:104-108`) and is documented as not a measurement (`:74-77`) |
| every other kind | true | true | both instants carry their own measured value |

`kneeFlexion`'s ghost is also denied the angle arc — an arc is the strongest "this was measured here"
mark in the vocabulary, and no angle was taken at the trough. It keeps the thigh and shank, which is
what makes the bent knee readable against a straight one.

The `kneeFlexionPeak` arc that *is* drawn spans the **interior** angle at the knee, and carries
`reportedValueIsSupplement: true` — `kneeFlexion.ts:198` reports `180 − interiorAngle`. That is D11
rule 3's supplement relationship expressed as a field a test can assert rather than a comment a
reviewer has to notice.

---

## Open questions

- ~~**Does the joint layer draw edges, or only points?**~~ **Answered in `strides-ac9.7`: both, with
  the bias this question already carried.** An edge draws only when the exemplar named **both**
  endpoints and both resolved — which is the D5 subset rule, and it keeps every edge inside the crop
  by construction, since the crop is derived from those same keypoints. One addition the question did
  not anticipate: an edge is **skipped entirely when the measurement layer already drew that exact
  segment** (`kneeFlexion`'s thigh and shank, `armSwingSymmetry`'s upper arm and forearm,
  `stepWidth`'s hip-to-hip). The same segment stroked twice in two styles is one muddy layer, not the
  two separable ones D5 requires.
- **Does a caption change per metric, or does the existing `plan.label` carry it?** `captionFor`
  (`EvidenceGallery.tsx:254-270`) already builds from `plan.label`, which is the metric's own words.
  The honesty rule constrains what a caption may *not* say; it does not require new copy. Assume the
  existing labels until a live read says otherwise.
