## ADDED Requirements

### Requirement: The arms stop says its value is up-and-down wrist travel

The arms stop's value label SHALL read "Arm swing (wrist up-and-down)", so the reader knows the
value is the wrist's vertical travel and not the arm's fore-and-aft sweep. The label SHALL be
excluded from the stop's word budget, like the value line it names.

#### Scenario: The arms stop

- **WHEN** the tour reaches the arms stop with arm swing measured
- **THEN** the small label above its value reads "Arm swing (wrist up-and-down)"
