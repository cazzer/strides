## Why

Clips currently own half the page. `MultiClipVideoSession` renders every clip as a full-height
`ClipSlot` stacked in a sticky left column (`MultiClipVideoSession.tsx:179-201`) with the results in
the right column, so a two-clip session pushes the metrics — the thing the reader came for — into a
half-width, separately-scrolling box, and a three-clip session pushes them further. There is no clip
list, tab bar, selector, thumbnail, or label anywhere: `ClipSession` is `{ clipId, videoSource,
analysis }` (`multiClipAnalysis.ts:18-22`) and clips are positional only.

Two concrete consequences, both of which this change fixes:

1. **Progress is global, not per clip.** `ResultsView.tsx:97-123` renders one line derived from
   `computeAggregateAnalysisState`'s mean progress. Per-clip `VideoAnalysisState` already carries its
   own `phase` and `progress` (`types.ts:39-59`, one per clip via `ClipSlot.tsx:51`, already
   collected as `clipStates` at `MultiClipVideoSession.tsx:76`) — none of it is rendered anywhere
   except the one-line "Queued — waiting for another clip…" hint at `ClipSlot.tsx:106-108`. Because
   only one clip holds the shared detector at a time, an averaged bar is exactly the wrong summary:
   it hides which clip is actually working.
2. **You cannot add a clip by recording, or add a demo clip, after the first one.** The in-body "Add
   another clip" block (`MultiClipVideoSession.tsx:194-201`) is a bare `<FileUpload>`. Every
   `addClip` immediately hands the new slot a `pendingLoad`, so that slot's own `VideoInputPanel`
   picker (which only renders while `status === 'empty'`) never appears. Upload is the only reachable
   path for clips 2..N. That is a gap, not a design.

Moving clips into the header — a strip of thumbnails beside the wordmark, a preview modal behind
each one, one add-a-clip action offering both input paths — gives the results the full page, makes
each clip's own progress visible on the clip it belongs to, and closes the record/demo gap.

## What Changes

- **Clips leave the page body.** Their video elements stay mounted as hidden hosts; results become
  the page's main content. Zero clips keeps a full-page picker.
- **A clip strip in the header**, one entry per clip, poster-backed, in fusion order, scrolling
  rather than reflowing the header when crowded.
- **Per-clip progress on each entry**, read from that clip's own `VideoAnalysisState` — sampling,
  processing, ready, error, and the derived *queued* condition, distinguished by more than colour and
  exposed to assistive technology as text. **No new state machine.**
- **A clip preview modal** revealing the clip's already-mounted element with `SkeletonOverlay` over
  it — focus-trapped, Escape-dismissible, focus restored to the originating entry.
- **A header add-a-clip action** offering record *and* upload (and the demo clips), replacing the
  upload-only in-body block. One file-picker interaction still creates one clip per file.
- **A poster concept on the video source** — the clip model has none today. Captured from an
  already-decoded frame without seeking, held in memory only, released on removal/reset.
- **The header-height constant goes away.** `lg:top-[86px]`, `lg:max-h-[calc(100vh-86px)]`
  (`MultiClipVideoSession.tsx:182,203`) and `max-h-[calc(100vh-150px)]`
  (`VideoInputPanel.tsx:132`) are hardcoded and derived from nothing; a header that grows a clip
  strip silently breaks all of them.

## The one decision this change had to make

`results-view`'s "Video loops with overlay once analysis is ready" (spec L174) requires a ready clip
to restart and loop continuously. With clips hidden, that means **every clip in the session decodes
and composites video nobody can see, forever**. The loop is scoped to the clip being presented; the
requirement is REMOVED and re-ADDED under a fresh name because its first scenario fully reverses.
Rationale, alternatives, and the guard that keeps in-flight analysis safe: design.md **D1**.

## The hard constraint this change is most likely to break

Sampling reads frames off a live, playing `<video>` element. **Clip video elements must stay mounted
and playable while analysing — hiding is visual only.** Neither `tsc` nor the unit suite can observe
a violation (jsdom has no media pipeline and no `requestVideoFrameCallback`), so this is written into
the spec as a behavioural guarantee with a live-verification gate, not left as an implementation
note. Mechanism ranking and the pre-registered gate: design.md **D2** and **D8**.

## What Does NOT Change

- The analysis pipeline: `sampleClip`, `runClipAnalysisPipeline`, robustness, person selection,
  heuristics, the background scale pass, fusion, and the per-metric source index are all untouched.
  No metric value moves.
- `SkeletonOverlay.tsx` — the modal shows the same live element it already draws over, so the
  component needs no change at all. Its animation loop is already `play`/`pause`-driven, so scoping
  the video loop to presentation stops the overlay's loop for free.
- The evidence gallery's planning and extraction, which already run against a **detached** element
  built from `sourceBlob` and never the clip's own element.
- The `role="status"` session line and its scale-pass narration (required by "The centimetre card
  reflects scale-pass progress"). Per-clip percentages move to the strip; the session-level line
  stays. See design.md **D3**.

## Impact

- Affected specs:
  - `results-view` — MODIFIED "Evidence frames are planned purely, then extracted from a detached
    video element" (one stale rationale clause and one now-counterfactual scenario precondition);
    REMOVED "Video loops with overlay once analysis is ready"; ADDED four requirements (mounted-and-
    playable hidden elements, presentation-scoped looping, the clip preview, session-status split).
  - `video-input` — ADDED the poster contract and the picker/add-a-clip-action requirement. "Unified
    video source contract" is deliberately **not** modified: the poster is added as its own
    requirement, exactly as `sourceBlob` was.
  - `multi-clip-analysis` — ADDED the clip strip, per-clip progress rendering, and the
    one-source-one-clip rule.
- Affected code (implemented by `strides-kyu.2`–`.9`, not by this ticket): `src/App.tsx`,
  `src/results/MultiClipVideoSession.tsx`, `src/results/ClipSlot.tsx`,
  `src/results/ResultsView.tsx`, `src/video/VideoInputPanel.tsx`, `src/video/useVideoSource.ts`,
  `src/video/types.ts`, plus new strip/preview/poster modules and their tests.
- `e2e/multiPersonAcquisition.spec.ts` drives selectors this moves — `getByRole('button', { name:
  'Upload' })`, `input[type=file]`, and the two progress-text waits. The text waits need rethinking,
  not just re-selecting, since progress moves onto per-clip entries.
- GitHub #23 "Make results layout sticky" is superseded — the two-column video/metrics layout it
  described stops existing. Closing it is the user's call.
