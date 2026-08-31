# Why MediaPipe calls Demo 2 ambiguous, and whether its view opinion should gate anything

## Why

Forcing MediaPipe as the primary backend on Demo 2 — `park-approach.mp4`, a dead-on front approach
— classifies the clip `ambiguous` at confidence 0.3, where MoveNet classifies it `front`. Because
the background scale pass **is** MediaPipe, every grafted centimetre metric arrives carrying
MediaPipe's view opinion, and `stepWidthCm`'s view-fit table maps `ambiguous` to
`{ fit: 'unsuitable', multiplier: 0.2 }` — tier 3. So `stepWidthCm` is structurally unable to render
on the one clip it is designed for. `verticalOscillationCm` survives only because its row maps
`ambiguous` to `tolerated`.

The ticket asked one question first: **is MediaPipe's geometry genuinely different on this clip, or
is the same geometry scoring differently?** Those point at completely different fixes.

## What Changes

- **No code change.** The cause is a detector defect, not a rule stated wrongly.
- The cause is identified with both backends' BSR and SER measured on Demo 2, on the default path.
- A decision is recorded on whether the scale pass's view opinion should gate grafted metrics: **no,
  but not yet** — the gate is reaching a defensible outcome for a false reason, and removing it
  alone would ship a number this investigation shows to be unreliable.
- Three follow-up beads carry the work the decision implies.

## Impact

- `CLAUDE.md` only. No `src/` change, no spec delta.
