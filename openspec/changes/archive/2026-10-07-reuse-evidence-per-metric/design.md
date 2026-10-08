## Context

`useSessionEvidence` cached one result per clip and reused it only when the whole clip plan was
structurally identical (`strides-3ui`). The scale-pass graft changes one metric's plan and aborts the
in-flight primary-pass extraction, so on every single-clip run that cache was empty or stale and the
whole clip was decoded again.

## Decisions

**D1: per-metric reuse, keyed by plan entry plus blob.** A metric's pixels are a pure function of the
clip bytes and that metric's own plan entry: its instants, crop, opacities and annotation inputs.
The seek calibration is derived from the blob, and no metric's extraction reads another metric's
entry. So per-metric equality is exactly as sufficient as the per-clip equality it replaces. The
entry is compared with `JSON.stringify`, on the same grounds the per-clip check already used.

**D2: harvest finished metrics from in-flight runs.** `onMetricExtracted` fires only after a metric's
last image, and only when the abort signal is clear. The hook also ignores a report from a run that
is no longer current. The clip-level result of an aborted pass is still all-failed and never reaches
state; only metrics that finished whole are kept, in the cache, never in state.

**D3: cache only complete metrics.** A failed or partial metric is a correct verdict for its pass,
but caching it would pin the loss for as long as the plan entry held. The pass most likely to time out
is the primary-pass extraction, which runs while the scale pass contends for the GPU. Cost: a metric
that fails every time is retried on every re-run. Re-runs happen only on input changes (graft, clip
added or removed), so that cost is bounded.

**D4: held images before settle, never over an on-screen image.** An image on screen always wins
until settle, which keeps the "replace only when the new pass settles" rule. A held image fills only
an empty slot, and only while the clip set is unchanged. Held images are attributed by the current
run's own winning clip, but showing them across a clip-set change would contradict the
withhold-on-clip-set-change rule as written. Not worth widening for one render.

**D5: abort per seek.** A ghosted pair is two seeks. Checking only per image let an abandoned pass
spend one 4K seek (~470 ms) on an image already destined for the bin, while the superseding pass
waited behind it in the process-wide decoder queue.

## Not done

Skipping the first extraction, or skipping the metrics the scale pass will graft, until the graft
lands was considered and rejected. With D2 the first pass's unchanged-metric work is no longer
wasted. The centimetre metrics are normally excluded on the primary plan anyway. Deferring would delay
every image by the scale-pass duration.

## Verification

The live check runs separately and serially, on all four clips, as part of the e4c gate:

- every evidence canvas hashed and compared with baseline, expected pixel-identical;
- `evidence settled@` compared with the T0 baseline;
- `reusedImages` above 0 on the kept pass.
