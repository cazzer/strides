## ADDED Requirements

### Requirement: The summary shows the model runner beside one row per measured focus area

The results summary SHALL render one running model runner beside one row per measured focus area,
in focus-area order. At wide layouts the runner SHALL stay in view (sticky) beside the rows; at
narrow layouts it SHALL sit in flow above the rows. The runner SHALL never be a background behind
the rows. Exactly one runner SHALL be mounted for the life of the summary.

#### Scenario: Wide layout

- **WHEN** the summary renders at a desktop width
- **THEN** the runner sits in a column beside the rows and stays in view while the rows scroll

#### Scenario: Narrow layout

- **WHEN** the summary renders at a phone width
- **THEN** the runner sits above the rows, in flow, and no row is drawn over it

### Requirement: A summary row names its area, headline value and band position

Each collapsed row SHALL name its focus area, the headline metric with its value and, where the
headline is banded, where that value sits, naming the range itself. A banded headline SHALL also
carry a compact band marker, which SHALL be decorative (hidden from assistive technology). The
summary SHALL state once, above the rows and only when some row shows a marker, that the bars are
where other runners measured and not a target.

#### Scenario: A banded headline

- **WHEN** an area's headline metric has a cited band
- **THEN** its row names the area, the metric, the value and its position against the named range,
  and shows a decorative marker

#### Scenario: An unbanded headline

- **WHEN** an area's headline metric has no cited band
- **THEN** its row names the area and the value, and shows no marker

### Requirement: Every measured metric is reachable from exactly one summary row

Every measured metric SHALL appear in exactly one area row, as its full guided card: band,
citation, methodology disclosure and inline evidence. An area SHALL get a row only when at least
one of its metrics is measured.

#### Scenario: Opening a row

- **WHEN** the reader opens a row
- **THEN** the area's measured metrics render as their guided cards, headline first

#### Scenario: An area with nothing measured

- **WHEN** every metric in an area is excluded
- **THEN** that area has no row

### Requirement: Opening a summary row points the runner's camera at that area

In the wide layout, opening a focus-area row SHALL point the runner's camera at that area and focus
it on the area's metrics. The most recently opened row SHALL set the camera; closing that row SHALL
return the camera to the whole figure. A disclosure inside a card SHALL NOT move the camera. Where
the area plays slowed, the summary SHALL say so on screen. In the narrow layout, where the runner
sits above the rows and out of view, the camera SHALL stay on the whole figure at full speed
whatever row opens. Opening a row SHALL NOT close another in either layout.

#### Scenario: Two rows opened in turn

- **WHEN** the reader, in the wide layout, opens Posture and then Landing
- **THEN** the camera frames the foot, the figure plays slowed with a visible "Slow motion" note,
  and Posture stays open

#### Scenario: A row opens on a phone

- **WHEN** the reader, in the narrow layout, opens Landing
- **THEN** the camera stays on the whole figure at full speed and no "Slow motion" note shows

#### Scenario: Closing the active row

- **WHEN** the reader closes the row the camera is pointed at
- **THEN** the camera returns to the whole figure from the side

### Requirement: Unmeasured metrics sit in one final collapsed Not measured row

Every excluded metric SHALL appear in one final row, collapsed by default, whose summary names
each of them and whose content gives the same not-measured reason and capture hint the guided view
gives. Opening it SHALL NOT move the camera.

#### Scenario: Some metrics not measured

- **WHEN** an analysis excludes two metrics
- **THEN** the last row reads "Not measured" with both names, and opening it lists why and how to
  measure each

### Requirement: A card fragment link opens its summary row

Navigating to a card's fragment SHALL open the row holding it. A hash change SHALL also move focus
to the card; a fragment present when the summary mounts SHALL open and scroll to the row without
moving focus.

#### Scenario: The address changes to a card

- **WHEN** the address changes to the overstriding card's fragment
- **THEN** the Landing row opens and focus moves to the card

### Requirement: Replay tour and Classic table sit in the summary's footer

The summary SHALL offer a Replay tour control and a Classic table control in a footer below the
rows, never at the top, each a native button with a 44 px touch target.

#### Scenario: The footer controls

- **WHEN** the summary renders
- **THEN** Replay tour and Classic table are buttons in its footer, and the summary's heading is its
  entry point
