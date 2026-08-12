# Design — widen keypoints, selectable VO signal

## Context

Issue #30 (epic #27). `COMMON_KEYPOINT_NAMES` is a hardcoded 12-entry limb-only subset; the
adapter boundary (`toPoseFrame`) drops nose/eyes/ears before robustness or heuristics ever see
them. Separately, a prior investigation (test4-headbob.json) found the ear-midpoint vertical
signal roughly half hip-mid's run-to-run spread on both evaluated clips, which is worth testing as
vertical oscillation's input signal — but that investigation wasn't run at integration level
(real GPU, the actual pipeline, paired trials), so it isn't strong enough evidence on its own to
flip a shipped default. This document records eight decisions (D1–D8) made in service of two
goals: widen the keypoint surface safely, and decide the VO default from real evidence gathered
under a rule written before the evidence exists.

## D1 — Widening is additive and positionally safe

**Decision.** `nose`, `left_ear`, `right_ear` are APPENDED to `COMMON_KEYPOINT_NAMES` (never
interleaved into the existing 12). `KeypointName` widens automatically (`(typeof
COMMON_KEYPOINT_NAMES)[number]`).

**Why append-only matters.** `interpolate.ts`'s `applyRobustness` joins `COMMON_KEYPOINT_NAMES`
and each frame's classification array by POSITIONAL INDEX
(`COMMON_KEYPOINT_NAMES.map((name, keypointIndex) => ... classifications.map((frameStates) =>
frameStates[keypointIndex]))`). Any caller that hand-builds a `RobustPoseFrame`/`PoseFrame`'s
`keypoints` array by iterating `COMMON_KEYPOINT_NAMES` (every fixture in this repo already does
this) widens automatically and correctly; appending rather than interleaving means no fixture or
production code that currently indexes by POSITION rather than by NAME needs to change (verified:
none does — every consumer either maps by name or iterates `COMMON_KEYPOINT_NAMES` itself).

**Verified-safe consumers (no code change needed):**
- `confidenceFilter.classifyFrame` maps `frame.keypoints` directly — follows the widened array.
- `interpolate.ts` builds one channel per `COMMON_KEYPOINT_NAMES` entry — widens automatically.
- `analysisDiagnostics.emptyKeypointStats` iterates `COMMON_KEYPOINT_NAMES` — widens
  automatically; no code change, only new test coverage (T6).
- `common.ts`'s `toPoseFrame` maps `COMMON_KEYPOINT_NAMES` — widens automatically. MoveNet emits
  COCO-named keypoints natively (`nose`/`left_ear`/`right_ear` already present in its raw output,
  just previously dropped). MediaPipe's landmark-name array
  (`MEDIAPIPE_POSE_LANDMARK_NAMES`) already has `nose` at index 0, `left_ear` at 7, `right_ear` at
  8 — no code change, verified via new test coverage (T3).
- `skeletonGeometry.toDrawOps` iterates `frame.keypoints` and looks up `SKELETON_EDGES` by name —
  widens automatically for points; edges need an explicit addition (D2).
- `viewDetection.ts` reads shoulders/hips (bilateral spread) and ankles/hips (sagittal excursion)
  by name only — verified a no-op, pinned by regression test T10.
- `hipTraceFrames.ts`/`testFrames.ts`/`syntheticGait.ts` (all three shared test fixtures) build
  keypoints via `COMMON_KEYPOINT_NAMES.map(...)` — widen automatically, except `syntheticGait.ts`'s
  exhaustive `switch` on keypoint name, which needs new `case` arms (D-fixture, below) or it fails
  to compile (`Type '"nose" | "left_ear" | "right_ear"' is not assignable to type 'never'` — this
  is exactly what happened running `tsc -b` against the widened type, confirming the exhaustiveness
  check catches an unhandled name rather than silently misbehaving).

**Docstrings become count-free.** `PoseFrame.keypoints`, `RobustPoseFrame.keypoints`, and
`keypoints.ts`'s `findKeypoint` error-path comment previously asserted "always length 12" — now
"one entry per name in COMMON_KEYPOINT_NAMES, in that fixed order, never sparse — applyRobustness
joins positionally, so a frame of any other length is a contract violation, not degraded input."
This states the actual invariant (matches the name list) instead of a count that's now wrong and
will be wrong again the next time the list widens.

## D2 — Skeleton overlay: head triangle + neck anchors

**Decision.** `SKELETON_EDGES` gains four entries: `['left_ear', 'nose']`, `['right_ear', 'nose']`,
`['left_ear', 'left_shoulder']`, `['right_ear', 'right_shoulder']`.

**Why a triangle plus anchors, not just the triangle.** Three keypoints connected only to each
other (nose-leftEar, nose-rightEar) would float disconnected from the rest of the skeleton — a
small triangle hovering near where the head should be, with no visual link to the body. The two
neck-anchor edges (ear-to-same-side-shoulder) tie the head to the torso the same way every other
limb segment is tied to its parent joint.

**Why no new logic in `toDrawOps`.** The unrecoverable-endpoint skip rule (`opacityForStatus`
returning `null` for `'unrecoverable'`, both point and edge draw loops checking it) already
applies to any name in `SKELETON_EDGES` — an unrecoverable ear silently drops its two edges (to
nose and to its shoulder) exactly like an unrecoverable wrist already drops its edge to the elbow.
No spec delta needed for this mechanism; the existing "unrecoverable points/edges touching them are
skipped entirely" requirement already covers it by construction.

## D-fixture — `syntheticGait.ts`'s head model

**Decision.** Head (nose + both ears) is a rigid unit offset `HEAD_ABOVE_SHOULDER_PX` (60px, not
measured — a plausible neck-to-head-center distance) above the shoulder midpoint's own
BOUNCE-FREE baseline (`HIP_BASE_Y + dy`, where `dy` is the constant torso-lean offset), oscillating
at the identical phase/frequency as the hip bounce but with its own, independently-scaled
amplitude: `(verticalBouncePx * headBounceDamping) / 2` half-amplitude, where `headBounceDamping`
defaults to 0.85 (the midpoint of the 0.80–0.92 ratio the prior investigation measured). Both ears
share the head's y exactly (only x differs, spread `SIDE_VIEW_EAR_SPREAD_PX`/
`FRONT_VIEW_EAR_SPREAD_PX` depending on view — the same construction shoulders/hips already use
for their own bilateral pairs); nose is x-centered on the head midpoint, same y.

**Why NOT literally rigid to the shoulder point.** A literal rigid attachment (head = shoulder + a
constant offset) would inherit the shoulder's own FULL, undamped bounce amplitude — since
`shoulderMidY = hipMidY + dy` already carries the whole hip oscillation through `dy`'s constant
offset. That would make `earMid`'s expected value identical to `hipMid`'s, defeating the entire
point of testing a damped alternative signal in synthetic tests. Building the head's y
independently, from the SAME base position and phase but a separately-scaled amplitude, is what
makes `earMid`'s expected vertical-oscillation value hand-computable as `verticalBouncePx *
headBounceDamping / TORSO_LENGTH_PX` — mirroring exactly how the existing hip/shoulder
construction makes `hipMid`'s expected value hand-computable as `verticalBouncePx /
TORSO_LENGTH_PX`.

## D3 — Signal selection: one config key, no per-frame mixing, generalized extractor

**Decision.** `HeuristicsConfig.verticalOscillationSignal: 'hipMid' | 'earMid'` (new type
`VerticalOscillationSignal` in `types.ts`), default `'hipMid'` pending D4. `verticalOscillation.ts`
resolves `SIGNAL_KEYPOINTS[config.verticalOscillationSignal]` (a `Record<VerticalOscillationSignal,
[KeypointName, KeypointName]>`) once per call and passes it to the generalized extractor (see
below). `SIGNAL_LABEL` parametrizes every caveat string so degraded-result messages name the
actual signal tracked (`'Hip position'` / `'Head (ear-midpoint) position'`) instead of
hardcoding "hip."

**Extractor generalization (adapted from the original plan mid-implementation — #29 landed first
and moved the shared signal-extraction seam into `hipBounce.ts`).** `analyzeHipBounce(frames,
config)` — previously hip-only, hardcoding `resolveMidpoint(frame, 'left_hip', 'right_hip')` — is
now a thin wrapper around a new, generalized `analyzeBounceSignal(frames, config, pair:
[KeypointName, KeypointName] = ['left_hip', 'right_hip'])`. `cadence.ts`'s call site
(`analyzeHipBounce(frames, config)`) is UNCHANGED — it keeps calling the hip-pinned wrapper, never
the generalized function directly, so cadence structurally cannot be threaded a non-hip pair by a
future edit without an explicit, visible change at its call site. `verticalOscillation.ts` is the
only caller of `analyzeBounceSignal` with a non-default pair.

**Why no per-frame fallback between signals, ever.** If the configured signal's pair is
unresolvable on a given frame, that frame contributes nothing — `null` in `series`, absent from
the fit's sample set — rather than silently substituting the other signal's position for that
frame. Splicing between two physically different bilateral pairs frame-to-frame would inject
step-and-amplitude discontinuities at exactly the frames where the two signals' resolvability
diverges, corrupting `sinusoidR2` (the metric's publish gate) in a way that depends on which
frames happened to drop out for which signal — an effectively nondeterministic corruption, not a
graceful degradation.

**What DOES still apply: `resolveMidpoint`'s tolerant single-side fallback, WITHIN the chosen
signal.** If, say, `earMid` is configured and only the left ear resolves on a frame, that frame
still contributes — the left ear's position stands in for the pair, flagged `interpolated: true`,
exactly like every other bilateral-pair signal in this package (hip, shoulder) already tolerates a
single missing side. This is a different mechanism from the forbidden cross-signal fallback above:
it never substitutes a DIFFERENT keypoint pair, only tolerates one side of the SAME pair being
briefly unresolvable.

## D4 — Default decided by a pre-registered rule

**The rule, written before running the A/B below:**

Ship `earMid` as the new default IFF ALL FOUR hold, measured as paired trials (both signals
computed from the identical detection run, same frames) across both demo clips (track, park), N≥3
trials/clip:

- **(a) Stability**: `earMid` spread `(max−min)/median` ≤ 0.75 × `hipMid` spread on BOTH clips,
  AND `earMid` CV (sd/median) < `hipMid` CV on both.
- **(b) Fit quality**: `earMid` median `sinusoidR²` ≥ `hipMid` median − 0.05 on both clips; zero
  `earMid` null trials (fit failures or below-gate results); `earMid` median `frameCoverage` ≥
  0.95 × `hipMid`'s.
- **(c) Confidence tax**: `earMid` median `confidence` ≥ 0.95 × `hipMid`'s on both clips (guards
  against the single-ear-interpolation-flag tax described in D3 eating the stability advantage).
- **(d) The swap has to buy something**: `hipMid` spread > 10% on at least one clip IN THIS
  SESSION'S measurement. (Rationale: if the already-shipped spectral-fit estimator has already
  stabilized `hipMid` below the level where instability was the original complaint, switching
  signals for a physically different, unvalidated quantity buys nothing.)

Otherwise `hipMid` stays the default; `earMid` ships as a documented, available config option
regardless of the outcome either way.

**Pre-registered prediction (falsifiable, not a conclusion):** `hipMid` likely stays the default.
The prior investigation's spread numbers predate the spectral-fit estimator (#28) that already
addressed hip-signal instability directly; if that fix already closed most of the gap, gate (d)
fails regardless of how well `earMid` performs on its own terms.

**Semantic-change costs, weighed regardless of which way the rule lands (documented so a future
reader doesn't have to re-derive them):**
- Absolute values would shift 0.80–0.92× if the default flipped, unvalidated against any
  ground-truth watch reading (the one ground-truth clip available, per this repo's CLAUDE.md
  vertical-oscillation investigation, measures a front-approach clip where camera-distance drift
  is itself an open, separate problem — not a clean signal to validate a default-flip against).
- The metric would stop being a center-of-mass proxy at all — watches measure pelvis motion, not
  head motion — a real conceptual change to what "vertical oscillation" means in this app, not
  just a different noise floor on the same measurement.
- UI/spec text referencing "hip bounce" specifically (`MetricsPanel.tsx`'s copy,
  `VerticalOscillationChart.tsx`'s figcaption, the view-tolerance requirement's wording) would need
  updating to stay accurate.
- `verticalOscillationCm` stays hip-based regardless (D7) — a flipped default would leave two VO
  readouts (`verticalOscillation`'s ratio and `verticalOscillationCm`'s centimetres) measuring two
  different body parts, a potentially confusing inconsistency worth flagging even though this
  change doesn't resolve it either way.

**Result: see "Live A/B results" below, filled in after the measurement run.**

## D5 — `viewFitTable` untouched either way

**Decision.** No per-signal view-fit table. `viewFitTable.verticalOscillation`'s existing front-view
0.85 discount (justified by pelvic-drop noise being more visible face-on) would not, strictly,
survive an `earMid` default as currently worded — but no measurement in this change's evidence base
supports a DIFFERENT number for head bounce specifically, and building a per-signal table on zero
evidence is over-engineering. If D4 flips the default: the view-tolerance requirement gets one
sentence noting the discount is a conservative carry-over from the hip-based rationale, not
re-derived for the head. If D4 doesn't flip the default: no spec change needed here at all, since
`hipMid`'s existing rationale is undisturbed.

## D6 — View detection: verified no-op, pinned

**Decision.** No change to `viewDetection.ts`. It reads `left_shoulder`/`right_shoulder` (bilateral
spread) and `left_ankle`/`right_ankle` relative to `left_hip`/`right_hip` (sagittal excursion) by
name only — confirmed by reading the module, not inferred. Regression test T10 pins this: identical
`detectView` output whether `nose`/`left_ear`/`right_ear` are wildly mispositioned or fully
unrecoverable across every frame of an otherwise-identical clip.

## D7 — `verticalOscillationCm` stays hip-pinned unconditionally

**Decision.** No change to `verticalOscillationCm.ts`. It does not read `verticalOscillationSignal`
(it takes no `HeuristicsConfig` at all — its signature is `computeVerticalOscillationCm(frames:
RobustPoseFrame[])`), and keeps calling `resolveMidpoint(frame, 'left_hip', 'right_hip')`
unconditionally.

**Why.** The scale-calibrated centimetre figure's one piece of validated real-world evidence
(6.07–6.09cm on the track clip, landing inside the 6–13cm literature range for pelvis VO) is
hip-based. The hip-centered MediaPipe world-landmark calibration this feature already depends on
(`pixelsPerMeter`, derived from shoulder-hip torso length) is likewise anchored to the pelvis
segment. Threading a signal selection through this calculation would be scope creep against a
feature that has exactly one piece of validated evidence, and that evidence is specifically about
the hip. Regression test T11 pins the "stays hip-based regardless" behavior directly, by giving a
synthetic clip's head an intentionally wild (3×) bounce relative to its hips and confirming the
centimetre output is unaffected.

## D8 — No `signal` field in diagnostics

**Decision.** `AnalysisDiagnostics`/`VerticalOscillationFit` gain no new field naming which signal
produced a given run's result. The live A/B (below) reads both signals from a temporary
dev-only probe under its own `[vo-signal-ab]` console prefix, reverted after measurement — not a
permanent diagnostics field. The shipped default is a build-time constant
(`DEFAULT_HEURISTICS_CONFIG.verticalOscillationSignal`), not something that varies per-run in
production, so there's nothing for a per-run diagnostics field to usefully report there either;
and a degraded result's caveat already names the tracked signal via `SIGNAL_LABEL` (D3). Reversible
later as a `VerticalOscillationFit.signal` field if a future harness wants it — noted here so a
future reader doesn't have to re-derive why it's absent now.

## Test plan cross-reference

T1–T11 (full descriptions in tasks.md) cover: keypoint widening at the type/adapter boundary
(T1–T4), robustness-layer independence of the new head channels (T5), diagnostics aggregation
(T6), skeleton overlay rendering (T7), the synthetic fixture's head model (T8), vertical
oscillation's signal-selection contract including the no-fallback rule (T9), and the two verified
no-op pins (T10 view detection, T11 `verticalOscillationCm`).

---

## Live A/B results

Measured 2026-08-12: headless Chromium (real GPU, `--headless=new --enable-gpu
--ignore-gpu-blocklist`, MoveNet Lightning), 5 paired trials per clip (both signals computed from
the identical detection run via the dev-only `[vo-signal-ab]` probe), track and park demo clips.
No trial collapsed to `sampling.totalSamples === 1`; no re-runs needed.

### Per-trial values (torso-length ratio)

| clip | trial | hipMid value | hipMid conf | hipMid R² | earMid value | earMid conf | earMid R² | earMid interpFrac |
|---|---|---|---|---|---|---|---|---|
| track | 1 | 0.1686 | 0.950 | 0.791 | 0.1645 | 0.885 | 0.814 | 0.021 |
| track | 2 | 0.1791 | 0.957 | 0.847 | 0.1504 | 0.844 | 0.920 | 0.213 |
| track | 3 | 0.1806 | 0.957 | 0.842 | 0.1523 | 0.874 | 0.895 | 0.149 |
| track | 4 | 0.1785 | 0.957 | 0.819 | 0.1472 | 0.875 | 0.926 | 0.170 |
| track | 5 | 0.1439 | 0.229 | 0.416 | 0.1835 | 0.598 | 0.651 | 0.224 |
| park | 1 | 0.2363 | 0.687 | 0.704 | 0.2012 | 0.850 | 0.860 | 0 |
| park | 2 | 0.2404 | 0.674 | 0.696 | 0.1975 | 0.850 | 0.865 | 0 |
| park | 3 | 0.2371 | 0.678 | 0.699 | 0.1981 | 0.850 | 0.860 | 0 |
| park | 4 | 0.2355 | 0.667 | 0.692 | 0.1976 | 0.850 | 0.860 | 0 |
| park | 5 | 0.2329 | 0.679 | 0.699 | 0.1944 | 0.850 | 0.855 | 0 |

### Summary statistics

| clip | signal | median value | spread (max−min)/median | CV (sd/median) | median confidence | median frameCoverage | median sinusoidR² | null trials |
|---|---|---|---|---|---|---|---|---|
| track | hipMid | 0.1785 | 20.5% | 8.6% | 0.957 | 1.00 | 0.819 | 0 |
| track | earMid | 0.1523 | 23.8% | 9.8% | 0.874 | 1.00 | 0.895 | 0 |
| park | hipMid | 0.2363 | 3.2% | 1.2% | 0.678 | 1.00 | 0.699 | 0 |
| park | earMid | 0.1976 | 3.5% | 1.2% | 0.850 | 1.00 | 0.860 | 0 |

### D4 gate evaluation, as written

- **(a) Stability** — earMid spread ≤ 0.75 × hipMid spread AND earMid CV < hipMid CV, both clips:
  - track: earMid spread 23.8% vs. 0.75 × 20.5% = 15.4% → **FAILS** (23.8% > 15.4%). earMid CV
    9.8% vs. hipMid CV 8.6% → **FAILS** (not less than).
  - park: earMid spread 3.5% vs. 0.75 × 3.2% = 2.4% → **FAILS** (3.5% > 2.4%). earMid CV 1.2% vs.
    hipMid CV 1.2% → **FAILS** (tied, not strictly less).
  - **Gate (a): FAILS on both clips.**
- **(b) Fit quality** — earMid median R² ≥ hipMid median − 0.05, zero null trials, earMid
  frameCoverage ≥ 0.95 × hipMid's, both clips:
  - track: 0.895 ≥ 0.819 − 0.05 = 0.769 → passes. park: 0.860 ≥ 0.699 − 0.05 = 0.649 → passes.
    Zero null trials on both signals, both clips. frameCoverage 1.00 vs. 1.00 on both clips.
  - **Gate (b): PASSES on both clips.**
- **(c) Confidence tax** — earMid median confidence ≥ 0.95 × hipMid's, both clips:
  - track: 0.874 vs. 0.95 × 0.957 = 0.909 → **FAILS** (0.874 < 0.909) — the single-ear
    interpolation tax is visible directly: earMid's median `interpolatedFraction` on track is
    0.170 (one ear frequently unresolvable) vs. hipMid's 0.
  - park: 0.850 vs. 0.95 × 0.678 = 0.644 → passes (0.850 ≥ 0.644).
  - **Gate (c): FAILS on track.**
- **(d) The swap has to buy something** — hipMid spread > 10% on ≥1 clip this session:
  - track: 20.5% > 10% → **PASSES.**
  - **Gate (d): PASSES** (via track; park's 3.2% alone would not have satisfied it).

**All four gates must hold for the default to flip. Gate (a) fails outright on both clips, and
gate (c) additionally fails on track. hipMid stays the default**, exactly as the pre-registered
prediction anticipated.

### Interpretation

This directly contradicts the prior offline investigation's finding (ear-mid spread roughly half
hip-mid's, test4-headbob.json) — but the two are not measuring the same baseline. That
investigation predates the spectral-fit estimator (#28), which already replaced the old
extrema-pairing hip estimator specifically because of instability; #28's own measurements record
the park clip's cross-trial spread falling from 18.2% to 4.2% under the new fit. Measured here
post-#28, hip-mid's spread is already down to 3.2% (park) / 20.5% (track, dragged up by one
outlier trial — see below) — much of the instability ear-mid was originally measured to fix has
already been fixed by a different, unrelated change. Against that already-stabilized baseline,
ear-mid shows no further stability advantage in this session's measurement — if anything, a
slightly higher CV on both clips — while paying a real, visible confidence cost on the track clip
from the single-ear-interpolation tax (17-22% of track frames only resolved one ear this
session).

The track clip's trial 5 (hipMid: value 0.144, confidence 0.229, R² 0.416 — a clear outlier
against the other four trials clustered at 0.168–0.181, confidence ~0.95, R² 0.82–0.85) is
consistent with this repo's documented GPU non-determinism (CLAUDE.md's "Determinism caveat") —
one weaker detection run out of five, not evidence of a hip-signal-specific problem. It also
inflates hipMid's measured spread/CV somewhat; even excluding it, hipMid's spread across the
remaining 4 trials is ~7.9% and CV ~3.0%, still comfortably not exceeded by earMid's 23.8%/9.8%
computed across all 5 (earMid had no comparable outlier trial). Re-running gate (a) against only
the 4 non-outlier hipMid trials would not change the outcome — earMid's spread/CV would still not
clear the 0.75× bar.

**Decision: `hipMid` stays the default.** `earMid` ships as a documented, available
`verticalOscillationSignal` config option — implemented and tested (T9), just not the shipped
default. No `DEFAULT_HEURISTICS_CONFIG` change, no UI copy change, no spec wording change beyond
what's already in this change's ADDED requirement, no `index.test.ts` drift-guard change (that
test remains valid exactly because the default didn't move).

### MediaPipe confirmation trial

One trial per clip, `mediapipePoseLandmarker` backend via `window.__STRIDES_POSE_BACKEND_OVERRIDE__`:

| clip | keypoints entries | nose detected | left_ear detected | right_ear detected | scaleCalibration.verticalOscillationCm | torsoMeters |
|---|---|---|---|---|---|---|
| track | 15 | 57 | 57 | 57 | 6.075 | 0.505 |
| park | 15 | 84 | 84 | 84 | 14.997 | 0.473 |

Both clips confirm the widened 15-entry keypoints record with nonzero head-keypoint detected
counts on the MediaPipe path (not just MoveNet). The track clip's `verticalOscillationCm`
(6.075cm, `torsoMeters` 0.505) lands inside CLAUDE.md's previously-documented 6.07–6.09cm/≈0.5m
range, confirming #32's scale-calibration path is undisturbed by this change's keypoint widening.
