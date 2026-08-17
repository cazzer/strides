# Tasks

Sections 1–8 map one-to-one onto the sibling tickets of epic #59, in the order the epic's
dependency graph allows. Section 0 is this ticket.

Parallelism: §1 and §4 start together. §2, §3 and §5 all start once §1 lands. §6 needs §5. §7 needs
§4, §5, §6 (and §1–§3 for content). §8 needs everything.

## 0. The openspec change (#60 — this ticket)

- [x] 0.1 Scaffold `openspec new change metric-frame-evidence`.
- [x] 0.2 `proposal.md` — Why / What Changes reflecting the locked product decisions; Out of Scope
  naming export, drawn annotation, and reference-form overlays.
- [x] 0.3 `design.md` D1 — the per-metric exemplar table for all 11 `MetricId`s, each row verified
  against source, with the representative-versus-extreme role distinction.
- [x] 0.4 `design.md` D7 — the `cadence` decision, with both rejected alternatives named.
- [x] 0.5 `design.md` D2 — the per-metric crop-keypoint table, plus the MoveNet heel/foot_index
  degradation rule.
- [x] 0.6 `design.md` D3 — the per-instance quality score, its hard rejects, its threshold, and the
  zero-survivor behaviour at each layer.
- [x] 0.7 `design.md` D4 — the timestamp invariant, written as a rule with its rationale.
- [x] 0.8 `design.md` D5 — the cross-clip provenance decision, including the scale-pass graft rules.
- [x] 0.9 `design.md` D6 — PTS drift and `duration === Infinity`, written as inherited criteria.
- [x] 0.10 Spec deltas for `form-heuristics`, `results-view`, `multi-clip-analysis`.
- [x] 0.11 `openspec validate metric-frame-evidence --strict` passes.
- [ ] 0.12 **Not archived here.** Archiving happens in §8, after live verification.

## 1. `MetricResult.exemplars` and the six event-sampled metrics (#61)

- [ ] 1.1 `src/heuristics/types.ts`: define `MetricExemplar` and add
  `exemplars?: MetricExemplar[]` to `MetricResult`. Carry `timestamp`, optional `pairedTimestamp`,
  `kind`, optional `side`, `quality`, `label`, `cropKeypoints`. **No frame-index field of any
  kind** — the invariant is enforced by the type (design D4).
- [ ] 1.2 Add the shared gate helper: `resolutionFactor` × `typicalityFactor`, the `3·MAD` outlier
  bound, `MIN_EXEMPLAR_QUALITY = 0.5`, `MAX_EXEMPLARS_PER_METRIC = 2` (design D3). One
  implementation, imported by every metric — not copied per module.
- [ ] 1.3 `kneeFlexion.ts`: stop dropping minima at `:141`; add `timestamp: extremum.timestamp` to
  the `FlexionPeak` literal at `:142`; emit peak-nearest-the-median paired with its adjacent
  same-leg extension minimum. Rank with `legInterpolated[side][frameIndex]` (`:111-113`, read `:158`).
- [ ] 1.4 `overstriding.ts`: carry each surviving candidate alongside its `overstrideRatios` entry
  (the array is index-parallel to survivors only — `continue` at `:82`); emit most- vs
  least-overstriding as an **extreme** pair, after the outlier bound.
- [ ] 1.5 `footStrikePattern.ts`: emit up to **two single-instant** exemplars — the strikes nearest
  the median `offsetRatios` value. Caption via the already-exported `classifyFootStrike` (`:54-58`).
  The type must express a single without a null-second-timestamp hack.
- [ ] 1.6 `stepWidth.ts`: construct the pair — among **adjacent opposite-side** entries in the
  timestamp-ordered candidate list, the pair minimising mean `|offset − median|`. Demote to a single
  representative strike when no opposite-side adjacency exists. Hard-reject the `outwardSign`
  degenerate case at `:113` rather than ranking it.
- [ ] 1.7 `stepWidthCm.ts`: same construction over `offsetsCm` (`:149`); a strike with no usable
  `pixelsPerMeter` is not a candidate.
- [ ] 1.8 `trunkLean.ts`: capture `frame.timestamp` (already in scope) alongside each `leanValues`
  push at `:85`; emit max-lean vs most-upright as an **extreme** pair, after the outlier bound.
- [ ] 1.9 **Invariant regression test**: on a fixture whose presence window is strictly narrower
  than the clip, an exemplar timestamp resolved against the **untrimmed** `robustFrames` finds the
  same frame object the heuristic saw in the **trimmed** array. First-class, not incidental.
- [ ] 1.10 Prove no number moved: every existing metric test passes unmodified except where it
  asserts on the new field. Do **not** widen `FootstrikeCandidate` or `Extremum` — both already
  carry `timestamp`, and 9 whole-object `toEqual`s depend on their current shapes.
- [ ] 1.11 `npm test`, `tsc -b`, `eslint` clean.

## 2. Spectral fit phase and the vertical-oscillation family (#62)

- [ ] 2.1 `spectralFit.ts`: add `phaseRadians = atan2(b, a)` and `tMeanSeconds` to
  `SpectralFitSuccess`. Assert `peakToPeakAmplitude` and every existing field bit-identical
  before/after — this primitive is shared by four metrics.
- [ ] 2.2 A shared helper deriving (max, adjacent min) instants from `(frequencyHz, phaseRadians,
  tMeanSeconds)`, selecting the pair whose midpoint is nearest the centre of `spanSeconds`, then
  snapping each to a sampled frame via `findNearestFrame` + the half-median-interval tolerance.
- [ ] 2.3 **The sign rule (design D8).** `hipBounce.ts:95` fits raw downward-positive image-y;
  `verticalOscillationCm.ts:154` integrates upward-positive deltas. Resolve max-versus-min against
  each fit's own series convention at the call site. Unit-test direction against a synthetic fixture
  with known geometry — a mislabelled caption passes every other check.
- [ ] 2.4 `verticalOscillation.ts`: emit the bounce trough/peak pair for one cycle.
- [ ] 2.5 `verticalOscillationCm.ts`: pair each fit with its producing `IntegrationRun` (which
  carries `timestamps`, `:41-47`) so `selectWeightedMedianFit`'s winner has attributable instants.
  This is the awkward one — budget for it.
- [ ] 2.6 `verticalRatio.ts`: numerator exemplar from the same bounce fit.
- [ ] 2.7 `cadence.ts`: **emit nothing** (design D7). Add a test asserting `cadence.exemplars` is
  absent, so a future contributor's "fix" fails loudly rather than shipping a borrowed picture.
- [ ] 2.8 Per-instance signal for this family: the cheapest honest option is to stop discarding
  `mid.interpolated` at `hipBounce.ts:83`. Do it only as far as the gate needs, and record it.
- [ ] 2.9 Regression anchor: track clip VO_cm 4.78–4.79 cm (±0.005 across trials),
  `fit.frequencyHz × 60` == `cadence.value`. A >0.05 cm spread means something moved.
- [ ] 2.10 `npm test`, `tsc -b`, `eslint` clean.

## 3. `armSwingSymmetry` and the stride denominator (#63)

- [ ] 3.1 `armSwingSymmetry.ts`: widen `SideSwing` to keep each half-swing's extrema pair rather
  than collapsing at `:90`, and add the per-extremum interpolated flag the gate needs (today's
  `interpolatedCount` is per-side/per-frame). Carry the median-amplitude index back from the
  caller's `median(...)` at `:149-150`.
- [ ] 3.2 Emit up to one exemplar per side: wrist-high vs wrist-low of that side's median-amplitude
  half-swing.
- [ ] 3.3 `strideLength.ts`: widen `StrideLengthResult` to keep each displacement's two footstrike
  instants (identity dies at `:151`). Safe — one production caller (`verticalRatio.ts:175`), no
  production object literals.
- [ ] 3.4 Update the two whole-object `toEqual`s at `strideLength.test.ts:144` and `:176` to the new
  shape — **updated, not deleted, not loosened to `toMatchObject`**.
- [ ] 3.5 `verticalRatio.ts`: emit the median stride pair's two same-side footstrikes as the
  denominator exemplar, `kind`-distinguished from the numerator exemplar.
- [ ] 3.6 Prove `verticalRatio.value` and `armSwingSymmetry.value` are identical before/after.
- [ ] 3.7 `npm test`, `tsc -b`, `eslint` clean.

## 4. Fusion provenance and clip plumbing (#64)

- [ ] 4.1 `fuseHeuristics.ts`: add `fusionSourceIndices(results): Record<MetricId, number>` as a
  **sibling pure function** reusing the same comparator. Do **not** change
  `fuseFormHeuristicsResults`'s return shape — its single-clip reference identity at `:48-50` is
  load-bearing.
- [ ] 4.2 Test that the sibling's winner agrees with `fuseFormHeuristicsResults`'s winner for every
  metric on a multi-clip fixture, and that the single-clip case maps every metric to index 0.
- [ ] 4.3 `MultiClipVideoSession.tsx`: pass `clips: ClipSession[]` (which already carry
  `videoSource` → `sourceBlob`/`metadata`, and non-null per-clip `analysis.robustFrames`) plus the
  source-index map down to the gallery's mount point. Handles unbounded N.
- [ ] 4.4 Preserve `ResultsView`'s no-hooks/presentational contract (`:28-33`). No hook there, no
  React context — this codebase keeps the dependency explicit (`ClipSlot` reports up,
  `MultiClipVideoSession` fans down). Do not change the aggregate state to carry frames.
- [ ] 4.5 Implement design D5's scale-pass graft rules: grafted exemplars resolve their crop rects
  against the **primary** pass's `robustFrames`, and are **dropped entirely** when
  `subjectAgreement.status === 'diverged'`. Check `scalePassGraft.ts:98-106` and `:19-24`, both of
  which spread whole `MetricResult` objects.
- [ ] 4.6 No UI in this ticket. It ends with data at the mount point and nothing rendering it.
- [ ] 4.7 `npm test`, `tsc -b`, `eslint` clean.

## 5. Pure evidence plan — timestamps, crop rects, blend, gate (#65)

- [ ] 5.1 New `src/results/evidenceFrames.ts`. **Zero DOM**: no `document`, no `HTMLVideoElement`,
  no canvas; importable in a node environment.
- [ ] 5.2 Exemplar → timestamps → frames via `findNearestFrame`
  (`skeletonGeometry.ts:85-108`), **reused, not reimplemented**, plus the half-median-interval snap
  tolerance it does not provide (it clamps and never returns null for a non-empty array).
- [ ] 5.3 Crop rect: `boundingBoxOfPoints` over the exemplar's own `cropKeypoints`, unioned across
  both frames of a pair, then `computeCropRect` (`movenetCrop.ts:269`) for padding, squaring and
  clamping. Do **not** reuse `deriveBoundingBox` — it excludes exactly the head/foot names this
  table wants.
- [ ] 5.4 Context keypoints are strictly optional: a crop must be well-defined from the seed alone,
  and any unresolvable context point is omitted. Never anchor on a `(0,0)` MoveNet foot keypoint.
- [ ] 5.5 Blend plan: base = `timestamp`, ghost = `pairedTimestamp`, `globalAlpha` 1.0 / 0.5.
- [ ] 5.6 Apply the gate here; return the discriminated per-metric result
  (`{ status: 'planned', items }` | `{ status: 'no-evidence', reason }`) the UI branches on.
- [ ] 5.7 Near-identical-pair demotion: crop-box IoU ≥ 0.98 (reuse `computeBoundingBoxIoU`) or both
  instants snapping to the same frame → demote to the base frame, or drop for a metric with no
  honest single-instant semantics.
- [ ] 5.8 **`metadata.durationSec` must not appear in this module at all.** A unit test on a
  metadata fixture with `durationSec: Infinity` produces a well-formed plan.
- [ ] 5.9 Unit tests: crop rects at frame edges, missing/interpolated keypoints, single vs pair,
  the near-identical case, the gate threshold boundary, degenerate/unbounded keypoint sets, and a
  4K-sized frame.
- [ ] 5.10 `npm test`, `tsc -b`, `eslint` clean.

## 6. Frame extractor — seek, crop, composite (#66)

- [ ] 6.1 New `src/video/extractFrames.ts`. Resurrect `seekTo(video, time)` from
  `git show ee7a56e^:src/quality/assessVideoQuality.ts` (`:32-57`) — `seeked` listener,
  `SEEK_TIMEOUT_MS = 2000` fallback, `<0.001s` no-op short-circuit — rather than writing a new one.
- [ ] 6.2 Use a **second, detached** `<video>` from `URL.createObjectURL(sourceBlob)`. Never touch
  the visible element, which is loop-playing after ready (`useVideoAnalysis.ts:381-392`). Own and
  revoke this object URL here; never reuse or revoke `useVideoSource`'s private one.
- [ ] 6.3 **At most one detached decoder open at a time**: all instants for one clip in one pass,
  tear down, next clip.
- [ ] 6.4 Await one `requestVideoFrameCallback` after `seeked` before `drawImage` — `seeked` does not
  mean the new frame is composited.
- [ ] 6.5 Draw with the nine-argument `drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh)` — only the
  crop rect, never a full 4K canvas per exemplar.
- [ ] 6.6 Ghost compositing via `globalAlpha` at the plan's opacities.
- [ ] 6.7 Return canvases / `ImageBitmap`s held in memory. **No `toDataURL`, no `toBlob`, no
  download, no storage** (also unstubbed in jsdom).
- [ ] 6.8 A seek that never fires `seeked` degrades to `reason: 'extraction-failed'`, never a
  spinner. Runs strictly after `phase: 'ready'`; no measurable analysis wall-clock regression.
- [ ] 6.9 **PTS calibration hook (design D6/R1)**: a per-clip seek-time offset, applied at seek time
  only, never written back into `robustFrames[].timestamp`. Landed here if #68 measures a non-zero
  offset.
- [ ] 6.10 Smoke test with `stubCanvas2DContext()` (`canvasTestUtils.ts:29`, fakes `drawImage` at
  `:40` and `globalAlpha` at `:41`) and `makeVideoSeekable(video)` (`videoTestUtils.ts:13`). Assert
  *that* two frames blended at the right opacities and *what* crop rect was passed. Never pixels.
- [ ] 6.11 `npm test`, `tsc -b`, `eslint` clean.

## 7. Evidence gallery UI and per-card deep link (#67)

- [ ] 7.1 New `src/results/EvidenceGallery.tsx`, mounted as a **third child of `<main>`
  (`MultiClipVideoSession.tsx:155`) with `lg:col-span-2`** — a sibling of `ResultsView`, never a
  child. Without `lg:col-span-2` it lands in column 1 of row 2; the class is required.
- [ ] 7.2 Do not use the export seam at `ResultsView.tsx:134-138` — reserved for the export ticket.
- [ ] 7.3 Deep link on each metric card that has evidence, wired through `MetricCard`'s existing
  `chart?: ReactNode` slot by metric identity (`MetricsPanel.tsx:86-89`, `:140`, `:236-242`) — no
  new prop path. Only tier-1/tier-2 metrics can have one (design D10).
- [ ] 7.4 Cards without evidence render exactly as today: no link, no placeholder, no layout shift.
- [ ] 7.5 Captions name the metric, the side where applicable, and state that a ghost is the **same
  runner at two instants** — a user must never read a ghost as two people.
- [ ] 7.6 One aspect ratio across every metric (design D13).
- [ ] 7.7 N clips: show which clip a section's evidence came from when N > 1, via
  `fusionSourceIndices` — **never** by regexing the prose caveat at `fuseHeuristics.ts:9-11`.
- [ ] 7.8 Extraction driven at most once per clip and torn down after; no detached video or canvas
  retained after unmount, no leak across a clip reset.
- [ ] 7.9 Responsive at narrow widths; images carry meaningful alt text; the deep link is
  keyboard-reachable.
- [ ] 7.10 Tailwind v4 utilities only; BEM-ish class names are test hooks with no CSS behind them.
  **No new runtime dependencies.**
- [ ] 7.11 `npm test`, `tsc -b`, `eslint`, `npm run build` clean.

## 8. Live verification, then archive (#68)

- [ ] 8.1 Headless Chromium, real GPU (`--headless=new --enable-gpu --ignore-gpu-blocklist`).
  Confirm the renderer via `WEBGL_debug_renderer_info` and **abort** on SwiftShader.
- [ ] 8.2 Run Demo 1 (3840×2160 landscape, network), Demo 2 (`park-approach.mp4`, 2160×3840
  portrait, local), and `e2e/fixtures/multiperson-track.mp4` for the N-clip provenance path.
  Multiple trials per clip; compare medians and ranges.
- [ ] 8.3 **Ground-truth every extracted instant**: `ffmpeg -i clip -ss <t> -frames:v 1 -q:v 3` per
  reported timestamp, read the PNGs, compare against the app's own crop.
- [ ] 8.4 **Report the measured PTS offset per clip.** A "looks fine" without a number does not
  close this. Cross-check by forcing `{ sequentialSampling: { enabled: false } }` via
  `page.addInitScript` and reporting whether the offset changes. If non-zero, §6.9's calibration
  lands and the finding is written into this design.md **before** archiving.
- [ ] 8.5 **Look at the ghosts.** Save the composites and read them. Confirm a legible delta and the
  right body region per metric. An unreadable double-exposure is a finding to report.
- [ ] 8.6 Report per-clip, per-metric coverage: which produced evidence, which were gated out, why.
  A metric gated out on **every** clip is a finding — `MIN_EXEMPLAR_QUALITY` is pre-registered and
  is not to be quietly tuned down to fix it.
- [ ] 8.7 Confirm `[analysis-diagnostics]` still `JSON.parse`s and contains no image data or blob
  URLs. Match the prefix exclusively
  (`startsWith('[analysis-diagnostics]') && !startsWith('[analysis-diagnostics:')`).
- [ ] 8.8 Confirm no analysis wall-clock regression against a pre-change baseline on the same
  machine.
- [ ] 8.9 `npm test`, `tsc -b`, `eslint`, `npm run build`, `npm run test:e2e` clean.
- [ ] 8.10 `openspec validate metric-frame-evidence --strict`, then
  `openspec archive metric-frame-evidence --yes`. **Promptly** — batched archiving has drifted
  `openspec/specs/` in this repo before.
- [ ] 8.11 CLAUDE.md gains a section recording what was measured: per-clip coverage, the PTS offset
  finding, and any metric whose ghost was judged unreadable. Record negative results so nobody
  re-derives them.
