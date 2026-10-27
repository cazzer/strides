## MODIFIED Requirements

### Requirement: The focus area is accented and annotated with its metric's own value

Edges shaped by a measured focus parameter SHALL be accented, by a wider stroke as well as a hue,
with the other measured parts receding; measured parts SHALL never be dimmed so far that they read
as neutral, and neutral dashes SHALL never be dimmed. In forced-colours mode measured, neutral and
focus parts SHALL use distinct system colours. Each measured focus parameter SHALL carry an
annotation of its natural kind (an angle arc for trunk lean, knee drive and knee flexion; a
vertical bracket for bounce and arm swing; a horizontal offset for overstride, foot strike, step
width and swing-foot excursion; a footfall beat for cadence), whose geometry is the drawn value
exactly and whose label is the metric's own reported value in the guided card's format, except
that the foot-strike label names its class as the part of the foot that lands first, as an
estimate ("Heel first (estimate)", "Midfoot first (estimate)", "Forefoot first (estimate)"),
classed exactly as the card classes it. A clamped value's label SHALL say it is shown
approximately. A limb annotation SHALL be built on the pose its metric reads (its key phase) and
SHALL lie on the live figure's limb whenever the figure is at that phase; no second, limb-shaped
figure SHALL be drawn. While the figure is still, a limb mark whose key phase is not the held phase
SHALL NOT be drawn (its value stays in the text alternative); while the figure plays, every mark
SHALL be drawn. A focus metric that drives no parameter SHALL be ignored, and two focus metrics
driving one parameter SHALL give one annotation.

The contact marks SHALL meet the points their metrics read, which are ankles, not heels: the
overstride offset's guides SHALL be plumb lines from hip-mid and from the contact ankle down to the
offset, and the foot-strike offset SHALL run at ankle height from under the knee (a plumb from the
knee) to the contact ankle. When it is the ground lane's only label, the foot-strike label SHALL hang
under the contact keypoint: the heel when the foot lands heel-down, the toe on a forefoot strike. Labels hanging below the ground (the
ground lane) SHALL NOT overlap: two or more SHALL share the lane's lowest anchor height and stack in
focus order as one block, centred on the first label's anchor, with half a line of extra space
between consecutive labels so a stacked label never reads as the previous one's continuation.

The step-width offset SHALL run below the ground from the midline to the contact ankle's lateral
position, and its guides SHALL meet both feet: a midline plumb from hip-mid down past the offset,
and a tick rising to the ground under each foot's planted position, so that in the front view each
foot, while planted, stands exactly above its tick.

#### Scenario: Trunk lean is annotated
- **WHEN** trunk lean is measured at 5° and in focus
- **THEN** the torso is accented and an arc sweeping 5° is labelled "5.0°"

#### Scenario: A clamped foot strike says so
- **WHEN** overstriding is measured at 0.05 and foot strike at 0.10, with foot strike in focus
- **THEN** the foot-strike label reads its class and "shown approximately", and the text alternative says it is drawn at a limit of the figure, not at the measured value

#### Scenario: A second keyed focus does not float
- **WHEN** knee drive and knee flexion are both in focus and the runner is still
- **THEN** only the knee-drive arc is drawn, and the knee-flexion arc appears once the runner plays

#### Scenario: The annotated limb is the live limb
- **WHEN** knee drive is in focus and the runner is still
- **THEN** the arc's centre is the live near hip and its end lies on the live near thigh

#### Scenario: An unmeasured focus is not annotated
- **WHEN** a focus parameter is neutral
- **THEN** it carries no annotation and no accent

#### Scenario: The overstride guides meet hip-mid and the contact ankle
- **WHEN** overstriding is in focus and the runner holds the contact
- **THEN** one guide starts at the live hip-mid and the other at the live contact ankle, both dropping to the offset

#### Scenario: The foot-strike label hangs at the heel
- **WHEN** foot strike is the only ground-lane label in focus, with a heel-down landing, and the runner holds the contact
- **THEN** the foot-strike offset ends at the live contact ankle, and its label hangs under the live heel; on a forefoot strike it hangs under the live toe

#### Scenario: Overstride and foot-strike labels stack
- **WHEN** overstriding and foot strike are both in focus
- **THEN** both labels share one centre and lane height, the second's first line one and a half line pitches below the first's last line

#### Scenario: The step-width guides meet both feet
- **WHEN** step width is in focus on the `feetFront` camera, at any step width and swing-foot arc
- **THEN** the offset is exactly |step width| × hip width long, the midline guide starts at the live hip-mid, and every planted ankle of either foot stands exactly above a tick whose top is on the ground

#### Scenario: The foot-strike label names the first contact
- **WHEN** foot strike is measured at 0.2 (heel), 0.02 (midfoot) or −0.2 (forefoot) and in focus
- **THEN** its label reads "Heel first (estimate)", "Midfoot first (estimate)" or "Forefoot first (estimate)", and the text alternative states the same words

## ADDED Requirements

### Requirement: Cadence is drawn as a footfall beat at the drawn cadence

A measured cadence in focus SHALL be labelled with its reported steps per minute just above the
head, with a short tick under each foot's contact point on the ground. Cadence is keyed on a
footfall: when it is the first keyed focus, the still frame SHALL hold the near foot's contact, so
that foot stands planted on its tick. While the figure plays, reduced motion is not preferred and
the camera plays the whole cycle (not the landing window, whose contact hold would freeze a ring),
a ring SHALL flash at each foot's contact point at that foot's contact phase: largest and opaque
at contact, shrinking as it fades, gone within a quarter of a cycle, with that foot's tick flashing
in the accent at the same strength, so the rings beat once per drawn footfall, at the drawn cadence
times the playback rate per minute. The label SHALL always state the measured cadence, never the
playback-scaled one. Paused, or whenever reduced motion is preferred (even after the reader presses
play), no ring SHALL be drawn; the label and ticks remain. The ring SHALL be written by the animation loop without a React
commit per frame, SHALL use the focus accent (never a saturated red; the system highlight colour in
forced-colours mode), and SHALL stay far below the WCAG 2.3.1 general-flash area threshold at every
runner size. The cadence ticks stay on the ground, and its label follows the figure's height, while
an intro tween changes the figure's standing height.

#### Scenario: The beat follows the footfalls
- **WHEN** cadence is measured at 180 steps/min and in focus, playing at 1× for 10 seconds
- **THEN** the rings start 30 ± 1 times, each one at a foot's contact point as that foot lands

#### Scenario: Slow motion slows the beat, not the number
- **WHEN** the same runner plays at 0.4× for 10 seconds
- **THEN** the rings start 12 ± 1 times, and the label still reads "180 steps/min"

#### Scenario: Reduced motion beat
- **WHEN** cadence is in focus with reduced motion preferred
- **THEN** the near foot stands planted on the ticks, the label and both ticks are drawn, no ring is drawn even after the reader presses play, and no animation frame is pending while still

#### Scenario: Paused beat
- **WHEN** the reader pauses a runner with cadence in focus
- **THEN** the rings disappear and the label and ticks stay; pressing play brings the rings back

#### Scenario: No beat on the landing camera
- **WHEN** cadence is in focus and the camera is `landingSide`, playing
- **THEN** the label and ticks are drawn and no ring is drawn
