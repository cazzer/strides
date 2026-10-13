## Why

`strides-3f6` (closed 2026-10-05, landed on `main` as `e382aea`) shipped six pieces of user-facing
behaviour with no openspec change: an "Observed, not a target" label on every guided scale, a
studied-change line framed as the runner's own choice, a shared introduction to the three bounce
measures, per-metric clip provenance in multi-clip sessions, a path from an enlarged evidence frame
to its source video, and filming guidance plus a video-handling note in the picker.

None of it is described in `openspec/specs/`. That is not only a documentation gap: a later change
that MODIFIES a neighbouring requirement replaces that requirement's whole body, and anything the
spec never stated cannot be carried forward by it. `strides-83m` (narrative headlines) is the next
change to touch the guided view, so the back-fill lands first.

## What Changes

Spec only. Six ADDED requirements stating behaviour that is already in the code at `042dd5b`:

- `guided-results-view` — every scale says its band is observed, not a target; a studied-change line
  is framed as the runner's own choice; the three bounce measures are introduced together, each
  linking to its own entry.
- `multi-clip-analysis` — with more than one clip, each metric names the clip it was measured from.
- `results-view` — an enlarged evidence frame can open its source clip at that instant.
- `video-input` — the picker shows filming guidance and how video is handled.

No MODIFIED or REMOVED requirement. Every title was checked against the existing specs for a
collision or a contradiction.

## Impact

- No code changes. No metric value, confidence, caveat, tier, exemplar or image moves.
- `openspec/specs/` catches up with `src/`, so `narrative-metric-headlines` can be stated against it.
