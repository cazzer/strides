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
- [x] 4.3 A/B fidelity gate (tour / classic / summary × side-landscape, side-portrait, front-approach, 1 fresh-process trial each, `--evidence --scale-pass`) on base `7a8b9e1e` and branch `4ce2f821`: every field but `elapsedMs` identical, one hash per clip (`docs/agent-notes/runner-tour.md`)
- [x] 4.4 Live check (real GPU, derived port): each clip uploaded alone at 1280×800 and 390×844, light and dark, reduced motion at 1280 light and 390 dark; tour landing and knees stops pause → plate fades in aligned, Play → out; other stops and park-approach none; summary at 1280 Landing and Knees paused → plate; phone panel legibility; first-appearance pop, hard square edge and baked-in marks judged
- [x] 4.5 `docs/agent-notes/runner-tour.md`: honesty rule 5, a plate gotcha (copy not adoption, `data-shown` written by the loop, the pause snap), correct "the tour mounts no evidence canvas" (still none; it copies pixels), live findings
- [ ] 4.6 Follow-up beads: foot-strike plate via a hip from `robustFrames`; a mark-free source if the live check finds the baked-in marks cluttered

## 5. Review round 1

- [x] 5.1 Honesty about the ghosted pair: the plate stays the evidence image with its fainter second moment; design decision 7, spec deltas, PRD rule 5, `runner-tour.md`, the note and the legend say so
- [x] 5.2 Visible legend line while on offer ("Faint photo: your clip, not a target", " · flipped"); fuller text-alternative note (metric, evidence image, second moment, flip, "Your footage, not a target.")
- [x] 5.3 Greyscale plate (`grayscale`; computed `grayscale(1)` on the SVG `<image>` live)
- [x] 5.4 Clutter cap `MAX_PLATE_SIDE_IN_FRAME_WIDTHS = 2.5` (`placeFootagePlate`), measured 1.55–1.64 readable vs 4.18 cluttered (design D10)
- [x] 5.5 Fade on first appearance (`starting:opacity-0!`), verified live; reduced motion still instant
- [x] 5.6 Words only when placed (render-time placement), never under forced colours (`useForcedColors`); adapter needs a knee or ankle besides the hip
- [x] 5.7 `clipViewKinds` indexed like `clips`
- [x] 5.8 Wiring tests: `RunnerTour` (knees stop, side clip, front clip, intro) and `ResultsSummary` (lg, below lg)
- [x] 5.9 Side-swap fit test builds left-named footage from the right leg's drawn positions
- [x] 5.10 design.md: pause snap also reaches the Foot path stop; accepted thigh-angle offset, square edge, discoverability, summary copy latency
- [x] 5.11 Gates (vitest, `tsc -b`, lint, build, `openspec validate --strict`) and a live re-check (`r1-*` screenshots)
