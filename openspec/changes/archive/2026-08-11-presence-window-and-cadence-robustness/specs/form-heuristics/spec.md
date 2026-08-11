## MODIFIED Requirements

### Requirement: Cadence is computed from shared footstrike detection

The system SHALL compute cadence as `60 / median(consecutive inter-footstrike-interval
seconds)`, where the intervals are the timestamp differences between consecutive entries of
`detectFootstrikes(frames, config)` (footstrikes across both legs, combined, timestamp-ordered),
without reimplementing footstrike detection. This SHALL NOT divide by total elapsed clip
duration — a rate computed that way is diluted by any dead time in the clip (before the first
footstrike, after the last, or a mid-clip tracking dropout), systematically underestimating
cadence whenever such dead time exists, which the median-interval computation is immune to by
construction (dead time simply doesn't produce an inter-footstrike interval to include).

#### Scenario: A clean side-view clip yields a resolvable cadence

- **WHEN** cadence is computed against a `'side'`-classified clip with detectable footstrikes
- **THEN** a non-null `value` in steps/minute is returned, `sampleSize` reflects the detected
  footstrike count, and `value` is within a plausible range of the clip's true underlying cadence

#### Scenario: Too few footstrikes to detect any cadence

- **WHEN** cadence is computed against frames with fewer than 2 detected footstrikes (zero, from
  no detectable footstrikes at all, or exactly one, which produces no interval)
- **THEN** `value` is `null`, `confidence` is `0`, `sampleSize` is `0`, and `caveat` is non-null

#### Scenario: No resolvable body-scale reference at all

- **WHEN** cadence is computed against frames with no resolvable shoulder/hip position anywhere in
  the clip
- **THEN** `value` is `null`, `confidence` is `0`, and a non-null `caveat` names the missing
  body-scale reference — distinct from the "too few footstrikes" caveat, matching the same
  distinction `computeOverstriding` already makes for the same underlying reason

#### Scenario: Dead time before the first or after the last footstrike does not dilute cadence

- **WHEN** cadence is computed against a clip where the subject enters the frame partway through
  and/or exits before the clip ends, with footstrikes detected only during the presence window
- **THEN** `value` reflects the median interval between the detected footstrikes themselves, not
  a rate diluted by dividing over the full (wider) clip duration

#### Scenario: A mid-clip tracking dropout does not dilute cadence

- **WHEN** cadence is computed against a clip with a temporary mid-clip tracking gap (e.g. brief
  occlusion) that causes one inter-footstrike interval to be markedly longer than the others
- **THEN** `value` reflects the median of all detected intervals, which is not pulled toward that
  one anomalous interval the way a mean (or a single total-count-over-duration rate) would be

#### Scenario: Zero-duration input never throws or produces NaN/Infinity

- **WHEN** cadence is computed against frames that would produce a zero or otherwise degenerate
  interval (e.g. multiple detected footstrikes sharing one timestamp)
- **THEN** `value` is `null` (not `NaN` or `Infinity`), `confidence` is `0`, and no exception is
  thrown

## ADDED Requirements

### Requirement: Metrics are computed over a presence-trimmed window, not the raw clip

The system SHALL compute `FormHeuristicsResult` from a frame sequence trimmed to the span
between the first and last frame where the subject is trackable at all (shoulder-mid and
hip-mid both resolvable), rather than the full, untrimmed clip — so that `frameCoverage` and
`bodyScale`'s `sampleCoverage` (both computed as `resolvedFrameCount / consideredFrameCount`)
reflect how well the subject was tracked *while actually in frame*, not diluted by stretches
where there was nothing to track at all (e.g. the subject hasn't entered frame yet, or has
already left it). A frame only starts or ends the presence window once a short run of
consecutive trackable frames confirms it, so a single spurious detection cannot anchor the
window on its own. This trim applies only to the frames handed to `computeFormHeuristics` — the
canonical `RobustPoseFrame[]` used for the skeleton overlay, and the development-only analysis
diagnostics, both continue to reflect the full, untrimmed clip.

#### Scenario: A clip with the subject absent at the start and end trims to the presence window

- **WHEN** a clip's first and last several frames have no resolvable shoulder/hip position, but a
  contiguous middle span does
- **THEN** `computeFormHeuristics` computes every metric's `frameCoverage`/confidence as if the
  input were just that middle span, not the full clip

#### Scenario: A single spurious detection does not anchor the presence window

- **WHEN** a single frame near the start or end of an otherwise-absent stretch has a resolvable
  shoulder/hip position, isolated (not part of a short consecutive run)
- **THEN** that frame does not by itself extend the presence window to include it

#### Scenario: A clip with the subject present throughout is unaffected

- **WHEN** every frame (or all but a short consecutive run at either edge) has a resolvable
  shoulder/hip position
- **THEN** the presence window spans the full clip and every metric's `frameCoverage`/confidence
  is unchanged from computing against the untrimmed frames

#### Scenario: The skeleton overlay and diagnostics are not trimmed

- **WHEN** analysis completes for a clip whose presence window is narrower than the full clip
- **THEN** `VideoAnalysisState.robustFrames` (used by the skeleton overlay) and `diagnostics`
  (the development-only analysis diagnostics) both still reflect every sampled frame, not just
  the presence window used internally by `computeFormHeuristics`

#### Scenario: No trackable frames anywhere leaves metrics computation unaffected

- **WHEN** no frame in the clip has a resolvable shoulder/hip position at all
- **THEN** the presence window is empty and every metric falls back to its existing
  no-resolvable-body-scale-reference null result, exactly as it would for an all-unresolvable
  clip today
