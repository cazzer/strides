## 1. Extractor

- [x] 1.1 Check the abort signal before every seek and after each seek completes, so an aborted image is never counted as a timeout
- [x] 1.2 `ClipEvidenceInput.reuse`: held metrics are passed through by reference, in plan order, never seeked; a load failure keeps them
- [x] 1.3 `ClipEvidenceInput.onMetricExtracted`: reports only complete metrics, never after an abort
- [x] 1.4 A clip with nothing left to decode joins no queue and opens no decoder
- [x] 1.5 `[perf-timings]` counts only decoded images, plus `reusedImages`

## 2. Hook

- [x] 2.1 Per-metric cache keyed by serialised plan entry plus source blob
- [x] 2.2 Harvest finished metrics from in-flight runs, guarded on the run still being current
- [x] 2.3 Cache only complete metrics, on both the settle path and the harvest path
- [x] 2.4 Show held images for metrics with nothing on screen while extracting, only for an unchanged clip set; an image on screen still wins until settle

## 3. Verification

- [x] 3.1 Unit tests: abort between seeks and during a seek, reuse merge equal to a full extraction, partial re-extraction by reference, superseded-pass harvest, late reports ignored, failed and partial metrics retried, held images shown early without replacing an image on screen
- [x] 3.2 `npm test`, `npx tsc -b`, eslint on the touched files
