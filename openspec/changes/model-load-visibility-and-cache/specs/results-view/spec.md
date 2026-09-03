## ADDED Requirements

### Requirement: A model download is presented at the head of the header bar

The system SHALL present a model-download entry at the head of the application header's bar whenever
a model asset download is in flight, **including when the session holds zero clips** — the state in
which the clip strip does not render at all, and the state a first-time visitor is in for the whole
of the primary detector's download.

The entry SHALL be rendered **outside the clip list element**, as a preceding sibling of it rather
than a member of it. "Clips are presented as a strip in the application header, one entry per clip"
(multi-clip-analysis) requires exactly one entry per clip session, in clip-session order, so that a
reader can match `"Combined from clip N of TOTAL"` to a strip entry by counting; a non-clip entry
inside that list would break the count and would also put a non-clip in a list labelled *Clips*.
Clip numbering SHALL be unchanged.

The entry SHALL show determinate progress only where a byte total is actually known, and an
indeterminate indication otherwise. It SHALL NOT display a percentage it did not measure.

The entry SHALL disappear once the downloads it reports are complete. On failure it SHALL show a
caption that says the download failed, rather than remaining at a loading caption indefinitely;
whether a retry is offered SHALL be an explicit decision recorded in the change's design, not an
omission.

The entry SHALL NOT introduce a second live region. "Session status stays a single announced line
while per-clip progress moves to the clips" permits at most one live region announcing clip analysis
progress for the whole session, and that budget is not reopened by this entry.

The entry SHALL NOT conceal or displace any clip's `<video>` element out of the strip's visible
bounds at any viewport width. Concealment is measured to cost roughly a fifth of the sampled frames
on the playback path, at any size and by any mechanism, and a concealed element still measures
healthy through layout APIs — so this constraint SHALL be verified by driving a real browser, not by
a unit test.

#### Scenario: The entry renders with no clips loaded

- **WHEN** a reader opens the page for the first time and the primary detector's model download is
  in flight, before any clip exists
- **THEN** a model-download entry is presented at the head of the header bar

#### Scenario: The entry is not a clip and does not renumber clips

- **WHEN** the model-download entry is presented alongside a session holding two clips
- **THEN** the clip list still holds exactly two entries, and a metric whose provenance reads
  `"Combined from clip 2 of 2"` still matches the second entry of that list by counting

#### Scenario: Unknown totals show an indeterminate indication

- **WHEN** a download in flight has no known byte total
- **THEN** the entry indicates that work is in progress without stating a percentage or a byte count

#### Scenario: The entry leaves on success and stays to report a failure

- **WHEN** every model download completes
- **THEN** the entry is no longer presented

#### Scenario: A failed download is reported as a failure

- **WHEN** a model download fails
- **THEN** the entry reads as a failure rather than as work still in progress

#### Scenario: No second live region appears

- **WHEN** the model-download entry is presented while a clip is being analysed
- **THEN** no more than one live region announces progress for the session

#### Scenario: The leading entry does not push a clip's video out of view

- **WHEN** the model-download entry is presented at a narrow viewport while a clip is being analysed
- **THEN** that clip's `<video>` element remains within the horizontally-scrolling strip's visible
  bounds
