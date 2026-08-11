## Context

See proposal.md for motivation. Relevant current state:

- `App.tsx` currently wires `useVideoQualityGate(videoSource, poseDetector.detector,
  poseDetector.status)` alongside `useVideoAnalysis`, both sharing the one `PoseDetector` from
  `usePoseDetector()`. `ResultsView`'s `qualityAssessing` prop exists only to disable "Analyze"
  while the gate is mid-flight (documented as a race-avoidance measure: both hooks fight over the
  same visible `<video>` element).
- `useVideoAnalysis.start()` already fails gracefully (`phase: 'error'`, `kind:
  'detector-unavailable'`) when `detector` is `null` — that's the existing fallback this design
  leans on for auto-start's "detector not ready yet" case, no new error path needed.
- `MetricsPanel.tsx` already computes, per metric card, an `isFlagged` condition (`value === null
  || confidence < LOW_CONFIDENCE_THRESHOLD || viewFit === 'unsuitable'`) and `METRIC_LABELS`. Both
  are currently private to that file.

## Goals / Non-Goals

**Goals:**
- Analysis starts the moment a clip is ready and a detector exists, with no user click required.
- Retire the pre-analysis quality gate cleanly — no dead code, no orphaned tests.
- A post-analysis banner uses exactly the same "is this metric trustworthy" logic the metrics
  panel already renders per-card, so the two can never disagree.

**Non-Goals:**
- Redesigning `MetricsPanel`'s own card layout or its confidence labels.
- Adding a way to dismiss the new banner — it's derived purely from `heuristics`, nothing to
  dismiss; it simply stops rendering once results are no longer flagged (a fresh clip resets
  `heuristics` to `null` before any new banner state could show).
- Changing `sampleClip`/robustness/heuristics computation itself.

## Decisions

**Auto-start lives in `useVideoAnalysis` as an effect gated on `videoSource.status === 'ready' &&
phase === 'idle' && detector !== null`, not in `App.tsx`.** `useVideoAnalysis` already owns the
`phase` state machine and the `start()` callback; adding the effect there keeps the auto-trigger
next to the logic it triggers, and keeps `App.tsx` a pure composition layer (it already delegates
lifecycle decisions like the loop-restart-on-ready effect from the previous change the same way).

**`start()` mutes the video before calling `play()` for sampling, regardless of trigger.** The
existing manual "Analyze" click satisfies browser autoplay policy by calling `play()` synchronously
within the click handler's call stack. Auto-start's effect-triggered call doesn't have that
synchronous gesture chain — the same risk the loop-restart effect already mutes to work around.
Rather than special-case muting only for the auto-start path, `start()` mutes unconditionally:
one code path, no behavior difference a user would notice (these clips carry no audio the app
uses), and it removes any dependence on how leniently a given browser treats a gesture token that
crossed a React effect boundary.

**Auto-start does not thread `detectorStatus` (loading vs. permanently unavailable) through —
it just waits for `detector !== null`.** The retired `useVideoQualityGate` needed to distinguish
"loading" from "failed" to avoid a spurious error flash; auto-start doesn't have that problem
because it simply *doesn't fire* while `detector` is `null`, for either reason, and re-fires
automatically once `detector` transitions to non-null (it's a dependency of the effect). If the
detector never loads, the user still has the manual "Analyze" button as a fallback, which then
surfaces the real `detector-unavailable` error — no separate loading-vs-failed distinction needed
on this path.

**`metricConfidence.ts` extracts `LOW_CONFIDENCE_THRESHOLD`, `METRIC_LABELS`, and a new
`isMetricFlagged(metric)` out of `MetricsPanel.tsx`.** Both `MetricsPanel` and the new
`LowConfidenceBanner` need the identical flagged-or-not condition and the identical metric
display names — duplicating the `0.4` threshold and the label map in two files would make it
possible for the banner and the per-card flag to silently drift apart. `MetricsPanel.tsx` is
updated to import from the new module instead of defining these locally; its own rendering is
otherwise unchanged.

**`LowConfidenceBanner` is a pure presentational component — a plain function of
`FormHeuristicsResult`, no hook, no internal state.** Unlike the retired `QualityWarningBanner`
(which tracked `status`/`assessment`/`dismissed` across an async assessment lifecycle), this
banner's entire "should I render, and what do I say" answer is already fully determined by the
`heuristics` object `ResultsView` already has in hand once `phase === 'ready'` — there's no
lifecycle to model and nothing to dismiss.

**`ResultsView` renders the banner directly above `MetricsPanel`, inside the same `phase ===
'ready' && heuristics` block it already gates `MetricsPanel` on.** No new prop threading through
`App.tsx` beyond what's already there.

**Demo video reverts to `8533913` (the UHD CDN URL already resolved for it earlier this session)
at full length — no trim.** Matches the user's explicit "flip back to using this video" request;
the trim mechanism explored for a different clip was already rejected (would've needed a new
dependency) and isn't being reintroduced here.

## Risks / Trade-offs

- [Removing the pre-analysis quality gate means a genuinely unusable clip (e.g. far too low
  resolution) no longer gets flagged *before* the user waits through a full analysis pass] →
  Accepted per the user's explicit direction to retire the gate; the post-analysis banner still
  tells them the results are unreliable, just after the wait rather than before it.
- [Auto-start racing a slow-loading detector on first paint] → Already handled: the effect simply
  doesn't fire until `detector` is non-null, and the manual "Analyze" button covers the case where
  it never loads.
