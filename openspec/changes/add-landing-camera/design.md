## Context

The model runner (archived change `2026-10-27-add-model-runner`, design D1 to D15) is a treadmill:
hip-mid stays at x = 0, so for one parameter set the near foot's contact point is fixed in the
world. ps19.4 (D15) pins the contact foot's lowest point exactly to the ground. Both landing
metrics read the ANKLE: overstriding is `ankle.x − hipMid.x` (`overstriding.ts`) and foot strike is
`ankle.x − knee.x` (`footStrikePattern.ts`).

## Goals / Non-Goals

**Goals:** a Landing view that always shows the landing, marks that meet the points the metrics
read, and a reduced-motion still with the foot on the ground.

**Non-Goals:** any change to `gaitModel.ts`, `runnerParams.ts` or the bindings. No change to
ModelRunner's props.

## Decisions

### D16. Contact-tracking landing camera (ps19.5)

- **World-fixed per parameter set, not per frame.** Because the model is a treadmill,
  `landingCamera(values)` is computed once per set of static values (bound plus
  `overrides.values`, never mid-tween values). ModelRunner turns it into a camera key, so the
  existing tween effect retargets on a bound change, and under reduced motion it cuts. The
  `landingSide` preset is the neutral frame, so `resolveCamera('landingSide')` still works.
- **Framing.** Height: from `LANDING_FRAME_ABOVE_HIP` (0.25) above hip-mid's highest point over
  the window (sampled with the reach; a big bounce lifts hip-mid well above its contact height,
  so a contact-only top would crop it) to `LANDING_FRAME_BELOW_GROUND` (0.4) below the ground,
  which fills the frame (zoom ≈ 1.65 at neutral). The margin was 0.15 in the first round. At
  0.25, the 390 px tour's "Slow motion" chip no longer sits on the hip and thighs (the hip moves
  down about 12 px, with its dot just under the chip), and the figure at 1280 is about 4%
  smaller. Width: see the deviation below.
- **Phase window.** `LANDING_PHASE_WINDOW = { start: 0.35, length: 0.25 }` runs from 0.15 of the
  right leg's own phase before its contact (cycle 0.5) to 0.10 after it (see the sink below). `advancePhase(phase, delta, window)` loops
  inside the window. From outside, it plays on until it reaches the window (Q5: enter by playing
  on), with a 1e-9 tolerance so rounding at the window's end never drops the phase out.
- **Holds (review round 1, overriding Q4's "no hold").** `PhaseWindow.holds` lists wall-clock
  rests: `LANDING_CONTACT_HOLD_MS` (300) on the exact contact frame, and `LANDING_END_HOLD_MS`
  (150) on the window's last frame. `stepPlayback({phase, holdLeftMs}, stepMs, cyclesPerSecond,
  window)` stops a step exactly on a hold it would pass, rests for the hold's ms (wall-clock, so
  the 0.4× rate does not stretch it), then plays on with the rest of the step. A phase resting on
  a hold is no longer before it, so each hold is taken once per pass. Playback never runs
  backwards. A loop at the demo's cadence and 0.4× is about 0.45 s of motion plus 0.45 s of rests.
  In the real app (1280 and 390) the longest still stretch measured 333–335 ms, with 47–50
  distinct frames drawn in 3 s.
- **The restart jump is not reducible by moving the window; it is softened, not shrunk.** From the
  window's end (0.60, early stance) back to its start (late swing) the near foot jumps from under
  the hip to ahead of it, and the far foot from toe-off forward. Largest joint displacement, in
  viewBox units (×≈100 px at 1280, ×≈84 at 390), for window starts against end 0.60 (last column:
  end 0.58, start 0.44), at the round-1 framing margin of 0.15:

  | landing | 0.35 | 0.38 | 0.40 | 0.42 | 0.44 | 0.58→0.44 |
  |---|---|---|---|---|---|---|
  | 0.3 (neutral): max / near ankle | 1.17 / 1.16 | 1.42 / 1.41 | 1.31 / 1.30 | 1.09 / 1.07 | 0.89 / 0.85 | 0.86 / 0.75 |
  | 0.508 (demo): max / near ankle | 1.02 / 0.78 | 1.12 / 1.05 | 1.09 / 1.05 | 1.02 / 0.96 | 0.93 / 0.86 | 0.88 / 0.72 |

  A later start trims the largest jump by at most about 24% at neutral and 9% at the demo's
  overstride. It makes the demo's near-ankle jump bigger (0.78 → 0.86–1.05), and it cuts the
  descent the window exists to show. So the window keeps its start, and the restart is softened by
  the end hold instead: the figure rests, then cuts, which reads as a replay. The displacement
  itself is unchanged. In the real app the largest per-frame joint step (the far toe) measured
  142 px at 1280 and 113 px at 390 before the hold, and 136 and 109 px after it. The small
  difference is the larger top margin's zoom, not the hold.
- **Still frame.** `planAnnotations` takes `heldPhaseWithoutKey`. On `landingSide` it is
  `GAIT_PHASES.rightContact`, so a still figure with no keyed focus shows the landing (by D15,
  the foot is exactly on the ground). A keyed focus still wins, as before. On `landingSide` every
  still state, pausing mid-loop included, moves the figure to the held phase (review round 1).
  Elsewhere, pausing still freezes the figure where it is. The landing marks are built at contact,
  so a figure frozen at 0.40 would show them floating off the leg.
- **Honest marks (Q2, Q3).** The overstride guides are plumbs from hip-mid and from the contact
  ankle down to the offset under the ground. They meet the ankle, not the heel, because the ankle
  is what the metric reads. The foot-strike offset runs at ankle height from `knee.x` to
  `ankle.x`, with a plumb from the knee and a tick at the ankle. Its label hangs `below` the lower
  of heel and toe at contact: the heel on a heel-down landing, the toe on a forefoot strike. The
  AC's "pinned to the heel keypoint" is recorded as "guides meet hip and contact ankle; foot-strike
  label at the heel".
- **Ground lane.** Two or more `below` labels anchored on or under the ground stack in focus order
  as one block: they share the first label's anchor x (the overstride bar's centre, when overstride
  leads) and the lane's lowest anchor height, through `RunnerAnnotationLabel.offsetLines`, which
  `placeLabel` applies before its in-frame clamp.
- **`footSide`** stays as a preset, unused by the app (Q6).

### Deviations from the plan

- **Horizontal framing is centred on the window's reach, not on the hip–ankle midpoint.** The plan
  put the target at `ankle.x / 2`. In practice the late-swing toe at the window's start projects
  to x = 1.67 to 2.12 at that centre, outside the ±1.5 viewBox half-width, so it would be cut off
  at phone width. `landingCamera` instead samples hip-mid and the near knee, ankle, heel and toe
  over the window, centres on their horizontal reach plus a 0.05 margin, and zooms out further only
  if that reach does not fit (at landing −0.3 it zooms to 1.57 instead of 1.67). The contact ankle
  and hip-mid are always inside the frame. `CAMERA_FRAME_HALF_WIDTH = 1.5` moves to `camera.ts`,
  and `VIEW_HALF_WIDTH` is now defined from it.
- **`PhaseWindow` and `LANDING_PHASE_WINDOW` live in `camera.ts`, not `runnerScene.ts`.**
  `landingCamera` needs the window, and `runnerScene` already imports `camera`, so the plan's
  placement would have made an import cycle. `advancePhase` stays in `runnerScene`.
- **The ground-lane stack aligns its anchor heights.** The plan stacked by line count alone, but
  the overstride label hangs from its mark 0.05 below the ground while the foot-strike label hangs
  from the heel on the ground. Stacking by lines alone would overlap them by that 0.05 world
  (about 9 px). The stacked labels therefore share the lane's lowest anchor y. A lone foot-strike
  label keeps its exact heel anchor.
- **More test lines than the three approved.** Besides `focusAreaCamera.test.ts:25` and
  `tourPlan.test.ts:112`, the landing camera's `'legsSide'` string also appears in
  `ResultsSummary.test.tsx` (lines 217, 229, 257, 265, 277, 332; there is no `legsSide` on 224 at
  this base) and in `RunnerTour.test.tsx` (lines 432, 436, 594). Only that string changed on those
  lines. The knees-stop lines (`RunnerTour.test.tsx:540, 562`) still read `legsSide`.

## Risks / Trade-offs

- **The ps19.4 sink inside the window (resolved by narrowing).** Past D15's domain the mid-stance
  foot gives way. At the demo's overstride of 0.512, the near foot's lowest point is −0.028 at
  cycle 0.60 and −0.063 at 0.65. With the planned ±0.15 window, the 1280 px sandbox frames showed
  the heel about 10 px under the drawn ground at the window's end. The after-contact side was
  narrowed to 0.10 (window 0.35..0.60), as the decisions record. At 0.60 the residual is −0.028
  torso lengths, about 4 to 5 px at 1280. `gaitModel` is unchanged.
- **The hip plumb does not follow a value tween.** Overstride is a ground mark, so it does not
  lift with the figure's height during the intro tween. The tour shows no focus while the intro
  runs, so this is not seen there.
- **Label-lane crowding at 390 px.** Did not happen: the sandbox's stacked labels at 390 sit clear.
  The remedy, if it does, is raising `LANDING_FRAME_BELOW_GROUND` toward 0.6.
- **The 390 px tour's stop card covers the ground lane.** The phone tour (trn2.4) lays the stop
  card over the bottom of the drawing, so the overstride label sits mostly behind it. This is a
  phone-layout follow-up, not something the frame can fix.
- **The far foot can show at the frame's edge.** Over the window, the far (left) leg's foot
  reaches back to x ≈ −1.05 to −1.16. Including it in the sampled reach would drop the zoom from
  about 1.7 to about 1.3, so it is left to be clipped, which can leave part of a far foot at the
  left edge.
