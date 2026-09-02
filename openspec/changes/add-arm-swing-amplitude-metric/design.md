# Design — add-arm-swing-amplitude-metric

## D1 — Aggregation: the MEAN of the two per-side ratios

The metric's question is "how big is the arm swing", asked of one body with two arms, and the
value is the mean of the two sides' fitted peak-to-peak amplitudes divided by torso length —
equivalently `(left.fit.peakToPeakAmplitude + right.fit.peakToPeakAmplitude) / (2 ×
torsoLengthPx)`. This is the bilateral pooling precedent every both-sides metric here already
follows (`kneeFlexion` and `kneeDrive` pool both legs' peaks before aggregating): the mean
answers "how big" while the sibling `armSwingSymmetry` answers "how even", so the pair is
complementary rather than redundant. Nothing is lost to the mean either — with the symmetry ratio
`r = min/max` published beside a mean `m`, the weaker side is recoverable as `2·m·r / (1 + r)`.

**Rejected — MIN of the two sides**: redundant with the symmetry metric (a low min IS a low
symmetry whenever the other side is normal) and it headlines the worst-measured number — on
footage where one arm tracks worse (Demo 2: right R² 0.497 vs left 0.778), the min is usually the
noisier side's amplitude, so the card would report the fit least worth trusting.

**Rejected — report both sides**: a two-number `value` is a new result shape for one metric;
`MetricResult.value` is a single number across all twelve existing metrics and every consumer
(tiers, fusion, formatting, diagnostics) assumes it.

## D2 — Confidence: every input the WORSE side's; the weaker-side R² gates AND ramps

The two arm metrics read the identical per-side fitted signal, so they SHARE gate policy
(mandated by the ticket; the mechanism is Phase A's shared module):

- **Gate**: weaker-side `sinusoidR2 < config.armSwingMinFitR2` → `value: null`. Same key, same
  reasoning as the symmetry metric — below the gate the weaker fit's amplitude describes noise,
  and a mean over one real amplitude and one noise amplitude is not an arm-swing amplitude.
  No new constant (the two-gates-on-one-signal bug class #36 deleted).
- **Ramp**: `fitQuality` ramps the weaker side's R² from `armSwingMinFitR2` to the shared
  `FIT_QUALITY_SATURATION_R2`, exactly as the symmetry metric does.
- **Coverage/interpolation/cycles**: `frameCoverage = min(resolvedCount) / frames.length`,
  `interpolatedFraction = max(per-side fractions)`, `sampleSize = min(observedCycles)` (fractional
  into `computeMetricConfidence`, floored for the result), `minRequiredSampleSize =
  MIN_ARM_SWING_CYCLES` — all the worse side's, for the symmetry module's own stated reason: the
  case that must not read as confident is one arm measured materially worse than the other, and
  averaging hides exactly that case.

**Family coherence is the point**: with identical inputs the two arm cards null together and
carry the same confidence — on Demo 2 both are expected bit-identical at 0.3846 (a soft check in
D3). A reader must never see a confident amplitude beside a withheld symmetry (or vice versa) for
the same two fits.

**Disparity caveat mirrored with amplitude wording**: when the two sides' R² differ by more than
the shared `SIDE_FIT_QUALITY_DISPARITY_R2`, the caveat reads "One arm was tracked noticeably
better than the other in this clip, so part of this overall swing size may reflect measurement
rather than form." — same trigger, same structure as the symmetry metric's, reworded because the
thing contaminated is the magnitude, not the difference.

**Rejected — amplitude-weighted R²** (weighting each side's fit quality by its amplitude share):
it lets a large well-fitted swing buy confidence for a small noise-fitted one, which is the
averaging failure D2 exists to prevent, with extra steps.

## D3 — Pre-registered live verification rules (registered BEFORE any Phase-B run)

Fresh-process regime, 3 trials per clip, all three clips, `scripts/ab-person-selection.mjs
--evidence`, dev server started and identity-verified by the run, real GPU.

1. **Zero cross-trial spread** on every `armSwingAmplitude` field. Any spread → STOP; suspect the
   harness first (foreign server, reused browser), not the metric.
2. **Demo 2 value = (72.80 + 44.16) / (2 × 232.7) = 0.2513 ± 0.005.** The per-side fitted
   amplitudes (left 72.80 px, right 44.16 px) and torso (232.7 px) are the ticket's measured
   baseline for this clip. A miss → STOP and run a one-off add–measure–revert probe printing the
   per-side `peakToPeakAmplitude` and `torsoLengthPx` to localize which factor moved; do not
   tune toward the expectation.
3. **Demo 1**: value non-null in (0, 1), `viewFit` unsuitable (side view) → tier-3 excluded, and
   NO `evidence.armSwingAmplitude` exemplar rows (tier-3 metrics have no card to hang evidence
   on).
4. **multiperson**: `value: null` via the cross-side rhythm mismatch (D6) → tier-3.
5. **Every pre-existing metric bit-identical to the Step-0 baseline** on all three clips —
   `armSwingSymmetry` explicitly so. The expected diff vs baseline is ONLY the header commit
   line, `elapsedMs` rows, and ADDED `armSwingAmplitude` rows.
6. **Soft expectations** (investigate if unequal; not STOP): Demo 2 `armSwingAmplitude.confidence
   === armSwingSymmetry.confidence` (0.3846 — identical worse-side inputs through the same
   formula), and the amplitude metric's exemplar timestamps bit-equal to the symmetry metric's
   (same `buildSideExemplar` on the same fits).

### D3 — Adjudication (recorded after the Phase-B run; measurements pending as of registration)

_To be filled in from `wave2/afterB.txt` vs `wave2/baseline.txt` and the anchor driver, per rule,
after Phase B lands. Registered empty on purpose — the rules above are committed before any live
Phase-B run so the expectations cannot be tuned toward a result._

## D4 — Exemplar: `'armSwingCycle'` REUSED, not a new kind

The evidence for "how big is the swing" is the same picture as the evidence for "how even": the
wrist at the top and bottom of one fitted half-swing, one ghosted pair per side, built by the
shared `buildSideExemplar` from the same fits. `'bounceCycle'` is the precedent — one kind shared
by `verticalOscillation`, `verticalOscillationCm` and `verticalRatio`'s numerator because all
three read the same shape of fit — and the same-shape-of-fit test is exactly satisfied here. A
new kind would add an `INSTANT_MARK_BUILDERS` entry drawing the identical marks, which is a
maintenance liability with no discriminating caption to justify it (`MetricExemplarKind`'s doc:
the kind exists so a caption can say WHICH question the instant answers; top-and-bottom-of-one-
swing is the answer for both metrics). `'armSwingCycle'` stays OUT of `SINGLE_INSTANT_KINDS` —
the pair spans the amplitude being reported, so a demoted single would depict neither extreme of
it, the same argument `stridePair` records.

Zero code changes in `evidenceAnnotations.ts`/`evidenceFrames.ts`. Doc-comment edits only, in
Phase B: `types.ts`'s `'armSwingCycle'` member doc widens to name both consumers (bounceCycle's
doc style), and `armSwingMinFitR2`'s doc names its second consumer.

## D5 — Phase A: extraction scope, and the measured no-op proof

**Extended move set** (the default; the sanctioned fallback if something fights it is the minimal
`SideSwing` + `computeSideSwing` move): `SideSwing`, `computeSideSwing`, `buildSideExemplar`,
`caveatForFailure`, `MIN_ARM_SWING_CYCLES`, `FIT_QUALITY_SATURATION_R2`,
`MAX_SIDE_FREQUENCY_DISAGREEMENT`, `SIDE_FIT_QUALITY_DISPARITY_R2`, `SHOULDER_NAME`/
`WRIST_NAME`/`ELBOW_NAME` — moved VERBATIM (docs included) into `src/heuristics/armSwing.ts`, all
exported; `armSwingSymmetry.ts` keeps only `nullResult` + `computeArmSwingSymmetry` and imports
the rest. No new test file for Phase A — the symmetry suite already exercises every moved line
through its public entry point, and a bit-identical refactor needs a proof, not new coverage.

**The one deliberate difference from the `hipBounce.ts` precedent**: `analyzeBounceSignal`'s
callers each own their gate policy (`verticalOscillationMinFitR2` vs `cadenceMinFitR2` — two keys
on two different questions). The two ARM metrics are MANDATED to share gate policy on the same
fitted signal, so the gate constants live in the shared module rather than per-caller — recorded
in `armSwing.ts`'s module doc.

### D5 — Phase A proof (recorded after the Phase A run)

Measured 2026-09-02 on the extracted tree: `npm test` green (89 files, 1453 tests), `npx tsc -b`
clean, `npm run lint` clean. `diff wave2/baseline.txt wave2/afterA.txt` (each a 3-trial
fresh-process `--evidence` run over demo1/demo2/multiperson, identity-verified server, real GPU
`ANGLE Metal Renderer: Apple M4 Pro`): the ONLY differing lines are the header's commit line
(`d415d0e` → the extraction tree) and the three per-clip `elapsedMs` rows. Every metric value,
confidence, caveat-bearing field, sampling/personSelection field and `evidence.*` row on all
three clips is byte-identical. Phase A is a proven no-op.

Two departures from a strictly verbatim move, both doc-text only: `buildSideExemplar`'s doc now
points its sign-trap assertion at `armSwingSymmetry.test.ts` by name (the moved module has no
test file, so "this module's own tests" would have become false), and `computeArmSwingSymmetry`'s
"Both sides, one rhythm" section names `armSwing.ts` as where `MAX_SIDE_FREQUENCY_DISAGREEMENT`
now lives. No executable line changed in either function.

## D6 — The cross-side rhythm check is REUSED, and why an amplitude metric needs it at all

It is tempting to read `MAX_SIDE_FREQUENCY_DISAGREEMENT` as a symmetry-only concern (a RATIO of
two different oscillations is meaningless; surely a mean is merely fuzzy). The live counterexample
says otherwise: on `multiperson-track.mp4` the right arm's fit lands on the STEP rhythm at
R² 0.324 — which CLEARS the 0.3 gate — while the left fits the stride rhythm (1.48 Hz vs 2.80 Hz,
disagreement 0.892). A mean of an arm-swing amplitude and a step-bounce amplitude is not an
arm-swing amplitude; the R² gate provably does not catch it (0.324 > 0.3), and only the
cross-side check does. So the amplitude metric applies the SHARED bound — never a second,
separately-tuned bound on the same two fits — and nulls with its own wording ("…a single
arm-swing size cannot be measured", vs the symmetry metric's "…their amplitudes are not
comparable"), because the thing that failed is different: not comparability of two amplitudes,
but the existence of one swing rhythm to size.

**Rejected — single-side fallback** (report the stride-rhythm side alone when the other latched
onto the step rhythm): which side found the true rhythm is not decidable from two fits that
disagree — the "wrong" side cleared the same gate the "right" side did — and a one-armed
amplitude presented as the clip's arm swing is a silent half-measurement. Null with a named cause
is the honest result, and it is also what keeps the two arm cards nulling together (D2).
