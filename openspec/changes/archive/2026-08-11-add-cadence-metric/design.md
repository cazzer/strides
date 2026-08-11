## Context

`src/heuristics/footstrikes.ts` (extracted in the footstrike-extraction ticket, #17) already
provides `detectFootstrikes(frames, config): FootstrikeCandidate[]` — a timestamp-sorted list of
`{ frameIndex, timestamp, side }` across both legs, the same ankle-y-extrema detection
`overstriding.ts` used before the extraction. `RobustPoseFrame.timestamp` is `video.currentTime`
(a real-time media clock), so "footstrikes per minute of clip duration" is a stable definition of
cadence regardless of playback rate or sampling FPS — no separate time-signature handling is
needed, and this holds whether the clip was sampled at 15fps or 60fps.

This document's job, per the issue's own framing, is the one open judgment call the ticket left
for implementation time: whether cadence should be hard-gated to side view (like trunk lean and
overstriding) or view-tolerant (like vertical oscillation), and by how much.

## Goals / Non-Goals

**Goals:**

- Compute cadence as `detectFootstrikes(frames, config).length / (clip duration in minutes)`,
  reusing the shared footstrike primitive with zero reimplemented detection logic.
- Give cadence its own `viewFitTable` entry with a reasoned, documented per-view multiplier,
  matching the existing per-metric pattern (`trunkLean`, `overstriding`, `verticalOscillation`).
- Follow the established `compute<Metric>(frames, view, config) => MetricResult` shape exactly:
  same confidence formula (`computeMetricConfidence`), same "never null-because-of-view, never
  NaN, never throws" contract as every other metric in this package.

**Non-Goals:**

- Per-leg cadence, stride length, or ground-contact time — out of scope for this ticket; cadence
  is explicitly "both feet combined," per the issue.
- Any new footstrike-detection logic — `footstrikes.ts` is used as-is. If it turned out to be
  insufficient for cadence, the correct move would be to stop and extend that module in its own
  change, not to duplicate detection here; it was sufficient, so this didn't come up.
- Foot-strike-pattern (heel/mid/forefoot classification) — a separate, parallel ticket that also
  consumes `detectFootstrikes`, but a different downstream question.

## Decisions

### Cadence's view-fit follows vertical oscillation, not overstriding

This is the design decision the issue explicitly flagged as needing to be made and documented
here, not left implicit.

**The question:** trunk lean and overstriding are hard-gated to side view (`unsuitable` in front/
ambiguous, multipliers `0.1`/`0.2`) because they measure a **sagittal-plane** (fore-aft) quantity
that a front-facing camera literally cannot see — the axis is foreshortened to near-zero in the
image, and what a front camera sees instead (mediolateral sway, foot placement width) is a
*different physical quantity*, not just a noisier version of the same one. Vertical oscillation,
by contrast, is `'tolerated'` in front/ambiguous (multipliers `0.85`/`0.6`) because pelvis
vertical motion projects onto image-y *similarly* regardless of which way the runner faces the
camera — front view is the same physical quantity, just somewhat noisier. Which camp does cadence
belong to?

**The answer: cadence belongs with vertical oscillation, not overstriding/trunk lean.** Cadence
only needs to know *when* a footstrike happened — a footstrike is detected as a local maximum of
ankle-y (see `footstrikes.ts`'s doc comment: "ankle.y largest ≈ foot lowest on screen ≈ closest to
the ground"), which is a **vertical-axis** signal, exactly like hip-y for vertical oscillation.
Cadence never reads the ankle's *x* position (that's overstriding's job) or any fore-aft offset —
just whether and when the vertical extremum occurred. A level camera projects that vertical
excursion onto image-y comparably whether it's looking at the runner from the side or head-on, by
the same physical argument `verticalOscillation.ts` already makes for hip-y (and the same
out-of-scope caveat: no roll correction for a non-level camera, in either case). So cadence is
`'primary'`/`'tolerated'`/`'tolerated'` across side/front/ambiguous — never `'unsuitable'`, never
withheld to `null` purely because of view.

**Why the front-view multiplier is `0.8`, not vertical oscillation's `0.85`:** the two aren't
*identical* in their front-view noise profile, and it would be dishonest to just copy vertical
oscillation's number without checking. Hip-mid tracking (vertical oscillation's input) has no
occlusion concern from facing direction — the hips don't cross each other regardless of camera
angle. Ankle tracking (cadence's input, via `detectFootstrikes`) does: front-on, right around each
footstrike, the swing leg's ankle passes close to — sometimes nearly in front of or behind — the
stance leg's ankle on screen, a crossing/occlusion risk that side view doesn't have (from the
side, the legs stay laterally separated on screen throughout the stride). That's a real, distinct
noise source specific to ankle tracking, not shared with hip tracking.

More importantly, the *failure mode* is worse for cadence than for vertical oscillation. Vertical
oscillation aggregates many half-cycle amplitudes via `median` — a handful of noisy amplitude
readings get outvoted by the rest. Cadence's `value` is `strikeCount / durationMinutes`: every
individual missed or spuriously-double-counted strike changes the numerator directly, with no
averaging to absorb it. A front-view clip that misses one footstrike out of twelve doesn't
quietly nudge a median a little; it undercounts cadence by roughly 8%, a directly visible error in
the displayed number. Given a real (if unmeasured) additional noise source and a less-forgiving
aggregation, `0.8` — a modest step below vertical oscillation's `0.85`, not a cliff down toward
trunk lean/overstriding's `0.1` — is the reasoned middle ground: front view is still fundamentally
the same measurable quantity (unlike trunk lean/overstriding's case), just modestly less reliable
than vertical oscillation's own front-view case, for a specific and namable reason rather than a
generic "front view is worse" instinct.

**The ambiguous-view multiplier stays at vertical oscillation's `0.6`, unchanged.** `'ambiguous'`
already represents a *different* kind of uncertainty — the two independent view-detection signals
(BSR, SER) disagreeing or being individually inconclusive — that isn't specific to which physical
quantity a metric measures. There's no analogous "cadence-specific" argument to make here the way
there is for the front-view case above, so borrowing vertical oscillation's already-reasoned
number is the honest choice, not an arbitrary one.

### Duration = `frames[frames.length - 1].timestamp - frames[0].timestamp`, not just the last timestamp

Sampling in this pipeline starts at (or extremely near) `t = 0` in every existing fixture and, per
the current `useVideoAnalysis` polling loop, in practice — so `frames[frames.length -
1].timestamp` alone would usually be numerically indistinguishable from the full span. The
subtraction is used anyway: it costs nothing, stays correct if that "starts near zero" assumption
ever stops holding (e.g. a future caller trimming a leading segment, or a clip that starts
mid-video), and makes the code's intent — "elapsed time actually spanned by these frames" — explicit
rather than relying on an unstated assumption about where the clock starts.

### No new sample-size or coverage primitive; existing ones adapted, not reused unmodified

Cadence needs a `sampleSize` (feeds the same `computeMetricConfidence` sample-size-adequacy
factor every other metric uses) and a `frameCoverage`. Two candidates were considered and
rejected before landing on the final choice:

- **Reusing overstriding's `frameCoverage` definition** (fraction of candidate footstrikes that
  also had a resolvable hip position) doesn't apply: cadence never resolves a hip position at
  all — it only needs the footstrike *timestamps* `detectFootstrikes` already returns, not any
  additional per-candidate keypoint lookup that could itself fail.
- **A flat `1.0`** (since every detected candidate trivially "counts") would silently ignore a
  real risk: a clip with long untracked stretches (ankle unresolvable for seconds at a time) could
  have missed footstrikes entirely during those gaps, without `strikeCount` or `durationMinutes`
  reflecting that at all — `detectFootstrikes` simply has nothing to detect during an unresolvable
  stretch, and neither the count nor the duration divisor knows a gap happened.

The chosen definition — `bodyScale.sampleCoverage` (the same fraction-of-frames-with-a-resolvable-
torso used by `estimateBodyScale` throughout this package) — directly answers "how much of this
clip's duration could the runner actually be tracked in," which is exactly the risk above. It's a
coarser proxy than overstriding's per-candidate coverage (it doesn't distinguish "gap right where
a strike would've been" from "gap during a stretch with no strikes anyway"), but it's a real,
non-arbitrary signal rather than a placeholder, and it costs no additional computation since
`estimateBodyScale` is already called for the "no body-scale reference" null-result check.

`sampleSize` is simply the detected strike count, matching `MIN_CADENCE_SAMPLE_SIZE = 4` — the
same "roughly one full gait cycle" judgment call and reasoning as `overstriding.ts`'s
`MIN_OVERSTRIDE_SAMPLE_SIZE`, since both are counting the same underlying footstrike events.

### `interpolatedFraction` is read off each candidate's ankle point, not recomputed

`detectFootstrikes` doesn't expose whether the ankle-y extremum it found came from an interpolated
or directly-detected point. Rather than reimplementing extrema detection to recover that (which
the issue's boundaries explicitly rule out), `computeCadence` does exactly what
`computeOverstriding` already does for its own, different purpose: calls `resolvePoint` on the
specific `(frameIndex, side)` pair each candidate already carries, and checks
`.interpolated`. `footstrikes.ts`'s own doc comment names this as the intended use of `side` being
carried on each candidate — "for consumers ... that need to resolve a per-leg point at that
instant" — so this is using the module as designed, not working around a gap in it.

## Risks / Trade-offs

- **The front-view `0.8` multiplier is a documented judgment call, not a measured one** — same
  caveat every other constant in this package carries (see the form-heuristics change's own
  design.md "Risks" section). It's reasoned relative to vertical oscillation's already-accepted
  `0.85`, not derived from real footage, and should be revisited once real clips are available.
- **`bodyScale.sampleCoverage` as cadence's `frameCoverage` is a coarser signal than the
  per-candidate coverage other event-sampled metrics use** (see Decisions above) — it can't tell
  the difference between "this clip's untracked stretch happened to overlap a missed footstrike"
  and "this clip's untracked stretch was during a lull with no strikes to miss." Accepted as a
  real but bounded imprecision, consistent with this package's existing tolerance for coarse-but-
  honest proxies (e.g. footstrike-via-ankle-extremum itself).
- **A genuinely very short clip** (well under the ~1 second needed for `MIN_CADENCE_SAMPLE_SIZE`
  strikes at a plausible cadence) will report a real but low-confidence value with a visible
  caveat, per this package's "never a silent wrong number" principle — not a special case, just
  the ordinary low-sample-size path every other metric already has.

## Migration / Rollout

Purely additive to `form-heuristics` — no existing metric's computation, thresholds, or output
changes. `FormHeuristicsResult` gains a new required field (`cadence`), which is a source-breaking
change for any hand-built `FormHeuristicsResult` fixture (test files in this repo; addressed in
this change) but not for any consumer that only reads existing fields.
