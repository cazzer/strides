# Tasks — bundle a three-clip demo

## 1. Assets

- [x] 1.1 Download both clips from Drive, confirm they are real media (`file`), not HTML interstitials
- [x] 1.2 Transcode HEVC → H.264, baking in the portrait clip's `rotation=-90`
- [x] 1.3 Cross-check decoded frame counts with `ffprobe -count_frames` on both sides of the transcode
- [x] 1.4 Place as `src/video/demo-clips/park-side-landscape.mp4` and `park-side-portrait.mp4`

## 2. The demo action

- [x] 2.1 `DemoVideoButton` takes a list of clip URLs and emits one blob per clip, sequentially,
      as each fetch resolves; drop the Pexels default and the unused `'Try a demo video'` label default
- [x] 2.2 `ClipPicker` renders one **Demo** button wired to all three bundled clips
- [x] 2.3 Update `ClipPicker.test.tsx` — one demo button, asserts one `onSource` call per clip in order
- [x] 2.4 Update `DemoVideoButton`'s own tests if present; add coverage for the per-clip emit order
      and for a mid-set fetch failure
- [x] 2.5 Sweep the remaining `Demo 1`/`Demo 2` accessible-name assertions in
      `AddClipAction.test.tsx` and `MultiClipVideoSession.test.tsx`

## 3. Harness

- [x] 3.1 `scripts/ab-person-selection.mjs`: rename clip keys to `side-landscape` / `side-portrait` /
      `front-approach` / `multiperson` (four, not three — `side-portrait` is new coverage), route
      every one through the Upload tab, delete the demo-download-failure race arm that only existed
      for the network-fetched clip, and name the clip in the "Analysis complete" timeout
- [x] 3.2 Update the script's `--clips` doc comment and default list

## 4. Verification

- [x] 4.1 `npx eslint src scripts` clean. `npx tsc -b` reports exactly one error, and it is
      **pre-existing and not from this change**: `vite.config.ts(10,1)` puts `port: 5177` at the
      top level of `defineConfig`, where Vite has no such key (commit `5947c3f`). It blocks
      `npm run build`, which is `tsc -b && vite build`. Filed as `strides-ldq` and deliberately not
      fixed here — the two candidate fixes (`server.port` vs. the derived-port helper CLAUDE.md
      documents) differ in runtime behaviour and the choice is not this change's to make.
      **Verified separately** that this change builds: with that one line temporarily removed,
      `tsc -b` is clean and `vite build` succeeds, emitting all three clips as separate on-demand
      assets rather than bundling them into the JS. `vite.config.ts` was restored untouched.
- [x] 4.2 Unit suite green — 1474 passing, 0 failing
- [x] 4.3 Live run in headless Chromium on real GPU (`ANGLE Metal Renderer: Apple M4 Pro`, dev
      server on the derived port 5262). One Demo click → exactly 1 demo button on the page, 3 clips
      created, all 3 reaching `Analysis complete` and `✓ DONE` in the header strip. Three
      `[analysis-diagnostics]` lines, one per clip. Fused panel renders **12 metrics** with
      **13 evidence canvases** and `From clip 1 of 3.` / `From clip 3 of 3.` provenance;
      `sourceIndices` splits across clips 0 and 2, so fusion is genuinely picking per metric rather
      than taking one clip wholesale.
- [x] 4.4 `scripts/ab-person-selection.mjs --arm 'base={}' --clips side-portrait --trials 1` runs
      clean and reproduces the live session's values for that clip (`trunkLean` 10.3371,
      `stepWidth` −0.180684)

## 5. Documentation

- [x] 5.1 CLAUDE.md: the demo is one button of three local clips; label existing "Demo 1"/"Demo 2"
      anchors with the footage they were measured on; update the harness `--clips` examples
