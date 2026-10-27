## Context

The rhythm focus area lists four metrics in headline-preference order: cadence, vertical
oscillation in cm (VO_cm), vertical ratio (VR), vertical oscillation relative to torso length (VO).
The last three are one fitted hip bounce over three denominators (see
`docs/agent-notes/vertical-oscillation.md`), and the summary and tour presented them as three
readings. The user asked for one block headlined by vertical ratio that cites what it was derived
from. Decisions below were settled by the orchestrator (2026-10-27) on the planner's defaults.

## Goals / Non-Goals

**Goals:** one bounce reading in the summary and the tour, headlined by VR, naming its inputs;
cadence stays its own reading; every bounce card still reachable at full depth.

**Non-Goals:** any change to a measurement, to `FOCUS_AREAS` / `focusAreaView`, to feedback or the
one thing, to the runner's binding, or to the classic view. A step-width composite (`stepWidthCm`
+ `stepWidth`) is filed as `strides-gd1j` and not done here.

## Decisions

### D1. A presentation-only layer, not a change to focus areas

`src/guidance/compositeReadings.ts` declares `COMPOSITE_READINGS.bounce` (area `rhythm`, members
VR, VO_cm, VO) and groups an area's measured entries into `AreaReading`s. `focusAreaView` keeps its
headline (the first non-excluded metric in `FOCUS_AREAS` order), which `feedbackFor` and
`selectOneThing` read, so feedback and the one thing cannot move. The layer imports nothing from
`src/results` or `src/runner` (the same rule as `feedbackPoints.ts`).

*Alternative rejected:* reordering `FOCUS_AREAS.rhythm` to VR first. It would move the area
headline when cadence is excluded and so the why line and cue, and the cm-before-relative order
there is cited (the sources report in cm).

### D2. Headline order VR → VO_cm → VO

VR is what the user cares about. When VR is excluded (approach clips: stride length unobservable),
VO_cm is next because it has a cited band (Malisoux) and a why/cue; VO has neither. This matches the
area's own cm-before-relative rationale.

### D3. What the From line cites, and why

- `computeVerticalRatio` = `fit.peakToPeakAmplitude / stride.strideLengthPx`: the hip-bounce fit in
  px over the median same-side stride in px. It does NOT read VO_cm. VO_cm is a separate cm fit of
  the same hip bounce (the scale pass), so the line cites it as "bounce 7.2 cm", the same bounce in
  the unit runners know, not as an operand.
- Stride length is not exposed by any metric. But with the default `verticalOscillationSignal:
  'hipMid'`, VO = amplitude / torsoLengthPx and VR = amplitude / strideLengthPx over the same fit and
  frames, so VO / VR = strideLengthPx / torsoLengthPx exactly. The line cites "stride 4.6 torso
  lengths". A unit test pins the identity on synthetic gait (`compositeReadings.test.ts`), next to
  the existing drift guards in `src/heuristics/index.test.ts`. An `earMid` VO override would break
  it; no heuristics override is exposed in production today.
- The stride count is VR's `sampleSize` (same-side stride pairs, the median's sample).
- Stride in metres (VO_cm / VR) is NOT cited: it is computed from VR itself, so citing it as an
  input would be circular.
- Mixed units are joined by words, never an operator ("÷" between cm and torso lengths reads as a
  formula that does not hold).

### D4. Same-clip guard

Fusion picks each metric's clip independently (`fuseHeuristics.ts`), so VR, VO and VO_cm can come
from different clips. Every cross-metric figure needs `sourceIndices[a] === sourceIndices[b]`.
`sourceIndices === null` is treated as one clip: `computeFusionSourceIndices` returns null only when
fused heuristics are null, and the single-clip and test paths pass none. A figure from another clip
is dropped, never combined; at minimum the line reads "From N strides".

### D5. Summary: the composite group

`CompositeReading.tsx` renders `<section class="results-summary__composite" data-composite="bounce"
aria-labelledby=…>` with the headline's full `GuidedMetricCard` (new optional `derivation` prop,
rendered under the headline as `<p class="guided-results__derived-from">`) and, when there are
members, ONE native `<details class="results-summary__composite-more">` summarised "Also: <full
labels>" (44 px target, the row's chevron idiom) holding their full cards. Native and closed keeps
the cards mounted, so evidence canvases keep their one parent, and `revealFragment.ts`'s
`openAncestors` already opens nested details. The row's `onToggle` guard (`target ===
currentTarget`) ignores the nested disclosure. The section is named by the composite's label,
"Bounce", through `aria-label` (the headline card's heading id is private to the card, so
`aria-labelledby` has nothing outside it to point at).

*Class name:* the plan named the card's line `guided-results__derivation`; that class already
marks a band's "Derived range" statement inside the card's disclosure (asserted by
`GuidedResultsView.test.tsx`), so the From line is `guided-results__derived-from`.

### D6. Tour: the secondary block

The tour's stop headline is the first reading's headline. With cadence measured, the rhythm stop
keeps cadence (bar, legend, runner focus) and adds `<div class="runner-tour__value
runner-tour__value--secondary" data-composite="bounce">`: the short label "Vertical ratio", the
value at `text-2xl`, its band position sr-only as the headline's is, and
`<p class="runner-tour__derivation">`. No bar, no legend: one bar per stop. It is excluded from the
25-word budget like the value line (numbers and names), and the From line is capped at 14 words on
its own. With cadence excluded, the composite headline is the stop headline: its bar, and the From
line inside the value block. The runner focus reads the first reading's headline; VR drives no
runner parameter, so no bounce label is drawn on the figure in that case (before, VO_cm was the
focus there).

### D7. "Also:" names a composite once

`alsoMeasuredNames` now takes readings: a composite is named once by its headline's
`METRIC_LABELS` entry ("Vertical ratio"; "Vertical oscillation (cm)" on fallback), at the first
member's position. The old "bounce (cm, ratio, % torso)" collapse is deleted.

## Risks / Trade-offs

- **Card furniture budget (≤ 50).** The From line adds ~11 words to VR's card furniture. Measured in
  `GuidedResultsView.test.tsx` with the line rendered; if it exceeded 50 the change would stop
  rather than move the measure.
- **Phone panel height.** The rhythm stop gains ~3 lines. The panel cap and the scrolling-panel
  group already handle a long panel (`strides-xsl3`); checked live at 375×667 and 390×844.
- **Summary runner labels VO relative while the From line may cite cm.** Pre-existing: the runner
  binds bounce from VO_cm (÷ 50 cm torso) or VO; the label shows the bound metric's own value. Not
  changed here.
- **Identity break.** If VO ever stops reading the same fit as VR, the stride figure would be
  wrong; the unit test catches it.
- **Fidelity.** Presentation only; the view A/B (tour / summary / classic, three clips, scale pass,
  evidence) must hash identically to the base.
