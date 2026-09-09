# results-view

## ADDED Requirements

### Requirement: An evidence seek converts the sampled timestamp onto the presentation clock

The system SHALL, before seeking to draw a planned evidence instant, convert that instant's
timestamp from the clock the sampler expressed it on to the clock a media element's current time is
expressed on, and SHALL derive that conversion from the clip's own container rather than from a
configured constant.

Which clock a sampled timestamp is on depends on which sampler produced it. A frame decoded through
WebCodecs carries the container's raw **composition** timestamp. A frame read off a playing element
carries a **presentation** timestamp already. A single-entry, unity-rate edit list maps presentation
time zero onto composition time `media_time`, so the conversion SHALL subtract
`media_time / mediaTimescale`, and SHALL be `0` wherever the sampled timestamp is already a
presentation time — every clip the playback sampler produced, and every clip whose container carries
no such edit.

The conversion SHALL be `0` for any edit list that is not a single constant shift: no edit list at
all, more than one entry, an empty edit whose presentation zero maps to no media time, or a rate
that is not unity. None of those is expressible as one number, and a wrong number is worse than
none.

The subtracted quantity SHALL be read as a **clock offset**, never as a count of leading frames the
edit removed. On ordinary camera output the edit exists to cancel the first picture's composition
offset: `media_time` equals the composition timestamp of the first presented picture, so no picture
precedes the edit and none is discarded. A reader who counts it as frames removed mis-numbers every
picture in the file by exactly the quantity being converted, and will therefore read a correct
conversion as an error of that same size in the opposite direction.

The conversion SHALL be applied at seek time only. It SHALL NOT be written back into the sampled
frames' own timestamps, which are correct in their own domain, nor into the extraction plan, nor
into any diagnostics payload.

#### Scenario: A WebCodecs-sampled instant draws the frame the metric measured

- **WHEN** a clip sampled through WebCodecs carries a single unity-rate edit list, and evidence is
  drawn for an instant whose timestamp is that clip's raw composition time for some frame
- **THEN** the seek lands inside that same frame's presentation interval, so the drawn image is the
  frame the metric measured rather than one displaced by the edit list's own shift

#### Scenario: An already-presentation-clock timestamp is seeked unconverted

- **WHEN** the clip's frames were sampled off a playing element, whose reported times are already on
  the presentation clock
- **THEN** the conversion is zero and the seek target is the planned timestamp itself, whatever the
  container's edit list says

#### Scenario: An edit list that is not a constant shift is declined rather than approximated

- **WHEN** a clip's container carries no edit list, several entries, an empty edit, or an entry
  whose rate is not unity
- **THEN** the conversion is zero, and the seek behaves as it does for a container that names no
  edit at all

#### Scenario: The conversion moves pixels and never a number

- **WHEN** the conversion is applied to a clip whose metrics have already been computed
- **THEN** every metric value, confidence, sampling count, person-selection count, view reading and
  planned exemplar timestamp is identical to a run without it, because the conversion exists only
  inside the seek and is never written back
