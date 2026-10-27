## ADDED Requirements

### Requirement: An opened side row's still runner shows its headline's evidence image

In the wide layout, when the row the camera follows is landing or knees, the summary SHALL pass the
runner the row's headline metric's evidence image from that metric's winning clip
(`sourceIndices`) as footage, under the same conditions as the tour's side stops (a plate metric, a
side-view winning clip, a known travel direction, a hip and a knee or ankle, a resolvable measured
side), so a still runner shows it faintly behind the figure. The summary's card keeps its own
evidence canvas; the runner copies the pixels. In the narrow layout, where the camera stays on the
whole figure with no focus, there SHALL be no footage.

#### Scenario: Knees opened and paused, wide
- **WHEN** the reader, in the wide layout, opens Knees over a side clip and pauses the runner
- **THEN** the runner is handed the knee-flexion evidence image from that metric's winning clip, the plate shows, and the card's own evidence canvas stays in the card

#### Scenario: A row opened on a phone
- **WHEN** the reader, in the narrow layout, opens Knees
- **THEN** the runner is handed no footage
