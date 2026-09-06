# multi-clip-analysis

## ADDED Requirements

### Requirement: A losing clip that would read differently is named in the fused caveat

Fusion selects one clip's `MetricResult` per metric and presents it alone. Where a clip it did NOT
select would have given the reader a DIFFERENT READING of that metric, the system SHALL append a
sentence to the fused metric's `caveat`, after the provenance sentence, naming each such clip and
the reading it produced. The system SHALL NOT state which clip is correct.

"A different reading" SHALL be decided by an interpretive band the metric ALREADY owns — a
classifier mapping its value to a named category — and SHALL NOT be decided by any magnitude
threshold introduced for this purpose. A metric owning no such band SHALL surface nothing, however
far apart its clips read. A boundary with no dead zone (a bare sign test) SHALL NOT be treated as
such a band: it flips on a value indistinguishable from zero and stays silent on two same-signed
values an entire body-scale apart.

A clip SHALL be eligible to contest, and the winner SHALL be eligible to be contested, only where
that clip's `MetricResult` is one the results panel would render as a card — excluding a null value
and a `viewFit` the camera geometry cannot support. Fewer than two eligible clips SHALL surface
nothing.

This SHALL change `caveat` and nothing else: the metric's `value`, `confidence`, `viewFit`,
`sampleSize`, `interpolatedFraction` and `frameCoverage` SHALL be exactly the winning clip's, and
the selection rule (highest `confidence`, ties to the lowest clip index) SHALL be unchanged.

#### Scenario: Two clips straddling a band both surface

- **WHEN** two clips resolve `footStrikePattern` at the same confidence, one classifying as `heel`
  and the other as `forefoot`
- **THEN** the fused metric's `caveat` carries the provenance sentence for the winning clip AND a
  following sentence naming the other clip and the reading it produced, and asserts no winner
  between them

#### Scenario: Numbers far apart inside one band surface nothing

- **WHEN** two clips resolve the same metric to values that differ greatly but classify into the
  same category
- **THEN** the fused metric's `caveat` carries the provenance sentence alone

#### Scenario: A metric with no band surfaces nothing

- **WHEN** two clips resolve a metric that owns no classifier — `overstriding` at `+0.512135` on
  one clip and `-0.00809497` on the other, both at confidence 1.0
- **THEN** the fused metric's `caveat` carries the provenance sentence alone, and the metric's own
  unconditional caveat text is unchanged

#### Scenario: A clip the panel would not render is not quoted

- **WHEN** a losing clip's result for the metric has a null value, or a `viewFit` of `unsuitable`
- **THEN** that clip contributes no reading and no disagreement sentence is produced on its account

#### Scenario: No computed field moves when the sentence is appended

- **WHEN** the disagreement sentence is appended to a fused metric
- **THEN** that metric's `value`, `confidence`, `viewFit`, `sampleSize`, `interpolatedFraction` and
  `frameCoverage` are exactly the winning clip's, unchanged

#### Scenario: A single-clip session is unaffected

- **WHEN** fusion is given exactly one `FormHeuristicsResult`
- **THEN** the returned object is reference-identical to that input, with no disagreement sentence
  and no provenance sentence anywhere
