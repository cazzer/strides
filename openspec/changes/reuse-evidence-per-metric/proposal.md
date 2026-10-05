## Why

Every single-clip run extracted evidence twice. The primary-pass extraction ran most of the way
through and was then superseded by the background scale-pass graft, which aborted it and threw away
every finished image. The pass that replaced it then decoded the whole clip again, including every
metric whose plan the graft had not touched. The T0 `[perf-timings]` baseline (bead `strides-e4c.1`)
measured 1.7–3.8 s of discarded seek-and-draw per clip, and 14.5 s from upload to settled evidence on
the 3.9 s 4K `park-side-landscape.mp4`. The abort was also checked only once per image, so an
abandoned ghosted pair still paid for its second ~470 ms 4K seek (bead `strides-zm8`).

## What Changes

- Reuse is decided **per metric**, not per clip. The key is the metric's own plan entry plus the
  clip's source blob. A graft that moves one metric's plan re-decodes only that metric. The others
  keep the same canvas elements.
- A run that is still in flight records each metric the moment it finishes whole. A superseded pass's
  finished metrics are therefore reused by the pass that replaced it instead of being thrown away.
- Only **complete** metrics are reused: extracted, with every planned image present. A failed or
  partial metric, for example one that lost an image to a seek timeout, is decoded again on the next
  pass even when its plan entry is unchanged. Before this change, the whole-clip re-extraction retried
  it as a side effect.
- While a run is in flight, a metric with nothing on screen shows the complete image the run already
  holds, instead of a placeholder until the run settles. An image already on screen is still never
  replaced before settle. Held images are shown only while the set of clips is unchanged, the same
  condition that already governs carrying images forward.
- The extractor checks the abort signal before every seek and again after each seek completes, not
  once per image.

## Capabilities

### Modified Capabilities

- `results-view`: "Evidence already on screen survives a re-extraction". Reuse becomes per metric,
  failed or partial metrics are retried, and held images can appear before the run settles.

## Impact

- `src/video/extractFrames.ts`: `ClipEvidenceInput` gains `reuse` and `onMetricExtracted`. The abort
  is checked per seek. A clip with nothing left to decode opens no decoder. The `[perf-timings]` line
  counts only decoded images and adds `reusedImages`.
- `src/results/useSessionEvidence.ts`: the cache is per metric, there is an in-flight harvest, only
  complete entries are cached, and held images appear in the `extracting` state.
- No metric value, plan, crop, image or `[evidence-coverage]` output changes. The images are the
  same objects, or come from the same plan entry and blob.
