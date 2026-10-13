## ADDED Requirements

### Requirement: A slow feasibility answer still picks the sampler for a run that has not started

The system SHALL bound how long a clip's automatic analysis start waits for its sequential-decode
feasibility answer, so that a check that never settles cannot stall the run, and SHALL treat the
bound's fallback — sampling on the `<video>`-playback path — as a stand-in only. If the real answer
arrives before any primary run of that clip has picked its sampler, the real answer SHALL replace the
stand-in, and that clip's runs SHALL sample on the path the answer names. Once a run has picked its
sampler, a later answer SHALL NOT change it. This exists because the check reads the whole clip into
memory, and on a contended device that read can take far longer than the bound while the clip is
still queued behind another clip's analysis and needs no answer yet: measured on a phone, a queued
clip's answer took 13 s against a 3 s bound, and the stand-in made that clip sample 153 frames on the
playback path where the sequential path samples all 345.

#### Scenario: A queued clip's slow answer replaces the stand-in

- **WHEN** a clip has no detector yet because it is queued behind another clip, its feasibility
  check outlasts the bound, and the check then answers that the clip can be sampled sequentially
- **THEN** the clip's sampling path reads playback after the bound and sequential after the answer,
  and once the clip receives the detector its run samples on the sequential path

#### Scenario: A run that started on the stand-in keeps its sampler

- **WHEN** a clip's run has already started on the playback path because its feasibility check
  outlasted the bound, and the check then answers that the clip can be sampled sequentially
- **THEN** the running run keeps sampling on the playback path, and the clip's sampling path still
  reads playback
