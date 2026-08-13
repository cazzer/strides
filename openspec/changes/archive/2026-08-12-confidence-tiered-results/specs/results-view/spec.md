## MODIFIED Requirements

### Requirement: Metrics panel readouts with confidence/applicability indicators

The system SHALL display, for each of the nine `MetricId`s in `FormHeuristicsResult`, its value in
plain language and a label naming the metric, partitioned into three confidence tiers that
determine how — and whether — a value renders at all, rather than a single uniform card style for
every metric:

- **Tier 1 ("normal")**: `confidence >= HIGH_CONFIDENCE_THRESHOLD` (0.7) AND `value` is non-null.
  Renders as a card with its formatted value, a "High confidence" indicator, and any `caveat`
  surfaced verbatim as a note.
- **Tier 2 ("caveated")**: `LOW_CONFIDENCE_THRESHOLD` (0.4) `<= confidence < HIGH_CONFIDENCE_THRESHOLD`
  AND `value` is non-null. Renders as a card with its formatted value, a "Medium confidence"
  indicator, and a border treatment structurally distinct from a tier-1 card's — paired with
  visible text (the confidence indicator and, when present, the `caveat` note), never a
  color-only distinction. A tier-2 metric's `caveat` MAY be null; the card still renders visibly
  distinct via its border and confidence-indicator text alone in that case.
- **Tier 3 ("excluded")**: `confidence < LOW_CONFIDENCE_THRESHOLD` OR `value === null`. Excluded
  from the card grid entirely. Instead, listed in a labeled section below the grid by metric name
  and a reason (the metric's `caveat` text) ONLY — no formatted value, no confidence indicator, and
  no "Not available"/"Not measurable" placeholder of any kind render for a tier-3 metric.

`HIGH_CONFIDENCE_THRESHOLD` and `LOW_CONFIDENCE_THRESHOLD` are single-sourced constants shared by
the tier classification and by each card's own confidence-indicator text, so the two can never
disagree about where a given metric falls. Cards within the grid, and entries within the excluded
section, each preserve `MetricId` declaration order — never re-sorted by confidence.

#### Scenario: A high-confidence, view-primary metric renders its value and a high-confidence indicator

- **WHEN** a metric's `confidence` is `>= HIGH_CONFIDENCE_THRESHOLD` (including exactly that
  value) and its `value` is non-null — the common case a clean, well-suited (`viewFit: 'primary'`)
  clip produces
- **THEN** the panel renders it as a tier-1 card with its formatted value and a "High confidence"
  indicator, with no tier-2 border treatment

#### Scenario: A tier-2 metric renders its value with a visibly distinct border and confidence indicator

- **WHEN** a metric's `confidence` is `>= LOW_CONFIDENCE_THRESHOLD` (including exactly that value)
  and `< HIGH_CONFIDENCE_THRESHOLD`, and its `value` is non-null
- **THEN** the panel renders it as a card, in the grid, with its formatted value, a "Medium
  confidence" indicator, and a border treatment distinguishable from a tier-1 card's by more than
  color alone

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

#### Scenario: A tier-3 metric with a non-null value but low confidence is excluded, withholding the value

- **WHEN** a metric's `value` is non-null but its `confidence` is `< LOW_CONFIDENCE_THRESHOLD`
- **THEN** the panel does not render that metric's value anywhere — not as a card, not elsewhere —
  and instead shows only its name and reason in the excluded section, exactly as it would for a
  null-valued metric

#### Scenario: A view-unsuitable metric is visibly flagged with text, not color alone

- **WHEN** a metric's `viewFit` is `'unsuitable'`
- **THEN** it lands in the excluded section per the tier-3 rule above (every `'unsuitable'`
  view-fit multiplier keeps confidence below `LOW_CONFIDENCE_THRESHOLD`), where its `caveat` names
  the camera-angle issue verbatim — the strongest possible non-color distinction from a rendered
  card is not being rendered as one at all

#### Scenario: A present caveat from the heuristics engine is surfaced verbatim

- **WHEN** a metric lands in tier 1 or tier 2 and its `caveat` is non-null
- **THEN** that text is displayed alongside the metric, on its card, verbatim

#### Scenario: The excluded section is labeled and accessible

- **WHEN** the panel has at least one tier-3 metric
- **THEN** the excluded metrics render inside a section with an accessible name (e.g. a heading
  associated via `aria-labelledby`) distinguishing it from the card grid above it

#### Scenario: No excluded metrics renders no excluded section

- **WHEN** every metric in the result lands in tier 1 or tier 2
- **THEN** no excluded section renders at all

#### Scenario: A tier-count summary line surfaces caveated and excluded counts at the top of the panel

- **WHEN** at least one metric lands in tier 2 or tier 3
- **THEN** a single summary line renders above the card grid counting metrics measured, metrics
  with caveats, and metrics not measured for this clip — so a user who never scrolls the
  results pane still learns that some metrics carry caveats or were excluded
- **WHEN** every metric lands in tier 1
- **THEN** no summary line renders

#### Scenario: Cards and excluded entries preserve declaration order within their own section

- **WHEN** the panel renders the card grid and, separately, the excluded section
- **THEN** metrics within the grid appear in `MetricId` declaration order (skipping any excluded
  metric in place), and metrics within the excluded section appear in that same declaration
  order — neither section re-sorts by confidence

## REMOVED Requirements

### Requirement: Low-confidence results banner
**Reason**: Superseded by the confidence-tiered layout's excluded section (this delta's MODIFIED
"Metrics panel readouts with confidence/applicability indicators" requirement). The banner
summarized which metrics were flagged, once, above the grid; the excluded section now shows the
same information — which metrics, and additionally *why*, per metric — as a structural part of
the panel itself. Keeping both would duplicate the same information in two independently
maintained shapes for no benefit; the banner's `role="status"` one-time announcement is
superseded by `ResultsView`'s existing `<p role="status">Analysis complete.</p>`, which already
announces that results (including the excluded section) are now present on the page.
**Migration**: `LowConfidenceBanner.tsx` and its test are deleted; `ResultsView.tsx` no longer
renders it. A metric that was previously named in the banner now appears, with its reason, in the
metrics panel's own excluded section instead — see the MODIFIED requirement above.
