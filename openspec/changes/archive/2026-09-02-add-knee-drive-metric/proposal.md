## Why

Bead `strides-7a6.1` (epic `strides-7a6`, appendage-drive metrics). The panel measures how the
legs *land* (overstriding, foot strike, step width) and how the knee *bends* (kneeFlexion), but
nothing about how the thigh is *used* — how high the knee is driven during swing, a standard
coaching cue for stride power and hip-flexor engagement. Knee drive is the side-view leg member of
the epic's three appendage-drive metrics, and the first, because the epic's tickets form a linear
chain over the same enumerated files.

**This is NOT kneeFlexion with a different angle.** `kneeFlexion` measures swing-phase knee BEND —
the hip-knee-ankle interior angle, the heel-toward-glutes recovery motion. `kneeDrive` measures
thigh LIFT — the hip→knee vector's angle off the image's down-vertical, ignoring the ankle
entirely. A runner can carry a high heel with a low knee (good recovery, weak drive) or the
reverse; the two metrics answer different coaching questions from different geometry. A probe
(design D1) verifies on real footage that the two metrics' peak instants genuinely diverge — with
a pre-registered STOP rule if they don't.

**And it is honest-proxy scoped**: 2D pose measures a thigh-lift ANGLE, not propulsive force or
"drive effectiveness". Card copy and spec language name the angle proxy and claim nothing about
push-off power.

## What Changes

- **`MetricId` widens to `kneeDrive`, appended last** (after `stepWidthCm` — 11 → 12 metrics),
  per the repo's append-only convention, so no existing metric's position in `MetricId` or its
  enumerations moves.
- **New `src/heuristics/kneeDrive.ts`** — `computeKneeDrive(frames, view, config)`, modeled on
  `kneeFlexion.ts`'s skeleton: per-leg hip→knee thigh-angle series via `resolvePoint`, fed through
  the same gap-aware prominence-thresholded `findLocalExtrema`, one peak per leg per stride pooled
  across both legs, reported as the median in degrees. The angle convention (down-vertical zero;
  signed-vs-unsigned) is an empirical design decision resolved by a pre-registered probe on real
  clips BEFORE implementation — design D1/D2 — as is the prominence floor (D4, measured, NOT
  copied from kneeFlexion's 20°).
- **New `viewFitTable.kneeDrive` row**: side-view-primary, front/ambiguous unsuitable — copied
  from `kneeFlexion`'s row (side 1.0 primary, front 0.1 unsuitable, ambiguous 0.2 unsuitable),
  same sagittal-plane reasoning. Computed-not-withheld on unsuitable views, with a
  `viewPhrase(view)` caveat mirroring kneeFlexion's.
- **New config key `kneeDriveMinProminenceDegrees`** with a probe-derived default (D4), plus
  `MIN_KNEE_DRIVE_SAMPLE_SIZE = 4` mirroring `MIN_KNEE_FLEXION_SAMPLE_SIZE` (D6).
- **New `MetricExemplarKind` `'kneeDrivePeak'`** (D5): the median-nearest peak ghosted against the
  same-leg adjacent trough, one pair max, member of `SINGLE_INSTANT_KINDS`; a new
  `buildKneeDriveMarks` in `evidenceAnnotations.ts` using existing primitives only (thigh line,
  down-vertical reference ray at the hip, angle arc under a new `'kneeDriveArc'` role), ghost
  unmeasured per `kneeFlexionPeak`'s precedent.
- **Enumeration fan-out**, compiler-driven: `index.ts`, `fuseHeuristics.ts` (both lists),
  `metricConfidence.ts` (`'Knee drive'`), `MetricsPanel.tsx` (honest thigh-lift description +
  card), the enumerating tests, and every count-bearing "eleven" doc comment → twelve.
- **Explicitly NOT touched**: `src/results/scalePassGraft.ts` and `ResultsView.tsx`'s scale-pass
  status line — kneeDrive is a pixel-space angle, not scale-pass-backed, so the graft path and the
  "metrics added by the scale pass" count are out of scope. No `src/pose/` changes.

## Impact

- Affected specs: `form-heuristics` (ADDED ×3: the metric's definition/aggregation, its view
  gating, and its orchestration participation — the same three-requirement shape
  `verticalOscillationCm`/`stepWidthCm` established), `results-view` (MODIFIED ×1: the metrics-
  panel tier requirement's count, eleven → twelve).
- Affected code: `src/heuristics/types.ts`, new `src/heuristics/kneeDrive.ts` (+ test),
  `src/heuristics/index.ts` (+ test), `src/results/fuseHeuristics.ts` (+ test fixtures),
  `src/results/metricConfidence.ts`, `src/results/MetricsPanel.tsx` (+ test),
  `src/results/evidenceAnnotations.ts` (+ test), `src/results/evidenceFrames.ts` (+ test),
  count-bearing doc comments (`analysisDiagnostics.ts`, `viewPlausibility.ts`, `exemplars.ts`,
  `extractFrames.ts`, `evidenceFrames.ts`, `useSessionEvidence.ts`), remaining test fixture
  builders as the compiler surfaces them, CLAUDE.md's metric-count note.
- Not in scope: the arm-drive tickets (`strides-7a6.2`/`.3` — sequenced after this change
  archives), heel whip (blocked on rear-view footage per the epic), `scalePassGraft.ts`,
  `ResultsView.tsx`, `src/pose/`.
