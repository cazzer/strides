# Proposal — add-arm-swing-amplitude-metric

## Why

Bead `strides-7a6.2` (epic `strides-7a6`, appendage-drive metrics — Wave 2, after
`add-knee-drive-metric` archived). The panel already measures how EVENLY the arms swing
(`armSwingSymmetry`, a min/max ratio of the two sides' fitted amplitudes), but the amplitudes
themselves — how BIG the swing is — are computed internally and then discarded, keeping only the
ratio. A runner with two tiny, perfectly matched swings reads 100% symmetric and the panel says
nothing about the swings being tiny. Arm swing amplitude surfaces the magnitude the symmetry
metric already fits, normalized by torso length so it compares across runners and camera
distances.

**And it is honest-proxy scoped**: 2D pose measures a wrist-travel AMPLITUDE, not propulsive
contribution or "arm drive effectiveness". Card copy and spec language name the movement-amplitude
proxy and claim nothing about what the swing contributes to the stride.

## What Changes

- **`MetricId` widens to `armSwingAmplitude`, appended last** (after `kneeDrive` — 12 → 13
  metrics), per the repo's append-only convention, so no existing metric's position in `MetricId`
  or its enumerations moves.
- **Phase A (no behavior change): extract the shared per-side fit into
  `src/heuristics/armSwing.ts`.** `SideSwing`, `computeSideSwing`, `buildSideExemplar`,
  `caveatForFailure` and the four gate/policy constants (`MIN_ARM_SWING_CYCLES`,
  `FIT_QUALITY_SATURATION_R2`, `MAX_SIDE_FREQUENCY_DISAGREEMENT`,
  `SIDE_FIT_QUALITY_DISPARITY_R2`) plus the keypoint-name tables move verbatim out of
  `armSwingSymmetry.ts`, which keeps only `nullResult` + `computeArmSwingSymmetry` and imports the
  rest — the `hipBounce.ts` precedent (siblings re-run one cheap linear least-squares per side; no
  cross-metric memoization). Proven bit-identical by a full before/after
  `scripts/ab-person-selection.mjs` diff on all three clips (design D5).
- **Phase B: new `src/heuristics/armSwingAmplitude.ts`** — `computeArmSwingAmplitude(frames,
  view, config)`, value = the MEAN of the two sides' fitted peak-to-peak wrist-relative-to-shoulder
  vertical amplitudes divided by `estimateBodyScale`'s `torsoLengthPx` (design D1), `unit:
  'ratio'`. **Gate reuse is mandatory** (design D2/D6): the same `armSwingMinFitR2` on the weaker
  side, the same `MIN_ARM_SWING_CYCLES` floor, and the same `MAX_SIDE_FREQUENCY_DISAGREEMENT`
  cross-side rhythm bound the symmetry metric applies to the identical fitted signal — never a
  second gate constant that would let the arm-metric family disagree with itself about
  trustworthiness (the bug class #36 deleted).
- **New `viewFitTable.armSwingAmplitude` row**: front-view-primary, side/ambiguous unsuitable —
  copied from `armSwingSymmetry`'s row exactly, same occlusion/separability reasoning.
  Computed-not-withheld on unsuitable views, with a `viewPhrase(view)` caveat.
- **Exemplar kind `'armSwingCycle'` REUSED** (design D4): the same per-side ghosted top/bottom
  pair `buildSideExemplar` already builds — same shape of fit, same marks, zero
  `evidenceAnnotations.ts`/`evidenceFrames.ts` code changes; `'armSwingCycle'` stays OUT of
  `SINGLE_INSTANT_KINDS`.
- **Enumeration fan-out**, compiler-driven: `index.ts`, `fuseHeuristics.ts` (both lists),
  `metricConfidence.ts` (`'Arm swing amplitude'`), `MetricsPanel.tsx` (honest amplitude-proxy
  description + card), the enumerating tests, and every count-bearing "twelve" doc comment →
  thirteen.
- **Explicitly NOT touched**: `src/results/scalePassGraft.ts` and `ResultsView.tsx`'s scale-pass
  status line — armSwingAmplitude is a pixel-space ratio, not scale-pass-backed. No `src/pose/`
  changes. No new config key.

## Impact

- Affected specs: `form-heuristics` (ADDED ×3: the metric's definition/aggregation, its view
  gating, and its orchestration participation — the same three-requirement shape
  `verticalOscillationCm`/`stepWidthCm`/`kneeDrive` established), `results-view` (MODIFIED ×1: the
  metrics-panel tier requirement's count, twelve → thirteen).
- Affected code: `src/heuristics/types.ts`, new `src/heuristics/armSwing.ts` (extracted),
  `src/heuristics/armSwingSymmetry.ts` (imports), new `src/heuristics/armSwingAmplitude.ts`
  (+ test), `src/heuristics/index.ts` (+ test), `src/results/fuseHeuristics.ts` (+ test
  fixtures), `src/results/metricConfidence.ts`, `src/results/MetricsPanel.tsx` (+ test),
  count-bearing doc comments (`analysisDiagnostics.ts`, `viewPlausibility.ts`, `exemplars.ts`,
  `extractFrames.ts`, `evidenceFrames.ts`, `useSessionEvidence.ts`), remaining test fixture
  builders as the compiler surfaces them, CLAUDE.md's metric-count note.
- Not in scope: `strides-7a6.3` (arm midline crossing — sequenced after this change archives),
  heel whip (blocked on rear-view footage per the epic), `scalePassGraft.ts`, `ResultsView.tsx`,
  `src/pose/`, `evidenceAnnotations.ts`/`evidenceFrames.ts` (kind reuse means no code change
  there).
