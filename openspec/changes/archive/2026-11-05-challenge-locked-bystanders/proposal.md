# Stop the online tracker locking onto bystanders (strides-p1qt.15)

## Why

The online person-of-interest (POI) layer in `src/pose/backends/movenet.ts` decides who the
runner is from ONE multi-pose frame and then defends that choice by continuity for the rest of the
clip. Three measured failures share that root:

- **Late entry (strides-p1qt.10, strides-d90).** On private IMG_9345 acquisition fires at f0,
  before the runner enters, and picks the orange-cap man. No rule ever prefers someone who enters
  AFTER acquisition: re-verification is scored by continuity, so at f60 it sees the runner at
  71k px² against the anchored bystander's 28k and keeps him. The runner is measured for 12
  frames; cadence is withheld (GT 190). The public clips `side-landscape` and `multiperson` (the
  same footage at 4K and 1080p) and private IMG_9117 have the same shape: a walker or worker is
  anchored before the runner enters.
- **Near-tie acquisition (strides-p1qt.5).** On private IMG_9348 the f0 multi-pose pass sees only
  a stationary bystander (the runner sits below the pose-score floor). When the runner does
  appear (f12), nothing reconsiders an identity that was never confirmed. The selected segment
  starts at 1.233 s.
- **Reset hand-off (strides-p1qt.6).** When the settle-in crop window ends, `rawDetector.reset()`
  nulls MoveNet's own crop region, and the library restarts from a centre-square guess. A runner
  at the frame edge is outside that square, so MoveNet re-picks whoever is inside it (IMG_9345
  f4, IMG_9348 f16, IMG_9117 2.40 s, the d90 contradiction). Seeding MoveNet's crop from the
  anchor on every hand-off was measured mixed (strides-p1qt.3): it faithfully preserved WRONG
  acquisitions as well as right ones.

The three fixes only work together. Seeding makes identity survive the hand-off, so identity has
to be right first; and a correct switch is lost again at the next hand-off without seeding (d90).

## What Changes

- **Identity challenge.** A periodic, side-effect-free multi-pose look at the whole frame, on its
  own stateless multi-pose instance (tracking and smoothing off), that can move the anchor:
  - *Tentative* identity (fewer than 3 checks have re-picked it), checked every 4 calls: re-run
    acquisition; another person takes the anchor if they are ≥1.5× the anchor's tracked box, or
    of comparable size (≥ 1/1.5) when the check cannot see the anchor at all.
  - *Settled* identity, checked every 10 calls: a switch needs someone ≥3× the anchor's tracked
    box on 2 consecutive checks, by the same person.
  - Scale is always compared against the anchor's tracked single-pose box, never its multi-pose
    match, whose box collapses under motion blur.
  - A check that does not switch changes no state but its own and falls through to the ordinary
    single-pose call for the same frame.
- **Seeded hand-off.** When a settle-in crop window ends and the plain reset's result does not
  confirm the anchor, retry that frame once with MoveNet's crop started from the anchor's
  keypoints (`movenetCropRegionSeed.ts`, a port of the library's own `determineNextCropRegion`).
  A hand-off that already found the anchor is untouched.
- `PersonOfInterestConfig` gains `identityChallenge` (enabled + 6 numbers) and `seedHandOff`,
  both on by default, both overridable through `window.__STRIDES_POSE_BACKEND_OVERRIDE__` and
  registered in the A/B driver's key schema.

## Capabilities

### Modified Capabilities
- `pose-detection`: the bounded-multi-pose-moments requirement admits the identity challenge; two
  new requirements specify the challenge and the seeded hand-off.

## Impact

- `src/pose/backends/movenet.ts`, `movenetCropRegionSeed.ts` (new), `personOfInterestConfig.ts`,
  `src/pose/poseBackendConfig.ts`, `scripts/ab-person-selection.mjs`, and their tests.
- One more multi-pose model instance is loaded at detector construction (same cached weights),
  and one extra multi-pose call is made every 4 or 10 calls. On the default sequential sampler
  this costs wall-clock time, never frames. On the real-time playback sampler (WebM/webcam) it can
  cost sampled frames; no clip in the A/B exercises that path.
- Closed decisions respected: POI stays on, tracking crop stays off, area floor unchanged.
