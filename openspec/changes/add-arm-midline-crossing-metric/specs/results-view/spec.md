## MODIFIED Requirements

### Requirement: Metrics panel readouts with measurability and confidence tiers

The system SHALL display, for each of the fourteen `MetricId`s in `FormHeuristicsResult`, its value in
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

