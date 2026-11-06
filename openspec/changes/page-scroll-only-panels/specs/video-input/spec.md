## MODIFIED Requirements

### Requirement: The picker owns the empty state and collapses into a persistent add-a-clip action

The system SHALL present the full video picker — record, upload, and the demo clips — as the page's
main content while the session holds no loaded clip. Once at least one clip is loaded, that
full-page picker SHALL collapse into a single persistent action in the application header that
offers the **same** input paths: recording with the webcam and uploading a file, not upload alone.
Both presentations SHALL drive the same unified video source contract, so a clip added later is
indistinguishable downstream from the first.

The action SHALL be keyboard reachable and carry an accessible name stating what it does. No
add-a-clip affordance SHALL remain in the page body.

The panel the action opens SHALL NOT have a height cap or a scroll area of its own. While it is
open the header SHALL NOT be sticky, so the page scrolls past a picker of any height, and opening it
SHALL bring the action into view; the header SHALL stick again once the panel closes.

#### Scenario: An empty session shows the full picker

- **WHEN** the session holds no loaded clip
- **THEN** the record/upload picker and the demo clips are presented as the page's main content

#### Scenario: The picker collapses once a clip exists

- **WHEN** the first clip finishes loading
- **THEN** the full-page picker is no longer the page's main content, the results take that place,
  and a single add-a-clip action is available in the header

#### Scenario: The header action offers recording as well as upload

- **WHEN** the reader activates the header's add-a-clip action
- **THEN** both the webcam-recording path and the file-upload path are available from it — closing
  the gap left by an upload-only in-body affordance, which offered no way to record or to add a demo
  clip after the first clip existed

#### Scenario: The action is labeled and keyboard reachable

- **WHEN** the reader navigates the header by keyboard
- **THEN** the add-a-clip action can be reached and activated, and exposes an accessible name saying
  it adds a clip

#### Scenario: A tall picker is read by scrolling the page

- **WHEN** the reader opens the add-a-clip panel at 390 px wide, part-way down the results
- **THEN** the action is on screen, the panel has no scroll of its own, the header is not sticky,
  and scrolling the page brings the panel's end on screen
