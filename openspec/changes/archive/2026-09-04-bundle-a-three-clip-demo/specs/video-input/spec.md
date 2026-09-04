# video-input

## ADDED Requirements

### Requirement: One demo action loads a bundled multi-clip session

The system SHALL offer exactly one demo action, and activating it SHALL load a fixed set of
several clips into the session as separate clips — not one clip, and not a choice between clips.
The clips SHALL be delivered to the unified video source contract in a fixed order, so the clip
index a reader sees against a metric ("From clip 2 of 3.") names the same footage on every run.

Every demo clip SHALL be bundled with the application rather than fetched from a third-party
origin, so that activating the demo requires no network access and cannot fail with a download
error.

Each clip SHALL be handed over as soon as its own bytes are ready, rather than after the whole set
is ready, so analysis of the first clip proceeds while later clips are still loading.

Demo clips SHALL be delivered as blobs through the same path as recorded and uploaded clips, so a
demo clip is indistinguishable downstream from one the reader supplied.

#### Scenario: The demo action loads every clip in the set

- **WHEN** the reader activates the demo action
- **THEN** one clip is created per clip in the bundled set, in the set's fixed order, and the
  session holds all of them

#### Scenario: A clip begins analyzing before the rest have loaded

- **WHEN** the first clip's bytes are ready and later clips are still loading
- **THEN** the first clip is already handed to the session, rather than being withheld until the
  whole set is ready

#### Scenario: The demo needs no network

- **WHEN** the reader activates the demo action with no network access
- **THEN** the clips still load, because every one of them is bundled with the application

#### Scenario: The demo action is offered once

- **WHEN** the picker is presented, in either its full-page or its header form
- **THEN** exactly one demo action is present, and no per-clip demo action is offered alongside it
