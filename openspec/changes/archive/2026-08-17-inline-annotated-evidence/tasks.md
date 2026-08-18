# Tasks

Sections 1–7 map one-to-one onto the sibling tickets of epic `strides-ac9`, in the order that epic's
dependency graph allows. Section 0 is this ticket (`strides-ac9.1`).

Parallelism: §1 and §4 start together once §0 lands. §2 needs §1. §3 needs §2. §5 needs §4. §6 needs
§3. §7 needs §3, §5 and §6.

**§5 lands after §4, never before** — retiring the gallery first would produce a build with no
evidence surface at all.

## 0. The openspec change (`strides-ac9.1` — this ticket)

- [x] 0.1 Scaffold `openspec new change inline-annotated-evidence`.
- [x] 0.2 `proposal.md` — Why (both costs of the shipped gallery: wrong place, withheld annotation),
  What Changes, the locked-decision table, and an Out of Scope that names the reference-posture ban,
  export, the crop constants, #69 and #70.
- [x] 0.3 `design.md` D1 — the two prohibitions inside `results-view` L746, which one reverses, and
  why the surviving one is restated in the new requirement's own words rather than by reference.
- [x] 0.4 `design.md` D2 — the per-metric drawn-versus-reported table, every row verified against
  source with `file:line`, plus the corrections it turned up (`stepWidth` normalizes by hip width not
  torso; `armSwingSymmetry`'s value is at `:271`; `trunkLean`'s sign flips with travel direction; the
  depicted bounce cycle is the best-supported one, not the largest).
- [x] 0.5 `design.md` D3/D4/D5 — the coordinate transform and its two traps, the `globalAlpha` leak,
  the plan-carries-annotation-inputs decision with its two rejected seams, and the three reasons
  `toDrawOps` cannot be reused verbatim.
- [x] 0.6 `design.md` D6/D7 — the container-query breakpoint and why a viewport rule passes review on a
  laptop and fails on a wide screen; thumbnails as a display decision.
- [x] 0.7 `design.md` D8 — which capabilities need a delta, with the single condition that would pull
  `form-heuristics` in.
- [x] 0.8 `design.md` D9 — #69, #70, #71: what annotation makes visible, what it subsumes, what must
  not be "fixed" by picking a constant.
- [x] 0.9 `design.md` D10/D11 — delta mechanics per requirement, and the pre-registered decision rules.
- [x] 0.10 Spec delta for `results-view`: one MODIFIED, two REMOVED with Reason/Migration, four ADDED.
- [x] 0.11 `openspec validate inline-annotated-evidence --strict` passes.
- [x] 0.12 Zero files under `src/` changed by this ticket.
- [ ] 0.13 **Not archived here.** Archiving happens after §7's live verification.

## 1. Thread keypoints and measurement sign into the evidence plan (`strides-ac9.6`)

- [ ] 1.1 Widen `EvidenceFramePlan` (`evidenceFrames.ts:139-154`) so each drawn instant carries the
  resolved position of every keypoint its mark set names, each tagged `'detected'` /
  `'interpolated'` / `'unrecoverable'`. Resolve in `planExemplarFrames`, which already holds both
  `RobustPoseFrame`s at `:401-410` (design D4 — seams (b) and (c) are rejected there).
- [ ] 1.2 Preserve the three-state distinction. `resolvePoint` (`keypoints.ts:23-30`) treats
  `'detected'` and `'interpolated'` alike; collapsing them here would erase what the thumbnails are
  supposed to show.
- [ ] 1.3 Make the orientation sign reachable: `outwardSign` per drawn frame
  (`Math.sign(sideHip.x - hipMid.x) || 1`, `stepWidth.ts:222-223`), and clip-wide `travelDirection`
  via `estimateTravelDirection(frames, estimateBodyScale(frames))` (`travelDirection.ts:16-19`).
- [ ] 1.4 Record the trimmed-versus-untrimmed `travelDirection` subtlety in a code comment pointing at
  design D4 — the plan holds untrimmed frames, the metrics compute over trimmed ones.
- [ ] 1.5 Keep it canvas-free and DOM-free. jsdom has no canvas.
- [ ] 1.6 Extend `evidenceFrames.test.ts` for the new plan shape, including an exemplar with an
  unrecoverable keypoint and one with an indeterminate travel direction.
- [ ] 1.7 If, and only if, a sign or position has to ride on `MetricExemplar` instead, add the
  `form-heuristics` MODIFIED delta this change deliberately omits (design D8).
- [ ] 1.8 `npm test` and `tsc -b` clean.

## 2. Build the pure per-metric annotation-geometry layer (`strides-ac9.7`)

- [x] 2.1 New pure module: `EvidenceFramePlan` → annotation draw ops in **output-canvas** coordinates.
  Zero canvas, zero DOM references. — `src/results/evidenceAnnotations.ts`, with the same
  comment-stripped `module hygiene` scan `evidenceFrames.test.ts` uses.
- [x] 2.2 Implement the forward transform `s = max(1, round(min(crop.side, 640))) / crop.side`,
  `c = (kp - crop.origin) * s`. The exact inverse already exists at `movenet.ts:86-95`; do not
  re-derive it from scratch. — reuses `evidenceFrames.ts`'s existing `evidenceOutputSide` /
  `toEvidenceOutputSpace`, called from exactly one place (`MarkBuilder.toCanvas`), asserted by
  hygiene test so no caller can bypass it.
- [x] 2.3 Unit-test the transform with a **fractional** `crop.side`, so `s ≠ 1` is exercised (design
  D3 — `s` is not `640 / crop.side`). — two cases, a fractional side under the cap (321.7 → 322) and
  one above it (1200.5 → 640), plus an explicit assertion against the naive `640 / crop.side`.
- [x] 2.4 Joint layer: reuse the `skeletonGeometry.ts` `DrawOp` model, `DETECTED_OPACITY` /
  `INTERPOLATED_OPACITY`, the `Math.min` edge rule, and skip-unrecoverable-entirely. Compose each
  point's own opacity with a per-frame base/ghost multiplier (base 1.0, ghost
  `EVIDENCE_GHOST_OPACITY` 0.5). Do not write a second skeleton renderer.
- [x] 2.5 Draw only the exemplar's own keypoints, never all 22 `SKELETON_EDGES`. — and never an edge
  the measurement layer already drew as a named segment (design D12.4's neighbour, recorded under
  "Open questions").
- [x] 2.6 Per-metric mark sets, per the epic's table: `trunkLean` torso vector + vertical ray + arc at
  hip-mid; `kneeFlexion` hip→knee→ankle chain + extended reference ray + arc at the knee;
  `overstriding` plumb at `hipMid.x` + horizontal caliper to the ankle; `footStrikePattern` shank +
  plumb at the knee + horizontal caliper, one instant, **no shank-versus-vertical arc**;
  `stepWidth`/`stepWidthCm` per-frame midline at `hipMidX` (two midlines
  for a pair, not one) + caliper; `armSwingSymmetry` shoulder→elbow→wrist + a horizontal through each
  shoulder + two vertical bars for `wrist.y − shoulder.y`; `bounceCycle` midpoint marker + horizontal
  at each instant's midpoint-y; `verticalRatio` `stridePair` hip-mid marker + vertical tick at each
  hip-mid x + horizontal caliper between ticks. — **two deviations, both recorded in design D12**:
  no ±0.05·torso midfoot band (D12.3 — it is sized by a clip-median denominator and reads as a target
  zone), and — at the time of writing — no caliper on an `overstrideRange`/`stepWidthStrike` pair,
  whose per-instant side the plan did not record (D12.2). **The second deviation is closed**
  (`strides-ac9.9`): the two metrics now state the side each instant was measured on,
  `EvidenceInstantPlan.side` resolves it, and both pair kinds emit their `ankleOffsetCaliper` —
  each half anchored on its own ankle. D12.3 stands.
- [x] 2.7 `kneeFlexion`: handle the supplement relationship explicitly — the drawn arc is the interior
  angle, the card reports `180 − interiorAngle` (`kneeFlexion.ts:198`). — carried as
  `EvidenceArcOp.reportedValueIsSupplement`, a field a test asserts rather than a comment.
- [x] 2.8 **No mark carries a numeric label** (design D2 and D11 rule 3). A metric with no honestly
  drawable measurement gets joints only. — enforced in the type (no op has a label field) and by an
  allowlist test over every op key across all eight exemplar kinds.
- [x] 2.9 `cadence` produces nothing here either — a third guard is not required, but the module must
  not be reachable for it.
- [x] 2.10 `npm test` and `tsc -b` clean. — 78 files / 1118 tests (from 77 / 1083), `tsc -b` and
  `npx eslint .` clean.

## 3. Draw the annotation layer onto the evidence canvas (`strides-ac9.8`)

- [ ] 3.1 Draw annotation in `extractFrame` (`extractFrames.ts:349-378`), after both photographic
  layers.
- [ ] 3.2 **Reset `ctx.globalAlpha` explicitly before annotating.** `drawInstant` sets it at `:326` and
  nothing resets it, so annotation after a ghosted pair silently inherits 0.5 (design D3).
- [ ] 3.3 Size strokes, point radii and any text against the **output canvas side**, not against
  `SkeletonOverlay`'s full-frame constants.
- [ ] 3.4 Make the joint layer and the measurement layer visually distinguishable from each other.
- [ ] 3.5 Interpolated keypoints visibly weaker than detected ones; unrecoverable ones absent.
- [ ] 3.6 No `toDataURL`, no `toBlob`, no download path, no object URL for a thumbnail. One detached
  decoder at a time; object URL owned and revoked (`extractFrames.ts:443-486`).
- [ ] 3.7 `npm test` and `tsc -b` clean.

## 4. Embed evidence inline in the metric card (`strides-ac9.2`)

- [x] 4.1 Render evidence inside `MetricCard` (`MetricsPanel.tsx:158-197`), after the description
  (`:176-178`).
- [x] 4.2 Below the description when the **card** is narrow, beside it when the **card** is wide —
  a per-card container query, never `md:` (design D6; the grid at `:288` is already `@container`).
- [x] 4.3 Verify at 1-, 2- and 3-column card-grid densities.
- [x] 4.4 Thumbnail sizing in CSS only; no re-extraction at a second resolution.
- [x] 4.5 A card with no evidence renders exactly as today: no placeholder, no empty frame, no layout
  shift. Preserve `cardSlot`'s `undefined` branch (`:130-138`) as the mechanism.
- [x] 4.6 Canvas element adopted into the DOM via `replaceChildren`, as the gallery did
  (`EvidenceGallery.tsx:296-316`).
- [x] 4.7 Caption and alt text still identify the metric, the side where per-side, and that a ghosted
  pair is one runner at two instants — and, on a multi-clip session, which clip the evidence came
  from (`multi-clip-analysis/spec.md:176`).
- [x] 4.8 `npm test` and `tsc -b` clean.

## 5. Retire the standalone evidence gallery and its deep-link channel (`strides-ac9.3`)

- [ ] 5.1 Delete `src/results/EvidenceGallery.tsx` and its test.
- [ ] 5.2 Unwind the reporting channel: `onEvidenceMetricsChange` (`EvidenceGallery.tsx:441-449`) →
  `MultiClipVideoSession.tsx:230` → `reportedEvidenceMetrics` (`:82-83`) → `ResultsView` →
  `MetricsPanel`. Remove it; do not leave it wired to nothing.
- [ ] 5.3 Delete `EvidenceDeepLink` (`MetricsPanel.tsx:110-122`) and `EVIDENCE_SECTION_ID_PREFIX`
  (`EvidenceGallery.tsx:27`).
- [ ] 5.4 Remove the `lg:col-span-2` third grid child and the "What the analysis looked at" heading
  (`MultiClipVideoSession.tsx:226-232`).
- [ ] 5.5 **Keep the extraction engine.** `evidenceFrames.ts` and `extractFrames.ts` stay, as do the
  per-clip cache keyed by `clipId`, the run-id guard, and the sequential one-decoder-at-a-time
  discipline. Whoever owns extraction afterwards preserves: at most one detached decoder open, object
  URL owned and revoked, release on unmount and session reset.
- [ ] 5.6 No dead exports (`npx eslint .` clean).
- [ ] 5.7 `npm test` and `tsc -b` clean.

## 6. Assess annotation misregistration from the 2-frame seek offset (`strides-ac9.4`, GitHub #69)

- [ ] 6.1 Quantify misregistration **in pixels of the drawn crop** on Demo 1 and Demo 2, with
  annotation drawn.
- [ ] 6.2 Adjudicate against the pre-registered rule (design D11 rule 2): median drawn-joint
  displacement > 5% of the output canvas side on either demo clip ⇒ fix #69 before shipping.
- [ ] 6.3 If fixing: correct on WebCodecs MP4s **and exactly 0** on WebM/webcam clips and
  non-sequential-decode MP4s. #69's two candidates are a per-clip offset from `containerTiming.ts`'s
  existing `elst` parser, or aligning the domains at the demuxer.
- [ ] 6.4 Do not introduce a single global constant as the fix.
- [ ] 6.5 Record the decision and the measurement behind it in this `design.md`.
- [ ] 6.6 Update GitHub #69 with the outcome; do not close it without the user's say-so.

## 7. Verify annotated inline evidence live in headless Chromium (`strides-ac9.5`)

- [ ] 7.1 Real GPU confirmed via `WEBGL_debug_renderer_info` (`ANGLE Metal Renderer`, never
  `SwiftShader Device`); record the renderer string.
- [ ] 7.2 All three clips: Demo 1 (side view), Demo 2 (front view),
  `e2e/fixtures/multiperson-track.mp4` via upload.
- [ ] 7.3 Per-metric coverage recorded from the **last** `[evidence-coverage]` line, not the first —
  the background scale pass grafts `verticalOscillationCm` after `phase: 'ready'` and correctly
  triggers a second line.
- [ ] 7.4 **Pull every rendered thumbnail out of the DOM and look at it.** Confirm the joints land on
  the runner's actual body.
- [ ] 7.5 Adjudicate the legibility rule (design D11 rule 1): any metric unreadable, or whose marks are
  indistinguishable from the joint layer, on ≥2 of 3 clips ships joints-only. Report every such
  metric with its reason; do not silently drop one.
- [ ] 7.6 Confirm no mark carries a numeric label anywhere (design D11 rule 3).
- [ ] 7.7 Re-measure the anchor: track-clip `verticalOscillationCm` 4.4215 cm, `fit.frequencyHz × 60`
  = 91.2 = `cadence.value`.
- [ ] 7.8 `[analysis-diagnostics]` confirmed free of exemplar, position, canvas and blob data;
  `[evidence-coverage]` confirmed free of anything image-shaped; `vite build` output confirmed free of
  every dev-only console prefix.
- [ ] 7.9 Analysis wall-clock compared against baseline; no regression. Extraction cost stays after
  "Analysis complete".
- [ ] 7.10 Fold the measured tables into this `design.md`, then
  `openspec archive inline-annotated-evidence --yes`.
