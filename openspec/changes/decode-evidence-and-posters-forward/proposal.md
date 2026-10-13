## Why

On a Galaxy S21 (Chrome 153, three-clip demo, real GPU) every evidence extraction took 7–11 s and
clip 1's poster 12.3 s, almost all of it `seekAndDrawMs` on a detached `<video>`. A `<video>` seek
cannot start decoding at the frame it wants: it restarts at the preceding keyframe every time, and
this app's footage has very long GOPs — `park-side-landscape.mp4` has ONE keyframe in 233 frames of
4K, so a ~15-target evidence plan decodes the opening of that clip ~15 times over, while the
analysis run competes for the same decoder (`strides-6i6.4`).

## What Changes

- Evidence images and clip posters are drawn from `VideoFrame`s out of ONE forward `VideoDecoder`
  pass over the clip's (already cached, or borrowed) demuxed track, wherever the clip is one the
  WebCodecs sampling path can decode.
- Which frame is drawn does not change: each seek target is mapped to the frame a paused `<video>`
  presents there, modelled from the container and measured against Chromium on every frame of all
  ten gate clips. Wherever the mapping is uncertain, the clip falls back to the detached `<video>`.
- Which pixels are drawn does not change: the same `drawImage` crop/scale/blend/annotation, from the
  decoded frame instead of the element — measured pixel-identical in-browser on every evidence image
  and poster of the gate corpus.
- No metric, sampling, person-selection, view or evidence-coverage value moves.

## Capabilities

### Modified Capabilities

- `results-view`: evidence extraction may draw from a forward decoder that yields the identical
  frame, falling back to the detached element.
- `video-input`: the one-transient-decoder ceiling counts `VideoDecoder`s as well as `<video>`s.

## Impact

`src/video/decodedFrames.ts` (new), `extractFrames.ts`, `posterFrame.ts`, `clipBytesCache.ts`
(`borrowClipDemux`). No change to `src/pose/`, sampling, or any assessment input.
