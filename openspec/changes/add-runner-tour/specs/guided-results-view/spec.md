## ADDED Requirements

### Requirement: The runner tour is the default results view

With no view explicitly selected and no remembered landing, the runner tour SHALL render. The
system SHALL offer three results views — the runner tour, the results summary and the classic
table — and SHALL mount exactly one of them.

Exactly one `view` parameter whose value is exactly `tour`, `summary` or `classic` SHALL select
that view. The legacy value `guide` SHALL select the runner tour. Every other address, including an
absent, empty, unknown, repeated or differently-cased parameter, SHALL select the remembered landing
view when one is set, and the runner tour otherwise. An explicit selection, `guide` included, SHALL
take precedence over the remembered landing.

When the reader skips or finishes the tour, the system SHALL remember the summary as the landing
view in browser storage, and SHALL switch to the summary. Replaying the tour SHALL NOT change the
remembered landing. Unavailable or throwing storage SHALL NOT prevent a view from rendering; it SHALL
read as no remembered landing.

Selecting the classic view SHALL write `view=classic` to the address, so a reload or a shared link
renders the classic view. Selecting the tour or the summary SHALL remove the `view` parameter from
the address rather than write a value.

Each switch the reader makes SHALL add a history entry that records the view it shows, so the
browser's Back and Forward step through the views the reader visited without leaving the page.
Returning to an entry SHALL restore the view that entry records, and SHALL NOT add an entry of its
own. The entry the page loaded on SHALL record the view it opened with. An entry that records no
view, such as one an in-page link created, SHALL leave the view on screen unchanged.

Each view SHALL offer keyboard-operable controls to the others: the tour a control to skip to the
summary; the summary, below its results, a control to replay the tour and a control to open the
classic table; the classic view a control to show the summary. Each view SHALL mark one entry
point at its top: a heading in the tour and the summary, and the show-summary control in the classic
view. After a switch, focus SHALL move to the new view's entry point, never to a control further
down the page.

Selecting a view SHALL NOT require a routing library.

#### Scenario: No selection and no landing renders the tour

- **WHEN** the results render with no view selected and no remembered landing
- **THEN** the runner tour renders

#### Scenario: A remembered summary landing renders the summary

- **WHEN** the results render with no view selected and the summary remembered as the landing view
- **THEN** the results summary renders

#### Scenario: Skipping or finishing the tour remembers the summary

- **WHEN** the reader skips or finishes the tour
- **THEN** the summary renders, the summary is remembered as the landing view, and the address
  carries no `view` parameter

#### Scenario: Unavailable storage still renders a view

- **WHEN** browser storage throws on every access
- **THEN** the runner tour renders, and skipping it still switches to the summary

#### Scenario: An older guided link renders the tour

- **WHEN** the page loads with `?view=guide`, whether or not a landing is remembered
- **THEN** the runner tour renders

#### Scenario: An explicit classic selection survives a reload and is shareable

- **WHEN** the reader selects the classic view
- **THEN** the address carries `view=classic`, so reloading or sharing it renders the classic view

#### Scenario: Each view offers keyboard-operable controls to the others

- **WHEN** any of the three views renders
- **THEN** it offers native buttons, operable from the keyboard, that reach the other views as listed
  above, and activating one moves focus to the new view's entry point

#### Scenario: Browser Back returns to the previous view

- **WHEN** the reader moves from the summary to the classic view and then presses the browser's Back
- **THEN** the summary renders again with its evidence imagery intact, the address carries no `view`
  parameter, and the page has not been left

#### Scenario: No routing library

- **WHEN** the dependencies are inspected
- **THEN** no routing library is installed, and the view is read from and written to the address
  directly

## MODIFIED Requirements

### Requirement: Exactly one results view is mounted at a time

The runner tour, the results summary and the classic results view SHALL NOT be mounted
simultaneously. The choice between them SHALL be exclusive. The tour and the summary SHALL each
render exactly one guided results shell, never a hidden second copy. The tour SHALL mount no metric
card and so no evidence canvas; its evidence is mounted when the reader switches to the summary or
the classic view. The summary SHALL mount each metric's card (and so its evidence) at most once; a
collapsed summary row SHALL hide its content without unmounting it.

This is forced by the DOM, not chosen for tidiness. Session evidence hands out real canvas elements
and each is mounted by replacing a host's children with it. **A DOM node has exactly one parent.**
Mounting two views would silently move every evidence canvas into whichever rendered last, emptying
the other view's imagery with no error raised anywhere — a failure that looks like missing evidence
rather than like a bug in view selection.

For the same reason neither the guided view, the runner tour nor the results summary SHALL acquire
session evidence itself. Each SHALL receive evidence as input from the single existing acquisition, so that
switching views moves the canvases rather than duplicating or re-extracting them.

#### Scenario: Only one view is in the document

- **WHEN** the session has an analysable clip and any view is selected
- **THEN** exactly one of the three results views is present in the document, and never two

#### Scenario: Switching views preserves the imagery

- **WHEN** the reader switches from the tour to the summary, to the classic view and back to the
  summary
- **THEN** the tour shows no evidence imagery, and from the summary on the imagery renders in the
  view that is mounted, the same canvas elements move with each switch, and no image is lost

#### Scenario: The guided view does not acquire evidence itself

- **WHEN** the guided view, the runner tour or the results summary renders
- **THEN** it renders at most the evidence it was given as input and starts no evidence acquisition
  of its own

#### Scenario: Collapsed summary rows keep their imagery

- **WHEN** the results summary renders with every row collapsed
- **THEN** each evidence canvas is already in the document inside its metric's row, exactly once,
  and opening the row shows that same canvas rather than mounting a new one

### Requirement: The guided view announces completion with the same words the classic view does

When the analysis has completed, every results view — the runner tour, the results summary and the
classic view — SHALL render exactly one status role beginning with the exact text "Analysis
complete." A view that wraps the guided view SHALL rely on the guided view's line and SHALL NOT
render a second one.

That literal is a hard external coupling, not a copy decision: this repo's end-to-end spec and its
A/B measurement driver both wait on those exact words. Rendering them in every view means a harness
can drive any of them, and means the default can change without breaking either instrument. Exactly
one match matters as much as the words: both instruments locate the line strictly, and a second match
fails them as surely as none.

#### Scenario: The completion line is present and verbatim

- **WHEN** any results view renders for a completed analysis
- **THEN** exactly one element with a status role contains the text "Analysis complete."

## REMOVED Requirements

### Requirement: The guided results view is the default

**Reason**: The runner tour is the default results view now, with a summary the reader lands on
after skipping it and the classic table behind both; see "The runner tour is the default results
view". The two-option Guided/Classic toggle is replaced by per-view controls.

**Migration**: `?view=guide` renders the runner tour. `?view=classic` is unchanged. An absent or
unrecognised `view` renders the remembered landing (the summary) when one is set, otherwise the tour.
The `ResultsViewToggle` component is deleted.

### Requirement: The guided view ranks metrics into three groups by what can be said about them

**Reason**: No view presents the three groups any more. The summary groups cards by focus area, one
collapsed row per measured area in tour order, and the tour by stop; the guided body that rendered
the banded, unbanded and not-measured groups was deleted (`strides-trn2.7`). Neither view orders
anything by the runner's own readings.

**Migration**: See results-summary "The summary shows the model runner beside one row per measured
focus area" and "Unmeasured metrics sit in one final collapsed Not measured row". A shared
remediation link (overstriding's on the cadence card) is still attached by the guidance data and
renders on the card as before.

### Requirement: The three bounce measures are introduced together, each linking to its own entry

**Reason**: The bounce introduction lived only in the deleted guided body, and no view renders it.
The three bounce measures now sit together in the summary's rhythm row and the tour's rhythm stop.

**Migration**: None. Each measure keeps its own card with its own evidence and limits.

### Requirement: A headline appears only where its spokesman reads past its cited band on the costly side

**Reason**: The "Energy cost" section was deleted with the guided body, and no view renders a
headline. Its threshold survives as the cue rule: a reading earns a cue only past its band's
outermost finite bound on the costly side.

**Migration**: See runner-feedback "A cue appears only where the studied change applies to this
value", which states the same threshold.

### Requirement: Each story has one fixed spokesman and yields at most one headline

**Reason**: No view renders an "Energy cost" headline any more, so it has no story to speak for.

**Migration**: None. Every metric keeps its own card.

### Requirement: Headlines render in evidence order, never in order of the runner's readings

**Reason**: No view renders an "Energy cost" headline any more.

**Migration**: None. The tour and the summary follow the fixed focus-area order.

### Requirement: An empty headline section says where each story stands, without grading

**Reason**: No view renders an "Energy cost" section any more, empty or not.

**Migration**: None. Where nothing earns a cue, the tour's one-thing stop says so (runner-feedback).

### Requirement: A headline states the position, the association, and the card's own cautions

**Reason**: No view renders an "Energy cost" headline any more.

**Migration**: None. A card still carries its position, its mandatory notes, its studied-change line
and its source clip.
