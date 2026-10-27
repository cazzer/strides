## 1. Annotations

- [x] 1.1 `AnnotationKind` gains `'beat'`; `PARAM_ANNOTATION_KIND.cadence = 'beat'`; `KEY_LEG_PHASE.cadence` null (keyed on a footfall in review round 1, 5.2)
- [x] 1.2 `headTopAnchor(pose)` in `runnerAnnotations.ts`; `introFlash.ts` `flashAnchor('cadence')` uses it (behaviour unchanged)
- [x] 1.3 Cadence builder: label above the head, one pulse per foot at its contact phase centred on the lower of heel and toe at that contact, ground ticks to `GROUND_Y − 0.08`
- [x] 1.4 `beatEnvelope` and `BEAT_DECAY_CYCLES` (0.25)
- [x] 1.5 `formatRunnerValue` foot-strike branch: "Heel/Midfoot/Forefoot first (estimate)" from `classifyFootStrike`
- [x] 1.6 Step-width guides: hip-mid midline plumb and a tick under each foot; ankle drop removed

## 2. Renderer

- [x] 2.1 `RUNNER_PX.beatRingMin` 4 / `beatRingMax` 12
- [x] 2.2 ModelRunner: `circle[data-pulse]` rings rendered only while playing with motion allowed; radius and opacity written in the draw from the live phase
- [x] 2.3 Lift rule split: ground paths (landing, step width, cadence) and ground labels (landing, step width)

## 3. Tests

- [x] 3.1 runnerAnnotations.test.ts: beat annotation, pulses on the ground at contact, envelope, beat rate at 150/180/190 × 1/0.4 within ±1 over 10 s, foot-strike strings, step-width guides at feetFront for step width {0.15, 0.3, −0.2} × swing arc {0.15, 0.6}
- [x] 3.2 ModelRunner.test.tsx: rings while playing (radius grows as it fades, on the ground, no React commit per frame), strong ring under a planted foot, slowed label, reduced motion, paused, WCAG guard, ticks stay put while a tween lifts the figure
- [x] 3.3 runnerScene.test.ts: "Shown: Cadence 180 steps/min."; updated foot-strike strings

## 4. Verification

- [x] 4.1 lint, `tsc -b`, `vitest run src/runner src/results`, full `vitest run`, `vite build`, `openspec validate add-cadence-beat --strict`
- [x] 4.2 Live screenshots (both demo clips, every tour stop, Rhythm pulse/between/reduced, Foot path planted feet, summary rows), live beat-rate check, neutral-feet reproduction at 390

## 5. Review round 1

- [x] 5.1 Ring geometry inverted: 15 px and opaque at contact, shrinking to 6 px as it fades, 2.5 px stroke; the foot's tick flashes in the accent with its ring
- [x] 5.2 `KEY_LEG_PHASE.cadence = leftContact`: a still Rhythm frame holds the near foot planted on its ticks; `src/results` consumers checked, its tests unchanged
- [x] 5.3 Half a line between stacked ground-lane labels (`STACK_GAP_LINES`)
- [x] 5.4 No rings on `landingSide` (`phaseWindow === null`), tested
- [x] 5.5 ModelRunner-level beat rate through the real loop (30 ± 1, 12 ± 1 over 10 s)
- [x] 5.6 Ring-under-foot test asserts the ring centre is the contact point and the foot within its stance slide
- [x] 5.7 Midline plumb uses hip-mid's x at both ends; D17 names strides-z8j7; D20's red-flash definitions quoted
