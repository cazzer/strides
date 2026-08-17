# form-heuristics (delta)

## ADDED Requirements

### Requirement: Metrics emit exemplar instants as timestamps, never frame indices

Every metric SHALL be able to report, alongside its existing `MetricResult` fields, an optional
`exemplars` list naming the specific instants in the clip that produced its result. Each exemplar
SHALL identify its instant(s) **only** by `timestamp` — seconds on the clip's own media clock, the
same clock `RobustPoseFrame.timestamp` carries — and SHALL carry a second, optional
`pairedTimestamp` when the exemplar depicts a two-instant range. The exemplar type SHALL NOT
contain a frame-index field of any kind.

The reason is a boundary that is invisible at the call site: metrics are computed over the
**presence-trimmed** frame array while the rest of the application holds the **untrimmed** array, so
an index produced by a metric does not address the array its consumer holds — off by exactly the
number of frames the presence trim removed, which is zero on a clip where the subject is present
from the first frame and non-zero on precisely the clips this evidence is most useful for. Because
the presence trim returns a slice of the *same* frame objects, timestamps are valid on both sides of
that boundary and indices are not.

An exemplar SHALL additionally carry: a `quality` score in `[0, 1]` (see "Exemplar instants are
ranked and gated by a per-instance quality score"), a `kind` discriminating what the instant depicts,
a `side` where the metric is per-side, a short human-readable `label` for captioning, and the
`cropKeypoints` — the keypoint names whose positions define the region of the frame this exemplar is
about. `cropKeypoints` SHALL be named by the metric that emitted the exemplar, not re-derived
downstream from the `MetricId`, so that knowledge of what a metric measured lives only in the module
that measures it.

A metric SHALL emit **at most two** exemplars, ranked by `quality` descending, where a two-instant
ghosted pair counts as one exemplar. A metric with no instant clearing the gate SHALL omit the field
entirely rather than emitting a low-quality exemplar.

Emitting exemplars SHALL NOT change any metric's `value`, `confidence`, `viewFit`,
`interpolatedFraction`, `frameCoverage`, `sampleSize`, or `caveat`.

#### Scenario: An exemplar addresses its instant by timestamp across the presence-trim boundary

- **WHEN** a metric emits an exemplar on a clip whose presence window is strictly narrower than the
  full clip
- **THEN** resolving that exemplar's `timestamp` against the **untrimmed** frame array finds the same
  frame object the metric itself saw in the **trimmed** array

#### Scenario: A metric emits at most two exemplars, ranked

- **WHEN** a metric has more qualifying instants than the per-metric budget
- **THEN** it emits exactly two, and they are the two highest-`quality` qualifying instants

#### Scenario: A metric with no qualifying instant omits the field

- **WHEN** every candidate instant for a metric fails the quality gate
- **THEN** that metric's result carries no `exemplars` field at all, rather than an empty or
  low-quality one, and every other field of its result is unchanged

#### Scenario: Exemplars never move a number

- **WHEN** a metric is computed over any frame sequence, with and without exemplar emission
- **THEN** its `value`, `confidence`, `viewFit`, `interpolatedFraction`, `frameCoverage`,
  `sampleSize`, and `caveat` are identical

#### Scenario: A single-instant exemplar is expressible without a null second instant

- **WHEN** a metric's evidence exists only at one moment (a footstrike), so no honest second instant
  exists
- **THEN** the exemplar carries no `pairedTimestamp` at all, rather than a null one that would read
  as a missing half of a pair

### Requirement: Exemplar instants are ranked and gated by a per-instance quality score

The system SHALL compute, for each candidate exemplar instant, a `quality` score in `[0, 1]` built
**only** from signals already present in the pipeline: whether the metric's own input points at that
instant resolved as `'detected'` rather than `'interpolated'`, and how far that instant's own
measured value sits from the metric's own median. It SHALL NOT be built from `RobustKeypoint.score`:
an interpolated keypoint carries a lerp of its neighbours' scores and reads misleadingly confident,
which is why the robustness layer's contract directs consumers to gate on `status` rather than
`score`.

The distance-from-median term SHALL be **role-dependent**. For an exemplar whose purpose is to show
what the reported number looks like, closeness to the median SHALL raise the score. For an exemplar
whose purpose is to show one end of the range the metric measured, distance from the median SHALL
raise the score instead — because for such a metric the extreme instant *is* the evidence, and
penalising it would gate out exactly the instant the exemplar exists to show. Where there is no
distribution to judge against — a degenerate spread, or too few instances — the term SHALL fall back
to a neutral value rather than assert a confidence the data cannot support.

An instant SHALL be rejected outright, without a score, when: no keypoint defining its crop region
resolves at that frame, leaving no position to crop around — a partly-resolvable region SHALL NOT be
rejected, since the crop is derived from the resolvable subset; or, for a range-showing exemplar, its value lies beyond a
robust outlier bound about the median — so that a tracking glitch can never be selected as an
extreme; or the metric's own per-instance degenerate fallback fired at that instant; or the instant
does not resolve to a sampled frame within a snapping tolerance derived from the clip's own sampling
interval.

Surviving instants SHALL be kept only above a single shared minimum-quality threshold. That
threshold is a judgment call rather than a derived constant, and is single-sourced so that
per-metric drift is impossible.

#### Scenario: An interpolated instant ranks below an equivalent detected one

- **WHEN** two candidate instants have equal distance from the metric's median, but one resolved its
  input points as `'detected'` and the other as `'interpolated'`
- **THEN** the detected instant scores higher and is preferred

#### Scenario: A range-showing exemplar prefers the extreme, not the typical

- **WHEN** a metric whose exemplar depicts the two ends of a measured range ranks its candidates
- **THEN** an instant far from the median scores **higher** than one near it, the inverse of the
  ranking a value-representative exemplar uses

#### Scenario: An outlier is rejected rather than selected as the extreme

- **WHEN** the single most extreme instant for a range-showing metric lies beyond the robust outlier
  bound about the median
- **THEN** it is rejected outright and the most extreme *surviving* instant is used instead

#### Scenario: A degenerate per-instance fallback disqualifies an instant

- **WHEN** a metric's per-instance computation fell back to an invented value at some instant (for
  example a step-width strike whose outward polarity could not be determined and defaulted)
- **THEN** that instant is never ranked and never emitted, regardless of what its score would have
  been

#### Scenario: Too few instances leaves the ranking neutral rather than confident

- **WHEN** a metric has too few candidate instants, or a degenerate spread, for a median-relative
  term to mean anything
- **THEN** the score falls back to a neutral value rather than treating an arbitrary instant as
  highly typical or highly extreme

### Requirement: The spectral sinusoid fit exposes its phase and time origin

`fitSpectralSinusoid` SHALL report, on a successful fit, the fitted sinusoid's phase and the time
origin the fit was centred on, in addition to the amplitude, frequency and quality figures it
reports today. Together with the winning frequency these SHALL be sufficient for a consumer to
compute the fitted waveform's maxima and minima in clip time, without re-fitting and without access
to the fit's internal coefficients.

Consumers SHALL derive bounce instants **from the fitted phase**, never by scanning the raw signal
for its largest and smallest samples. The fit deliberately removes a quadratic trend, and the raw
extremes are the jittery quantity the spectral estimator replaced — a scanned extreme would name an
instant that contradicts the amplitude the same metric reports.

A derived instant SHALL be snapped to an actual sampled frame before it is emitted, and SHALL be
rejected when no sampled frame lies within the snapping tolerance: the fitted waveform is continuous
and the clip is not.

Because more than one metric reads this primitive, exposing these fields SHALL NOT change
`peakToPeakAmplitude`, the winning frequency, either R² figure, the second-peak ratio, the sample
count, the span, or the observed-cycle count for any input.

#### Scenario: Bounce peak and trough are derivable from the reported fit

- **WHEN** a fit succeeds
- **THEN** its reported frequency, phase and time origin are together sufficient to compute the
  instants of the fitted waveform's maxima and minima in clip time

#### Scenario: Every existing fit output is unchanged

- **WHEN** the same input is fitted before and after this addition
- **THEN** the amplitude, frequency, both R² figures, the second-peak ratio, sample count, span, and
  observed cycles are all identical

#### Scenario: A derived instant with no nearby sampled frame is rejected

- **WHEN** a phase-derived peak or trough falls in a gap where the clip has no sampled frame within
  the snapping tolerance
- **THEN** that instant, and any pair depending on it, is not emitted

#### Scenario: The direction of a bounce instant follows the fitted series' own sign convention

- **WHEN** two bounce fits are computed over series with opposite vertical sign conventions — one
  over downward-positive image coordinates, one over upward-positive integrated displacement
- **THEN** each fit's instants are labelled by what the runner's body actually did (highest point,
  lowest point) rather than by whether the fitted waveform was at a maximum or a minimum

### Requirement: Cadence reports no exemplar instants

The cadence metric SHALL NOT emit exemplars, and SHALL NOT borrow another metric's.

A cadence is a rate — a property of a sequence, not of any pair of instants. Two stills of a bounce
peak and trough depict the bounce's *amplitude*, which is what the vertical-oscillation metric
reports and what cadence does not; presenting the same imagery under the cadence readout would
assert an explanation that is not true of that number. Footstrike instants are equally unavailable as
a substitute, on a factual rather than an aesthetic basis: cadence is derived from the hip-bounce
spectral fit and does not read footstrikes at all, so footstrike frames did not produce its value.

Cadence therefore falls back to the same text-only presentation it has today, which is a supported
state for any metric with no qualifying instant.

#### Scenario: Cadence emits nothing even when its underlying fit succeeds

- **WHEN** cadence reports a non-null value from a high-quality hip-bounce fit — a fit from which
  bounce instants are perfectly derivable
- **THEN** the cadence result carries no `exemplars` field
