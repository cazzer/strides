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
the labels actually drawn. The clear bottom is a share of the drawing's height the page may cover;
the phone tour sets `--runner-clear-bottom: 0.15` on the runner below `lg` (its panel may cover the
bottom 15% of the drawing, `--rt-clear`), the runner reads it in its ResizeObserver, so `src/runner`
carries no phone code; desktop and the summary have none. Labels clamp to the visible frame.
Measured live on the demo: figure 98 → 153 px tall at 1280×800, 83 → 150 px at 390×844.

**D6. The whole-body view is framed the same way (review round 1).** On a 390×844 phone the
`wholeBodySide` preset filled the drawing's whole height, so the feet and ground sat under the stop
panel and the cadence label was clamped to the drawing's top edge. `wholeBodyCamera(values, framing)`
frames the figure over its cycle (ground, or a sinking stance foot, to the head or the cadence label's
anchor), with label room from `wholeBodyFramePad` (cadence label above; footfall rings or ground-lane
labels below; 12 px margin), above the clear bottom, centred on hip-mid's line. It frames the BOUND
values, not the intro's overrides, so the intro's steps never move the camera. The preset stands until
the drawing is measured (and in jsdom), so every existing preset-based test still holds. Live: the
phone's rhythm opening now has the figure 364–587 px with the panel at 602, the label 12 px under
the drawing's top; desktop's whole body is about 15% larger than the preset and still inside the
frame. Labels on every other stop (arms, posture, knees apart from the new "bend", landing, foot path)
are at the same pixel boxes as on base at both sizes, so clamping to the visible frame moved nothing
there.

**D5. Open, then ease, then draw.** `useStrideOpening` (tour only): `whole` (area camera, headline
focus) for `CAMERA_TWEEN_MS + 1500`, `easing` (stride camera, headline focus) for one tween, then
`drawn`. Holding vertical ratio back until the camera rests keeps its 6-torso bracket and its label
from being clamped at the frame edge during the zoom. A stop headed by vertical ratio skips the
opening (that drawing is the headline). The summary row goes straight to the stride: the reader
opened that row on purpose.

**D7. Review round 2.**
- The "Dashed: not measured" legend tests the drawing's own frame above its clear bottom
  (`neutralEdgeInFrame(…, frame)`); with the viewBox it vanished once the stride camera put the
  figure beyond ±1.5 (a component test fires a wide drawing and fails without the fix).
- Vertical ratio's label line count is read from the binding (`strideLabelLineCount`), so the
  `easing` (headline-only) and `drawn` phases share one stride camera even when the label says
  "shown approximately".
- The drawing's frame and the stage's scale are measured in layout effects as well as by the
  observers, and the camera cuts on the first measurement. Live, the ground line's position from a
  runner's first painted frame no longer changes (it used to tween 1.83 → 1.64 over ~750 ms in the
  phone summary).
- The straight-leg line is a row of round accent dots (2.5 px, 5 px apart), not grey dashes, so it
  never reads as an unmeasured limb.
- The opening's `easing → drawn` step follows the runner's `onCameraRest('strideSide')` (a tween
  ending, or a cut); a 1.2 s timer only stands in for a missing report. Reduced motion switched on
  at the stop sets the opening to `drawn` for good.
- Nits: a window change clears any leftover rest; framed zooms never fall below 0.05; labels clamp
  above the clear bottom (the phone landing label moved from 608–628 px, under the 602 px panel, to
  582–602); the text alternative reads "Knee flexion 102.9° bend".

## Risks

- The landing camera is not reframed here; its label is only kept above the clear bottom, so at
  390×844 it now sits just above the panel, over the stance foot's ground line.
