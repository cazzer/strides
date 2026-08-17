## Context

Issue #45, part of epic #43's absolute-metrics track alongside `verticalOscillationCm` (#34/#36)
and the sibling `stepWidth` ratio ticket (#46, separate worktree). The naming parallel to
`verticalOscillationCm` invites copying its shape wholesale — this design record exists mainly to
document why that instinct is wrong, and what was built instead.

## D1 — Overstriding-shaped, not `verticalOscillationCm`-shaped

`verticalOscillationCm` solves a specific problem: bounce is a *time series* (hip-y across many
frames), and under a drifting camera-to-subject distance, converting each frame's absolute pixel
position by that frame's scale reports the drift itself as bounce (the "480cm artifact" its own
module doc describes). The fix — integrating per-frame *deltas* rather than absolute positions,
then fitting a spectral sinusoid per contiguous tracking run, then picking one run's fit by a
sample-count-weighted median — is real machinery solving a real problem.

Step width has no such problem. Each measurement is `ankle.x - hipMid.x` at ONE footstrike,
divided by THAT SAME FRAME's `pixelsPerMeter` — camera distance at that instant, nothing before or
after it. There is no drift to absorb because there is no accumulation across frames at all. This
is exactly `overstriding.ts`'s shape (`ankle.x - hipMid.x` at each footstrike, divided by a
per-clip normalizer) with one substitution: divide by `frame.pixelsPerMeter` (a per-frame,
real-world scale) instead of `torsoLengthPx` (a per-clip, pixel-space scale). Consequences of
following `overstriding`'s shape instead of `verticalOscillationCm`'s:

- **No `calibration`/`fit` companion type.** `VerticalOscillationCmResult.calibration:
  ScaleCalibratedVerticalOscillation | null` exists to carry a spectral fit's diagnostics
  (`frequencyHz`, `sinusoidR2`, `scaleDriftRatio`, `integrationRuns`, …) that this metric simply
  doesn't have. `computeStepWidthCm` returns a plain `MetricResult` — the same shape `overstriding`
  and every other event-sampled metric in this package returns.
- **No `ScaleCalibratedFitFailureReason`-style enum.** `verticalOscillationCm` needs five distinct
  named reasons for "measured scale but no value" because a spectral fit can fail in five distinct,
  diagnosable ways. `stepWidthCm` has exactly one failure mode short of "no scale at all":
  `detectFootstrikes` found nothing (or every candidate lost its hip/ankle/scale before the median
  could be taken) — one caveat sentence, not a typed union.
- **No per-run integration, no weighted-median-across-runs.** Every footstrike is an independent
  sample; the median is taken directly over `offsetsCm`, the same one-step aggregation
  `overstriding.ts`'s `median(overstrideRatios)` already uses.
- **No travel-direction correction.** `overstriding`'s fore-aft offset needs
  `estimateTravelDirection` to know which way is "ahead"; a mediolateral (side-to-side) offset has
  no fore-aft sign to resolve, so `computeStepWidthCm` skips that step entirely — `dx` is used
  as-is, signed by whichever side of the hip midline the camera happens to place positive x on.

## D2 — Backend gate ordering: scale-first, footstrikes-second

`computeStepWidthCm` checks `frames.some((f) => isUsableScale(f.pixelsPerMeter))` BEFORE calling
`detectFootstrikes`, mirroring `computeVerticalOscillationCmMetric`'s ordering (backend gate
first, calculation second) rather than `overstriding`'s ordering (body-scale check first,
footstrike detection second, since overstriding's normalizer IS the body-scale check). The reason
is the same one `verticalOscillationCm`'s module doc gives: a MoveNet clip should get exactly one
clear "wrong backend" caveat, never a confusing "no footstrikes could be detected" message for a
clip whose footstrikes actually tracked fine — the two failure modes read very differently to a
user and must not be conflated.

## D3 — View-gating: front/rear-primary, mirroring `armSwingSymmetry`, not `overstriding`

`overstriding` is side-primary because it reads a fore-aft (sagittal) offset, invisible face-on.
`stepWidthCm` reads a mediolateral (side-to-side) offset — the opposite geometry, same failure
mode in the opposite view: a side-on camera collapses the ankle's true lateral position onto the
same image-x coordinate the hip occupies (both project onto the sagittal axis, not the camera's
x-axis), producing a confidently-wrong small number rather than an obviously-degraded one. This is
`armSwingSymmetry`'s own argument for its identical front-primary/side-unsuitable gating, restated
for a different keypoint pair. `viewFitTable.stepWidthCm` copies `viewFitTable.armSwingSymmetry`'s
multipliers exactly (front `1.0`, side `0.1`, ambiguous `0.2`), not merely similarly-shaped ones.

## D4 — No separate `scaleCoverage` confidence factor

`computeMetricConfidence` already has an optional `scaleCoverage` parameter (added for
`verticalOscillationCm`, D2 of that change) for "what fraction of considered frames carried a
measured scale, as a concern distinct from `frameCoverage`." `stepWidthCm` does NOT use it, and
this is a deliberate omission, not an oversight: `verticalOscillationCm`'s `frameCoverage` comes
from a coverage-only hip-bounce call that is agnostic to scale entirely (a hip position can resolve
on a frame with no scale measurement, and that frame still counts toward `frameCoverage`) — so
`scaleCoverage` exists there to catch a fact `frameCoverage` cannot see. `stepWidthCm`'s
`frameCoverage` is different: it is `usableStrikeCount / candidateStrikeCount`, and
`usableStrikeCount` ALREADY excludes any candidate whose frame lacked a usable scale (alongside
missing hip/ankle) — see `computeStepWidthCm`'s loop, which `continue`s past a candidate on
`!isUsableScale(frame.pixelsPerMeter)` before ever pushing to `offsetsCm`. A missing scale is
already fully priced into `frameCoverage` by construction; multiplying by a second `scaleCoverage`
factor derived from the same missing-scale frames would double-penalize the identical fact once
through `frameCoverage` and again through `scaleCoverage`.

## D5 — Scale-pass graft: extend, don't scope out

`src/results/scalePassGraft.ts`'s `graftScalePassResult` was hardcoded to backfill only
`verticalOscillationCm` from the background MediaPipe scale pass. Two options were on the table for
`stepWidthCm`:

1. **Extend the graft** to backfill both metrics from one completed pass.
2. **Scope `stepWidthCm` to MediaPipe-primary-only** for v1 — no scale-pass backfill, only visible
   when the user's active backend already measures scale.

Extension was chosen. The reasoning:

- **The gate for even running the pass costs nothing new.** `useVideoAnalysis.ts` decides whether
  to run the background pass at all by checking `heuristics.verticalOscillationCm.calibration !==
  null` — this is already testing the underlying fact ("did this frame's backend measure
  `pixelsPerMeter`") that gates `stepWidthCm` too. There is no world where the pass should run for
  `verticalOscillationCm`'s sake but not `stepWidthCm`'s, or vice versa — they key off the identical
  per-frame capability. Scoping `stepWidthCm` out would mean computing it anyway (orchestration
  computes every metric unconditionally) and then deliberately discarding a value the pass already
  produced, for no efficiency gain and a real UX cost (a MoveNet user on a workable clip would see
  vertical oscillation resolve to a number but step width stay permanently "not available," despite
  the app having just measured everything it needed for both).
- **The two metrics graft independently, not as a bundle.** `graftScalePassResult` doesn't gate
  `stepWidthCm`'s graft on `verticalOscillationCm`'s success or vice versa — each is pulled from
  the scale pass's own result and gets its own provenance-appended caveat via a small shared
  `withProvenance` helper. A pass that measured scale broadly (so `verticalOscillationCm` fits a
  clean bounce) but whose replay happens to miss every footstrike (so `stepWidthCm` finds none)
  still grafts BOTH: a real `verticalOscillationCm` value, and `stepWidthCm`'s own null value with
  its own "no footstrikes" caveat plus the provenance sentence — never silently withholding the
  successful metric because the other one came up empty, and never inventing a footstrike-detection
  outcome the pass didn't actually produce.
- **Cost is proportional to benefit.** The change to `graftScalePassResult` itself is a few lines
  (a generic `withProvenance<T extends MetricResult>` helper plus one more field in the returned
  object) — smaller than a "why is this metric special-cased out" comment would need to be.

## D6 — Results UI: count-based status line, not a second hardcoded "one more metric" string

`ResultsView`'s ready-phase status line previously derived its "added one more metric" copy from
`heuristics.verticalOscillationCm.value !== null` alone — true when only one scale-pass-backed
metric existed. With two, that check would silently undercount whenever `stepWidthCm` also gained
a value (or overcount narratively, always saying "one" regardless of how many actually resolved).
The fix computes `addedMetricCount` as `[verticalOscillationCm.value !== null, stepWidthCm.value
!== null].filter(Boolean).length` and pluralizes off it: `0` → the existing "couldn't add"
sentence, `1` → "added 1 more metric," `2` → "added 2 more metrics." The in-progress phrasing
(`'pending'`/`'running'`) softens from "one more metric" to "more metrics" — count-agnostic,
since which of the two metrics (if either) will end up gaining a value isn't knowable until the
pass concludes, and a wrong-count in-progress sentence would need correcting the moment the count
becomes known regardless.

## Not built

- **A dedicated `stepWidthCmCalibration`-style richer diagnostics shape.** Nothing analogous to
  `AnalysisDiagnostics.scaleCalibration` was added for `stepWidthCm` — its `MetricResult` fields
  ARE its full diagnostic surface (no fit, no drift ratio, no integration-run count to expose).
- **A `stepWidth.ts` (pixel-ratio) change of any kind.** Issue #46, separate ticket/worktree,
  untouched here per the assigned boundary.
