# Why the two passes' stepWidth differs 1.79x on Demo 2

## Why

`strides-87x`, which blocks `strides-wac`. On Demo 2 the primary (MoveNet) reports `stepWidth`
0.2253 and the background scale pass (MediaPipe) reports 0.4042. `strides-boc` diagnosed the 4.8x
SER gap fully but explicitly did **not** explain this one, and said so: SER is an
outlier-amplifying p95-p5 range while `stepWidth` is a median, and cross-backend median ankle
distance is only ~20 px, so a concentrated clip-opening outlier cluster should not move a median.

## What Changes

- **No code change.** Diagnosis, plus the trustworthiness judgement `strides-wac` was waiting on.
- The gap is explained, and **the bead's own framing turns out to be the error**: a median over
  **five** samples is not outlier-robust.
- The denominator hypothesis is refuted by measurement.
- A judgement is recorded: **`stepWidthCm`'s value on Demo 2 is NOT trustworthy**, so `strides-wac`
  must not simply render it.

## Impact

- `CLAUDE.md` only. No `src/` change, no spec delta.
