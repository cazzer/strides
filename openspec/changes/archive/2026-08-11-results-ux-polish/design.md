## Context

See proposal.md for motivation. Relevant current state:

- `QualityWarningBanner` (`src/quality/QualityWarningBanner.tsx`) renders an inline `role="alert"`
  `<div>`; `App.tsx` places it between `VideoInputPanel` and `ResultsView` in normal document
  flow.
- `App.tsx`'s `<main>` stacks `VideoInputPanel` and `ResultsView` in one vertical column
  (`space-y-8`).
- `sampleClip.ts` plays the loaded clip once, relying on the video's native `ended` event to
  resolve its promise (`handleEnded` → `finish()`). It does not set `loop`. By the time
  `useVideoAnalysis` sets `phase: 'ready'`, the video has already fired `ended` and sits paused at
  its last frame.
- `SkeletonOverlay` redraws on `play`/`pause`/`ended`/`seeked`/`timeupdate`, using
  `video.currentTime` each time — it needs no changes to work correctly during looped playback,
  since a native loop still fires these same events on every pass (a looping video fires `seeked`
  and `play`-adjacent frame updates as it wraps, but critically does **not** fire `ended`).

## Goals / Non-Goals

**Goals:**
- Convert the quality warning to a real modal (dimmed backdrop, focus moves in) without changing
  its existing content or the `proceedAnyway` contract.
- Make the metrics panel visible beside the video without scrolling, on viewports wide enough for
  it, falling back to the current stacked layout below a breakpoint.
- Have the video loop with the overlay once analysis completes, without breaking the next
  "Analyze again" run's ability to detect the clip's natural end.

**Non-Goals:**
- Redesigning `MetricsPanel`'s internal content or the chart.
- Adding a way to close the quality-warning modal other than "Proceed anyway" (matches today's
  behavior — there is no separate cancel/reject control currently, and none is being added).
- Changing the video's native `controls` (scrubber, play/pause, volume) — the loop is layered on
  top of the existing controls, not a replacement for them.

## Decisions

**Modal implementation: plain positioned `<div>` backdrop + dialog, not the native `<dialog>`
element.** The native `<dialog>` gives `showModal()`/top-layer stacking and light-dismiss handling
for free, but its default backdrop styling and focus-return-on-close behavior interact awkwardly
with this codebase's existing focus-handoff pattern (`App.tsx`'s `handleProceedAnyway` deliberately
moves focus to the video element itself, not back to whatever triggered the dialog — there was
never a triggering click, since the warning appears automatically). A backdrop `<div>` (`fixed
inset-0`, dimmed background, click-through disabled) plus a dialog `<div role="alertdialog"
aria-modal="true">` keeps that existing focus-handoff behavior intact and matches the rest of the
codebase's plain-Tailwind, no-extra-dependency component style. `role="alertdialog"` (rather than
generic `role="dialog"`) is used because the pattern matches its definition exactly: a modal that
interrupts the user to demand a decision before proceeding.

**Loop must be explicitly cleared before each new `start()`, not left permanently on.** A looping
`<video>` never fires `ended` — it seeks back to `0` and keeps playing instead. `sampleClip.ts`'s
only signal that a sampling pass is complete is the `ended` event. If the loop set at the end of
run N were still active when the user clicks "Analyze again" for run N+1, the new sampling pass
would play forever without ever resolving, hanging the run. So `useVideoAnalysis.start()` must
clear `video.loop = false` before calling `video.play()` for sampling, and the loop-restart logic
only sets `video.loop = true` on the `phase === 'ready'` transition, not before.

**Loop-restart lives in `useVideoAnalysis`, gated on the `phase` transition to `'ready'`, via an
effect — not inside `sampleClip.ts`.** `sampleClip.ts` is the sampling primitive and has no
opinion about post-analysis presentation; `useVideoAnalysis` already owns the `phase` state
machine and is the natural place to react to entering `'ready'`. An effect keyed on `phase` (fires
once per transition into `'ready'`) sets `video.muted = true`, `video.currentTime = 0`, `video.loop
= true`, then calls `video.play()` (swallowing a rejected promise — if autoplay is still somehow
blocked, the video stays paused at frame 0 with `loop` set, and native controls or a manual seek
picks the loop back up on the next `play` the user triggers).

**Muting before the loop-restart's `play()`, not permanently.** The original sampling `play()`
call happens synchronously inside the "Analyze" click handler, which satisfies browser autoplay
policy without muting. The loop-restart's `play()` call happens asynchronously (after `await`ing
sampling and running the robustness/heuristics pass), outside that synchronous call stack, where
autoplay policy is less predictable across browsers. Muting first is a small, safe way to
guarantee the loop starts reliably everywhere; it only affects the automatic loop-restart moment,
not the user's ability to unmute via the native controls afterward.

**Side-by-side layout: a two-column CSS grid on `App.tsx`'s `<main>` above a `sm`/`md` breakpoint,
single column below it.** This mirrors the existing Tailwind-utility-only styling approach used
throughout the codebase (no new layout library). `VideoInputPanel` (with its overlay children)
occupies one column; `QualityWarningBanner`'s trigger area moves out of flow entirely (it's now a
modal), and `ResultsView` (Analyze button, progress, `MetricsPanel`) occupies the other column, so
the stats become visible beside the video as soon as they exist — no scrolling needed on wide
viewports.

## Risks / Trade-offs

- [Muting before the loop-restart silently changes playback audio state] → Scoped to only the
  automatic loop-restart; the user's own subsequent play/pause/unmute via native controls is
  unaffected, and this only fires once per analysis completion.
- [A two-column grid narrows the video's available width compared to today's single column] →
  Only applies above the chosen breakpoint, where there's enough viewport width for both columns
  to remain comfortably usable; falls back to the current full-width stacked layout below it.
- [`role="alertdialog"` semantics need real focus-trap behavior (Tab shouldn't escape the dialog)
  to be a correct modal, not just visually modal] → Implementation must trap focus within the
  dialog while open (e.g. a focus-trap on Tab/Shift+Tab), not only move focus in on open.
