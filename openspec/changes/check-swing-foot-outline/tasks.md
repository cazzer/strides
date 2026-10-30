## 1. Pure core

- [x] 1.1 `swingFootOutline.ts`: planner, crop, run-mask measurement (port of the spike's `measure`/`component_runs`), summary, evidence pair; constants commented "tuned on park-approach; validated by strides-uz48.2"
- [x] 1.2 `swingFootLateralExcursion.ts` becomes the planner; types (`SwingFootLateralExcursionResult`, plan, reading, `outlineMarks`, kind `swingFootOutline`)
- [x] 1.3 Tests on synthetic run masks; per-frame parity with the spike's park-approach crop masks (checked once, not committed: the masks live outside the repo)

## 2. Outline pass

- [x] 2.1 `createMediaPipeOutlineSegmenter` + `outlinePassDetector.ts` (IMAGE mode, masks, cached, reset on failure)
- [x] 2.2 `outlineFrameReader.ts` (crop at native px, runs in the loop, close every result)
- [x] 2.3 `swingFootOutlineGraft.ts`, `outlinePassConfig.ts` (kill switch ON)
- [x] 2.4 `useVideoAnalysis.ts`: decide at ready, claim/run after the scale pass, watchdog, runId guards, demux release, dev console + perf lines
- [x] 2.5 Lane: `multiClipAnalysis.ts` (scale passes first, then outline; no primary advance), `MultiClipVideoSession.tsx`, `ClipSlot.tsx`
- [x] 2.6 Tests: reader, graft, lane order, hook (done, failed, not-front, playback-path, stale run, console line)

## 3. Presentation

- [x] 3.1 Label "Sideways foot travel", value wording shared by guided view and classic panel, description, guidance note and capture hints
- [x] 3.2 Status line while the outline pass runs
- [x] 3.3 Evidence: `outlineMarks` copied into the plan; outline marks drawn
- [x] 3.4 Runner: `swingFootArc` rebound as peak outward travel, neutral 0, no bracket at 0

## 4. Verification

- [x] 4.1 Live park-approach: 4 usable windows, all inside, value 0; two fresh trials identical on the outline line
- [x] 4.2 3-clip demo; 390 and 1280 px, tour/summary/classic screenshots
- [x] 4.3 A/B main vs branch (`--evidence --scale-pass --outline-pass --trials 2`, all four clips): identical apart from `elapsedMs` and this metric
- [x] 4.4 `docs/agent-notes/swing-foot-travel.md` Production section
