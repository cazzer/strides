## REMOVED Requirements

### Requirement: Swing-foot lateral excursion appears with neutral interpretation and paired path evidence
**Reason**: The metric is now an outline check; its label, value wording, guidance and evidence all
change (`check-swing-foot-outline`).
**Migration**: See "Sideways foot travel appears as an outline check with no band" and "A background
outline pass grafts sideways foot travel only".

## ADDED Requirements

### Requirement: Sideways foot travel appears as an outline check with no band

Every view SHALL label `swingFootLateralExcursion` "Sideways foot travel" and SHALL format a value of
exactly 0 as "None past the leg's outline" and any other value as "<v×100 to one decimal>% of hip
width outward", identically in the guided views, the classic panel and the runner label. The
description SHALL say it checks early-swing sideways foot travel on front video, that a large
outward flick just after toe-off is what coaches call heel whip, that it is an outline check that
cannot see a flick hidden behind the thigh, and that it is not foot rotation or a diagnosis. The
metric SHALL have no band. Its evidence SHALL be one early-swing frame ghosted against a stance
frame of the same strike, with the thigh's outer edge, the leg's swing-side outline, the outermost
lower-leg point (when one exists) and the hip midline drawn from the measured mask geometry, and no
text on the image. While the outline pass is pending or running and the scale pass is not, the one
completion status line SHALL add " Checking sideways foot travel with a closer look at the clip…".

#### Scenario: Nothing left the outline
- **WHEN** the metric's value is 0
- **THEN** the card, the classic panel and the runner label read "None past the leg's outline"

#### Scenario: The status line while the outline pass runs
- **WHEN** a clip is ready, its scale pass is terminal and its outline pass is running
- **THEN** exactly one status line reads "Analysis complete." followed by the scale-pass sentence and "Checking sideways foot travel with a closer look at the clip…"

### Requirement: A background outline pass grafts sideways foot travel only

When a front clip's primary result carries an `outlinePlan`, the clip sampled on the sequential
path and the outline pass is enabled, the system SHALL run the outline pass once the clip's scale
pass is terminal and its lane allows, and SHALL replace only `swingFootLateralExcursion` in the
displayed result: every other metric, its value and its evidence SHALL keep their references. A
playback-path clip SHALL skip the pass with the caveat "This check needs a clip the browser can
decode frame by frame."; a pass that fails (segmenter unavailable, decode error, watchdog of
max(30 s, 0.2 s per planned frame)) or is disabled SHALL show "The closer look that checks sideways
foot travel couldn't run on this clip." with `value: null`. A reset, a new clip or a new run SHALL
stop the pass and discard its late result.

#### Scenario: The outline pass finishes
- **WHEN** the outline pass completes on a front clip
- **THEN** `swingFootLateralExcursion` carries its outline reading and every other metric is the same object as before

#### Scenario: A playback-path front clip
- **WHEN** a front clip sampled on the playback path reaches ready
- **THEN** no outline pass runs and the metric reads not available with the frame-by-frame caveat
