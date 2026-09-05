# Seek evidence frames to the middle of a frame's presentation interval

## Why

`footStrikePattern`'s two evidence cards on `park-side-landscape.mp4` draw an **airborne** foot.
The detected instants are right; the seek that turns them into pixels lands one frame early.

**Chromium quantises `currentTime` to integer microseconds, and it TRUNCATES.** Measured here, no
app involved: assigning `3.049999666666667` reads back `3.049999`. At 60 fps on a 15360 timescale a
frame's presentation boundary is `n/60` seconds — a whole number of microseconds only when
`n mod 3 == 0 `, so **two thirds of this clip's frame boundaries are literally unrepresentable in
the seek API**, and every one of them truncates DOWN, into the previous frame.

Targeting the boundary is therefore the one choice with no error budget at all. The sub-microsecond
error that decides it is already present and comes from three independent places — the sampler
truncates its timestamps to six decimals, the edit-list term is a second double, and the boundary
itself is irrational in microseconds. `strides-e6y` shrinks the first of those to 333 ns and does
not close the gap, because at a boundary target **any** downward error of any size is one frame.

`currentTime = t` displays the frame whose presentation interval **contains** `t`. The middle of
that interval is therefore the semantically correct request, not a fudge — and it absorbs ±8.3 ms
at 60 fps instead of nothing.

## What changes

- `evidenceSeekOffset.ts` derives a second per-clip term alongside the edit-list shift: **half the
  track's nominal frame duration**, from `ContainerVideoTrackTiming.nominalFps`, which
  `probeContainerTiming` already returns. `containerTiming.ts` is untouched; the same single
  `arrayBuffer()` + parse now yields both numbers.
- `resolveEvidenceSeekOffsetSeconds` becomes `resolveEvidenceSeekCalibration`, returning
  `{ offsetSeconds, midpointOffsetSeconds }`.
- `extractFrames.ts` seeks `instant.timestamp + offsetSeconds + midpointOffsetSeconds`, clamped to
  the clip's end only where the element reports a finite one.
- **Nothing else moves.** `robustFrames[].timestamp`, `ClipEvidencePlan` and `[evidence-coverage]`
  are untouched — this changes which pixels an image is drawn from, and no number any metric was
  computed from.

## Measured effect

`park-side-landscape.mp4`, PSNR argmax against ffmpeg-reconstructed source crops, fresh Chromium,
real GPU, identity-verified server. Frame indices are ffmpeg's decoded-frame index, which on this
clip is the container's own media frame index (`select='eq(n,183)'` reports `pts_time 3.05`):

| card | planned instant | before | after | first ground contact |
|---|---|---|---|---|
| `footStrikePattern` left | 3.083333 s | **182** (airborne) | **183** | 183 |
| `footStrikePattern` right | 3.433333 s | **203** (airborne) | **204** | 204 |

Confirmed by looking at the frames: at 182 and 203 there is a separated shadow band under the sole
with tarmac visible between shoe and shadow; at 183 and 204 the gap has closed into a continuous
sole/ground boundary.

## Two things deliberately NOT done

**The tick-domain single division** the originating ticket proposed — `(cts − elstMediaTime) /
timescale` instead of two double additions — is **refuted**. It computes the same unrepresentable
boundary; a zero-ulp target still floors one frame low. Do not re-derive it.

**An epsilon** is refused for the reason this repo already recorded for the same lattice
(`strides-ac9.12`): it has no semantics, its sign depends on a rounding mode that was unverified
until this change measured it, and it would need re-picking for every frame rate.

## Impact

- Affected specs: `results-view`
- Affected code: `src/video/evidenceSeekOffset.ts`, `src/video/extractFrames.ts`
- Cost: every clip now pays the container probe even with `sequentialSampling` disabled, where the
  old early return skipped it — measured at 25.2 ms on the 4K clip and 8.1 ms on the front-approach
  one against extraction's ~3.5 s, and cached per blob.
