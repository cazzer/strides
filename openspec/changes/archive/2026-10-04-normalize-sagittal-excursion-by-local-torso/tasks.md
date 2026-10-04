## 1. Pre-registration

- [x] 1.1 Write the ship rule into design.md before taking the after-measurement
- [x] 1.2 Capture the public-clip baseline at `83cccf7` (`scripts/ab-person-selection.mjs --trials 2`)

## 2. Local torso length

- [x] 2.1 Extract `torsoLengthAt(frame)` in `bodyScale.ts`; `estimateBodyScale` calls it, output unchanged
- [x] 2.2 Add `estimateLocalTorsoLengths(frames, halfWindowSeconds)` — time-windowed median, two-pointer scan, null on an empty window, throws on out-of-order frames
- [x] 2.3 Unit tests: bit-exact on constant input, centred/truncated median on a ramp, time- not index-based window, null on a torso-less window, ordering and argument guards

## 3. SER normalization

- [x] 3.1 `computeSagittalRange` rescales each detected sample by `torsoRef / localTorso`; a sample with no local torso is skipped before counting
- [x] 3.2 `LOCAL_TORSO_HALF_WINDOW_SECONDS = 0.5` module constant, with its reasoning
- [x] 3.3 Docstrings: `computeSagittalRange`, `detectView`, `sagittalExcursionRatio` in `types.ts`
- [x] 3.4 Unit tests: approach vs constant-scale control (front), side twin stays side, bit-identical on constant scale, torso-less window drops samples from the count

## 4. Verification

- [x] 4.1 `npm test`, `npx tsc -b`, eslint on touched files
- [x] 4.2 After-measurement on the same clips and trials; adjudicate the pre-registered rule
- [x] 4.3 Scale-pass view on `front-approach`, before/after (not covered by the harness)
- [x] 4.4 CLAUDE.md: correct the stale `.interpolated` claim; record the measured SER per clip
- [x] 4.5 `openspec validate normalize-sagittal-excursion-by-local-torso --strict`
