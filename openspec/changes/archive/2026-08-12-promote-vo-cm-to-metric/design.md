## Context

Epic #33's vertical-oscillation family is one bounce estimate reported through three denominators:
`verticalOscillation` (÷ torso length, #28), `verticalRatio` (÷ stride length, #35), and — as of
this change — `verticalOscillationCm` (÷ nothing; an absolute centimetre figure, #34's calculation
promoted to a real metric). `computeVerticalOscillationCm` (#34) already does the hard part
correctly: per-integration-run spectral fits over a pixel→metre-converted series, aggregated by a
sample-count-weighted median. This change adds nothing to that calculation — it wraps it in the
same policy shape (`MetricId`, view-fit, confidence, caveats) `verticalOscillation`/`verticalRatio`
already have, reusing their precedent rather than inventing a fourth confidence recipe.

## D1 — `MetricResult` carries the calibration; single-compute is a reference-identity invariant

`verticalOscillationCm.ts` gains `computeVerticalOscillationCmMetric(frames, view, config):
VerticalOscillationCmResult`, calling the existing `computeVerticalOscillationCm(frames, config)`
**exactly once**:

```ts
interface VerticalOscillationCmResult extends MetricResult {
  metric: 'verticalOscillationCm'
  calibration: ScaleCalibratedVerticalOscillation | null // non-null iff measured scale existed
}
```

`index.ts` appends `verticalOscillationCm: computeVerticalOscillationCmMetric(frames, view.view,
config)` **after** `verticalRatio` — not inserted between `verticalOscillation` and
`verticalRatio`. #35's shipped orchestration requirement ("`verticalRatio` sits immediately after
`verticalOscillation`") stays literally true by construction; inserting `verticalOscillationCm`
between them would require re-verifying it instead.

`useVideoAnalysis.ts` deletes its direct `computeVerticalOscillationCm` call and the "one trim,
shared" comment that justified it (the second-call risk it guarded against no longer exists — there
is only one call left, inside `computeFormHeuristics`), and calls
`computeAnalysisDiagnostics(sorted, robustFrames, heuristics)` — three arguments, not four.

## D1b — `computeAnalysisDiagnostics` drops its 4th parameter

Signature reverts to `(samples, robustFrames, heuristics)`. The `scaleCalibration` block is derived
via conditional spread from `heuristics.verticalOscillationCm.calibration` (the absent-key contract
is unchanged: still omitted, not `null`, when no scale was measured). This makes no-double-compute
a **reference-identity invariant**, not a convention: `diagnostics.scaleCalibration ===
heuristics.verticalOscillationCm.calibration` holds whenever the key is present, because there is
structurally nowhere left for a second computation to happen.

## D2 — Confidence

Computed only when `calibration !== null` and `calibration.verticalOscillationCm !== null`
(both null branches force `confidence: 0`, per the shared contract):

- **`viewFitMultiplier`**: new `viewFitTable.verticalOscillationCm` row — side 1.0 / front 0.85
  tolerated / ambiguous 0.6 tolerated, **identical to `verticalOscillation`'s row**, not merely
  similar. The numerator (hip bounce) is the same view-tolerant quantity `verticalOscillation`'s own
  view-tolerance argument covers. Unlike `verticalRatio`, this metric has no denominator to be
  dragged down by camera angle — `verticalRatio` is hard-gated specifically because ITS denominator
  (stride length, a fore-aft displacement) foreshortens away from side-on, which this metric doesn't
  have at all. Torso foreshortening under camera angle IS real, but it lands in the SCALE
  calibration (`torsoMeters`/`scaleCoverage`) as a trunk-TILT effect visible from side view too (any
  torso lean foreshortens its own on-screen projection) — not a camera-angle-specific effect — so
  it's handled by the scale-coverage/fit-quality confidence factors below, not a view-fit discount.
- **`frameCoverage`/`interpolatedFraction`**: from a **second, coverage-only** call to
  `analyzeHipBounce(frames, config)` — the `verticalRatio.ts` precedent for reusing the shared
  bookkeeping without a second bounce estimate. The call site comments this emphatically: its own
  `fit` field is deliberately unused, and the amplitude/fit-quality this metric reports come
  exclusively from `calibration`, computed once (D1). This is an accepted, precedented redundancy —
  `hipBounce.ts`'s own module doc already documents that `cadence`/`verticalOscillation`/
  `verticalRatio` each independently re-run the identical sub-millisecond grid search rather than
  share one computed result through the orchestrator.
- **`sampleSize`**: the **fractional** summed `observedCycles` (a new field on
  `ScaleCalibratedVerticalOscillation`, since the previously-exposed `sampleSize` is already floored
  — `Math.floor(observedCycles)`, summed across contributing runs) — never the floored field, for
  the identical reason `verticalOscillation.ts` uses its own fit's unfloored `observedCycles` for
  confidence: flooring first turns a difference smaller than the fit's own frequency resolution into
  a confidence cliff. Compared against `config.verticalOscillationMinCycles` (3).
- **`fitQuality`**: the same `clamp01` ramp every sibling uses, `FIT_QUALITY_SATURATION_R2 = 0.8`,
  over `calibration.fit.sinusoidR2` (the winning run's fit — the only fit behind the reported
  amplitude).
- **`scaleCoverage`**: `calibration.scaleCoverage`, via a **new optional parameter** on
  `computeMetricConfidence` (`confidence.ts`) — default 1 (irrelevant for every metric that doesn't
  depend on measured scale), linear multiply, documented in that function's factor enumeration
  alongside the precedent `travelDirectionKnown`/`fitQuality` params. This is the first
  metric-specific confidence factor the family has needed beyond the existing set — no sibling
  metric depends on a per-frame measured scale.

**Null cases** (`confidence: 0`):

- `calibration === null` (no frame in the clip carried a measured scale — every backend but
  MediaPipe Pose Landmarker, or a MediaPipe clip whose measurement happened to fail everywhere;
  these are indistinguishable to the calculation, so they share one caveat): the availability
  statement, verbatim —

  > No real-world scale was measured for this clip, so bounce can't be reported in centimetres —
  > that needs a pose-detection backend that measures real-world scale (today, MediaPipe Pose
  > Landmarker). Vertical oscillation and vertical ratio measure the same bounce without it.

  Layout-independent by design (#37's problem is presenting this well, not this ticket's), and
  covers the empty-frames case with no special branch (`computeVerticalOscillationCm([])` already
  returns `null` — `scales.length === 0`).
- `calibration.verticalOscillationCm === null` (scale WAS measured, but no run cleared the quality
  gate): a compiler-exhaustive switch over `ScaleCalibratedFitFailureReason`, mirroring
  `verticalRatio.ts`'s `caveatForBounceFailure` pattern —

  | reason | caveat |
  |---|---|
  | `too-few-samples` | "Hip position was tracked in too few frames, in any continuous stretch, to fit a bounce rhythm." |
  | `insufficient-cycles` | "Hip position was tracked, but no continuous stretch was long enough to contain a complete bounce cycle." |
  | `degenerate-signal` | "Hip position was tracked, but the scale-converted trace showed no oscillating vertical motion to measure." |
  | `below-quality-gate` | "Hip position and scale were both measured, but no continuous stretch produced a consistent bounce rhythm (fit quality below the 0.30 minimum)." |
  | `no-usable-run` | "No continuous stretch of hip tracking carried a real-world scale, so bounce could not be converted to centimetres." |

**Degraded-but-non-null caveats** (joined with a single space when more than one applies):

- Cycles shortfall: `calibration.sampleSize < verticalOscillationMinCycles`.
- Fit quality below saturation: `calibration.fit.sinusoidR2 < FIT_QUALITY_SATURATION_R2`.
- `integrationRuns > 1`: "Bounce was measured across N separate tracked stretches; the reported
  figure comes from the most representative one." — names that the figure is a SELECTION, not a
  blend (matching `computeVerticalOscillationCm`'s own `selectWeightedMedianFit` semantics).
- `scaleCoverage < 0.995`: a formatting-driven cutoff, chosen so this caveat never fires for a clip
  that would display as a full "100%" anyway (`(coverage * 100).toFixed(0)`).

**Not added**: a `torsoMeters` plausibility caveat (e.g. flagging a wildly non-~0.5m estimate).
Upgrade trigger: any live clip whose `torsoMeters` lands outside roughly 0.35–0.70m — none has been
observed yet, so this stays a recorded follow-up rather than a speculative implementation.

## D3 — Delete `CM_MIN_FIT_R2`; read `config.verticalOscillationMinFitR2`

No new config key. `verticalRatio`'s own binding precedent applies at full force here: two gates on
the identical fitted amplitude is incoherent, not just redundant — a clip's fit either clears the
bar or it doesn't, and letting two independently-tunable thresholds disagree about the SAME number
would mean the family could contradict itself about whether its own shared bounce is trustworthy.
The cm series is an affine image of the pixel series under constant scale, so `sinusoidR2` is the
same quantity either path reads it from — live-verified during the #34 investigation: 0.4860
(pixel path) vs. 0.4886 (centimetre path) on the same real clip, a difference attributable to
per-run vs. whole-clip fitting, not to the quantity being different.

The n-regime caveat `CM_MIN_FIT_R2`'s own doc carried (the pure-noise floor climbs steeply as
sample count falls, and because this calculation fits per integration run rather than once per
clip, a fragmented clip can reach `fitSpectralSinusoid`'s 12-sample floor where the gate stops being
protective) is kept as a comment at the gate call site, not lost with the deleted constant.

`types.ts`'s doc on `verticalOscillationMinFitR2` gains a third-consumer note (why the reuse is
sound here, on the same terms `cadenceMinFitR2`'s doc already argues for cadence). Its doc on
`verticalOscillationSignal` gains one clause: `verticalOscillationCm` reads the config it's handed
for the shared spectral grid AND now the shared gate, but never for signal selection — it stays
hip-anchored unconditionally regardless of that setting.

**Defaults are unchanged, so live output must be bit-identical to before this change** — the
2026-08-12 `CLAUDE.md` investigation's track-clip anchor (4.78–4.79 cm) is the regression check.
Movement there means the plumbing broke, not that a threshold moved — investigate, never
re-baseline against a new number.

## D4 — Unit, format, order, label

`MetricResult.unit` widens with `'centimeters'` (American spelling — matches every identifier in
this codebase that names the unit, e.g. `verticalOscillationCm`, `peakToPeakAmplitudeCm`). It's an
ABSOLUTE physical quantity with no denominator — documented as the one unit in the union that isn't
relative to anything about the runner's own body, unlike `'ratio'`/`'percent'`/`'degrees'`.

`MetricsPanel.tsx`'s `formatValue` gets one new branch: `` `${value.toFixed(1)} cm` `` — no `× 100`
multiply (unlike `'percent'`), no "of torso length" suffix (unlike `'ratio'`). Grep-confirmed this
is the only unit-dispatching switch in the results layer.

Label: `'Vertical oscillation (cm)'`. Order, everywhere a `MetricId` is enumerated:
`verticalOscillation`, `verticalRatio`, `verticalOscillationCm`.

## D5 — (reserved; folded into D2's view-fit reasoning above — no separate section needed)

## D6 — Family coherence is frequency coherence, not object identity

The cm path fits the METRE series (`computeVerticalOscillationCm`'s per-frame-delta integration,
which is what absorbs scale drift); `verticalOscillation`/`verticalRatio` fit the PIXEL series.
These are two different `fitSpectralSinusoid` invocations over two different series — never the
same object, and asserting they are (e.g. via `vi.spyOn` call-count assertions on
`fitSpectralSinusoid`/`analyzeHipBounce`) would pin an implementation detail that's correct to keep
as two independent calls (see `hipBounce.ts`'s own module doc on why the family already accepts this
redundancy) — such a test would fail by design the moment anyone legitimately refactored the
call structure, for no behavioral reason.

What families members genuinely share, and what the coherence test asserts, under a **constant**
scale (the case where a metre series is an exact affine image of the pixel series — `y_m = y_px /
s`, a pure rescaling with no drift for the trend terms to do extra work on): the fitted frequency is
**exactly** equal (an affine rescaling of the fitted series can only move the amplitude, never the
argmin-RSS grid frequency), `sinusoidR2` is close to equal (a ratio of two quantities that both
scale by the same factor, exact up to floating-point noise from evaluating the fit twice
independently), the sample count is identical, and the amplitude relationship is exactly the
documented conversion (`peakToPeakAmplitudePx / scale × 100`).

## D7 — Type relocation (mechanical)

`ScaleCalibratedFitFailureReason`, `ScaleCalibratedFit`, and `ScaleCalibratedVerticalOscillation`
move from `verticalOscillationCm.ts` into `heuristics/types.ts` — doc comments travel with them
unchanged in substance. `types.ts` gains `import type { SpectralFitFailureReason } from
'./spectralFit'` (no cycle: `spectralFit.ts` has no imports from within this package's heuristics
layer). `verticalOscillationCm.ts` re-exports the three names (`export type { ... }`) so any
external caller importing the calibration shape from its original module keeps working —
mechanical, not a behavior change.

Reason for the move: `VerticalOscillationCmResult` is part of `FormHeuristicsResult`, which every
consumer of the heuristics layer sees — not just `verticalOscillationCm.ts` itself. Keeping the
calibration shape's declaration in a leaf module would force every such consumer to import from
that leaf rather than from `types.ts`, the layer's shared vocabulary.

## D8 — Policy layer stays in `verticalOscillationCm.ts`, section-commented

`computeVerticalOscillationCmMetric` is added to the SAME file as `computeVerticalOscillationCm`,
separated by a section comment banner, rather than split into a new module. Reasoning: this
calculation has exactly one consumer of its policy layer (this metric), so there is nothing yet for
a second file to decouple — matching the file-organization precedent every other metric in this
package already follows (extractor and policy co-located when there's one consumer; extractors
split out only once `hipBounce.ts`/`strideLength.ts`-style sharing actually happens). If a second
consumer of the raw calibration ever appears, the extractor (everything above the section comment)
is what moves out, not this layer.

## Risks / follow-ups (not addressed by this change)

- **Banner noise**: MoveNet runs will show `verticalOscillationCm` under
  `LowConfidenceBanner`'s "Lower-confidence results" list — `isMetricFlagged` treats
  "not applicable on this backend" the same as any other flagged metric, since `value === null`
  unconditionally flags. This is #37's problem (presenting "not applicable" distinctly from "low
  confidence"), explicitly not band-aided here — no availability-specific flag, no banner special
  case, per the ticket's own risk register.
- **Pre-registered, not a bug**: on the MediaPipe track clip, the cm card's confidence lands around
  0.37 (the `fitQuality` ramp at `sinusoidR2 ≈ 0.486`, roughly the midpoint between the 0.30 gate
  and the 0.80 saturation point) — flagged below the 0.40 low-confidence line, matching its
  `verticalOscillation` sibling's confidence on the same clip (same fit, same ramp).
- **`torsoMeters` plausibility caveat**: deferred, see D2.
