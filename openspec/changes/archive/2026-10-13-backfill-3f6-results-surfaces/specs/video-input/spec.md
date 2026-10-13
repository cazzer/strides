## ADDED Requirements

### Requirement: The picker shows filming guidance and how video is handled

Wherever the picker renders — as the empty state and inside the header's add-a-clip action — it
SHALL show, before the reader records or uploads, short filming guidance: keep the camera steady with
the whole body and both feet in frame for several unobstructed strides; film from the side for the
stride, knee and bounce measures; add a front view, running toward the camera, for step width and arm
swing.

It SHALL also state, outside any disclosure, that the clip is analysed in the browser and not
uploaded to a server, and MAY give the detail — that clips and generated stills stay in the page's
memory, that removing a clip removes it from the session, and that models and fonts are downloaded
separately from the video — inside a disclosure.

Which measurements a clip can produce depends on how it was filmed, and the reader can only act on
that before filming. Whether their footage leaves the device is a question a reader has before
handing it over, not after.

#### Scenario: Filming guidance renders before the input paths

- **WHEN** the picker renders, in the empty state or in the header's add-a-clip action
- **THEN** it shows guidance to keep the whole body in frame, to film from the side for stride, knee
  and bounce measures, and to add a front view for step width and arm swing

#### Scenario: The picker says the video stays in the browser

- **WHEN** the picker renders
- **THEN** it states, without the reader opening anything, that the clip is analysed in the browser
  and is not uploaded to a server
