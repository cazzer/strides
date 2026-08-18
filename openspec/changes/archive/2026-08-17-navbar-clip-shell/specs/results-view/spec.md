## MODIFIED Requirements

### Requirement: Evidence frames are planned purely, then extracted from a detached video element

The system SHALL, only after an analysis run has reached `phase: 'ready'`, extract a small number of
still frames from the analyzed clip at the timestamps its metrics reported as exemplars, crop each to
the region of the frame that exemplar names, and — for an exemplar naming two instants — composite
the two into a single alpha-blended image.

The decision half SHALL be **pure**: turning an exemplar into timestamps, resolving those timestamps
to sampled frames, deriving a crop rectangle, and deciding which frame is the base, which is the
ghost, and at what opacities, SHALL all be computable with no DOM, no canvas, and no video element,
so that all of it is unit-testable in an environment with no canvas implementation. Only the final
draw SHALL touch a rendering context.

Timestamps SHALL be resolved against that clip's own sampled frames. The system SHALL NOT derive any
extraction timestamp from the clip's reported duration: a recorded webcam clip commonly reports an
infinite duration, and any fraction-of-duration arithmetic would silently produce a nonsensical
instant on exactly those clips.

Crop rectangles SHALL be computed in video-native pixel space, from the resolvable subset of the
exemplar's named keypoints **unioned across both frames of a pair**, then padded and clamped to the
frame bounds so that a subject near an edge or partly out of frame yields a valid rectangle rather
than a negative or out-of-bounds one. Every crop SHALL share a single aspect ratio across all
metrics, so the gallery reads as one coherent set. Keypoints that a given pose backend structurally
cannot produce SHALL be treated as absent rather than as positions: a crop SHALL be well-defined from
the exemplar's core keypoints alone.

A pair whose two instants are indistinguishable — near-identical crop regions, or both resolving to
the same sampled frame — SHALL be demoted to a single frame, or dropped when the metric has no honest
single-instant meaning. A blurred double exposure of two identical frames is worse than one clean
still.

Extraction SHALL use a **second, detached** video element created from the clip's own source blob,
never the clip's own presented element, whose playback state belongs to the reader (it may be paused
on an arbitrary frame, or loop-playing while its preview is open). It SHALL hold at most one detached
decoder open at a time, extracting every instant for one clip in a single pass before moving
to the next. It SHALL own and release the object URL it creates, and SHALL NOT reuse or release the
one the video source hook holds privately. After a seek reports completion it SHALL wait for the new
frame to be presented before drawing, since seek completion does not imply the new frame is
composited. A seek that never completes SHALL degrade that metric to "no evidence" rather than
leaving the interface waiting.

Extracted images SHALL be held in memory for the session only. The system SHALL NOT serialize them to
a data URL or blob, offer a download, or persist them to any storage.

A metric with no evidence SHALL be distinguishable, in the extraction result, from a metric whose
evidence has not been computed yet — an explicit outcome the interface can branch on, carrying the
reason (the metric emitted no exemplars, every candidate was gated out, the metric is not being
reported at all, the clip's frames are unavailable, or extraction failed).

#### Scenario: Extraction happens after analysis and never disturbs the visible playback

- **WHEN** an analysis run reaches `phase: 'ready'`, whether or not the clip's own element is
  currently presented and playing
- **THEN** evidence extraction runs against a separate detached element created from the clip's
  source blob, the clip's own element's playback state is untouched, and analysis wall-clock time is
  unchanged from a run with no extraction

#### Scenario: A webcam clip reporting an infinite duration still yields a valid plan

- **WHEN** the clip's metadata reports a non-finite duration, as recorded webcam blobs commonly do
- **THEN** the extraction plan is well-formed, because every timestamp derives from the clip's own
  sampled frames and none from its reported duration

#### Scenario: A subject near the frame edge yields a valid crop

- **WHEN** an exemplar's keypoints sit near, or partly beyond, a frame boundary
- **THEN** the crop rectangle is clamped inside the frame with a positive size and the same aspect
  ratio every other crop uses, rather than a negative or out-of-bounds rectangle

#### Scenario: A near-identical pair is demoted rather than blended

- **WHEN** a pair's two instants produce near-identical crop regions, or both resolve to the same
  sampled frame
- **THEN** the pair is demoted to a single frame — or dropped entirely for a metric with no honest
  single-instant meaning — and no double exposure is composited

#### Scenario: A failed seek degrades to no evidence

- **WHEN** the detached element never reports a completed seek for a planned timestamp
- **THEN** that metric's evidence resolves to an explicit "no evidence" outcome naming extraction
  failure, and the interface renders the metric exactly as it does without evidence

#### Scenario: Missing backend keypoints do not corrupt a crop

- **WHEN** an exemplar names optional context keypoints the running pose backend structurally cannot
  produce, so they carry no position
- **THEN** those keypoints are omitted from the crop derivation and the crop is computed from the
  exemplar's core keypoints alone — never anchored at the coordinate origin

## REMOVED Requirements

### Requirement: Video loops with overlay once analysis is ready

**Reason**: This requirement ties looping playback to `phase: 'ready'` alone, which was correct when
every clip's video was laid out in the page body and therefore always on screen. Once clips move
into a navbar strip and their video elements become hidden hosts revealed only by a preview, the
same rule means **every clip in the session decodes and composites a video nobody can see, for the
whole life of the session** — linear in clip count, unbounded in time, and (with the skeleton
overlay mounted) an animation-frame loop per clip repainting a video-native-resolution canvas that
is never displayed. Its first scenario ("Reaching the ready phase restarts and loops playback")
fully reverses: reaching `'ready'` must now leave an unpresented clip paused. Per this repo's
convention a fully-reversed scenario is removed and re-added under a fresh name rather than fought
through a MODIFIED block.

**Migration**: Replaced in full by "Clip playback loops only while that clip is presented" (ADDED
below). Four of the five original scenarios carry over with their substance intact — the loop
re-arming when the scale pass concludes, the overlay staying in sync through the loop, muting before
`play()` for autoplay policy, and clearing the loop before a new run so that run's sampling sees a
real `ended` event — each now conditioned on the clip being presented, and the last of them
(clearing the loop before a new run) carried over **unconditionally**, since it is a sampling
correctness guarantee and not a presentation concern. The reversed scenario's replacement is
"Reaching the ready phase while not presented leaves the clip paused". No new imperative re-arming
is introduced: the loop is still owned by one declarative condition, which merely gains a conjunct.

## ADDED Requirements

### Requirement: Clip video elements stay mounted and playable while hidden

Sampling reads frames off a live, playing `<video>` element. The system SHALL therefore keep every
clip's video element mounted and playable for the whole life of that clip's session entry,
regardless of whether the clip is currently visible. Hiding a clip SHALL be **visual only**: the
element SHALL NOT be conditionally rendered, unmounted, moved behind a mount gate, or suppressed by
any mechanism that permits a user agent to stop rendering it, stop presenting frames from it, or
suspend its decode.

The DOM element the analysis pipeline holds a reference to SHALL remain the same element across
every visibility transition, so that revealing a clip is a change of appearance and never a change
of identity.

This guarantee SHALL be verified by running a real analysis in a browser and comparing the resulting
sampled/detected frame counts against the same clips analysed before the change on the same machine.
Neither type checking nor the unit suite can observe a violation: the test environment has no media
pipeline and no frame-callback implementation, so a hidden element that never presents a frame looks
identical to a working one.

#### Scenario: A clip that is never displayed still analyses

- **WHEN** a clip is loaded while its video element is hidden from the page body and no preview of
  it is open
- **THEN** its analysis reaches `phase: 'ready'` with a detected-frame count consistent with the
  same clip analysed while visible, rather than stalling, timing out, or completing with a
  degenerate sample count

#### Scenario: Revealing a clip does not change which element analysis holds

- **WHEN** a clip's preview is opened and then closed
- **THEN** the video element reference the clip's analysis and skeleton overlay hold is the same DOM
  element throughout — no second element is created for the clip, and the existing one is neither
  remounted nor recreated

#### Scenario: Removing a clip is the only thing that unmounts its element

- **WHEN** a clip is removed from the session, or the whole session is reset
- **THEN** that clip's video element is unmounted and its resources released — the one case where
  the element legitimately goes away

### Requirement: Clip playback loops only while that clip is presented

The system SHALL restart a clip's video from the beginning and loop it continuously, muted, with the
skeleton overlay kept in sync per the existing overlay-sync requirement, exactly while all three of
the following hold: that clip's analysis is at `phase: 'ready'`, no background scale pass for it is
in flight (`'pending'` or `'running'`), and that clip is currently **presented** to the reader. The
three conditions SHALL be one declarative condition owning both arming and re-arming — no
presentation code, and no scale-pass code, SHALL arm or clear the loop imperatively.

When any of the three ceases to hold — the preview is dismissed, a new run starts, or a scale pass
begins — the system SHALL clear `loop` and leave the clip's playback stopped, so that a hidden clip
is never decoding.

While a clip's analysis is at `'sampling'` or `'processing'`, or its scale pass is `'pending'` or
`'running'`, presenting or dismissing that clip SHALL be **purely observational**: it SHALL NOT
start playback, stop playback, seek, arm or clear `loop`, or change `muted`. The analysis pipeline
owns the element's playback state for that whole window, and a presentation-driven write into it
would corrupt a run in progress — a looping element never fires the `ended` event sampling resolves
on, a seek rewinds the sampler, and a pause both stalls sampling and fails an in-flight scale pass.

The system SHALL clear the loop before starting a new analysis run, unconditionally and regardless
of presentation, so that run's sampling can detect the clip's natural end via the video's `ended`
event.

#### Scenario: Presenting a ready clip restarts and loops it

- **WHEN** a clip whose `phase` is `'ready'` with no scale pass in flight is presented
- **THEN** its video seeks to the start and begins playing with `loop` enabled, with no further
  action required from the reader

#### Scenario: Reaching the ready phase while not presented leaves the clip paused

- **WHEN** `phase` transitions to `'ready'` with no scale pass in flight and no preview of that clip
  is open
- **THEN** the clip's video does not begin playing and `loop` is not armed — it stays stopped until
  the clip is presented

#### Scenario: Dismissing a preview stops that clip's playback

- **WHEN** an open preview of a `'ready'` clip is dismissed
- **THEN** that clip's `loop` is cleared and its playback stops, leaving no hidden clip decoding

#### Scenario: The loop re-arms once the scale pass concludes on a presented clip

- **WHEN** a presented clip is `'ready'` and its scale pass transitions from `'pending'`/`'running'`
  to `'done'`, `'failed'`, or `'skipped'`
- **THEN** its video seeks to the start and begins playing with `loop` enabled, exactly as it does
  for a presented clip with no scale pass — the same condition owns both cases, with no scale-pass
  code re-arming the loop imperatively — while a clip that is not presented stays stopped

#### Scenario: The overlay stays in sync through the loop

- **WHEN** a presented clip's video is looping after its `phase` became `'ready'`
- **THEN** the skeleton overlay continues to redraw for the current playback position on every loop
  pass, the same as it does during any other playback (per the existing overlay-sync requirement) —
  including immediately after the loop seeks back to the start

#### Scenario: Looping does not block browser autoplay policy

- **WHEN** the loop-restart's `play()` call is issued outside the synchronous call stack of the
  interaction that presented the clip
- **THEN** the video is muted before that `play()` call, so the browser's autoplay policy does not
  block it

#### Scenario: Starting a new run clears the loop first

- **WHEN** a new analysis run begins for a clip whose video is still looping from a previous run
- **THEN** the video's loop behavior is cleared before that run begins playback for sampling, so the
  video reaches a genuine `ended` event at the end of the new sampling pass instead of looping
  through it — regardless of whether the clip is presented at the time

#### Scenario: Presenting a clip mid-analysis does not disturb the run

- **WHEN** a clip is presented, and then dismissed, while its analysis is `'sampling'` or
  `'processing'` or its scale pass is in flight
- **THEN** the run's playback state is untouched — no seek, no play, no pause, no change to `loop`
  or `muted` — and the run completes exactly as it would have with no preview opened

### Requirement: A clip preview presents that clip's own video with its skeleton overlay

The system SHALL let a reader open a preview of any clip in the session, showing that clip's video
with the pose skeleton overlay drawn over it, and SHALL present the clip's **already-mounted**
element rather than creating a second one. The preview SHALL be dismissible, SHALL trap focus while
open, SHALL be marked as a modal dialog to assistive technology, and SHALL return focus to the
control that opened it when dismissed. The overlay canvas SHALL remain hidden from assistive
technology, as it is today.

A preview SHALL be offered for a clip whose analysis has not produced frames yet — showing the video
with no overlay — rather than being withheld: a reader inspecting a clip mid-analysis is a reasonable
thing to do, and is made safe by the observational rule above.

#### Scenario: Opening a preview shows the clip's video and overlay

- **WHEN** the reader activates a clip's entry in the clip strip and that clip's analysis is
  `'ready'` with frames available
- **THEN** a modal preview opens showing that clip's video with the skeleton overlay drawn over it,
  in sync with playback and on seek while paused, per the existing overlay-sync requirement

#### Scenario: A preview opened before analysis finishes shows the video without an overlay

- **WHEN** the reader opens a preview of a clip whose analysis has not reached `'ready'`
- **THEN** the preview opens and shows that clip's video with no skeleton overlay, and the clip's
  in-flight run is unaffected

#### Scenario: The preview is keyboard-operable and returns focus

- **WHEN** a preview is open
- **THEN** it is marked as a modal dialog, focus is trapped inside it, pressing Escape dismisses it,
  and focus returns to the clip strip entry that opened it

### Requirement: Session status stays a single announced line while per-clip progress moves to the clips

The always-visible analysis status line (`role="status"`) SHALL continue to report the **session**'s
status — including the background scale pass's narration required by "The centimetre card reflects
scale-pass progress" — while the per-clip sampling/processing progress it used to render moves onto
each clip's own entry in the clip strip. Per-clip progress SHALL NOT be duplicated in the session
status line, and the session status line SHALL NOT be replaced by per-clip announcements.

At most one live region SHALL announce clip analysis progress for the whole session, so that a
session with several clips does not produce several live regions announcing over each other.

#### Scenario: The session line survives the move

- **WHEN** every clip in the session reaches `'ready'` and a background scale pass runs
- **THEN** the `role="status"` session line still reads that analysis is complete and still narrates
  the scale pass exactly as specified by "The centimetre card reflects scale-pass progress"

#### Scenario: Several clips do not produce several live regions

- **WHEN** a session holds more than one clip and they are in different analysis phases
- **THEN** each clip's own progress is available to assistive technology as text on that clip's
  entry, but no more than one live region announces clip progress
