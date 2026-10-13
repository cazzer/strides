## ADDED Requirements

### Requirement: An enlarged evidence frame can open its source clip at that instant

Every evidence thumbnail, in either results view, SHALL be operable as a control that enlarges it in
a dialog showing the same canvas at a larger size, its caption and the clip it came from. The
thumbnail's canvas SHALL move into the dialog rather than be copied, since a node has one parent, and
SHALL move back when the dialog closes.

Where every clip in the session has finished analysing, the dialog SHALL offer to open the source
clip's video at the frame shown — for a ghosted pair, at the solid (base) frame. Doing so SHALL
present that clip's own video paused at the frame's instant, converted onto the presentation clock
with the same calibration evidence extraction uses, and clamped to the clip's duration. While any
clip is still analysing the offer SHALL NOT render, because presenting a clip would contend with a
sampler reading its element.

Dismissing the enlarged dialog SHALL return focus to the thumbnail that opened it. Dismissing a source
video opened from the dialog SHALL return focus to that same thumbnail.

A still frame is evidence of one instant. Opening the footage at that instant lets the reader see the
motion either side of it and judge the still against it, without hunting through the clip.

#### Scenario: A thumbnail enlarges in a dialog

- **WHEN** the reader activates an evidence thumbnail
- **THEN** a dialog shows the same evidence image at a larger size with its caption and its source
  clip, and closing it returns the image to the card and focus to the thumbnail

#### Scenario: The dialog opens the source clip at the frame's instant

- **WHEN** every clip has finished analysing and the reader chooses to open the source video from an
  enlarged frame
- **THEN** that frame's own clip is presented, paused at the frame's instant on the presentation
  clock, and dismissing it returns focus to the thumbnail

#### Scenario: No source-video offer while a clip is analysing

- **WHEN** any clip in the session is still analysing
- **THEN** an enlarged evidence frame offers no way to open its source video
