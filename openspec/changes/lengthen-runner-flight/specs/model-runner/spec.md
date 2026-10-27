## ADDED Requirements

### Requirement: The runner's bounce plays smoothly at thirty frames a second

Drawn at 30 frames a second at a cadence of 150, 174 or 190 steps a minute, from any start phase,
the hips' largest change in height between two consecutive frames SHALL be at most 1.3 times that
of a sinusoidal bounce of the same peak-to-peak size, for every pelvis bounce up to 0.22 torso
lengths; at most 1.6 times for a bounce of 0.25 or 0.3; and at most 1.9 times for a bounce of 0.4
or 0.5. Over twelve consecutive steps, the spread of each step's highest drawn hip height SHALL be
at most 0.12 of the bounce for every bounce up to 0.3, and at most 0.13 of it for a bounce of 0.4
or 0.5. The hips SHALL be lowest at mid-stance, halfway through stance, and highest a quarter cycle
later, midway between toe-off and the other foot's contact; for a bounce small enough that the
planted leg absorbs it, they SHALL sit at contact and toe-off at the height a sinusoid of the same
size would. Between those keys the path is eased, close to a sinusoid but not one, and is held to
the per-frame bounds above.

#### Scenario: A typical bounce moves like a sinusoid
- **WHEN** the runner with a pelvis bounce of 0.14 torso lengths is drawn at 30 fps at 174 steps a minute
- **THEN** no frame-to-frame hip change exceeds 1.3 times a sinusoid's, and the step peaks spread by at most 0.12 of the bounce

#### Scenario: A large bounce spreads its flight over several frames
- **WHEN** the runner with a pelvis bounce of 0.3 torso lengths is drawn at 30 fps at 150, 174 or 190 steps a minute
- **THEN** no frame-to-frame hip change exceeds 1.6 times a sinusoid's, and the step peaks spread by at most 0.12 of the bounce

#### Scenario: The hips peak midway through flight
- **WHEN** the neutral runner is sampled over one step
- **THEN** its hips are highest midway between toe-off and the other foot's contact, a quarter cycle after mid-stance

### Requirement: Every limb key phase falls while the other foot is planted

Each swing-side key phase a limb annotation or still frame is held on (the thigh peak, the swing
knee's peak bend and the middle of the swing-foot arc) SHALL fall while the other leg is in stance,
and the swing-foot arc SHALL start no earlier than toe-off.

#### Scenario: The knee-drive still frame has a foot down
- **WHEN** the neutral runner is held at the thigh peak's key phase
- **THEN** the other leg is in stance and its foot stands on the ground

### Requirement: The swing thigh moves steadily from toe-off to its peak

From toe-off to the thigh peak, the swing thigh SHALL start and end at rest, so the peak stays the
thigh's maximum, and over the middle 80% of that span SHALL never move slower than a quarter of its
mean speed over the span. Drawn at 30 frames a second at 190 steps a minute, at the neutral
parameters, the thigh SHALL move at most 14.42 degrees between two frames (the largest step before
this change, 13.11, plus 10%).

#### Scenario: No stall in early swing
- **WHEN** the runner's thigh is sampled from toe-off to its peak at a thigh peak of 15°, the neutral value or 85°
- **THEN** between 10% and 90% of the span its speed never falls below a quarter of its mean

### Requirement: A still figure stands on the ground

While the figure is still (reduced motion before the reader plays it, or paused), the renderer SHALL
raise the whole drawn figure by however far its lowest foot point sits below the ground, so a held
frame past the pin's declared domain never shows a foot under the ground. Marks that hang off the
figure SHALL rise with it; marks on the ground (landing, step width, cadence ticks) SHALL stay on
it. The lift SHALL be dropped as soon as the figure plays (a snap is acceptable). No metric reads
absolute height, so every bound value still reads back exactly.

#### Scenario: The knees stop on a large overstride
- **WHEN** reduced motion holds the knee-flexion frame of a runner whose landing offset is 0.512
- **THEN** the drawn lowest foot point is on the ground line, and the knee-flexion mark rides the figure

#### Scenario: Pausing mid-stance
- **WHEN** the reader pauses a runner whose stance foot is below the ground at that phase
- **THEN** the whole figure rises rigidly until its lowest foot is on the ground, the cadence ticks stay put and the head label rises with the figure
