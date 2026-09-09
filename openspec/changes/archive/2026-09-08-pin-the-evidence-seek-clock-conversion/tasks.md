# Tasks — pin the evidence seek's media-to-presentation clock conversion

## 1. Measure before deciding

- [x] 1.1 Capture the BEFORE A/B on the unmodified tree:
      `node scripts/ab-person-selection.mjs --arm 'base={}' --clips
      side-landscape,side-portrait,front-approach --trials 3 --evidence --json before.json >
      before.txt`. Fresh Chromium per trial, real GPU, dev server started and identity-verified by
      the run. Commit `e9bb7a6`, renderer `ANGLE Metal Renderer: Apple M4 Pro`.
- [x] 1.2 Dump each of the four clips' `edts/elst`, `stts` runs and `ctts` presence via `mp4box`,
      and the full sorted composition-timestamp list via
      `ffprobe -ignore_editlist 1 -show_entries packet=pts`. **Finding: min sample CTS equals
      `elst media_time` exactly on all four** — a `ctts` priming edit, not a trim.
- [x] 1.3 Establish that `select='eq(n,N)'` indexes coded pictures and is edit-list-independent:
      233 frames and identical `showinfo` PTS with and without `-ignore_editlist 1`.
- [x] 1.4 Build a probe plan: per clip, frame-interval midpoints under **both** models (two frames
      apart by construction), plus plain wall-clock targets, with at least one whole-microsecond and
      one non-whole-microsecond target per clip.
- [x] 1.5 Run the pure-Chromium seek probe (no app, no dev server) over all four clips and dump each
      drawn frame at native resolution.
- [x] 1.6 PSNR-identify every drawn frame against ffmpeg-reconstructed candidates in a ±3 window.
      **Result: 31/31 refute the media-clock model; 30/31 match the edit-list model exactly and the
      31st is the known boundary-quantisation case, which lands one frame below it, not two.**
- [x] 1.7 Trace which clock `robustFrames[].timestamp` rides on, in code:
      `mp4Demux.ts` (`sample.cts / sample.timescale`) → `sequentialFrameSource.ts` → sampler.
      Raw composition time, µs-rounded — confirmed against the observed exemplar timestamp
      `3.083333`.
- [x] 1.8 Revert every probe. Nothing added under `src/` or `scripts/`.

## 2. Decide

- [x] 2.1 **Verdict: `editListSeekOffsetSeconds` STAYS, unchanged.** The reported defect is a
      frame-numbering error, not a behaviour. Recorded in `design.md` D2 and D6.
- [x] 2.2 Answer "by file, by container detail, or misindexed?" against the controlled pair
      (`park-side-landscape.mp4` vs `multiperson-track.mp4`, identical lattice, different files):
      **misindexed**. `design.md` D5.

## 3. Pin it so it is not re-derived

- [x] 3.1 Add the requirement *An evidence seek converts the sampled timestamp onto the presentation
      clock* to the `results-view` spec delta, including the normative "clock offset, never a count
      of trimmed frames" clause.
- [x] 3.2 Correct `src/video/evidenceSeekOffset.ts`'s module and function docs: replace the "trim"
      framing with the measured mechanism and record the corpus verification. Comment-only.

## 4. Leave the record correct

- [x] 4.1 Correct `CLAUDE.md`'s PTS-drift subsection — the ⚠️ `strides-09b` paragraph asserts the
      term is wrong. Append the resolution beside the honestly-measured readings rather than
      rewriting them, per this repo's convention.
- [x] 4.2 Add a correction note beside D9 of
      `openspec/changes/archive/2026-09-05-seek-evidence-frames-to-the-frame-midpoint/design.md`.
      Its acceptance criterion (frames 183 and 204) is **confirmed**, not stale; the "two frames
      from the instant the metric measured" claim is withdrawn.

## 5. Verify

- [x] 5.1 Look at the images: frames 182 / 183 / 185 and 203 / 204 / 206 at full resolution with a
      grid overlay. **183 and 204 are touchdown; 185 and 206 are mid-stance.** `design.md` D7.
- [x] 5.2 AFTER A/B on the same three clips, same trial count. **Gate: no `metrics.*`,
      `sampling.*`, `personSelection.*`, `view.*` or `evidence.*` field may move.**
      **PASSED — 3 differing lines, all `elapsedMs`**, and the elapsedMs-stripped body md5 matches
      exactly (`35354cffa464ade00f36890e563716ff` both sides). Run through `rtk proxy sh -c` per
      `strides-ef5`, with the md5 cross-check, because the summarising `diff` wrapper has twice
      reported equality for unequal files.
      ⚠️ The FIRST after-run was discarded and re-run: two of its nine trials hit
      `[evidence-coverage] did not settle in 180000ms (0 line(s))`, which the driver records as
      `null` for that trial and which shows up as `X×2 null×1` on every evidence row of the affected
      clip. Every non-null value still matched before exactly, so it was a harness flake and not a
      finding — but it is not a clean gate, so it was re-measured. The re-run had zero warnings.
- [x] 5.3 `npx tsc -b`, `npm run lint`, `npx vitest run` (1511 passing),
      `openspec validate pin-the-evidence-seek-clock-conversion --strict`.
