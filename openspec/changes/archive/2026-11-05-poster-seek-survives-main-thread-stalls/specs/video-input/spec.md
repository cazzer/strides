## ADDED Requirements

### Requirement: A poster seek is not failed by a busy main thread

The bounded wait on a poster's seek SHALL count against its budget only the time the page's event
loop was able to run, so a seek that lands while the main thread is blocked — as it is during the
first pose inference on a phone, for several seconds at a time — still produces a poster. The wait
SHALL remain bounded both ways: a seek that never lands on a responsive page SHALL still time out
after the same budget, and a fixed wall-clock ceiling SHALL end the wait even if the page never frees
up, so the shared decoder is always released.

This SHALL apply to the poster only. Evidence extraction's seeks SHALL keep their existing timeout
behaviour, and no metric value, exemplar, crop, or evidence image SHALL change.

#### Scenario: A seek that lands during a long main-thread stall yields a poster

- **WHEN** a poster's seek completes while the main thread is blocked for longer than the whole seek
  budget, and the completion is delivered once the main thread frees up
- **THEN** the poster is derived from that seek rather than abandoned as timed out

#### Scenario: A seek that never lands still times out on a responsive page

- **WHEN** a poster's seek never completes and the main thread stays responsive
- **THEN** the wait ends as timed out after the seek budget, and the poster moves on to its next
  candidate instant or yields no poster

#### Scenario: A page that never frees up still releases the decoder

- **WHEN** the main thread is blocked for most of the wait, repeatedly, and the seek never completes
- **THEN** the wait ends as timed out at the wall-clock ceiling
