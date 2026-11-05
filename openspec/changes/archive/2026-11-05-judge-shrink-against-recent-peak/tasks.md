## 1. Shared geometry
- [x] 1.1 `recentPeakAreaPx`, `isAboveRecentPeakFloor`, `isTruncatedByFrameEdge` in `movenetCrop.ts`; optional peak + frame on `isBoundingBoxContinuous`

## 2. Callers
- [x] 2.1 Retroactive segmentation: per-segment accepted chain, `personSelection.shrinkReferenceWindowSeconds: 0.5`
- [x] 2.2 Online gate: per-identity anchor area history, `continuityGate.shrinkReferenceWindowSeconds: 0.5`
- [x] 2.3 A/B driver keys

## 3. Verification
- [x] 3.1 Unit tests (helpers, segmentation cut/edge/growth, online walk-down refusal)
- [x] 3.2 Offline replica of segmentation on the p1qt.15 traces (edge exemption) + driver screens (both / retroactive-only)
- [x] 3.3 9-clip gate under the gate lock vs 78a6ccb9; IMG_9117
