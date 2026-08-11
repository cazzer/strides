## ADDED Requirements

### Requirement: Video loops with overlay once analysis is ready
The system SHALL restart video playback from the beginning and loop it continuously, with the
skeleton overlay kept in sync per the existing overlay-sync requirement, once analysis reaches
`phase: 'ready'` — rather than leaving the video paused on its final frame, as sampling itself
leaves it. The system SHALL clear the loop before starting a new analysis run, so that run's
sampling can detect the clip's natural end via the video's `ended` event.

#### Scenario: Reaching the ready phase restarts and loops playback
- **WHEN** `phase` transitions to `'ready'`
- **THEN** the video seeks to the start and begins playing, with its `loop` behavior enabled, with
  no further action required from the user

#### Scenario: The overlay stays in sync through the loop
- **WHEN** the video is looping after `phase` became `'ready'`
- **THEN** the skeleton overlay continues to redraw for the current playback position on every
  loop pass, the same as it does during any other playback (per the existing overlay-sync
  requirement) — including immediately after the loop seeks back to the start

#### Scenario: Looping does not block browser autoplay policy
- **WHEN** the loop-restart's `play()` call is issued outside the original "Analyze" click's
  synchronous call stack
- **THEN** the video is muted before that `play()` call, so the browser's autoplay policy does not
  block it

#### Scenario: Starting a new run clears the loop first
- **WHEN** `start()` is called to begin a new analysis run (e.g. via "Analyze again") while the
  video is still looping from a previous run
- **THEN** the video's loop behavior is cleared before `start()` begins playback for sampling, so
  the video reaches a genuine `ended` event at the end of the new sampling pass instead of looping
  through it
