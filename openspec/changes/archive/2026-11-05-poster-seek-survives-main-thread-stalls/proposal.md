## Why

On a phone (Galaxy S21) the clip poster failed on 5 of 6 clips (`strides-p1qt.19`). The poster's seek
runs during sampling, and the first pose inference blocks the main thread for 4.7–7.2 s. A probe
showed the seek actually completed during that block (`seeking` false, `readyState` 4), but the 2 s
wall-clock timeout's task ran before the `seeked` task, which arrived 80–280 ms later. The timeout
counted a busy main thread as a failed seek.

## What Changes

- The poster's seek wait counts its budget only while the event loop is running: it samples every
  100 ms and credits each sample at most 200 ms, so a stalled main thread does not use the budget up.
  A 30 s wall-clock ceiling still ends the wait.
- `seekTo` (evidence extraction's seek) is unchanged: its seeks run after analysis and keep their
  exact timing.

## Impact

- `src/video/videoElement.ts` (new `seekToThroughStalls`), `src/video/posterFrame.ts` (uses it).
- No metric, evidence, or sampling behaviour changes; the poster is not a biometric input.
