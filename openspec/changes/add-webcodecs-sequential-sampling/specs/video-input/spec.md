## ADDED Requirements

### Requirement: Retained source blob for downstream demuxing
The unified video source SHALL retain the original `Blob`/`File` passed to its load function,
exposed verbatim (the same object, not re-derived from the `<video>` element, which exposes only
decoded pixels and playback state — never its own source bytes back out), so that downstream
consumers can read the clip's raw bytes independently of `<video>`/object-URL playback. The
retained blob SHALL be `null` before any clip has loaded, and SHALL be cleared back to `null` on
reset.

#### Scenario: The loaded blob is exposed verbatim
- **WHEN** a clip is loaded via the video source's load function
- **THEN** the video source exposes that exact `Blob`/`File` object

#### Scenario: No blob is exposed before any clip loads
- **WHEN** no clip has been loaded yet
- **THEN** the video source's exposed blob is `null`

#### Scenario: The blob is cleared on reset
- **WHEN** the video source is reset after a clip was loaded
- **THEN** its exposed blob returns to `null`
