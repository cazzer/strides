## ADDED Requirements

### Requirement: Clips are presented as a strip in the application header, one entry per clip

The system SHALL present the session's clips as a strip in the application header, beside the
wordmark, with exactly one entry per clip session and no clip rendered as a full-height panel in the
page body. Each entry SHALL show that clip's poster frame, SHALL be an activatable control that
opens that clip's preview, and SHALL be reachable and operable by keyboard.

Entries SHALL appear in clip-session order — the same zero-based order the per-metric fusion source
index and the human-readable provenance copy (`"Combined from clip N of TOTAL"`) already number
clips by — so a reader can match a metric's stated source clip to a strip entry by counting. Clip
identity remains positional: this requirement adds no clip name, label, or user-assigned title.

The strip SHALL remain usable when the session holds more clips than fit the header's width, by
scrolling within its own bounds rather than by wrapping the header onto additional lines or
overflowing the page.

Any layout offset derived from the header's height — sticky positioning, height caps on scrolling
regions — SHALL track the header's actually-rendered height, including the difference between a
header with a clip strip and one without, rather than a hardcoded pixel constant.

#### Scenario: One entry per clip, in fusion order

- **WHEN** a session holds two clips and a fused metric's provenance names clip 2 of 2
- **THEN** the strip renders exactly two entries, and the second entry is the clip that metric's
  evidence and provenance refer to

#### Scenario: Clips do not occupy the page body

- **WHEN** at least one clip has loaded
- **THEN** no clip is rendered as a panel in the page body, and the analysis results are the page's
  main content rather than one column of a two-column split

#### Scenario: A strip entry opens that clip's preview

- **WHEN** the reader activates a strip entry, by pointer or by keyboard
- **THEN** that clip's preview opens

#### Scenario: A crowded strip scrolls rather than reflowing the header

- **WHEN** the session holds more clips than fit the available header width
- **THEN** the strip scrolls within its own bounds and the header keeps its single-row layout

#### Scenario: Layout offsets follow the header's real height

- **WHEN** the header's height changes because the clip strip appears, disappears, or changes size
- **THEN** every layout offset derived from the header height follows it, with no stale gap or
  overlap at any viewport width

### Requirement: Each clip's progress is rendered from that clip's own analysis state

The system SHALL render each clip's processing progress on that clip's own strip entry, sourced from
that clip's own `VideoAnalysisState` — its `phase` and `progress` — never from the aggregate state
derived across clips. No new analysis state machine SHALL be introduced for this: the per-clip state
already exists, one instance per clip.

The entry SHALL visually distinguish, by more than color alone, these conditions:

- **sampling** — this clip is actively being analysed, with its own `progress` reflected;
- **processing** — sampling finished, results are being computed;
- **ready** — this clip's analysis is complete;
- **error** — this clip's analysis failed;
- **queued** — this clip's video is loaded and idle only because another clip currently holds the
  shared detector (see "Serialized shared-detector access across concurrently mounted clips"), which
  is a derived condition rather than a `phase` value and SHALL read differently from a clip that is
  actively sampling.

Each entry's condition SHALL be available to assistive technology as text, never conveyed by the
progress graphic alone.

#### Scenario: Two clips show their own progress, not a shared average

- **WHEN** one clip is `'sampling'` at 40% and another is `'ready'`
- **THEN** the first entry reflects 40% and the second reads as complete — neither shows the
  aggregate's mean progress, and the two do not move in lockstep

#### Scenario: A queued clip is distinguishable from a sampling one

- **WHEN** a clip's video is loaded, its `phase` is `'idle'`, and another clip holds the shared
  detector
- **THEN** its entry reads as waiting for its turn, visibly and textually distinct from the entry of
  the clip that is actively sampling

#### Scenario: A failed clip is visible in the strip

- **WHEN** one clip's `phase` is `'error'`
- **THEN** that clip's entry reads as failed, distinguishably from every other condition and by more
  than color alone

#### Scenario: Progress is text, not only a graphic

- **WHEN** any clip is mid-analysis
- **THEN** its entry exposes its condition and progress to assistive technology as text

### Requirement: Every source a reader supplies becomes its own clip session

The system SHALL create one clip session per video source the reader supplies, whether supplied one
at a time or several at once: selecting N files in a single file-picker interaction SHALL create N
clip sessions, and completing a webcam recording SHALL create one. A clip added this way SHALL enter
the session exactly as a clip added by any other path — same video source contract, same per-clip
analysis lifecycle, same position in the strip and in fusion order.

#### Scenario: A multi-file selection creates one clip each

- **WHEN** the reader selects three files in one file-picker interaction
- **THEN** three clip sessions are created, in selection order, each analysed independently under
  the existing shared-detector serialization

#### Scenario: A recorded clip joins the session like an uploaded one

- **WHEN** the reader records a clip after the session already holds one
- **THEN** the recording becomes an additional clip session, indistinguishable downstream from an
  uploaded one
