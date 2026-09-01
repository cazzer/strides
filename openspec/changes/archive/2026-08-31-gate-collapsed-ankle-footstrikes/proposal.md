# Gate a footstrike whose two ankles have collapsed onto one point

## Why

`strides-1mt` (P1, user-reported). The Overstriding card's evidence shows a trailing swing leg
rather than a footstrike. Measured on Demo 1's primary pass, two of four strikes sit on frames where
both ankle LABELS have latched onto one foot — 3 px and 13 px apart horizontally, 23 px and 41 px
vertically, against ~480 px and ~360 px on the two healthy frames. At t = 6.16 the reported ratio is
**−0.7215**: the foot landing 72% of a torso length BEHIND the hip, which is not something a
footstrike can do.

The reported value is currently **correct by accident**. With `n = 4` the median averages the middle
two, and the two collapsed strikes happen to be the min and the max, so they are discarded:
`(0.2936 + 0.3579) / 2 = 0.32574`, which matches the shipped number exactly. One fewer healthy
strike and it moves. Meanwhile confidence reads 0.875 — "High confidence" on the card — on a sample
half of which is degenerate.

`detectFromBouncePhase` predicts one instant per fitted bounce cycle and snaps it to a frame. It
never checks that the pose at that instant looks like a contact. That is the gap.

## What Changes

- `FootstrikeCandidate` gains **`ankleMeasurable: boolean`**, set from the VERTICAL ankle separation
  against a new `HeuristicsConfig.footstrikeMinAnkleSeparationRatio` (0.20 of torso length).
- Annotated, **not dropped**. Dropping is a measured regression: it takes Demo 1 from two same-side
  stride pairs to none and nulls `verticalRatio`.
- **Scoped to the phase path.** The ankle-difference detector selects on ALTERNATION CONTRAST, and
  a label collapse destroys alternation — so the failure is suppressed there by the selection
  itself. (It does NOT enforce a separation floor: prominence bounds a peak's rise above its
  neighbouring trough, not its value, and its constant is 4x smaller.)
- **Known coverage gap, stated up front.** The background MediaPipe scale pass runs the fallback
  path on Demo 2 and the multi-person clip, so **`stepWidthCm` — on the clip it is designed for —
  gets no protection from this gate at all.**
- `overstriding`, `footStrikePattern`, `stepWidth` and `stepWidthCm` skip an unmeasurable strike;
  `strideLength` deliberately does not.
- A gated strike stays in the coverage denominator, and the thin-sample caveat now distinguishes
  USABLE strikes from DETECTED ones, so it stops describing a detection failure that did not occur.
- `MIN_OVERSTRIDE_SAMPLE_SIZE` stays 4 on the gait-cycle basis, with its false "one noisy detection"
  claim deleted. The derived `n >= 2k + 3` bound says 5 and is honestly recorded as saying so —
  `strides-boc` survives this change, so `k = 1`, not 0. Sweep filed as `strides-dbh`.

## Impact

- `src/heuristics/`: `types.ts`, `footstrikes.ts`, `overstriding.ts`, `footStrikePattern.ts`,
  `stepWidth.ts`, `stepWidthCm.ts` (+ a comment in `strideLength.ts`).
- Demo 1 `overstriding`: value bit-identical, `sampleSize` 4 → 2, `confidence` 0.875 → 0.25.
- Demo 2 primary: `stepWidth` / `stepWidthCm` / `footStrikePattern` lose one strike of five.
- `verticalRatio`, `cadence`, sampling, person selection and view are untouched everywhere.
