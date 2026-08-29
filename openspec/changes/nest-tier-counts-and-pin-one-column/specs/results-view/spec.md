# results-view (delta)

## MODIFIED Requirements

### Requirement: Metrics panel readouts with measurability and confidence tiers

The system SHALL display, for each of the ten `MetricId`s in `FormHeuristicsResult`, its value in
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

### Requirement: Evidence renders as annotated thumbnails inside the metric card

The system SHALL render a metric's extracted evidence **inside that metric's own card**, as small
annotated thumbnails, and SHALL render no standalone evidence gallery and no link from a card to one.
The picture and the number it explains SHALL be visible together.

Placement within the card SHALL be: after the metric's description, **below** it when the card is
narrow and **beside** it when the card is wide. The narrow/wide decision SHALL be a function of the
**card's own width**, not the viewport's; a viewport-width rule would place a thumbnail beside a
description in a card with no room for it. The placement SHALL be correct at every card width the
panel produces.

The card grid SHALL be a **single column at every viewport width**. This is a layout decision, not
an artifact: a full-width card is what leaves the description enough room for its thumbnails to sit
beside it on a desktop, which is the placement this requirement asks for. At two- or three-column
density a desktop card is narrow enough that the card-width rule above correctly stacks the
thumbnail, and "beside the description on a desktop" would stop happening at any viewport. The
system SHALL NOT carry column-count utilities that do not take effect; keying the split off the
card's own width rather than the viewport's remains correct regardless, and is what would keep this
placement rule sound if the density were ever revisited.

Thumbnails SHALL be sized for a card rather than for a gallery figure. Display size SHALL remain a
presentation decision expressed in the layout: the system SHALL NOT extract a second copy of an image
at a second resolution to serve a second display size, and every image SHALL share the single aspect
ratio the planning requirement fixes, so a card carrying two thumbnails and a card carrying one read
as the same set.

Each thumbnail SHALL be captioned well enough to be interpretable on its own: which metric it is
evidence for, which side where the metric is per-side, and — for a blended image — which two instants
were blended, in the metric's own words, and when in the clip they occurred. The caption SHALL NOT
additionally state that the two visible positions are one runner rather than two people. Every blended
label this system emits already says one instant is *ghosted against* another, which names a single
subject at two moments; a second sentence restating it is boilerplate in a card that already carries a
description, a value, a confidence line and a caveat, and captions were written for a standalone
gallery figure that no longer exists.

Each thumbnail SHALL carry a text alternative describing what it shows, since the image itself carries
no text. The text alternative MAY state the one-runner framing the caption omits, because alt text is
read out of context and reaches a reader who has none of the card around it. Where more than one clip
is present, the card SHALL indicate which clip its evidence came from.

The rendered image SHALL be the extracted canvas element itself, adopted into the document. The
system SHALL NOT introduce a data URL, blob, object URL, download affordance, or any other
serialization of a thumbnail in order to display it inside a card.

Extraction SHALL run at most once per clip, and whatever component owns it SHALL hold at most one
detached decoder open at a time and SHALL release the detached element, its object URL, and every
retained image when the results unmount or the session resets. Moving the imagery into the cards
SHALL NOT weaken any of those.

#### Scenario: A thumbnail sits below the description in a narrow card and beside it in a wide one

- **WHEN** a metric with evidence renders as a card
- **THEN** its thumbnails render after the card's description — stacked below it while the card is
  narrow, and alongside it once the card is wide enough

#### Scenario: The card's own width drives the split, not the viewport's

- **WHEN** the same card is rendered at a viewport narrow enough that the full-width card is itself
  narrow, and again at a desktop viewport where it is wide
- **THEN** its thumbnails stack below the description in the first case and sit beside it in the
  second, decided by the card's measured width rather than by any viewport breakpoint

#### Scenario: The card grid is one column at every width

- **WHEN** the results render at a narrow, a medium, and a wide viewport
- **THEN** the card grid resolves to a single column at all three, each card spanning the panel's
  full width, and the panel carries no responsive column-count utility that never takes effect

#### Scenario: A ghosted thumbnail says it is one runner, not two people

- **WHEN** a card's evidence is a blended pair
- **THEN** its caption conveys the one-runner framing through the metric's own label alone — one
  instant *ghosted against* another — followed by when in the clip the two instants occurred, and
  carries no further sentence spelling out that the image is not two people; its text alternative
  names the metric and, where the metric is per-side, the side

#### Scenario: No gallery and no deep link remain

- **WHEN** the results render with evidence for several metrics
- **THEN** no separate evidence section renders anywhere on the page, no card carries a link to one,
  and every image is inside the card for the metric it is evidence for

#### Scenario: Nothing is retained after the results go away

- **WHEN** the results unmount or the session is reset
- **THEN** no detached video element, object URL, or extracted image is retained
