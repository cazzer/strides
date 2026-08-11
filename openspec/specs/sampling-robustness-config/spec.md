# sampling-robustness-config Specification

## Purpose
Makes the sampling/robustness plane (keypoint-confidence filtering, interpolation gap
tolerance, detection error tolerance, per-frame detection timeout) a single, swappable
configuration object actually threaded through analysis, with a development-only override point
— so it can be iterated on and compared the same way the model and math planes already can.
## Requirements
### Requirement: Sampling/robustness plane is a single configuration object

The system SHALL provide a `SamplingRobustnessConfig` type bundling the interpolation layer's
existing `RobustnessConfig` (`minKeypointConfidence`, `maxGapSeconds`) together with
`sampleClip`'s existing `maxConsecutiveErrors` and `detectionTimeoutMs`, with a
`DEFAULT_SAMPLING_ROBUSTNESS_CONFIG` matching today's hardcoded defaults, without changing
`RobustnessConfig`, `interpolate.ts`, `confidenceFilter.ts`, or `sampleClip.ts`'s own
signatures.

#### Scenario: Default config matches today's existing hardcoded defaults exactly

- **WHEN** `DEFAULT_SAMPLING_ROBUSTNESS_CONFIG` is inspected
- **THEN** its values equal `DEFAULT_ROBUSTNESS_CONFIG`'s `minKeypointConfidence`/`maxGapSeconds`
  and `sampleClip`'s existing `DEFAULT_MAX_CONSECUTIVE_ERRORS`/`DEFAULT_DETECTION_TIMEOUT_MS`
  constants

### Requirement: An analysis run resolves and uses one sampling/robustness config

The system SHALL resolve one `SamplingRobustnessConfig` per analysis run and pass it into both
`applyRobustness` (as its `RobustnessConfig` argument) and `sampleClip` (as its
`maxConsecutiveErrors`/`detectionTimeoutMs` options), rather than leaving either call to its own
internal default.

#### Scenario: An analysis run without any override uses the default config

- **WHEN** an analysis run starts with no development-only override present
- **THEN** `applyRobustness` and `sampleClip` are both called with values equal to
  `DEFAULT_SAMPLING_ROBUSTNESS_CONFIG`, producing output identical to today's behavior

#### Scenario: An analysis run with an override uses the overridden values

- **WHEN** an analysis run starts with a development-only override present
- **THEN** `applyRobustness` and `sampleClip` are both called with the overridden values, not
  the defaults

### Requirement: Config override is development-only and requires no UI

The system SHALL allow overriding the active `SamplingRobustnessConfig` via a `window`-scoped
global, read once per analysis run, only in development builds (`import.meta.env.DEV`) — never
in a production build, and without any user-facing control (no button, no settings panel). This
is a tooling seam for driving the app via browser automation across configuration variants, the
same category of dev-only affordance as `analysisDiagnostics`'s console auto-log.

#### Scenario: A development-build override set before analysis starts is honored

- **WHEN** the override global is set (e.g. by a Playwright script, or manually in devtools)
  before an analysis run starts, in a development build
- **THEN** that run uses the overridden config

#### Scenario: The override has no effect in a production build

- **WHEN** the override global is set in a production build
- **THEN** it is not read, and the run uses `DEFAULT_SAMPLING_ROBUSTNESS_CONFIG`

#### Scenario: No override present is not an error

- **WHEN** no override global is present at all, in either a development or production build
- **THEN** the run proceeds normally using `DEFAULT_SAMPLING_ROBUSTNESS_CONFIG`, without warning
  or throwing

