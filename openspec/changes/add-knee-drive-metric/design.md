# Design — add-knee-drive-metric

## D1 — Signed vs. unsigned thigh angle: an empirical decision, pre-registered here

**The problem.** The unsigned hip→knee-vs-vertical angle is large BOTH at forward knee lift AND at
backward trail (toe-off) — unlike kneeFlexion's interior angle, "vs vertical" does not fold
fore/aft away. Risk: two peaks per stride per leg, corrupting the one-peak-per-stride aggregation
and reporting a median contaminated by trail-leg extension, which is a different motion from knee
drive.

**Two candidate resolutions**, exactly one of which ships:

- **(a) Unsigned** — `θu = |atan2(dx, dy)| · 180/π` on hip→knee (D2). Viable iff forward-drive
  peaks dominate trail peaks prominence-wise, the same amplitude argument that lets kneeFlexion
  skip phase windowing.
- **(b) Signed** — `θs = atan2(dx, dy) · 180/π · travelDirection` (trunkLean's
  `estimateTravelDirection` pattern), so forward lift is positive and trail is negative, and
  `findLocalExtrema` maxima are forward-lift peaks by construction. Fine here because kneeDrive is
  side-gated and travel direction resolves on side views — it is Demo 2's FRONT view where
  `estimateTravelDirection` returns 0. Direction 0 → `value: null` with a distinct caveat.

**Pre-registered decision rule** (registered BEFORE the probe runs; measurements below are
recorded after). Probe: `src/heuristics/kneeDrive.experimental.ts` +
one dev-only console line in `useVideoAnalysis.ts`, per CLAUDE.md's add–measure–revert cycle. TWO
fresh-process trials on Demo 1 (side view), optionally one multiperson-upload trial as
corroboration. Per leg: the signed series θs(t), the unsigned series θu = |θs|, and a prominence
ladder `findLocalExtrema(series, r)` for r ∈ {2, 5, 8, 12, 16, 20, 25, 30}° on BOTH series,
recording surviving maxima {t, valueDeg, forward} per rung; plus a kneeFlexion replica
(`180 − angleBetweenVectorsDeg(knee, hip, ankle)` → `findLocalExtrema` at 20°) emitting maxima
timestamps per leg; plus the full raw θs series.

Pool per-leg unsigned maxima across both Demo 1 trials. Let F = forward peaks (θs > 0 at the
peak), B = backward/trail peaks:

- Adopt **(a) unsigned** iff on BOTH legs in BOTH trials some ladder rung r has every F member
  surviving and no B member surviving, AND min-prominence(F) ≥ 2× max-prominence(B). The
  prominence floor (D4) is then the geometric mean of the bracketing prominences, rounded to the
  nearest 5°.
- Else adopt **(b) signed**. The floor is then half the minimum true forward-peak prominence on
  the signed series, rounded to the nearest 5°, minimum 5°.

**Plausibility gate**: the median forward peak must land in [20°, 90°] from down-vertical.
Outside → STOP, revisit the angle definition, report; do not ship a number that fails its own
sanity band.

**STOP/escalate rule (duplicate-metric check)**: match each forward-lift peak to the nearest
same-leg kneeFlexion maximum; δ = the median inter-sample interval (~0.08 s on Demo 1). If the
median |Δt| ≤ δ AND ≥80% of matched pairs have |Δt| ≤ δ → STOP the ticket and report: the metric
would duplicate kneeFlexion's instants and a distinct metric is not justified.

**Sample-count gate**: fewer than 4 forward peaks on a clean Demo 1 trial → STOP and report
rather than silently lowering `MIN_KNEE_DRIVE_SAMPLE_SIZE`.

### D1 — Measurements (recorded after the probe)

**Pending probe.** This section is filled in by the probe commit; the rules above are frozen as of
the skeleton commit.

## D2 — Angle reference: the DOWN-vertical ray, not trunkLean's up-vertical

The thigh hangs DOWN from the hip at rest, so zero must be the down-vertical ray — a runner
standing still reads 0°, and lift grows the number. On hip→knee with image-y growing downward,
`dy > 0` when the knee is below the hip, so:

- unsigned: `θu = |atan2(dx, dy)| · 180/π` — 0° thigh straight down, 90° thigh horizontal.
- signed: `θs = atan2(dx, dy) · 180/π · travelDirection` — forward lift positive.

This is deliberately NOT trunkLean's `atan2(dx, -dy)` (`trunkLean.ts:163`): that convention zeroes
on the UP-vertical because a torso points up; a thigh points down. Reusing trunkLean's formula
verbatim would read ~180° for a resting thigh and fold lift the wrong way through the
discontinuity at ±180°. Same primitive, opposite reference ray, and the sign of `dy` passed to
`atan2` is the entire difference.

## D3 — View gating: kneeFlexion's row, copied

Thigh lift is a sagittal-plane angle, foreshortened toward a degenerate reading face-on — the
identical argument to kneeFlexion/trunkLean/overstriding. `viewFitTable.kneeDrive` copies
kneeFlexion's row exactly: side `{ fit: 'primary', multiplier: 1.0 }`, front
`{ fit: 'unsuitable', multiplier: 0.1 }`, ambiguous `{ fit: 'unsuitable', multiplier: 0.2 }`.
Computed-not-withheld on unsuitable views per "never a silent wrong number", with a caveat via
`viewPhrase(view)` mirroring kneeFlexion's sagittal phrasing.

## D4 — Prominence floor: derived from measurement, explicitly not kneeFlexion's 20

`kneeFlexionMinProminenceDegrees: 20` was sized for the flexion-degrees signal, whose swing-phase
amplitude routinely exceeds 100°. The thigh-angle signal has a different scale (lift peaks
plausibly 30–70° with trail excursions of similar order), so 20° may be either far too permissive
or far too strict — the number cannot be copied, only measured. The probe's prominence ladder (D1)
is what sizes `kneeDriveMinProminenceDegrees`; the derivation rule per branch is pre-registered in
D1. Filled in with D1's measurements.

## D5 — Exemplar: `kneeDrivePeak`, median-nearest peak ghosted against the same-leg trough

Same rationale as `kneeFlexionPeak`, clause for clause: the reported value is a median of peaks,
so the picture must be a REPRESENTATIVE peak (median-nearest), not the clip's largest; the
adjacent same-leg trough (via `adjacentMinimum`, either direction) is what makes a lifted thigh
legible against a hanging one, is scored for resolvability only, and is never captioned as
measured. A peak with no adjacent trough is dropped, not demoted at build time. One pair max —
a second near-median peak is the same picture of the same runner.

`'kneeDrivePeak'` joins `SINGLE_INSTANT_KINDS`, on the principle `strides-r41` established for
`kneeFlexionPeak`: the card's number is a peak angle at one instant, and the annotation draws that
angle's arc at that instant, so a demoted single still shows exactly what the card reports.

Annotation marks (`buildKneeDriveMarks`), existing primitives only: the thigh line on both
instants; base-instant-only a down-vertical `'verticalReference'` ray at the hip (that role's doc
widens to name both directions) and the angle arc under a new `'kneeDriveArc'` role whose doc
names the measured angle and its screen-relativity, per `trunkLeanArc`'s precedent. The ghost is
unmeasured (`measuredAtInstant` returns `false`), per `kneeFlexionPeak`.

## D6 — `MIN_KNEE_DRIVE_SAMPLE_SIZE = 4`

Mirrors `MIN_KNEE_FLEXION_SAMPLE_SIZE = 4` for the same reason stated there: roughly one full gait
cycle's worth of peaks (one per leg per stride, both legs pooled) is the judgment-call minimum for
a stable median; fewer is too easily dominated by a single noisy cycle. The probe's sample-count
gate (D1) verifies Demo 1 clears this rather than assuming it.
