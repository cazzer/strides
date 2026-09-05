# results-view

## MODIFIED Requirements

### Requirement: An annotation depicts what was measured at the depicted instant, never the card's reported value

An annotation SHALL depict a quantity that is genuinely present in the frame or pair it is drawn on,
and SHALL be described as **what was measured at that instant**. The system SHALL NOT label a mark
with the metric's reported value unless the drawn quantity and the reported value are the same
quantity, arrived at the same way, over the same instants.

For most metrics they are not, and the gap is structural rather than incidental:

- The vertical-oscillation family (`verticalOscillation`, `verticalOscillationCm`, `verticalRatio`)
  reports an amplitude taken from a **whole-clip least-squares spectral sinusoid fit with a
  `c + d·t + e·t²` trend removed**. The pixel gap between the two ghosted midpoints in the image is a
  two-sample difference that still contains the whole-body translation the fit deliberately subtracts
  — it is not that fitted amplitude. The depicted cycle is chosen as the best-supported one, not the
  largest, so it is not even the clip's biggest bounce. `verticalOscillationCm` is further removed
  still: its fit runs over integrated metre deltas from one winning integration run, so no pixel
  distance in any image is its unit.
- `verticalRatio` reports a quotient formed across two **different** exemplars — a bounce cycle and a
  stride pair. Each image shows one factor of it; neither image shows the quotient.
- `overstriding` and `footStrikePattern` divide a drawable pixel offset by a **clip-median torso
  length**. The numerator is drawable; the denominator exists in no single frame.
- `stepWidth` divides its drawable offset by a **clip-median hip width**. The hip-to-hip segment is
  drawable in the frame, but the segment in the picture is that frame's hip width, not the clip median
  the value was divided by — a drawable-looking denominator that is still not the one used.
- `trunkLean` and `overstriding` deliberately select the **extreme** instants while their cards report
  a **median**, so the drawn geometry is by construction not the reported number. `kneeFlexion`'s
  reported value is likewise a median across swing-phase peaks, not the one peak depicted.
- `kneeFlexion` reports `180° − interiorAngle`, so an arc drawn on the interior angle at the knee is
  the **supplement** of the reported value.
- `trunkLean`'s reported value is multiplied by the direction of travel, so on a runner moving
  right-to-left the **sign** of the tilt visible on screen is the opposite of the sign the card
  reports. A mark that reads as "leaning this way" must not be equated with a signed number that means
  "leaning forward" in the runner's own frame of reference.

Where the drawn quantity differs from the reported value, the mark SHALL be captioned as the
per-instant measurement it is, and SHALL NOT be captioned with, annotated with, or visually equated to
the card's number. Where a metric's reported quantity has **no** honest single-still depiction, the
thumbnail SHALL carry the joint layer and whatever per-instant geometry is honestly drawable, and
SHALL carry no numeric label at all — never an invented, approximated, or back-computed one. An
instant carried purely for legibility, that no measurement was taken at, SHALL NOT be captioned as
measured.

`cadence` SHALL emit no evidence. It is a property of a sequence, and no still or pair of stills
depicts a rate. That decision SHALL be enforced independently both at the point the metric would emit
an exemplar and at the point evidence is planned, so that removing either enforcement alone cannot
cause a cadence thumbnail to appear.

This requirement is what keeps the reference-posture prohibition above meaningful. A picture that
silently restates a number it cannot show is already claiming more than it can support; a picture that
went on to show a target as well would be claiming to know what correct form is.

#### Scenario: A fitted amplitude is not labelled on the ghost that illustrates it

- **WHEN** a vertical-oscillation-family metric's evidence renders as a ghosted pair of bounce
  instants
- **THEN** the marks show the two midpoint positions and the gap between them at those instants, and
  neither the marks nor the caption labels that gap with the card's reported amplitude

#### Scenario: A ratio between two images is labelled on neither

- **WHEN** a metric's reported value is a ratio formed across its two exemplars
- **THEN** each image is captioned with what it shows on its own, and neither carries the ratio

#### Scenario: An angle arc is not labelled with a value it is the supplement of

- **WHEN** `kneeFlexion`'s evidence draws the interior angle at the knee
- **THEN** the arc is not labelled with the card's reported flexion value, because the reported value
  is that angle's supplement

#### Scenario: An extreme instant is not captioned as the reported median

- **WHEN** a metric that reports a median selects its most extreme instant as its exemplar
- **THEN** the annotation is captioned as the measurement at that instant, and never as the metric's
  reported value

#### Scenario: A screen-relative tilt is not equated with a travel-signed value

- **WHEN** `trunkLean`'s evidence renders for a runner travelling right-to-left, so the on-screen tilt
  and the reported value carry opposite signs
- **THEN** the drawn torso vector, vertical reference and arc are captioned as the tilt measured at
  that instant, and are not labelled with the card's signed value

#### Scenario: A ratio with an unshowable denominator carries no number

- **WHEN** a metric normalizes a drawable pixel offset by a clip-median body scale
- **THEN** the offset is drawn as the per-instant geometry it is, and no normalized figure is
  rendered on the image

#### Scenario: A legibility-only instant is not captioned as measured

- **WHEN** an exemplar carries a second instant purely so the first is readable, and no value was
  measured at that second instant
- **THEN** that instant's geometry is not captioned or labelled as a measurement

#### Scenario: Cadence renders no thumbnail, and two independent guards say so

- **WHEN** an analysis run completes with a measured cadence
- **THEN** the cadence card renders no thumbnail, and removing either the metric-side or the
  planning-side guard on its own still leaves the other one refusing it

### Requirement: Metrics panel readouts with measurability and confidence tiers

The system SHALL display, for each of the twelve `MetricId`s in `FormHeuristicsResult`, its value in
plain language and a label naming the metric, partitioned into three tiers that determine how —
and whether — a value renders at all, rather than a single uniform card style for every metric.
Exclusion is reserved for metrics that are **structurally unmeasurable** — nothing was measured
(`value === null`) or the camera geometry cannot support the measurement (`viewFit ===
'unsuitable'`) — never for low confidence alone:

- **Tier 1 ("normal")**: `value` is non-null AND `viewFit` is not `'unsuitable'` AND
  `confidence >= HIGH_CONFIDENCE_THRESHOLD` (0.7). Renders as a card with its formatted value, a
  "High confidence" indicator, and any `caveat` surfaced verbatim as a note.
- **Tier 2 ("caveated")**: `value` is non-null AND `viewFit` is not `'unsuitable'` AND
  `confidence < HIGH_CONFIDENCE_THRESHOLD` — with NO lower confidence bound. Renders as a card
  with its formatted value, a confidence indicator ("Medium confidence" at
  `confidence >= LOW_CONFIDENCE_THRESHOLD` (0.4), "Low confidence" below it), and a border
  treatment structurally distinct from a tier-1 card's — paired with visible text (the confidence
  indicator and, when present, the `caveat` note), never a color-only distinction. A tier-2
  metric's `caveat` MAY be null; the card still renders visibly distinct via its border and
  confidence-indicator text alone in that case.
- **Tier 3 ("excluded")**: `value === null` OR `viewFit === 'unsuitable'`. Excluded from the card
  grid entirely. Instead, listed in a labeled section below the grid by metric name and a reason
  (the metric's `caveat` text) ONLY — no formatted value, no confidence indicator, and no "Not
  available"/"Not measurable" placeholder of any kind render for a tier-3 metric. A metric is
  never excluded because its confidence is low — a measured value at a workable camera angle
  always renders as a card.

`HIGH_CONFIDENCE_THRESHOLD` is single-sourced, shared by the tier classification and by each
card's own confidence-indicator text, so layout and copy can never disagree about where 0.7
falls. `LOW_CONFIDENCE_THRESHOLD` feeds ONLY the indicator copy (the Medium/Low label boundary) —
it participates in no layout decision. Cards within the grid, and entries within the excluded
section, each preserve `MetricId` declaration order — never re-sorted by confidence.

Because tier 3 admits a metric on **either** ground, the excluded section SHALL be labeled, and
SHALL be referred to in the summary line, as metrics that are **not measurable** for this clip
rather than as metrics that were not measured. A metric excluded on the `viewFit` ground has a
computed value; calling it "not measured" contradicts the entry printed directly beneath the
label. The section's own label and the summary line's fragment for it SHALL use the same wording,
so the two can never drift apart.

A card's confidence indicator SHALL be a statement about confidence and nothing else. It is only
ever rendered for tier 1 and tier 2, both of which have a non-null `value` by the tier rule, so it
SHALL NOT carry an availability branch — such a branch is unreachable, and its copy would collide
with the excluded section's availability wording while meaning something different.

#### Scenario: A high-confidence, view-primary metric renders its value and a high-confidence indicator

- **WHEN** a metric's `confidence` is `>= HIGH_CONFIDENCE_THRESHOLD` (including exactly that
  value) and its `value` is non-null — the common case a clean, well-suited (`viewFit: 'primary'`)
  clip produces
- **THEN** the panel renders it as a tier-1 card with its formatted value and a "High confidence"
  indicator, with no tier-2 border treatment

#### Scenario: A tier-2 metric renders its value with a visibly distinct border and confidence indicator

- **WHEN** a metric's `value` is non-null, its `viewFit` is not `'unsuitable'`, and its
  `confidence` is `< HIGH_CONFIDENCE_THRESHOLD` — at any confidence below that bound, with no
  lower cutoff
- **THEN** the panel renders it as a card, in the grid, with its formatted value, a confidence
  indicator reading "Medium confidence" when `confidence >= LOW_CONFIDENCE_THRESHOLD` and "Low
  confidence" below that, and a border treatment distinguishable from a tier-1 card's by more
  than color alone

#### Scenario: A tier-2 metric's caveat, when present, renders as a visible note on the card

- **WHEN** a tier-2 metric's `caveat` is non-null
- **THEN** that text renders on the card in a visibly distinct note, not the same muted styling a
  tier-1 card's caveat receives

#### Scenario: A null-value metric renders as not available, not as zero or blank

- **WHEN** a metric's `value` is `null`
- **THEN** the panel never renders a formatted number, a zero, or a silently blank field for it —
  instead it is excluded from the card grid entirely, and its name plus its `caveat` (the reason)
  appear as an explicit entry in the excluded section, distinguishing "nothing was measured" from
  every rendered card unambiguously

#### Scenario: A measured metric is never excluded for low confidence alone

- **WHEN** a metric's `value` is non-null, its `viewFit` is not `'unsuitable'`, and its
  `confidence` is `< LOW_CONFIDENCE_THRESHOLD` — however low, including near zero
- **THEN** the panel renders it as a tier-2 card in the grid with its formatted value and a "Low
  confidence" indicator — never in the excluded section; the excluded section never lists a
  metric whose exclusion would be explained by confidence rather than by a null value or an
  unsuitable view

#### Scenario: A view-unsuitable metric is visibly flagged with text, not color alone

- **WHEN** a metric's `viewFit` is `'unsuitable'`
- **THEN** it lands in the excluded section via the tier rule's explicit `viewFit` clause — an
  unsuitable camera geometry is structurally unmeasurable regardless of the metric's `value` or
  `confidence` — where its `caveat` names the camera-angle issue verbatim; the strongest possible
  non-color distinction from a rendered card is not being rendered as one at all

#### Scenario: A present caveat from the heuristics engine is surfaced verbatim

- **WHEN** a metric lands in tier 1 or tier 2 and its `caveat` is non-null
- **THEN** that text is displayed alongside the metric, on its card, verbatim

#### Scenario: The excluded section is labeled and accessible

- **WHEN** the panel has at least one tier-3 metric
- **THEN** the excluded metrics render inside a section with an accessible name (e.g. a heading
  associated via `aria-labelledby`) distinguishing it from the card grid above it

#### Scenario: A metric excluded for its camera angle is not called unmeasured

- **WHEN** a metric carries a non-null `value` and a `viewFit` of `'unsuitable'`, so it is listed
  in the excluded section with a computed number it is not allowed to show
- **THEN** the section's label, and the summary line's fragment naming that section, describe its
  contents as not **measurable** for this clip — never as not measured, which the entry beneath
  the label contradicts

#### Scenario: No excluded metrics renders no excluded section

- **WHEN** every metric in the result lands in tier 1 or tier 2
- **THEN** no excluded section renders at all

#### Scenario: A tier-count summary line surfaces caveated and excluded counts at the top of the panel

- **WHEN** at least one metric lands in tier 2 or tier 3
- **THEN** a single summary line renders above the card grid, counting metrics measured with the
  caveated share reported inside that total, and metrics not measurable for this clip — so a user
  who never scrolls the results pane still learns that some metrics carry caveats or were excluded
- **WHEN** every metric lands in tier 1
- **THEN** no summary line renders

#### Scenario: The summary line's counts nest rather than partition

- **WHEN** a run produces metrics in all three tiers at once
- **THEN** the count of metrics measured is the number of metrics that rendered as a card — tier 1
  and tier 2 together — and the caveated count is reported as a share **of** that total rather than
  as a separate quantity beside it, so the sentence never claims fewer metrics were measured than
  the reader can see values for
- **AND** the two counts the line reports sum to the whole panel: metrics measured plus metrics not
  measurable equals every metric the panel considered

#### Scenario: Cards and excluded entries preserve declaration order within their own section

- **WHEN** the panel renders the card grid and, separately, the excluded section
- **THEN** metrics within the grid appear in `MetricId` declaration order (skipping any excluded
  metric in place), and metrics within the excluded section appear in that same declaration
  order — neither section re-sorts by confidence
