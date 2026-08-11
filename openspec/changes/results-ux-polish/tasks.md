## 1. Quality warning modal

- [x] 1.1 In `QualityWarningBanner.tsx`, replace the inline `role="alert"` `<div>` (warn case)
      with a backdrop (`fixed inset-0`, dimmed background, blocks pointer interaction with the
      page behind it) plus a dialog `<div role="alertdialog" aria-modal="true">` containing the
      same failed-checks list and "Proceed anyway" control. Leave the `'assessing'` status notice
      non-modal.
- [x] 1.2 Move focus into the dialog when it first renders (e.g. focus the dialog container or its
      first focusable control via a ref + effect).
- [x] 1.3 Trap Tab/Shift+Tab focus within the dialog while it's open.
- [x] 1.4 Verify `App.tsx`'s `handleProceedAnyway` (moves focus to the video element after the
      banner unmounts) still works with the new modal markup — adjust only if the DOM structure
      change breaks it. (No change needed: it focuses `videoSource.videoRef` directly, independent
      of the banner's own DOM structure.)
- [x] 1.5 Update `QualityWarningBanner.test.tsx` for the new modal structure: backdrop presence,
      `role="alertdialog"`/`aria-modal`, focus moving into the dialog on open, focus trap, and that
      dismissing/proceeding removes both the dialog and the backdrop.

## 2. Side-by-side results layout

- [x] 2.1 Rework `App.tsx`'s `<main>` composition into a two-column grid (video +
      `QualityWarningBanner`'s non-modal states on one side, `ResultsView` on the other) above a
      chosen breakpoint, falling back to the current single-column stack below it.
- [x] 2.2 Confirm the video and its `SkeletonOverlay` still size/position correctly in the
      narrower column width, and `MetricsPanel`/the oscillation chart remain readable in the
      results column at both breakpoints. (`MetricsPanel`'s card grid switched from viewport
      breakpoints to `@container` query breakpoints so it responds to its actual column width
      instead of the full viewport width.)

## 3. Loop video with overlay after analysis

- [x] 3.1 In `useVideoAnalysis.ts`, add an effect keyed on `phase` that, on transitioning into
      `'ready'`, sets `video.muted = true`, `video.currentTime = 0`, `video.loop = true`, and calls
      `video.play()` (catching/ignoring a rejected promise).
- [x] 3.2 In `useVideoAnalysis.ts`'s `start()`, clear `video.loop = false` before calling
      `video.play()` for a new sampling run, so `sampleClip`'s reliance on the `ended` event still
      works for "Analyze again".
- [x] 3.3 Confirm `SkeletonOverlay` keeps redrawing correctly through the loop (its `play`
      listener re-arms the rAF loop each time playback restarts after the loop's implicit seek —
      verify this holds; a looping video does not fire a `pause` event on wrap, only continued
      `timeupdate`/frame updates). (Confirmed by inspection: its rAF loop, once started on `play`,
      keeps calling `draw()` every frame regardless of looping — it never depends on `pause`/`ended`
      to keep running, only to stop.)
- [x] 3.4 Add/update tests in `useVideoAnalysis.test.ts` (or a new test) covering: loop starts on
      reaching `'ready'`, loop is cleared before a subsequent `start()`, and video is muted before
      the loop-restart's `play()` call.

## 4. Verification

- [x] 4.1 Run the full test suite and typecheck; fix any regressions. (245/245 tests pass,
      `tsc -b` and `eslint .` both clean.)
- [x] 4.2 Manually exercise the app: trigger a failing quality check and confirm the modal dims
      the background and traps focus; confirm the results layout shows video + stats together
      without scrolling on a wide viewport; run an analysis to completion and confirm the video
      loops with the overlay, then click "Analyze again" and confirm sampling completes normally
      (doesn't hang). (Verified live in headless Chromium via Playwright against the dev server,
      using a synthetic low-res clip to force the quality warning: modal renders dimmed and
      focus-trapped with focus moved in; video panel and results panel sit side by side at
      1400px width; on reaching `phase: 'ready'` the video had `loop: true`, `muted: true`,
      `paused: false`, and its `currentTime` kept advancing/wrapping over the following 1.5s;
      "Analyze again" completed a second run without hanging. Zero console errors throughout.)
