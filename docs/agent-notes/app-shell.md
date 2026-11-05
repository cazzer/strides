# App shell: clips in the header strip

> Moved verbatim from CLAUDE.md on 2026-10-27 to keep the auto-loaded file under the size limit. Index: CLAUDE.md "Notes index". Cross-references like "above"/"below" may now point into a sibling file in this directory.

## The app shell — clips live in the header strip (2026-08-18, epic `strides-kyu`)

**Clips are no longer a page column.** The two-column `lg:grid` layout is gone: clips left the page
body entirely and now render as a **strip in the application header** (`role="banner"`), one entry
per clip (`ClipStripEntry.tsx`, `clipStripStatus.ts`), while the results own the page as its main
content. Spec: `openspec/specs/multi-clip-analysis/spec.md` and `openspec/specs/results-view/spec.md`;
archived change `openspec/changes/archive/2026-08-17-navbar-clip-shell/`.

What this changes for anything driving or reading the app:

- **Clip `<video>` elements stay mounted and playable while hidden.** Sampling reads frames off a
  live, playing element, so hiding is visual only — never conditionally rendered, never behind a
  mount gate. **The strip thumbnail IS the live element while that clip's analysis is in flight**,
  reverting to a static poster (`posterFrame.ts`, `useClipPoster.ts`) once it reaches a terminal
  phase. That is not cosmetic: see the concealment/throughput finding in the harness section above
  for why the analysing clip must stay genuinely on screen.
- **Playback loops only while a clip is presented.** Reaching `phase: 'ready'` no longer starts a
  loop on its own — an unpresented clip stays paused. A clip is presented by opening its preview
  (`ClipPreviewDialog.tsx`), which reveals that clip's own element with its skeleton overlay.
- **Per-clip progress is rendered from each clip's own analysis state**, not from the session
  aggregate — verified live at 36 of 37 snapshots showing genuinely differing per-clip conditions.
  Session status stays a single announced line.
- **The in-body "Add another clip" block is gone**, replaced by an add-a-clip action in the header
  (`AddClipAction.tsx`), an in-flow disclosure that grows the header downward rather than an
  overlay. Asserted structurally: once a clip is loaded, `main` contains no `input[type=file]` and
  no text matching `/add (another|a) clip/i`.
- **Recording and demo clips are now reachable for clips 2..N** — they were not. Every `addClip`
  records a `pendingLoad`, so the new slot's own picker (gated on `status === 'empty'`) never
  rendered, leaving upload as the only route past clip 1. Both verified live: recording a second
  clip reaches `'Clip 2 of 2: Analyzed'`, and the demo button reaches
  `'Combined from clip 2 of 2.'` (measured when the demo was one clip per button; the demo action
  now adds three clips at once, so the same path from one loaded clip lands on clip 4 of 4).
- **`ClipPicker.tsx` owns the zero-clip state** as a full-page picker, and holds the demo action
  and its clip list (`DEMO_CLIP_URLS`). Since `bundle-a-three-clip-demo` that is one button
  loading three clips, not a button per clip.
- **The `86px` / `150px` header constants are gone.** Three of the four hardcoded offsets left with
  the restructure; the surviving `max-h-[calc(100vh-150px)]` was a *false* dependency and was
  removed rather than re-derived. Nothing in `src/` reads a hardcoded header height now.

**Open, not decided — `strides-49e`.** `MetricsPanel.tsx` still renders the card grid as
`<div className="@container grid gap-4 @lg:grid-cols-2 @3xl:grid-cols-3">`. An element with
`container-type: inline-size` establishes a query container for its *descendants* and cannot query
itself, so those two utilities have never matched and the card grid has always been **one column at
every viewport width** (measured: 1104 px wide at a 1440 viewport, still one column). Pre-existing,
not a regression from this epic. The fix is one wrapper div, but it is a visible layout change with
a product decision inside it — today's full-width cards are why inline evidence sits beside the
description on a desktop, which is the behaviour the evidence epic was asked for. **Left open
deliberately; do not "fix" it as a typo.**


## Poster seek on a phone: count the timeout only while the main thread runs (2026-11-05, `strides-p1qt.19`)

The poster is derived on a detached `<video>` **during** sampling, and on the Galaxy S21 the first
MoveNet inference blocks the main thread for 4.7–7.2 s. With `seekTo`'s 2 s wall-clock timer, the
poster failed on 9 of 9 clips at 01c4ef04 and 5 of 5 second-runner clips on the integration branch.
It also failed on the 4K `park-side-landscape.mp4` in the 3-clip demo. A dev-only probe showed the
seek had **succeeded** during the stall (`seeking` false, `readyState` 4). The expired timer's task
simply ran before the `seeked` task, which followed 80–280 ms later.

The poster now uses `seekToThroughStalls` (`videoElement.ts`): the budget is sampled every 100 ms
and each sample credits at most 200 ms, so a stalled page doesn't use it up. A 30 s wall-clock
ceiling still ends the wait. **`seekTo` is unchanged, and evidence extraction still uses it**: its
seeks run after `'ready'`, and the desktop 9-clip `--evidence --scale-pass --outline-pass` gate was
identical apart from wall-clock rows.

Results on the phone:
- Posters derive on 5/5 second-runner clips and 3/3 demo clips (before: 0/5 and 2/3).
- Time to "Analysis complete" did not move in an interleaved ABBA run (IMG_9345 after 17.8/17.6 s
  vs before 17.0/23.5 s; IMG_9348 after 16.1/16.2 s vs before 17.1/24.9 s).
- ⚠️ A first, **block-ordered** before/after pair showed the after arm 1.4–6.4 s slower. That was
  thermal state: those trials' MoveNet detect p50 rose to 68–72 ms, and the same inflation shows up
  in the before arm once the order is interleaved. Don't compare phone timings across
  block-ordered arms.
