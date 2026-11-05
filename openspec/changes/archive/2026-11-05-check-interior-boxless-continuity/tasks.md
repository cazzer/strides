# Tasks

## 1. Geometry

- [x] 1.1 Export `isPositionContinuous(candidate, reference, elapsedSeconds, maxCenterSpeedSidesPerSecond)`
  from `src/pose/backends/movenetCrop.ts` and make `isBoundingBoxContinuous` call it, bit-identical.
- [x] 1.2 Tests in `movenetCrop.test.ts`, including "point hull inside a box has IoU 0".

## 2. The rule

- [x] 2.1 Add `rejectedDiscontinuousBoxless` to `PersonSelectionDiagnostics`; `skipped()` emits 0;
  `detectedSamplesOut` subtracts it.
- [x] 2.2 After the winner is picked, build `prevSurviving[]` / `nextSurviving[]` in two linear passes.
- [x] 2.3 In the final map, keep an interior frame when it has a box, when its 1-count hull is null,
  or when the hull touches or is position-continuous with either neighbour; otherwise null and count.
- [x] 2.4 Update the now-false comments (config UPDATE paragraph, method step 6, D3 note) and state the
  gap invariant.

## 3. Tests and literals

- [x] 3.1 `boxless()` takes optional `(x, y)` defaulting inside the standard track box.
- [x] 3.2 Cases: far intruder nulled and counted with segments unchanged; overlapping runner hull kept;
  zero-confident frame kept; point hull on a neighbour's corner kept; point hull continuous with only
  the previous / only the next neighbour kept; disjoint hull kept inside the speed budget and nulled
  just outside; 1-keypoint and all-NaN intruders nulled; intruder across a time-gap cut lands in the existing buckets; gap invariant
  pinned across a bridge; counts identity with all four buckets non-zero.
- [x] 3.3 Add the field to the diagnostics literals in `analysisDiagnostics.test.ts`,
  `runClipAnalysisPipeline.test.ts` and `scalePassSubjectAgreement.test.ts`.

## 4. Docs

- [x] 4.1 `docs/agent-notes/harness.md`: the field in the key list, "minus all FOUR", one paragraph.
- [x] 4.2 MODIFIED "Every sample belongs to exactly one segment" so its boxless scenario defers to the
  new requirement.

## 5. Verification

- [x] 5.1 Offline replay of the six private probe lines (design.md table).
- [x] 5.2 `npm test`, `npm run lint`, `npm run build`.
- [x] 5.3 Live A/B on the demo clips and `multiperson` with real GPU: `rejectedDiscontinuousBoxless`
  per clip, segments/bridgedCuts/separationRatio unchanged, metrics compared. Done 2026-11-05 on
  8b1cf0db against the 01c4ef04 baseline, all 9 clips (public four + IMG_9345–9349), fresh process,
  `--evidence --scale-pass --outline-pass`, under the shared gate lock: counter 0 and every field
  identical on the public four and IMG_9345/9347/9349; IMG_9346 counter 2 (cadence null → 176.4);
  IMG_9348 counter 0 with no metric or selection field moved (only the known outline-pass settle
  flake, strides-p1qt.4, differed). See docs/agent-notes/area-floor.md.
