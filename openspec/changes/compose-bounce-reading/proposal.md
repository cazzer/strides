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
- Vertical ratio's bounce reading cites its own inputs: "From hip bounce 15.3% of torso ÷ stride
  length 6.3 torsos (median of 3)". Figures only from vertical ratio's own clip; never the
  centimetre bounce, a separate fit vertical ratio does not read.
- Summary: the rhythm row's "Also:" reads "Also: Vertical ratio"; opened, the vertical ratio card
  carries the From line and the other two bounce cards sit in one nested collapsed disclosure
  ("Same bounce in cm and % of torso length").
- Tour: every stop keeps the area's own headline. The rhythm stop adds, after its prose, one
  secondary block (label "Vertical ratio", value and visible band position; no bar, no From line)
  when vertical ratio is measured and is not the headline; when it is the headline, its From line
  follows the bar.
- Unchanged: `FOCUS_AREAS`, `focusAreaView`, feedback and the one thing, the runner's parameter
  binding, the classic view, every measurement.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runner-feedback`: two ADDED requirements (composite readings; the bounce derivation line).
- `runner-tour`: the stop-content requirement (the From line, the secondary block, their word rule).
- `results-summary`: the row-headline requirement ("Also:" names a composite once) and the
  every-metric-reachable requirement (the composite's group and nested disclosure).

## Impact

- New: `src/guidance/compositeReadings.ts` (+ test), `src/results/summary/CompositeReading.tsx`.
- Changed: `MultiClipVideoSession.tsx` (`sourceIndices` memoised on content), `summaryRows.ts`, `summaryLabels.ts`, `FocusAreaRow.tsx`, `ResultsSummary.tsx`,
  `GuidedMetricCard.tsx` (optional `derivation` prop), `tourPlan.ts`, `TourStop.tsx`,
  `RunnerTour.tsx`, and their tests.
- Not touched: `src/heuristics/**`, `src/runner/**`, `focusAreas.ts`, `feedbackPoints.ts`,
  `metricGuidance.ts`, `MetricsPanel.tsx`, `ResultsView.tsx`.
- Measurement fidelity: presentation only; the view A/B must stay bit-identical to the base.
