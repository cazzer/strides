## ADDED Requirements

### Requirement: The arm sweeps fore and aft past the trunk, its wrist travel exactly the measured value

The runner's arm SHALL swing as a rigid bent unit about the shoulder, about a shoulder→wrist centre
of 33° forward of vertical, so that at typical values the upper arm passes behind the trunk line on
the backswing. Where a swing symmetric about that centre would carry the wrist behind the shoulder,
the backswing SHALL instead be pinned with the wrist straight below the shoulder. In every case the
wrist SHALL never be behind the shoulder, and the peak-to-peak height of the wrist relative to the
shoulder SHALL be exactly the bound arm swing (the measurement's own formula read back to within
1e-9 torso lengths). The fore-aft sweep is illustrative, never a measurement or a target.

The arm swing's vertical bracket SHALL span exactly the drawn value, and its label SHALL sit above
the bracket's top end, centred on it, so that the label never covers the bracket and never hangs
below the bracket's foot, where a phone's stop panel overlays the figure.

#### Scenario: A front-view reading

- **WHEN** arm swing is bound to 0.33 at the neutral trunk lean
- **THEN** the upper arm runs about −25°…+15° from vertical, the elbow passes behind the trunk line
  on the backswing, and the wrist travels 0.33 torso lengths up and down

#### Scenario: A side-view reading

- **WHEN** arm swing is bound to 0.51
- **THEN** the upper arm runs about −37°…+27° from vertical and the wrist travels 0.51 torso lengths

#### Scenario: The largest drawable swing

- **WHEN** arm swing is bound to 0.9
- **THEN** the wrist is never behind the shoulder and travels 0.9 torso lengths

#### Scenario: The arms stop on a phone with a pinned swing

- **WHEN** the arms stop is shown at 390 px wide with arm swing bound to 0.5627
- **THEN** the bracket spans 0.5627 torso lengths, and both lines of its label sit above the
  bracket's top end and clear of the stop panel
