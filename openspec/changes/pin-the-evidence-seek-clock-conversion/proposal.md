# Pin the evidence seek's media-to-presentation clock conversion

## Why

`strides-09b` (P1) reported that `evidenceSeekOffset.ts`'s edit-list term is **wrong** on
`park-side-landscape.mp4` — that Chromium's `currentTime` runs on the container's media clock
there, so subtracting `elst media_time` moves the seek two frames early.

**Re-measured across the whole four-clip corpus with a pure-Chromium probe: the term is correct,
on every clip. The report was a frame-numbering error.**

31 seeks — 4 clips, 7 or 10 targets each, each target predicted to land two frames apart under the
two competing models, PSNR-identified against ffmpeg-reconstructed candidates. **30 matched the
edit-list-applied prediction exactly, the 31st is a deliberate frame-boundary target that landed one
frame low on the known microsecond truncation, and not one matched the media-clock prediction.**
Full table: `design.md` D1.

The error is in what `select='eq(n,N)'` indexes. ffmpeg numbers **coded pictures**, and in all four
files the lowest composition timestamp equals the edit list's `media_time` exactly:

| file | media timescale | `elst media_time` | min sample CTS |
|---|---|---|---|
| `park-side-landscape.mp4` | 15360 | 512 | **512** |
| `park-side-portrait.mp4` | 15360 | 1024 | **1024** |
| `park-approach.mp4` | 60000 | 2002 | **2002** |
| `multiperson-track.mp4` | 15360 | 512 | **512** |

That is the ordinary `ctts` B-frame priming edit: the edit exists to cancel the first picture's
composition offset, **no picture precedes it and none is discarded**. So ffmpeg's frame `N` sits at
composition time `(media_time + N·Δ)/timescale`, not `N·Δ/timescale`. The bead read frame `N` as
sitting at media time `N/fps`, which mis-numbers every frame in the file by exactly the quantity
under dispute — and therefore reads a correct conversion as a two-frame error.

Corrected, the bead's own three observations all confirm the conversion:

| bead's observation | measured | media-clock model | edit-list model |
|---|---|---|---|
| `currentTime = 2.0` | frame **120** | 118 | **120** ✓ |
| seek `3.049999666…` | frame **182** | 180 | **182** ✓ |
| seek `3.399999666…` | frame **203** | 201 | **203** ✓ |

Two supporting readings the bead cited are non-discriminators, and are recorded here so nobody
re-derives them:

- **`video.duration` cannot decide this.** The edit segment covers the whole media, so presentation
  duration and media duration are the same span; `3.884` is just `3883.33 ms` rounded into the
  1000 Hz movie timescale. Chromium reports `3.883333` on both models.
- **`-ignore_editlist 1` really does change nothing at the filter stage**, and that is not evidence
  that ffmpeg ignores the edit list. It shifts packet PTS (first packet `0` vs `512`) and then
  re-bases output start time either way, so `showinfo` prints the same `pts_time` in both modes.
  `select='eq(n,183)'` reports `pts_time 3.05` — that is frame 183's **presentation** time, read by
  the bead as its media time.

Nothing about the conversion is per-file or per-container-detail. `park-side-landscape.mp4` and
`multiperson-track.mp4` are the controlled pair — different footage, byte-identical timing lattice —
and agree on every shared target. So does the 60000-timescale clip and the variable-frame-rate one.

The conversion has never had a requirement of its own. *Evidence seeks target the middle of a
frame's presentation interval* forward-references "the media-to-presentation clock conversion the
system already applies" and there is nothing to reference. An unpinned load-bearing fact is exactly
what got a P1 filed against working code, so this change pins it.

## What changes

- **`openspec/specs/results-view/spec.md` gains one requirement** stating the conversion: what it
  converts between, that it is derived per clip from the container, when it is zero, and — the part
  this bead turned on — that the subtracted quantity is a clock offset and **not** a count of
  trimmed frames.
- **`src/video/evidenceSeekOffset.ts`'s module and function docs are corrected.** They called the
  shape "trims" and framed the shift as though frames were removed, which is the wrong mental model
  and the one that produced this report. Comment-only.
- **The record is corrected where the wrong conclusion was written down**: `CLAUDE.md`'s PTS-drift
  subsection, and a correction note beside D9 of
  `openspec/changes/archive/2026-09-05-seek-evidence-frames-to-the-frame-midpoint/design.md`.

**No behaviour changes and no computed value moves.** `editListSeekOffsetSeconds`,
`frameMidpointOffsetSeconds`, `resolveEvidenceSeekCalibration` and `extractFrames.ts` are
functionally untouched.

## Impact

- Affected specs: `results-view` (one ADDED requirement).
- Affected code: `src/video/evidenceSeekOffset.ts` (doc comments only).
- `strides-5t4`'s acceptance criterion — "both `footStrikePattern` cards draw frames **183** and
  **204** on `park-side-landscape.mp4`" — is **confirmed, not stale**. This measurement reproduces
  it independently from a pure-Chromium seek at the app's own two targets, and D9's "the drawn frame
  is two frames from the instant the metric measured" is withdrawn: the residual is **zero**.
- `strides-pr1`'s footstrike sampling-instant lag is a different quantity and is untouched.
