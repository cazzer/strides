# Rank exemplar candidates by quality

## Why

`buildExemplars` in `src/heuristics/trunkLean.ts` and `src/heuristics/overstriding.ts` picks the two
ends of its range exemplar by taking the raw argmax and argmin of the metric's own per-instance
**value** among outlier-bound survivors, and only *then* scores that already-chosen pair with
`scoreExemplarInstant`. There is no fallback to the next-most-extreme candidate. One badly-tracked
frame at the value extreme therefore zeroes the whole metric's evidence: `pairQuality` takes the
minimum, so a single end scoring 0 takes the pair to 0 and `selectExemplars` drops it.

This contradicts the spec the code already lives under. "Exemplar instants are ranked and gated by a
per-instance quality score" mandates ranking, and its scenario *An interpolated instant ranks below an
equivalent detected one* says the detected instant "scores higher and is preferred". The current code
prefers a fully interpolated argmax over every detected candidate, because ranking never happens —
scoring is applied to a decision that was already made.

Measured on Demo 1 (side-view track clip, GitHub #70 finding 2): `trunkLean`'s most-forward surviving
instant is t = 4.28 s at 2.355 MADs, typicality ramp 0.785 — but all four torso seed keypoints there
are interpolated, so `detectionFactor` is 0, the instant scores 0 × 0.785 = 0, and the metric emits no
evidence at all. Eighteen other instants on that same clip clear 1.5 MAD, several of them detected.
The same clip under `{sequentialSampling: {enabled: false}}` samples a different frame set, the argmax
lands on a well-tracked frame, and `trunkLean` emits at quality 0.664. Coverage hinging on which frame
happened to be sampled at the value extreme is the defect.

## What changes

- Both `buildExemplars` implementations rank every surviving candidate by the quality score it would
  actually receive, and take the best-scoring candidate at each end of the range, instead of taking
  the value extremes and scoring them afterwards.
- The range constraint is preserved explicitly: one end is drawn from the candidates at or above the
  metric's median and the other from those at or below it, so ranking can never collapse both halves
  onto the same side and stop the ghost depicting a range.
- The ranking lives in **one** shared helper next to `scoreExemplarInstant`/`pairQuality`
  (`selectExtremePair` in `src/heuristics/exemplars.ts`), not copied into two modules — the same
  single-sourcing argument `MIN_EXEMPLAR_QUALITY` is already held to.
- `form-heuristics` gains a clarifying requirement stating the selection order, and stating that
  uniform tracking quality still selects the value extremes — so the existing outlier scenario, which
  says the most extreme *surviving* instant is used, remains exactly true.

## Impact

- `src/heuristics/exemplars.ts` — new shared `selectExtremePair`.
- `src/heuristics/trunkLean.ts`, `src/heuristics/overstriding.ts` — each `buildExemplars` calls it.
- `src/heuristics/exemplars.test.ts`, `src/heuristics/trunkLean.test.ts`,
  `src/heuristics/overstriding.test.ts` — coverage for the ranking.
- `openspec/specs/form-heuristics/spec.md` — via this change's delta.

No metric `value`, `confidence`, `viewFit`, `interpolatedFraction`, `frameCoverage`, `sampleSize` or
`caveat` moves; no threshold moves. `MIN_EXEMPLAR_QUALITY` (0.5), the 3-MAD outlier bound and
`EVIDENCE_CROP_MIN_SIDE_PX` (320) are untouched — this is a selection-order fix, and passing it by
moving a gate would be editing a criterion to match a result.

Out of scope: GitHub #70 finding 1, the 1.5-MAD typicality ramp being structurally unreachable for
`overstriding` on the multiperson clip (`maxDevMads` 1.389 — no `detectionFactor` can clear it). That
is a change on a different axis. `overstriding` is expected to still emit no evidence afterwards.
