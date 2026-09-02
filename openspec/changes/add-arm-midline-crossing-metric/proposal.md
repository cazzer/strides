# Proposal — add-arm-midline-crossing-metric

## Why

Bead `strides-7a6.3` (epic `strides-7a6`, appendage-drive metrics — Wave 3, after
`add-arm-swing-amplitude-metric` archived). The panel measures how EVENLY the arms swing
(`armSwingSymmetry`) and how BIG the swing is (`armSwingAmplitude`), but nothing about WHERE the
wrists travel laterally — the classic "arms crossing the body" coaching cue. A runner whose
wrists sweep across the sternum on every swing reads identically to one whose hands track
straight fore-aft. Arm midline crossing reports the signed medial wrist excursion past the
shoulder midline, as a fraction of shoulder width, so a crossing pattern is visible on the panel
and a non-crossing one reads as an honest negative number rather than as silence.

**And it is honest-proxy scoped**: 2D pose measures where the wrists TRAVEL relative to the
runner's own shoulder midline, not what that travel does to the stride. Card copy and spec
language name the movement observation and claim nothing about propulsive effectiveness, wasted
energy, or injury.

## What Changes

- **`MetricId` widens to `armMidlineCrossing`, appended last** (after `armSwingAmplitude` — 13 →
  14 metrics), per the repo's append-only convention, so no existing metric's position in
  `MetricId` or its enumerations moves.
- **New `src/heuristics/armMidlineCrossing.ts`** — `computeArmMidlineCrossing(frames, view,
  config)` on `stepWidth.ts`'s skeleton. Per frame per side: the STRICT
  `resolveBilateralPair('left_shoulder', 'right_shoulder')` midline (never the tolerant
  `resolveMidpoint` — stepWidth.ts's documented sign-falsification reason), the wrist via
  `resolvePoint`, and a per-frame own-side `outwardSign` so medial = positive on both screen
  orientations (design D1). Value = the 95th percentile of the POOLED signed series (both arms),
  `unit: 'percent'` (fraction of shoulder width — stepWidth's own unit convention, not `'ratio'`,
  whose formatter bakes "of torso length" into the string). Pre-registered small-n rule:
  `MIN_ARM_CROSSING_SAMPLE_SIZE = 61`, derived (D1), discounting rather than withholding below it.
- **New `estimateShoulderWidth` in `bodyScale.ts`** — the clip-median left-right shoulder
  separation, mirroring `estimateHipWidth` verbatim (design D2): numerator and denominator
  foreshorten together under camera yaw, the midline is half a shoulder width from each shoulder,
  and the denominator resolves iff the midline resolves — one null path, not two.
- **New `viewFitTable.armMidlineCrossing` row**: front-view-primary, side/ambiguous unsuitable —
  copied from `stepWidth`'s row exactly, same mediolateral axis-collapse reasoning.
  Computed-not-withheld on unsuitable views, with a `viewPhrase(view)` caveat. **No
  travel-direction input** (design D6): the sign is per-frame own-side, so the metric emits on
  front-approach footage where `estimateTravelDirection` returns 0 — the one clip class it is
  designed for.
- **New `MetricExemplarKind` `'armCrossingInstant'`** (design D5): ONE single-instant exemplar —
  the resolvable frame whose signed value sits nearest the reported statistic, on that sample's
  own side — with a new `INSTANT_MARK_BUILDERS` entry drawing the strict shoulder-mid guide, the
  shoulder-width segment, the arm chain, and a horizontal caliper from the midline to the wrist.
  Added to `SINGLE_INSTANT_KINDS`. A ghosted pair is REJECTED with reasons (D5).
- **A measurement probe BEFORE the implementation** (design D3/D4, add–measure–revert): a
  temporary `armMidlineCrossing.experimental.ts` dumps the per-side and pooled signed series,
  a percentile ladder, tail composition, and both candidate denominators on all three reference
  clips, adjudicated against five pre-registered rules — including the STOP rules — before any
  shipped code exists to tune toward.
- **Enumeration fan-out**, compiler-driven: `index.ts`, `fuseHeuristics.ts` (both lists),
  `metricConfidence.ts` (`'Arm midline crossing'`), `MetricsPanel.tsx` (movement-observation
  description + card), the enumerating tests, and every count-bearing "thirteen" doc comment →
  fourteen.
- **Explicitly NOT touched**: `src/results/scalePassGraft.ts` and `ResultsView.tsx`'s scale-pass
  status line — armMidlineCrossing is a pixel-space ratio, not scale-pass-backed. No `src/pose/`
  changes. No new config key (both new constants are module constants, like
  `MIN_STEP_WIDTH_SAMPLE_SIZE`).

## Impact

- Affected specs: `form-heuristics` (ADDED ×3: the metric's definition/statistic, its view
  gating, and its orchestration participation — the same three-requirement shape
  `verticalOscillationCm`/`stepWidthCm`/`kneeDrive`/`armSwingAmplitude` established),
  `results-view` (MODIFIED ×1: the metrics-panel tier requirement's count, thirteen → fourteen).
- Affected code: `src/heuristics/types.ts`, `src/heuristics/bodyScale.ts` (+ test), new
  `src/heuristics/armMidlineCrossing.ts` (+ test), `src/heuristics/index.ts` (+ test),
  `src/results/fuseHeuristics.ts` (+ test fixtures), `src/results/metricConfidence.ts`,
  `src/results/MetricsPanel.tsx` (+ test), `src/results/evidenceAnnotations.ts` (+ test),
  `src/results/evidenceFrames.ts` (`SINGLE_INSTANT_KINDS`), count-bearing doc comments
  (`analysisDiagnostics.ts`, `viewPlausibility.ts`, `exemplars.ts`, `extractFrames.ts`,
  `evidenceFrames.ts`, `useSessionEvidence.ts`), remaining test fixture builders as the compiler
  surfaces them, CLAUDE.md's metric-count note.
- Not in scope: heel whip (blocked on rear-view footage per the epic), `scalePassGraft.ts`,
  `ResultsView.tsx`, `src/pose/`.
