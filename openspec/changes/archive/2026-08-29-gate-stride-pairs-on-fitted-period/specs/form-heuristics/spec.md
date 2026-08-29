## ADDED Requirements

### Requirement: Stride pairs are validated against the fitted step period before contributing

The system SHALL accept an optional fitted **step frequency** reference when estimating stride
length, and — when one is supplied — SHALL reject any same-side consecutive-footstrike pair whose
elapsed time is not consistent with a single stride at that step frequency, before that pair's
displacement contributes to the reported stride length.

The expected stride period SHALL be `2 / stepFrequencyHz`, derived from the definition of a gait
cycle (a stride is exactly two steps) and from the fitted hip-bounce frequency already being the
step frequency — the same identity `cadence` relies on when it reports `frequencyHz × 60` steps per
minute. No fitted, tuned, or per-clip coefficient SHALL enter that derivation.

A pair SHALL be accepted when the ratio of its elapsed time to the expected stride period lies
within a log-symmetric tolerance band — that is, within `[1 / (1 + tolerance), 1 + tolerance]` —
and rejected otherwise. The band SHALL be symmetric in the logarithm rather than additively,
because the errors it exists to reject are multiplicative (about half a stride when a spurious extra
strike is detected, about double when a real one is missed). The tolerance SHALL be derived from
stride-to-stride biological variability, footstrike-instant sampling quantization, and the fitted
frequency's own resolution and estimation error — never chosen to make any particular clip produce
any particular value — and SHALL be small enough that neither the half-stride nor the double-stride
multiplicity falls inside the band.

The system SHALL apply this check before the existing hip-resolution and advancing-displacement
checks, so that a pair which is not a stride is accounted for as such rather than as a pair that
could not be read.

The system SHALL report the number of pairs rejected by this check as a distinct field on a
successful stride-length result, separate from the pre-existing pairing-opportunity and kept-pair
counts, such that kept pairs plus period-rejected pairs never exceed the pairing-opportunity count.

When no step-frequency reference is supplied, or the supplied value is not a finite positive
number, the system SHALL skip this check entirely and SHALL produce exactly the result it produced
before this requirement existed, with a period-rejected count of zero.

#### Scenario: A pair spanning one full stride at the fitted step frequency is kept

- **WHEN** stride length is estimated with a step-frequency reference, and a same-side consecutive
  footstrike pair's elapsed time is close to `2 / stepFrequencyHz`
- **THEN** the pair contributes its displacement to the reported stride length, and the
  period-rejected count does not include it

#### Scenario: A pair spanning about half a stride is rejected

- **WHEN** stride length is estimated with a step-frequency reference, and a same-side consecutive
  footstrike pair's elapsed time is about half the expected stride period — the signature of a
  spurious extra strike instant detected mid-stance on the trailing leg
- **THEN** that pair's displacement does not contribute to the reported stride length, and the
  period-rejected count includes it

#### Scenario: A pair spanning about two strides is rejected

- **WHEN** a same-side consecutive footstrike pair's elapsed time is about twice the expected stride
  period — the signature of a missed footstrike
- **THEN** that pair's displacement does not contribute to the reported stride length, and the
  period-rejected count includes it, rather than being left to the median to outvote

#### Scenario: No step-frequency reference leaves behaviour unchanged

- **WHEN** stride length is estimated without a step-frequency reference, or with one that is not a
  finite positive number
- **THEN** no pair is rejected on timing grounds, the period-rejected count is zero, and the
  returned stride length, kept-pair count, pairing-opportunity count and failure reason are
  identical to what the same frames produced before this requirement existed

#### Scenario: Every pair rejected on timing reports its own failure reason

- **WHEN** a step-frequency reference is supplied and every candidate same-side pair is rejected as
  period-inconsistent, so no pair survives
- **THEN** the result is not-ok with a reason distinguishing "no pair spanned a plausible stride"
  from the pre-existing "no pair advanced in the direction of travel", and that pre-existing reason
  is still what is reported when no pair was rejected on timing

### Requirement: Vertical ratio supplies the period reference and names timing rejections honestly

The system SHALL pass the hip-bounce fit's own frequency to the stride-length estimate as the
step-frequency reference, so that the metric's denominator is validated against the same fit its
numerator is measured from. The fit is already computed and quality-gated before stride length is
estimated, so no additional fit SHALL be performed for this purpose.

When the stride-length estimate fails because no pair was period-consistent, the system SHALL report
`value: null`, `confidence: 0`, and a caveat naming that specific cause — that no consecutive
same-side pair lasted a full stride at the rhythm measured in this clip, and that extra detected
strike instants are the likely reason — rather than a generic no-usable-pairs or unreadable-frames
message. Reporting no value with that caveat SHALL be preferred over reporting a value derived from
a denominator known to span less than one stride.

When some pairs were period-rejected but others survived, the system SHALL attach a caveat stating
how many pairs were excluded for not lasting a full stride, and SHALL NOT count those pairs in the
existing "couldn't be read cleanly" caveat — those pairs were read cleanly and were excluded for a
different, nameable reason.

#### Scenario: Period-inconsistent pairs withhold the value with a cause-naming caveat

- **WHEN** vertical ratio is computed against a clip with a fittable hip-bounce rhythm and a known
  travel direction, but every candidate same-side footstrike pair is period-inconsistent with the
  fitted step frequency
- **THEN** `value` is `null`, `confidence` is `0`, and `caveat` names the timing mismatch and the
  likely extra strike instants, rather than reporting a value from a sub-stride denominator

#### Scenario: Surviving pairs report the exclusions separately from unreadable ones

- **WHEN** vertical ratio is computed against a clip where some candidate pairs are
  period-inconsistent and at least one is period-consistent and usable
- **THEN** a value is reported from the surviving pairs only, with a caveat stating how many pairs
  were excluded for not lasting a full stride, and the "couldn't be read cleanly" caveat counts only
  the pairs that failed for that other reason
