## ADDED Requirements

### Requirement: Steady-state anchor acceptance judges shrinkage against the identity's recent peak

When the continuity gate is enabled and an anchor exists, the system SHALL also refuse a detection
whose box area, multiplied by `continuityGate.maxAreaRatio`, is smaller than the largest anchor box
the CURRENT identity produced within the preceding
`continuityGate.shrinkReferenceWindowSeconds`. This applies unless the detection's box is truncated
by the frame edge (it comes within 2% of the frame's shorter side of any edge). The history SHALL be
emptied whenever the anchor starts referring to a different person. A refusal is handled exactly
like any other continuity-gate refusal. `shrinkReferenceWindowSeconds: 0` disables the rule, and
0 is the default: the online rule is available through the backend override but ships off.

#### Scenario: The online rule ships off

- **WHEN** no override sets `continuityGate.shrinkReferenceWindowSeconds`
- **THEN** steady-state anchor acceptance is the frame-to-frame continuity test alone

#### Scenario: A subject walked down below a third of its recent size is refused

- **WHEN** `continuityGate.shrinkReferenceWindowSeconds` is positive and the anchored subject's detections shrink by steps each within `maxAreaRatio`, until a
  fully visible detection is more than `maxAreaRatio` smaller than the identity's largest anchor
  box in the window
- **THEN** that detection does not become the anchor and counts toward the reacquisition loss
  threshold
