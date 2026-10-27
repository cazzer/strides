# Vertical oscillation: accuracy, centimetre calibration, signal A/B

> Moved verbatim from CLAUDE.md on 2026-10-27 to keep the auto-loaded file under the size limit. Index: CLAUDE.md "Notes index". Cross-references like "above"/"below" may now point into a sibling file in this directory.

## Vertical oscillation accuracy investigation (2026-08-12)

The `verticalOscillation` metric (`src/heuristics/verticalOscillation.ts`) was suspected of
reading too high (~18-25% of torso length on real clips) — this section records what was tried
against real footage and what's still open. No code changed as a direct result of this
investigation yet (see "Backlog"); the only shipped outcome so far is the second demo button
(`src/video/demo-clips/park-approach.mp4`, added so the front-approach clip below is reproducible
without an upload).

**Hip-only signal vs. a 5-limb blend — blend rejected.** Tried averaging bilateral-pair midpoints
across shoulders/elbows/wrists/knees/ankles (hip excluded) as an alternative center-of-mass
proxy, on the theory that hip keypoints track less reliably than other joints. Manual grid-pixel
measurement against fixed background references (a running track's lane markings, confirmed
static camera) showed the *existing hip-only signal* tracks real visible bounce reasonably
well — manual estimates ran as high or higher than the calculated hip value on both half-cycles
checked, undercutting "hip is noisy." The blended signal showed a concrete artifact instead: a
133px average-limb swing across just 0.08s (2 frames) — not a physically plausible body-
translation speed, almost certainly a jittery wrist/elbow detection spike. Blending in fast-
moving limb joints trades one noise source for a worse one. Not pursued further.

**Camera-distance change is a real, separate bug.** `estimateBodyScale`
(`src/heuristics/bodyScale.ts`) computes `torsoLengthPx` as a single clip-wide median. On a clip
where the subject's on-screen size changes substantially (e.g. running toward a handheld camera
rather than passing at fixed lateral distance — verified visually, on point: the subject's
apparent size roughly tripled across one ~1.6s clip), a single global normalizer mis-sizes every
amplitude that occurs away from the clip's "average" distance from camera. Two fixes tried:
- **Per-half-cycle-local torso length** (`estimateBodyScale` re-run on just the frames spanning
  each half-cycle): confirmed a safe no-op on a fixed-camera-distance clip (control), but
  *unstable* on the short/noisy approach clip — two otherwise-identical runs produced 32.5% and
  14.4% for the same clip, because which half-cycles even get detected varies run-to-run (GPU
  non-determinism, see "Determinism caveat" above) and a half-cycle's own frame window is too
  small a sample to estimate torso length reliably.
- **Rolling-window smoothed per-frame torso length** (median over a ±8-frame window, resampled
  at each extremum): same idea, slightly stabilized, same fundamental problem — the underlying
  clip (1.65s, ~2-3 real strides) is too short for *any* normalization scheme to produce a
  trustworthy single number. Per-half-cycle ratios within one run spanned 2.8%-59% — that spread
  is a property of the clip, not of the normalizer.

Conclusion: local/smoothed torso-length normalization is more correct in principle (verified
harmless on a stable clip, and a global median is provably wrong under camera-distance change)
but wasn't validated as an improvement on the one ground-truth clip available, because that clip
is too short/noisy to validate anything against. Not yet shipped — see "Backlog".

**Stride-length normalization — different, possibly more correct concept, but untestable on the
available ground-truth clip.** Consumer running watches (Garmin, COROS) report two distinct VO
metrics: raw VO in cm, and "Vertical Ratio" = VO_cm / stride_length_cm × 100, as a percentage.
Since the user's ground-truth reading was given as a percentage ("~10%"), Vertical Ratio is the
likely target — **inferred, not confirmed with the user**. This pipeline's existing calc
normalizes by torso length, not stride length — a categorically different ratio with no
principled reason to match a watch's number even if perfectly noise-free. Tried: bounce_px /
stride_px (same pixel space, real-world scale cancels out, same trick torso-length normalization
already relies on), stride length = same-side footstrike-to-footstrike horizontal hip
displacement (`detectFootstrikes` from `src/heuristics/footstrikes.ts`, reused as-is). On the
fixed-camera track clip this produced ~5-10% (vs. ~18-20% for the torso-length version) — much
closer to a plausible real-world Vertical Ratio, though there's no ground truth for that clip to
confirm against. **Could not be tested on the one clip with ground truth**: that clip's subject
runs toward the camera, so net horizontal (x) displacement is near zero — confirmed independently
by this pipeline's own `overstriding` metric, which already emits "direction of travel could not
be determined" on that clip (`estimateTravelDirection` in `src/heuristics/travelDirection.ts`
returns `0` below a half-torso-length displacement threshold). Pixel-space stride length simply
isn't observable from this camera angle. A side-view/lateral-motion ground-truth clip is needed
to actually validate this direction.

**Ground truth available**: one real data point — a park clip (front/approach view, ~1.65s,
now the second demo button) with a watch-measured reading of ~10% (assumed Vertical Ratio, see
above). This pipeline's baseline hip-only reading on that clip: ~24-25% (stable across runs). No
ground truth exists for the original side-view track demo clip — it's a stability/plausibility
control only, never a target.

## MediaPipe metric calibration — VO in real centimetres (2026-08-12, promoted to a metric #36)

**Update (#36, same day): no longer diagnostics-only.** `verticalOscillationCm` is now the
vertical-oscillation family's third real `MetricId` (`FormHeuristicsResult.verticalOscillationCm`,
after `verticalOscillation`/`verticalRatio` — this took the panel from eight metrics to **nine**;
⚠️ the `MetricId` union grew to thirteen and then **dropped back to twelve** when
`armSwingSymmetry` was withdrawn (`strides-zhv`, 2026-09-05); **twelve** is the count to check
against today — `src/heuristics/types.ts`. Both count changes needed a sweep of stale prose counts:
`strides-x8w` swept three stale "ten" counts out of `src/` and the results-view spec on 2026-08-29,
and `strides-zhv` swept twelve stale "thirteen" counts out of `src/` plus a normative SHALL in the
results-view spec)
— `computeVerticalOscillationCmMetric` (`verticalOscillationCm.ts`) wraps the calculation described
below with a `value`/`confidence`/`viewFit`/`caveat`, view-tolerant on the identical terms
`verticalOscillation` uses (side 1.0 / front 0.85 / ambiguous 0.6 — it has no denominator to be
degraded by camera angle, unlike `verticalRatio`). On a backend that doesn't measure real-world
scale (every backend but MediaPipe, still), the card renders as an availability statement — "Not
available" plus a caveat naming what backend capability is needed — not an error. The rest of this
section, describing the underlying `computeVerticalOscillationCm` calculation itself, is unchanged
by the promotion: that calculation was not touched, and is still called exactly once per run.

`[analysis-diagnostics]` still gains a `scaleCalibration` block **only** when the PRIMARY pass's
backend is `mediapipePoseLandmarker` — MoveNet-primary runs have no such key on that line at all
(test `'scaleCalibration' in diagnostics`, not `!= null`; a MoveNet run's first line still
serializes to exactly the JSON it did before). Since add-background-scale-pass, that test
discriminates the PRIMARY backend only: on a default MoveNet run the background scale pass's
measured calibration appears on the separate `[analysis-diagnostics:scale-pass]` line (see
"Reading results" above), never on the first line. As of #36 this block is sourced from `verticalOscillationCm.calibration` BY
REFERENCE (`diagnostics.scaleCalibration === heuristics.verticalOscillationCm.calibration`), not a
second computation — the diagnostics helper no longer takes a 4th parameter at all. It comes from
the per-frame `pixelsPerMeter` the MediaPipe backend derives from `worldLandmarks` (pixel torso ÷
**3D** world torso, shoulder-mid→hip-mid, landmark indices 11/12/23/24) and carries through
`PoseFrame` → `RobustPoseFrame` verbatim, never interpolated.

Fields: `verticalOscillationCm` (fitted PEAK-TO-PEAK bounce, cm — this is also the metric's
`value`), `sampleSize` (complete bounce cycles across contributing runs — one bounce per STEP; it
counted half-cycles before 2026-08-12), `observedCycles` (the same count, unfloored — added by #36
so confidence can read the fractional value rather than the display-rounded one), `fit` (the
winning run's spectral fit: `frequencyHz`, `peakToPeakAmplitudeCm`, `sinusoidR2`, `totalR2`,
`secondPeakRatio`, `sampleCount`, `spanSeconds`, `observedCycles`), `fitFailureReason`
(`'too-few-samples' | 'degenerate-signal' | 'insufficient-cycles' | 'below-quality-gate' |
'no-usable-run'`), `scaleDriftRatio`, `medianPixelsPerMeter`, `torsoMeters`, `scaleCoverage`,
`integrationRuns`. `fit` and `fitFailureReason` are exactly-one-non-null, so a measured-but-
unfittable clip names its reason instead of reporting a bare null. Computed over the
**presence-trimmed** window (unlike every other diagnostics field) — as of #36 this is true BY
CONSTRUCTION rather than by a second `trimToPresenceWindow` call, since `computeFormHeuristics`
now produces this block itself over the same trimmed frames it computes every other metric from.
`src/heuristics/verticalOscillationCm.ts`; the existing torso-length-ratio `verticalOscillation`
metric is untouched.

**Estimator (since 2026-08-12, #34)**: the amplitude comes from the shared spectral sinusoid fit
(`spectralFit.ts` — same primitive `verticalOscillation` and `cadence` use), fitted **once per
integration run** over that run's converted metric series, gated at `config.verticalOscillationMinFitR2`
(0.30 by default — **as of #36, the same `HeuristicsConfig` key `verticalOscillation`/`verticalRatio`
gate on, not the private `CM_MIN_FIT_R2` module constant this section originally described**; two
independently-tunable gates on the identical fitted amplitude would let the family disagree with
itself about whether it's trustworthy, so the constant was deleted rather than kept alongside the
config key), and aggregated across contributing runs by a sample-count-weighted median that SELECTS
one run's fit rather than blending several. It replaced per-run extrema pairing, whose prominence
threshold was the module's only use of `torsoLengthPx` — so a clip with no resolvable body scale can
now report centimetres with `torsoMeters: null`. The fit's `c + d·t + e·t²` trend terms are the
point: they absorb approach translation instead of charging it to the bounce. `fit.frequencyHz × 60`
is a free cross-check against `metrics.cadence.value` — same body, same rhythm, reached through a
completely separate series; a large disagreement means one fit landed on a harmonic or a grid edge.
Config is read for the frequency GRID and (as of #36) the quality GATE, never for signal selection
(`verticalOscillationSignal` does not apply here — hip-pinned unconditionally).

**The one correctness constraint**: the pixel→metre conversion integrates per-frame *deltas*
(`Σ (y[k−1] − y[k]) / s̄[k]`, reset at every hip-tracking gap), never `y_px / s(t)`. Dividing
absolute positions by a drifting scale reports the drift itself as bounce — measured as a 480 cm
artifact on the approach clip. There's a regression test for exactly that case
(`verticalOscillationCm.test.ts`).

Expected live values (real GPU, 3 trials/clip, measured 2026-08-12 on the same machine before and
after the estimator swap). ⚠️ **The track row's `4.78–4.79` is STALE as a present-day anchor** — it
was measured with MediaPipe as the PRIMARY backend, before the background scale-pass graft path and
before #54/#55's person selection. On today's default MoveNet-primary path the anchor is
**4.4215 cm**; see "Regression anchor" at the end of the metric-frame-evidence section below. The
rest of this table stands as the record of that estimator swap:

| clip | VO_cm (extrema, before) | VO_cm (fit, after) | fit.sinusoidR2 | fit.frequencyHz ×60 vs cadence | sampleSize | driftRatio | torsoMeters | medianPxPerM |
|---|---|---|---|---|---|---|---|---|
| track (`try a demo video`) | 6.075–6.080 | **4.78–4.79** | 0.485–0.486 | 91.2 vs 91.2 (exact) | 3 | ~1.01 | ~0.505 | ~872 |
| park (`another demo`) | 11.7 / 14.9 / 15.5 | **9.4 / 10.2 / 12.0** | 0.42–0.73 | 175.2–196.8 vs 176.4–195.6 (≤2 grid steps) | 3–4 | 3.9–5.4 | ~0.47 | ~530 |

Track is the regression anchor and is stable to ±0.005 cm across trials — a >0.05 cm spread there
is worth investigating rather than averaging away. **Park is not deterministic** despite MediaPipe
being bit-reproducible elsewhere: its presence-trimmed window lands on 76/83/84 samples across
trials, and that alone moves the number. One baseline park trial sampled a single frame and
produced no `scaleCalibration` at all — the known cold-start flake, unrelated to any code change.

⚠️ **"Park is not deterministic" does NOT survive the fresh-process regime** (addendum
2026-08-29, `strides-b0y` — the 2026-08-12 numbers above are left exactly as measured). Three
fresh-process trials on today's default MoveNet-primary + grafted-scale-pass path return
`verticalOscillationCm` **10.486597716761532** cm, `fit.frequencyHz` 3.12, `sinusoidR2`
0.34968137749045114, **`sampleCount` 98**, `spanSeconds` 1.6182830000000001, `torsoMeters`
0.464629504405643, `medianPixelsPerMeter` 520.898452525673, `subjectAgreement` 99/99 — every digit
identical on all three. The presence-trimmed window does not land on 76/83/84 any more; it lands
on 98, every time. Eleven further fresh trials of the primary line (`--arm 'base={}'`) likewise
show zero spread on every Demo 2 field. Two things changed between the two measurements and this
addendum does not separate them: the regime (reused → fresh) and the path (MediaPipe-primary →
MoveNet-primary with a grafted scale pass). What is certain is that a reader today should not
expect park to wobble. See the rewritten **Determinism caveat**.

**Why the track number dropped 21%, and why that is not a regression.** The pre-registered
tolerance for this swap was −7% (from #28's measured sine-underfit bias on the pixel path); the
measured drop was −21%, so it was investigated rather than accepted or tuned away. The finding:
the new centimetre figure agrees with the *pixel* path's spectral fit on the identical clip to
within 1.2% (4.786 cm vs. 42.24 px ÷ 871.9 px/m = 4.845 cm), at exactly the same winning frequency
(1.52 Hz), the same 57 samples, the same 2.24 s span, and a `sinusoidR2` within 0.003 (0.4860 vs.
0.4886) — the affine-equivalence identity, holding on real footage. Before the swap the pipeline
reported two mutually inconsistent amplitudes for the same clip (4.84 cm-equivalent from the fit,
6.07 cm from extrema pairing); that 25% gap is what closed. #28's −3…−7% band was measured on the
raw pixel trace of better-fitting clips and does not transfer: at this clip's `sinusoidR2` ≈ 0.49
a sine explains under half the residual variance, so it necessarily underfits the peak excursions
by much more than 7%. `CM_MIN_FIT_R2` was NOT touched. Note also that the integration itself adds
almost nothing to the noise — the cm path's `sinusoidR2` is within 0.6% of the pixel path's, which
is direct evidence against scale noise accumulating materially as red noise on this clip.

`driftRatio` is last measured scale ÷ first — a two-sample statistic, so one noisy endpoint
frame swings it trial-to-trial (hence 3.9–5.4 on park). Treat it as a flag, not a measurement.

`torsoMeters` ≈ 0.5 is the sanity check — a human torso really is about half a metre, so a
wildly different number means the calibration is wrong and the centimetres shouldn't be believed.
**The park number is no longer drift-inflated the way it was**: the fit's trend terms absorb the
approach translation, and the measured effect is a 30% drop (median 14.9 → 10.2 cm) with the
alternating large/small half-cycle pattern gone by construction. It is still not a *target* —
there is no ground truth in centimetres for that clip; the watch's ~10% is a *ratio*, not
centimetres, and is not comparable. The 6–13 cm literature range is the plausibility check: park
(10.2) now sits inside it, but track (4.79) reads ~20% BELOW the band's floor — a real shortfall,
not a marginal one. The mechanism is the sine-underfit described above: at this clip's
`sinusoidR2` ≈ 0.49 a single sinusoid explains under half the residual variance and necessarily
underfits the peak excursions, so the fitted amplitude reads low on a peaky waveform. The
pixel-space `verticalOscillation` ratio metric inherits the identical downward bias (same
primitive, same clip, same R²) — the whole VO family reads low on peaky waveforms, consistently.

## Head-keypoint widening + vertical-oscillation signal A/B (2026-08-12)

`COMMON_KEYPOINT_NAMES` widened from 12 to 15 (`nose`, `left_ear`, `right_ear` appended —
`src/pose/types.ts`): both MoveNet and MediaPipe already emitted these names, they were just
dropped at the `toPoseFrame` adapter boundary. Every downstream consumer
(confidenceFilter/interpolate/analysisDiagnostics/skeleton overlay) was already name-driven off
`COMMON_KEYPOINT_NAMES` rather than a hardcoded 12, so this widened for free except for
`syntheticGait.ts`'s exhaustive keypoint-name switch, which needed a new head model (nose + ears
as a rigid unit above the shoulders, phase-locked to the hip bounce with its own damped
amplitude — see `openspec/changes/widen-keypoints-selectable-vo-signal/design.md`'s "D-fixture"
section). Skeleton overlay now draws a head triangle (ear-ear-nose) plus two neck anchors
(ear-to-same-side-shoulder).

Vertical oscillation's input signal is now selectable via `HeuristicsConfig.verticalOscillationSignal:
'hipMid' | 'earMid'` (`src/heuristics/types.ts`), backed by a generalized
`analyzeBounceSignal(frames, config, pair)` in `hipBounce.ts` (cadence keeps calling the
hip-pinned `analyzeHipBounce` wrapper unchanged — cadence stays hip-pinned regardless of this
setting). **A prior offline investigation (test4-headbob.json) found ear-mid bounce roughly half
hip-mid's run-to-run spread on both demo clips — a live, paired, 5-trial-per-clip A/B against the
actual pipeline (real GPU, MoveNet) did NOT reproduce that advantage.** Measured this session:
hip-mid spread 20.5% (track) / 3.2% (park), ear-mid spread 23.8% (track) / 3.5% (park) — ear-mid
was not more stable, and on the track clip paid a real confidence cost from the single-ear
interpolation tax (17-22% of frames only resolving one ear). The gap between the two
investigations' findings is explained by timing: the offline investigation predates the
spectral-fit VO estimator (#28), which already fixed most of hip-mid's original instability (its
own measurement: park clip cross-trial spread 18.2% → 4.2%) — against that already-stabilized
baseline, ear-mid's theoretical advantage had nothing left to add. **Default stays `hipMid`**;
`earMid` ships as a documented, tested, available config option. Full numbers, the pre-registered
decision rule, and the gate-by-gate evaluation are in
`openspec/changes/widen-keypoints-selectable-vo-signal/design.md`. GitHub issue #30.

