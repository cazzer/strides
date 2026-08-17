## ADDED Requirements

### Requirement: Poster frame for a loaded clip

The unified video source SHALL expose a poster image for the clip it holds — a single still frame
suitable for rendering the clip at thumbnail size — so that a clip can be represented in the
interface without its video element being on screen. The poster SHALL be `null` before a frame is
available and SHALL return to `null` on reset, the same lifecycle the retained source blob follows.

Deriving the poster SHALL NOT disturb the clip's canonical video element: it SHALL NOT seek, play,
pause, mute, or otherwise write to that element's playback state, and SHALL NOT require a reference
to it. The canonical element is shared with sampling, with the background scale pass, and with the
reader's own preview playback, all of which would be corrupted by a write from a thumbnail.

The poster MAY therefore be decoded from the clip's retained source blob through a separate,
short-lived decoder that the derivation owns outright, rather than copied from whatever frame the
canonical element happens to be showing. That is the preferred mechanism, for two reasons: it makes
the no-interference property **structural** rather than a discipline the caller must maintain, and
the canonical element's already-decoded frame is not a good thumbnail — at `'ready'` it is the first
frame, which on real footage is routinely a fade-in or black leader, and during sampling it is
whichever mid-analysis frame happens to be current, which varies run to run. A derivation that owns
its own decoder MAY seek that decoder freely, since nothing else observes it, and SHALL tear down the
decoder and revoke its object URL on every exit path, including timeout and error.

At most one such decoder SHALL exist at a time across the whole session, and that limit SHALL be
enforced by the derivation itself rather than asked of its callers. A session can acquire several
clips in a single interaction — one multi-file selection loads every file at once — and each clip's
derivation is requested independently, with no call site able to see the others. Full-resolution
decoders are held open at the clip's own dimensions, which for this app's own reference footage is
4K, and they are opened during analysis, competing with a live sampling run for memory and GPU.

The instant a poster is taken from SHALL NOT be the clip's first frame whenever any later instant
can be reached, **including when the clip's duration cannot be read at all**. A duration of
`Infinity` is not an exotic failure: it is what a MediaRecorder-produced clip reports, which is
every clip this app records itself. Treating an unreadable duration as zero would silently apply
the first-frame outcome to a whole input mode, so an unreadable duration SHALL instead fall back to
a fixed offset into the clip, and only then to the first frame if that offset cannot be reached.

Because the source reaches `'ready'` on metadata alone, a frame is not guaranteed at that moment. The
poster SHALL therefore become available at or after `'ready'`, once a frame has actually been
decoded, and a consumer SHALL treat its absence as "not yet", rendering a neutral placeholder rather
than an error or an empty box.

The poster itself SHALL be held in memory for the session only. The system SHALL NOT serialize **the
poster** to a data URL, a blob, an object URL, or any persistent storage — the same rule extracted
evidence images follow. An object URL minted for a transient decoder is not a serialization of the
poster and is permitted, provided it is revoked as required above. The poster SHALL be released when
the clip is removed and when the session resets.

Any sizing or aspect-ratio arithmetic involved SHALL be computable without a canvas or a DOM, so it
is unit-testable in an environment with no canvas implementation; only the frame copy itself touches
a rendering context.

#### Scenario: A poster appears once a frame has been decoded

- **WHEN** a clip finishes loading and a frame has been decoded for it
- **THEN** the video source exposes a poster image for that clip

#### Scenario: No poster before a frame exists

- **WHEN** a clip has reached `'ready'` on metadata but no frame has been decoded yet
- **THEN** the exposed poster is `null`, and a consumer renders a neutral placeholder rather than an
  error or a blank frame

#### Scenario: Poster derivation never reaches the canonical element

- **WHEN** a poster is derived for any clip, in any phase
- **THEN** the derivation obtains no reference to that clip's canonical video element, so no write to
  its playback state is possible in the first place

#### Scenario: Poster capture leaves playback alone

- **WHEN** a poster is captured for a clip that is mid-analysis, or whose preview the reader has
  open and playing
- **THEN** the canonical element's current time, paused state, muted state, and loop state are all
  unchanged, and the in-flight analysis completes exactly as it would have

#### Scenario: A transient decoder is torn down on every path

- **WHEN** a poster derivation opens its own decoder and that derivation succeeds, times out, errors,
  or is abandoned because the clip was removed first
- **THEN** the decoder is released and its object URL revoked in every one of those cases

#### Scenario: Several clips arrive at once and decode one at a time

- **WHEN** several clips are added in a single interaction and each asks for its poster
- **THEN** no two poster decoders are open simultaneously — each starts only after the previous one
  has been torn down — without any caller having arranged that ordering

#### Scenario: A clip whose duration cannot be read still posters past its first frame

- **WHEN** a clip reports no usable duration, as a webcam recording does
- **THEN** the poster is taken from a fixed offset into the clip rather than from its first frame,
  and falls back to the first frame only if that offset cannot be reached

#### Scenario: The poster is not serialized or persisted

- **WHEN** a poster exists for a clip
- **THEN** it exists only as an in-memory image handle — no data URL, blob, download, or stored copy
  of the poster is produced, and no object URL outlives the transient decoder that needed it

#### Scenario: The poster is released on reset

- **WHEN** the video source is reset, or its clip is removed from the session
- **THEN** the exposed poster returns to `null` and the underlying image resource is released

### Requirement: The picker owns the empty state and collapses into a persistent add-a-clip action

The system SHALL present the full video picker — record, upload, and the demo clips — as the page's
main content while the session holds no loaded clip. Once at least one clip is loaded, that
full-page picker SHALL collapse into a single persistent action in the application header that
offers the **same** input paths: recording with the webcam and uploading a file, not upload alone.
Both presentations SHALL drive the same unified video source contract, so a clip added later is
indistinguishable downstream from the first.

The action SHALL be keyboard reachable and carry an accessible name stating what it does. No
add-a-clip affordance SHALL remain in the page body.

#### Scenario: An empty session shows the full picker

- **WHEN** the session holds no loaded clip
- **THEN** the record/upload picker and the demo clips are presented as the page's main content

#### Scenario: The picker collapses once a clip exists

- **WHEN** the first clip finishes loading
- **THEN** the full-page picker is no longer the page's main content, the results take that place,
  and a single add-a-clip action is available in the header

#### Scenario: The header action offers recording as well as upload

- **WHEN** the reader activates the header's add-a-clip action
- **THEN** both the webcam-recording path and the file-upload path are available from it — closing
  the gap left by an upload-only in-body affordance, which offered no way to record or to add a demo
  clip after the first clip existed

#### Scenario: The action is labeled and keyboard reachable

- **WHEN** the reader navigates the header by keyboard
- **THEN** the add-a-clip action can be reached and activated, and exposes an accessible name saying
  it adds a clip
