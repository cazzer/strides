# Retire the "best image" claim for `verticalRatio`'s stride pair

## Why

`strides-h4u`'s 2026-08-31 coverage re-measurement found `verticalRatio` dropping from 2 evidence
images to 1 on both Demo 1 and multiperson. The exemplar that vanished is the `stridePair` — the
one CLAUDE.md's own legibility assessment nominated as "Best image on any clip".

The ticket (`strides-mjw`) named two suspects, `ceee2dc`'s fitted-step-period gate and
`strides-cjl`'s footstrike re-timing, and deliberately did not guess between them. **Neither is the
cause.** Measured live, the cause is `4fac355`, and the drop is correct.

## What Changes

- **No code change.** The guard that drops the pair is behaving exactly as designed.
- CLAUDE.md's "Best image on any clip is `verticalRatio`'s `stridePair`" is retired and replaced
  with what was measured, so the file stops pointing at an image nobody can produce.
- The coverage table's `verticalRatio` row is annotated with the reason, not just the count.
- A follow-up bead is filed for the product question the measurement exposed: this exemplar KIND is
  structurally unreachable for this metric, not unlucky on one clip.

## Impact

- `CLAUDE.md` / `AGENTS.md` only.
- No `src/` change, no spec delta.
