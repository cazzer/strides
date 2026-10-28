## MODIFIED Requirements

### Requirement: A summary row names its area, headline value and band position

Each collapsed row SHALL name its focus area, the headline metric with its value and, where the
headline is banded, where that value sits, naming the range itself. A banded headline SHALL also
carry a compact band marker, which SHALL be decorative (hidden from assistive technology). The
summary SHALL state once, above the rows and only when some row shows a marker, that the bars are
where other runners measured and not a target.

The row's headline SHALL be the headline of the area's first reading (runner-feedback's composite
readings). The row's "Also:" line SHALL name each later reading once: a single metric by its full
name, and a composite reading once, by its headline metric's full name ("Vertical ratio"), never
by each of its members.

#### Scenario: A banded headline

- **WHEN** an area's headline metric has a cited band
- **THEN** its row names the area, the metric, the value and its position against the named range,
  and shows a decorative marker

#### Scenario: An unbanded headline

- **WHEN** an area's headline metric has no cited band
- **THEN** its row names the area and the value, and shows no marker

#### Scenario: The rhythm row's other readings

- **WHEN** cadence and all three bounce metrics are measured
- **THEN** the rhythm row is headlined by cadence and its "Also:" line reads "Also: Vertical ratio"

### Requirement: Every measured metric is reachable from exactly one summary row

Every measured metric SHALL appear in exactly one area row, as its full guided card: band,
citation, methodology disclosure and inline evidence. An area SHALL get a row only when at least
one of its metrics is measured.

A composite reading SHALL render as one labelled group: its headline metric's full card, with the
reading's "From …" derivation line directly under the card's headline value when it has one, in a
muted style distinct from the description, then its other measured members' full cards inside ONE
nested disclosure, collapsed by default, in the card disclosure's own idiom, whose summary names
what the members are ("Same bounce in cm and % of torso length", or the one unit present) and is at
least 44 px tall. Collapsed, the member cards SHALL stay
mounted, so their evidence canvases keep their one parent, and a fragment link to a member card
SHALL open both disclosures.

#### Scenario: Opening a row

- **WHEN** the reader opens a row
- **THEN** the area's measured metrics render as their guided cards, headline first

#### Scenario: An area with nothing measured

- **WHEN** every metric in an area is excluded
- **THEN** that area has no row

#### Scenario: Opening the rhythm row

- **WHEN** the reader opens the rhythm row with cadence and all three bounce metrics measured
- **THEN** the cadence card shows, then the vertical ratio card with its band, its "From hip
  bounce …" line and its evidence, then one collapsed "Same bounce in cm and % of torso length"
  disclosure holding the two vertical oscillation cards
