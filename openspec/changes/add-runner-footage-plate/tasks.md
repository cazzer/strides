## 1. Runner core

- [x] 1.1 `src/runner/footagePlate.ts`: `FootageFitInput`, `PlateTransform`, `fitFootagePlate` (hip-anchored, segment-length scale, mirror), `mapFootageName`, `heldLegFor`, `footageKeyPhase`
- [x] 1.2 `src/runner/footagePlate.test.ts`: exact recovery of a known scale/translation/mirror; side swap; a different knee angle leaves the scale unchanged; null without hips, with only hips, degenerate lengths, non-finite input; determinism

## 2. Renderer

- [x] 2.1 `ModelRunner`: optional `footage` prop (`RunnerFootage`); blob copy only while still, per source canvas, revoked on source change and unmount, `try/catch` around `toBlob`
- [x] 2.2 `<image data-footage-plate>` as the svg's first child on the unit square; `PLATE_CLASS` fade (240 ms, 0.26, `motion-reduce:transition-none`, `forced-colors:hidden`); built CSS checked, no `index.css` fallback needed
- [x] 2.3 Scene carries `heldPhase` and the offered plate; `drawRef` gate (still, at the held phase, no camera or value tween) writes the transform and `data-shown`, and stops writing while hidden
- [x] 2.4 Second guard: the footage metric's key leg phase on the held leg equals the held phase
- [x] 2.5 Pause snap for any limb-keyed (non-beat) focus
- [x] 2.6 Text alternative appends the footage note while offered
- [x] 2.7 `ModelRunner.test.tsx`: shown under reduced motion with the fit over the drawn joints; mirror; hidden on Play in place, no second copy on Pause; nothing copied while playing; hidden during a camera tween and refitted after; none when keyed elsewhere, without footage, or with an unreadable canvas; copies revoked; pause mid-cycle with knee flexion snaps; cadence pause unchanged

## 3. Results wiring

- [x] 3.1 `src/results/runnerFootagePlate.ts`: `runnerFootageFor` (headline order, plate metrics, side cameras, side clip, travel direction, hip, measured side, unit-square points, note)
- [x] 3.2 `src/results/runnerFootagePlate.test.ts`: every gate and the headline order
- [x] 3.3 `MultiClipVideoSession`: `clipViewKinds` beside `clipViews`, on `resultsViewProps`; `ResultsViewProps.clipViewKinds`
- [x] 3.4 `RunnerTour`: evidence, source indices and view kinds threaded to `TourBody`; no footage during the intro
- [x] 3.5 `ResultsSummary`: footage from `SummaryBody`

## 4. Docs and gates

- [x] 4.1 `docs/prd/runner-led-results.md` honesty rule 5
- [x] 4.2 Gates: `npx vitest run`, `tsc -b`, `npm run lint`, `npm run build`, `openspec validate add-runner-footage-plate --strict`
- [ ] 4.3 A/B fidelity gate (tour / classic / summary × side-landscape, side-portrait, front-approach, 3 trials, `--evidence --scale-pass`) on base and branch: every field but `elapsedMs` identical
- [ ] 4.4 Live check (real GPU, derived port): each clip uploaded alone at 1280×800 and 390×844, light and dark, reduced motion at 1280 light and 390 dark; tour landing and knees stops pause → plate fades in aligned, Play → out; other stops and park-approach none; summary at 1280 Landing and Knees paused → plate; phone panel legibility; first-appearance pop, hard square edge and baked-in marks judged
- [ ] 4.5 `docs/agent-notes/runner-tour.md`: honesty rule 5, a plate gotcha (copy not adoption, `data-shown` written by the loop, the pause snap), correct "the tour mounts no evidence canvas" (still none; it copies pixels), live findings
- [ ] 4.6 Follow-up beads: foot-strike plate via a hip from `robustFrames`; a mark-free source if the live check finds the baked-in marks cluttered
