## 1. Implementation

- [x] 1.1 `glProgramLinkWatch.ts`: a scoped WebGL link-failure counter, with unit tests
- [x] 1.2 Outline segmenter: watch build and first-pose inference; reject or go unavailable on any failure, with unit tests
- [x] 1.3 Reader and pass: an unavailable segmenter ends the pass failed with no reading; dev perf field `gpuLinkFailures`
- [x] 1.4 Driver: bound every phone-page `evaluate`/`close` so a wedged renderer cannot outlive the trial timeouts

## 2. Verification

- [x] 2.1 S21: outline pass ends `failed` (link failure caught on first pose), with no reading; time-to-"Analysis complete" not regressed
- [x] 2.2 Desktop 9-clip gate under the gate lock: every non-timing field identical to the integration branch
- [x] 2.3 Lint, build, unit tests
