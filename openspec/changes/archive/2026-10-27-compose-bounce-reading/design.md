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

**Not a score.** The composite is a presentation grouping of three readings of one quantity, never
a combined score or grade (the PRD rules out "any score, grade or composite" in that sense).

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

### D3. What the From line cites, and why (revised in review round 1)

- `computeVerticalRatio` = `fit.peakToPeakAmplitude / stride.strideLengthPx`: the MoveNet hip-bounce
  fit in px over the median same-side stride in px. Those are its only inputs, so the line cites
  only them: "From hip bounce 15.3% of torso ÷ stride length 6.30 torsos (median of 3)".
- **Never VO_cm.** It is a separate MediaPipe fit (the scale pass), possibly of a different subject
  (`subjectAgreement`), and VR does not read it. The first version cited "bounce 7.2 cm" and
  switched to it in place when the graft landed; review round 1 removed that (a 🔴: it named an
  input VR never had). The line therefore never changes when the scale pass lands.
- **The figures are VR's own inputs in one unit.** With the default `verticalOscillationSignal:
  'hipMid'`, VO = amplitude / torsoLengthPx and VR = amplitude / strideLengthPx over the same fit
  and frames, so VO is the hip bounce in torso lengths and VO / VR = strideLengthPx / torsoLengthPx
  is the stride in torso lengths; bounce ÷ stride is then exactly VR, so the "÷" in the line is
  true arithmetic. A unit test pins the identity on synthetic gait (`compositeReadings.test.ts`).
- **The identity guard.** It holds only for `hipMid`. The result does not record its signal and
  `src/heuristics/**` is out of scope, so `bounceDerivation` takes the signal as a parameter
  defaulting to `DEFAULT_HEURISTICS_CONFIG.verticalOscillationSignal`: production computes every
  clip with the default config (`runClipAnalysisPipeline.ts`), so a flipped default drops the
  figures. A per-result field would make it exact: `strides-1k3w` (P3).
- The count is VR's `sampleSize` (same-side stride pairs, the median's sample), written "median of
  N" ("one measurement" for 1), so "stride" only ever names the length.
- Without same-clip `hipMid` VO figures, the line names the inputs alone: "From hip bounce ÷ stride
  length (median of N)".
- Stride in metres (VO_cm / VR) is never derived: it mixes the separate fit with the ratio and is
  circular besides.

### D4. Same-clip guard

Fusion picks each metric's clip independently (`fuseHeuristics.ts`), so VR and VO can come from
different clips. The figures need `sourceIndices.verticalOscillation === sourceIndices.verticalRatio`.
`sourceIndices === null` is treated as one clip: `computeFusionSourceIndices` returns null only when
fused heuristics are null, and the single-clip and test paths pass none. A figure from another clip
is dropped, never combined; the line then names the inputs alone. `MultiClipVideoSession` memoises
`sourceIndices` on its content (a JSON key), so the downstream memos keyed on it hold.

### D5. Summary: the composite group

`CompositeReading.tsx` renders `<div role="group" aria-label="Bounce" class="results-summary__composite"
data-composite="bounce">` (a group, not a `<section>`: a named region per row would crowd the
landmark list) with the headline's full `GuidedMetricCard` (new optional `derivation` prop,
rendered under the headline as `<p class="guided-results__derived-from">` in the card's muted
`text-sm` style, distinct from the description) and, when there are members, ONE native `<details
class="results-summary__composite-more">` in the card disclosure's own idiom (native marker, no
indent, `py-3` for a 44 px target), named for what the members are: "Same bounce in cm and % of
torso length", or the one unit present. Native and closed keeps the cards mounted, so evidence
canvases keep their one parent, and `revealFragment.ts`'s `openAncestors` already opens nested
details. The row's `onToggle` guard (`target === currentTarget`) ignores the nested disclosure.

*Class name:* the plan named the card's line `guided-results__derivation`; that class already
marks a band's "Derived range" statement inside the card's disclosure (asserted by
`GuidedResultsView.test.tsx`), so the From line is `guided-results__derived-from`.

The summary row's headline is the first reading's headline (unchanged by review round 1).

### D6. Tour: the secondary block (revised in review round 1)

The stop headline stays the area's own `view.headline`: the metric its why line and cue are keyed
on, and the runner focus, exactly as on base. (The first version used the first reading's headline,
which with cadence excluded and VO_cm measured showed VR above VO_cm's feedback.)

- When the headline IS vertical ratio (side-portrait: cadence and VO_cm excluded), the From line
  (`p.runner-tour__derivation`, muted) follows the bar and its legend.
- Otherwise, when the bounce reading is headed by a measured vertical ratio, one secondary block
  follows the why line and the cue or non-point: `div.runner-tour__value.runner-tour__value--secondary
  [data-composite=bounce]` with "Vertical ratio", the value at `text-2xl` with its band position as
  VISIBLE text ("4.00% · 31st–70th percentile of Garmin's table"), and the confidence label when
  caveated. No bar, no legend (one per stop), no From line (the summary carries it).
- No fallback block: with VR excluded (park-approach) the stop is cadence alone, as on base.
- Both are excluded from the 25-word budget (numbers and names); the From line is capped at 14.

### D7. "Also:" names a composite once

`alsoMeasuredNames` now takes readings: a composite is named once by its headline's
`METRIC_LABELS` entry ("Vertical ratio"; "Vertical oscillation (cm)" on fallback), at the first
member's position. The old "bounce (cm, ratio, % torso)" collapse is deleted.

## Risks / Trade-offs

- **Card furniture budget (≤ 50).** The From line adds up to 14 words to VR's card furniture. Measured in
  `GuidedResultsView.test.tsx` with the line rendered; if it exceeded 50 the change would stop
  rather than move the measure. Measured after round 1: verticalRatio 38 (cadence 47, verticalOscillationCm 50,
  unchanged from base since its card is untouched).
- **Phone panel height.** The rhythm stop gains ~3 lines, after its prose since round 1. The panel
  cap and the scrolling-panel group already handle a long panel (`strides-xsl3`); checked live at
  375×667 and 390×844 (`strides-3v4t` records the first version's cost).
- **Identity break.** If VO ever stops reading the same fit as VR, the stride figure would be
  wrong; the unit test catches it.
- **Fidelity.** Presentation only; the view A/B (tour / summary / classic, three clips, scale pass,
  evidence) must hash identically to the base.
