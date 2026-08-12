## Context

MediaPipe's `PoseLandmarker` returns two parallel landmark arrays per frame: `landmarks`
(normalized 0..1 image coordinates, which this backend already denormalizes into pixels) and
`worldLandmarks` (meters, **hip-centered** — the model's estimate of the pose in real-world
space with translation removed). The second array is currently discarded.

The ratio of the two gives a per-frame `pixelsPerMeter` scale. Everything below is about doing
something correct with it.

Measured evidence backing these decisions (epic #27's investigation, recorded in
`test1-metric-calibration.json`):

- World torso length is stable frame to frame (CV 2.3–2.7%) — it is a usable scale reference.
- Scale drift over a clip is real and large: 1.00x on the fixed-distance track clip, **3.03x**
  on the park approach clip (subject running toward a handheld camera).
- Naive absolute-position conversion on the drifting clip fabricated a **480 cm** excursion.
- The MediaPipe path is bit-deterministic across trials, so live verification of this change is
  exact rather than statistical (cross-trial spread on track VO_cm was 0.006 cm).

## Goals / Non-Goals

Goals:
- A real-centimeter vertical-oscillation figure on the MediaPipe backend, in diagnostics.
- Zero behavioral change on the MoveNet backend, provable by inspection of the diagnostics object
  (no key present at all, not a null).
- The integrated-delta constraint encoded as a regression test, not just prose.

Non-Goals:
- Correcting approach-translation drift (see "Out of scope" below).
- Any user-facing UI change; `MetricResult.unit` gains no `'cm'` member.
- Changing `computeVerticalOscillation`'s existing torso-length-ratio behavior in any way.

## Decisions

### D1 — Scale rides on the frame, not in a side channel

`PoseFrame` gains `pixelsPerMeter?: number` (absent when the backend doesn't measure scale);
`RobustPoseFrame` gains `pixelsPerMeter: number | null` (required, nullable).

Alternatives considered and rejected:

- **A side channel keyed by timestamp** (e.g. `Map<number, number>` returned alongside the
  frames). Unjoinable in practice: `PoseSample.timestamp` is the sampling loop's
  `metadata.mediaTime`, while `PoseFrame.timestamp` is `video.currentTime` — they are different
  numbers for the same frame, and `applyRobustness` keeps only the former on its output. A join
  key that doesn't survive the pipeline is not a key.
- **A parallel array indexed by frame position.** `trimToPresenceWindow` slices the frame array;
  every consumer would have to slice the parallel array in lockstep or silently mis-align. Data
  that must stay aligned with a frame belongs *on* the frame.

Naming: `pixelsPerMeter`, not `metricScale`. "Metric" already means "one of the seven form
metrics" throughout this codebase; overloading it would be actively confusing. The name also
states its own units, which is the whole point of the field.

Required-nullable (not optional) on `RobustPoseFrame`, deliberately: it forces every construction
site — including test fixtures — to say what it means, rather than letting the field be forgotten
into `undefined` at a site that should have carried a real value through.

### D2 — A sibling module, not a change to `computeVerticalOscillation`

New `src/heuristics/verticalOscillationCm.ts` exporting:

```ts
computeVerticalOscillationCm(
  frames: RobustPoseFrame[],
  config?: HeuristicsConfig,
): ScaleCalibratedVerticalOscillation | null   // null iff no frame carries scale
```

Rationale:
- `MetricResult.unit` is a closed union consumed by `MetricsPanel.tsx`'s `formatValue`; adding
  `'cm'` would be a user-facing change this ticket explicitly isn't making.
- `computeFormHeuristics` is backend-agnostic by contract. Making the seven-metric result shape
  depend on which detector produced the frames would leak backend identity into the heuristics
  layer.
- `verticalOscillation.ts` is being rewritten in parallel by ticket #28. A sibling file has no
  merge conflict with it; an edit to it would.

`useVideoAnalysis` calls the new function on the **same presence-trimmed frames** it hands to
`computeFormHeuristics` (the trim is hoisted into a local so there is one, shared window — a
second `trimToPresenceWindow` call would be a second chance to drift apart), and passes the
result to `computeAnalysisDiagnostics` as an optional fourth argument.

`AnalysisDiagnostics` gains `scaleCalibration?:` via conditional spread — the key is **absent**,
never present-and-undefined, when there is nothing to report:

```ts
scaleCalibration?: {
  verticalOscillationCm: number | null  // median half-cycle amplitude, cm; null if no cycle
  sampleSize: number                    // half-cycles used
  scaleDriftRatio: number               // last scale sample / first scale sample
  medianPixelsPerMeter: number
  torsoMeters: number | null            // torsoLengthPx / medianPixelsPerMeter — sanity ~0.5 m
  scaleCoverage: number                 // frames with measured scale / frames considered
  integrationRuns: number               // independent runs contributing (gap resets)
}
```

`torsoMeters` and `scaleDriftRatio` exist to make a bad run recognizable at a glance: a torso
that isn't roughly half a meter means the scale is wrong, and a drift ratio far from 1.0 means
the centimeter figure is inflated by approach translation rather than by real bounce.

### D3 — Amplitude from extrema pairing on the converted metric series, **per integration run**

The metric series is a cumulative sum of converted per-frame deltas:

```
v[0] = 0
v[k] = v[k-1] + (y[k-1] - y[k]) / s̄[k]
```

Sign convention: `(y[k-1] - y[k])` rather than `(y[k] - y[k-1])`, so that positive means *upward
on screen* (image-y grows downward) — matching the sign convention `computeVerticalOscillation`'s
charting series already uses.

Prominence must be expressed in the same units as the series, so the existing pixel threshold is
converted once: `config.verticalOscillationMinProminenceRatio * torsoLengthPx /
medianPixelsPerMeter` (meters). This keeps the two calculations detecting the *same* cycles under
constant scale, which is what makes the equivalence test in the plan meaningful.

**`findLocalExtrema` is called once per integration run, never over a flat concatenation of all
runs.** Each run's cumulative series restarts at 0, so run B's values are expressed against run
B's own arbitrary baseline. Pairing run A's last extremum with run B's first would produce an
"amplitude" equal to the difference between two unrelated baselines — a fabricated number with no
physical meaning, and potentially an enormous one. (`findLocalExtrema` does split on `null` gaps
internally, but its *output* is a flat list with no run labels, so the pairing loop downstream
could not tell a within-run pair from a cross-run one. Calling it per run makes the boundary
structural rather than a thing the pairing loop has to remember.)

Within a run, amplitudes are `|v[i] − v[i−1]|` for consecutive **opposite-kind** extrema, and
`VO_cm = median(amplitudes) × 100`.

Module structure: `collectScales → buildRuns → estimateAmplitudes`. Only the third stage knows
about extrema, which leaves a clean seam if #28's spectral fit is later composed in as an
alternative amplitude estimator over the same metric series. Deliberately **not** an abstract
estimator interface today — there is exactly one estimator, and an interface with one
implementation is speculative structure.

The 5-line opposite-kind pairing loop is duplicated from `verticalOscillation.ts` rather than
extracted into `extrema.ts`. The scope differs (per-run here, flat there), so the "shared" helper
would need a parameter distinguishing them; and extracting it would mean editing
`verticalOscillation.ts`, which #28 owns. Both copies carry a comment pointing at the other.

### D4 — Gap and interpolation semantics

1. **Hip position** comes from `resolveMidpoint(frame, 'left_hip', 'right_hip')` — the same
   resolver the pixel path uses, so interpolated hip keypoints *are* used. This is the same trust
   decision already made for the pixel path, and it is conservative in the right direction: linear
   interpolation across a gap under-states a curved trajectory's excursion, biasing amplitude
   down, never up.
2. **Integration runs** are the maximal contiguous index ranges where hip-mid resolves. Each
   integrates from its own zero. A gap means the signal's position during the gap is unknown, so
   carrying a cumulative sum across it would assert something unmeasured.
3. **Missing scale inside a run** (hip resolved, but that frame carried no `pixelsPerMeter` —
   e.g. an interpolated frame, or a frame whose world torso was degenerate) is filled by linear
   interpolation between the flanking scale samples, with a nearest-value hold at the run's edges.
   Scale is a smooth function of camera distance, so this is a far weaker assumption than
   interpolating a position. A run with **zero** scale samples is dropped entirely and counted —
   never borrowed from a neighboring run, which would silently apply one camera distance's scale
   to a different camera distance's motion.
4. **Step scale** is the average of the two flanking frames' scales,
   `s̄[k] = (s̃[k−1] + s̃[k]) / 2`. Under constant scale this is exactly the constant, which is
   what makes the converted result identical to `pixel_amplitude / s` — the equivalence the
   regression test asserts to 1e-9.

### D5 — Spec carve-out for the presence-trim requirement

`form-heuristics`'s existing requirement "Metrics are computed over a presence-trimmed window,
not the raw clip" currently states that the development-only diagnostics reflect the full,
untrimmed clip. That stays true of every existing field — but the new `scaleCalibration` block is
computed over the *trimmed* window, precisely because it must see the same frames
`computeFormHeuristics` does or its numbers wouldn't be comparable to the ratio metric's. The
requirement is MODIFIED with an explicit carve-out naming that one block, rather than left to
quietly contradict the implementation.

## Risks / Trade-offs

- **No NaN or Infinity may escape.** The form-heuristics output contract forbids it. Guards:
  `pixelsPerMeter` is emitted only when both torso measurements are finite and the world torso is
  strictly positive; a run with no scale is dropped rather than divided by; `scaleDriftRatio` and
  `torsoMeters` are only computed when there is at least one scale sample.
- **Pixel space must match the keypoints'.** The pixel torso is measured on the
  already-denormalized `rawKeypoints` (intrinsic `videoWidth`/`videoHeight`), not on CSS/display
  dimensions, so it is in exactly the space the hip-y series later lives in.
- **`worldLandmarks` may be `[]` or absent**, and `landmark.visibility` may be `undefined`.
  Both are guarded. Visibility is deliberately **not** used to gate the scale measurement: it
  would add a threshold to tune and would make the output depend on a confidence value that this
  backend's determinism is otherwise free of. A degenerate (zero-length) world torso is rejected
  on its own merits instead.
- **Park-clip inflation is expected and documented, not tuned away.** The park approach clip
  reads ~14.8 cm with a ~3.0x drift ratio. That figure is recorded as expected-but-drift-inflated;
  the watch's ~10% reading is a *ratio*, not centimeters, and is not a comparable target. Tuning
  toward it would be fitting to a number that measures something else.

## Out of scope (follow-ups)

- **Approach-drift correction.** Adjacent-opposite-pair averaging (which gave 9.7–15.6 cm on the
  park clip in the investigation, untested) is the obvious next step for clips where the subject
  translates toward or away from the camera. Not implemented here: it is a second, independent
  correctness question, and shipping it in the same change would make the integrated-delta result
  impossible to validate on its own.
- **Surfacing centimeters in the results UI**, which needs a `MetricResult.unit` extension and a
  product decision about whether cm replaces or accompanies the torso-length ratio.
- **Composing with #28's spectral amplitude estimator** — amplitude in meters via the same fit is
  a natural composition over the same converted series, and `estimateAmplitudes` is the seam for
  it, but it is not required by this change.
