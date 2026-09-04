# Design — bundle a three-clip demo

## D1. The clips, and why these three

Measured with `ffprobe`, decoded frame counts cross-checked with `-count_frames` rather than
trusted from container metadata (which lied on one of them — see D2).

| slot | file | dimensions | decoded frames | duration | size | view |
|---|---|---|---|---|---|---|
| 1 | `park-side-landscape.mp4` | 3840×2160 | 233 | 3.88 s | 36.7 MB | side |
| 2 | `park-side-portrait.mp4` | 1080×1920 | 345 | 12.17 s | 19.5 MB | side |
| 3 | `park-approach.mp4` | 2160×3840 | 99 | 1.65 s | 12.0 MB | front |

Ordering is landscape-side, portrait-side, front-approach. The two side clips lead because the
side view is the geometry most of the panel gates on, so the fused result is populated by the time
a reader looks at it. `park-approach.mp4` keeps its bytes and its name — it is the same file, just
no longer addressed by a button of its own.

The set covers both camera geometries the heuristics gate on: `stepWidth` and `stepWidthCm` want a
front view, while `verticalRatio`, `kneeFlexion`, `overstriding` and `footStrikePattern` want a
side one. A single-clip demo can satisfy one or the other, never both, which is exactly why the
demo is now a session rather than a clip.

## D2. HEVC, rotation and a lying container

Both new clips arrived as iPhone HEVC-in-`.mov`. Per CLAUDE.md's externally-sourced-clips note,
HEVC decode outside Safari is spotty and this app's canvas frame reads need a codec Chromium can
actually decode, so both were transcoded to H.264:

```
ffmpeg -i in.mov -map 0:v:0 -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -an out.mp4
```

Two things this surfaced, both worth recording because both fail quietly:

**The portrait clip carried `rotation=-90` as display metadata**, presenting as 1920×1080 with a
rotation matrix. The transcode baked the rotation into the pixels and emitted a genuine 1080×1920
stream with no matrix. That is the form to keep: a rotation matrix makes the video's stored
dimensions disagree with its displayed ones, and this pipeline reads pixels off a canvas whose
size comes from the element — a disagreement that would silently transpose every evidence crop.

**That clip's container claimed 402 frames; only 345 decode.** Exactly the failure CLAUDE.md
records ("one clip this session declared 94 frames in its container metadata but only 66 were
actually decodable, which broke this app's frame-sampling loop down to a single sample"). Verified
on both sides of the transcode with `ffprobe -count_frames`: 345 in, 345 out. Nothing was lost;
the metadata was wrong to begin with. 345 frames over 12.17 s is ~28.4 fps, i.e. the source is
variable-frame-rate, which is normal for a phone recording.

## D3. Native resolution, and what it costs

Kept at native resolution by explicit decision: ~69 MB of demo assets, against ~23 MB for a
1080p/CRF26 alternative that was measured (4.1 MB + 7.1 MB) and rejected.

The cost is real and lands on the repository and on every deploy, not on the running app: Vite
emits these as assets rather than bundling them, so nothing is fetched until the demo action is
activated. What the size does buy is a landscape 4K clip in the corpus — the only one, since
`park-approach.mp4` is portrait 4K — and headroom for evidence crops, which run up to a
`min(frameWidth, frameHeight)` side before being displayed at 144 CSS px.

## D4. Emit per clip, not per set

`MultiClipVideoSession.addClip` is called once per source and appends via functional `setState`,
so three synchronous calls produce three clips. That makes the naive implementation — fetch all
three, then emit — correct but poor: 69 MB downloads before anything happens.

The clips are instead fetched and emitted **sequentially**, one at a time. Clip 1 lands and starts
analyzing while clips 2 and 3 download, and the shared detector is already serialized across clips
by `nextActiveClipIndex`, so a clip arriving mid-analysis is the designed path rather than a race.

Sequential rather than `Promise.all` + ordered emit, because ordered emit after a parallel fetch
still waits for the slowest clip before the first one starts, which is the cost being avoided.

## D5. The A/B harness keeps per-clip arms — and stops needing network

`scripts/ab-person-selection.mjs` addressed two of its three clips by demo-button accessible name
(`/demo 1/i`, `/demo 2/i`). Both names are gone, and a button that loads three clips at once cannot
serve as a per-clip arm anyway: every arm would measure a fused three-clip session.

The fix is available because of this change rather than despite it. All three clips are now local
files, so all three drive through the Upload tab exactly as `multiperson` already does — no demo
button involved, no network, and `demo1` loses the "needs network" caveat it has carried since the
harness was written.

Harness clip keys are renamed to name the footage rather than a button that no longer exists:

| old key | new key | route |
|---|---|---|
| `demo1` (Pexels, network) | `side-landscape` | upload |
| `demo2` (park-approach) | `front-approach` | upload |
| `multiperson` | `multiperson` | upload (unchanged) |

⚠️ **This renames what a report's clip column means.** A `before.txt` captured with the old keys
diffs against a new one on every clip row. That is a contract break in the harness's output and is
intended: silently reusing `demo1` for different footage would make two incomparable measurements
look comparable, which is the precise failure this repo's provenance guards exist to prevent.

⚠️ **Every anchor CLAUDE.md records under "Demo 1" was measured on the Pexels clip** — the
`verticalOscillationCm` 4.4215 cm regression anchor, `cadence` 91.2, `kneeFlexion` 120.690…, the
coverage tables, the footstrike ground truth at 4.08/4.74/5.40/6.06. None are retrofitted: they
were honestly measured, the clip still exists at a stable URL, and rewriting them would destroy the
record. They are labelled with the footage they were measured on instead.

## D6. What is deliberately NOT done

- **No new anchors are established for the new clips in this change.** Doing so would mean a
  multi-trial fresh-process A/B per clip, which is a measurement task, not a wiring task. The clips
  are verified to analyze end to end; they are not yet a regression corpus.
- **`park-approach.mp4` is not re-encoded, renamed or moved.** It keeps its bytes so that every
  reading taken on it stays comparable.
- **The Pexels URL is not preserved behind a flag.** A dead code path nobody exercises rots; the
  URL is recorded here and in the archived change if it is ever needed again:
  `https://videos.pexels.com/video-files/8533913/8533913-uhd_3840_2160_25fps.mp4`
