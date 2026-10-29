## Context

Knee flexion (`peakSwingKneeBend`) and knee drive (`peakThighAngle`) share the knees area but have
different key phases (0.62 and 0.78 leg phase). `runnerFocusFor` keeps only limb parameters sharing
the first one's key phase, and the tour focuses the stop's headline only, so the two arcs never draw
together: knees shows knee flexion, or knee drive when knee flexion is excluded.

## Decisions

**D1. Sided accent for the knee parameters only.** `focusAccentEdges(param, side)` returns the
annotated leg's thigh and shank (knee flexion) or thigh (knee drive); every other parameter keeps
accenting every edge it shapes. The side is the annotation's (`planAnnotations`: the near leg in a
side view). An accented edge that no measured parameter shapes stays neutral, so a dashed thigh is
never accented as measured (honesty rule 2). If both knee metrics were ever in one focus they would
share the near thigh, each mark on its own key pose; today they never coexist (see Context), so no
separate colouring was added.

**D2. The straight-leg line is a guide, not a limb.** Drawn dashed (2 px, 5/4 dash, neutral-700 /
neutral-300), 0.55 torso lengths from the knee: past the 0.3 arc, well short of the 0.85 shank, so
it never reads as a ghost straight leg (rule 3: guides are short reference rays only). It replaces
the old thin continuation ray; the label moved to its end. Readback: the line is collinear with the
live thigh and the arc sweeps exactly the drawn bend from it.

**D3. Dwell at the headline's key phase only.** The window is the whole cycle with one hold at the
held phase (`keyPhaseDwellWindow`, started half a cycle away so the hold never sits at a wrap). The
held phase is the first annotated limb parameter's, which on the knees stop is the headline's
(knee flexion's peak bend, or knee drive's peak thigh when that heads). Only `FOCUS_AREA_CAMERA.knees`
carries a dwell (500 ms), so the tour stop and the summary row rest; other stops and the one-thing
stop do not.

**D4. Fill the visible frame.** The viewBox is fitted with `meet`, so a non-3:4 drawing shows more.
`ModelRunner` observes the drawing (svg) box, derives its visible frame, and frames the stride camera
in it; label pads come from `strideFramePad` at `1 / pxPerUnit` (the scale labels are sized at), for
the labels actually drawn. The bottom 15% is kept clear (`--rt-clear`). Labels clamp to the visible
frame. Measured live on the demo: figure 98 → 153 px tall at 1280×800, 83 → 150 px at 390×844.

**D5. Open, then ease, then draw.** `useStrideOpening` (tour only): `whole` (area camera, headline
focus) for `CAMERA_TWEEN_MS + 1500`, `easing` (stride camera, headline focus) for one tween, then
`drawn`. Holding vertical ratio back until the camera rests keeps its 6-torso bracket and its label
from being clamped at the frame edge during the zoom. A stop headed by vertical ratio skips the
opening (that drawing is the headline). The summary row goes straight to the stride: the reader
opened that row on purpose.

## Risks

- On a 390×844 phone the whole-body opening frame (the existing `wholeBodySide`) puts the feet under
  the stop panel, as it already did for the intro and for clips without a stride.
