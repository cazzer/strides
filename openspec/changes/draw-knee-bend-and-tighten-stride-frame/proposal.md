## Why

User review of live tour screenshots (`strides-trn2.11`):

1. The knee-flexion arc is hard to connect to the leg: the measured leg's thigh is not accented, the
   OTHER leg's shank is (both shanks were), and the arc only lines up with the moving leg at one
   instant of a 0.4× cycle.
2. The rhythm stop's stride view is oddly zoomed out: the figure is about a quarter of the frame
   tall with empty space above and below. The stride camera framed into the viewBox's 3:4 even
   though the drawing is nearly square on the desktop rail (401 × 404 px) and wider than tall on a
   phone (390 × 338 px), and kept fixed label pads whatever was drawn.

## What Changes

- Knee flexion accents only the measured leg's thigh and shank; knee drive only its thigh. The other
  leg keeps the figure's normal style. A thigh no measured parameter shapes stays dashed grey.
- Knee flexion is drawn as a bend from straight: a dashed straight-leg reference line continues the
  thigh past the knee (0.55 torso lengths, short of the 0.85 shank), the arc runs from it onto the
  shank, and the label reads "<card value> bend" ("102.9° bend").
- The knees view (tour stop and summary row) rests 500 ms on the headline's key phase each cycle
  while playing (`keyPhaseDwellMs`), so the arc and the leg line up. Reduced motion still holds the
  still key frame.
- `strideCamera` fills the drawing's whole visible frame above its clear bottom (the share a page
  panel may cover), with room for exactly the labels drawn at the live scale and a 12 px margin. Labels are kept
  inside the visible frame rather than the viewBox. Framed on the bound stride, never a fixed length.
- The whole-body view (intro, rhythm opening, one-thing stop, summary with no row open) is reframed
  the same way once the drawing is measured: the whole figure, ground and cadence label's room, as
  large as fits above the clear bottom. The phone tour states its clear bottom (15%) on the runner
  through `--runner-clear-bottom`; other layouts have none. On a 390×844 phone the feet and ground
  now sit above the stop panel and the cadence label is off the drawing's top edge.
- The tour's rhythm stop (headed by cadence or the bounce, stating vertical ratio) opens on the whole
  figure with its headline alone, eases out to the stride camera after the arrival tween plus 1.5 s,
  and adds vertical ratio's marks once the camera rests. Reduced motion goes straight to the stride.
  The summary's rhythm row keeps going straight to the stride view.

Presentation only: no heuristic, measurement or metric value changes.

## Capabilities

### Modified Capabilities

- `model-runner`: knee accents and the bend drawing; the stride and whole-body cameras' framing; a dwell rest.
- `runner-tour`: the rhythm stop's opening sequence; the knees stop's dwell.
