# Design — normalize the sagittal excursion ratio by a local torso length

Bead `strides-cge`.

## Context

`detectView` casts two votes: the Bilateral Spread Ratio (BSR) and the Sagittal Excursion Ratio
(SER). SER is, per side, the p95−p5 range of `ankle.x − hip.x` over directly-detected samples,
averaged over sides and divided by ONE clip-wide torso length — the median of every frame's
shoulder-mid→hip-mid distance (`estimateBodyScale`).

That single denominator is wrong whenever the runner's on-screen size changes during the clip. A
runner approaching a handheld camera grows several-fold in pixels; their ankle excursion grows with
them. The p95−p5 range is set by the LARGEST pixel excursions, which occur when the runner is
nearest, while the median torso sits at the clip's middle distance. Dividing a near-field range by a
mid-field torso inflates SER. On the private front-approach fixture IMG_9116 this reads SER 0.594
against a front bar of 0.40, so a front-view clip is labelled `'ambiguous'` even though BSR (0.571)
votes front.

The same defect was documented in principle for vertical oscillation in 2026-08-12 ("a single
global normalizer mis-sizes every amplitude that occurs away from the clip's average distance"); the
VO investigation could not validate a fix because its only ground-truth clip was too short. SER is a
better place to fix it: it is an extreme-quantile range across hundreds of samples, not a per-half-
cycle amplitude, and the window only needs to estimate a torso length, not a gait event.

## Decisions

### D1. Only the SER path changes

Each directly-detected sample `relX = ankle.x − hip.x` is rescaled to the clip's reference torso
before the range is taken:

```
relX'[i] = relX[i] · torsoRef / localTorso[i]
SER      = mean_over_sides(p95(relX') − p5(relX')) / torsoRef
```

`torsoRef` is the existing clip-median `torsoLengthPx`. Everything downstream is untouched: the
`mean(ranges) / torsoLengthPx` division, `MIN_SAGITTAL_RANGE_SAMPLES`, the votes, margins,
plausibility, and every threshold (0.40 / 0.80 for SER, 0.45 for BSR). BSR and every other consumer
of `estimateBodyScale` keep the clip-wide torso.

**Why the rescale form rather than `relX / localTorso`.** The two are equal in exact arithmetic. In
floating point the rescale form is bit-identical to today's computation wherever the torso is
constant: `torsoRef / localTorso` is exactly `1`, `relX · 1` is exactly `relX`, and the final
division is the same division as before. So every existing exact-valued test (`toBe(0.33)`,
`toBe(0.99)`, `toEqual(detectView(...))`) keeps passing without a tolerance, and a regression that
moved a constant-scale clip would show up as a hard failure rather than as noise.

**Why BSR keeps the clip-wide torso.** BSR is a MEDIAN of per-frame ratios, so it is not set by the
near-field extreme the way a p95−p5 range is, and it is not where the defect was measured (IMG_9116's
BSR, 0.571, already votes front). Changing it would widen the blast radius for no measured gain.
Per-frame BSR normalization is a defensible follow-up, not part of this change.

### D2. `estimateLocalTorsoLengths(frames, halfWindowSeconds)` in `bodyScale.ts`

`torsoLengthAt(frame)` is extracted from `estimateBodyScale`'s inline loop (shoulder-mid → hip-mid
via `resolveMidpoint`); `estimateBodyScale` calls it, contract and output unchanged.

`estimateLocalTorsoLengths` returns one entry per frame: the median of `torsoLengthAt` over every
frame whose timestamp lies within `±halfWindowSeconds` of that frame's, or `null` when none resolves.
A two-pointer scan over presentation-ordered frames; it THROWS on a decreasing timestamp rather than
silently computing a wrong window, since every stage upstream (sampling, interpolation) already
assumes presentation order and an out-of-order array is a contract violation, not degraded input.

It keeps interpolated torso points, for the same reason `estimateBodyScale` does: it is a median, and
a median is the reducer that tolerates a few lerped points (the opposite trade from the extreme-
quantile range in `computeSagittalRange`, which excludes them — `strides-kxn`).

A window boundary carries a 1 µs tolerance, so a frame exactly `halfWindowSeconds` away is inside
the window regardless of how its timestamp happens to round (`15/30` vs `0.5`). 1 µs is far below any
frame interval and equals Chromium's own `currentTime` quantum.

### D3. Window: ±0.5 s of TIME, a module constant

`LOCAL_TORSO_HALF_WINDOW_SECONDS = 0.5` in `viewDetection.ts`, not a `HeuristicsConfig` key.

- **Time, not frames.** The corpus spans 25, 30 and 60 fps. A frame-count window would mean a
  different duration on each, so the same physical motion would be smoothed differently depending
  on the camera's frame rate.
- **1 s total covers at least one full stride** at any running cadence (≥ 120 steps/min → a stride
  ≤ 1 s), so the torso's within-stride flex and bob are averaged over rather than tracked. Shorter
  and the window starts following the gait cycle; much longer and it stops following the approach.
- **Not a config key**, because it is a statement about the estimator's own sample, not a tunable a
  harness should sweep. A config key invites tuning against this corpus, which is exactly what the
  pre-registered rule below forbids.

### D4. A sample with no local torso is skipped before counting

If no frame within the window resolves a torso, the sample is skipped exactly like an unresolvable
ankle: counted as neither detected nor interpolated. It cannot be normalized, and substituting the
clip torso would re-introduce the defect for exactly the frames least able to bear it.

### D5. Diagnostics shape unchanged

`sagittalExcursionRatio` keeps its key and meaning (a ratio to torso length); only its doc gains one
line saying the torso is local per sample. No analysis-diagnostics delta.

## Rejected alternatives

- **Divide by `localTorso` and drop `torsoRef`.** Equal in exact arithmetic, but not bit-identical on
  constant-scale input (`relX / t / … ` rounds differently from `relX · 1 / t`), which would turn
  every exact test into a tolerance and hide a real regression in noise.
- **Per-frame torso, no window.** Torso length flexes and bobs within a stride and the shoulder/hip
  keypoints jitter frame to frame; a per-frame denominator puts that jitter straight into the
  extreme quantile — the same failure mode as the "per-half-cycle-local torso length" VO experiment
  (2026-08-12), which proved unstable.
- **A frame-count window.** Different durations at 25/30/60 fps — see D3.
- **Normalize BSR the same way.** See D1; not where the defect is.
- **Lower `frontViewMaxSagittalExcursionRatio`/raise it to admit IMG_9116.** Tuning a threshold to a
  clip is editing the criterion to match the result.
- **A near-field / frame-edge ankle gate.** A real, separate defect (ankles at the frame edge as the
  runner arrives); a follow-up, not in this change.

## Pre-registered ship rule (written BEFORE the after-measurement)

Measured with `scripts/ab-person-selection.mjs --arm 'base={}' --trials 2` (fresh Chromium process
per trial, real GPU, identity-verified dev server), before = `83cccf7`, after = this change.

**SHIP iff BOTH:**

**(a)** On each of `side-landscape`, `side-portrait`, `front-approach`, `multiperson`:
`view.view` is unchanged, AND no metric's tier changes, where tier is derived per metric from the
harness's `value` / `confidence` / `viewFit` fields exactly as `metricTier`
(`src/results/metricConfidence.ts`) does: `excluded` if `value` is null or `viewFit` is
`'unsuitable'`; else `normal` if `confidence ≥ 0.7`; else `caveated`.

**(b)** The private front-approach fixture IMG_9116 resolves `view.view === 'front'`.

If the rule fails, no threshold, window or constant is tuned to make it pass: the behaviour change is
not committed and the failure is reported with its numbers.

## Measurement

`scripts/ab-person-selection.mjs --arm 'base={}' --clips side-landscape,side-portrait,front-approach,
multiperson,private-IMG_9114,private-IMG_9115,private-IMG_9116 --trials 2`, fresh Chromium process
per trial, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), dev server started by each run and
identity-verified. Before = `83cccf7`; after = this change on the same base. **Every field agreed
across both trials of every clip in both runs except `elapsedMs`.** The private-clip before-values
also match the independently-captured `fixtures-private/baseline/83cccf7.txt` digit for digit.
Compared with `rtk proxy sh -c 'diff …'` and cross-checked by md5 (the two files differ, as they
must) and by a per-field script over the `--json` records.

| clip | view | view.confidence | plausibility (s / f / a) | SER | BSR | tier changes |
|---|---|---|---|---|---|---|
| side-landscape | side → side | 0.7709 → 0.7709 | 1/0/0 → 1/0/0 | 1.78749 → 1.78798 | 0.137439 = | none |
| side-portrait | side → side | 0.8366 → 0.8366 | 1/0/0 → 1/0/0 | 1.70594 → 1.69972 | 0.098051 = | none |
| front-approach | front → front | 0.5412 → **0.5917** | 0/1/0 → 0/1/0 | 0.334267 → **0.293851** | 0.550987 = | none |
| multiperson | side → side | 0.7132 → 0.7132 | 1/0/0 → 1/0/0 | 1.76229 → 1.76076 | 0.172078 = | none |
| private IMG_9114 | ambiguous → ambiguous | 0.3 → 0.3 | 0/0.499/0.501 → 0/0.944/0.056 | 0.600572 → 0.422323 | 0.548631 = | armSwingAmplitude excluded → caveated; stepWidth excluded → normal |
| private IMG_9115 | ambiguous → ambiguous | 0.3 → 0.3 | 0/0.305/0.695 → 0/0.824/0.176 | 0.678105 → 0.470518 | 0.589185 = | stepWidth excluded → normal |
| private IMG_9116 | ambiguous → **front** | 0.3 → 0.6731 | 0/0.516/0.484 → 0/1/0 | 0.593543 → **0.261516** | 0.570547 = | stepWidth caveated → normal |

On the four public clips **no metric field moved at all** — not a value, a confidence nor a
`viewFit` — so no tier can have changed. The side clips' SER moves by 0.03–0.4%, the expected size
for a camera at roughly constant distance whose torso still jitters frame to frame. The sample counts
are identical on every clip: no sample anywhere lost its local torso.

**Ship rule: (a) PASSES** — four public clips, view unchanged, zero tier changes. **(b) PASSES** —
IMG_9116 resolves `'front'`. **Verdict: SHIP.**

### Outside the rule, recorded rather than adjudicated

- **IMG_9114 and IMG_9115 stay `'ambiguous'`**, now just above the 0.40 front bar (0.422, 0.471). The
  normalization moved them most of the way (−30%, −31%) but did not cross. Not tuned: the bar is not
  this change's to move. Their plausibility shifts heavily toward front, which changes metric gating:
  side-primary metrics' confidence drops (e.g. `kneeFlexion` 0.134 → 0.094, already caveated) and
  front-primary ones rise (`stepWidth` 0.576 → 0.919 on IMG_9114, excluded → normal). That is the
  intended direction for a front-approach clip, but it is a user-visible change on clips that keep
  their `'ambiguous'` label.
- **The background MediaPipe scale pass moves the OTHER way on `front-approach`**, which the harness
  does not capture (checked with a one-off driver, both arms on this base): scale-pass SER **0.6759 →
  0.7212**, view `'ambiguous'` both ways, front plausibility 0.310 → 0.197, `stepWidthCm` still
  `viewFit 'unsuitable'` (confidence 0.448 → 0.358, value 3.4777 cm unchanged). The primary pass on
  the same runs read 0.3343 → 0.2939, matching the harness exactly. The likely mechanism is the known
  clip-opening MediaPipe ankle defect (`strides-boc`): those bad detections sit at t < 0.45 s, when
  the runner is smallest, so their local torso is the smallest of the clip and the rescale factor
  `torsoRef / localTorso` AMPLIFIES them rather than shrinking them. Not verified sample by sample.
  The label does not change, so nothing a reader sees moves except that card's confidence.
