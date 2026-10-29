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
lengths, as the From line does. A clamped stride is marked clamped ("shown approximately"). See D7
for which clip's bounce.

**D3. The stride moves no joint.** The model is a treadmill (hip-mid at x = 0); its stance foot's
backward slide is set by its illustrative stance keys, not by a pace. Tying the slide to the
measured stride would rework the contact geometry the other bindings depend on, so the stride is
drawn only as its bracket, like cadence is drawn only as its beat. The intro gives it no step.

**D4. Geometry (revised by D8).** The stride bracket runs 0.15 under the ground from the near
foot's first contact point to that point plus `strideLength` (contact to the same foot's next
contact), with end ticks and a plumb from the contact. The label (vertical ratio, then "bounce ÷
stride") hangs below its middle; the tag "stride" sits above its middle. Tags carry no values, so
the figure states no number the stop does not.

**D5. `strideSide` camera, framed on the values** (as `landingSide`): side on, zoomed so the
figure, the bounce tag's room and the whole stride fit the 3 × 4 viewBox with projected label pads.
At a typical 6 torso-length stride the figure is about a quarter of the frame tall: the ratio's true
proportion.

**D6. Focus.** The tour's rhythm stop focuses its headline plus vertical ratio wherever the stop
states it as its secondary value (previously headline only); a VR headline focuses VR alone. Any
focus that draws the stride takes `strideSide` (`runnerViewFor`). The summary's rhythm row focus
already lists every member; it gets the same camera rule.

**D7. The stride's bounce comes from vertical ratio's own clip** (follow-up, user's pick).
Fusion picks each metric's clip independently; on the 3-clip demo vertical ratio won on clip 1 and
the relative bounce on clip 2, so the same-clip guard left the stride unsaid and nothing was drawn.
Vertical ratio's clip measured its own relative bounce from the same hip fit, so the session reads it
off that clip's per-clip result (`ratioClipBounceFor(clips, sourceIndices)`, beside where
`sourceIndices` is built) and passes it down as `ratioClipBounce`. `bounceDerivation` takes it in
place of the fused relative bounce (same fit and tier guards; same clip by construction), so the
From line, the stride binding and the drawing all cite it. Presentation only: `fuseHeuristics.ts`
and `multiClipAnalysis.ts` are untouched; every fused value and clip choice is unchanged (unit test
with frozen inputs; live base-vs-branch comparison on the demo). The figure's own hip motion keeps
the fused bounce.

**D8. The bounce is drawn as a magnified inset** (follow-up, user's pick). At true scale beside its
stride a 2–4% bounce is a few pixels on a phone. The stride stays true to scale; the bounce is a
vertical bracket ten times the bounce (`BOUNCE_INSET_FACTOR`), standing 0.6 above the ground three
quarters along the stride, tagged "hip bounce ×10". Its bounce is vertical ratio × the drawn stride,
which is the measured bounce on vertical ratio's clip whenever the stride is unclamped, so inset ÷ 10
÷ stride is vertical ratio exactly. The true-scale bracket at the hips is not drawn with it: under D7
it can differ from the figure's (fused) hip range, and the bounce is drawn once. The stride camera
frames the inset's top as well.

**D9. Review round 1.** The text alternative never lists the neutral stride among the fixed
settings (`drawnWhenNeutral: false`): nothing draws it, so a measured-but-unsaid or excluded vertical
ratio is not "not measured". Where the bounce heads the focus (cadence excluded), its true-scale
bracket stays beside the inset: two marks at two scales, and the headline keeps its mark; the stride
frame keeps room for that bracket's label. The inset is capped at 3 torso lengths and says "shown
approximately" past it. The per-clip bounce is a plain `MetricResult` tiered by each reader's own
tier function. Non-finite bounces give no figures. The one-thing stop takes the stride camera when
its cue is vertical ratio with a stride.

## Risks

- The inset is not a reading of the figure's hips: where fusion took the relative bounce from another
  clip, the figure's hip range (the fused bounce) and the inset (vertical ratio's clip) can differ.
  The summary states both values on their own cards.
- A camera tween between the stride frame and the sandbox-only 3× foot frame needs 400 steps in the
  continuity test.
