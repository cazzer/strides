## 1. Identity challenge

- [x] 1.1 `IdentityChallengeConfig` + defaults in `personOfInterestConfig.ts`; merged one level deeper by `resolvePoseDetectorConfig`; keys registered in `scripts/ab-person-selection.mjs`
- [x] 1.2 Dedicated multi-pose instance (tracking + smoothing off), created in parallel, disposed with the others, failure degrades to "no challenge"
- [x] 1.3 Pure `decideIdentityChallenge` (tentative / settled regimes, scale against the tracked anchor box) sharing `findContinuousMatch` with reacquisition
- [x] 1.4 Dispatch at lowest priority, outside settle-in, fall-through on no switch; identity bookkeeping (`beginNewIdentity`) at every identity change

## 2. Seeded hand-off

- [x] 2.1 `movenetCropRegionSeed.ts`: port of `determineNextCropRegion`; seed only a detector carrying `cropRegion`
- [x] 2.2 Retry the crop -> full-frame hand-off once, seeded from the anchor, when the plain result does not confirm the anchor

## 3. Verification

- [x] 3.1 Unit tests: decision regimes, dispatch timing/fall-through/switch, seeded hand-off (retry, kept, off), config merge, creation/dispose counts
- [x] 3.2 Per-frame probe on 9 second-runner + public clips + IMG_9117 (reverted)
- [x] 3.3 9-clip gate A/B (`--evidence --scale-pass --outline-pass --perf`) vs the integration branch at 43c81dd7 under the gate lock; IMG_9117 re-check
- [x] 3.4 Record results in design.md, `docs/agent-notes/backlog.md`, beads
