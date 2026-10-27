## Context

`src/runner/` is the contract under every later runner ticket: `poseAt(phase, params)` gives the
figure, `bindRunnerParams(metrics)` says what drives it, `camera.ts` frames it. It is pure
TypeScript with no React and reads `src/heuristics/**` for types only. The honesty rules come from
`docs/prd/runner-led-results.md` ("Honesty rules for the model").

## Decisions

### D1. Every parameter is stored in its metric's own unit; binding is identity plus a clamp

Each degree of freedom is realized so that applying the binding metric's own formula
(`src/heuristics/<metric>.ts`) to the model's joints returns the parameter's value. Binding is
therefore `value = metric.value × scale`, clamped to a drawable range, with `scale = 1` everywhere
except the `verticalOscillationCm` fallback (D6). The testable rule is **"measuring the model
returns the bound value"**: `gaitModel.test.ts` applies each metric's formula to `poseAt` output
(side view reads x/y, front view reads z/y) and checks it against the parameter.

| metric (unit) | parameter | realization |
|---|---|---|
| cadence (steps/min) | `cadence` | `cyclesPerSecond = cadence / 120`; no geometry |
| verticalOscillation (hip p2p / torso) | `pelvisBounce` | hip-mid y = H0 − (B/2)·cos(4π(p − 0.19)) |
| ↳ verticalOscillationCm, only when the ratio is unmeasured | `pelvisBounce` | ÷ 50 cm (D6) |
| trunkLean (deg, + toward travel) | `torsoPitch` | shoulder-mid = hip-mid + (sin λ, cos λ, 0) |
| armSwingAmplitude (wrist−shoulder y p2p / torso) | `armSwing` | rigid bent arm, closed-form amplitude |
| kneeDrive (deg, hip→knee off down-vertical) | `peakThighAngle` | thigh keyframe at q = 0.85 |
| kneeFlexion (deg, 180 − interior, swing peak) | `peakSwingKneeBend` | knee keyframe at q = 0.62 (D2) |
| overstriding ((ankle − hip-mid).x / torso at contact) | `landingOffset` | contact solve (D4) |
| footStrikePattern ((ankle − knee).x / torso at contact) | `contactShankOffset` | contact solve (D3, D4) |
| stepWidth (fraction of hip width) | `stepWidth` | outward leg tilt (D10) |
| swingFootLateralExcursion (fraction of hip width) | `swingFootArc` | extra swing-shank tilt (D11) |

`verticalRatio` and `stepWidthCm` bind nothing. `stepWidth` and `swingFootLateralExcursion` report
unit `'percent'`, which in this codebase is a 0..1 fraction (here, of hip width), so they bind into
hip widths with `scale = 1`. There is no `stepWidthCm` fallback for `stepWidth`.

Every bound `value` is exactly what the model draws. Out-of-range values clamp, and a contact
parameter can give way to a stronger partner (D4); either way the bound parameter carries
`clamped: true` alongside the metric's own `metricValue`, so a renderer labels the true number and
knows the drawing sits at a limit. The tested invariant is that measuring the model drawn from
`runnerParamValues(bound)` returns every `bound[id].value`, and that a measured `value` differing
from `metricValue × scale` is always `clamped`. The peak metrics (kneeDrive, kneeFlexion) are
measured in the tests with the heuristics' own `findLocalExtrema` and `median` (read-only, test-only
imports), not as a cycle maximum.

### D2. kneeFlexion is a swing angle

`kneeFlexion.ts:213` converts the per-frame interior angle to flexion (`180 − interior`),
`kneeFlexion.ts:160-166` explains that the series' prominent maxima are the swing-phase
heel-toward-glutes peaks, `kneeFlexion.ts:245` keeps only maxima, and `kneeFlexion.ts:273` reports
their median. `kneeDrive.ts:162` describes it the same way ("swing-phase knee BEND"). So it binds
the peak swing knee bend. The model's knee curve has keys [0: κc ≤ 30°], [0.19: 30°], [0.38: 22°],
[0.62: peakSwingKneeBend], [0.90: 15°], and the parameter's floor (50°) is above every other key.
The contact bend is capped at the mid-stance key (30°), so late swing → contact → mid-stance never
forms a second maximum: the metric's prominence scan (20°) then finds one maximum per leg per cycle,
at the bound value. An earlier 45° cap let contact become a second prominent maximum and pulled the
median well below the bound value (review round 1).

### D3. footStrikePattern binds the contact shank offset exactly

The metric is ankle-ahead-of-knee at contact over torso length (`footStrikePattern.ts`), a proxy,
not a foot angle. The model binds that offset directly (`contactShankOffset`) rather than inventing
a foot angle from it. The foot's pitch at contact is set equal to the shank angle, an illustrative
choice that makes a positive offset read as toes-up.

### D4. Contact conflicts: measured beats neutral; landing, then foot strike, then thigh peak

Three parameters share the contact leg. `landingOffset` and `contactShankOffset` fix the contact
thigh and shank angles, and the measured knee drive reads the larger of the swing peak and the
contact thigh angle, so `peakThighAngle` needs the contact thigh at or below it. Not every
combination can be drawn: the contact knee bend must lie in [0°, 30°] (no hyperextension, D2), so,
for example, a shank offset larger than about half the landing offset, or a landing offset at or
behind the hip, conflicts. Those are common on real numbers (overstriding near −0.04..0.05, foot
strike near ±0.03–0.1).

`realizeParams(params, measured)` resolves this by precedence and returns the conflict-free set the
model draws:

- **A measured parameter beats a neutral one.** A neutral partner gives way, so a lone measured
  value is always drawn exactly. Example: foot strike measured at 0.2 with landing neutral at 0.3
  draws 0.2 and moves the neutral landing to fit.
- **Among measured (or among neutral) parameters, the order is landing offset, foot strike, thigh
  peak.** Both offsets measured at (0.05, 0.10) draw the landing exactly and the foot strike at
  0.025; knee drive measured at 12° with a measured landing of 0.3 draws about 15°.
- A parameter that gives way is drawn as close to its request as the stronger ones allow (the knee
  bend is clamped at the boundary it crossed). In the one case where the thigh peak outranks both
  offsets and even a straight leg lands too far ahead, the leg stays straight at the thigh peak and
  both neutral offsets give way, which keeps the drawn values continuous in the inputs.

`bindRunnerParams` applies this, so every bound `value` is what is drawn: a measured parameter that
gave way carries the drawn `value`, `clamped: true` and its true `metricValue`; a neutral one that
gave way stays `source: 'neutral'` with its constant adjusted to fit (it may then sit outside the
nominal drawable range, which only bounds measured values). `poseAt` itself, called with raw
parameters (for instance a tween), resolves any conflict with the default order (landing exact,
foot strike gives way, thigh peak reads as the contact thigh) and stays continuous.

### D5. Neutral constants are illustrative and never a target

| parameter | neutral | drawable range |
|---|---|---|
| cadence | 160 steps/min | [120, 220] |
| pelvisBounce | 0.14 (7.0 cm on the 50 cm model torso) | [0, 0.5] |
| torsoPitch | 4° | [−15, 35] |
| armSwing | 0.30 | [0, 0.9] |
| peakThighAngle | 40° | [10, 85] |
| peakSwingKneeBend | 90° | [50, 150] |
| landingOffset | 0.30 | [−0.3, 0.7] |
| contactShankOffset | 0.08 | [−0.3, 0.4] |
| stepWidth | 0.30 hip widths | [−1.5, 1.5] |
| swingFootArc | 0.15 hip widths | [0, 0.8] |

None is a reference-band midpoint, envelope midpoint or published central value: a test computes
those from `METRIC_GUIDANCE` and requires every neutral (in its metric's unit) to sit more than 1%
away (cadence 160 vs the 153–163 zone's 158; VO_cm 7.0 vs 7.75 and 7.7; trunk lean 4 vs 11.6 and
10.3; knee flexion 90 vs 100.15 and 94.1). Each also differs from the shared fixture defaults. The
ranges are what the stick figure can draw, not plausibility judgements.

### D6. The centimetre fallback for bounce uses the model's own torso

When `verticalOscillation` is null or excluded and `verticalOscillationCm` is measured, the bounce
is `cm / MODEL_TORSO_LENGTH_CM` (50 cm, illustrative). Both candidates belong to one parameter, so
one value still drives one degree of freedom.

### D7. Segments: measured if any parameter listing them is measured

`RUNNER_PARAM_SEGMENTS` lists, per parameter, the `SKELETON_EDGES` it shapes (reused from
`src/results/skeletonGeometry.ts`, which already carries the foot triangles). `segmentSource` reads
an edge as measured if any parameter listing it is measured. Head edges belong to no parameter and
are always neutral. Cadence shapes no segment.

### D8. Camera conventions and presets

Orthographic. Yaw ψ: right r = (cos ψ, 0, −sin ψ), toward-camera c = (sin ψ, 0, cos ψ). Pitch e
(camera above): c' = c cos e + y sin e, up' = y cos e − c sin e. A point P projects to
x = zoom·((P − target)·r), y = −zoom·((P − target)·up') (SVG, y down), depth = (P − target)·c'.
Yaw 0 is the side view from the runner's right with travel screen-right; yaw 90 is the front view
with the runner's left on screen right. `interpolateCamera` clamps t, takes yaw the shorter way
round, lerps pitch and target, and interpolates zoom geometrically. Frames are sized for
±`CAMERA_FRAME_HALF_HEIGHT` = 2.

| preset | yaw | pitch | zoom | target |
|---|---|---|---|---|
| wholeBodySide | 0 | 0 | 1 | (0, head top / 2 ≈ 1.61, 0) |
| upperFrontQuarter | 45 | 5 | 1.7 | (0, H0 + 0.6 ≈ 2.41, 0) |
| torsoSide | 0 | 0 | 1.8 | (0, H0 + 0.5 ≈ 2.31, 0) |
| legsSide | 0 | 0 | 1.4 | (0, H0 / 2 ≈ 0.90, 0) |
| footSide | 0 | 0 | 3 | (0.25, 0.25, 0) |
| feetFront | 90 | 0 | 2.4 | (0, 0.35, 0) |

### D9. No inverse kinematics; feet and proportions are illustrative

Curves are periodic cosine-eased keyframes (exact at keys, C1, no overshoot). The stance foot is
not pinned: it lifts about 0.12 torso lengths over stance. `PELVIS_HEIGHT` (H0 = 1.8066) is tuned
once so the neutral runner's lowest foot point over the cycle is on the ground; it is fixed rather
than solved per pose, because solving it would let a leg parameter move the torso. At range
extremes the feet can float or dip below the ground line.

### D10. Step width tilts each leg segment outward by one angle (deviation from the plan)

The plan rotated the whole leg about the hip's travel axis. That rotation changes each segment's
side-view direction (y shrinks, x does not), so it would have moved the side-view knee flexion,
knee drive and foot-strike readings; and its lateral contribution to ankle − knee varies with the
shank angle through swing (about 0.09 hip widths at the neutral width, about 0.3 at the range ends),
which would break the swing-arc reading. Instead each segment is `cos a·(sagittal direction) +
sin a·outward`, with one angle a for thigh and shank and sin a = (stepWidth − 0.5)·W / (T + S).
Segment lengths are preserved, side-view directions are unchanged (lengths scale by cos a), and the
contact solve uses the scaled lengths, so every side-view binding stays exact. The contact ankle's
outward offset from the midline is exactly stepWidth·W.

### D11. The swing arc tilts the shank, not just the foot (deviation from the plan)

The plan shifted the ankle, heel and toe sideways without the knee, which stretches the shank (by
up to about 10% at the top of the range) and breaks constant segment lengths. Instead the shank
alone gets extra outward tilt with sin aₛ(q) = sin a + e·bump(q), where bump is a raised cosine over
q ∈ [0.5, 5/6] (the metric's window: from the other foot's contact, terminal third excluded). The
ankle-minus-knee lateral offset is then S·sin a + S·e·bump(q), whose P80 − P20 over the window is
S·e·cos(π/5); e is chosen so that equals swingFootArc·W. The foot translates rigidly with the
ankle. Measured within 0.005 hip widths at any step width. Consequence: `swingFootArc` moves the
ankles, heels and toes in x and y slightly as well as z, not z only. The arc swings outward,
illustratively.

### D12. Smaller deviations from the plan

- Mid-stance knee key 40° → 30°: at 40° the stance foot lifted about 0.19 torso lengths over
  stance; 30° minimized that lift (0.12) and stays below the 50° knee-bend floor. The contact knee
  cap now equals this key (D2).
- The arm-swing check reads the raw peak-to-peak of wrist − shoulder height; the metric fits a
  sinusoid, and the model's drop is the cosine of a sinusoid, so a fitted amplitude could differ
  slightly from the raw one.
- `PELVIS_HEIGHT` is exported so the camera presets derive their targets from it; the arm's mean
  angle (48°) is `MODEL_PROPORTIONS.armCentreDeg`.

### D13. Renderer (ps19.2)

`ModelRunner.tsx` renders the fixed SVG element set once per prop/state change; one rAF loop writes
geometry onto those elements (queried once per render, never per frame), so React never re-renders
per frame. The loop is created once and started/stopped by a "kick" after every render: it runs
while the figure is visible, on screen, and has something to move (playing, a camera tween or a
value tween), so a rate or camera change never restarts it. Pacing: a frame draws when
`now >= nextDue - 1.5 ms`, and `nextDue` advances by exactly 1000/30 ms per draw (reset to
`now + 1000/30` after a stall), so the long-run rate never exceeds 30 fps and a 60 Hz display draws
every other frame. Phase is integrated (`dt` capped at 100 ms); the first frame after any (re)start
only sets the clock. Pure rules live in `runnerScene.ts` (styles, opacity, draw order, text
alternative, label layout, value-tween mixing) and `runnerAnnotations.ts` (`planAnnotations`: held
phase and annotation geometry; labels from `metricValue` via the widened `formatGuidedValue`).

**Annotations hang off the live figure (review round 1).** Each limb parameter has a key LEG phase
(`KEY_LEG_PHASE`: thigh peak, swing knee peak, contact, mid swing-arc); its annotation is built on
that pose. The still frame (reduced motion, paused, first frame) holds the FIRST annotated focus
parameter's key phase on the annotated leg, so that limb lies exactly on its mark; without a keyed
focus it holds mid-stance. A still figure moves to a new focus's held phase; a playing one is never
jumped. Reduced motion switching on with no reader choice returns the figure to the held phase.
The held phase is always taken on the leg a side view calls near (cos yaw >= 0: right), front
views included, so turning a paused camera from side to front never moves the figure by half a
stride (review round 2). Side views annotate the near limbs; front views (|cos yaw| < 0.5) put each
limb mark on the leg whose key phase is nearest the held phase (the held leg for the first), arms on
the stance side. A FOCUS change while still can change the held phase; that snap is accepted
because the figure is not moving. While still, a limb mark whose key phase is not the held phase is
not drawn (`shownWhileStill`): only the first keyed focus parameter's limb is at its key phase, and
a second arc would float off the figure (review round 2). Its value stays in the text alternative,
and every mark is drawn while the figure plays, since the live limb passes through each. No limb-shaped guide is drawn: the first version drew ghost
thighs, shanks and contact legs beside the runner, which read as a target pose (PRD honesty rule 3,
strides-v2d). Guides are now short reference rays (arc radius + 0.12) and extension ticks.

**Intro seam.** `overrides: { values, sources, flash }` are discrete (one render per change);
`overrides.valueTween: { from, to, durationMs, key }` is interpolated linearly by the loop. Its
progress is wall-clock time since the key first appeared (`performance.now()`), shared by the
drawing and the cadence integration through one helper (`valueTweenProgress`; a non-positive
duration is finished), so it stays in step with the intro hook's timers and, after a hidden or
offscreen stretch, resumes at the right progress. It runs while paused (like a camera tween), jumps
to `to` under reduced motion, and holds `to` exactly while the same key is passed. The key is the
identity: the same key with a different `to` is ignored. When the tween ends between frames the
loop draws its end state once before stopping.
ps19.3 should drive each parameter's tween through `valueTween` and flip `sources`/`flash` per
step. Without any override exactly `bound` is drawn.

**Visual decisions.** Measured far-side parts dim to 0.75; while a focus is shown, unfocused
measured parts recede to 0.7 and focus strokes widen to 6 px (a cue that is not hue alone, for dark
mode); neutral dashes are never dimmed, so they keep their >= 3:1 contrast. Forced colours map
measured to CanvasText, neutral to GrayText, focus and marks to Highlight, label halo to Canvas. The
ground line is drawn at the lowest foot point over the cycle (illustrative: the model has no IK, so
away from the neutrals the feet can dip or float relative to y = 0). The clamp note on the visible
label is "shown approximately"; the text alternative keeps the full sentence. The "Dashed: not
measured" legend shows only when a neutral edge is in frame at the held phase.

Deviations from the ps19.2 plan:
- Annotation paths are split into `marks` (accent), `fills` (an arc's faint wedge) and `guides`
  (short reference rays and extension ticks), instead of one `paths` list.
- `planAnnotations` replaces `buildAnnotations`: it takes `sources` and the target camera yaw, and
  returns the held phase with the annotations.
- Labels are placed by `side` (above/below/left/right of an anchor, 6 px gap) instead of a free
  `dx/dy`, break "% of torso length" and the clamp note onto their own lines, and are kept inside
  the frame by an estimated text width (screenshots at 390 px showed single-line labels shoved over
  the figure by the frame edge). Arc labels sit at an arc end outside the wedge.
- Neutral dashes use butt caps (round caps closed the 5 px gaps); solid strokes stay round.
- The stage clips (`overflow-hidden`) instead of `overflow: visible`: zoomed presets project most
  of the body outside the viewBox, which would otherwise paint over the page.
- The figcaption is the figure's first child (HTML requires first or last), above the drawing; the
  legend and the button (with an aria-hidden play/pause glyph) share the row below.
- No `aspect-[3/4]` fallback for an unsized figure: with `flex-1` on the stage, an aspect ratio
  does not give a column-flex child a height when the figure has none, so the consumer must size
  it through `className` (documented on the component).

## Risks / Trade-offs

- When two measured contact parameters conflict (D4), the weaker one is drawn away from its
  measurement. It is flagged (`clamped: true`, `value` = what is drawn), and ps19.2 labels
  `metricValue`, so the number shown stays true; the renderer marks it "shown approximately". A neutral partner adjusted to fit is still drawn as neutral.
- ps19.2/.3 must integrate phase over time (`phase += dt · cyclesPerSecond · rate`); reduced motion
  can use `poseAt(GAIT_PHASES.midStance)`.
- ps19.3's intro tweens measured parameters from `NEUTRAL_RUNNER_PARAMS` to `bound.value`, with the
  neutral ones held at `bound.value`. Intermediate mixes go straight to `poseAt` (not through
  `realizeParams`), which stays finite and continuous on any convex mix (tested); only the endpoint
  is guaranteed conflict-free.
- `interpolateCamera` returns yaw normalised to [0, 360), and the presets are frozen.
