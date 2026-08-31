# Tasks

## 1. Measure

- [x] 1.1 Probe the metric's own exemplar output — does `verticalRatio` emit the stride pair at all?
- [x] 1.2 Probe every `return null` in `planExemplarFrames` for the gate and its numbers.
- [x] 1.3 Compute the pre-`4fac355` clamped growth alongside the current one, on the same pair in
      the same run, to attribute the change rather than infer it.
- [x] 1.4 Revert both probes; `git status` clean.

## 2. Record

- [x] 2.1 Retire CLAUDE.md's "Best image on any clip is `verticalRatio`'s `stridePair`" claim,
      replacing it with the measured reason.
- [x] 2.2 Annotate the 2026-08-31 coverage table's `verticalRatio` row with the cause, replacing
      the "NOT isolated in this docs pass" note and its two wrong suspects.
- [x] 2.3 AGENTS.md needs no mirror — it carries only beads workflow guidance, none of this file's technical record (verified: zero occurrences of "evidence").
- [x] 2.4 File the follow-up bead for the product question (a stride-spanning image needs a
      different crop construction, not a different threshold).
