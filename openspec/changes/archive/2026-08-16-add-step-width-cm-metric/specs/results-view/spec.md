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

### Requirement: Background scale pass grafts measured vertical oscillation

The system SHALL, after an analysis run reaches `phase: 'ready'` on a primary pass that measured
no real-world scale, run one background sampling pass over the same video using a dedicated
MediaPipe Pose Landmarker detector, compute form heuristics over that pass's frames through the
identical sort → robustness → presence-trim → heuristics pipeline the primary pass uses, and —
when the scale pass's `verticalOscillationCm.calibration` is non-null — replace the displayed
result's `verticalOscillationCm` AND `stepWidthCm` with the scale pass's own versions of each,
carrying `verticalOscillationCm.calibration` by reference (`stepWidthCm` has no such calibration
object to carry) and appending a shared provenance sentence (stating in plain language that the
number came from a second look at the same clip, naming no backend or model) to each metric's own
caveat. The two grafted metrics SHALL be independent of each other: a scale pass whose
`verticalOscillationCm.calibration` is non-null but whose own `stepWidthCm` detected no
footstrikes SHALL still graft `stepWidthCm`'s null value and its own caveat, plus provenance —
never withholding a successfully-grafted `verticalOscillationCm` because the sibling metric came
up empty, and never fabricating a `stepWidthCm` result the pass didn't itself produce. Every other
metric and the `view` result SHALL remain reference-identical to the primary pass's, and the
primary run's `diagnostics` SHALL remain the primary pass's own. The pass SHALL be tracked as a
status machine (`'idle' | 'pending' | 'running' | 'done' | 'failed' | 'skipped'`) on the analysis
state; it SHALL be skipped (never started) when the primary result already carries a measured
scale (`verticalOscillationCm.calibration !== null` — the same underlying fact that gates
`stepWidthCm` too, so this single check governs whether the pass runs at all for either metric) or
when the scale-pass config's kill switch is off — the config being resolvable in development
builds via a `window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__` override, defaulting to enabled. Any
scale-pass failure — detector unavailable, playback or sampling failure, a wall-clock watchdog
expiry of at least `max(30s, 3 × clip duration)`, or a completed pass that measured no scale —
SHALL mark the pass `'failed'` and leave the primary result untouched. A `reset()` or a newly
loaded clip SHALL stop an in-flight scale pass, and a superseded pass's late resolution SHALL
never write state, under the same run-identity guard the primary run uses.

#### Scenario: A completed scale pass grafts the centimetre metric and nothing else

- **WHEN** the primary pass reaches `'ready'` with `verticalOscillationCm.calibration: null` and
  the background scale pass completes with a non-null `calibration`
- **THEN** the displayed heuristics' `verticalOscillationCm` AND `stepWidthCm` both become the
  scale pass's own (the former's `calibration` by reference, both caveats ending with the
  provenance sentence), every other metric and `view` remain reference-identical to the primary
  pass's, the run's `diagnostics` remain the primary pass's, and the pass's status is `'done'`
  with the scale pass's own diagnostics attached

#### Scenario: The two grafted metrics succeed or fail independently

- **WHEN** the scale pass completes with a non-null `verticalOscillationCm.calibration` but its own
  `stepWidthCm` detected no footstrikes (a null value with its own caveat)
- **THEN** the displayed `verticalOscillationCm` grafts a non-null value with the provenance
  sentence appended, AND the displayed `stepWidthCm` grafts a null value with its own
  no-footstrikes caveat plus the provenance sentence — neither metric's outcome is suppressed or
  altered by the other's

#### Scenario: The pass is skipped when the primary pass already measured scale

- **WHEN** the primary pass reaches `'ready'` with a non-null
  `verticalOscillationCm.calibration` (e.g. a mediapipe-primary dev override)
- **THEN** no scale pass starts, its status is `'skipped'` with reason `'primary-scale'`, and
  the displayed result is exactly the primary pass's for both metrics

#### Scenario: The kill switch skips the pass

- **WHEN** the resolved scale-pass config has `enabled: false` (in development, via
  `window.__STRIDES_SCALE_PASS_CONFIG_OVERRIDE__`) and a run reaches `'ready'`
- **THEN** no scale pass starts, its status is `'skipped'` with reason `'disabled'`, and both
  centimetre metrics render exactly as they would without this capability

#### Scenario: A failed scale pass leaves the primary result untouched

- **WHEN** the scale pass fails — its detector cannot be created, its sampling rejects, its
  watchdog expires, or it completes without measuring any scale
- **THEN** the pass's status is `'failed'`, and the displayed heuristics, diagnostics, and phase
  are exactly what the primary pass produced for both metrics

#### Scenario: A measured-but-unfittable scale pass still grafts, with its reason

- **WHEN** the scale pass completes with a non-null `calibration` whose amplitude is `null`
  (a fit-failure reason names why)
- **THEN** the grafted `verticalOscillationCm` carries that null value and its fit-failure
  caveat plus the provenance sentence — replacing the primary's now-false "no scale could be
  measured" availability caveat

#### Scenario: A superseded scale pass never writes state

- **WHEN** `reset()` is called, a new clip loads, or `start()` begins a new analysis run while
  a scale pass is `'running'`
- **THEN** the pass's sampling handle is stopped before the new run samples (a still-attached
  scale sampler must never run inference concurrently with a primary pass), and any late
  resolution of its promise writes nothing — no graft of either metric, no status change on the
  new run's state

#### Scenario: A user pause mid-pass fails the pass fast

- **WHEN** video playback pauses while the scale pass is `'running'` and the video has not
  reached its natural end
- **THEN** the pass is stopped and marked `'failed'` immediately (a paused replay produces no
  frames; waiting for the watchdog would leave a false "measuring" state up for tens of
  seconds), while a pause event fired by the clip's natural end is ignored

### Requirement: The centimetre card reflects scale-pass progress

The system SHALL, while a scale pass is `'pending'` or `'running'` and either `verticalOscillationCm`
or `stepWidthCm` is excluded with a `null` value, render that metric's excluded entry with a hint,
in plain language, that real-world scale is still being measured by a second look at the clip, in
place of its availability caveat. When the pass concludes, each metric SHALL render through the
existing confidence-tier rules with no scale-pass-specific card treatment: a grafted non-null
value lands in whatever tier its own confidence puts it in (its caveat, including the
provenance sentence, rendering per that tier's existing rules). After a `'failed'` pass, a
null-valued entry for either metric SHALL say that a second look at the clip couldn't measure
real-world scale (the availability caveat alone would imply the capability is absent when the app
just ran it); after a `'skipped'` pass it SHALL fall back to the metric's own caveat verbatim,
exactly as it renders today. The always-visible analysis status line (`role="status"`) SHALL
narrate the pass — a count-agnostic in-progress sentence while `'pending'`/`'running'` (since how
many of the two scale-pass-backed metrics will end up gaining a value isn't known until the pass
concludes) and a one-sentence outcome on `'done'` or `'failed'`, each in plain language naming no
backend, model, or detection machinery — since the excluded-list hint may sit below the fold and
the status line is the panel's only screen-reader announcement path. The `'done'` outcome SHALL
count how many of the two scale-pass-backed metrics actually gained a non-null value (`0`, `1`, or
`2`) and pluralize its wording off that count — `0` reads as couldn't-add (never as a metric
having been added), `1` reads as singular ("1 more metric"), `2` reads as plural ("2 more
metrics") — never assuming a fixed count of exactly one.

#### Scenario: The excluded entry hints at the in-flight pass

- **WHEN** the scale pass is `'pending'` or `'running'` and `verticalOscillationCm.value` is
  `null`, or `stepWidthCm.value` is `null`
- **THEN** the excluded section's entry for that metric shows the measuring-scale hint instead of
  the availability caveat

#### Scenario: A grafted value renders as an ordinary tiered card

- **WHEN** the scale pass completes and grafts a non-null `verticalOscillationCm` or `stepWidthCm`
  value (measured values are never excluded for low confidence, per the
  exclude-only-unmeasurable-metrics rule)
- **THEN** that metric renders as a card in its confidence tier, its note carrying the grafted
  caveat with the provenance sentence — no new card state, styling, or tier is introduced

#### Scenario: A failed pass says the attempt happened

- **WHEN** the scale pass is `'failed'` and `verticalOscillationCm.value` is `null`, or
  `stepWidthCm.value` is `null`
- **THEN** that metric's excluded entry says a second look at the clip couldn't measure
  real-world scale — not the bare availability caveat, which would imply the capability was never
  exercised

#### Scenario: A skipped pass falls back to the caveat

- **WHEN** the scale pass is `'skipped'` and a metric's `value` is `null`
- **THEN** the excluded entry shows that metric's own caveat verbatim, with no in-progress hint

#### Scenario: The status line narrates the pass

- **WHEN** the analysis is `'ready'` and the scale pass is `'pending'`/`'running'`, then later
  `'done'` or `'failed'`
- **THEN** the `role="status"` completion line appends a count-agnostic in-progress sentence
  while the pass runs, and on conclusion a one-sentence outcome that names how many of the two
  scale-pass-backed metrics actually gained a value — singular wording at exactly one, plural
  wording at two, the couldn't-add sentence at zero; a `'skipped'` pass appends nothing

## ADDED Requirements

### Requirement: The step-width card renders as an absolute centimetre quantity, unavailable when scale wasn't measured

The system SHALL render `stepWidthCm` with description text stating that its number is a real
distance with no denominator, distinguishing it from every other metric on the panel except
`verticalOscillationCm`. The card SHALL render its value in centimetres with one decimal place and
no percent sign — the same formatting `verticalOscillationCm` uses, since both share the
`'centimeters'` unit — and SHALL render as excluded, with its availability caveat, when its
`value` is `null` rather than as an error or a blank field.

#### Scenario: A resolved step-width value renders with one decimal place, no percent sign

- **WHEN** `stepWidthCm.value` is a finite number, for example `8.2`
- **THEN** the panel renders it as `"8.2 cm"` — one decimal place, a `cm` unit suffix, and no `%`
  character

#### Scenario: An unavailable step-width card reads as an availability statement, not an error

- **WHEN** `stepWidthCm.value` is `null`
- **THEN** the metric is excluded from the card grid, and its `caveat` text (saying in plain
  language what would be needed) is surfaced verbatim in the excluded section, the same treatment
  every other null-valued metric already receives — no distinct error styling or wording is
  introduced for this metric specifically
