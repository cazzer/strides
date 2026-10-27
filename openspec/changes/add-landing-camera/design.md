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
- **Framing.** Height: from `LANDING_FRAME_ABOVE_HIP` (0.15) above hip-mid at contact to
  `LANDING_FRAME_BELOW_GROUND` (0.4) below the ground, which fills the frame (zoom ≈ 1.7 at
  neutral). Width: see the deviation below.
- **Phase window.** `LANDING_PHASE_WINDOW = { start: 0.35, length: 0.25 }` runs from 0.15 of the
  right leg's own phase before its contact (cycle 0.5) to 0.10 after it (see the sink below). `advancePhase(phase, delta, window)` loops
  inside the window. From outside, it plays on until it reaches the window (Q5: enter by playing
  on), with a 1e-9 tolerance so rounding at the window's end never drops the phase out. There is
  no hold at contact (Q4); the UX review judges whether the 0.53 s loop at 0.4× reads well.
- **Still frame.** `planAnnotations` takes `heldPhaseWithoutKey`. On `landingSide` it is
  `GAIT_PHASES.rightContact`, so a still figure with no keyed focus shows the landing (by D15,
  the foot is exactly on the ground). A keyed focus still wins, as before.
- **Honest marks (Q2, Q3).** The overstride guides are plumbs from hip-mid and from the contact
  ankle down to the offset under the ground. They meet the ankle, not the heel, because the ankle
  is what the metric reads. The foot-strike offset runs at ankle height from `knee.x` to
  `ankle.x`, with a plumb from the knee and a tick at the ankle. Its label hangs `below` the lower
  of heel and toe at contact: the heel on a heel-down landing, the toe on a forefoot strike. The
  AC's "pinned to the heel keypoint" is recorded as "guides meet hip and contact ankle; foot-strike
  label at the heel".
- **Ground lane.** Two or more `below` labels anchored on or under the ground share the lane's
  lowest anchor height and stack in focus order through `RunnerAnnotationLabel.offsetLines`, which
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
- **Label-lane crowding at 390 px.** The remedy is raising `LANDING_FRAME_BELOW_GROUND` toward 0.6.
