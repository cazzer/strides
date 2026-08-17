# sampling-robustness-config Specification

## Purpose
Makes the sampling/robustness plane (keypoint-confidence filtering, interpolation gap
tolerance, detection error tolerance, per-frame detection timeout) a single, swappable
configuration object actually threaded through analysis, with a development-only override point
— so it can be iterated on and compared the same way the model and math planes already can.
## Requirements
### Requirement: Sampling/robustness plane is a single configuration object

The system SHALL provide a `SamplingRobustnessConfig` type bundling the interpolation layer's
existing `RobustnessConfig` (`minKeypointConfidence`, `maxGapSeconds`), `sampleClip`'s existing
`maxConsecutiveErrors` and `detectionTimeoutMs`, the WebCodecs sequential-decode sampling path's
own sampling-density setting (`sequentialSampling: { targetSamplesPerSecond: number | null }`), and
the retroactive person-selection stage's own configuration (`personSelection`), with a
`DEFAULT_SAMPLING_ROBUSTNESS_CONFIG` matching today's hardcoded defaults —
`targetSamplesPerSecond: null`, meaning every decoded frame, and `personSelection.enabled: false`,
meaning the selection stage is opt-in — without changing `RobustnessConfig`, `interpolate.ts`,
`confidenceFilter.ts`, `sampleClip.ts`, or `sequentialSamplingStep.ts`'s own signatures.

#### Scenario: Default config matches today's existing hardcoded defaults exactly

- **WHEN** `DEFAULT_SAMPLING_ROBUSTNESS_CONFIG` is inspected
- **THEN** its values equal `DEFAULT_ROBUSTNESS_CONFIG`'s `minKeypointConfidence`/`maxGapSeconds`,
  `sampleClip`'s existing `DEFAULT_MAX_CONSECUTIVE_ERRORS`/`DEFAULT_DETECTION_TIMEOUT_MS`
  constants, `sequentialSampling.targetSamplesPerSecond: null`, and the person-selection stage's
  own defaults

#### Scenario: A sequentialSampling override merges independently of the other fields

- **WHEN** a development-only override sets `sequentialSampling.targetSamplesPerSecond` to a
  specific number without touching `robustness`, `maxConsecutiveErrors`, or
  `detectionTimeoutMs`
- **THEN** the resolved config reflects the overridden sampling density while every other field
  keeps its default value, the same nested-partial merge behavior `robustness` already has

#### Scenario: A personSelection override merges independently of the other fields

- **WHEN** a development-only override sets one `personSelection` field without touching any other
  plane
- **THEN** the resolved config reflects that one overridden value while the rest of
  `personSelection`, and every other plane, keeps its default — the same one-level-deep
  nested-partial merge `robustness` and `sequentialSampling` already have

#### Scenario: The person-selection stage is off unless asked for

- **WHEN** an analysis run resolves its config with no override touching `personSelection`
- **THEN** the selection stage is disabled, and the run behaves exactly as it did before that
  stage existed

### Requirement: An analysis run resolves and uses one sampling/robustness config

The system SHALL resolve one `SamplingRobustnessConfig` per analysis run and pass it into
`applyRobustness` (as its `RobustnessConfig` argument), the adaptive sampler (as its
`maxConsecutiveErrors`/`detectionTimeoutMs` options and, when the WebCodecs sequential-decode path
is used, its `sequentialSampling` setting), and the retroactive person-selection stage (as its
`personSelection` setting), rather than leaving any of those to their own internal default.

#### Scenario: An analysis run without any override uses the default config

- **WHEN** an analysis run starts with no development-only override present
- **THEN** `applyRobustness`, the adaptive sampler, and the person-selection stage are all called
  with values equal to `DEFAULT_SAMPLING_ROBUSTNESS_CONFIG`, producing output identical to today's
  behavior

#### Scenario: An analysis run with an override uses the overridden values

- **WHEN** an analysis run starts with a development-only override present
- **THEN** `applyRobustness`, the adaptive sampler, and the person-selection stage are all called
  with the overridden values, not the defaults

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

