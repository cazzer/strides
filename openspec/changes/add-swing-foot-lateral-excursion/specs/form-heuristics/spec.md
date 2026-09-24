## ADDED Requirements

### Requirement: Swing-foot lateral excursion measures a complete swing's sideways ankle path relative to the knee

The system SHALL expose `swingFootLateralExcursion` as a `MetricId` and a
`FormHeuristicsResult` member, in `percent` units. A complete approximate swing SHALL be bounded
by an opposite-foot detected strike and the measured foot's next detected strike. The terminal
third of that detected strike interval SHALL be excluded because detected contact can lag visible
landing; only earlier interior frames SHALL contribute, and the result SHALL be described as
early-to-mid-swing excursion. The per-frame signal SHALL be the signed horizontal ankle offset from
the same-side knee, divided by the same frame's positive bilateral hip width. Any frame with an
interpolated contributing point SHALL be excluded from the extreme-quantile population, and a
frame's hip width SHALL clear both a half-median-width and a one-tenth-torso-length stability
floor. Each usable swing
SHALL contribute its 80th-minus-20th percentile range, and the result SHALL be the median across
usable swings. The result SHALL make no inward/outward or heel-rotation claim.

#### Scenario: A foot moves sideways during swing

- **WHEN** a front or rear clip contains complete alternating strikes and a resolvable sideways ankle path during each swing
- **THEN** the result reports the median swing range as a fraction of hip width, with `viewFit: primary`

#### Scenario: A static ankle offset is distinct from swing travel

- **WHEN** the ankle remains at a fixed horizontal offset from its knee through every usable swing
- **THEN** the result is zero, regardless of that fixed offset's sign or magnitude

#### Scenario: Swing excursion is distinct from footstrike step width

- **WHEN** ankle positions change only in retained swing interiors while footstrike poses stay fixed
- **THEN** swing-foot lateral excursion changes while `stepWidth` remains fixed
- **AND WHEN** ankle positions change only at detected footstrikes while retained swing poses stay fixed
- **THEN** `stepWidth` changes while swing-foot lateral excursion remains fixed

#### Scenario: A detected strike trails visible landing

- **WHEN** the ankle remains fixed during the retained early-to-mid swing but moves sharply sideways in the terminal third of the detected strike interval after landing
- **THEN** the late movement does not affect the reported range or its evidence endpoints

### Requirement: Incomplete or unobservable swings do not produce a number

The system SHALL discard a window with fewer than six directly detected retained samples or
less than 70% direct frame coverage, and SHALL return `value: null`, `confidence: 0` when no usable complete
window remains. One or two usable windows SHALL be reported with reduced confidence and a
thin-sample caveat. Frame coverage SHALL count accepted direct samples over all complete
candidate-window retained frames, including rejected candidates in the denominator. The system
SHALL require a trustworthy fitted step rhythm and SHALL reject an opposite-foot strike interval
that is not shorter than the shortest plausible full stride derived from that rhythm. Side and
ambiguous views SHALL be unsuitable; the result SHALL be computed
where possible and flagged, following the existing metric view-fit contract.

#### Scenario: The clip ends during swing

- **WHEN** all observable swings are clipped at a boundary or lack sufficient hip, knee, or ankle observations
- **THEN** the result is null with a caveat naming the missing complete, resolvable swing

#### Scenario: Two detected contacts span several steps after missed detections

- **WHEN** two opposite-side detected strikes are adjacent in the candidate list but their elapsed time exceeds the shortest plausible full stride derived from the fitted step rhythm
- **THEN** that interval does not contribute a swing range, and the missing interval reduces coverage

#### Scenario: No independent step-period evidence exists

- **WHEN** no trustworthy hip-bounce frequency can be fitted
- **THEN** the result is null rather than assuming adjacent detected strikes bound one step
