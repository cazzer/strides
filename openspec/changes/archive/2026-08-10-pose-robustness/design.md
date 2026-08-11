## Context

Issue #5 (parent: #1, blocked by #3) asks for a robustness layer that wraps the raw per-frame
pose stream from #3 so that missing or low-confidence keypoints don't crash or corrupt the
downstream heuristics engine (a later ticket) or results view. `src/pose/types.ts` already
defines `PoseFrame` as a fixed-length-12, fixed-order `Keypoint[]` plus a `timestamp`
(`video.currentTime`, not wall-clock — see the archived `pose-detection` design.md), and
`src/pose/detector.ts`'s `PoseDetector.estimatePose(video)` resolves to `PoseFrame | null`,
`null` meaning "no person detected this poll." This change consumes that shape and must decide
what to do with gaps in it without knowing anything about the eventual polling loop (#8) that
will produce the real input sequence.

## Goals / Non-Goals

**Goals:**
- Define a per-keypoint confidence threshold below which a point is treated as "missing" rather
  than trusted, and document it.
- Gap-fill missing/low-confidence keypoints across a bounded window via linear interpolation,
  with the bound and strategy documented including its limits.
- Explicitly flag keypoints/frames that remain unrecoverable after interpolation, rather than
  silently defaulting to `(0, 0)` or dropping them.
- Never throw on a fully-missing frame (`PoseFrame | null` with `null`) — degrade gracefully.
- Mark, per keypoint, whether it was directly detected, interpolated, or unrecoverable, so
  downstream consumers can factor confidence into their own logic.
- Preserve one output frame per input sample, always — no frame is ever dropped.

**Non-Goals:**
- Heuristics or quality-gate logic (stride detection, form scoring, whole-video pre-checks) —
  this layer only reshapes the stream; it doesn't judge it.
- A live polling loop against a real `<video>`/`PoseDetector` — that's #8's job. This ticket is
  tested entirely against hand-built `PoseSample[]` fixtures.
- A streaming/incremental API — see the batch-vs-streaming decision below.
- Empirically validating the default threshold/window constants against real running footage —
  flagged as needing that validation later, explicitly out of scope for this ticket.

## Decisions

**Input type is `PoseSample = { timestamp: number, frame: PoseFrame | null }`, not the ticket's
literal `PoseFrame | null`.** The ticket's prose describes the input as "a sequence of
`PoseFrame | null`." Taken literally, that's insufficient: a `null` entry (detector found nobody)
carries no timestamp of its own, but the interpolation algorithm needs a timestamp for *every*
sample — including missing ones — to compute `gapSeconds` and the interpolation fraction `t`
across a run of missing frames. There are two ways to get that timestamp for a `null` sample:
fabricate/interpolate it from neighboring sample indices (assume uniform frame spacing), or have
the caller supply the real one. Fabricating it is strictly worse: real video frame timing is not
guaranteed uniform (dropped frames, variable poll cadence), so an assumed-uniform timestamp would
silently corrupt the one thing this module treats as ground truth. The caller — a future polling
loop reading `video.currentTime` on every poll, per #8 — already has the real timestamp in hand
at the moment it calls `estimatePose`, detection failure or not, so asking it to pass
`{ timestamp, frame }` instead of just `frame` costs it nothing. This is a deliberate, documented
deviation from the ticket's literal wording, not a silent reinterpretation.

**Window bound is time-based (`maxGapSeconds`), not count-based (max N consecutive missing
frames).** A runner's polling cadence is not guaranteed to be fixed (variable frame rate, dropped
frames, a slow device). A count-based bound (e.g. "interpolate across at most 5 missing frames")
would mean the same nominal bound corresponds to a wildly different real time span depending on
polling rate — too permissive at a slow cadence, too strict at a fast one. Interpolation
accuracy degrades with *how far a limb could plausibly have moved*, which is a function of real
elapsed time, not frame count. `maxGapSeconds` (default `0.5`) measures the wall-clock/video-time
distance between the two real anchor samples bracketing a gap and rejects interpolation if it
exceeds that bound, regardless of how many missing samples fall in between.

**Batch (`applyRobustness(samples[])`), not streaming.** Filling a gap requires knowing what
comes *after* it — the algorithm needs the next real detection to interpolate towards, which by
definition isn't available yet in a live stream at the moment the gap starts. Even a "streaming"
API would need to buffer internally until it sees the closing anchor (or gives up past
`maxGapSeconds`), so it wouldn't actually avoid the batch nature of the problem, only hide it
behind a misleading incremental-looking interface. There's also no real call site yet to validate
a streaming design against — the actual polling loop is #8's job, not this ticket's — so
designing for it now would be speculative. A bounded-lag streaming wrapper (buffer up to
`maxGapSeconds` of samples, then flush) can be layered on top of this batch function later,
once #8 exists to prove out what shape it actually needs, without changing this module's
algorithm or output type.

**Unrecoverable keypoints use `x: null, y: null` sentinels, never `(0, 0)`.** `(0, 0)` is a
plausible real coordinate (top-left of frame) — using it as a "no data" sentinel would be
indistinguishable from a real low-corner detection and would silently corrupt any downstream
metric that doesn't specifically check `status`. `null` cannot be mistaken for a coordinate; the
type system forces every consumer to at least consider the `status !== 'unrecoverable'` case
before reading `x`/`y` as numbers. `score` is still set to `0` (not `null`) for unrecoverable
points purely for callers that want a single numeric confidence signal without a null-check —
but `RobustKeypoint.score`'s doc comment warns it's informational only and gating logic must key
off `status`, not `score`, since an interpolated point's lerped score can read as confident while
still being a linear guess.

**The 12 keypoints are treated as 12 independent 1-D time series, unified with the "no person in
frame" case rather than special-cased.** A `PoseFrame`'s `null` case (nobody detected this poll)
and a single low-confidence keypoint within an otherwise-good frame are, from the interpolation
algorithm's point of view, the same kind of gap — just at different scope. Modeling `frame ===
null` as "all 12 channels are simultaneously missing at this timestamp" means `classifyFrame`
handles it as the same per-point rule applied 12 times, and `interpolate.ts` never needs a
separate "was this a null frame" branch — a run of missing samples in one channel is gap-filled
identically whether it came from 12 simultaneous per-keypoint low scores or one `null` frame.
This is what keeps the algorithm to one code path instead of two that could drift apart.

**Threshold/window defaults: `minKeypointConfidence = 0.3`, `maxGapSeconds = 0.5`, both
overridable via `RobustnessConfig`.** `0.3` is the commonly-cited MoveNet/COCO-style
"don't trust this point" cutoff used across community references for these model families —
a reasonable starting default, not derived from this project's own footage. `0.5` seconds is a
conservative cap chosen on the reasoning that a runner's limbs move too fast for linear
interpolation to stay visually/metrically plausible much beyond half a second — a knee or ankle
can travel a large fraction of a stride cycle in that time, so interpolating further would be
guessing, not recovering. Both are exported as named constants and as fields on
`RobustnessConfig` (not hardcoded inline) specifically so they can be tuned later against real
running footage without changing this module's code — that empirical validation is explicitly
not this ticket's job.

**Public API is a single pure function, `applyRobustness(samples, config?)`.** No class, no
internal mutable state — matches the "pure data-processing layer" framing from the ticket and
keeps the module trivially unit-testable with plain arrays in, arrays out.

## Risks / Trade-offs

- Linear interpolation is a simple model of limb motion; a fast direction change mid-gap (e.g. a
  foot-strike) would be interpolated as a straight line through where the limb actually curved.
  `maxGapSeconds = 0.5` bounds the damage but doesn't eliminate it — flagged for future tuning
  against real footage, not solved here.
- `minKeypointConfidence = 0.3` and `maxGapSeconds = 0.5` are both unvalidated defaults borrowed
  from general community practice / conservative reasoning, not measured against this project's
  actual model output or running footage. Both are cheaply overridable via `RobustnessConfig`
  once that validation happens.
- Treating `score` as still populated (lerped, not null) for interpolated points is a minor
  footgun for any future consumer that reads `score` without checking `status` first — mitigated
  by the doc comment on `RobustKeypoint.score`, not by the type system, since a numeric score is
  still useful for consumers that only want "roughly how confident" without branching.
