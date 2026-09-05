# results-view

## ADDED Requirements

### Requirement: Evidence seeks target the middle of a frame's presentation interval

The system SHALL, when seeking to draw a planned evidence instant, request a time **inside** the
presentation interval of the frame that instant names — specifically its midpoint — rather than the
interval's start boundary.

Setting a media element's current time displays the frame whose presentation interval **contains**
that time. The boundary is the one point in the interval at which an arbitrarily small error selects
a different frame, and such an error is unavoidable: the seek API quantises to integer microseconds,
so a frame boundary that is not a whole number of microseconds cannot be named at all. The midpoint
is therefore the semantically correct request, and it is correct whether that quantisation truncates
or rounds to nearest.

The offset SHALL be **half the clip's own nominal frame duration**, derived from the container the
clip was decoded from, and SHALL be `0` for any clip whose frame duration is not derivable — a
container that does not parse, a file with no video track, or a track that names no usable frame
rate. Zero reproduces exactly the seek that applied before this requirement existed, so declining
costs nothing that already worked.

This offset SHALL compose with, and remain separate from, the media-to-presentation clock
conversion the system already applies: the conversion is a per-clip **and** per-sampler fact about
which clock a timestamp is on, while the midpoint is a per-clip targeting decision that holds on
every sampler, because the quantisation is a property of the seek API rather than of whatever
produced the timestamp. The conversion SHALL be applied first, so that the midpoint is measured
against the interval the element will actually compare the request to.

The system SHALL apply this at seek time only. It SHALL NOT write the offset back into the sampled
frames' own timestamps, into the extraction plan, or into any diagnostics payload: this changes
which pixels an image is drawn from and no number any metric was computed from.

The clip's reported end MAY bound a seek target that was already derived from sampled frames — the
final frame's interval ends there, so half a frame past its start can fall beyond it — but SHALL NOT
produce one, and SHALL be ignored entirely when it is not a finite number. A recorded webcam clip
commonly reports an infinite duration, and a detached element may report none at all.

#### Scenario: A frame boundary that is not a whole microsecond still draws its own frame

- **WHEN** a planned instant's frame begins at a presentation time that is not an integer number of
  microseconds, so the seek API cannot express the boundary and the request quantises below it
- **THEN** the seek lands inside that frame's interval and the drawn image is that frame, rather
  than the frame before it

#### Scenario: The clock conversion and the midpoint compose in that order

- **WHEN** a clip's container both shifts the media clock against the presentation clock and names a
  frame rate
- **THEN** the seek target is the planned timestamp plus the clock conversion plus half a frame,
  and each term is derived and overridable independently of the other

#### Scenario: A clip with no derivable frame duration seeks exactly as it did before

- **WHEN** the clip's container does not parse, carries no video track, or names no usable frame
  rate — as every WebM and every webcam recording does
- **THEN** the midpoint offset is zero and the seek target is unchanged from the behaviour that
  applied before this requirement

#### Scenario: The final frame's midpoint never seeks past the clip's end

- **WHEN** the last planned instant sits within half a frame of a finite reported clip end
- **THEN** the seek target is clamped to that end rather than exceeding it, so the seek completes
  instead of exhausting its timeout and failing the exemplar

#### Scenario: The measured timestamp is unchanged by where the seek lands

- **WHEN** the midpoint offset is applied to a clip whose metrics have already been computed
- **THEN** every metric value, confidence, sampling count and planned exemplar timestamp is
  identical to a run without it, because the offset exists only inside the seek and is never
  written back
