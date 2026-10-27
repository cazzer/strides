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

### D9. No inverse kinematics; feet and proportions are illustrative (superseded by D15)

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

### D14. Intro beat (ps19.3)

`useRunnerIntro({ bound, resultKey, order, camera, active, onDone })` returns
`{ overrides, running, skip }` and drives ModelRunner only through the D13 seam plus two props:
`intro: { running, onSkip }` and `onActiveChange(active)`.

**Plan.** `planIntro` orders the measured parameters (focus first via `paramForMetric`, then spec
order; landing always before foot strike) and drops from the steps any whose change the camera
cannot show (step width and swing-foot arc when |sin yaw| < 0.5); those are held neutral and
arrive with the final state. Step length is 4500 / n within 450..1000 ms (the floor is 450, not
500, so a front view's ten steps still fit 4.5 s). The plan (steps, bound values, flash texts,
step length) is snapshotted when step 0 begins, so the scale-pass graft changing `bound`
mid-intro cannot shift step indices: every parameter is drawn at its snapshot value (a newly
measured one included) until the end, and the final state (`overrides` undefined) draws the live
`bound`. A plan with no steps finishes at once, with no hold. `camera` is a required input, the
same one ModelRunner gets, so the plan and the drawing can never disagree about the view.

**Length (deliberate).** About 5 s in all: the 500 ms neutral hold, then at most 4.5 s of
steps. The hold lets the reader see the neutral figure before anything changes; the 4.5 s keeps
each step at or above 450 ms with all ten parameters visible.

**Sequence.** A 500 ms fully neutral hold, then step i: `overrides.values` holds every parameter
at its snapshot value, and every not-yet-applied measured parameter at its neutral constant, its
own `sources` entry flipped to measured, and `valueTween = { from: neutral, to: value, durationMs,
key: String(i) }`, which the loop moves on wall-clock time. Each step is armed from the previous
step's actual start inside the timer callbacks (progress kept in a ref), never waiting on a React
commit; a re-armed effect (a reduced-motion flip) resumes the current step where it is. A flash
clears after 500 ms unless that would leave under 150 ms of its step, in which case it stays the
whole step (no blink). About 2n + 1 commits per run.

**Seen first.** The hold starts only once `active` (tab visible and figure on screen, from
`onActiveChange`, which also reports false on unmount from an unmount-only cleanup); leaving
during the hold restarts it. Once step 0 has begun the timers keep
running while unseen, which matches the renderer's wall-clock tween.

**Once per result.** `resultKey` is a string (an analysis-run or session id): the fused result
object is rebuilt on every session render and when the scale pass lands. A module-level Set marks
a key when step 0 begins, from the hold's timer, so StrictMode's simulated unmount (which clears
it) and a runner never seen never mark it. A remount with a played key draws the final state and
does not fire `onDone`: `onDone` is a one-shot side effect, and UI derives from `running`. Reduced
motion never starts the intro; it marks the key and fires `onDone` once.

**Legibility.** While a parameter tweens, its focus annotation is hidden and only its flash shows
(no duplicate label, no arc drawn at the neutral geometry being left). The flash anchors on a
fixed world point per parameter from the still-frame pose (`introFlash.ts`: near ankle for foot
strike and swing arc, ground under the hip for landing, hip for bounce and step width, torso
midpoint for lean, near shoulder for arms, near knee for thigh and knee bend, above the head for
cadence). It starts a gap after its anchor, except the lean flash, which ends a gap before it on
the torso's back side (opposite the projected direction of travel) so it never sits on the arms.
It is moved below, or at the frame's foot above, any visible annotation label, mark or guide box,
with half a line of clearance. The
legend reads "Dashed: not applied yet" while the intro runs. Pause mid-intro skips it, so the
still figure is the final one. The button reads "Skip intro".

**Accepted transient.** Mid-intro values mix bound values and neutral constants, which
`realizeParams` never resolved; `poseAt` resolves contact-leg conflicts in default order, so an
applied foot strike or thigh peak can draw slightly off its label until the stronger contact
parameters on its leg are applied. Landing before foot strike removes the foot-strike case when
both are measured; the thigh-peak case remains. The end state is exact.

### D15. The stance foot is pinned to the ground (ps19.4)

Supersedes D9's unpinned foot. Measured on the old code: the neutral foot was 0.079 up at contact,
0.081 at mid-stance and 0.120 at toe-off.

**Hybrid design.** The figure's height is solved per parameter set, `pelvisHeight(params)`, so the
contact foot's lowest point is exactly on y = 0. The bounce keeps its exact peak-to-peak but changes
shape: a half-cycle-periodic cosine-eased curve keyed at the half-cycle phase (so keys are hit
exactly), lowest at mid-stance (0.19), highest at the flight peak (0.44), and `STANCE_DROP` = 0.04
torso lengths above its lowest at contact and toe-off (or at the flight peak when the bounce is
smaller). The stance leg (0, 0.38] is two-segment IK: the ankle slides back linearly from its
contact x to a toe-off x (where a knee of `KNEE_TOE_OFF_DEG` = 28 reaches the ground with the foot at
its toe-off key), at the height that puts the foot's lowest point on y = 0. Where the leg cannot
reach down, the heel lifts onto the toe. The swing is the old forward-kinematic curves, starting
from the stance solve's toe-off angles. Contact (q = 0) is drawn from the contact geometry itself,
so the contact-instant bindings stay exact to 1e-9.

**The bindings outrank the pin**, through three clamps: the stance knee is capped at
min(peak swing bend − 5°, max(toe-off, contact bend) + 18°), so stance never forms a second
prominent knee-flexion maximum (prominence 20°); the leg cannot over-extend; and the stance thigh is
capped at min(max(thigh peak, contact thigh), contact thigh + 5°), so stance never forms a second
prominent thigh maximum (prominence 10°). Where a clamp engages, the mid-stance foot sinks; the
contact foot never floats. Each clamp is a min/max of continuous functions, so the pose stays
continuous in the parameters.

**Rejected.** (a) Stance IK alone with the old cosine bounce: the hips are at their highest at
contact, so the stance knee has to bend 45° more to reach down; the stance knee becomes a prominent
peak, kneeFlexion is off by 45°, and 959 of 1023 corners fail. (b) Hip height derived from the
stance leg: vertical oscillation is no longer exact on the 1/1000 sampling grid, and a bounce
smaller than the leg's own stance range cannot be drawn.

**Measured** (left foot's lowest point, (0, 0.38] at 1/1000; `realizeParams` defaults):
- neutral: 7.6e-16; contact at every one of the 1024 range corners and 64 leg corners: < 3e-16;
- declared domain, 2700 sets (bounce 0–0.3, landing −0.1–0.3, foot strike −0.2–0.3, thigh peak
  15–85, knee bend 60–150, step width −1–1.5): worst 0.0047 (landing 0.3, thigh peak 15, step
  width −1); swing foot never lower than −0.0031;
- the 32 landing −0.3 corners: worst 8e-9; swing foot −0.004;
- the 32 landing 0.7 corners (fallback): stance worst 0.124, swing foot −0.172, every binding exact
  (kneeDrive within 0.031, kneeFlexion 3e-14, VO 2e-16);
- neutral pelvisHeight 1.80903 vs the nominal `PELVIS_HEIGHT` 1.8066 the camera presets frame on.

**Deviations from the ps19.4 plan.**
1. The plan's thigh clamp max(thigh peak, contact thigh) let 8 of the 64 leg corners (landing 0.7,
   foot strike 0.4, thigh peak 85) grow a second prominent thigh maximum in stance (the thigh rose
   11° above contact), taking kneeDrive's median to 62° against a bound 85°. Added the
   contact + 5° cap (`STANCE_THIGH_RISE_MAX_DEG`); every corner's kneeDrive is now within 0.031.
2. The plan's domain was landing ≤ 0.35; at 0.35 with a 15° thigh peak (which gives way to the
   contact thigh, so the thigh clamp leaves the stance thigh no room) the pin misses by up to 0.0123.
   The declared domain is landing ≤ 0.3, the values the planner's grid actually covered.
3. `STANCE_DROP` stays 0.04 (the plan's first choice): the stills and playing shots read as a run,
   with a planted stance foot, so the 0.07 fallback was not needed.

**Known limit.** A straight contact knee (landing exact, foot strike given way) makes the stance
knee bend like √q just after contact, since IK from a straight leg is singular there. The pose is
continuous (worst joint step 0.039 per 1/4000 cycle, at a landing 0.7 corner) but the first
millisecond after contact moves fast.

**Review round 1 (ps19.4).**
- `STANCE_DROP` is now 0.10 (was 0.04) and a small bounce keeps a sinusoid's shape (its contact
  and toe-off value is capped at the sinusoid's, −cos(4π·0.19) = 0.729). Measured at 30 fps, as the
  largest per-frame hip change over a sinusoid's (b·sin 2πΔp, Δp = cadence/120/30) and the spread of
  per-step hip peaks over 12 steps: b ≤ 0.10: 1.12–1.13×, spread ≤ 0.055b; b = 0.14 (neutral):
  0.93–0.98×, spread ≤ 0.115b. Tested ≤ 1.3× and ≤ 0.12b for b ≤ 0.14.
- **Known limit, b > 0.14.** Stance is 0.38 of the cycle and the knee-flexion prominence rule caps
  how far the hips can travel with the foot planted, so whatever bounce exceeds `STANCE_DROP` must
  happen in 0.12 of a cycle of flight. Measured: b = 0.17: 1.24–1.41×, spread 0.13–0.17b; b = 0.2:
  1.51–1.71×, 0.16–0.20b; b = 0.3: 2.0–2.3×, 0.21–0.27b; b = 0.5: 2.4–2.7×, 0.25–0.32b (regression
  test ≤ 2.8×, ≤ 0.35b). Fixing it needs a shorter stance (follow-up bead).
- Neutral mid-stance knee (left leg, phase 0.19, the metric's formula): 39.4° (28.0° before).
- The neutral pelvis height is now 0.058 below the nominal `PELVIS_HEIGHT`; the camera presets are
  unchanged.
- Swing foot: the foot angle is clamped so heel and toe stay above the ground, the swing knee holds
  80 % of its bend to phase 0.76, and in mid-swing it bends further (never past the bound peak) when
  the ankle would come within a sole's depth of the ground. Swing lowest point ≥ −0.005 over the
  declared domain (thigh peak 20 added) and at landing ≤ 0.512 with swing bend ≥ 100 and step width
  ≥ 0.3; a 50° swing bend, crossed legs (step width −1.5) or landing ≥ 0.6 can still dip to −0.188.
- Landing 0.7 corners: stance sink 0.181 (was 0.124), swing dip 0.188 (was 0.172).
- **Open:** at landing 0.35, swing bend 50, step width −1.5, foot strike 0.4 (drawn 0.175), thigh peak
  10 (drawn 13.5), bounce 0, kneeFlexion reads 11° off its bound. Present on the round-0 model too
  (af7eee70); found by the per-landing sweep, not yet diagnosed.

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
