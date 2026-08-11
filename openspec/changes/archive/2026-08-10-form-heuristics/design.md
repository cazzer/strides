## Context

Issue #7 (parent: #1 partial, blocked by #5) asks for three running-form heuristics — vertical
oscillation, trunk lean, overstriding — plus a view-detection sub-concern to gate/adapt each one
by camera angle. `src/pose/robustness/types.ts` already defines `RobustPoseFrame`: 12 fixed
keypoints, each `'detected'` (real), `'interpolated'` (gap-filled, bounded), or `'unrecoverable'`
(`x`/`y` null, never fabricated). This change consumes that shape directly — nothing here reads
raw `PoseFrame` or `PoseSample`. The issue explicitly frames this ticket as owning "the actual
biomechanics judgment calls (thresholds, formulas)" and asks that they be documented, not left
arbitrary; that's this document's job.

## Goals / Non-Goals

**Goals:**

- Classify a clip's camera framing (side / front-or-back / ambiguous) from keypoint
  geometry/motion alone, with a documented, defensible failure mode when the signals don't agree.
- Compute vertical oscillation, trunk lean, and overstriding from `RobustPoseFrame[]`, each with a
  real, reasoned biomechanical formula — not an arbitrary placeholder.
- Give each heuristic an explicit, per-view degradation policy: never a silent wrong number, never
  a hard crash, always a value (when computable) plus a confidence that reflects view-fit,
  input coverage, how much was interpolated vs. directly detected, and sample size.
- Share the expensive/subtle primitives (torso-length normalization, gap-aware extrema-finding,
  the confidence formula) across all three heuristics and view detection, so they're implemented
  and reasoned about once.

**Non-Goals:**

- Rendering, a results view, or any UI — ticket #8's job.
- A live polling loop against a real `<video>`/`PoseDetector` — tested entirely against
  synthetic/hand-built `RobustPoseFrame[]` fixtures, matching the pattern `pose-robustness`
  established.
- Empirically validating any threshold/constant introduced here against real running footage —
  every one is a documented, reasoned default, explicitly flagged as needing that validation
  later (see Risks below), not derived from measured data.
- Additional heuristics beyond the three named in the issue (cadence, arm swing, etc.) — future
  scope.
- Roll correction for a non-level camera, ground-plane calibration, or a real foot/toe keypoint —
  all explicitly out of scope; see the overstriding and vertical-oscillation sections below for
  what that costs each metric.

## Decisions

### Torso length is the shared normalizer, not shoulder width or leg length

Every pixel-space measurement here (bounce amplitude, lean's implicit scale via `atan2`,
overstride offset) needs a normalizer to become a dimensionless, camera-distance-independent
ratio. Three candidates: shoulder width, leg length, torso length (shoulder-mid to hip-mid
distance).

- **Shoulder width** collapses toward zero in side view — the camera looks almost straight along
  the mediolateral axis, so left/right shoulder points nearly coincide. That's a degenerate
  denominator exactly in the view where trunk lean and overstriding need to work.
- **Leg length** is itself modulated by the gait cycle being measured — a leg's apparent length in
  the image changes continuously as the knee flexes through a stride. Normalizing by it would be
  quietly circular: the denominator moves with the numerator.
- **Torso length** stays close to constant across a stride (the torso doesn't meaningfully change
  length as a rigid segment) and stays non-degenerate from either camera angle (it's always
  visible as a real 2D distance, whether the camera is beside or in front of the runner).

`estimateBodyScale` computes it as the **median** distance between `resolveMidpoint`'d
shoulder-mid and hip-mid across all frames where both resolve, specifically to avoid one
badly-interpolated frame dragging a mean-based estimate away from the runner's real proportions.

### View detection requires two independent signals to agree

A single geometric signal for "is this side or front view" is one dimension away from a coin
flip — plausible failure modes (a runner cutting diagonally across frame, a camera slightly
off-axis) can push any one signal toward the wrong threshold. Two structurally different signals
were chosen specifically because they fail in different circumstances:

- **Bilateral Spread Ratio (BSR)**: how far apart the left/right shoulder and hip points are,
  relative to torso length. This is a **static geometry** signal — it works even on a single
  still frame, but is vulnerable to a torso twist or an off-axis camera producing an ambiguous
  spread.
- **Sagittal Excursion Ratio (SER)**: how far each ankle ranges (p95-p5, not min/max, for
  robustness to one bad detection) relative to its own hip over the whole clip, relative to torso
  length. This is a **motion** signal — it needs the runner to actually be running (or at least
  moving through a gait cycle) to say anything, but is far more robust to a momentary bad
  keypoint or an odd static pose than BSR is.

Requiring **both** to vote the same way before committing to `'side'` or `'front'` — rather than
picking whichever is more confident, or averaging them — is deliberate: a confident wrong label
would silently corrupt every downstream metric's view-fit gating (trunk lean and overstriding, in
particular, would report numbers computed under the wrong physical interpretation of the axes).
An honest `'ambiguous'` label, by contrast, just discounts confidence; it never lies about which
plane it thinks it's measuring in. This is the same "never a silent wrong number" principle the
issue asks each heuristic to follow, applied one layer up, to the view label those heuristics
depend on.

### Vertical oscillation is view-tolerant; trunk lean and overstriding are hard-gated to side view

These aren't the same kind of "view sensitivity", and the code treats them differently on
purpose:

- **Vertical oscillation** measures a real-world quantity (how far the pelvis moves up/down) that
  projects onto image-y *similarly* regardless of which way the runner faces the camera, as long
  as the camera itself is level (an explicit, out-of-scope assumption — no roll correction here).
  Front view isn't measuring something different, it's measuring the same thing slightly more
  noisily (more visible pelvic-drop/rotation artifacts face-on). That's a `'tolerated'` view fit
  with a `0.85` confidence multiplier — a discount, not a lockout, and the `0.85` itself is a
  documented judgment call, not a measured effect.
- **Trunk lean** and **overstriding** both depend on a **sagittal-plane** (fore-aft) quantity —
  how far the shoulders sit ahead/behind the hips, how far the foot lands ahead of the hip at
  strike. That fore-aft axis is exactly the one a front-facing camera cannot see; it's foreshortened
  to near-zero in the image. What a front-view camera *does* see instead — mediolateral shoulder
  sway from arm-swing rotation, mediolateral foot placement width — is a **different physical
  quantity** that happens to occupy the same image axis. Reporting it as trunk lean or overstride
  wouldn't just be noisier, it would be measuring the wrong thing and calling it the right name.
  That's why both get `'unsuitable'` (front/ambiguous multipliers `0.1`/`0.2`) rather than a
  softer discount like vertical oscillation's.
- Per the issue's explicit "not a silent wrong number, not a hard crash" requirement, `'unsuitable'`
  still means **compute and return the value** — never `null` just because the view is wrong —
  with confidence capped low and a caveat stating plainly that the view is unsuitable. Whether the
  results view (ticket #8) chooses to visually hide a low-confidence number is a presentation
  decision for that ticket, not a computation decision for this one.

### The confidence formula is a heuristic product of independent penalties, not a statistic

`computeMetricConfidence` multiplies five `[0, 1]` factors: view-fit multiplier, frame coverage,
an interpolation penalty scaled by how much of the input was interpolated vs. directly detected,
a sample-size adequacy factor capped at 1, and (for trunk lean/overstriding only) a travel-direction-known
factor. This is explicitly **not** a calibrated probability or a statistical confidence interval —
it's a display heuristic for "how many independent reasons are there to distrust this number,"
where several moderate concerns compound into a low score faster than any one of them would alone.
That's a deliberate, conservative design choice: a metric that's borderline on view-fit *and*
has middling coverage *and* is half-interpolated should read as clearly low-confidence, not as
"only mildly discounted three times."

### Footstrike-via-ankle-extremum is an explicit, bounded approximation

There is no foot/toe keypoint and no ground-plane calibration anywhere in this pipeline (the
12-keypoint set from #3 stops at the ankle). Overstriding needs to know *when* the foot strikes
the ground; the best available proxy is "the ankle's lowest point on screen, i.e. its largest
image-y value" — a local maximum of ankle-y over time, found via the same `findLocalExtrema`
machinery vertical oscillation uses, but with a higher prominence threshold
(`footstrikeMinProminenceRatio`, `0.05` vs. vertical oscillation's `0.03`) because ankle
tracking is noisier than hip/shoulder tracking, and a minimum time spacing
(`footstrikeMinIntervalSeconds`, `0.25`s) so a couple of noisy frames around one real strike
can't be double-counted as two.

This is a real, bounded source of error: ankle-lowest-on-screen is a proxy for ground contact,
not a calibrated measurement of it, and can be off by a frame or two around the true strike
instant, or occasionally miss a strike if the ankle's vertical excursion is unusually small in a
particular clip. It is explicitly *not* attempting to detect stance-phase duration, toe-off, or
any other gait event — just "approximately when and where did this foot get lowest." Flagged
here and in the code as a known limitation, not silently assumed to be exact.

### Keypoint resolution: tolerant midpoints vs. strict bilateral pairs

`resolveMidpoint` (used for hip-mid/shoulder-mid, the center-of-mass proxies every heuristic here
is built on) falls back to whichever single side is resolvable when the other is briefly
occluded, rather than discarding the whole frame — losing a whole frame of center-of-mass
tracking because one side dropped out for an instant would waste data that's still a reasonable
approximation. The single-side fallback is always flagged as if it were interpolated (regardless
of that point's own status), because standing in one side for the true bilateral average is
itself an approximation of the same "trust this a little less" character.

`resolveBilateralPair` (used only by view detection's BSR signal) is strict: both sides must be
independently resolvable, or the whole result is `null`. This is not the same tolerance policy
by oversight — a "spread" computed from a single stand-in point would be meaningless, not merely
approximate, since the entire signal *is* the left/right separation.

### `View = 'front'` means front-or-back

No face keypoints exist anywhere in this pipeline (a scope decision from #3, carried forward
here). A camera looking at the runner's chest and one looking at their back are geometrically
indistinguishable from the 12-keypoint limb skeleton alone. This is explicitly fine: nothing
downstream needs the distinction. Both orientations equally hide the sagittal-plane signal trunk
lean and overstriding need, and vertical oscillation doesn't care which way the runner faces at
all.

## Risks / Trade-offs

- **Every threshold/constant introduced in this change** (`sideViewMaxBilateralSpreadRatio =
  0.30`, `frontViewMinBilateralSpreadRatio = 0.55`, `sideViewMinSagittalExcursionRatio = 0.8`,
  `frontViewMaxSagittalExcursionRatio = 0.4`, `minViewDetectionFrameCoverage = 0.4`,
  `verticalOscillationMinProminenceRatio = 0.03`, `verticalOscillationMinCycles = 4`,
  `footstrikeMinProminenceRatio = 0.05`, `footstrikeMinIntervalSeconds = 0.25`,
  `interpolationConfidencePenalty = 0.5`, the view-fit multipliers `0.85`/`0.1`/`0.2`/`0.6`) is a
  reasoned default, not one derived from or validated against real running footage. All are
  exposed on `HeuristicsConfig` (or as named local constants where they're metric-specific
  judgment calls not shared across metrics — see `trunkLean.ts`'s `MIN_TRUNK_LEAN_SAMPLE_SIZE` and
  `overstriding.ts`'s `MIN_OVERSTRIDE_SAMPLE_SIZE`) specifically so they're cheap to tune once real
  footage is available, without touching the algorithms themselves. This mirrors the same
  trade-off `pose-robustness` made for `minKeypointConfidence`/`maxGapSeconds`.
- **The confidence formula's multiplicative-penalty design** means several *moderately* concerning
  factors compound faster than the same concerns would if combined additively or by taking a
  minimum. This is intentional (see Decisions above) but means confidence can end up surprisingly
  low from several small issues rather than one large one — worth revisiting if real usage shows
  it reads as overly pessimistic.
- **Footstrike-via-ankle-extremum** (see Decisions above) is a bounded but real approximation;
  a genuinely fast or unusual gait could produce a vertical ankle excursion too small to clear
  `footstrikeMinProminenceRatio`, silently under-detecting strikes rather than mis-detecting them
  — reflected honestly in a low `sampleSize` and correspondingly discounted confidence, not a
  crash or a fabricated value.
- **No roll correction.** A camera that isn't level will bias vertical oscillation (bounce reads
  as smaller/larger than real depending on tilt direction) and could distort trunk lean's angle.
  Explicitly out of scope; flagged for whoever eventually handles camera-quality preconditions
  (possibly an extension of the existing video-quality-gate change).
- **Linear approximations throughout** (the confidence formula, the footstrike proxy, the
  rigid-torso trunk-lean model) trade precision for tractability and reviewability, consistent
  with how `pose-robustness` chose linear interpolation over a more sophisticated motion model for
  the same reason.

## Migration / Rollout

Purely additive — no existing files change, no new runtime dependencies. `computeFormHeuristics`
is the single entry point ticket #8 needs; everything else in `src/heuristics/**` is either an
internal primitive or independently testable/importable for finer-grained use if #8 needs it.
