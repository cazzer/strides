## ADDED Requirements

### Requirement: A runner connects storage they own, with no Strides server

The app SHALL save assessments only to a storage provider the runner connects, reached directly
from the browser. The first provider SHALL be Google Drive, authorised through the Google Identity
Services token client with only the `https://www.googleapis.com/auth/drive.file` scope. The access
token SHALL be held in memory only. The Google script SHALL NOT be requested until the runner has
chosen to connect, either in this visit or a previous one. Providers SHALL sit behind one adapter
interface so the save and progress logic does not depend on which provider is connected.

#### Scenario: First connect

- **WHEN** a runner who has never connected taps Connect Google Drive
- **THEN** the Google script loads, a Continue to Google action appears, and tapping it opens the
  Google consent popup from within that tap

#### Scenario: No client ID in the build

- **WHEN** the build has no `VITE_GOOGLE_CLIENT_ID`
- **THEN** the save panel says saving is not set up on this build, and no request to Google is made

#### Scenario: Never chose to connect

- **WHEN** a runner analyses a clip and never touches the save panel
- **THEN** no request is made to any storage provider

### Requirement: Saving is explicit and only after the session has finished

The app SHALL write nothing to a provider until the runner presses Save. Save SHALL be available
only once the session's analysis is complete and every clip's background scale pass and outline
pass has reached a terminal status; until then it SHALL be disabled with a reason. Source clips
SHALL be included only when the runner ticks the footage option, which SHALL be unticked by default
and SHALL show the total size.

#### Scenario: Background checks still running

- **WHEN** "Analysis complete" is shown but a clip's scale pass is still running
- **THEN** Save is disabled and reads that background checks are finishing

#### Scenario: Save without footage

- **WHEN** the runner presses Save without ticking the footage option
- **THEN** the assessment folder holds the analysis file and the footage manifest and no clip bytes

### Requirement: Each assessment is one folder with a stamped analysis file, a manifest and an index entry

Each save SHALL create one folder inside a `Strides` root folder, containing an analysis file named
`analysis-m<methodologyVersion>-<YYYY-MM-DD>.json`, a `footage-manifest.json`, and the ticked clips
named `clip-<n>.<ext>`. The root SHALL hold `strides-index.json` listing every assessment with a
per-metric summary. The analysis file SHALL be written after the manifest and clips, and the index
last. The app SHALL find its files by provider properties, not by name.

#### Scenario: A complete save

- **WHEN** a two-clip assessment is saved with footage on 2026-11-05 under methodology 1
- **THEN** its folder contains `analysis-m1-2026-11-05.json`, `footage-manifest.json`, `clip-1.<ext>`
  and `clip-2.<ext>`, and the index gains one entry for it

#### Scenario: Original file names are not used for uploaded clips

- **WHEN** a clip named after a person is saved with footage
- **THEN** the uploaded file is named `clip-<n>.<ext>` and the original name appears only inside the
  manifest

#### Scenario: A clip upload fails

- **WHEN** a clip upload fails mid-save
- **THEN** no analysis file is written for that assessment, the index is not updated, and the
  runner sees the failure with a retry

### Requirement: Every analysis file records methodology, definitions and how the analysis ran

The analysis file SHALL record a file schema version, the assessment id, the save time and local
date, the methodology version, every metric's definition version, the build commit, the resolved
pose-backend and sampling configuration, each clip's view, sampling path and background-pass
statuses, the session view, and for all thirteen metrics the value, unit, confidence, tier, view
fit, caveat, sample size, frame coverage, interpolated fraction, source clip and definition version.
It SHALL NOT include exemplars, timeseries, pose frames or images.

#### Scenario: An excluded metric is still recorded

- **WHEN** a side-only session leaves step width unmeasured
- **THEN** the analysis file records `stepWidth` with a null value and tier `excluded`

### Requirement: Methodology versions are tied to per-metric definition versions by a frozen history

The app SHALL define a per-metric definition version, an app-wide methodology version, and an
append-only methodology history whose last entry equals the current versions. Versions SHALL start
at 1. A metric's definition version SHALL be bumped when a change moves that metric's readings, and
any such bump SHALL append a methodology history entry with a higher methodology version.

#### Scenario: A metric bump without a history entry

- **WHEN** a metric's definition version is raised and no history entry is appended
- **THEN** the methodology test fails

### Requirement: The index can be rebuilt from the assessment folders

When the index is missing or fails validation, or the runner asks, the app SHALL rebuild it by
listing assessment folders and reading each analysis file, ignoring folders with no analysis file.

#### Scenario: Index deleted in Drive

- **WHEN** the runner opens Progress after deleting `strides-index.json`
- **THEN** the index is rebuilt from the assessment folders and every complete assessment is listed

### Requirement: Disconnect revokes access and says what stays

Disconnect SHALL revoke the provider token, forget it, and clear the locally remembered provider
record. The copy SHALL say saved files stay in the runner's storage.

#### Scenario: Disconnect

- **WHEN** the runner taps Disconnect
- **THEN** the token is revoked, `strides.storage` is cleared, and Progress is no longer offered
