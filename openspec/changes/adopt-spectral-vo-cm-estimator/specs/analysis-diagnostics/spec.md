## MODIFIED Requirements

### Requirement: Scale-calibrated vertical oscillation appears only when measured
The system SHALL include a `scaleCalibration` block in the diagnostics object when, and only
when, a scale-calibrated vertical-oscillation result was actually computed — reporting the
centimetre amplitude, the number of complete bounce cycles observed, the statistics of the
spectral fit the amplitude came from (or `null` when no fit produced one), the typed reason no
amplitude was produced (or `null` when one was), the scale drift ratio, the median
pixels-per-metre, the implied torso length in metres, the scale coverage, and the number of
independent integration runs that contributed. When no such result exists, because the detection
backend does not measure real-world scale or no frame carried a usable scale, the key SHALL be
absent from the object entirely rather than present with a `null` or `undefined` value, so that a
run on a scale-less backend serializes to exactly the JSON it did before this capability existed.

#### Scenario: Diagnostics from a scale-less backend carry no scale-calibration key
- **WHEN** diagnostics are computed without a scale-calibration result, or with an explicitly
  absent one
- **THEN** the serialized diagnostics object contains no `scaleCalibration` property at all

#### Scenario: A measured calibration is surfaced verbatim
- **WHEN** diagnostics are computed with a scale-calibration result
- **THEN** the diagnostics object's `scaleCalibration` is that result's fields unchanged,
  including its fit statistics, not a recomputation or a rounded restatement of them

#### Scenario: A measured-but-unfittable calibration still appears, with its reason
- **WHEN** diagnostics are computed with a scale-calibration result whose amplitude is `null`
  because no integration run produced a usable fit
- **THEN** the `scaleCalibration` key is present, carrying the null amplitude, a null fit, the
  typed failure reason, and the scale statistics that were measured — the key is omitted only when
  no calibration result exists at all, never merely because no amplitude could be fitted
