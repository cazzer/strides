## Context

See proposal.md for motivation — a real demo clip's diagnostics (this session's
`add-analysis-diagnostics-export`) showed near-zero confidence across every metric, traced to
the subject being out of frame for stretches at the start and end of the clip.

Relevant current state:
- `estimateBodyScale` (`bodyScale.ts`) computes `sampleCoverage: lengths.length / frames.length`
  — every metric that gates on `bodyScale === null` or copies this pattern for its own
  `frameCoverage` inherits this same raw-frame-count denominator.
- `findLocalExtrema` already treats a `null` in its input series as a hard run boundary — it
  never smooths or pairs a cycle across a gap. Every metric using it (verticalOscillation,
  overstriding via footstrikes, kneeFlexion, armSwingSymmetry) already has gap-tolerant *value*
  computation; only the *coverage/confidence* side is diluted by out-of-frame time.
- `useVideoAnalysis.ts`'s `start()` already computes `robustFrames` (via `applyRobustness`) and
  passes it straight to `computeFormHeuristics`; the same `robustFrames` reference is stored in
  `VideoAnalysisState` for the skeleton overlay, and fed to `computeAnalysisDiagnostics`.
- `cadence.ts` currently divides `detectFootstrikes(...).length` by
  `(frames[frames.length-1].timestamp - frames[0].timestamp) / 60` — total elapsed span, not a
  measure of actual running time.

## Goals / Non-Goals

**Goals:**
- `frameCoverage`/`sampleCoverage` reflect tracking quality during the time the subject was
  actually in frame, not diluted by dead time before/after.
- Cadence's *value* (not just confidence) stops being systematically underestimated by dead time
  anywhere in the clip.
- No change to the skeleton overlay's or diagnostics' view of the clip — both are debugging/
  visualization surfaces that should keep showing the full, honest picture.

**Non-Goals:**
- Detecting *why* a frame has no resolvable subject (out of frame vs. occlusion vs. genuine
  detection failure) — this change only cares about the aggregate effect (dead frames diluting
  coverage), not diagnosing the cause of each one. `analysisDiagnostics` already exists for that
  and is untouched.
- Changing `sampleClip.ts`, the robustness/interpolation layer, or any metric's *value*
  computation other than cadence's.
- A general "trim any long dead run anywhere, mid-clip included" — the presence window here is
  strictly first-trackable-frame to last-trackable-frame. A mid-clip dropout still counts as
  "inside" the window (and is already handled by `findLocalExtrema`'s existing gap-splitting for
  every metric's value, and by cadence's new median-interval computation) — trimming is only
  about the leading/trailing edges, where the subject genuinely isn't in the clip yet or anymore.

## Decisions

**Presence-window trim lives in a new `src/heuristics/presenceWindow.ts`, applied once in
`useVideoAnalysis.ts` — not inside `computeFormHeuristics` itself, and not by mutating
`state.robustFrames`.** `computeFormHeuristics(frames, config)` receives an already-trimmed
`frames` argument; a second, untrimmed reference stays in `VideoAnalysisState.robustFrames` for
the skeleton overlay and is what `computeAnalysisDiagnostics` continues to receive. Two call
sites, one function each, rather than teaching `computeFormHeuristics` to trim its own input
(which would silently change what its `frames` parameter means for every existing caller/test)
or teaching the overlay/diagnostics to un-trim (more complex, and diagnostics specifically
exists to show the *full*, undiluted picture — trimming it would hide the exact signal that
made this investigation possible).

**Presence is judged by the same shoulder-mid + hip-mid resolvability check `estimateBodyScale`
already uses, not a separate criterion.** Reusing `resolveMidpoint` for both shoulder and hip
keeps "trackable" meaning the same thing everywhere in this pipeline — a frame that wouldn't
contribute to `bodyScale` isn't counted as "present" either.

**A short consecutive-frame guard (`presenceMinConsecutiveFrames`, new `HeuristicsConfig`
constant) prevents one spurious detection from anchoring the window.** Without it, a single
false-positive pose detected in an otherwise-empty scene (unlikely but not impossible) would
widen the "trimmed" window right back out to include dead time — defeating the purpose. The
window's start is the first frame beginning a run of at least this many consecutive trackable
frames; its end is the last frame of the last such run.

**Cadence: median inter-footstrike-interval, not `strikeCount / elapsedDuration`.** Chosen over
"just trim cadence's own duration divisor to the presence window" because the presence-window
trim alone only fixes leading/trailing dead time — it doesn't help a mid-clip dropout (e.g. the
subject briefly occluded mid-run), which would still dilute a duration-based rate. The
median-interval computation is immune to dead time wherever it occurs, without needing to know
where. `sampleSize` stays as the footstrike count (matching `MIN_CADENCE_SAMPLE_SIZE`'s existing
"how many strikes" semantics and caveat text), even though the statistic itself is computed over
`sampleSize - 1` intervals.

## Risks / Trade-offs

- [The presence-window trim and cadence's median-interval fix overlap in effect for
  leading/trailing dead time specifically] → Not a conflict — cadence's fix subsumes what the
  trim would have done for cadence's own duration divisor anyway (cadence no longer has a
  duration divisor at all), and the trim's real, distinct value is fixing `frameCoverage` for
  the other four metrics. Both land in the same change since they're motivated by the same
  diagnostics finding, not because one depends on the other.
- [`presenceMinConsecutiveFrames`'s exact value is a judgment call, not derived from real
  footage, same category as this pipeline's other prominence/interval thresholds] → Cheaply
  tunable later if it turns out wrong; documented as such, consistent with this codebase's
  existing convention for this class of constant.
