# Why MediaPipe's ankles read 4.8x too wide on a front-approach clip

## Why

`strides-boc`. On `park-approach.mp4` — a dead-on front approach — MediaPipe reports a sagittal
excursion ratio of 1.5911 where MoveNet reports 0.3284. MediaPipe's FRONT-view value exceeds its own
SIDE-view value (1.4147), which is anatomically impossible. Because the background scale pass is
MediaPipe, that wrong opinion pushes the clip's view label to `ambiguous` and tier-3 excludes
`stepWidthCm` on the one clip it is designed for.

The ticket carried one unproven hypothesis (out-of-frame extrapolation) and asked for the fault to be
characterised against keyframes.

## What Changes

- **No code change.** Diagnosis and a remediation sketch only; the remedy is the user's call.
- The root cause is identified as **two stacked, separable defects**, each measured.
- **One inference this repo had recorded as fact is retracted** — CLAUDE.md's "BSR and SER share a
  denominator, so the entire 4.8x is in the numerator" is a non sequitur. It happens to survive
  measurement, but the reasoning did not license it and is corrected.
- Three hypotheses are refuted with evidence, so they are not re-derived.
- A defect in SHARED, backend-agnostic code is surfaced: `viewDetection.ts` discards the
  `interpolated` status flag that `stepWidth.ts` honours.

## Impact

- `CLAUDE.md` only. No `src/` change, no spec delta.
- Directly informs `strides-wac`, which is blocked on this bead.
