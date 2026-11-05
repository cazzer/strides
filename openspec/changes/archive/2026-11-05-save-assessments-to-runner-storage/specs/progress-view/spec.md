## ADDED Requirements

### Requirement: The progress view lists saved assessments and charts each metric, from the runner's storage only

The app SHALL offer a progress page, reachable from the header and from `?page=progress`, that
reads only the connected provider's index and lists every saved assessment's date, views and clip
count, then shows one chart per metric with at least one measured reading, each with its unit. The
page SHALL switch only the main content: the clip session and its video elements SHALL stay
mounted, and Back SHALL return to the results with the analysis intact.

#### Scenario: Three saved assessments

- **WHEN** the runner opens Progress with three saved assessments
- **THEN** three dates are listed and each measured metric shows a chart with up to three readings

#### Scenario: Back to the results

- **WHEN** the runner opens Progress from a finished session and presses Back
- **THEN** the results view returns with the same analysis, without re-analysing

### Requirement: Readings under different definition versions are never joined

A metric's readings SHALL be grouped into runs of equal definition version. Runs SHALL be drawn as
separate series with a labelled break between them saying the definition changed and earlier
readings are not comparable. A definition version newer than the running build knows SHALL be shown
as saved by a newer Strides and not plotted.

#### Scenario: Cadence redefined between assessments

- **WHEN** two cadence readings are at definition 1 and a third at definition 2
- **THEN** the chart draws the first two as one run, a labelled break, and the third as its own run

### Requirement: The progress view makes no verdicts and plots no unmeasured values

The progress view SHALL NOT label any change as better or worse, draw trend lines, or colour by
direction. Excluded readings SHALL be listed as not measured and SHALL NOT be plotted. Caveated
readings SHALL be marked distinctly from normal ones. Every chart SHALL have a table of the same
numbers as its text alternative.

#### Scenario: A metric not measured in one assessment

- **WHEN** step width was excluded in the second of three assessments
- **THEN** its chart plots two readings and lists the second assessment as not measured

### Requirement: The progress view reports its states plainly

The progress view SHALL show distinct states for not connected, loading, no saved assessments, an
index rebuilt or repaired, entries skipped as unreadable (with a count), and a provider error with
retry.

#### Scenario: Not connected

- **WHEN** the runner opens `?page=progress` with no provider connected
- **THEN** the page offers to connect and shows no chart
