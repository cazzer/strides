# Drop the arm swing symmetry metric

## Why

User decision, 2026-09-04: *"drop arm swing symmetry — it is never accurate."* The measurement
backs it. On `f7b02e8`, zero spread across two trials, the metric resolves on **exactly one clip in
the corpus**:

| clip | value | confidence | sampleSize | tier |
|---|---|---|---|---|
| `side-landscape` | `null` | 0 | 0 | excluded (unsuitable view) |
| `side-portrait` | `null` | 0 | 0 | excluded (unsuitable view) |
| `front-approach` | 0.518197 | 0.412742 | 2 | **caveated** |

One caveated number, off a sample of two arm-swing cycles, on one of three clips.

Two open tickets say that number is not trustworthy either, and both are blocked on footage nobody
has:

- **`strides-56e`** — the Demo 2 asymmetry is real but measured under materially unequal per-side
  conditions (left fit R² 0.776 vs right 0.512), and "cannot adjudicate how much of the ratio is
  form and how much is measurement. Nothing in this clip's footage can." It stayed open through
  `stabilize-arm-swing-scale-before-fitting`, the fix that should have helped most — which moved
  the value 0.607 → 0.518, making it MORE extreme rather than more trustworthy.
- **`strides-9c9`** — one arm swing spans a full STRIDE, so it sits at half the step rate, but the
  fit runs in the 1.2–4.0 Hz band sized for the per-step hip bounce. Cadences below ~144 spm fit
  nothing real.

## What Changes

- **REMOVED**: the `armSwingSymmetry` metric — from `MetricId`, `FormHeuristicsResult`,
  `viewFitTable`, `computeFormHeuristics`, the metrics panel, cross-clip fusion and the live specs.
  `src/heuristics/armSwingSymmetry.ts` is deleted. `MetricId` goes 13 → 12.
- **NOT removed**: `src/heuristics/armSwing.ts`. It is fully load-bearing for `armSwingAmplitude`
  alone — the per-side spectral fit, the scale stabilization, the shared gate constants and the
  per-side exemplar builder all survive untouched, and `armSwingAmplitude` keeps its own two
  `armSwingCycle` images and its own card. **No behaviour in that module changes**; only comments
  that pointed at the withdrawn sibling.
- **Test coverage MIGRATED, not deleted.** `armSwingSymmetry.test.ts` was the only cover for twelve
  behaviours of the shared module — the scale-stabilization fallback ladder (including two
  bit-exact no-op assertions), the evaluation-time clamp, the `'degenerate-signal'` caveat string,
  the exemplar pair's half-cycle span and crop seeding, and the image-y sign trap. They move to a
  new `src/heuristics/armSwing.test.ts` that calls the shared module directly. Naming coverage
  after a consumer is how it became deletable in the first place.

## Impact

- Affected specs: `form-heuristics` (6 removed, 4 modified, **2 added**), `multi-clip-analysis`
  (1 modified), `results-view` (**2 modified**). The two ADDED requirements re-home contracts that
  lived inside removed requirements while governing code that survives — the scale stabilizer and
  the exemplar builder's two rules — stated of the shared computation rather than of any metric.
  The second `results-view` MODIFIED corrects a normative SHALL that counted thirteen `MetricId`s.
- Affected code: `src/heuristics/` (`types.ts`, `index.ts`, `armSwing.ts` comments,
  `armSwingAmplitude.ts`, `verticalRatio.ts`, `stepWidthCm.ts`, `viewPlausibility.ts`),
  `src/results/` (`metricConfidence.ts`, `MetricsPanel.tsx`, `fuseHeuristics.ts`, evidence module
  comments), plus test fixtures across 17 files.
- **User-visible**: one fewer card. The panel goes from thirteen metrics to twelve.
  `armSwingAmplitude`'s description no longer refers the reader to a metric that does not exist.
- Two beads are **re-pointed rather than closed**, because what they describe belongs to the shared
  module and survives: `strides-9c9` (the band floor is `computeSideSwing`'s) and `strides-56e`
  (the footage gap still blocks `armSwingAmplitude`'s fit-disparity caveat, which its own suite
  says "matters MORE here, not less").
