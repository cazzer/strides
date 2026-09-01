# Demote a far-apart pair when one of its instants still says something true

## Why

`strides-ddj`. Demo 1's Overstriding card renders no evidence image at all. The user asked for the
opposite outcome directly: *"even if we have one good piece of evidence I'd like to show it."*

The cause is measured and not in dispute. `strides-1mt` gated two collapsed-pose strikes out of
Demo 1's overstriding sample; two strikes survive (t = 4.84 and t = 5.52), so there is exactly ONE
possible pair and `alternates: 0`. Those two strikes are one step apart on a 4K side view — about
1180 px of subject translation against a tight hip-to-ankle box — so their union crop demands
**2.881×** the crop the better-framed instant needs alone, against
`EVIDENCE_MAX_PAIR_CROP_GROWTH = 2.5`. `isTooFarApartPair` therefore drops the pair WHOLE, and the
card falls to `no-evidence` / `all-gated-out`.

Both obvious escapes are refused, and stay refused: raising the constant is not marginal (2.881 is
15% past it, and admitting it re-admits `trunkLean`'s 6.1–6.8 pairs on the same clip), and this
change does not touch the criterion or its calibration.

What is actually wrong is one level up. The far-apart guard drops for EVERY kind because "every
paired label this repo emits is a statement about two instants… none of them survives losing half
the pair" — but that reason is false for exactly the kinds the collapse rules already demote, and
it is false for two more. `computeOverstriding` returns the median of per-strike ratios, each
measured at ONE strike; `computeTrunkLean` returns a median of per-frame angles. Neither number is
a difference between two instants, and the repo already says so elsewhere: `measuredAtInstant`
records `overstrideRange` and `trunkLeanRange` as measured at BOTH instants, and both mark builders
are pure per-instant builders.

## What Changes

- **`SINGLE_INSTANT_KINDS` gains `overstrideRange` and `trunkLeanRange`.** Same correction
  `strides-r41` made for `kneeFlexionPeak`, on the same principle and for two more kinds. The
  kind's NAME describes how the exemplar was BUILT (two ends of a spread), not what the card
  REPORTS.
- **The far-apart branch consults that classification** instead of dropping unconditionally. A
  far-apart pair of a single-instant kind is demoted to its base; a far-apart cycle or stride pair
  is dropped exactly as before.
- **Demotion becomes the fallback walk's LAST RESORT.** `planExemplarWithFallback` returns the
  first candidate that renders AS A PAIR, and a remembered demoted plan only if none does — so
  Demo 1's `trunkLean`, whose winner demands 6.1–6.8 and whose alternate draws at 1.866, keeps
  drawing the alternate rather than demoting the winner.
- **The demotion reason travels.** `demotedFromPair: boolean` becomes
  `demotion: 'collapsed-pair' | 'far-apart-pair' | null`, because today's caption ("the paired
  instant was too similar to tell apart") is a FALSE sentence under a far-apart demotion. A
  `Record<EvidenceDemotion, string>` makes the type system refuse a reason with no sentence.
- **A paired exemplar's label names its base first** (`strides-8i4`, folded in because it is
  load-bearing here). `overstriding` and `trunkLean` hardcode a label naming the HIGH end, while
  `selectExtremePairs` picks whichever end is further from the median. With n = 2 survivors that
  choice comes down to a single ULP of `fl((a+b)/2)`, so on the very clip this change exists to fix
  the base could be either end. `ExtremePair` gains `baseIsHigh` — read off the comparison it
  already performs — and both metrics pick their label from it.

## Impact

- `src/results/evidenceFrames.ts`, `evidenceCaptions.ts`; `src/heuristics/exemplars.ts`,
  `overstriding.ts`, `trunkLean.ts`.
- **A `[evidence-coverage]` contract break, recorded rather than hidden**: the per-exemplar
  `demotedFromPair` boolean is renamed to `demotion` and changes type. `scripts/ab-person-selection.mjs`
  needs no change, but an old `before.txt` diffs against a new `after.txt` with one deleted and one
  added row per exemplar. CLAUDE.md's contract paragraph is updated.
- No metric value, confidence, caliper, footstrike gate, ranking or crop-union rule changes.
  `EVIDENCE_MAX_PAIR_CROP_GROWTH` is untouched at 2.5.
