# Design — navbar-clip-shell

Spec-only ticket (`strides-kyu.1`). Nothing under `src/` is touched here; this document is the
reasoning the eight implementation tickets (`strides-kyu.2`–`.9`) build against.

## Context

The shell today, in the three files that matter:

| fact | where |
|---|---|
| Header holds an `<h1>` and a tagline. Nothing else. | `App.tsx:17-28` |
| `<main>` is a 2-column grid: sticky clip column, scrolling results column | `MultiClipVideoSession.tsx:179-203` |
| One `ClipSlot` per clip, each a full `VideoInputPanel` + `SkeletonOverlay` + remove button | `MultiClipVideoSession.tsx:183-193`, `ClipSlot.tsx:93-119` |
| Per-clip `{ phase, progress }` exists, one instance per clip, already collected by the parent | `types.ts:39-59`, `ClipSlot.tsx:51`, `MultiClipVideoSession.tsx:76` |
| …and is rendered nowhere except one queued-clip sentence | `ClipSlot.tsx:106-108` |
| Progress the reader actually sees is the **aggregate mean** | `ResultsView.tsx:97-103`, `multiClipAnalysis.ts:77-80` |
| "Add another clip" is a bare `<FileUpload>` — upload only | `MultiClipVideoSession.tsx:194-201` |
| `ClipSession = { clipId, videoSource, analysis }`. No poster, no label, no name. | `multiClipAnalysis.ts:18-22` |
| Header height is hardcoded in three places here… | `MultiClipVideoSession.tsx:182,203` |
| …and a fourth, with a different number, over there | `VideoInputPanel.tsx:132` |

Two things are worth stating precisely because the rest of this document leans on them.

**The clip's `<video>` is already always mounted, and deliberately so.** `VideoInputPanel.tsx:110-135`
carries a comment explaining that the element is never conditionally rendered — `useVideoSource.load()`
reads `videoRef.current` synchronously and no-ops on `null`, so the picker's `load()` call, made while
`status === 'empty'`, depends on the element already existing. Only the `hidden` attribute reflects
status. This change does not introduce "mounted but not shown"; it widens a rule the codebase already
follows, and hardens it (see **D2** — `hidden` is exactly the mechanism we must not extend to the
loaded state).

**Clips 2..N cannot be recorded or demo-loaded today.** `addClip`
(`MultiClipVideoSession.tsx:92-96`) always records a `pendingLoad`, which `ClipSlot`'s mount effect
consumes (`ClipSlot.tsx:70-83`), so the new slot's `VideoInputPanel` picker — gated on `status ===
'empty'` — never renders. The session-level affordance is upload-only. So "the quick action offers
record too" is a **new capability**, not a relocation, and is specced as one.

---

## D1 — The loop is scoped to presentation *(the decision this ticket was required to make)*

### The requirement as it stands

`results-view` L174, "Video loops with overlay once analysis is ready": on `phase: 'ready'` with no
scale pass in flight, seek to 0, mute, set `loop`, `play()`. Implemented as one declarative effect at
`useVideoAnalysis.ts:385-396`. Its stated purpose is in its own comment: *"so the skeleton overlay
keeps replaying instead of sitting on the last frame."*

### What that costs once clips are hidden

The loop condition is per clip, and every clip in a session satisfies it independently. With clips
behind a modal, an N-clip session runs N looping decodes for imagery nobody can see, for the whole
life of the session. Two costs, both computable from this repo's own test clips:

- **Decode + composite.** Demo 1 is 3840×2160 @ 25 fps; Demo 2 is 2160×3840 @ 59.94 fps (CLAUDE.md,
  "The 4K area floor" — 8,294,400 px per frame either way). One looping Demo 1 is ~207 Mpx/s of
  decode; one looping Demo 2 is ~497 Mpx/s. Per clip. Unbounded in session length.
- **The overlay's animation loop, which is worse.** `SkeletonOverlay` mounts whenever `phase ===
  'ready' && robustFrames && metadata` (`ClipSlot.tsx:96-104`) — i.e. exactly when the loop arms. Its
  canvas is sized to **video-native** pixels (`SkeletonOverlay.tsx:124-125`), and its rAF loop
  (`:77-80`) calls `draw()`, whose first statement is `ctx.clearRect(0, 0, canvas.width,
  canvas.height)` (`:68`). At a 60 Hz display that is ~498 Mpx/s of canvas clearing per clip, on a
  canvas that is not on screen.

This cost is **already being paid today** for N clips — today they are at least visible, which is the
only thing that ever justified it. Hiding them removes the justification and leaves the bill.

There is a second, subtler problem with keeping the rule: user agents already throttle or suspend
media and animation frames for content they consider non-rendered, inconsistently and without telling
the page. An "always loop" rule is therefore a rule we cannot enforce or observe — the app would be
specifying behaviour the engine may silently decline. A presentation-scoped loop is behaviour we
control end to end.

### Alternatives considered

| | rule | verdict |
|---|---|---|
| **A1** | Keep it: loop unconditionally on `'ready'` | **Rejected.** Cost above, linear in clips, unbounded in time, zero reader benefit. Also degrades the hard constraint's own observability: if a hidden video is *always* playing, "is this element still playing?" stops distinguishing "analysing" from "idle", which is the cheapest live signal **D8** has. |
| **A2** | Loop only the most recently added, or a designated "current", clip | **Rejected.** Picks an arbitrary clip to burn GPU on. When no preview is open, nobody is looking at *any* of them, so this pays a cost for a viewer who does not exist. Strictly dominated by A3 at equal implementation cost. |
| **A3** | **Loop iff the clip is presented** | **Chosen.** At most one clip loops at a time, and only while a human is looking at it. Everything the removed requirement was *for* — the overlay replaying rather than freezing on the last frame — happens exactly where it matters most: inside a modal opened deliberately to look at the skeleton. |
| **A4** | Drop looping entirely; the preview shows a paused frame with native controls | **Rejected.** This deletes the removed requirement's whole purpose at the one moment it is strongest. A preview whose headline feature is a pose overlay, showing a still, is a worse product than today's. |

### The chosen rule, precisely

Loop iff **all three**: `phase === 'ready'` ∧ scale pass not in `'pending'`/`'running'` ∧ this clip is
presented. When any conjunct drops, `loop` clears and playback stops.

Three properties were preserved deliberately, because the removed requirement earned each of them:

1. **Still one declarative condition.** The removed requirement's own text insists no scale-pass code
   re-arms the loop imperatively; the same must be true of presentation code. The rule gains a
   conjunct, not an imperative caller. `useVideoAnalysis.ts:385-396`'s effect shape survives — it
   needs a third dependency, not a rewrite.
2. **Muted before `play()`.** The `play()` call still happens outside the presenting interaction's
   synchronous call stack (it is an effect keyed on a state change), so autoplay policy still applies.
   Unchanged.
3. **Cleared before a new run, unconditionally.** `useVideoAnalysis.ts:212-214` clears `video.loop`
   at the top of `start()` because *a looping video never fires `ended`*, which `sampleClip` resolves
   on. This is a sampling correctness guarantee, not a presentation concern, and is carried over with
   **no** presentation conjunct. Same for the scale pass's own un-looped replay
   (`useVideoAnalysis.ts:478-482`).

### The guard that makes it safe — presentation is observational while analysis owns the element

A reader can click a thumbnail while that clip is mid-analysis. Presentation must therefore be
**purely observational** while `phase` is `'sampling'`/`'processing'` or the scale pass is in flight:
no `play()`, no `pause()`, no seek, no write to `loop`, no write to `muted`. Concretely, each of those
writes breaks a documented behaviour:

- setting `loop` → the run never sees `ended`, and `sampleClip` never resolves (`useVideoAnalysis.ts:213`);
- seeking to 0 → rewinds the sampler mid-pass;
- `pause()` → sets `isPausedMidAnalysis`, and, if a scale pass is running, fails it immediately by
  design ("A user pause mid-pass fails the pass fast", `results-view` spec);
- `play()` → could restart a paused-by-the-reader run at a moment the pipeline is not expecting.

**The guard is unconditional, and that is on purpose.** On the WebCodecs sequential-decode path
(`sequentialSampling` defaults `enabled: true`, `samplingRobustnessConfig.ts:40`) sampling reads
`sourceBlob`'s bytes and never touches the `<video>` element at all — so on that path a
presentation-driven write *looks* harmless. It is harmless only until `canUseSequentialDecode` says
no (a WebM/webcam clip, an unsupported codec, an oversized blob — `webCodecsSupport.ts:74`), which is
a per-clip, per-run runtime answer the presentation layer does not hold. A guard that is correct only
on the default path is a guard that fails on exactly the clips a user records themselves.

### What this decision does not decide

Whether the preview is the *only* presentation. If a later change adds an inline "big player" view,
the rule generalises unchanged — "presented" is the concept, "the modal is open" is today's only
instance of it. The spec is written in terms of presentation for that reason.

---

## D2 — Hiding is visual only: the mechanism ranking

The epic's hard constraint. Sampling's playback path drives detection off
`requestVideoFrameCallback` on a live, playing element (`results-view`, "Whole-clip sampling via
self-throttled frame callbacks"). Candidate hiding mechanisms, ranked:

| mechanism | verdict |
|---|---|
| Conditional render / unmount / mount gate | **Forbidden.** Destroys the element mid-run. Also breaks `useVideoSource.load()`'s synchronous `videoRef.current` read (`VideoInputPanel.tsx:110-118`). |
| `hidden` attribute, `display: none` | **Forbidden.** A non-rendered media element may have decode suspended and frame presentation stopped; `requestVideoFrameCallback` is not guaranteed to fire for it. This is the mechanism `VideoInputPanel.tsx:131` already uses for `status === 'empty'` — correct there (no clip, nothing to sample) and wrong the moment a clip is loaded. |
| `visibility: hidden` | **Avoid.** Rendering is suppressed; same class of risk with less documentation. |
| Zero-size / `width:0;height:0` container with `overflow:hidden` | **Avoid.** Degenerate box, and some engines treat a zero-area media element as non-rendered. |
| **Kept in flow, full size, positioned outside the viewport (or clipped), still rendered** | **Preferred.** The element remains a rendered, composited, playing element; only its position on screen changes. |

The spec states this **behaviourally** — "analysis reaches `'ready'` with a detected-frame count
consistent with the same clip analysed while visible" — rather than naming a CSS technique, because
the technique is an implementation detail and the frame count is the thing that must hold. The table
above is guidance for `strides-kyu.3`, not a contract.

**Nothing in `tsc -b` or `npm test` can catch a violation.** jsdom has no media pipeline, no decoder,
and no `requestVideoFrameCallback`; a hidden element that never presents a frame is
indistinguishable, under test, from a working one. That is why the guarantee is written into the spec
and why `strides-kyu.9` exists as its own ticket with numeric acceptance criteria.

---

## D3 — Per-clip progress, and the session line that must survive

Per-clip state already exists and is already collected. The strip **reads** it
(`MultiClipVideoSession.tsx:76`'s `clipStates`); it does not derive a parallel state machine. The
five conditions the strip must show:

| condition | source |
|---|---|
| sampling (with %) | `analysis.phase === 'sampling'`, `analysis.progress` |
| processing | `analysis.phase === 'processing'` |
| ready | `analysis.phase === 'ready'` |
| error | `analysis.phase === 'error'` |
| **queued** | derived: `videoSource.status === 'ready' && analysis.phase === 'idle'` and this clip is not the active one |

**Queued is not a phase.** `AnalysisPhase` has five values (`types.ts:6`) and `'idle'` covers both
"nothing has happened yet" and "waiting for the shared detector". Today the distinction is drawn by
`ClipSlot.tsx:106-108`, using the `detector` prop as the tell. The strip does not receive that prop —
but it does not need it: `MultiClipVideoSession` already computes `activeClipId` every render
(`:146-150`, via `nextActiveClipIndex`), so "is this the active clip" is available at the level that
renders the strip. **No new plumbing.**

### The conflict that had to be resolved

`results-view`'s "The centimetre card reflects scale-pass progress" requires an *always-visible*
`role="status"` line that narrates the background scale pass — a count-agnostic sentence while
`'pending'`/`'running'`, a pluralised outcome on `'done'`/`'failed'`. That line is
`ResultsView.tsx:105-123`, i.e. the same block as the per-clip progress the epic moves onto
thumbnails. Reading the epic as "delete the whole block" would silently falsify a requirement this
change never intended to touch, and would also delete the "Analysis complete." string the e2e suite
waits on.

**Resolution, specced explicitly:** the block splits by *scope*, not by deletion.
`'Analyzing… 42%'`/`'Processing results…'` are per-clip facts rendered from an aggregate mean and
move to the strip; `'Analysis complete.'` plus the scale-pass narration are **session** facts and
stay in the session `role="status"` line. Per-clip progress is not duplicated there.

### One live region, not N

`strides-kyu.4` asks for a `role="status"` text equivalent. Taken literally per thumbnail, an N-clip
session gets N live regions announcing over each other every time any clip's progress ticks — a
regression for exactly the users the requirement is for. The spec instead requires that per-clip
progress be *available as text* on each entry (accessible name / visually-hidden text) while **at
most one** live region announces clip progress for the session. Same guarantee, no announcement
storm.

---

## D4 — The preview reveals; it does not reparent

`SkeletonOverlay` is coupled to a **live** element and its media events (`play`/`pause`/`ended`/
`seeked`/`timeupdate`, `SkeletonOverlay.tsx:100-104`); it cannot render against a still. That is fine
— the preview shows the real element. The risk is *how* it shows it.

- **Reparenting the `<video>` into the dialog** (moving the DOM node, or switching a React portal's
  container) is the obvious approach and the dangerous one. In React a container switch remounts the
  children into the new host, which means a new DOM node: `videoRef.current` changes identity, the
  ref the running analysis captured goes stale, and `SkeletonOverlay`'s listeners are bound to an
  element that is no longer the one playing. Under a `pendingLoad`-style mount this is precisely the
  class of bug `ClipSlot.tsx:56-83` already documents having been bitten by once.
- **Preferred: the element never moves.** Each clip's `<video>` lives in a per-clip container that is
  always mounted; presenting the clip changes that container's *presentation* (it becomes the dialog's
  content surface) rather than its position in the tree.

The spec expresses this as an **observable** rather than a technique: the element reference analysis
and the overlay hold is the same DOM element across every visibility transition. That is directly
testable (`expect(videoRef.current).toBe(nodeCapturedBeforeOpening)`) and does not over-constrain the
implementation to one React idiom.

**A preview is offered even before analysis finishes** — video, no overlay. Withholding it would be
the wrong instinct: the reader inspecting a clip mid-analysis is reasonable, and D1's observational
guard is what makes it safe. Overlay mounting stays gated on `phase === 'ready' && robustFrames &&
metadata`, exactly as `ClipSlot.tsx:96-104` gates it today.

---

## D5 — The poster: capture what is already decoded, never seek

The clip model has no poster. Adding one raises exactly one hard question: **where does the frame
come from without disturbing the element?**

- **Rejected: seek to a chosen instant (t=0, or a fraction of duration), draw, seek back.** Three
  problems. It writes to an element that sampling, the scale pass, and the reader's own preview all
  own at different times. Fraction-of-duration is unusable for webcam clips, which commonly report
  `duration === Infinity` — the identical trap `results-view`'s evidence requirement already calls
  out. And "seek back" cannot restore a state the pipeline may have changed in between.
- **Chosen: copy whatever frame the element has already decoded, once, at the earliest opportunity,
  writing nothing.** In practice that is the clip's first frame, which is the natural poster anyway.

**Timing detail that will bite an implementer who does not know it:** `useVideoSource` sets
`status: 'ready'` from the `loadedmetadata` handler (`useVideoSource.ts:58,66`). `loadedmetadata`
guarantees dimensions, **not** a decoded frame — drawing at that instant can yield a blank or black
image. The poster therefore becomes available *at or after* `'ready'`, once a frame actually exists,
and the strip must render a neutral placeholder in the gap. That is specced, not left to chance.

The poster is captured **once** and never refreshed. A poster that tracked playback would make the
strip flicker and would couple the strip's render to the video's clock for no benefit.

Consistent with the rest of the codebase: no data URL, no blob, no object URL, no storage (the same
rule extracted evidence images follow, `results-view` L688); released on removal and reset (the same
lifecycle `sourceBlob` follows, `video-input` L117-123); sizing/aspect arithmetic pure and
canvas-free so it is unit-testable (`src/test/canvasTestUtils.ts` exists because jsdom has no
canvas).

**Placement: its own requirement, not a modification of "Unified video source contract".** Precedent
is exact — `sourceBlob` was added to `VideoSource` as its own standalone requirement ("Retained
source blob for downstream demuxing") rather than by editing the unified-contract requirement's
field list. Following it keeps this delta free of a MODIFIED block on a requirement whose exact title
text would otherwise have to be matched for a one-word field-list edit.

---

## D6 — One picker, two presentations

The add-a-clip action must offer recording, and recording needs a preview surface — a webcam preview
does not fit in a header button. Rather than build a second, header-shaped input UI:

**The header action presents the same picker the zero-clip state presents full-page.** Zero clips →
picker as the page's main content. One or more clips → the same picker, opened from the header. One
component, one set of input paths, one contract.

This falls out well: the demo buttons (`VideoInputPanel.tsx:83-93`) come along, which means a reader
can add Demo 2 to a session that started with Demo 1 — impossible today (see Context). The
`FileUpload` `multiple` behaviour (one `onSelected` per file, `FileUpload.tsx:44`) is preserved
verbatim, so one picker interaction still creates N clips.

---

## D7 — The header height must be measured, not written down

Four hardcoded values, two different numbers, derived from nothing:
`lg:top-[86px]` and `lg:max-h-[calc(100vh-86px)]` (`MultiClipVideoSession.tsx:182,203`), and
`max-h-[calc(100vh-150px)]` (`VideoInputPanel.tsx:132`, whose comment even explains the 150 as
"86px header plus padding" — a hand-computed derivative of a constant that is about to change).

A header that grows a clip strip breaks all four silently: no type error, no test failure, just a
sticky element in the wrong place. And the strip's height is *content-dependent* — present vs absent,
thumbnail size, focus ring — so a new constant would be wrong again the first time the strip changes.

Preference: measure the rendered header and publish it (a CSS custom property fed by a
`ResizeObserver`), so dependents read one live value. A single shared design token is acceptable only
if the header's height is genuinely fixed across the strip-present and strip-absent states. The spec
states the observable — offsets track the header's real height at any viewport width — not the
mechanism.

---

## D8 — Verification plan and pre-registered gates

Per CLAUDE.md's standing rule, headless Chromium with real GPU
(`--headless=new --enable-gpu --ignore-gpu-blocklist`); confirm `WEBGL_debug_renderer_info` reads
`ANGLE Metal Renderer`, never `SwiftShader Device`, before trusting a number. Capture
`[analysis-diagnostics]` with the exclusive prefix match
(`startsWith('[analysis-diagnostics]') && !startsWith('[analysis-diagnostics:')`).

**Baselines must be captured on the same machine in the same session, before the change** — the
determinism caveat means cross-session numbers are not comparable.

| gate | measurement | pre-registered pass rule |
|---|---|---|
| **G1 — the hard constraint** | Demo 1 and Demo 2, 3 trials each, `sampling.detectedFrames` and `personSelection.detectedSamplesIn`, before vs after | Both clips reach "Analysis complete"; median `detectedFrames` within 10% of the pre-change median on the same machine. **A drop beyond that means the hiding mechanism is wrong (D2) — change the mechanism, do not accept the number.** |
| **G2 — loop scoping** | Two ready clips, no preview open | No clip's element is playing (`paused === true`, `loop === false`) for every clip. Opening one preview starts exactly one; dismissing it stops that one. |
| **G3 — progress independence** | Two-clip session, sampled during analysis | The two entries show different conditions at the same instant (one sampling, one queued) and do not move in lockstep. Directly falsifies "the strip is still rendering the aggregate". |
| **G4 — the preview** | Open a preview on a ready clip | Overlay draws over the real element; the video element node identity is unchanged across open → close (D4). |
| **G5 — no evidence-gallery regression** | `[evidence-coverage]`, last line per run | Per-clip totals match CLAUDE.md's recorded table — Demo 1 **7 images / 5 sections**, Demo 2 **5 / 4**. Extraction races playback state, so a change here means the detached-element path (or the poster capture) disturbed the clip's element. |

`strides-kyu.9` owns G1–G4 and should record actual numbers in the ticket, not "looked fine". G5 is
cheap to add to the same run and catches D5's worst failure mode.

---

## D9 — Risks

- **R1 — a `display:none`-class regression is silent.** The whole of D2. Mitigation: G1, and the fact
  that `strides-kyu.3` is isolated as its own P0 ticket precisely so this lands and is verified alone.
- **R2 — the preview reparents and stales the ref.** D4. Mitigation: G4's node-identity assertion,
  which is also cheap as a component test.
- **R3 — a reader opens a preview mid-analysis and the presentation layer writes to the element.**
  D1's observational guard. Mitigation: a scenario in the spec plus a component test; note that the
  default WebCodecs path will *not* reveal the bug (D1), so the test must exercise the playback path.
- **R4 — e2e selectors move.** `e2e/multiPersonAcquisition.spec.ts` waits on
  `getByText(/analyzing|processing results/i)` and `getByText(/analysis complete/i)`. D3 keeps the
  second string alive at the session level; the first moves onto per-clip entries and needs a new
  wait, not a re-selector. Owner: `strides-kyu.8`.
- **R5 — paused clips are cheaper, not free.** A paused 4K `<video>` still holds decoder and buffer
  resources, and the session has no cap on clip count. This change strictly reduces the standing cost
  (from N looping decodes to at most one) but does not bound it. Recorded, not solved.
- **R6 — the poster fires before a frame exists.** D5's `loadedmetadata`-vs-`loadeddata` gap produces
  a black thumbnail if implemented naively, and a black thumbnail is not obviously wrong on a dark
  clip. Mitigation: the "no poster before a frame exists" scenario, plus checking a strip entry
  against the clip's actual first frame during G4.

---

## D10 — Delta mechanics

CLAUDE.md is emphatic that MODIFIED/REMOVED blocks must reuse the **exact** existing requirement
title text, because archiving matches by name and silently drops what it cannot match. What this
change does, and why:

- **REMOVE + ADD — "Video loops with overlay once analysis is ready".** Its first scenario
  ("Reaching the ready phase restarts and loops playback") *fully reverses*: under D1 a ready,
  unpresented clip must stay paused. A MODIFIED block that inverts its own headline scenario is the
  case CLAUDE.md names explicitly. Removed with Reason/Migration; re-added as **"Clip playback loops
  only while that clip is presented"**, carrying the other four scenarios' substance over — the
  scale-pass re-arm, the overlay staying in sync, muting before `play()`, and clearing the loop before
  a new run (that last one carried over *unconditionally*, since it is a sampling guarantee, not a
  presentation one).
- **MODIFIED — "Evidence frames are planned purely, then extracted from a detached video element".**
  Reproduced verbatim except for two edits, both consequences of D1: the rationale clause "never the
  visible element, **which is loop-playing once analysis is ready**" is no longer true of an
  unpresented clip, and the scenario "Extraction happens after analysis and never disturbs the visible
  playback" had a WHEN clause ("`phase: 'ready'` **and the visible video begins looping**") that can
  now only fire while a preview happens to be open. The requirement's normative content is untouched
  and, if anything, load-bearing in a new way: extraction must not use the clip's own element
  *precisely because* a reader may be watching it. A word-level diff against the current spec was run
  to confirm the reproduction differs only in those two places.
- **No MODIFIED on "Unified video source contract".** The poster is added as its own requirement,
  following `sourceBlob`'s precedent (D5). Deliberate: a MODIFIED block over a requirement whose only
  change is one more field in a prose list is all title-matching risk and no benefit.
- **No MODIFIED on "The centimetre card reflects scale-pass progress".** D3's resolution keeps it
  true as written. The new session-status requirement is additive and names it explicitly, so a future
  reader can see the two are coordinated rather than in tension.
- **No MODIFIED on "Overlay stays synced at any point in playback"** or **"Automatic analysis
  start"**. Both stay true unchanged. The former's "does not run an animation loop while idle"
  scenario is *more* often satisfied under D1, not less.

## Open, and deliberately not resolved here

- **Whether the removed in-body "Analyze"/"Analyze again" control has a home in the new shell.**
  `ResultsView.tsx:77-87` renders it against the *aggregate* (`multiClipAnalysis.ts:94-97` fans
  `start()` out to every clip). It is unrelated to this epic's restructure, "Automatic analysis
  start" still requires it to exist, and this change neither moves nor removes it. If the shell
  redesign wants it per clip, that is a separate change with its own delta on that requirement.
- **A clip name or label.** Deliberately out of scope: clips stay positional, because the per-metric
  fusion source index and the "Combined from clip N of TOTAL" provenance copy already number them
  that way, and introducing a second identity scheme would need those reconciled first.
