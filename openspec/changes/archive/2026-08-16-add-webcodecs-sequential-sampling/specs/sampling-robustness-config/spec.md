## MODIFIED Requirements

### Requirement: Sampling/robustness plane is a single configuration object

The system SHALL provide a `SamplingRobustnessConfig` type bundling the interpolation layer's
existing `RobustnessConfig` (`minKeypointConfidence`, `maxGapSeconds`), `sampleClip`'s existing
`maxConsecutiveErrors` and `detectionTimeoutMs`, and the WebCodecs sequential-decode sampling
path's own sampling-density setting (`sequentialSampling: { targetSamplesPerSecond: number |
null }`), with a `DEFAULT_SAMPLING_ROBUSTNESS_CONFIG` matching today's hardcoded defaults —
`targetSamplesPerSecond: null`, meaning every decoded frame — without changing `RobustnessConfig`,
`interpolate.ts`, `confidenceFilter.ts`, `sampleClip.ts`, or `sequentialSamplingStep.ts`'s own
signatures.

#### Scenario: Default config matches today's existing hardcoded defaults exactly

- **WHEN** `DEFAULT_SAMPLING_ROBUSTNESS_CONFIG` is inspected
- **THEN** its values equal `DEFAULT_ROBUSTNESS_CONFIG`'s `minKeypointConfidence`/`maxGapSeconds`,
  `sampleClip`'s existing `DEFAULT_MAX_CONSECUTIVE_ERRORS`/`DEFAULT_DETECTION_TIMEOUT_MS`
  constants, and `sequentialSampling.targetSamplesPerSecond: null`

#### Scenario: A sequentialSampling override merges independently of the other fields

- **WHEN** a development-only override sets `sequentialSampling.targetSamplesPerSecond` to a
  specific number without touching `robustness`, `maxConsecutiveErrors`, or
  `detectionTimeoutMs`
- **THEN** the resolved config reflects the overridden sampling density while every other field
  keeps its default value, the same nested-partial merge behavior `robustness` already has

### Requirement: An analysis run resolves and uses one sampling/robustness config

The system SHALL resolve one `SamplingRobustnessConfig` per analysis run and pass it into
`applyRobustness` (as its `RobustnessConfig` argument), the adaptive sampler (as its
`maxConsecutiveErrors`/`detectionTimeoutMs` options and, when the WebCodecs sequential-decode path
is used, its `sequentialSampling` setting), rather than leaving any of those to their own internal
default.

#### Scenario: An analysis run without any override uses the default config

- **WHEN** an analysis run starts with no development-only override present
- **THEN** `applyRobustness` and the adaptive sampler are both called with values equal to
  `DEFAULT_SAMPLING_ROBUSTNESS_CONFIG`, producing output identical to today's behavior

#### Scenario: An analysis run with an override uses the overridden values

- **WHEN** an analysis run starts with a development-only override present
- **THEN** `applyRobustness` and the adaptive sampler are both called with the overridden values,
  not the defaults
