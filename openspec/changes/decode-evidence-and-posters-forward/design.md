## Context

`strides-6i6.4`. On a Galaxy S21 the evidence pass took 7–11 s per clip and clip 1's poster 12.3 s,
all of it in `<video>` seeks. Both features seek a detached `<video>` because that was the only
frame source when they were written; the WebCodecs sequential sampler (`sequentialFrameSource.ts`)
and the per-blob demux cache (`clipBytesCache.ts`) arrived later.

Two findings that reframe the ticket as written:

- **`derived: true` on the `[perf-timings]` poster line is a success flag, not a provenance flag.**
  It is `poster !== null`. Clips 2–3 were not posters "derived" from another source; every poster was
  seek-decoded. Clip 1 was slowest because it is 4K, single-keyframe (a midpoint seek decodes 116 4K
  frames), and decoded while clip 1's own analysis held the decoder.
- **The poster is the clip's MIDPOINT, not frame 0**, and the feasibility probe decodes no frame at
  all (`isConfigSupported` only). Nothing already decoded can serve as the poster without coupling
  the poster to the analysis run's schedule.

## Decisions

### D1. One forward decode pass instead of N seeks

`decodedFrames.ts` feeds the demuxed samples from the keyframe before the earliest wanted frame
(stepping back one more keyframe for an open-GOP leading picture) through the latest wanted one,
flushes, and hands each wanted `VideoFrame` to a synchronous draw callback inside `output()`, closing
every frame immediately — the same one-frame-held discipline as `sequentialFrameSource.ts`. A ghost
that precedes its own base is drawn on a second pass rather than by holding a frame or copying it
through an intermediate canvas (which would not be pixel-identical — the reason `extractFrames.ts`
already refuses intermediates).

### D2. "The same frame" is the frame the `<video>` would show, not the frame the target names

`frameShownAt` models a paused Chromium seek: `currentTime` truncated to µs; frame starts at
`cts − media_time/timescale` (strides-09b); and the element shows the FIRST frame, in presentation
order, whose start **plus its own `stts` sample duration** lies after the target. The containment
model ("interval holds the target") was tried first and disagreed with Chromium on 10 of 345 frames of
`park-side-portrait.mp4`: that clip's ten 1536-tick samples sit on frames whose presentation
neighbours are 512 ticks apart, so each covers the two frames after it. The end-based model agreed on
every frame of every gate clip (measurement below). Anything not stated with certainty — a non-trivial
edit list, a target within 2 µs of a deciding frame end (truncation plus either rounding of the
end), a target at/past the presented end — is `null`, and the clip seeks as before.

Note this means the seek path ALREADY draws the long frame for instants that name frames 79/80,
161/162, 194/195, 329/330, 342/343 on that clip. That is pre-existing and is reproduced, not fixed:
fixing it would move evidence images, which this change must not do.

### D3. Fallback keeps what it finished

A forward pass that errors, stalls (`loadTimeoutMs` without decoder progress), or meets a frame of
the wrong size BEFORE delivering every wanted frame hands the clip to the seek path with every metric
it already completed passed as `reuse` — already reported through `onMetricExtracted`, so never
redrawn or re-reported. A pass that delivered every wanted frame is `'completed'` whatever the
decoder does afterwards (a rejected `flush()` included, review round 1): nothing it owed is missing,
and `extractByDecoding` holds the same rule at the image level. Abort semantics are the seek path's:
all `'extraction-failed'`, nothing reported after the abort. The `DecodedFrameSource` (which can hold
a private demux of the whole compressed clip) is dropped before any fallback `<video>` opens.

### D4. Demux: borrow, don't re-cache

`borrowClipDemux` returns the cached track when a sampling pass still holds it, else a private
read+demux that is NOT cached — re-caching would resurrect an entry `releaseClipDemux` dropped and
nothing would drop it again. Also gated on `sequentialSampling.enabled` so a session with the
plane off never asks `canUseSequentialDecode` (which caches a demux no pass would release) — a guard
on that cache's lifetime, not this feature's switch (D6).

### D5. One decoder at a time, both kinds

Evidence tries the forward pass and falls back INSIDE the same `queueDetachedDecode` turn, so a
`VideoDecoder` and a detached `<video>` are never open together, and the one-transient-decoder
ceiling now counts both kinds (video-input delta).

### D6. Its own switch (review round 1)

`forwardDecodeConfig.ts`, default on, dev override `window.__STRIDES_FORWARD_DECODE_CONFIG_OVERRIDE__ =
{ enabled: false }`. Independent of `sequentialSampling.enabled`: one decides which sampler produced
the analysis inputs, the other where evidence pixels come from, and an A/B of either has to be able
to hold the other still. Off restores detached-`<video>` extraction for every clip.

### D7. The container's colour declaration goes to the decoder (review round 1)

`mp4Demux.ts` now reads the sample entry's `colr` box into `DemuxedTrack.colorSpace` and the forward
decoder is configured with it, so a container that declares something its bitstream does not cannot
make the two sources paint different colours. An `nclx` box maps code-for-code onto WebCodecs names;
anything else — `nclc`, an ICC profile, an `nclx` code WebCodecs cannot name — refuses forward
decoding rather than guessing. No `colr` box → nothing passed, the decoder reads the bitstream, which
is what the element does. Every gate clip carries `nclx` that matches its VUI (nine
`9/18/9` BT.2020/HLG, `park-side-portrait.mp4` `1/1/1` BT.709). The sequential SAMPLER is not given
the colour space: that would change analysis inputs, which this change must not touch. No per-clip
pixel self-check is added; identity is established by the measurement below.

### D8. A shift that trims pre-roll refuses (review round 1)

If the edit list's shift leaves any frame presenting before zero, the edit is trimming pre-roll the
element never shows, and nothing here has measured how the element treats the frames around zero —
`presentationTimeline` returns `null`. No gate clip does this (each `media_time` equals the first
composition time, strides-09b).

### D9. Posters are left on the seek path (review round 1)

A forward-decoded poster was built, measured pixel-identical (11 / 11) and then withdrawn: on
desktop a midpoint poster decodes the same keyframe→midpoint span either way, so it bought nothing
(table below), and on clips with an even frame count the midpoint sits on a frame boundary, the
model refuses, and the refusal's cost made IMG_9116's poster slower (160 → 241 ms). Revisit after the
S21 run, where the `<video>` load and the media pipeline's contention with analysis are the open
question.

## Pre-registered gate (written before the branch gate was run)

1. Shared metric gate (perf brief): `node scripts/ab-person-selection.mjs --arm 'base={}' --clips
   side-landscape,side-portrait,front-approach,multiperson,private-IMG_9114..9119 --trials 2
   --evidence` on base `054c86b` and on this branch, each with its own dev server. Strip `elapsedMs`
   and the `# commit`/`# baseURL` header lines; compare with `rtk proxy sh -c 'diff …'` AND md5.
   **Every other field identical, or the change does not ship.**
2. Evidence pixel identity: a temporary in-page probe re-extracts, through the seek path, every
   metric the forward pass completed (same plan, same calibration) and compares canvases byte for
   byte. **Any differing canvas ⇒ the evidence half does not ship.** Same for posters.
3. Frame model: every frame of every gate clip, seek-to-midpoint vs `frameShownAt`, matched by pixels
   against every decoded frame. **Any disagreement ⇒ the model is wrong and does not ship.**
4. Report `[perf-timings]` poster/evidence before/after on desktop (`--perf`).

## Measurements

Desktop, headless Chromium, `ANGLE Metal Renderer: Apple M4 Pro`, real GPU.

**Frame model (gate 3): 2838 / 2838 frames agree, 0 refused.** Every frame of all ten gate clips
(side-portrait 345, side-landscape 233, front-approach 99, multiperson 233, IMG_9114 274, 9115 253,
9116 526, 9117 273, 9118 293, 9119 309): seek a `<video>` to the frame's start + half a frame, match
the drawn pixels against every decoded frame, compare with `frameShownAt`. The containment model it
replaced disagreed on 10 of side-portrait's 345 (D2).

**Pixel identity (gate 2): 92 / 92 evidence canvases and (before D9 withdrew them) 11 / 11 posters
byte-identical.** Temporary
in-page probe (added, measured, reverted): every metric the forward pass completed was re-extracted
through the seek path with the same plan and calibration, and the two canvases compared with
`getImageData`, byte for byte. Per clip, evidence images compared: side-landscape 8, side-portrait 8,
front-approach 7, multiperson 9, IMG_9114 4, 9115 5, 9116 2, 9117 9, 9118 8, 9119 9, three-clip demo
session 23. Zero differing bytes anywhere. Two posters fell back to the seek path by design, both on
clips with an even frame count (IMG_9114 274, IMG_9116 526) where the midpoint is a frame boundary
inside the guard band.

**Shared metric gate (gate 1): identical.** Base `054c86b` vs `a6fcf67`, ten clips x 2 trials,
`--evidence`, each on its own identity-verified dev server (5354 / 5348). After stripping
`elapsedMs` and the `# commit`/`# baseURL` lines, `rtk proxy diff` shows exactly five changed lines,
all table dividers whose width follows the `elapsedMs` string length; with those removed the two
reports md5 to the same `1dbe12081dfbec48da347d8c4347d666` (2178 lines each before divider removal:
`99efb2c0…` vs `62949304…`). No metric, sampling, personSelection, view or evidence field moved.

**Timings (gate 4), `--perf`, 2 trials, desktop — re-measured on review-round-1 commit `fbb9000`.**
Evidence = both passes summed (the first is usually the one the scale-pass graft supersedes; its
length is then set by when the graft lands rather than by decode cost). `decodeSourceMs` is the time
to open the forward source in the final pass, which after `releaseClipDemux` is a private re-read and
re-demux of the clip (`borrowClipDemux`); in the first pass the sampler still holds the demux and it
is 0.1–0.25 ms. Posters are on the seek path again (D9), so their column is the base path both times:

| clip | evidence before | evidence after | final pass before → after | final-pass `decodeSourceMs` | poster before / after |
|---|---|---|---|---|---|
| side-landscape (4K, 1 keyframe) | 7.73 s | 3.91 s | 4315 → 918 ms | 24.6 ms | 446 / 443 ms |
| side-portrait | 4.82 s | 3.11 s | 1211 → 288 ms | 16.7 ms | 201 / 200 ms |
| front-approach | 2.72 s | 0.88 s ¹ | 1049 → 288 ms | 10.7 ms | 221 / 214 ms |
| multiperson | 3.33 s | 2.33 s | 1237 → 237 ms | 10.8 ms | 145 / 139 ms |
| IMG_9116 (one pass, 2 images) | 1.14 s | 1.14 s | — | 0.2 ms | 160 / 163 ms |
| IMG_9119 | 6.06 s | 2.71 s | 2259 → 308 ms | 21.4 ms | 490 / 332 ms |

¹ front-approach's first pass finished before the graft in this run (6 images, not aborted), so its
sum is not like-for-like with the base's aborted first pass; the final-pass column is.

The final pass drops 3–7x. The superseded first pass is now fast enough to finish more metrics
before the abort and hand them over through `onMetricExtracted` (strides-zm8 reuse), which is why the
final pass decodes fewer images than base's. The first round's measurement of the withdrawn poster
path (446 → 410, 201 → 229, 221 → 188, 145 → 149, IMG_9116 160 → 241 via the seek fallback, IMG_9119
490 → 334 ms) is the basis for D9.

**Review round 1 re-measurement.** After adding the container colour space to `decoder.configure`
(D7), the in-page pixel probe was re-run: 92 / 92 evidence canvases byte-identical again, same per-clip
counts as above. The shared metric gate was re-run on `fbb9000`: after stripping, the only changed
lines are six `elapsedMs`-width table dividers, and with those removed the report md5s to the same
`1dbe12081dfbec48da347d8c4347d666` as base. One probe trial (side-portrait) timed out waiting for
"Analysis complete" once and passed on retry; nothing in the analysis path is touched by this change.

## Risks

- **Pixel identity is measured on desktop Chromium (ANGLE Metal, Apple M4 Pro) only.** On Android the
  `<video>` path and WebCodecs may take different decoder/colour-conversion paths. Not measurable from
  here; the phone run must check it before this is trusted there.
- Posters stay on the seek path until the S21 run says whether the `<video>` load and its contention
  with analysis are worth a forward pass there (D9).
