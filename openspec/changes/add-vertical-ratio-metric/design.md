## Context

Epic #33 splits vertical oscillation into a family of metrics sharing one bounce estimate (the
hip-bounce spectral fit in `hipBounce.ts`), each with its own denominator. This change ships the
third family member: `verticalRatio` = bounce / stride length, the quantity consumer running
watches report as "Vertical Ratio". It needs a stride-length extractor that doesn't exist yet, and
a policy layer that reuses the fit `verticalOscillation` already computes rather than re-deriving
it (a second re-fit would risk drifting from the number the results panel shows next to it).

## D1 — `strideLength.ts`: extractor, not policy

`estimateStrideLength(frames, config)` returns a discriminated result:

```ts
export type StrideLengthFailureReason =
  | 'no-body-scale' | 'travel-direction-unknown' | 'too-few-footstrikes' | 'no-usable-pairs'
export type StrideLengthResult =
  | { ok: true; strideLengthPx: number; pairCount: number; candidatePairCount: number }
  | { ok: false; reason: StrideLengthFailureReason }
```

Gate order, and why it's this order:

1. `estimateBodyScale` → `no-body-scale`. Nothing downstream is computable without a torso-length
   reference (footstrike prominence thresholding needs it too).
2. `estimateTravelDirection === 0` → `travel-direction-unknown`. **Checked before footstrike
   detection**, not after — on an approach/indeterminate clip, footstrikes might still detect fine
   (ankle-y prominence doesn't need travel direction), but every resulting pair would be
   unusable (step 4 requires signed-positive displacement, which is meaningless without a known
   sign). Gating here means the caveat a caller surfaces is "direction of travel could not be
   determined", not a confusing "no usable pairs" that hides the real reason.
3. `detectFootstrikes(frames, config)` as-is (no reimplementation), partitioned by side.
   `candidatePairCount = Σ max(0, n_side − 1)` — the count of consecutive-pair opportunities before
   any pair is thrown out for a resolution failure or non-advancing displacement.
   `candidatePairCount === 0` → `too-few-footstrikes`.
4. For each side's consecutive footstrike pair `(i, i+1)`: resolve hip-mid x at both strike frames
   via `resolveMidpoint`. Either unresolvable → skip the pair (contributes to
   `candidatePairCount − pairCount` but not a separate failure reason — see D5). Otherwise
   `d = (x_{i+1} − x_i) × travelDirection`; keep only `d > 0`. Signing by `travelDirection` first
   handles a runner moving in the screen's negative-x direction identically to positive-x; filtering
   `d > 0` after that sign-correction rejects a pair whose *measured* displacement doesn't advance
   in the runner's own travel direction — such a pair isn't a real stride (mid-clip backward drift,
   a misdetected footstrike, camera shake) and would also otherwise risk a zero-or-negative
   denominator downstream in `verticalRatio.ts`.
5. Empty result set → `no-usable-pairs`. Otherwise: `{ ok: true, strideLengthPx: median(d),
   pairCount: d.length, candidatePairCount }`.

**No re-pairing across a dropped strike.** If strike `k+1` is dropped (step 4), the extractor does
NOT fall back to pairing `k` with `k+2` — that interval spans two real strides, not one, and
silently averaging it into the same `d` array as genuine single-stride intervals would manufacture
a doubled data point indistinguishable from a real one. Losing that pair (reflected in
`pairCount < candidatePairCount`) is honest; inventing a same-shaped-but-wrong value is not.

### Doubling behavior (not fixed, only bounded and named)

`detectFootstrikes` can miss a real footstrike (e.g. a partial occlusion that suppresses one
side's ankle-y extremum below the prominence threshold for one cycle). When that happens, the
*next* detected footstrike on that side is two strides after the previous one, not one — so its
pairwise `d` is roughly double a normal stride length, not caught by any check here (the
displacement is still positive, still "advancing", just describing two strides instead of one).

This is bounded, not eliminated, by taking the **median** rather than the mean: as long as fewer
than half of a side's consecutive pairs are doubled, the median lands among the genuine
single-stride values and is unaffected. The residual bias when a doubled interval does slip
through skews the reported `strideLengthPx` **HIGH** relative to the true stride length — and
since `verticalRatio.value = bounce / strideLengthPx`, an inflated denominator means the reported
ratio reads **LOW** (a runner would look like they bounce less, per stride, than they actually do).
Direction matters for anyone debugging a ratio that looks implausibly good.

### Rejected: gap-tolerance rules (D5 continued)

Two alternatives were considered and rejected for this change, not because they're wrong in
principle but because neither has a trigger yet:

- **Unrecoverable-ankle-gap drop**: track whether either side's ankle position was
  `'unrecoverable'` (not just `'interpolated'`) across the *span* between two consecutive
  footstrikes, and drop the pair if so — a missed footstrike is far likelier when the tracker lost
  the ankle entirely for a stretch than when it merely interpolated through a brief gap. Rejected
  for now: needs its own confidence-in-detection signal per span, which `detectFootstrikes`
  doesn't currently expose (it reports footstrike instants, not span-level tracking quality), and
  no clip in this session's evidence base actually exhibited this failure mode to calibrate
  against.
- **Fit-period multiplicity correction**: compare each pair's `d` against the *median* `d` and
  halve any pair that's suspiciously close to 2× the median (or discard it) — a purely statistical
  correction needing no additional tracking signal. Rejected for now: on a short clip (the kind
  epic #33's park-clip investigation flagged as too noisy for confident per-half-cycle
  normalization already — see `CLAUDE.md`'s vertical-oscillation investigation) a "suspicious 2×"
  threshold has no calibrated boundary, and misclassifying a genuinely long single stride as a
  doubled pair would silently halve a real value.

**Trigger for revisiting either**: live verification (see tasks.md) recording `pairCount` across
several trials of the track clip — if `pairCount` medians consistently land below
`MIN_STRIDE_PAIRS` (3, see D3) in practice, that's evidence the gap-tolerance question needs an
answer rather than remaining deferred.

## D2 — `verticalRatio.ts`: policy

`computeVerticalRatio(frames, view, config): MetricResult`:

1. `viewFitEntry = config.viewFitTable.verticalRatio[view]` (see D4).
2. `analyzeHipBounce(frames, config)` — **hip-pinned**, not `analyzeBounceSignal` with the
   configured `verticalOscillationSignal` pair. This is deliberate: `verticalOscillationSignal`
   ('hipMid' | 'earMid') is a per-run choice for the `verticalOscillation` metric specifically (see
   that config key's doc in `types.ts`), and letting it silently retarget `verticalRatio`'s
   numerator too would mean an operator flipping that setting changes what physical quantity this
   metric reports without changing its name or unit. `verticalRatio` always measures hip bounce
   over hip-consistent stride length, regardless of what `verticalOscillation` is currently
   configured to chart.
   - `resolvedCount === 0`, or `!fit.ok`, or `fit.sinusoidR2 < config.verticalOscillationMinFitR2`
     → `nullResult`, with wording mirroring `verticalOscillation.ts`'s `caveatForFailure` (hip-
     specific — `SIGNAL_LABEL.hipMid`-equivalent text, not parameterized by a signal choice since
     there's only ever one signal here).
3. `estimateStrideLength(frames, config)` → `!ok` maps each `StrideLengthFailureReason` to a
   caveat. `travel-direction-unknown` produces, **verbatim, not built from a shared template**:

   > "Direction of travel could not be determined (no net horizontal displacement) — stride length
   > is not observable from this camera angle, so vertical ratio cannot be computed."

   Deliberately not a shared constant with `overstriding.ts`'s or `footStrikePattern.ts`'s own
   travel-direction caveats: those two already duplicate the "direction of travel could not be
   determined (no net horizontal displacement)" prefix inline, each with a different tail describing
   what specifically becomes unreliable for that metric. Introducing a shared constant now would
   mean editing three call sites to adopt it (out of scope — see the ticket's boundary: "overstriding
   /footStrikePattern files: zero diff") for a DRY gain that isn't this change's to take.
4. `value = fit.peakToPeakAmplitude / stride.strideLengthPx` — **exactly this expression**, no
   `× 100` (unit `'percent'` is a 0..1 fraction per its existing type-level contract — `MetricsPanel`'s
   `formatValue` already multiplies by 100 for `'percent'`, so multiplying here too would double it),
   no intermediate rounding (a drift-guard test asserts `toBe`, not `toBeCloseTo`).
5. `sampleSize = stride.pairCount`. `frameCoverage`/`interpolatedFraction` come from the bounce
   analysis (the hip-bounce fit's own resolution stats — the metric's numerator is the harder-to-
   resolve half of this ratio in practice, since stride length only needs two footstrike instants
   rather than a whole-clip trace).
   `confidence = computeMetricConfidence({ viewFitMultiplier, frameCoverage, interpolatedFraction,
   sampleSize: stride.pairCount, minRequiredSampleSize: MIN_STRIDE_PAIRS, fitQuality,
   interpolationConfidencePenalty })` where `fitQuality` is the identical ramp
   `verticalOscillation.ts`/`cadence.ts` already use:
   `clamp01((fit.sinusoidR2 − verticalOscillationMinFitR2) / (0.8 − verticalOscillationMinFitR2))`.
   `travelDirectionKnown` is **NOT passed** — see D6.
6. Caveats (joined with a space, same convention as every other metric in this package): below-
   `MIN_STRIDE_PAIRS` pair count; fit quality below the 0.8 saturation point; `pairCount <
   candidatePairCount` (some pairs were dropped — see D1's doubling-bias note, named so a reader
   with an implausible-looking ratio has somewhere to look); viewFit `'unsuitable'`.

## D3 — `MIN_STRIDE_PAIRS = 3` and its upgrade trigger

Set to 3, matching `verticalOscillationMinCycles`'s reasoning, not `MIN_CADENCE_STEPS`'s (4) or
`MIN_OVERSTRIDE_SAMPLE_SIZE`'s (4): a **median** becomes a genuine rank statistic (not just an
average of 1–2 points) starting at `n = 3` — the smallest sample where "the middle value" means
something distinct from "the only value" or "an average of two". The dominant error mode this
metric faces (D1's doubling bias) is a single outlier-shaped value, not a diffuse noise floor, so
a rank-statistic defense (the median simply ignoring an outlier once there's a majority of clean
values around it) is the right shape of protection, and 3 is the minimum sample size where that
protection exists at all.

This is a **judgment call pending live evidence**, not a derived number the way
`verticalOscillationMinFitR2`'s noise-floor calibration is. The task list's live-verification step
records `pairCount` per trial specifically so a future session has real numbers to check this
against: if live trials on real clips consistently land at `pairCount` of 3–4 (barely clearing the
gate) rather than comfortably above it, that's a sign either the minimum should rise (fewer, more
reliable pairs preferred over confidence-discounted marginal ones) or the doubling-bias mitigations
deferred in D1 need to stop being deferred. This design intentionally ships without resolving that
question — it needs the live numbers first.

## D4 — `viewFitTable.verticalRatio`

```
side:      { fit: 'primary',    multiplier: 1.0 }
front:     { fit: 'unsuitable', multiplier: 0.1 }
ambiguous: { fit: 'unsuitable', multiplier: 0.2 }
```

Argued from stride *observability*, not copied from `overstriding`'s or `trunkLean`'s identical-
looking numbers (though they land the same): `verticalRatio`'s numerator (hip bounce, from the
same fit `verticalOscillation` uses) is view-*tolerant* — vertical motion projects onto image-y
similarly regardless of facing direction. Its **denominator** is not: stride length is a fore-aft
(sagittal) displacement, which foreshortens toward zero as the camera angle turns away from side-
on. A foreshortened denominator doesn't just add noise — it systematically **shrinks**, which
**inflates** the ratio. That combination (a view-tolerant numerator paired with a view-degenerate
denominator) is worse than either alone: a front-view reading wouldn't look obviously wrong the way
a fully-degenerate metric would, it would look like a confidently-reported, plausible, and wrong
number. `'unsuitable'`, matching the hard-gated sagittal metrics, is the only honest classification.

In practice this table entry mostly documents intent — `estimateTravelDirection` already returns
`0` (indeterminate) on most front-view footage (no net horizontal hip displacement when facing the
camera), which independently nulls the metric via `strideLengthPx` before the view-fit multiplier
would ever matter. The table entry matters for the narrower case of a front-view clip that
happens to have *some* net horizontal drift (a runner crossing the frame at a slight angle) —
`estimateTravelDirection` would return a direction there, `estimateStrideLength` would produce a
number, and the view-fit discount is what keeps that number from reading as trustworthy.

`ambiguous` gets 0.2, not 0.1: `viewDetection.ts`'s `'ambiguous'` label already means "the two
independent signals disagreed" — genuine uncertainty about the camera angle, not a confident
front-view read. A clip that's ambiguous between side and front is weaker evidence against
`verticalRatio` being meaningful than a confidently-front clip is, mirroring the exact same
0.1/0.2 split every other hard-gated sagittal metric (`trunkLean`, `overstriding`, `kneeFlexion`,
`footStrikePattern`) already uses for the identical reason.

## D5 — see D1 ("Doubling behavior" and "Rejected: gap-tolerance rules")

Kept under D1 rather than split out, since both are about the same failure mode (a missed
footstrike) at the same site (the pairwise displacement list) — splitting them into a separate
numbered section would separate two halves of one argument.

## D6 — No `verticalRatioMinFitR2`; gate reuse from `verticalOscillationMinFitR2`

`verticalRatio`'s numerator (`fit.peakToPeakAmplitude`) comes from the exact same
`analyzeHipBounce` fit `verticalOscillation` computes when `verticalOscillationSignal` is at its
default `'hipMid'` (and, per D2, ALWAYS — `verticalRatio` doesn't follow that setting). Introducing
a second, independently-tunable `verticalRatioMinFitR2` would let the two metrics disagree about
whether the *identical* amplitude number is trustworthy — an incoherent outcome a reader can't make
sense of ("why does the panel say my bounce is measurable for one card and not the other, when
they're computed from the same fit?").

**Invariant**: under the default config, `verticalRatio.value !== null` implies
`verticalOscillation.value !== null`. (Not the converse — `verticalRatio` has its own additional
gate, `estimateStrideLength`'s travel-direction/footstrike requirements, that
`verticalOscillation` doesn't share.) This only holds because `verticalRatio.ts` reuses
`config.verticalOscillationMinFitR2` verbatim rather than a separately configured value — if a
future config override set the two thresholds differently, the invariant would need restating.
Not asserted as a runtime check (that would require `verticalRatio.ts` to import
`verticalOscillation.ts` or vice versa, an unwanted coupling for two peer metrics that just happen
to share a config key) — documented here and exercised by `index.test.ts`'s drift-guard instead.

## D7 — Fraction vs. percent

`unit: 'percent'` already has an established meaning in this codebase, from `armSwingSymmetry`: "a
dimensionless 0..1 comparison ... NOT a fraction of torso length" (`types.ts`'s doc on
`MetricResult.unit`). `verticalRatio.value` fits that contract exactly — it's a ratio of two pixel
quantities in the same pixel space (real-world scale cancels, the same trick `verticalOscillation`
and `overstriding`'s torso-length normalization already rely on), reported as the raw 0..1
fraction. `MetricsPanel.tsx`'s `formatValue` already renders any `'percent'`-unit value as
`(value * 100).toFixed(1)%` — no formatting-layer change needed, and `types.ts`'s `unit` doc
comment is updated to note it's no longer solely `armSwingSymmetry`'s case.

## D8 — Watch-comparability: PENDING

The prior investigation (`CLAUDE.md`, "Stride-length normalization" section) inferred that the
user's "~10%" ground-truth reading is likely a Vertical-Ratio-shaped quantity (VO_cm / stride_cm ×
100) because it was given as a percentage — but this was **never confirmed with the user**, and
this pipeline's `verticalRatio` doesn't even use centimetres (pixel-space ratio, real-world scale
cancels — see D7) so it isn't literally the same computation a watch performs, only the same
*ratio concept*. The spec delta's requirement text states this explicitly as a pending
confirmation, not a validated match. This change ships the metric on its own correctness/
observability merits (same-pixel-space ratio, properly view-gated, sharing the VO family's one
fit) — not as a claimed reproduction of any specific watch's algorithm.

## D9 — `LowConfidenceBanner`'s derived metric-id list

Prior to this change, `LowConfidenceBanner.tsx` hand-wrote a `METRIC_IDS` tuple duplicating every
key of `METRIC_LABELS` (`metricConfidence.ts`) — the exact class of enumeration site this ticket's
own MetricId widening has to touch by hand. Replaced with
`Object.keys(METRIC_LABELS) as MetricId[]`: `METRIC_LABELS` is typed `Record<MetricId, string>`,
so the compiler already enforces it has exactly one entry per `MetricId` (adding a metric to
`MetricId` without adding it to `METRIC_LABELS` is a type error today) — deriving the banner's
enumeration from those keys makes it impossible for the banner to silently omit a metric the way a
second hand-written list could. `Object.keys` iterates own enumerable string keys in insertion
order, and `METRIC_LABELS` is declared in the same family-adjacent order every other `MetricId`
enumeration in this codebase uses, so the resulting behavior — which metrics can appear in the
banner's flagged list, and in what order — is unchanged; only the maintenance burden moves.

## Diagnostics: no new field needed

`verticalOscillationFit.peakToPeakAmplitudePx / verticalRatio.value` recovers the stride length in
pixels live from data `analysisDiagnostics.ts` already exports — `verticalRatio.value = bounce /
strideLengthPx`, so `strideLengthPx = bounce / value`, and `bounce` is already
`verticalOscillationFit.peakToPeakAmplitudePx` (same fit, D6's invariant). No new diagnostics field
is added for this; the live-verification step in tasks.md derives stride-length-in-pixels this way
when reporting trial results.
