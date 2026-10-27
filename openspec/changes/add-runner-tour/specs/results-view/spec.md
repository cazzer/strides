## MODIFIED Requirements

### Requirement: The results surface explains illustrative and detected running motion

In the classic results view, the system SHALL display a two-dimensional illustrative runner during sampling and processing, label it as an illustration, and show an actual detected pose only after analysis is ready. The first transition to detected pose SHALL respect reduced-motion preference. The illustration SHALL NOT be presented as universal ideal form or used to grade the runner. The runner tour and the results summary do not render this stage.

#### Scenario: Analysis is still running
- **WHEN** a clip is being sampled or processed and the classic view is shown
- **THEN** the stage shows the moving illustrative wireframe and does not claim to show progressively detected joints

#### Scenario: Analysis becomes ready
- **WHEN** all clips finish analysis, a robust pose exists for the selected metric, and the classic view is shown
- **THEN** the stage transitions once from the illustration to that measured pose

### Requirement: Each metric visual uses its own evidence source

In the classic results view, the system SHALL select the metric's winning clip and pose frames, display available ghosted evidence behind a detected trace, and keep the evidence canvas in its original card. Centimeter metrics SHALL use the corresponding scale-pass pose frames. Keyboard focus, result hashes, and scrolling SHALL update the selected metric.

On a small screen, the classic view SHALL keep a compact metric rail visible while scrolling and provide an accessible expanded view of the same metric visual. A change in the winning source clip SHALL never leave old clip imagery attributed to the new winner during evidence re-extraction.

#### Scenario: A metric comes from a second clip
- **WHEN** the reader focuses a metric whose winning source is clip two in the classic view
- **THEN** the stage uses clip two's pose and evidence and identifies clip two

#### Scenario: Evidence is pending, absent, or the metric is excluded
- **WHEN** no extracted image can yet or ever be shown
- **THEN** the stage states the condition and does not imply an extracted image exists
