## Context

Issue #6 (parent: #1, partial) asks for a pre-analysis quality gate, blocked on #3 (pose-detection
abstraction) and #4 (video-input/`VideoSource`). It runs in parallel with #5 (robustness/
gap-handling), which is a *different* layer: #5 runs during full analysis, filtering/interpolating
individual low-confidence frames as they're processed; this gate runs once, before the user
commits to full analysis, deciding whether to warn about the *whole clip* at all.

`VideoMetadata.frameRate` (from #4) is `null` for every file upload — no browser API exposes a
file's frame rate without expensive frame-by-frame sampling, which #4 explicitly left out of
scope. Only webcam recordings populate it, from `MediaStreamTrack.getSettings().frameRate`. That
makes the frame-rate check best-effort/skippable by construction, not a bug to work around — and
makes the confidence sample (actually running the pose detector against a few sampled frames) the
real, always-available quality signal for the common (upload) case.

## Goals / Non-Goals

**Goals:**
- Three independent, heterogeneous checks (resolution, frame rate, confidence sample) — not three
  interchangeable booleans. Each has its own applicability rule.
- Fail-open: a check that can't run contributes nothing to the overall verdict. Only an actual
  `'fail'` should ever make the gate warn.
- Cheap and fast — this runs before the user has committed to full analysis (per the ticket's
  notes), so a small, fixed sample count and no full-pipeline run.
- Dependency-injected `PoseDetector` in `assessVideoQuality`, so the core logic is pure/testable
  against a fake detector, mirroring `src/pose/detector.test.ts`'s pattern.
- Per-loaded-clip dismissal ("per-session" = "for as long as this clip stays loaded"), not
  persisted anywhere.

**Non-Goals:**
- Per-frame gap-handling/robustness during full analysis — that's #5, a separate, parallel
  ticket.
- Any heuristics beyond the three named checks (resolution/frameRate/confidence).
- A cancel/abort API on `PoseDetector` — out of scope for this change; stale in-flight results are
  discarded by the *consumer* (the hook), not by cancelling the detector call itself.
- localStorage or any persistence of the dismissal across reloads/clips.

## Decisions

**Fail-open semantics: `'skipped'`/`'error'` never contribute to `overall`.** `overall` is
`'warn'` iff at least one check's `status` is exactly `'fail'`. A check that didn't run
(`'skipped'` — e.g. frame rate unknown for an upload) or that errored while trying to run
(`'error'` — e.g. no detector available) carries no opinion either way. Rationale: the two
non-decisive statuses exist so the UI/tests can distinguish *why* a check didn't produce a
verdict, without that ambiguity ever silently blocking or silently degrading the user's ability to
proceed. If the gate warned on every unknown, uploads (frame rate always unknown) would nag by
default; if it warned on detector-unavailable, a WebGL init failure would block analysis instead
of degrading gracefully.

**`assessVideoQuality` takes `detector: PoseDetector | null` as a parameter — it does not call
`createDetector` itself.** Rationale: keeps the assessment function pure and testable with a fake
`PoseDetector` (no TF.js/WebGL in its test), and keeps "when/whether to create and cache a real
detector" a concern of the calling hook, which has the actual lifecycle (mount/unmount, clip
reload) to manage it against.

**Confidence sampling is mid-clip, not first-N-frames, and trims 10% off each end for clips long
enough to have a meaningful middle.** Rationale: the start of a clip is disproportionately likely
to be the runner walking into frame or the camera still settling (especially for
webcam-record-then-run workflows), which would bias the confidence sample low even for otherwise
good footage. `sampleTimestamps` spreads `count` samples evenly across the trimmed middle span
(`durationSec * 0.1` trimmed off each end when `durationSec > 3`, no trim for very short clips
where a 10% trim would leave almost nothing).

**Confidence sampling seeks the primary, already-mounted `<video>` element (`videoSource.videoRef
.current`) rather than a second off-screen element.** Rationale/trade-off, accepted deliberately:
this causes a visible playhead jump in the visible `<video controls>` while the assessment runs
(a few seeks across the clip, then a seek back to the original position). The alternative — a
second hidden `<video>` element decoding the same source purely for sampling — avoids the visible
jump but doubles decode/memory cost for every loaded clip and duplicates `src`/object-URL
lifecycle management that `useVideoSource` already owns for the primary element. Given the
assessment runs once, immediately after load, before the user has started interacting with
playback, the visible jump is judged an acceptable, documented trade-off rather than a defect to
engineer around.

**`seekTo` uses a timeout fallback (`SEEK_TIMEOUT_MS = 2000`), not just a `seeked` listener.**
Rationale: `seeked` firing is not guaranteed in every browser/element-state combination (e.g.
seeking to the element's current time, or a seek that's a no-op because the frame is already
decoded) — this needs to degrade gracefully (treat the frame as sampled at whatever
`currentTime` ends up being) rather than hang the assessment indefinitely on a `seeked` event that
never comes.

**Confidence check is per-sample resilient: one bad or errored sample degrades the running average
instead of aborting the whole check.** Rationale: a single failed `estimatePose` call (e.g. a
transient WebGL hiccup) shouldn't discard every other sample's signal — it's treated as a
0-visible-fraction sample and averaged in, same as a genuine "no person detected" (`null`) result.

**`useVideoQualityGate` lazily creates one detector and caches it in a ref for the hook's
lifetime, reused across re-loaded clips; disposed only on unmount.** Rationale: `createDetector`
pays a real model-load cost (WebGL init + weight fetch) — paying it once per hook lifetime instead
of once per loaded clip keeps repeat "load a different clip" interactions fast. If detector
creation itself fails, the hook proceeds with `detector: null`, and `checkConfidence` reports
`'error'` (fail-open, per above) rather than blocking the rest of the assessment.

**Stale-result discard via a monotonic `runId` ref, not a cancellation API.** Rationale:
`PoseDetector` intentionally has no abort/cancel hook (see #3's design — retry/cancellation policy
is left to callers). When a user loads a second clip before the first clip's assessment resolves,
the hook increments a ref before starting each assessment and compares it after the `await`
resolves; a mismatch means the result is stale and is discarded rather than applied to state. The
in-flight `estimatePose`/`seekTo` calls for the superseded run still complete in the background
(there's no way to stop them) — they just never reach the UI.

**Dismissal (`proceedAnyway()`) is the only dismissal action, and it means "proceed."** Rationale:
the ticket doesn't distinguish "just hide the banner" from "proceed with analysis anyway" — for
this gate, seeing the warning and choosing to continue *is* the proceed decision, so a separate
"dismiss without proceeding" action would be a distinction without a difference here. `dismissed`
resets to `false` whenever a new clip reaches `'ready'`, and is never persisted (no localStorage)
— "per-session" is scoped to "this clip stays loaded," not "this browser session."

## Risks / Trade-offs

- The visible playhead jump during confidence sampling (see decision above) is a real, if minor,
  UX rough edge — documented, not fixed, in this change.
- Reusing one cached detector across clips means a WebGL context/model-load failure on the first
  clip is "sticky" for the hook's lifetime (every subsequent clip's confidence check will also
  report `'error'`) until the component unmounts. Accepted: recreating the detector per clip would
  reintroduce the load-cost problem this caching is meant to avoid, and a WebGL init failure is
  usually an environment-level condition unlikely to resolve mid-session anyway.
- `seekTo`'s timeout fallback means a sample can, in the worst case (every seek timing out),
  effectively be evaluated at whatever `currentTime` the seek left the element at rather than the
  intended timestamp — accepted as a graceful-degradation trade-off over hanging the assessment.
