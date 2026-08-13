## ADDED Requirements

### Requirement: The vertical-oscillation family's cards name what each number is relative to

The system SHALL render `verticalOscillation`, `verticalRatio`, and `verticalOscillationCm` each
with description text stating what its number is relative to — torso length, stride length, or
nothing at all (an absolute physical quantity) — so a reader can tell the three cards apart by
what they measure against, not just by their numeric values. The `verticalOscillationCm` card
SHALL render its value in centimetres with one decimal place and no percent sign, and SHALL render
as unavailable, with its availability caveat, when its `value` is `null` rather than as an error or
a blank field.

#### Scenario: The three cards each state their own denominator

- **WHEN** the metrics panel renders `verticalOscillation`, `verticalRatio`, and
  `verticalOscillationCm` from a fully-populated result
- **THEN** each card's description text names its own denominator (torso length for
  `verticalOscillation`, stride length for `verticalRatio`, no denominator at all for
  `verticalOscillationCm`), distinguishing the three from each other

#### Scenario: A resolved centimetre value renders with one decimal place, no percent sign

- **WHEN** `verticalOscillationCm.value` is a finite number, for example `4.79`
- **THEN** the panel renders it as `"4.8 cm"` — one decimal place, a `cm` unit suffix, and no `%`
  character, distinct from every other metric's formatting

#### Scenario: An unavailable centimetre card reads as an availability statement, not an error

- **WHEN** `verticalOscillationCm.value` is `null`
- **THEN** the card renders "Not available" in place of a formatted value, and its `caveat` text
  (naming what pose-detection capability would be needed) is surfaced verbatim as a note, the same
  treatment every other null-valued metric already receives — no distinct error styling or
  wording is introduced for this metric specifically
