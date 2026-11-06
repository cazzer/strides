## MODIFIED Requirements

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

Any layout offset derived from the header's height — sticky positioning, scroll margins — SHALL
track the height the header actually occupies while stuck, including the difference between a
header with a clip strip and one without, rather than a hardcoded pixel constant; while the header
is not sticky (the add-a-clip panel is open) that height is 0.

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

- **WHEN** the header's height changes because the clip strip appears, disappears, or changes size,
  or the header stops or starts sticking as the add-a-clip panel opens or closes
- **THEN** every layout offset derived from the header height follows it, with no stale gap or
  overlap at any viewport width
