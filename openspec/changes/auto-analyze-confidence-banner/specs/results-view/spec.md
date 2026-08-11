## REMOVED Requirements

### Requirement: Explicit analysis trigger
**Reason**: Analysis now starts automatically once a clip is ready and a detector is available —
the explicit-trigger-only behavior is reversed, not merely adjusted.
**Migration**: See the new "Automatic analysis start" requirement below.

## ADDED Requirements

### Requirement: Automatic analysis start
The system SHALL automatically start sampling a loaded clip once `videoSource.status` reaches
`'ready'` for that clip and a detector is available, without requiring an explicit user action.
The "Analyze"/"Analyze again" control SHALL remain available so the user can manually (re-)start
a run — for a clip whose auto-start didn't fire because no detector was available yet, or to
re-run analysis on the same clip.

#### Scenario: Analysis starts automatically once a clip becomes ready
- **WHEN** `videoSource.status` transitions to `'ready'` and a detector is available
- **THEN** `VideoAnalysisState.phase` transitions to `'sampling'` without any explicit `start()`
  call from the user

#### Scenario: Analysis does not auto-start without an available detector
- **WHEN** `videoSource.status` is `'ready'` but the detector is `null`
- **THEN** `phase` remains `'idle'` until the user manually activates "Analyze", which then
  surfaces the normal `detector-unavailable` error

#### Scenario: The Analyze control remains available to manually (re-)start a run
- **WHEN** `phase` is `'idle'`, `'ready'`, or `'error'`
- **THEN** activating the "Analyze"/"Analyze again" control calls `start()`

#### Scenario: The Analyze button is disabled while a run is already in progress
- **WHEN** `phase` is `'sampling'` or `'processing'`
- **THEN** the "Analyze" button is disabled

### Requirement: Low-confidence results banner
The system SHALL display a non-modal, non-blocking banner once `phase` is `'ready'` when at least
one computed metric (vertical oscillation, trunk lean, overstriding) is flagged as low-confidence
— its `value` is `null`, its `confidence` is below the metrics panel's low-confidence threshold,
or its `viewFit` is `'unsuitable'` — using the identical condition the metrics panel already uses
to visually flag that same metric's card. The system SHALL render nothing when no metric is
flagged.

#### Scenario: A flagged metric triggers the banner
- **WHEN** `phase` is `'ready'` and at least one metric meets the low-confidence condition
- **THEN** a banner is rendered naming the affected metric(s)

#### Scenario: No flagged metrics renders no banner
- **WHEN** `phase` is `'ready'` and every metric fails the low-confidence condition
- **THEN** no banner is rendered

#### Scenario: The banner's flagged condition matches the metrics panel's own
- **WHEN** a given metric's `value`/`confidence`/`viewFit` would visually flag its card in the
  metrics panel
- **THEN** that same metric is included among the banner's flagged metrics — the two are never
  inconsistent with each other
