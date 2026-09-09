# Design — pin the evidence seek's media-to-presentation clock conversion

This is a **measurement** change. The code under investigation turned out to be correct, so the
artifact is the evidence, the refutation of the report, and a requirement that stops the same wrong
model being re-derived.

## D1. The measurement

**Instrument.** A pure-Chromium seek probe: no app code, no dev server, no React. Playwright
Chromium with the repo's real-GPU launch args (`--headless=new --enable-gpu
--ignore-gpu-blocklist`), a throwaway localhost server with byte-range support, one `<video>` per
clip. For each target: assign `currentTime`, await `seeked`, `drawImage` the element into a canvas
at native resolution, write the PNG.

**Ruler.** `ffmpeg -vf "select='eq(n\,N)'"` for every candidate `N` in a ±3 window around both
models' predictions, one decode pass per clip, full resolution. PSNR argmax against the Chromium
PNG names the picture actually drawn. Added, measured, reverted — nothing shipped.

**Design of the targets.** Each target is a **frame-interval midpoint**, under one model or the
other, so quantisation cannot decide the answer and the two models' predictions sit exactly two
frames apart. `presMid` is the midpoint of frame *j*'s interval assuming the edit list is applied;
`mediaMid` is the midpoint of the same frame's interval assuming it is not. Probing both is a
cross-check: exactly one model can explain both readings on the same frame. Plain wall-clock
targets (`t2.000000` etc.) are included because the bead used one, and every clip carries at least
one whole-microsecond and one non-whole-microsecond target.

**Result: 31 seeks, 4 clips. 30 matched the edit-list-applied prediction exactly, the 31st landed
one frame below it on a deliberate boundary target, and NONE matched the media-clock prediction.**

**side-landscape**

| target | currentTime | whole µs? | drawn | edit-list model | media-clock model | best / runner-up |
|---|---|---|---|---|---|---|
| `f60-presMid` | `1.0083333333333333` | no | **60** | 60 ✓ | 58 | 25.01 / 20.63 dB (n=59) |
| `f60-mediaMid` | `1.0416666666666667` | no | **62** | 62 ✓ | 60 | 24.99 / 20.02 dB (n=63) |
| `f120-presMid` | `2.0083333333333333` | no | **120** | 120 ✓ | 118 | 24.82 / 21.01 dB (n=119) |
| `f120-mediaMid` | `2.0416666666666665` | no | **122** | 122 ✓ | 120 | 24.82 / 20.99 dB (n=121) |
| `f183-presMid` | `3.058333333333333` | no | **183** | 183 ✓ | 181 | 24.82 / 22.43 dB (n=184) |
| `f183-mediaMid` | `3.091666666666667` | no | **185** | 185 ✓ | 183 | 24.83 / 23.10 dB (n=184) |
| `f204-presMid` | `3.408333333333333` | no | **204** | 204 ✓ | 202 | 24.82 / 23.16 dB (n=203) |
| `f204-mediaMid` | `3.441666666666667` | no | **206** | 206 ✓ | 204 | 24.83 / 22.38 dB (n=205) |
| `t2.000000` | `2` | yes | **120** | 120 ✓ | 118 | 24.82 / 21.01 dB (n=119) |
| `t2.016667` | `2.0166666666666666` | no | **120** | 121 | 119 | 24.82 / 21.01 dB (n=119) |

**side-portrait**

| target | currentTime | whole µs? | drawn | edit-list model | media-clock model | best / runner-up |
|---|---|---|---|---|---|---|
| `f60-presMid` | `2.15` | yes | **60** | 60 ✓ | 58 | 42.62 / 34.41 dB (n=61) |
| `f60-mediaMid` | `2.216666666666667` | no | **62** | 62 ✓ | 60 | 42.62 / 33.91 dB (n=63) |
| `f150-presMid` | `5.35` | yes | **150** | 150 ✓ | 148 | 42.61 / 33.05 dB (n=149) |
| `f150-mediaMid` | `5.416666666666667` | no | **152** | 152 ✓ | 150 | 42.61 / 32.62 dB (n=151) |
| `f250-presMid` | `8.816666666666666` | no | **250** | 250 ✓ | 248 | 42.62 / 34.45 dB (n=251) |
| `f250-mediaMid` | `8.883333333333333` | no | **252** | 252 ✓ | 250 | 42.63 / 34.79 dB (n=251) |
| `t5.000000` | `5` | yes | **142** | 142 ✓ | 140 | 42.60 / 34.78 dB (n=141) |

**front-approach**

| target | currentTime | whole µs? | drawn | edit-list model | media-clock model | best / runner-up |
|---|---|---|---|---|---|---|
| `f20-presMid` | `0.34200833333333336` | no | **20** | 20 ✓ | 18 | 24.10 / 23.33 dB (n=19) |
| `f20-mediaMid` | `0.375375` | yes | **22** | 22 ✓ | 20 | 24.11 / 23.34 dB (n=23) |
| `f50-presMid` | `0.8425083333333333` | no | **50** | 50 ✓ | 48 | 24.11 / 22.41 dB (n=51) |
| `f50-mediaMid` | `0.875875` | yes | **52** | 52 ✓ | 50 | 24.11 / 21.99 dB (n=53) |
| `f80-presMid` | `1.3430083333333334` | no | **80** | 80 ✓ | 78 | 24.04 / 20.30 dB (n=79) |
| `f80-mediaMid` | `1.376375` | yes | **82** | 82 ✓ | 80 | 24.04 / 20.20 dB (n=83) |
| `t1.000000` | `1` | yes | **59** | 59 ✓ | 57 | 24.11 / 21.93 dB (n=60) |

**multiperson**

| target | currentTime | whole µs? | drawn | edit-list model | media-clock model | best / runner-up |
|---|---|---|---|---|---|---|
| `f60-presMid` | `1.0083333333333333` | no | **60** | 60 ✓ | 58 | 24.82 / 21.92 dB (n=59) |
| `f60-mediaMid` | `1.0416666666666667` | no | **62** | 62 ✓ | 60 | 24.78 / 21.41 dB (n=63) |
| `f120-presMid` | `2.0083333333333333` | no | **120** | 120 ✓ | 118 | 24.64 / 21.93 dB (n=119) |
| `f120-mediaMid` | `2.0416666666666665` | no | **122** | 122 ✓ | 120 | 24.65 / 21.97 dB (n=121) |
| `f183-presMid` | `3.058333333333333` | no | **183** | 183 ✓ | 181 | 24.64 / 22.82 dB (n=182) |
| `f183-mediaMid` | `3.091666666666667` | no | **185** | 185 ✓ | 183 | 24.66 / 23.23 dB (n=184) |
| `t2.000000` | `2` | yes | **120** | 120 ✓ | 118 | 24.64 / 21.93 dB (n=119) |

The `n=` in the last column is the second-best PSNR candidate's frame index, not a model prediction.

**The single row that is not a ✓ is the boundary target, and it does not favour the other model
either.** `t2.016667` asks for `121/60 = 2.0166666666666666`, a frame **boundary** that is not a
whole microsecond. Chromium's `currentTime` read back `2.016665`, below the boundary, so the seek
landed in frame 120. That is precisely the quantisation the midpoint term (`strides-5t4`) exists to
absorb, reproduced here deliberately. The media-clock model predicts 119; the measured answer is
120. So all 31 rows refute the media-clock model, 30 by hitting the edit-list prediction exactly and
one by landing one frame below it in the direction quantisation is known to go.

**Margins.** Every argmax is unimodal and clear of its runner-up: 1.66–4.98 dB on side-landscape,
1.43–3.37 dB on multiperson, 7.81–9.99 dB on side-portrait. front-approach is the tightest at
0.76–3.85 dB, which is expected — it is a 1.65 s handheld approach clip where consecutive frames are
genuinely similar — and its argmax still agrees with every other clip.

## D2. Why the report read a correct conversion as a two-frame error

`select='eq(n,N)'` indexes **coded pictures**, in presentation order, starting at zero. It does not
index timeline slots. And in all four files the lowest composition timestamp in the track is exactly
the edit list's `media_time`:

| file | md5 | timescale | `elst media_time` | min sample CTS | frames |
|---|---|---|---|---|---|
| `park-side-landscape.mp4` | `106dcee8…` | 15360 | 512 | **512** | 233 |
| `park-side-portrait.mp4` | `e380759e…` | 15360 | 1024 | **1024** | 345 |
| `park-approach.mp4` | `36207375…` | 60000 | 2002 | **2002** | 99 |
| `multiperson-track.mp4` | `5da45ab1…` | 15360 | 512 | **512** | 233 |

All four carry a `ctts` box. This is the ordinary B-frame **priming** edit: the first picture's
composition time sits ahead of its decode time by the reorder depth, and the edit list cancels
exactly that so presentation starts at zero. **No picture precedes the edit and none is discarded**
— ffmpeg emits all 233 (or 345, or 99) pictures with `-ignore_editlist 1` and without it, and the
`select` index is identical either way.

So the composition time of ffmpeg frame `N` is `(media_time + N·Δ)/timescale`, and its presentation
time is `N·Δ/timescale`. The bead assumed the former was `N·Δ/timescale` — i.e. that `media_time`
named two frames the edit had trimmed away. That mis-numbers every picture in the file by exactly
`media_time`, which is the quantity under dispute, so a correct conversion necessarily reads as an
error of that size in the opposite direction. The `elst media_time` figure is a genuine "shift"; it
is not a "trim", and the module's own docs called it one.

Re-indexed, the bead's three observations become confirmations rather than contradictions:

| bead's observation | measured frame | media-clock model | edit-list model |
|---|---|---|---|
| pure seek `currentTime = 2.0` | **120** | 118 | **120** ✓ |
| app seek `3.049999666666667` (pre-midpoint) | **182** | 180 | **182** ✓ |
| app seek `3.399999666666667` (pre-midpoint) | **203** | 201 | **203** ✓ |

Those two are the app's seek targets *before* `strides-5t4` added the midpoint — timestamp plus the
clock conversion, with no half-frame. Today's targets are `3.058333` and `3.408333`, and D1 measured
those drawing 183 and 204.

## D3. Two cited readings that cannot decide this

**`video.duration` is a non-discriminator.** The edit segment covers the whole media on all four
files, so the presentation span and the media span are the same length; `segment_duration` differs
from the media duration only by rounding into the 1000 Hz movie timescale (`3884` ms vs
`59648/15360 = 3883.33` ms — 0.67 ms). Measured Chromium `duration`: side-landscape `3.883333`,
side-portrait `12.166667`, front-approach `1.65165`, multiperson `3.883333` — each exactly the media
duration, and each exactly what the edit-list model predicts too.

**`-ignore_editlist 1` changing nothing is not evidence that ffmpeg ignores the edit list.** It
demonstrably does apply it — the first video packet's PTS is `0` by default and `512` with the flag,
on side-landscape — but ffmpeg re-bases output start time either way, so `showinfo` reports the same
`pts_time` in both modes. Concretely: `select='eq(n\,183)'` reports `pts_time 3.05` with and without
the flag. `3.05` is frame 183's **presentation** time (`183/60`); its composition time is
`47360/15360 = 3.083333`. The bead read that `3.05` as a media time.

## D4. Which clock the sampled timestamp is actually on — traced, not assumed

`mp4Demux.ts` sets `ptsSec: sample.cts / sample.timescale` — the raw composition time, with no
edit-list adjustment. `sequentialFrameSource.ts` puts `Math.round(ptsSec * 1e6)` on the
`EncodedVideoChunk`, the decoder carries it to `VideoFrame.timestamp`, and the same file reads it
back as `frame.timestamp / 1e6` into what becomes `robustFrames[].timestamp`.

That reproduces the observed exemplar timestamps exactly. `footStrikePattern`'s left exemplar on
side-landscape reads **3.083333** in `[evidence-coverage]`; frame 183's composition time is
`47360/15360 = 3.0833333…`, which rounds to `3083333` µs. Subtracting `512/15360` gives presentation
`3.05` — frame 183 — and adding the midpoint gives `3.058333`, which D1 measured drawing frame
**183**. Residual: **zero frames**.

The numeric coincidence worth naming, because it is what makes this easy to get wrong: frame 183's
composition time (`185/60`) is numerically identical to frame **185**'s presentation time. The
timestamp alone cannot tell you which frame it names; only the clock can.

## D5. By file, by container detail, or misindexed? — misindexed

- **Not by file.** `park-side-landscape.mp4` and `multiperson-track.mp4` are the controlled pair —
  different footage, different resolution (3840×2160 vs 1920×1080), different md5, byte-identical
  timing lattice (15360 / `media_time` 512 / 60 fps / 233 frames). They agree on all six shared
  targets and on `t2.000000`.
- **Not by container detail.** front-approach is a different timescale (60000), a different frame
  duration (1001 ticks, 59.94 fps) and a different `media_time` (2002); side-portrait is
  variable-frame-rate (335 samples at 512 ticks, 10 at 1536, 21 `stts` runs) with `media_time` 1024.
  Both behave identically to the pair.
- **Misindexed**, per D2.

## D6. Verdict: the term STAYS, unchanged

`editListSeekOffsetSeconds` returns `media_time / mediaTimescale` for a single unity-rate entry, and
`deriveEditListOffset` negates it and gates it on the two sampler predicates. That is the correct
media→presentation conversion, measured on the whole corpus. Removing or narrowing it would move
every WebCodecs-sampled clip's evidence two frames late.

Note the formula is correct for the general single-entry unity-rate case and not merely for the
priming shape this corpus happens to carry: an edit list *defines* presentation time within a
segment as `(sample composition time − media_time) / timescale`, whether or not any sample precedes
`media_time`. Nothing here depends on the priming coincidence except the *explanation*.

## D7. Looked at the images

The instant `footStrikePattern` measures is touchdown, so the question is whether the drawn frame
shows first contact. Pulled from the source at full resolution with a 40 px grid overlay, foot
region cropped:

| frame | what it shows |
|---|---|
| 182 | shoe airborne, a visible band of tarmac between sole and shadow |
| **183** (drawn today) | **sole meets ground, shadow continuous beneath it, shin still angled forward — touchdown** |
| 185 (drawn if the term were removed) | foot planted and the shin already rotated over it — **mid-stance** |

Same on the right strike: **204** is touchdown, **206** is mid-stance. So removing the term would
not merely move the picture, it would change what the picture is *of* — from the instant the card
reports to a later phase of the same stride. The images agree with the arithmetic.

This independently reproduces `strides-5t4`'s acceptance criterion (183 and 204) from a pure
Chromium seek, with no app involved. The probe's two targets are the exact interval midpoints
`3.058333333333333` and `3.408333333333333`; the app's are `3.0583330` and `3.4083330`, from its
µs-rounded timestamps `3.083333` / `3.433333` (verified in `before.json`) minus `512/15360` plus
`1/120`. The 333 ns between them is four orders of magnitude inside a 16.7 ms frame, so they are the
same request as far as the seek is concerned.

## D8. Why no new unit test

The fact established here is a browser-level one — which picture a media element paints for a given
`currentTime` — and the unit suite has no media element. The pure functions either side of it are
already covered: `editListSeekOffsetSeconds` has nine cases including all four decline branches, and
`resolveEvidenceSeekCalibration` has a case per real clip plus the negation. A test that restated
those would add no coverage. The durable protection is the requirement in the spec delta, which
states the mental model the code was reported against.

## D9. What this does not touch

- **`robustFrames[].timestamp`** — correct in its own (composition) domain, and deliberately not
  converted. The conversion lives at seek time only.
- **The midpoint term** — independent by construction, `+1` frame regardless of the conversion, and
  not re-derived here.
- **`strides-pr1`'s footstrike sampling-instant lag** — a different quantity (which instant the
  metric picked, not where the seek lands) and not this change's to fix.
- **The `δ = −1 frame on multiperson` residual** recorded in `CLAUDE.md` — superseded by the
  midpoint term, and this measurement shows no residual on that clip at any of its seven targets.
