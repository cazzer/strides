## Why

Review round 1 of `strides-xsl3`: the narrow-layout requirement still said the controls stick
under the tour's bar and the bar is one row of dots and Skip, both untrue on a short phone. The
round also made a scrolling panel focusable, kept focus across the bar/row move, fixed the shared
row's tab order, and let the intro gate's floor shrink on landscape phones.

## What Changes

- Qualify both sentences with "except on a short phone"; state the shared row's keyboard order,
  focus kept across the move, and the focusable scrolling panel.
- The focus-above-the-panel guarantee holds on viewports at least 500 px tall (a landscape phone,
  375–390 px tall under a ~150 px header, has a 96 px panel over a 169–184 px drawing).
- The intro gate's floor is `min(120px, 25% of the viewport)`, never 0, so a landscape phone plays
  the intro.

## Capabilities

### Modified Capabilities

- `runner-tour`: the narrow-layout requirement and the intro-gate requirement.

## Impact

Spec wording, plus `src/results/tour/` UI code from the same review round.
