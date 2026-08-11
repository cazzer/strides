## MODIFIED Requirements

### Requirement: Quality warning banner
The system SHALL provide a `QualityWarningBanner` that renders nothing while the gate's `status`
is not `'ready'` (except a lightweight in-progress notice while `'assessing'`), renders nothing
when the assessment's `overall` is `'pass'`, renders nothing once `dismissed` is `true`, and
otherwise renders a modal dialog — with a backdrop that visually dims the rest of the screen and
blocks interaction with it — listing every failed check's message alongside a control that calls
`proceedAnyway()`.

#### Scenario: Assessing state shows a non-alarming status notice
- **WHEN** `status === 'assessing'`
- **THEN** the banner renders a `role="status"` element indicating a quality check is in progress,
  with no failed-check content, and no backdrop/modal is shown

#### Scenario: Passing assessment renders nothing
- **WHEN** `status === 'ready'` and `assessment.overall === 'pass'`
- **THEN** the banner renders nothing, and no backdrop is shown

#### Scenario: Warning assessment renders an alert listing failed checks
- **WHEN** `status === 'ready'`, `assessment.overall === 'warn'`, and `dismissed === false`
- **THEN** the banner renders a modal dialog (`role="alertdialog"`, `aria-modal="true"`) over a
  backdrop that dims the rest of the screen, listing the `message` of every check with `status:
  'fail'` (skipping any check without a message) and a "Proceed anyway" control

#### Scenario: Opening the warning moves focus into the dialog
- **WHEN** the modal warning first renders
- **THEN** keyboard focus moves into the dialog (e.g. to its first focusable control), rather than
  remaining on whatever element held focus before the dialog appeared

#### Scenario: Dismissed warning renders nothing
- **WHEN** `dismissed === true`
- **THEN** the banner renders nothing — no dialog and no backdrop — regardless of
  `assessment.overall`

#### Scenario: Proceeding anyway invokes the callback
- **WHEN** the user activates the "Proceed anyway" control
- **THEN** the banner calls the `proceedAnyway` callback passed in via props
