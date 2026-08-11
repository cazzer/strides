## Context

Issue #20 (labeled `plan:architect`, parent #16 partial) asks for a fourth heuristic: compare left
vs. right arm swing (shoulder-elbow-wrist per side — all three already in `COMMON_KEYPOINT_NAMES`)
and report how symmetric they are. The issue explicitly leaves the concrete symmetry measure open
— amplitude ratio vs. phase alignment, which keypoints/axis to use, what unit — and asks that the
decision be made and documented here, not left arbitrary. There is no separate planning pass for
this ticket; this document *is* that pass.

The existing three heuristics (`src/heuristics/{verticalOscillation,trunkLean,overstriding}.ts`,
from the archived `form-heuristics` change) establish the shape every metric here follows:
`compute<Metric>(frames: RobustPoseFrame[], view: View, config) => MetricResult`, torso-length
normalization (`estimateBodyScale`), a shared gap-aware extrema finder (`findLocalExtrema`), a
shared multiplicative confidence formula (`computeMetricConfidence`), and the "never a silent
wrong number, never a crash, never `NaN`" output contract. This change reuses all of that
machinery rather than inventing a parallel path.

## Goals / Non-Goals

**Goals:**

- Pick one concrete, defensible symmetry measure — not a placeholder — and document why it was
  chosen over the alternatives the issue names.
- Fit the existing `compute<Metric>` module shape exactly: same function signature, same
  `MetricResult` contract, same confidence formula, same "compute anyway, discount confidence"
  policy for an unsuitable view.
- Get the view-fit gating right: this is explicitly the one metric in the set whose *primary* view
  is front, not side, and the reasoning for that has to hold up (see Decisions below) rather than
  just being asserted.

**Non-Goals:**

- Phase-alignment (timing of left-peak vs. right-peak) as anything more than a documented
  alternative — not implemented in this change (see Decisions).
- Detecting *why* an asymmetry exists (injury, compensation, fatigue) — this metric reports a
  number, not a diagnosis.
- Elbow-angle (shoulder-elbow-forearm flexion) as an additional, separate metric — out of scope;
  arm swing *symmetry* only needs a comparable per-side amplitude signal, not a full elbow-flexion
  timeseries. `left_elbow`/`right_elbow` are not read by this change; see Decisions for why the
  shoulder+wrist pair alone was preferred over routing through the elbow.
- Cross-body (medial/lateral) swing as the measured axis — considered and rejected in favor of
  vertical excursion (see Decisions).
- Re-deriving or loosening view detection (`viewDetection.ts`) itself — unchanged; this change only
  adds a new consumer of its output.

## Decisions

### Amplitude ratio, not phase alignment

Two candidate measures, per the issue: **amplitude ratio** (`min(left, right) / max(left, right)`
of each side's swing excursion) and **phase alignment** (how in-sync the timing of left vs. right
swing peaks is).

Amplitude ratio wins, for three reasons:

1. **Robustness to the proxy signal's noise.** As decided below, the actual per-frame signal this
   metric reads is a foreshortened, coupled proxy (wrist-y relative to shoulder-y, not a true 3D
   swing angle). Amplitude ratio only needs *how big* each side's excursion was — a coarse,
   extrema-to-extrema statistic already made robust to jitter by `findLocalExtrema`'s prominence
   threshold and smoothing pass. Phase alignment needs to know *exactly when* each side's peak
   occurred, which is a much sharper demand on a noisier, less-precise signal — small timing errors
   from tracking jitter would corrupt a phase measurement far more than an amplitude one.
2. **Precedent.** Every existing heuristic in this pipeline is an amplitude/offset measure
   (bounce height, lean angle, overstride offset), not a timing measure. Reusing the same
   extrema-amplitude machinery `verticalOscillation.ts` already established keeps this change a
   straightforward application of existing, reviewed code rather than a new algorithmic surface
   (a new gap-aware phase-detection routine) that would need its own scrutiny.
3. **It's the issue's own stated default.** The issue frames amplitude ratio as "the simpler, more
   defensible default unless there's a clear reason phase matters more." No such clear reason
   surfaced during this design — a runner favoring one arm shows up primarily as *how much* that
   arm moves, not as a timing offset between the two swings (which stay roughly antiphase even
   under real asymmetry). Phase alignment is left as a documented possible *addition*, not a
   replacement, for a future change if amplitude ratio alone proves insufficient in practice.

### Signal: wrist-y relative to same-side shoulder-y (vertical excursion), not an upper-arm angle or horizontal excursion

Three keypoints are available per side (shoulder, elbow, wrist); the issue explicitly leaves open
whether to use an angular measure or a positional (horizontal/vertical) one. The choice here is
**vertical (image-y) excursion of the wrist relative to the same-side shoulder**, deliberately
*not* the angle of the shoulder-elbow vector (the trunk-lean-style `atan2` construction) and *not*
horizontal (cross-body) excursion. The reasoning is inseparable from the view-gating decision
below, so read them together:

- Arm swing during running is predominantly a **sagittal-plane** rotation at the shoulder (the
  whole arm swings forward and back) — the same plane trunk lean and overstriding measure, and the
  one that's *foreshortened to near-zero* from a front-on camera, for exactly the reason
  `trunkLean.ts`'s doc comment gives for its own hard side-view gating. A shoulder-elbow vector's
  `atan2` angle would be dominated by that foreshortening (i.e. by noise) from the one view this
  metric needs to be *primary* on. Using it would repeat trunk lean's construction while ignoring
  the reason trunk lean is side-view-gated.
- What a front-facing camera *does* see clearly is the **coupled vertical motion** of the distal
  arm: as a runner's arm swings forward, the elbow flexes and the forearm rises toward the chest;
  on the backswing the elbow extends and the forearm drops back down. That rise-and-fall is a real,
  substantial image-plane vertical displacement — not a foreshortening artifact — driven by the
  same swing cycle this metric is trying to measure, and it survives being viewed face-on the same
  way vertical oscillation's hip bounce does (`verticalOscillation.ts`'s own doc comment: bounce
  "projects onto image-y similarly regardless of which way the runner faces the camera"). Wrist
  over elbow specifically: the wrist is the most distal available point, so it inherits *both* the
  shoulder-driven rise and the elbow-flexion-driven rise, giving a larger swing amplitude against
  the same fixed keypoint-detection noise floor than shoulder-to-elbow alone would — the same
  distal-point-for-signal-amplitude logic `overstriding.ts` applies by using the ankle rather than
  the knee for footstrike detection.
- **Horizontal (cross-body) wrist excursion** — the mediolateral swing/sway visible face-on — was
  considered and rejected as the primary signal: cross-body arm crossing is a real but much smaller
  and less consistently-present motion than the vertical bob (an efficient runner may show almost
  none of it, which would make the *denominator* of a symmetry ratio unreliably small/noisy for a
  well-formed runner specifically, the opposite of what a robust default should do). Vertical
  excursion is present on essentially every stride, symmetric or not, which is what a denominator
  in a ratio needs to be.

Concretely: for each frame, `wrist.y - shoulder.y` (same side), fed into the same
`findLocalExtrema` used by `verticalOscillation.ts`, paired into half-cycle amplitudes exactly as
that module does, then reduced to one value per side via `median(amplitudes) / torsoLengthPx`.

### Front-view-primary, side-view-unsuitable — an occlusion argument, not a visible-plane argument

This is the one heuristic in the set whose primary view is front rather than side, and the reason
is structurally different from why vertical oscillation is view-tolerant or trunk lean/overstriding
are side-primary:

- **Side view's problem is occlusion/separability, not invisibility.** From the side, the near arm
  swings clearly through the sagittal plane — a *better* view of the true 3D swing motion than
  front view gives. But the far arm is on the opposite side of the torso from the camera: it is
  either occluded outright for part of the cycle, or its projected position nearly coincides with
  the near arm's, which is exactly the kind of ambiguity a keypoint detector (and this pipeline,
  which never reasons about depth ordering) cannot reliably resolve into two *separate,
  independently trustworthy* left/right tracks. A symmetry comparison is meaningless if one of the
  two things being compared isn't reliably itself.
- **Front view's problem is a foreshortened primary swing plane, compensated by a real, visible
  secondary signal.** As established above, front view hides the sagittal swing rotation but
  preserves a real, substantial, per-side-separable vertical excursion driven by the same cycle.
  Both arms are unambiguously on their own side of the body, with no occlusion of one by the other.
- This is confirmed, not just asserted, against this pipeline's actual view classifier:
  `viewDetection.test.ts`'s `'classifies a clean front-view clip as front, with both signals
  in-band'` case already demonstrates a front-facing synthetic clip resolves to `view: 'front'`
  (not `'ambiguous'`) with confidence > 0.5, using the same `generateSyntheticGait(..., view:
  'front')` fixture every other front-view test in this codebase relies on. View detection reads
  only shoulder/hip/ankle geometry — nothing about the arms — so this change doesn't alter that
  classification at all; it only adds a new consumer of the label already being produced correctly.

`DEFAULT_VIEW_FIT_TABLE.armSwingSymmetry` is therefore the mirror image of
`trunkLean`/`overstriding`'s table: `front: { fit: 'primary', multiplier: 1.0 }`, `side: { fit:
'unsuitable', multiplier: 0.1 }`, `ambiguous: { fit: 'unsuitable', multiplier: 0.2 }` (the same
`0.1`/`0.2` values those two metrics use for their own unsuitable views, reused rather than
inventing new ones without a reason to differ). Per the same "never a silent wrong number"
principle those metrics follow, a `'side'`- or `'ambiguous'`-classified clip still gets a computed
value — never `null` purely because the view is unsuitable — with confidence capped low and an
explicit caveat.

### The ratio itself: `min(left, right) / max(left, right)`, guarded against the unreachable 0/0 case

Both per-side amplitudes are torso-normalized medians of `findLocalExtrema`-confirmed half-cycles.
By that function's own contract (see `extrema.ts`'s doc comment: every confirmed extremum is at
least `minProminenceAbs` away from its predecessor), any amplitude that makes it into either side's
list is strictly positive — so once both sides have at least one detected half-cycle, `max(left,
right)` is provably `> 0` and the ratio is well-defined. The code still guards `maxValue === 0`
explicitly (returning `1`, i.e. "no asymmetry detected") rather than relying on that invariant
silently, consistent with `clamp01`'s own explicit-NaN-guard precedent elsewhere in this codebase:
cheap to write, and it turns a should-never-happen case into a defined one instead of a divide-by-
zero, matching the "never `NaN`" output contract.

A **ratio**, not a difference or a signed comparison, was chosen specifically because it cancels
shared measurement bias. Front-view foreshortening, camera distance, and this proxy signal's
general noisiness all apply to *both* arms roughly equally (same camera, same clip, mirrored body
geometry) — a ratio of two biased-the-same-way quantities is far more robust to that shared bias
than either amplitude's absolute value would be on its own. This is also why this change makes no
attempt to report a "true" arm swing amplitude in degrees or centimeters: only the relative
comparison is claimed to be meaningful, which is exactly what a ratio expresses and an absolute
number would overclaim.

### Confidence and sample-size aggregation: the weaker side sets the bound

`frameCoverage` is `min(leftResolvedCount, rightResolvedCount) / frames.length` and `sampleSize` is
`min(leftAmplitudeCount, rightAmplitudeCount)` — not an average or a sum of both sides. A symmetry
*comparison* is only as trustworthy as its less-observed side: ten clean cycles on one arm and one
noisy cycle on the other should not read as high confidence just because the average looks
adequate. This mirrors the same conservative-compounding philosophy `computeMetricConfidence`
already documents for its own multiplicative penalty design — several factors, or in this case two
symmetric inputs, should not be able to average away a real weakness on one side.

### A new `'percent'` unit, not a reused `'ratio'`

`MetricResult['unit']` is currently `'ratio' | 'degrees'`, and `MetricsPanel.tsx`'s `formatValue`
hard-codes what `'ratio'` means: `${(value * 100).toFixed(1)}% of torso length`. That phrasing is
correct for overstriding and vertical oscillation (both are literally torso-length-relative
distances) but would be actively wrong for arm swing symmetry — `min(left, right) / max(left,
right)` is a dimensionless comparison between two amplitudes, not a fraction of torso length, and
displaying "85.0% of torso length" for a symmetry score would misstate what the number means.

The issue's own guidance was to reuse `'ratio'` "if it fits the existing 0-1 formatting
convention" — it doesn't; the convention baked into `formatValue` is more specific than "a 0-1
number," it's "a 0-1 number that is *also* a fraction of torso length." Rather than add a
metric-specific branch to `formatValue` (`if (metric.metric === 'armSwingSymmetry') …`), which
would break its current unit-driven-not-metric-driven design, `MetricResult['unit']` gains a third
variant, `'percent'`, formatted as plain `${(value * 100).toFixed(1)}%` with no torso-length
suffix. This is the smallest change that keeps `formatValue` a pure function of `unit`, and leaves
the door open for `'percent'` to be reused by a future symmetry-shaped metric without another unit
added just for it.

## Risks / Trade-offs

- **Wrist-relative-to-shoulder vertical excursion is a proxy for arm swing, not a calibrated
  measurement of it** — the same category of approximation as overstriding's ankle-lowest-on-screen
  footstrike proxy (`design.md` in the archived `form-heuristics` change flags that one explicitly;
  this is the same kind of judgment call, not a new category of risk for this pipeline). It has not
  been validated against real running footage; it is a reasoned default chosen for the geometric
  reasons above, cheap to revisit (one function, `computeSideSwing`) if real clips show it doesn't
  track true swing amplitude well.
- **`armSwingMinProminenceRatio` (`0.03`) and `MIN_ARM_SWING_SAMPLE_SIZE` (`4`)** are judgment-call
  constants chosen by analogy to `verticalOscillationMinProminenceRatio`/
  `verticalOscillationMinCycles` (same order-of-magnitude signal: a moderately large, roughly
  twice-per-stride vertical oscillation), not derived from measurement. Exposed on
  `HeuristicsConfig`/as a local module constant respectively, matching this codebase's existing
  practice for every other tunable threshold.
- **Side-view output still exists and is still a real number**, per this pipeline's "never a silent
  wrong number" rule — but because side view's failure mode here is occlusion/mis-separation rather
  than a clean geometric invisibility (contrast trunk lean's front-view shoulders-collapse-to-hips,
  which reads as an honestly-near-zero value), a side-view arm swing symmetry number is more likely
  to be a somewhat arbitrary artifact of *which* keypoint the detector happened to lock onto for the
  occluded arm, not just a noisier version of the true value. The `0.1` unsuitable multiplier and
  explicit caveat are meant to make that legible, not to fully compensate for it.
- **The ratio construction cannot distinguish "both arms barely swing" from "both arms swing a lot,
  evenly"** — both score near 1. This is an accepted limitation of a pure symmetry measure (it
  answers "are they alike," not "is either of them good"); a future change could pair this metric
  with an absolute swing-amplitude readout if that distinction turns out to matter.

## Migration / Rollout

Purely additive: one new module, one new test file, and small, mechanical extensions to
`types.ts`/`index.ts`/`MetricsPanel.tsx` (plus its test fixtures, which need the new required
`FormHeuristicsResult` field). No existing metric's computation, output shape, or test changes.
