## 1. Spec (this ticket — `strides-kyu.1`)

- [x] 1.1 `proposal.md`, `design.md`, `tasks.md` (this file).
- [x] 1.2 `specs/results-view/spec.md` — MODIFIED "Evidence frames are planned purely, then extracted
      from a detached video element"; REMOVED "Video loops with overlay once analysis is ready";
      ADDED mounted-and-playable hidden elements, presentation-scoped looping, the clip preview, and
      the session-status split.
- [x] 1.3 `specs/video-input/spec.md` — ADDED the poster contract and the picker / add-a-clip action.
- [x] 1.4 `specs/multi-clip-analysis/spec.md` — ADDED the clip strip, per-clip progress, and the
      one-source-one-clip rule.
- [x] 1.5 Word-level diff of the MODIFIED block against `openspec/specs/results-view/spec.md` to
      prove the reproduction differs only in the two intended places (design.md D10).
- [x] 1.6 `openspec validate navbar-clip-shell --strict`.
- [x] 1.7 Zero files changed under `src/`.

## 2. Poster (`strides-kyu.2`) — independent of the restructure, land it first

- [ ] 2.1 Extend the video source with a poster: captured once from an already-decoded frame, with
      **no** write to `currentTime`/`paused`/`muted`/`loop` (design.md D5).
- [ ] 2.2 Gate capture on a frame actually being available, not on `status === 'ready'` — that
      transition fires from `loadedmetadata` (`useVideoSource.ts:58,66`) and guarantees dimensions
      only. Expose `null` until then.
- [ ] 2.3 Keep the sizing/aspect arithmetic canvas-free and pure; only the frame copy touches a
      context (jsdom has no canvas — `src/test/canvasTestUtils.ts`).
- [ ] 2.4 Release the poster on clip removal and on session reset, matching `sourceBlob`'s lifecycle.
- [ ] 2.5 Unit tests: sizing math with no canvas; `null` before a frame exists; released on reset;
      no data URL / blob / object URL produced.
- [ ] 2.6 `npm test` and `tsc -b` clean.

## 3. Restructure the shell (`strides-kyu.3`) — P0, land and verify **alone**

- [ ] 3.1 Clips leave the page body; results become `<main>`'s content rather than one grid column.
- [ ] 3.2 Clip video elements stay mounted and playable while hidden. Use a mechanism that keeps the
      element **rendered** — not unmount, not `hidden`, not `display:none`, not `visibility:hidden`,
      not a zero-size box (design.md D2's ranking).
- [ ] 3.3 Zero loaded clips renders the full-page picker.
- [ ] 3.4 **Live verification, before anything else lands on top**: Demo 1 and Demo 2 reach "Analysis
      complete"; record `sampling.detectedFrames` before and after, on the same machine, real GPU.
      Gate **G1** (design.md D8): a median drop beyond 10% means the hiding mechanism is wrong —
      change the mechanism, do not accept the number.
- [ ] 3.5 `npm test` and `tsc -b` clean.

## 4. Clip strip with per-clip progress (`strides-kyu.4`)

- [ ] 4.1 Render the strip in the header beside the wordmark, one entry per clip, in clip-session
      order (the same order fusion's source index and the "Combined from clip N of TOTAL" copy use).
- [ ] 4.2 Each entry renders that clip's poster, with a neutral placeholder while the poster is
      `null`.
- [ ] 4.3 Per-clip progress read from that clip's own `VideoAnalysisState`
      (`MultiClipVideoSession.tsx:76`'s `clipStates`) — **not** from `computeAggregateAnalysisState`.
      No new state machine.
- [ ] 4.4 Distinguish sampling / processing / ready / error / queued by more than colour. Derive
      *queued* from the already-computed `activeClipId` (`MultiClipVideoSession.tsx:146-150`) — no
      new plumbing (design.md D3).
- [ ] 4.5 Expose each entry's condition and progress to assistive technology as text, with **at most
      one** live region announcing clip progress for the whole session (design.md D3).
- [ ] 4.6 Overflow by scrolling the strip, not by wrapping the header.
- [ ] 4.7 Keep the session `role="status"` line and its scale-pass narration intact — "The centimetre
      card reflects scale-pass progress" still requires it (design.md D3).
- [ ] 4.8 `npm test` and `tsc -b` clean.

## 5. Clip preview modal (`strides-kyu.5`)

- [ ] 5.1 Activating a strip entry presents that clip's **already-mounted** element. The element does
      not move in the DOM and `videoRef.current` keeps its identity across open → close
      (design.md D4).
- [ ] 5.2 Reuse `SkeletonOverlay` unchanged, on the same gate it uses today (`phase === 'ready' &&
      robustFrames && metadata`). A preview opened before that renders the video with no overlay.
- [ ] 5.3 Implement presentation-scoped looping: loop iff `phase === 'ready'` ∧ no scale pass in
      flight ∧ presented — as one declarative condition, extending the existing effect at
      `useVideoAnalysis.ts:385-396` rather than adding an imperative caller (design.md D1).
- [ ] 5.4 Dismissing clears `loop` and stops playback, so no hidden clip decodes.
- [ ] 5.5 Keep the unconditional loop clear at the top of `start()` (`useVideoAnalysis.ts:212-214`)
      and the scale pass's un-looped replay (`:478-482`) — both are sampling guarantees, not
      presentation concerns.
- [ ] 5.6 Presenting/dismissing a clip whose analysis or scale pass is in flight writes **nothing**
      to `loop`, `currentTime`, `paused`, or `muted`. Test on the playback path specifically — the
      default WebCodecs path will not reveal a violation (design.md D1, risk R3).
- [ ] 5.7 `aria-modal`, focus trap, Escape to dismiss, focus returned to the originating entry,
      overlay canvas stays `aria-hidden`.
- [ ] 5.8 `npm test` and `tsc -b` clean.

## 6. Header add-a-clip action (`strides-kyu.6`)

- [ ] 6.1 One action in the header offering **both** record and upload — plus the demo clips, which
      are unreachable for clips 2..N today. Present the same picker the zero-clip state presents
      full-page (design.md D6).
- [ ] 6.2 Preserve `FileUpload`'s `multiple` fan-out (`FileUpload.tsx:44`): one picker interaction,
      one clip per selected file.
- [ ] 6.3 Remove the in-body "Add another clip" block (`MultiClipVideoSession.tsx:194-201`).
- [ ] 6.4 Keyboard reachable, with an accessible name saying what it does.
- [ ] 6.5 `npm test` and `tsc -b` clean.

## 7. Header offset (`strides-kyu.7`)

- [ ] 7.1 Remove all four hardcoded header-height values: `MultiClipVideoSession.tsx:182,203` and
      `VideoInputPanel.tsx:132`, plus whatever the restructure leaves behind.
- [ ] 7.2 Offsets track the header's actually-rendered height, including strip-present vs
      strip-absent (design.md D7).
- [ ] 7.3 Verified at narrow and wide viewports.
- [ ] 7.4 `npm test` and `tsc -b` clean.

## 8. Tests (`strides-kyu.8`)

- [ ] 8.1 Update component tests for the moved surfaces: `App.test.tsx`,
      `MultiClipVideoSession.test.tsx`, `ClipSlot.test.tsx`, `ResultsView.test.tsx`,
      `VideoInputPanel.test.tsx`.
- [ ] 8.2 New coverage: one strip entry per clip; per-clip progress is per-clip and not the
      aggregate; the preview opens, traps focus, closes on Escape, restores focus; the video node
      identity is unchanged across open → close.
- [ ] 8.3 New coverage: presenting a mid-analysis clip writes nothing to its playback state.
- [ ] 8.4 `e2e/multiPersonAcquisition.spec.ts` — the two progress-text waits need rethinking, not
      just re-selecting (progress moved onto entries); `getByRole('button', { name: 'Upload' })` and
      `input[type=file]` move with the picker.
- [ ] 8.5 No test asserts against a selector the redesign removed.
- [ ] 8.6 `npm test` and `npm run test:e2e` green.

## 9. Live verification (`strides-kyu.9`)

- [ ] 9.1 Headless Chromium, real GPU; record the `WEBGL_debug_renderer_info` string and confirm it
      is not SwiftShader before trusting any number.
- [ ] 9.2 **G1** — Demo 1 and Demo 2 both reach "Analysis complete"; `sampling.detectedFrames`
      recorded before and after, both in range. Paste the numbers into the ticket.
- [ ] 9.3 **G2** — two ready clips, no preview open: no clip's element is playing. Opening one
      preview starts exactly one; dismissing stops it.
- [ ] 9.4 **G3** — two-clip run shows per-entry progress that differs between the entries at the same
      instant and does not move in lockstep.
- [ ] 9.5 **G4** — the preview opens on a real clip, the skeleton overlay draws, and the video node
      identity is unchanged across open → close.
- [ ] 9.6 **G5** — `[evidence-coverage]` (last line) totals still match CLAUDE.md's table: Demo 1
      7 images / 5 sections, Demo 2 5 / 4.
- [ ] 9.7 Update CLAUDE.md if any documented baseline moved, then archive this change
      (`openspec archive navbar-clip-shell --yes`) — after live verification, not before.
