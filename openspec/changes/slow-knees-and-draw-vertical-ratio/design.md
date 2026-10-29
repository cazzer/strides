## Context

The runner's honesty rules: every degree of freedom is bound to one measured value or a neutral
constant, and every drawn mark equals its measured value exactly (readback tests). Vertical ratio
(`verticalRatio.ts`) is the MoveNet hip-bounce amplitude over the median same-side stride, both in
pixels. Relative vertical oscillation is the same fit over the torso, so VO / VR is the stride in
torso lengths, the model's own unit (`bounceDerivation`, guarded to VR's clip and the hip signal).

## Decisions

**D1. Knees plays at 0.4×, the rate already used by landing and foot path** (`SLOW_MOTION_RATE`).
The knees area is the stop that presents knee flexion (its headline); knee drive shares it. The
change is in `FOCUS_AREA_CAMERA`, shared by tour and summary, so both slow it and both already say
"Slow motion" (reduced motion: still figure, no note, as before).

**D2. A stride parameter, bound from vertical ratio through the bounce reading's derivation.**
`strideLength` (torso lengths) binds only where `bounceDerivation` has figures, the same figure the
"From …" line prints; otherwise it is neutral (5, never drawn). Its candidate is vertical ratio
(`{ metric: 'verticalRatio', stride: true }`), labelled with vertical ratio's own value. VO still
binds only `pelvisBounce`: it is the conversion that puts vertical ratio's denominator in torso
lengths, as the From line does. Drawn ratio = `pelvisBounce / strideLength`; when the bounce or the
stride is clamped the stride is marked clamped ("shown approximately").

**D3. The stride moves no joint.** The model is a treadmill (hip-mid at x = 0); its stance foot's
backward slide is set by its illustrative stance keys, not by a pace. Tying the slide to the
measured stride would rework the contact geometry the other bindings depend on, so the stride is
drawn only as its bracket, like cadence is drawn only as its beat. The intro gives it no step.

**D4. Geometry.** The bounce bracket is the existing one (hip-mid's height range, x = −0.4). The
stride bracket runs 0.15 under the ground from the near foot's first contact point to that point
plus `strideLength` (contact to the same foot's next contact), with end ticks and a plumb from the
contact. The label (vertical ratio, then "bounce ÷ stride") hangs below its middle; tags "bounce"
(left of the bounce bracket) and "stride" (above the stride's middle) name the inputs without
values, so the figure states no number the stop does not.

**D5. `strideSide` camera, framed on the values** (as `landingSide`): side on, zoomed so the
figure, the bounce tag's room and the whole stride fit the 3 × 4 viewBox with projected label pads.
At a typical 6 torso-length stride the figure is about a quarter of the frame tall: the ratio's true
proportion.

**D6. Focus.** The tour's rhythm stop focuses its headline plus vertical ratio wherever the stop
states it as its secondary value (previously headline only); a VR headline focuses VR alone. Any
focus that draws the stride takes `strideSide` (`runnerViewFor`). The summary's rhythm row focus
already lists every member; it gets the same camera rule.

## Risks

- Where fusion picks VO and VR from different clips (the 3-clip demo today: VR clip 1, VO clip 2),
  the stride is unknown and nothing new is drawn, consistent with the From line's own guard.
- A camera tween between the stride frame and the sandbox-only 3× foot frame needs 400 steps in the
  continuity test.
