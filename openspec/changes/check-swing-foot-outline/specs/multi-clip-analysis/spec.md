## ADDED Requirements

### Requirement: Outline passes run after every scale pass, one at a time, and hold the background lane

The session's background lane SHALL grant at most one background pass at a time, scale or outline.
Every due scale pass SHALL be granted before any outline pass; outline passes SHALL then be granted
in clip order. A clip leased the lane for its outline pass SHALL keep it only while no scale pass is
due. No primary pass SHALL start while an outline pass runs or holds the lease. The session's
aggregate state SHALL carry the outline pass's status.

#### Scenario: Three sequential clips, the third front-facing
- **WHEN** three clips sampled on the sequential path are analysed and only the third plans an outline pass
- **THEN** the order is primary 1, 2, 3, scale 1, 2, 3, then outline 3

#### Scenario: A clip added while an outline pass runs
- **WHEN** a clip is added while another clip's outline pass is running
- **THEN** the new clip's primary waits until that outline pass is terminal
