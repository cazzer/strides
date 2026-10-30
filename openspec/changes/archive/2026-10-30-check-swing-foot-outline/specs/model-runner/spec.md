## MODIFIED Requirements

### Requirement: A bound parameter changes only its own part of the runner, in the direction of its value

Applying a bound metric's own formula to the model's joints SHALL return the parameter's value
for every parameter in a conflict-free set (the swing-foot arc, read as its peak outward travel past the knee line, to within its sampling,
the peak metrics to within their extrema finder's sampling). Raising a parameter SHALL raise
that measured quantity. Changing a parameter SHALL leave every joint outside that parameter's
documented set of joints unchanged, apart from one whole-figure vertical shift per phase that keeps
the runner standing on the ground: those joints' forward and lateral coordinates SHALL stay
bit-identical, and their heights SHALL differ only by that one shared shift. No metric reads
absolute height, so the shift moves no binding. Cadence, torso pitch, arm swing and swing-foot arc
do not change the figure's height, so every joint outside their sets SHALL stay bit-identical.
Pelvis bounce SHALL move the legs as well as the shared shift, because the stance leg's solve
depends on the hips' height through stance. Cadence SHALL change only the cycle rate.

#### Scenario: More lean pitches the torso further and leaves the legs alone
- **WHEN** torso pitch is raised from 0° to 20° with all else neutral
- **THEN** the measured trunk lean rises from 0° to 20° and every hip, knee, ankle, heel and toe is unchanged

#### Scenario: Measuring the model returns the bound value
- **WHEN** step width is bound to 0.05 hip widths
- **THEN** the contact ankle's outward offset from the hip midline, over the model's hip width, is 0.05

#### Scenario: Contact conflict keeps the stronger parameter exact
- **WHEN** both contact offsets are measured and the shank offset is too large for the landing offset without hyperextending the knee
- **THEN** the landing offset is still exact, the knee is held straight, and the foot-strike offset is what gives way, drawn at the value its bound parameter carries

#### Scenario: A swing-foot arc of zero draws no arc
- **WHEN** the swing-foot arc is bound to 0 hip widths
- **THEN** the swing ankle never leaves its knee's own line, and the measured peak outward travel is 0
