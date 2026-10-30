## REMOVED Requirements

### Requirement: Swing-foot lateral excursion measures a complete swing's sideways ankle path relative to the knee
**Reason**: An unsigned P80−P20 range of ankle-minus-knee is never ~0, and from the front a
whip-free foot is hidden behind the thigh in early swing, so its ankle position is a detector guess
(`strides-uz48` probe, `docs/agent-notes/swing-foot-travel.md`).
**Migration**: Replaced by "Sideways foot travel is an early-swing outline check on front clips".
The `MetricId` is unchanged; values before this change are a different quantity.

### Requirement: Incomplete or unobservable swings do not produce a number
**Reason**: Its windows, coverage gates and rhythm guards belonged to the ankle-path range.
**Migration**: The outline check's own windows, usability gates and null cases are stated in
"Sideways foot travel is an early-swing outline check on front clips".

## ADDED Requirements

### Requirement: Sideways foot travel is an early-swing outline check on front clips

`swingFootLateralExcursion` (unit `percent`, a fraction of hip width) SHALL be computed only from a
clip whose most plausible view is front; a side or ambiguous view SHALL return `value: null` with
its view caveat and no plan. On a front clip the primary pass SHALL return `value: null`,
`confidence: 0`, a "checking" caveat and an `outlinePlan` naming, for every detected strike, an
early-swing window [strike + T/2, strike + 5T/4] and a stance window [strike, strike + T/4], where T
is one over the fitted hip-bounce frequency (gated by `cadenceMinFitR2`), and the frames needing a
person mask with the leg to read on each. The outline pass SHALL replace that result with one
computed per frame and leg from MediaPipe's person mask (confidence > 0.5) over a MoveNet-guided
crop, as follows. With s the leg's outward sign (its hip's side of hip-mid), L the thigh's image
length (knee.y − hip.y) and HW the frame's hip width: the thigh's outer edge SHALL be the median,
over rows [knee − 0.40L, knee − 0.10L], of the mask run at the hip→knee line (or the nearest run
within 0.3 HW) walked outward to its end, with at least half the rows yielding one; the residual
SHALL be s·(outermost − edge)/HW for the outermost swing-side pixel, past the hip midline, of the
8-connected mask component seeded by those thigh runs, in rows from knee + 0.3L down; protrusion
SHALL be max(0, residual), and 0 where no such pixel exists. A frame SHALL be dropped for that leg
when its mask is missing, MediaPipe's hips or knees sit more than 0.5 HW from MoveNet's, a hip or
the knee is missing or interpolated, HW is below half the clip's median, L ≤ 0, or the thigh band
fails. A window SHALL be usable when it ends inside the clip and has at least 6 good frames covering
at least 70% of its frames; its value SHALL be the P80 of its protrusions. The floor SHALL be the P80
of stance protrusion pooled over every strike, null below 6 frames. Each side's reading SHALL be the
median of its usable windows; the larger side SHALL be reported, as exactly 0 when it does not
exceed the floor, and null when no window is usable or the floor is null. The caveat SHALL always
state the swing counts and that a flick hidden behind the thigh cannot be seen.

#### Scenario: Every swing stays inside the leg's outline
- **WHEN** no lower-leg mask pixel passes the thigh's outer edge in any usable early swing
- **THEN** the value is 0 and the caveat says no sideways foot travel past the leg's outline, with "(n of n swings)"

#### Scenario: An injected connected flick reads its size
- **WHEN** a foot bar connected to the leg reaches 0.05, 0.10, 0.20 or 0.30 hip widths past the thigh edge
- **THEN** that frame's protrusion reads within 0.01 of the injected size

#### Scenario: Mirrored and rear-labelled footage agree
- **WHEN** the same mask and keypoints are mirrored horizontally, or the leg labels are swapped as in a rear view
- **THEN** the protrusion is the same

#### Scenario: MediaPipe and MoveNet disagree
- **WHEN** MediaPipe's hips or knees sit more than 0.5 hip widths from MoveNet's on a frame
- **THEN** that frame is not used for either leg

#### Scenario: The knee's own contour is not a protrusion
- **WHEN** the mask bulges past the thigh edge only between the knee and knee + 0.3 thigh length
- **THEN** the protrusion is 0

#### Scenario: A bystander beside the leg is ignored
- **WHEN** a mask region past the thigh edge is not connected to the leg's thigh runs
- **THEN** it does not count

#### Scenario: A side view abstains
- **WHEN** the clip's most plausible view is side or ambiguous
- **THEN** the value is null, nothing is planned and no outline pass runs
