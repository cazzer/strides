# Design — seek evidence frames to the frame midpoint

## D1. The microsecond lattice, and which way it rounds

`HTMLVideoElement.currentTime` is a double in the API and an integer count of microseconds inside
Chromium. **Measured, pure Chromium seek, no app code** (`park-side-landscape.mp4`, headless
Chromium, real GPU):

| assigned | read back |
|---|---|
| `3.049999666666667` | `3.049999` |
| `3.0583333333333336` | `3.058333` |
| `3.399999666666667` | `3.399999` |

It **truncates**. The originating ticket carried this as an unresolved caution ("Chromium's rounding
mode … was NOT verified"); it is now measured. The midpoint is correct under either mode, so the
answer does not gate the change — but it does explain why the *before* arm looks the way it does,
and it is recorded here so nobody has to measure it again.

A frame's presentation boundary on this clip is `n × 256 / 15360 = n / 60` seconds. In microseconds
that is `n × 16666.666…`, a whole number only when `n mod 3 == 0`. **Two of every three boundaries
cannot be named in the seek API**, and the truncation always lands the request in the previous
frame's interval.

That is not a small target — it is a target with **zero** error budget, approached with at least
three independent sources of sub-microsecond error:

1. the sampler's own timestamp is truncated to six decimals before it reaches the plan
   (`3.0833333333333335` arrives as `3.083333`) — `strides-e6y`'s subject;
2. the edit-list term is a second double added to the first;
3. the boundary itself is irrational in microseconds.

`strides-e6y` shrinks (1) to 333 ns. At a boundary target, 333 ns and 333 ms are the same verdict.

## D2. Why the midpoint, and not an epsilon

`currentTime = t` displays the frame whose presentation interval **contains** `t`. The interval is
the object; the boundary is one of its endpoints, and the one endpoint where an arbitrarily small
error changes the answer. Asking for the middle of the interval is a statement of what is actually
wanted, and it happens to be the point maximally far from both failure edges.

Quantitatively: half a frame is **8.33 ms** at 60 fps and **16.7 ms** at 30 fps, against the 333 ns
an exact-timestamp fix buys. It is robust to truncation, to round-to-nearest, to the six-decimal
sampler truncation, and to a stored timestamp sitting a microsecond off the arithmetic — which is
exactly the residual `strides-ac9.12` left open on this same lattice and explicitly refused to
paper over with an epsilon. This is the fix that makes that residual irrelevant rather than
tolerated.

An epsilon was refused for the reasons already on the record: no semantics, a sign that depends on
the rounding mode, and a magnitude that would need re-picking per frame rate. A midpoint has all
three properties an epsilon lacks — it means something, its sign is not a choice, and its magnitude
is derived from the clip.

## D3. Where the frame duration comes from

`ContainerVideoTrackTiming.nominalFps`, already produced by `probeContainerTiming` as
`mediaTimescaleHz / weightedMedianSampleDeltaTicks(stts)`. `evidenceSeekOffset.ts` already runs that
probe for the edit list, so the frame duration costs **nothing new** — one `arrayBuffer()`, one
parse, two numbers out.

Read off the three bundled clips with this repo's own box walk:

| clip | media timescale | `stts` delta | `nominalFps` | `midpointOffsetSeconds` | `elst media_time` | `offsetSeconds` |
|---|---|---|---|---|---|---|
| `park-side-landscape.mp4` | 15360 | 256 (CFR) | 60 | `0.008333333333333333` | 512 | `-0.03333333333333333` |
| `park-side-portrait.mp4` | 15360 | median 512 (VFR, 21 runs of 512 and 1536) | 30 | `0.016666666666666666` | 1024 | `-0.06666666666666667` |
| `park-approach.mp4` | 60000 | 1001 (CFR) | 59.94005994005994 | `0.008341666666666667` | 2002 | `-0.03336666666666667` |

Rejected sources, so nobody re-derives them:

- **A `frameDurationSeconds` field on `ContainerVideoTrackTiming`** — `1 / nominalFps` is one line
  and one consumer. A container field for one caller is an abstraction with a single use case.
- **`DemuxedTrack.samples[].durationSec`** — costs a full `demuxMp4` of a 38 MB clip that the
  extraction path does not otherwise do, plus threading it through `useSessionEvidence`.
- **`evidenceSnapTolerance` from `evidenceFrames.ts`** — that is the sampling *stride*, not the
  container frame duration. On a strided clip it is several frames long and would overshoot into a
  later frame entirely.

**VFR caveat.** A weighted-median frame duration can exceed a short frame's real duration, and half
of it would then land in the *next* frame. `park-side-portrait.mp4` is genuinely VFR — 21 `stts`
runs at 512 and 1536 ticks — but its median 512 is also its **minimum**, so half of it is inside
every interval on that clip. Safe in this corpus; not safe in general. A one-frame-**late** PSNR
argmax is that failure's signature.

## D4. Two terms, not one, and in this order

The seek target is `instant.timestamp + offsetSeconds + midpointOffsetSeconds`.

**Separate**, because they answer different questions:

| | edit-list shift | midpoint |
|---|---|---|
| what it is | a clock conversion, media → presentation | a targeting policy |
| varies by | clip AND sampler | clip only |
| zero when | the `<video>` sampler ran, or no shifting `elst` | the container names no frame rate |

Merging them would make the name `seekOffsetSeconds` and the constant
`DEFAULT_EVIDENCE_SEEK_OFFSET_SECONDS` false, destroy the per-clip offsets this repo has recorded
and ground-truthed, and make the midpoint untestable on its own.

**In that order**, because the edit-list term converts a media-clock frame START into a
presentation-clock frame START, and only *then* is "add half an interval" the middle of the interval
`currentTime` is compared against. Both terms are additive and a unity-rate edit list preserves
interval length, so the number is identical either way today. The ordering is stated so it stays
correct if a non-unity-rate edit list is ever admitted — at which point the midpoint would have to
be scaled by the same rate, and the code would be sitting on the right side of the conversion to do
it.

**The midpoint applies on every sampler**, WebCodecs and playback alike, so the
`sequentialSampling.enabled` early return moved to guard only the edit-list term. The microsecond
quantisation is a property of `HTMLVideoElement.currentTime`, not of whatever produced the
timestamp. See D7 for how that was verified rather than assumed.

## D5. The final frame

The last frame's interval ends at the clip's end, so half a frame past its start can sit beyond a
duration the element will refuse to seek to. The target is clamped to `video.duration`.

Relying on the browser's own clamp was rejected: if two successive instants both clamp to the same
end, the second assignment may not fire `seeked` at all, and `seekTo` would burn `SEEK_TIMEOUT_MS`
and fail the exemplar — turning a cosmetic overshoot into `extraction-failed`.

## D6. The no-duration fallback

`midpointOffsetSeconds` is `0` whenever the frame duration is not derivable, and `0` is exactly the
seek that shipped before this change:

- the container does not parse — **every WebM and every webcam recording** (`'parse-error'`), and
  every truncated or unrecognised buffer (`'unsupported-container'`);
- the file parses but carries no video track;
- `nominalFps` is `null` (no usable `stts`), or not a positive finite number;
- `blob.arrayBuffer()` rejects;
- there is no blob at all — `extractPlannedFrames(video, plan)` is handed an element, so it inherits
  the zero default exactly as it already did for the edit-list term.

Same "a wrong number is worse than none" posture `editListSeekOffsetSeconds` already takes.

The clamp in D5 has its own version of this: `video.duration` is `NaN` in jsdom and `Infinity` on a
webcam recording, and the clamp declines on any non-finite value rather than poisoning the target.
That is what keeps the spec's existing infinite-duration guarantee true — the reported duration may
only *bound* a timestamp that was already derived from sampled frames, never produce one.

## D7. The playback path, verified rather than assumed

No bundled clip takes the playback path by default, so "half a frame keeps it in the same frame
there" was a claim needing measurement, not a deduction. Forced with
`{"sequentialSampling":{"enabled":false}}` on `side-landscape`:

- `offsetSeconds` is `0` on that arm (rVFC's `mediaTime` is already on `currentTime`'s clock) and
  `midpointOffsetSeconds` is `0.008333…`;
- the drawn frame index is **unchanged** from before the change.

The pre-registered fallback, had the argmax moved one frame late, was to gate the midpoint behind
the same `canUseSequentialDecode` predicate the offset uses — a one-line change to `derive()`. It
was not needed. Result in the tasks checklist.

## D8. Live verification and gates

Everything below ran on a fresh Chromium process per trial, real GPU
(`ANGLE Metal Renderer: Apple M4 Pro`), against a dev server this run started on the derived
per-checkout port and verified by nonce.

1. **BEFORE arm captured on the unmodified tree first**, so risk 1 (the symptom failing to
   reproduce) could fire before any code was written. It did not: the argmax read 182 and 203.
2. **PSNR argmax** per footstrike card, reconstructing each candidate crop from the source with
   `ffmpeg -vf "select='eq(n\,IDX)',crop=…"` over a ±5-frame window. Both cards are
   `kind: 'footStrike'` with `pairedTimestamp: null`, so no ghost blend is involved and the
   reconstruction is a plain crop.
3. **A/B gate**: `scripts/ab-person-selection.mjs --arm 'base={}' --clips
   side-landscape,side-portrait,front-approach --trials 3 --evidence`, before and after, compared
   with `rtk proxy diff` plus an `md5` cross-check of the report body. **No `metrics.*`,
   `sampling.*`, `personSelection.*`, `view.*` or `evidence.*` field may move.** `evidence.*`
   derives from the plan, which this change cannot reach, so movement there would mean a newly
   failing seek.
4. **Looked at the images**, at full resolution, on the criterion the bead states: a hard
   sole/ground boundary with the shadow continuous beneath the foot.

## D9. What this does not fix

Two things were measured in passing and are **out of scope**, filed rather than folded in.

**The edit-list offset is wrong on this clip.** `evidenceSeekOffset.ts`'s premise is that
`HTMLVideoElement.currentTime` is edit-list-adjusted while the WebCodecs timestamp is raw media
time. On `park-side-landscape.mp4` that is not what Chromium does: `video.duration` reads
`3.883333` (= 233/60, the full media duration) rather than `3.884` (the `elst` `segment_duration`),
and a pure Chromium seek to `currentTime = 2.0` draws **media frame 120** — the edit-list-applied
model predicts 122. So the `−0.0333` term moves this clip's seek two frames early, and the drawn
frame after this change is two frames from the instant the metric measured, not zero.

That is a separate defect with a much larger blast radius — it reaches every clip's calibration and
contradicts a measurement this repo already recorded — and correcting it needs its own A/B across
the whole corpus. It does not block this change: the midpoint's effect is `+1` frame regardless of
what the offset is, the frame it now lands on is the first-contact frame the bead asks for, and the
two terms are independent by construction (D4), so fixing the offset later composes cleanly. Filed
as **`strides-09b`**.

Worth stating explicitly, because the two are easy to conflate: the original `+2 frames` drift was
ground-truthed on the retired Pexels clip and on `e2e/fixtures/multiperson-track.mp4`, and
`multiperson-track.mp4` is a **different file** from `park-side-landscape.mp4` — md5
`5da45ab1fbc9d4af89e7d6d7a9416d73` vs `106dcee831466d7e5a38e606043b3ffa` — that happens to sit on
an identical timing lattice (15360 timescale, `elst media_time` 512, 60 fps, 233 frames, same
`stretchFactor`). A reading on one is not a reading on the other, and nobody had measured
`park-side-landscape`'s directly until now.

> ⚠️ **CORRECTION, 2026-09-06 (`strides-09b`, change `pin-the-evidence-seek-clock-conversion`).**
> **The "edit-list offset is wrong on this clip" claim above is WITHDRAWN. It is correct, on all
> four clips.** The paragraph is left exactly as written because its two readings were honestly
> measured and are true — `video.duration` really does read `3.883333`, and a pure Chromium seek to
> `currentTime = 2.0` really does draw the picture `ffmpeg -vf "select='eq(n\,120)'"` produces. What
> was wrong is the model those readings were checked against.
>
> `select='eq(n,N)'` indexes **coded pictures**, and on all four corpus clips the lowest sample
> composition timestamp equals the `elst media_time` exactly (512 / 1024 / 2002 / 512) — the
> ordinary `ctts` B-frame priming edit, which discards no picture. So ffmpeg frame `N` sits at
> composition time `(media_time + N·Δ)/timescale`, not `N·Δ/timescale`. Under the correct indexing
> the edit-list-applied model predicts **120**, not 122, and the reading above confirms it.
> `video.duration` cannot discriminate at all: the edit segment spans the whole media, so `3.884` is
> just `3883.33 ms` rounded into the 1000 Hz movie timescale.
>
> Re-measured with a pure-Chromium probe over the whole corpus — 31 seeks, 4 clips, each target
> predicted two frames apart under the two models, PSNR argmax against ffmpeg-reconstructed
> candidates — **30 of 31 matched the edit-list-applied model exactly (the 31st is a deliberate
> frame-boundary target that landed one frame low on the known microsecond truncation), and not one
> matched the media-clock model.**
>
> **Consequences for this change specifically.** Its acceptance criterion — both `footStrikePattern`
> cards draw frames **183** and **204** — is **CONFIRMED, not stale**: the re-measurement reproduces
> it from a pure Chromium seek at this change's own two targets, with no app involved, and looking
> at the frames again puts touchdown at 183/204 and mid-stance at 185/206. The sentence above
> claiming "the drawn frame after this change is two frames from the instant the metric measured,
> not zero" is **withdrawn — the residual is zero**. Nothing else in this change is affected; the
> midpoint term was independent of the offset by construction and still is.

**`vite.config.ts` carries `port: 5177` at the top level of `defineConfig`**, which is not a valid
option there (it belongs under `server`), is the repo's one standing `tsc` error, and does not pin
anything — Vite ignores the unknown key, which is why the derived-port harness kept working.
Pre-existing, untouched, filed as **`strides-3rp`**.
