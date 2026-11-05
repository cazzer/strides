## Context

The poster is derived on a detached `<video>` while the primary sampler runs (`useClipPoster`), on
the shared one-decoder queue. Measured on the S21 at `25bea2a1` with a dev-only probe:

| clip | resolved after | longest gap between 50 ms ticks | `seeking` at timeout | `seeked` arrived |
|---|---|---|---|---|
| IMG_9345 | 7637 ms (`timed-out`) | 7216 ms | false | 7716 ms |
| IMG_9347 | 4809 ms (`timed-out`) | 4676 ms | false | 5092 ms |

## Decisions

- **Budget counted per tick, capped per tick** (100 ms sampling, ≤200 ms credit per sample) rather
  than raising `SEEK_TIMEOUT_MS`. A larger global timeout would still lose to a longer stall on a
  slower phone, and would lengthen evidence extraction's failure path for nothing.
- **A separate function, not a mode of `seekTo`.** Evidence seeks run after `'ready'`, and their
  timing and every evidence field must stay identical.
- **30 s wall-clock ceiling**, about 4× the longest stall measured, so a page that never frees up
  still releases the shared decoder.
- A seek that never lands on a responsive page still times out after the same 2 s, so the poster's
  fallback-candidate behaviour is unchanged.

## Risks

- The detached 4K element can stay open somewhat longer (until `seeked` instead of being torn down
  on the false timeout). Checked on the phone: time to "Analysis complete" must not lengthen.
