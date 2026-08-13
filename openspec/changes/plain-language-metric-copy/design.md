# Design — plain-language metric copy

## D1: Caveats name the failure in plain words, never estimator internals

The one real decision. User-facing caveat text describes the *biomechanical fact* ("the step
rhythm in this clip was too irregular to measure"), never the *estimator's bookkeeping* (R²
values, configured thresholds, frequency grids, backend or pass machinery). Two corollaries:

- **Distinctions between failure modes survive the rewrite.** "Too few frames", "clip too short
  for a complete step/bounce", "no vertical motion at all", and "rhythm too irregular" remain
  four different sentences — the plain-language sweep flattens vocabulary, not information a
  user could act on (film longer, film steadier, film the runner actually running).
- **Dropping an interpolated number is allowed; changing when a caveat fires is not.** Where the
  old text interpolated a measurement (the R² value, the Hz band, "considered frames"), the
  plain rewrite may drop the interpolation entirely, but the guard condition around the
  `caveats.push(...)` is untouched in every case.

Rejected alternative: keeping the numbers but glossing them ("rhythm consistency score 0.49 of
1"). Still asks the reader to learn a private scale, and every estimator change would re-churn
user copy.

## D2: The spec loosens to pin meaning, not strings

The specs previously pinned estimator-internal wording ("caveat names both the measured fit
quality and the configured minimum", "names what backend capability would be needed", "naming
the second, scale-aware detection pass"). The deltas re-pin those clauses at the level the rest
of the spec already speaks — what the caveat *says happened* — so the next copy edit inside the
same meaning doesn't need a spec change. Requirement and scenario titles are reused verbatim
(archive matches by title), even where a title mentions "backend": titles are internal spec
language, not user copy.

## D3: What "second pass" copy keeps

The scale pass visibly replays the clip after "Analysis complete", so the narrative can't drop
the concept — it plainly names a second pass/look at the same clip, without "detection",
"scale-aware", or backend names. The provenance caveat stays (the one scale-pass-sourced card
still names where its number came from) as "Measured in a second pass of the same clip."
