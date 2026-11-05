## ADDED Requirements

### Requirement: The outline segmenter refuses a GPU graph that does not link

The outline segmenter SHALL count WebGL program link failures while its GPU-delegate graph is
built, and on each segmentation until one has returned a pose. A pose means the landmark model has
run, and MediaPipe links some kernels only at that point. A failure during the build SHALL make
creation fail. A failure during a segmentation SHALL discard that segmentation, and that call and
every later one SHALL fail as unavailable. In either case the outline pass SHALL end failed with the
unavailable caveat, reporting nothing it measured. Where every program links, the segmenter SHALL
segment exactly as before.

#### Scenario: Every GPU program links
- **WHEN** the GPU graph is built and returns its first pose with no program link failure
- **THEN** the segmenter stops watching and its masks are unchanged

#### Scenario: A GPU program fails to link at graph build
- **WHEN** at least one program fails to link while the GPU graph is built
- **THEN** segmenter creation fails and the outline pass ends failed with the unavailable caveat

#### Scenario: A GPU program fails to link on first inference
- **WHEN** a program fails to link during a segmentation before any pose has been returned
- **THEN** that segmentation is discarded, no further segmentation runs, and the outline pass ends failed with the unavailable caveat and no outline reading
