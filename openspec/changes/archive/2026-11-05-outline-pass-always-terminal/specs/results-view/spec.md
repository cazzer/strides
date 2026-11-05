## MODIFIED Requirements

### Requirement: A background outline pass grafts sideways foot travel only

When a front clip's primary result carries an `outlinePlan`, the clip sampled on the sequential
path and the outline pass is enabled, the system SHALL run the outline pass once the clip's scale
pass is terminal and its lane allows, and SHALL replace only `swingFootLateralExcursion` in the
displayed result: every other metric, its value and its evidence SHALL keep their references. A
playback-path clip SHALL skip the pass with the caveat "This check needs a clip the browser can
decode frame by frame."; a pass that fails (segmenter unavailable, decode error, watchdog of
max(30 s, 0.2 s per planned frame), or any other error the pass raises, including one
raised before its watchdog is armed) or is disabled SHALL show "The closer look that checks sideways
foot travel couldn't run on this clip." with `value: null`. A reset, a new clip or a new run SHALL
stop the pass and discard its late result.

#### Scenario: The outline pass finishes
- **WHEN** the outline pass completes on a front clip
- **THEN** `swingFootLateralExcursion` carries its outline reading and every other metric is the same object as before

#### Scenario: A playback-path front clip
- **WHEN** a front clip sampled on the playback path reaches ready
- **THEN** no outline pass runs and the metric reads not available with the frame-by-frame caveat

#### Scenario: The pass throws before its watchdog is armed
- **WHEN** setting up the outline pass's reader or decoder throws
- **THEN** the pass ends 'failed', logs its outline-pass line, and the metric reads not available with the couldn't-run caveat
