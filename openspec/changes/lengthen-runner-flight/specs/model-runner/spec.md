## ADDED Requirements

### Requirement: The runner's bounce plays smoothly at thirty frames a second

Drawn at 30 frames a second at a cadence of 150, 174 or 190 steps a minute, from any start phase,
the hips' largest change in height between two consecutive frames SHALL be at most 1.3 times that
of a sinusoidal bounce of the same peak-to-peak size, for every pelvis bounce up to 0.22 torso
lengths; at most 1.6 times for a bounce of 0.25 or 0.3; and at most 1.9 times for a bounce of 0.4
or 0.5. Over twelve consecutive steps, the spread of each step's highest drawn hip height SHALL be
at most 0.12 of the bounce for every bounce up to 0.3, and at most 0.13 of it for a bounce of 0.4
or 0.5. A small bounce SHALL be a sinusoid: the hips SHALL be lowest at mid-stance, halfway through
stance, and highest a quarter cycle later, midway between toe-off and the other foot's contact.

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
