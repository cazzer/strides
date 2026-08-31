# Derive footstrike timing from the fitted hip-bounce phase

## Why

`detect-footstrike-contact-onsets` (bead `strides-da8`) closed as a **partial** fix, deliberately.
It got the footstrike COUNT and RHYTHM right — 9 spurious instants down to 4, correct alternation,
same-side spacings of 1.16 s and 1.56 s against Demo 1's expected 1.316 s stride — and it proved,
with a measurement rather than an argument, that it could not get the PHASE right **with the signal
it reads**.

The detector selects each side's largest maximum of `d_S = y_S − y_opposite`. That quantity is
maximal when the two ankles are furthest apart vertically. With side S planted, S contributes a
constant (a foot on the ground does not move), so the maximum is decided entirely by the OTHER
ankle — it lands at the **contralateral foot's swing apex**. That is a real, well-defined gait
event. It is not touchdown, and it is not a fixed distance from touchdown.

Sweeping the unit fixture's swing-apex phase and reading the emitted lag back out shows the two
tracking one for one (`footstrikes.test.ts`, pinned executably by da8):

| fixture `apex` | contralateral apex after touchdown | emitted lag |
|---|---|---|
| 0.55 | 1.5 frames | **1** |
| 0.60 | 3.0 | **3** |
| 0.65 | 4.5 | **5** |
| 0.69 | 5.7 | **6** ← Demo 1's measured +0.24 s at 25 fps |
| 0.75 | 7.5 | **11** |

**No constant offset can correct this.** The range spans 0.04–0.44 s, wider than a whole stance
phase — Demo 1's own stances are 0.36 s and 0.44 s. An offset fitted to one runner is wrong for any
runner who swings differently. That is a reason there is no constant, not a reason to pick a better
one. Every constant-free alternative *on the same signal* marks a different wrong event, and all
were enumerated and rejected in da8's design D15.2 (`argmax d'` = fastest separation, early by the
foot's deceleration time; `d`'s zero crossing = the legs crossing, i.e. midstance; band walk-back
and ZUPT, both of which need a constant, and ZUPT's plateau is only ~2.5× either side — the same
factor-of-two shape this repo already rejected in `derive-area-floor-from-4k-measurement`).

The cost is not cosmetic. Demo 1's emitted instants sit **55–67% through stance**. During stance the
planted foot is fixed in the image while the hip advances, so `overstriding`'s per-instant ratio
falls at the runner's own speed — ~3.7 torso lengths per second on that clip. A 0.30 s within-trial
phase scatter therefore moves the ratio by of order a whole torso length, several times the entire
reported range, which is why `overstriding`'s and `footStrikePattern`'s Demo 1 spread **widened** to
73% / 78% while their confidence rose to 1.000.

## What Changes

- **Timing comes from the fitted hip-bounce phase.** Vertical acceleration is −g in flight and net
  upward in stance, so the sign flips exactly at touchdown and at toe-off: the **inflections of the
  vertical trajectory are the contact events**. For the fitted sinusoid those sit a quarter cycle
  either side of each extremum, so touchdown is `quarter period before each fitted low point`, one
  per bounce cycle — which is one per step, the correct rate. `spectralFit` already exposes
  `phaseRadians` and `tMeanSeconds` for exactly this purpose, and an existing requirement already
  governs deriving instants from them.
- **Sides still come from the ankles, but as one decision for the clip rather than one per
  instant.** A stride is two steps, one per foot, so consecutive touchdowns alternate; the instants
  are one step apart by construction, so the only free bit is which parity is which foot. It is
  decided by summing the ankle difference across every instant, signed by cycle parity and weighted
  by magnitude — since two ankles at the same height say nothing about which is planted. Reading it
  per instant was tried and measured failing on side-view footage, where the legs cross and the
  detector swaps their labels.
- **The ankle-difference detector is retained verbatim as the FALLBACK**, used whenever the hip fit
  does not clear the bar (or yields no attributable instant). This is what bounds the coupling risk:
  a clip whose hip fit is unusable gets **exactly today's behaviour**, not a null. Nothing that
  reports a value today can stop reporting one because of this change.
- **No new constant and no new config key.** The quarter period is the sinusoid's own geometry. The
  quality bar is `cadenceMinFitR2`, the identical key `detectFootstrikes` already reads for its
  rhythm-derived spacing floor and the identical bar cadence itself clears before publishing a
  number. `footstrikeMinProminenceRatio`, `footstrikeMinIntervalSeconds` and
  `STRIDE_PERIOD_TOLERANCE` are untouched and stay in force on the fallback path.
- **A shared test fixture is corrected.** `generateSyntheticGait` places the body's **highest**
  point at touchdown and its lowest a quarter-step **before** it — the bounce is a half period out
  of phase with the fixture's own footstrike definition, which is physically impossible (the body is
  lowest at midstance). No metric could observe this before, because none read the two signals'
  relative phase; this change does. Corrected by a half-period shift, which leaves the bounce's
  amplitude, frequency and every hand-computed expectation that reads them unchanged by
  construction.

## Impact

- Affected specs: `form-heuristics`
- Affected code: `src/heuristics/footstrikes.ts`, `src/heuristics/footstrikes.test.ts`,
  `src/heuristics/__fixtures__/syntheticGait.ts` (bounce phase correction), and the tests of the
  five consumers whose instants move. `stridePeriod.ts` is unchanged — its band and its lower edge
  remain exactly what the fallback path needs.
- **Consumers of `detectFootstrikes`, verified by search rather than assumed** — `overstriding`,
  `footStrikePattern`, `stepWidth`, `stepWidthCm`, `strideLength` (and `verticalRatio` transitively,
  through `strideLength`). None needs an API change; all five read geometry at a candidate's
  `frameIndex`, and only *which* frame that is moves.
- **The architecture inverts, and the inversion is bounded by the fallback.** `strideLength` already
  reads the hip fit (its period gate takes `stepFrequencyHz` and degrades gracefully to no gate when
  it is absent), so a footstrike-consuming metric reading the hip fit is a precedent here, not a new
  category of coupling.
- **Measured live**, real GPU, `scripts/ab-person-selection.mjs`, both arms the same tree with only
  `footstrikes.ts` swapped. Fresh process, 3 trials, every field identical across trials:

  | clip | metric | before | after |
  |---|---|---|---|
  | Demo 1 | `overstriding` | 0.29735 @ conf 1.000 | **0.325743 @ 0.875** |
  | Demo 1 | `footStrikePattern` | −0.0251745 @ 1.000 | **0.00108462 @ 0.875** |
  | Demo 1 | `verticalRatio` | 0.0353716 @ 0.239737 | **0.0310419 @ 0.479473** |
  | Demo 2 | `stepWidth` (its own metric, tier 1) | 0.140625 @ 1.000 | **0.225311 @ 1.000** |
  | multiperson | `overstriding` | 0.211673 @ 1.000 | **0.499656 @ 0.800** |
  | multiperson | `footStrikePattern` | −0.218509 @ 1.000 | **0.111699 @ 0.800** |

  Everything else is bit-identical on all three clips, `cadence` and the whole vertical-oscillation
  family included. **No metric changed tier and none went to `null`** — the fallback's whole
  purpose. The confidence drops from a falsely-perfect 1.000 are the interpolation penalty landing
  honestly: the phase path places instants where the rhythm says a foot landed rather than
  preferentially on well-tracked frames.
- **The dispersion that motivated the ticket collapses.** Under the reused-browser regime the 73% /
  78% figures were measured in, 5 trials: `overstriding` **73.0% → 1.15%** of median, and
  `footStrikePattern`'s absolute spread **0.0914 → 0.0068**. The underlying cold/warm split is
  untouched — what stops is these two metrics *amplifying* one flipped detection into a 73% swing.
- **Demo 1's recorded ground truth is wrong and is corrected here.** Keyframes at 0.04 s intervals
  put the contacts at ffmpeg `4.00 / 4.66 / 5.32 / 5.98`, not da8's `3.90 / 4.60 / 5.16 / 5.84` —
  1.5 to 4 frames early, and irregularly spaced where the corrected set is a uniform 0.66 s against
  a fitted 0.658 s step. da8's falsifiable prediction was computed against the wrong numbers and is
  **falsified**; see `design.md` D12.1.
- Regression anchor holds: Demo 1 `verticalOscillationCm` = `4.421467928439415` with
  `fit.frequencyHz × 60` = 91.2 = `cadence.value`, on every trial of both arms.
