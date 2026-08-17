## REMOVED Requirements

### Requirement: Sampling/robustness plane is a single configuration object
**Reason**: The default it pins down reversed rather than merely changed —
`DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG` ships `enabled: true`
(`src/results/retroactivePersonSelection.ts`, asserted by `samplingRobustnessConfig.test.ts`), so
"`personSelection.enabled: false`, meaning the selection stage is opt-in" and its
"The person-selection stage is off unless asked for" scenario both state the opposite of shipped
behavior. A scenario whose title asserts a reversed default cannot be corrected in place: a
MODIFIED block may not drop or rename an existing scenario, so replacing the requirement under a
name that says what the default now is, is the honest form of this correction.
**Migration**: See the new "Sampling/robustness plane is a single configuration object with person
selection on by default" requirement below. It carries the same bundling contract, the same three
merge/default scenarios verbatim, and replaces only the off-by-default scenario with the
enabled-by-default one.

## ADDED Requirements

### Requirement: Sampling/robustness plane is a single configuration object with person selection on by default

The system SHALL provide a `SamplingRobustnessConfig` type bundling the interpolation layer's
existing `RobustnessConfig` (`minKeypointConfidence`, `maxGapSeconds`), `sampleClip`'s existing
`maxConsecutiveErrors` and `detectionTimeoutMs`, the WebCodecs sequential-decode sampling path's
own sampling-density setting (`sequentialSampling: { targetSamplesPerSecond: number | null }`), and
the retroactive person-selection stage's own configuration (`personSelection`), with a
`DEFAULT_SAMPLING_ROBUSTNESS_CONFIG` matching today's hardcoded defaults —
`targetSamplesPerSecond: null`, meaning every decoded frame, and `personSelection.enabled: true`,
meaning the selection stage runs on every analysis run unless a development-only override turns it
off — without changing `RobustnessConfig`, `interpolate.ts`, `confidenceFilter.ts`,
`sampleClip.ts`, or `sequentialSamplingStep.ts`'s own signatures.

`personSelection.enabled: true` is the default by explicit user decision (2026-08-16), overriding
the pre-registered ship rule for that stage, which fired. What is knowingly accepted as the cost is
tracked as issue #52's items 1-3: splice-tolerant segmentation (on the side-view track demo the
stage cuts the runner's own continuous track and strands its prefix), boxless survival inside the
winner's span, and primary/scale-pass selection divergence.

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

#### Scenario: The person-selection stage runs unless it is turned off

- **WHEN** an analysis run resolves its config with no override touching `personSelection`
- **THEN** the selection stage is enabled, and restoring the run's pre-stage behavior requires an
  explicit `{ personSelection: { enabled: false } }` override
