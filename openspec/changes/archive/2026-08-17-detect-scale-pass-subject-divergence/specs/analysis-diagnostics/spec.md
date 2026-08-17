# analysis-diagnostics (delta)

## MODIFIED Requirements

### Requirement: Scale-pass diagnostics export under a distinct prefix

The system SHALL log, in development builds only (`import.meta.env.DEV`), a second console line
prefixed `[analysis-diagnostics:scale-pass]` exactly once per background scale pass reaching a
terminal status (`'done'`, `'failed'`, or `'skipped'`), carrying a JSON payload of the pass's
`status`, its skip `reason` (`'disabled'` or `'primary-scale'`, present only when skipped), its
`error` message (present only when failed), its `subjectAgreement` verdict (present only when the
subject-agreement check ran, i.e. on `'done'`), and — on `'done'` only — the scale pass's own full
`AnalysisDiagnostics` object (whose `scaleCalibration` block is the grafted metric's
`calibration` by reference). The `subjectAgreement` payload SHALL carry the verdict's `status`,
typed `reason`, and both instant counts, so the *margin* behind an `'agreed'`/`'diverged'` verdict
is readable on every development run rather than only the boolean outcome. The existing
`[analysis-diagnostics]` line SHALL remain unchanged in trigger, prefix, and payload shape: it
reports the PRIMARY pass only, and its `scaleCalibration` key's presence reflects whether the
PRIMARY backend measured a real-world scale — never the scale pass's measurement. Neither line
SHALL be emitted in a production build.

#### Scenario: A completed scale pass logs its own diagnostics under the distinct prefix

- **WHEN** the scale pass reaches `'done'` in a development build
- **THEN** the console receives one `[analysis-diagnostics:scale-pass]` message whose JSON
  payload has `status: 'done'` and the scale pass's full diagnostics, including a
  `scaleCalibration` block

#### Scenario: A skipped or failed pass logs its status and cause, without diagnostics

- **WHEN** the scale pass reaches `'skipped'` (with reason `'disabled'` or `'primary-scale'`) or
  `'failed'` (with an error message) in a development build
- **THEN** the console receives one `[analysis-diagnostics:scale-pass]` message carrying that
  status and its `reason` or `error`, with no `diagnostics` key

#### Scenario: The primary diagnostics line is unaffected by the scale pass

- **WHEN** a run's primary pass reaches `'ready'` and its background scale pass subsequently
  completes with a measured scale
- **THEN** exactly one `[analysis-diagnostics]` line was emitted for the run, at the same moment
  and with the same payload it would have had without any scale pass — in particular, with no
  `scaleCalibration` key when the primary backend measured none

#### Scenario: Nothing scale-pass-related is logged in a production build

- **WHEN** a scale pass reaches any terminal status and `import.meta.env.DEV` is `false`
- **THEN** no `[analysis-diagnostics:scale-pass]` console output occurs

#### Scenario: The subject-agreement verdict rides on the completed pass's line

- **WHEN** the scale pass reaches `'done'` in a development build and the subject-agreement check
  produced a verdict
- **THEN** the same `[analysis-diagnostics:scale-pass]` message carries a `subjectAgreement` key
  with the verdict's `status`, `reason`, `comparedInstants` and `agreeingInstants` — including
  when the verdict is `'no-opinion'`, so a permanently-no-opinion configuration is visible rather
  than silent
