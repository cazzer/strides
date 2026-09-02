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

### D1 — Measurements (recorded after the probe) — VERDICT: (b) signed, floor 10°

Probe run 2026-09-02: `kneeDrive.experimental.ts` + one dev-only `[knee-drive-probe]` line in
`useVideoAnalysis.ts` (both reverted), driven by a throwaway scratchpad driver — fresh Chromium
process per trial, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`), dev server started and
identity-verified by the run. Two Demo 1 trials plus one multiperson upload trial. **The two
Demo 1 trials were bit-identical on every field**, consistent with the fresh-process determinism
CLAUDE.md documents, so the "BOTH trials" clauses below collapse to one set of numbers. Probe
series ran over the presence-trimmed frames (59 on Demo 1), the same window the metrics see.
`travelDirection` resolved `+1` on Demo 1 and `−1` on multiperson. Peak prominence is proxied by
the SURVIVAL RUNG — the highest ladder rung at which the peak still appears (matched across rungs
by timestamp ±0.10 s); peaks are enumerated at the 5° rung.

**Option (a) unsigned FAILS, on Demo 1's right leg.** Unsigned maxima, both trials:

| leg | F (forward) t / value° / survival rung | B (trail) t / value° / survival | minSurv(F) vs 2×maxSurv(B) |
|---|---|---|---|
| left | 3.96 / 41.9 / 25 · 4.48 / 49.2 / 30 · 5.84 / 48.9 / 30 | 5.36 / 30.2 / 12 | 25 ≥ 24 — passes |
| right | 3.88 / 34.2 / 30 · 4.24 / 16.4 / **8** · 5.20 / 56.1 / 30 | 4.60 / 29.8 / **20** · 5.96 / 22.2 / 12 | **8 < 40 — fails** |

On the right leg the weakest forward peak (t=4.24, 16.4°, prominence <12 on the unsigned series)
is WEAKER than the strongest trail peak (t=4.60, 29.8°, prominence ≥20): no ladder rung keeps
every F member while dropping every B member, and the 2× separation reads 0.40×. (t=4.24 sits at
Demo 1's documented t≈4.32 collapsed-detection wedge, but the pre-registered rule carries no
artifact-exclusion clause and none is invented here — the failure stands as measured.) The
amplitude argument that lets kneeFlexion skip phase windowing does NOT transfer to the unsigned
thigh angle.

**Option (b) signed ADOPTED.** On the signed series the trail excursions fold negative and every
maximum from rung 2 through rung 20 is the same one-per-stride forward-lift set — zero jitter
maxima even at the 2° rung (3-sample smoothing plus the fold): left {3.96/41.9°, 4.48/49.2°,
5.84/48.9°} (survivals 25/30/30), right {3.88/34.2°, 4.24/16.4°, 5.20/56.1°} (survivals
30/**20**/30). **Floor: minimum forward-peak prominence = 20 (right t=4.24) → half = 10 → nearest
5° = `kneeDriveMinProminenceDegrees = 10`.** On Demo 1 the floor lands mid-plateau: the maxima
sets at rungs 8 and 12 are identical, so ±one rung changes nothing there.

**One measured artifact, and the implementation consequence.** The extrema finder's trailing-pivot
emission produced a rung-2..16 'max' at t=6.20 with value **−0.4°** on the right leg — the leg
caught mid-trail at the series end. A maximum with θs ≤ 0 is not a forward lift, so the
implementation keeps only maxima with a POSITIVE signed value. This implements branch (b)'s
pre-registered intent ("maxima are forward-lift peaks by construction") at the one place the
construction leaks — series boundaries — rather than adding a new tuned threshold.

**Plausibility gate: PASSES.** At floor 10 with non-positive maxima dropped, Demo 1 pools 6 peaks
{16.4, 34.2, 41.9, 48.9, 49.2, 56.1} → median **45.4°**, inside [20°, 90°].

**STOP/escalate rule (duplicate-metric): DOES NOT FIRE.** δ = median inter-sample interval =
0.040 s on Demo 1 (the trimmed frame array samples at 25 fps × the sampler's cadence; the ~0.08 s
figure the rule anticipated was the detected-frame spacing — the measured δ is the STRICTER one,
so the no-fire verdict is conservative). Forward-lift peaks vs nearest same-leg kneeFlexion
maxima (replica at kneeFlexion's own 20° floor): left |Δt| = {0.080, 0.160, 0.160} s, median
0.160; right {0.000, 0.080, 0.160}, median 0.080. Neither leg has median ≤ δ, and the ≤δ fraction
is 0% / 33% against the rule's ≥80%. The two metrics' instants genuinely diverge — kneeFlexion
also finds 5–6 maxima per leg where kneeDrive finds 3, so the sets differ in cardinality, not
just phase.

**Sample-count gate: PASSES.** 6 forward peaks pooled across legs on a clean Demo 1 trial (≥ 4).

**Multiperson corroboration** (not part of the rule): travelDirection resolves (−1), floor 10
keeps 14 positive forward maxima across both legs, pooled median 33.3° — inside the plausibility
band. The right leg carries a few small (5–9°) high-prominence peaks from that clip's noisier
tracking (96.5 px torso); they move the median, not the mechanism.

**Review-round refinement (no measurement change):** branch (b)'s "direction 0 → null + distinct
caveat" splits into TWO distinct null causes in the implementation. `estimateBodyScale` returning
null means the direction was never estimated at all, and folding that into the
"no net horizontal displacement" wording would name a false cause — so it gets its own early
return with overstriding's exact body-scale caveat, and the indeterminate-direction caveat is
reserved for a clip whose scale resolved and whose displacement genuinely measured below the
threshold. Both reach the metric's null contract identically; only the stated cause differs.
Unreachable on all three harness clips (each resolves a body scale), so no live re-measurement
accompanies it.

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
amplitude routinely exceeds 100°. The thigh-angle signal has a different scale (measured lift
peaks 16–56° on Demo 1), so 20° may be either far too permissive or far too strict — the number
cannot be copied, only measured. The probe's prominence ladder (D1) is what sizes
`kneeDriveMinProminenceDegrees`; the derivation rule per branch is pre-registered in D1.

**Measured (D1): `kneeDriveMinProminenceDegrees = 10`** — half the minimum true forward-peak
prominence on the signed series (20, at Demo 1's t=4.24 right-leg peak), rounded to the nearest
5°. Note kneeFlexion's 20 would have silently dropped that genuine peak — the concrete proof the
two floors cannot share a number.

## D5 — Exemplar: `kneeDrivePeak`, median-nearest peak ghosted against the same-leg trough

Same rationale as `kneeFlexionPeak`, clause for clause: the reported value is a median of peaks,
so the picture must be a REPRESENTATIVE peak (median-nearest), not the clip's largest; the
adjacent same-leg trough (via `adjacentMinimum`, either direction — on the signed series the
minima are the TRAILING extremes, so the ghost is the thigh at its rearmost swing) is what makes
a lifted thigh legible against the same thigh swept back, is scored for resolvability only, and
is never captioned as measured. A peak with no adjacent trough is dropped, not demoted at build time. One pair max —
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
gate (D1) verified Demo 1 clears this rather than assuming it: 6 forward peaks pooled across both
legs, no spread across trials.
