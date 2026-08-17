# results-view (delta)

## ADDED Requirements

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
never the visible element, which is loop-playing once analysis is ready. It SHALL hold at most one
detached decoder open at a time, extracting every instant for one clip in a single pass before moving
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

- **WHEN** an analysis run reaches `phase: 'ready'` and the visible video begins looping
- **THEN** evidence extraction runs against a separate detached element created from the clip's
  source blob, the visible element's playback state is untouched, and analysis wall-clock time is
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

### Requirement: An evidence gallery renders below the results, grouped by metric

The system SHALL present extracted evidence in a dedicated gallery rendered **below** the metric
cards, spanning the full width of the results layout rather than nested inside either column, so that
imagery is not confined to half the page width inside a scrolling container.

The gallery SHALL group images by metric and caption each one well enough to be interpretable on its
own: which metric it is evidence for, which side where the metric is per-side, and — for a blended
image — that the two visible positions are the **same runner at two instants**, never two people.
Images SHALL carry alt text describing what the exemplar shows.

A ghosted image SHALL be a photographic opacity blend only. The system SHALL NOT draw a skeleton,
angle arc, reference line, or any other annotation over an extracted image, and SHALL NOT overlay any
reference or ideal posture — the only delta shown is the runner against themself.

The gallery SHALL be usable at narrow viewport widths, not only at wide ones, and SHALL drive
extraction at most once per clip, releasing the detached element and any retained images when it
unmounts or the session resets.

#### Scenario: A ghosted image shows one runner at two instants

- **WHEN** a metric's evidence is a blended pair
- **THEN** the rendered image is a photographic blend of the two frames with no drawn annotation of
  any kind, and its caption states that both positions are the same runner at two moments

#### Scenario: The gallery reads as one set

- **WHEN** several metrics produce evidence with different crop regions
- **THEN** every rendered image shares the same aspect ratio

#### Scenario: Nothing is retained after the gallery goes away

- **WHEN** the gallery unmounts or the session is reset
- **THEN** no detached video element, object URL, or extracted image is retained

### Requirement: Metric cards deep-link to their evidence, and are otherwise unchanged

A metric card whose metric has evidence SHALL gain a link that moves the reader to that metric's
section of the evidence gallery, reachable by keyboard. A metric card whose metric has no evidence
SHALL render exactly as it does today — no link, no placeholder, no empty frame, and no layout shift
relative to a build without this capability.

Evidence SHALL be offered only for metrics that render as a card. A metric excluded from the card
grid — because nothing was measured, or because the camera geometry cannot support the measurement —
SHALL have no gallery section and no link: there is no card to link from, and imagery for a
measurement the system declined to report would be a picture explaining a number that is not on
screen.

#### Scenario: A card without evidence is byte-for-byte today's card

- **WHEN** a metric renders as a card but has no evidence
- **THEN** the card renders with no evidence link and no placeholder, identically to a build without
  this capability

#### Scenario: An excluded metric gets no evidence

- **WHEN** a metric is excluded from the card grid because its value is null or its view fit is
  unsuitable
- **THEN** no gallery section and no link are rendered for it, whatever exemplars it may carry

### Requirement: Evidence never enters the analysis diagnostics payload

The development-only analysis diagnostics payload SHALL remain free of exemplar data, extracted
images, canvases, and blob URLs. That payload is serialized to the console and parsed by the
live-verification harness, so its shape is a contract; adding a metric's exemplars to it — even as
timestamps or counts — would change that shape for every run.

Any development-time reporting of evidence coverage SHALL therefore use its own separately-prefixed
console output rather than widening the existing diagnostics payload.

#### Scenario: The diagnostics payload is unchanged by exemplars

- **WHEN** a run's metrics emit exemplars
- **THEN** the serialized analysis diagnostics payload is identical to what the same run would emit
  with no exemplars, and contains no image data, canvas, or blob URL
