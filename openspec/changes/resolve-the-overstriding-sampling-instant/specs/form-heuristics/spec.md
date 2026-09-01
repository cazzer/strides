# form-heuristics — delta

<!-- FALLBACK branch shipped (design.md D6): the forward-reach-extremum estimator's own accuracy
gates passed convincingly, but the materiality gate (G6) failed — the search could resolve an
interior extremum on only 34.6% of the otherwise-usable strike population across the probed corpus,
below the pre-registered 50% floor, because a majority of real footage lacks either a known travel
direction or a trustworthy fitted step period, both of which the search structurally requires. No
existing requirement is MODIFIED or REMOVED — see design.md D7. -->

## ADDED Requirements

### Requirement: Overstriding's caveat is unconditionally non-null

Unlike a metric whose `caveat` is populated only for degraded or low-confidence results,
overstriding's `caveat` SHALL be non-null on **every** returned result that has a non-null `value`,
including its cleanest, highest-confidence one, disclosing that the value is sampled at an instant
that tends to trail the true moment of ground contact and should be read as a lower bound on how
far the foot actually lands ahead of the hip. The caveat text SHALL NOT quote a specific numeric
magnitude or percentage for this effect, since the underlying quantity is measured to vary widely
across runners and footage and no single number transfers.

#### Scenario: Clean, high-confidence result still carries the sampling-instant caveat

- **WHEN** overstriding is computed against a clean, high-coverage, side-view clip with a
  well-resolved sample of footstrikes (no view, sample-size, or travel-direction degradation)
- **THEN** the returned `confidence` is high and `value` is non-null, AND `caveat` is still
  non-null, disclosing the sampling-instant limitation without quoting a numeric magnitude
