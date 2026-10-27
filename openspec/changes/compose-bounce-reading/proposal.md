## Why

The rhythm area shows cadence and then three bounce readings — vertical oscillation in
centimetres, vertical ratio, and vertical oscillation as a share of torso length — as separate
cards and an "Also: bounce (cm, ratio, % torso)" list. They measure the same thing (one fitted hip
bounce, over three denominators), so the area reads as far more detail than it carries. The user
(`strides-xki9`, 2026-10-27): "some sections like rythm have way too much details since vertical
ratio and oscillation are measuring the same sort of thing. can we compress metrics like that into
one visual block that sites different data points we used to derive it? I think vertical ratio is
the main thing people care about".

## What Changes

- A presentation-only "composite reading" layer (`src/guidance/compositeReadings.ts`) declares one
  composite, bounce (rhythm): vertical ratio, then vertical oscillation in cm, then relative. An
  area's measured metrics group into readings; the bounce composite sits where its first member
  sat, headlined by vertical ratio (falling back to cm, then relative).
- Vertical ratio's bounce reading cites what it was derived from: "From bounce 7.2 cm and stride
  4.6 torso lengths (5 strides)". Each figure only from vertical ratio's own clip.
- Summary: the rhythm row's "Also:" reads "Also: Vertical ratio"; opened, the vertical ratio card
  carries the From line and the other two bounce cards sit in one nested collapsed disclosure.
- Tour: the rhythm stop keeps cadence as its headline and adds one secondary value block (label
  "Vertical ratio", value, From line; no bar). With cadence excluded the bounce reading is the
  stop's headline, with its bar.
- Unchanged: `FOCUS_AREAS`, `focusAreaView`, feedback and the one thing, the runner's parameter
  binding, the classic view, every measurement.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runner-feedback`: two ADDED requirements (composite readings; the bounce derivation line).
- `runner-tour`: the stop-content requirement (headline from the first reading, the secondary
  block, its word rule) and the focus sentence of the camera requirement.
- `results-summary`: the row-headline requirement ("Also:" names a composite once) and the
  every-metric-reachable requirement (the composite's group and nested disclosure).

## Impact

- New: `src/guidance/compositeReadings.ts` (+ test), `src/results/summary/CompositeReading.tsx`.
- Changed: `summaryRows.ts`, `summaryLabels.ts`, `FocusAreaRow.tsx`, `ResultsSummary.tsx`,
  `GuidedMetricCard.tsx` (optional `derivation` prop), `tourPlan.ts`, `TourStop.tsx`,
  `RunnerTour.tsx`, and their tests.
- Not touched: `src/heuristics/**`, `src/runner/**`, `focusAreas.ts`, `feedbackPoints.ts`,
  `metricGuidance.ts`, `MetricsPanel.tsx`, `ResultsView.tsx`.
- Measurement fidelity: presentation only; the view A/B must stay bit-identical to the base.
