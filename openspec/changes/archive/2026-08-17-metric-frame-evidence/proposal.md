# Per-metric visual evidence — extract and ghost demonstrative frames (epic #59)

## Why

Every metric this app reports is a number, a confidence score, and sometimes a caveat. None of
them show the user *what in their run* produced that number. A runner told "foot strike: midfoot,
confidence 0.86" has no way to check whether the app looked at the right moment, the right person,
or the right foot — and no way to learn what midfoot striking looks like in their own gait.

Person selection ships `enabled: true` precisely because "did this pipeline look at the right
person?" is a live, measured failure mode on real footage. Today the only answer the UI can give
is a confidence number. A picture of the instant the metric was computed from answers it directly.

The pipeline already knows the answer and throws it away, usually on a single line:

- `kneeFlexion` builds per-peak records carrying side + frame identity and discards them at the
  aggregation step; its extension minima are computed by `findLocalExtrema` and dropped by a
  `kind !== 'max'` filter.
- `overstriding`, `footStrikePattern`, `stepWidth`, `stepWidthCm` each derive per-strike values
  from `FootstrikeCandidate`s that **already carry `timestamp`**, then reduce to a median and drop
  the candidates.
- `armSwingSymmetry` has both endpoints of every half-swing in hand and collapses them to
  `Math.abs(diff)`.
- `trunkLean` accumulates per-frame lean values in a loop over frames that each carry a
  `timestamp`, and never records which frame any value came from.
- The vertical-oscillation family and `cadence` fit a sinusoid whose phase names the bounce peak
  and trough exactly, and `fitSpectralSinusoid` discards the phase at the moment it collapses the
  coefficients to an amplitude.

Recovering these instants is cheap. Rendering them is the feature.

## What Changes

After a clip reaches `phase: 'ready'`, the app re-extracts a small number of specific video frames
**by timestamp**, crops each to the body region the metric is actually about, and — for metrics
that measure a *range* of motion — alpha-blends two frames into a single "ghost" image showing the
runner against themself at the two extremes of their own cycle. The results render in a new
evidence gallery below the metric cards.

- **`MetricResult` gains an optional `exemplars` field.** A `MetricExemplar` names one or two
  instants **as timestamps on the clip media clock, never as frame indices**, plus a per-instance
  `quality` score and enough labelling to caption it. Six metrics populate it from data already in
  scope; three more need a shared extractor's return shape widened; the VO family needs
  `SpectralFitSuccess` to stop discarding the fitted phase.
- **A per-instance quality gate** ranks candidate instants and drops the ones that would produce a
  misleading picture. It is built from `interpolated` flags and distance-from-median — signals that
  already exist — never from keypoint score.
- **A pure evidence-plan module** (`src/results/evidenceFrames.ts`) turns exemplars + that clip's
  `robustFrames` into timestamps, crop rects, and blend plans, with zero DOM and zero canvas.
- **An impure frame extractor** (`src/video/extractFrames.ts`) seeks a second, detached `<video>`
  minted from the clip's `sourceBlob`, draws each planned instant into an offscreen canvas, crops,
  and composites ghost pairs. The visible element — loop-playing after analysis — is never touched.
- **Fusion provenance becomes machine-readable.** `fuseFormHeuristicsResults` spreads whole
  `MetricResult` objects, so an `exemplars` field travels across clips for free and lands pointing
  at a frame array the UI does not hold for that metric. A sibling pure function exposes the
  winning clip index per metric so the gallery can resolve evidence against the clip it came from.
- **A new evidence gallery** mounts as a third child of `<main>` spanning both columns, below the
  results. Metric cards that have evidence gain a "see evidence" deep link; cards without evidence
  render exactly as they do today.

**Locked product decisions** (settled on #59; not re-opened here):

| Decision | Choice |
|---|---|
| Metric coverage | All 11 `MetricId`s attempted, confidence-gated. A metric with no qualifying moment falls back to today's text-only card. Coverage varying per clip is correct, not a bug. |
| Ghost semantics | Two extremes of the runner's **own** cycle. Never a reference posture. |
| Annotation | None. Photographic opacity blend only — no skeleton, no angle arcs, no reference lines. |
| Placement | A separate gallery **below** the cards, spanning the full width; cards deep-link into it. |
| Persistence | Session-only, in memory. Images vanish on reload. |
| Examples per metric | ~2 most confident. |
| Evidence carrier | Timestamps, never frame indices. |
| Frame retention | None during sampling — extract post-hoc. |

**This change must not move a number.** No metric's `value`, `confidence`, `viewFit`, `sampleSize`,
or `caveat` changes. The track-clip anchor (`verticalOscillationCm` 4.78–4.79 cm, `fit.frequencyHz
× 60` matching `cadence` exactly) is the regression proof for the one primitive four metrics share.

## Impact

- **Affected specs**: `form-heuristics` (metrics emit exemplar instants), `results-view` (the
  gallery, extraction, and gating), `multi-clip-analysis` (exemplar provenance across fused clips).
- **Affected code**: `src/heuristics/types.ts`, `spectralFit.ts`, and the eleven metric modules;
  `src/heuristics/armSwingSymmetry.ts`, `strideLength.ts`; `src/results/evidenceFrames.ts` (new),
  `fuseHeuristics.ts`, `MultiClipVideoSession.tsx`, `EvidenceGallery.tsx` (new), `MetricsPanel.tsx`;
  `src/video/extractFrames.ts` (new).
- **No new runtime dependencies.** This repo hand-rolls its SVG chart rather than pulling a
  charting library; the same bar applies to image compositing.
- **Nothing image-shaped becomes reachable from `diagnostics`.** `useVideoAnalysis` `JSON.stringify`s
  that object to the console and the live-verification harness parses those lines. Timestamps and
  counts are welcome there; pixels, canvases, and blob URLs are not.

## Out of Scope

- **Export / download / share of the images.** Session-only. A deliberate follow-up, not an
  oversight — keeping it out is what makes this epic one shippable unit.
- **Drawn annotation of any kind** — no skeleton overlay, angle arcs, or reference lines rendered
  over an extracted image. The skeleton overlay already exists on the video itself.
- **Ideal-form reference overlays.** The delta shown is always the runner against themself. This
  repo has no reference-form data and inventing it is a different project.
- Persisting images to `localStorage` / IndexedDB / URL state.
- Changing any metric's computed value.
- #23 (sticky results layout), which touches the same layout the gallery mounts into.
