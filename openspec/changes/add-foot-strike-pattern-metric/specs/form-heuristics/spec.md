## ADDED Requirements

### Requirement: Foot strike pattern is an explicitly-labeled proxy, hard-gated to side view

The system SHALL compute a foot strike pattern indicator (heel / midfoot / forefoot) as a
documented **approximation** — this pipeline has no toe/foot keypoint and no ground-plane
calibration, so a real foot-ground-angle classification is not possible from its input. The
approximation SHALL classify each detected footstrike (via the shared footstrike-detection
primitive) by the same-side ankle's horizontal position relative to the knee, in the direction of
travel, normalized by torso length: an ankle notably ahead of the knee (beyond
`footStrikeMidfootBandRatio` of torso length) SHALL classify as heel-like, notably behind as
forefoot-like, and within that band as midfoot-like. This is a proxy for shank angle at
footstrike, not a direct measurement of foot-ground angle, and SHALL be hard-gated to side view —
`viewFitTable.footStrikePattern` (`front: 'unsuitable'`, `ambiguous: 'unsuitable'`) — for the same
reason as trunk lean and overstriding: the fore-aft ankle-knee separation this proxy depends on is
not visible from a front-facing camera, and what a front view sees instead (mediolateral offset)
is a different physical quantity that could coincidentally look like a confident, wrong reading.

#### Scenario: Ankle notably ahead of the knee at footstrike reads as heel

- **WHEN** foot strike pattern is computed against a side-view clip where, at each detected
  footstrike, the ankle sits more than `footStrikeMidfootBandRatio` of torso length ahead of the
  same-side knee in the direction of travel
- **THEN** the returned `value` (the signed ankle-relative-to-knee offset ratio) is positive and
  classifies as heel-like

#### Scenario: Ankle roughly under the knee at footstrike reads as midfoot

- **WHEN** foot strike pattern is computed against a side-view clip where, at each detected
  footstrike, the ankle sits within `footStrikeMidfootBandRatio` of torso length of the same-side
  knee (either direction) in the direction of travel
- **THEN** the returned `value` classifies as midfoot-like

#### Scenario: Ankle notably behind the knee at footstrike reads as forefoot

- **WHEN** foot strike pattern is computed against a side-view clip where, at each detected
  footstrike, the ankle sits more than `footStrikeMidfootBandRatio` of torso length behind the
  same-side knee in the direction of travel
- **THEN** the returned `value` is negative and classifies as forefoot-like

#### Scenario: Front-view foot strike pattern is computed, not withheld

- **WHEN** foot strike pattern is computed against a `'front'`-classified clip with detectable
  footstrikes
- **THEN** a non-null `value` is returned with `viewFit: 'unsuitable'`, confidence capped low by
  the `0.1` multiplier, and a caveat stating the view is unsuitable

#### Scenario: Too few footstrikes to classify

- **WHEN** foot strike pattern is computed against a clip where no footstrikes (or no footstrikes
  with a resolvable same-side knee position) can be detected
- **THEN** `value` is `null`, `confidence` is `0`, `sampleSize` is `0`, and a non-null `caveat` is
  returned, without throwing

### Requirement: Foot strike pattern's caveat is unconditionally non-null

Unlike every other metric in `form-heuristics`, where `caveat` is populated only for
degraded/low-confidence results, foot strike pattern's `caveat` SHALL be non-null on **every**
returned result, including its cleanest, highest-confidence one, stating plainly that the value is
an approximation derived from ankle position relative to the knee and not a direct measurement of
foot-ground angle. This reflects that the metric is fundamentally a proxy in every case, not only
when input quality is poor — a high `confidence` score means the ankle-knee offset was measured
cleanly, not that the resulting heel/midfoot/forefoot read is a validated classification.

#### Scenario: Clean, high-confidence result still carries the proxy caveat

- **WHEN** foot strike pattern is computed against a clean, high-coverage, side-view clip with a
  well-resolved sample of footstrikes (no view, sample-size, or travel-direction degradation)
- **THEN** the returned `confidence` is high and `value` is non-null, AND `caveat` is still
  non-null, stating that the result is an ankle-relative-to-knee approximation rather than a
  direct foot-angle measurement
