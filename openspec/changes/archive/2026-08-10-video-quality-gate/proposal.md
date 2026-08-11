## Why

A loaded video (#4) can be technically playable but analytically worthless: too low-resolution
for keypoints to land meaningfully, too low a frame rate to capture stride cadence, or too dark/
occluded for the pose detector (#3) to find the runner reliably. Running the full analysis
pipeline against footage like that silently produces misleading metrics — the user has no signal
that the *input*, not their form, is the problem. This change adds a pre-analysis gate: a quick,
cheap assessment of the loaded clip that warns the user with specifics (which check failed) and
lets them proceed anyway or pick a different clip, rather than either a silent bad result or a
hard block.

## What Changes

- Add `src/quality/types.ts`: `QualityCheckId`, `QualityCheckStatus` (`pass`/`fail`/`skipped`/
  `error`), `QualityCheckResult`, `VideoQualityAssessment`.
- Add `src/quality/assessVideoQuality.ts`: three independent, heterogeneous checks —
  `checkResolution` (always evaluated, `metadata.width`/`height`), `checkFrameRate` (skipped when
  `metadata.frameRate` is `null`, which is always true for uploads per #4 — only webcam recordings
  populate it), and `checkConfidence` (a short sample-frame pass through the injected `PoseDetector`
  from #3, seeking a handful of timestamps spread across the middle of the clip and averaging the
  fraction of visible keypoints). Composes them into one `VideoQualityAssessment` with fail-open
  semantics: `overall` is `'warn'` iff at least one check is exactly `'fail'` — a `'skipped'` or
  `'error'` check never contributes.
- Add `src/quality/useVideoQualityGate.ts`: runs the assessment once a `VideoSource` reaches
  `'ready'`, lazily creates and caches a MoveNet detector for the hook's lifetime, discards results
  from a superseded clip (monotonic run id, no cancellation API on `PoseDetector`), and exposes a
  `proceedAnyway()` dismissal that resets per newly-loaded clip.
- Add `src/quality/QualityWarningBanner.tsx`: renders the failed checks' messages and a "Proceed
  anyway" button; renders nothing when passing, dismissed, or not yet assessed.
- Wire `App.tsx`: call `useVideoQualityGate(videoSource)` and render `QualityWarningBanner` once
  `videoSource.status === 'ready'` — the minimal integration point needed to observe the feature,
  same precedent as prior tickets (#2/#3/#4) each adding a small App.tsx touch beyond their
  literal file list.
- Add a fake-seekable-video test helper (`src/test/setup.ts` or `src/test/videoTestUtils.ts`,
  matching whichever reads cleaner) so `assessVideoQuality`/`useVideoQualityGate` tests can drive
  `currentTime` assignment to synchronously fire `seeked`, mirroring the `Object.defineProperty`/
  manual-`dispatchEvent` idiom already used in `src/video/useVideoSource.test.ts`.

## Capabilities

### New Capabilities
- `video-quality-gate`: whole-clip, pre-analysis quality assessment (resolution/frame-rate/
  detection-confidence) with a dismissible, per-loaded-clip warning UI and an explicit "proceed
  anyway" override. Distinct from the per-frame gap-handling in the robustness ticket (#5), which
  runs *during* analysis on individually low-confidence frames — this gate runs once, *before* the
  user commits to full analysis, on the whole clip.

### Modified Capabilities
- `video-input`, `pose-detection`: no behavior changes; this change is a new consumer of both
  existing capabilities' public surface (`VideoSource`, `PoseDetector`/`createDetector`), not a
  modification to either.

## Impact

- New directory `src/quality/` (types, assessment function, hook, banner component, tests). Only
  existing file touched is `src/App.tsx`, which gains a `useVideoQualityGate()` call and renders
  `QualityWarningBanner`.
- No new runtime dependencies — reuses `createDetector`/`PoseDetector` from #3 and `VideoSource`/
  `VideoMetadata` from #4 as-is.
- Does not implement the per-frame robustness/gap-handling layer (#5, parallel ticket) or any
  scoring heuristics — this gate only decides whether to warn before analysis starts.
