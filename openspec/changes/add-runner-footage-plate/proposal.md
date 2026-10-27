## Why

The model runner is built from the reader's numbers, and the real footage behind those numbers is
one tap away in the summary as each card's evidence frame. In the tour it is not on screen at all,
and in the summary it sits in a card, away from the figure. A reader comparing "the knee the model
draws" with "my knee" has to hold one picture in mind while looking at the other (bead
`strides-zba4`).

When the figure is still on a side stop, it stands at exactly the instant a leg metric was measured
at (its key leg phase). The evidence frame is a photograph of that same instant. Laid faintly
behind the figure, scaled to it, the two can be read together without either pretending to be the
other.

## What Changes

- A faint (0.26 opacity) copy of the headline metric's evidence frame sits under the model runner's
  figure, as the drawing's first SVG element, for the landing and knees stops whose winning clip is
  classified a side view, in both the tour and the summary.
- It is placed by a similarity transform only (uniform scale, translation, a horizontal mirror for a
  right-to-left clip), anchored at hip-mid and scaled from summed thigh and shank lengths, written
  by the renderer's loop from the pose as drawn. Never rotated, sheared or warped; never fitted by
  least squares (which would absorb an angle difference into scale and offset).
- It shows only while the figure is still (paused, or reduced motion before play) at its held key
  phase, with no camera or value tween running, and only when that phase is the footage metric's
  own key leg phase. It fades in and out over 240 ms (no fade under reduced motion), and is not drawn
  under forced colours.
- The canvas's pixels are copied to a blob URL (never moved out of the card that owns it), only
  while the figure is still, and revoked when the source changes or the runner unmounts.
- The text alternative names the plate while it is offered.
- Pausing with a limb focus (any non-beat focus with a key leg phase) stands the figure at its key
  phase, as the landing camera already did. A cadence focus pauses where it is.
- `ResultsViewProps` gains `clipViewKinds` (each clip's raw `View`, beside the `clipViews` labels),
  so the side-view gate never reads a display string.
- Unchanged: every measurement, threshold, evidence plan and extraction; the evidence canvas, its
  marks (baked into the copy, accepted) and its card; every other stop (rhythm, posture, arms, foot
  path, one thing, the intro), which shows no plate.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-runner`: ADDED requirements only. A still figure can show its measured instant's footage
  behind it, faintly; pausing with a limb focus stands the figure at its key phase; the text
  alternative names the plate when it shows.
- `runner-tour`: ADDED. A side stop's still beat shows its headline's evidence footage.
- `results-summary`: ADDED. An opened side row's still runner shows its headline's evidence footage.

## Impact

- New: `src/runner/footagePlate.ts` (pure fit, side mapping, key-phase guard),
  `src/results/runnerFootagePlate.ts` (pure adapter from evidence to the runner's `footage` prop),
  and their tests.
- `src/runner/ModelRunner.tsx` (`footage` prop, blob copy, the `<image>`, draw-time gate, pause
  snap, text alternative), `src/results/tour/RunnerTour.tsx`, `src/results/summary/ResultsSummary.tsx`,
  `src/results/ResultsView.tsx` (prop type), `src/results/MultiClipVideoSession.tsx` (`clipViewKinds`).
- `docs/prd/runner-led-results.md` honesty rule 5.
- No measurement change: the A/B fidelity gate (`docs/agent-notes/runner-tour.md`) is re-run.
