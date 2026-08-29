# results-view (delta)

## ADDED Requirements

### Requirement: A ghosted evidence photograph is weighted toward its base instant

The system SHALL composite a ghosted pair so that the base instant contributes **strictly more** of
the resulting image than the ghost does, and SHALL keep the ghost heavy enough to remain identifiable
as a body at the thumbnail's real display size.

The reason is that the other two layers of the same image already pick a winner and the photograph
must not contradict them. The annotation layer is asymmetric by requirement — a ghosted pair's marks
are as solid as a single frame's, while the ghost's are weaker — and the caption names one instant
*ghosted against* another. A photograph that picks no winner, under an annotation and a caption that
both do, is a picture contradicting its own labels, and a reader resolves that contradiction from
whatever cue happens to be strongest in that particular image, which is not reliably the base.

The photographic weight and the annotation mark opacity SHALL be **separate decisions carried by
separate constants**. The annotation layer SHALL NOT derive its mark opacity from the plan's
photographic blend value: they answer different questions, and one number serving both means moving
either one silently moves the other.

The weighting SHALL be chosen by looking at rendered thumbnails **at the size the reader actually
sees**, across more than one clip, rather than by taste. A ghost's visibility is a function of that
clip's own subject-against-background contrast — on a static camera the shared background reproduces
at full contrast whatever the blend, while each body's contrast scales with its own weight — so a
weighting that reads well on one clip is not evidence about another.

#### Scenario: A ghosted thumbnail's base instant reads as the foreground body

- **WHEN** an exemplar naming two instants renders as a single ghosted thumbnail
- **THEN** the base instant contributes strictly more of the composited image than the ghost, and at
  the thumbnail's real display size the base body reads as the foreground body rather than the two
  reading as equals

#### Scenario: The ghost stays visible as a body

- **WHEN** a ghosted thumbnail is viewed at its real display size
- **THEN** the ghost instant is still identifiable as a second position of the same body, not a
  smudge — the delta the image exists to show survives the weighting

#### Scenario: Photographic weight and annotation opacity are independent

- **WHEN** the photographic blend weight of a ghost is changed
- **THEN** the opacity of the ghost's annotation marks is unchanged, because the two are carried by
  different constants and the annotation layer never reads the plan's photographic blend value
