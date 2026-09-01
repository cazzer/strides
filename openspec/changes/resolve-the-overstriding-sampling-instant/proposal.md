# Resolve the overstriding sampling instant

**Outcome: FALLBACK.** The forward-reach extremum estimator's accuracy, direction and stability
gates (G1/G1b/G2/G5) all passed convincingly — in one case landing on the EXACT same frame as an
independently-derived ground truth. It failed the pre-registered materiality gate (G6): across the
three-clip probed corpus it could resolve an interior extremum on only 34.6% of the otherwise-usable
strike population, below the 50% floor, because a majority of real footage in this corpus lacks
either a known travel direction (`estimateTravelDirection` returns `0` on Demo 2 entirely) or a
trustworthy fitted step period (both background-scale-pass runs fall below `cadenceMinFitR2`). What
shipped instead is the disclosure-only fallback: an unconditional, magnitude-free caveat on
`overstriding`, with no change to any computed value on any clip. Full gate table:
`design.md` D6.

## Why

`strides-pr1` (P1, successor to the closed `strides-24s`): `overstriding` under-reports by roughly
2x because it samples the ankle-to-hip offset at `detectFootstrikes`' emitted instant, which on
Demo 1 lands 0.10-0.12s AFTER keyframe-confirmed touchdown. The hip travels ~1800 px/s while the
planted foot is stationary, so that lag removes ~0.52 torso lengths from the measured offset —
larger than the 0.326 torso lengths the card currently reports. `strides-24s`'s spike pre-registered
three correction strategies (a duty-factor closed form, an ankle-x-stationarity detector, a fitted
constant offset) and measured all three failing or prohibited; that spike is closed on its own
criterion and did not fix the underlying problem.

This change tries a fourth strategy the prior spike did not evaluate: instead of correcting the
*timing* of the detected instant, sample the metric's own signal (forward ankle-to-hip reach) at
its own local extremum in a bounded backward-looking window, rather than at the detected instant
itself. Two pre-registered outcome branches, gated mechanically against measured evidence:

- **SHIP**: the forward-reach extremum estimator, if it demonstrably reduces error against
  keyframe-confirmed ground truth without degrading containment, consistency, or materiality gates.
- **FALLBACK**: an unconditional caveat disclosing the sampled-instant/touchdown gap, wording the
  lower-bound direction, with no change to any computed value — if any gate fails.

Both branches satisfy the acceptance criterion in `strides-pr1`: the card stops implying a
precision (a single deterministic touchdown geometry) that today's sampling instant does not have.

## What Was Measured (both branches were built to find out which would ship)

- A forward-reach extremum search (`src/heuristics/overstrideReach.experimental.ts`, measured then
  reverted — see design.md's file-by-file section) that re-samples each surviving footstrike
  candidate at the interior local maximum of signed forward ankle-to-hip reach within a bounded
  backward window (`W = 0.5` step periods), falling back to the detected instant whenever no
  interior extremum exists (monotone window, unknown travel direction, no trustworthy step period,
  or the scan is truncated by a gap/interpolated frame/window edge/series edge before an interior
  reversal is found). Its own accuracy/direction/stability gates all passed — see design.md D5/D6 —
  but it failed the pre-registered materiality gate (G6) and was not shipped.
- A candidate `resolveTrustworthyStepPeriodSeconds(frames, config)` export on `footstrikes.ts`,
  used only by the measurement probe and the (unshipped) search; reverted along with it.

## What Changes (what actually shipped: FALLBACK)

- Add an unconditional, non-numeric caveat to `overstriding`'s result (present on every result that
  has a non-null value, including the cleanest/highest-confidence one) disclosing the
  sampling-instant limitation and its LOWER-BOUND direction — modelled on `footStrikePattern`'s
  existing unconditional proxy caveat. No numeric field (`value`, `confidence`, `sampleSize`,
  `frameCoverage`, `interpolatedFraction`, `viewFit`) changes on any clip — verified bit-identical
  before/after (design.md T5).
- Update `MetricsPanel.tsx`'s overstriding card description copy to match.
- No change to `detectFootstrikes`, `footStrikePattern`, `stepWidth`, `stepWidthCm`,
  `verticalRatio`, `MIN_OVERSTRIDE_SAMPLE_SIZE`, or `EVIDENCE_MAX_PAIR_CROP_GROWTH`.

## Impact

- Affected capability: `form-heuristics` (spec delta, one ADDED requirement — see D4/D7 of
  design.md for why no existing requirement is modified).
- Affected code: `src/heuristics/overstriding.ts` (caveat constant only), `src/results/MetricsPanel.tsx`
  (copy only). `footstrikes.ts` is untouched in the shipped state.
- Affected tests: `src/heuristics/overstriding.test.ts` only.
- No change to any other metric's computed value. No change to `MIN_OVERSTRIDE_SAMPLE_SIZE`,
  `EVIDENCE_MAX_PAIR_CROP_GROWTH`, or the collapsed-ankle-pair requirement's existing scope.
