## MODIFIED Requirements

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
read out of context and reaches a reader who has none of the card around it. For a blended image the
text alternative SHALL additionally say which of the two instants is the emphasised one, because that
emphasis is carried only by pixels: the photograph is weighted toward its base instant and the base's
marks are drawn solid against the ghost's faded ones, so a reader who cannot see the image learns from
neither. Where more than one clip is present, the card SHALL indicate which clip its evidence came
from.

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
  names the metric, where the metric is per-side the side, and which of the two blended instants is
  shown emphasised rather than faded

#### Scenario: No gallery and no deep link remain

- **WHEN** the results render with evidence for several metrics
- **THEN** no separate evidence section renders anywhere on the page, no card carries a link to one,
  and every image is inside the card for the metric it is evidence for

#### Scenario: Nothing is retained after the results go away

- **WHEN** the results unmount or the session is reset
- **THEN** no detached video element, object URL, or extracted image is retained

