# Running-economy headlines above the contents list in the guided results view

## Why

The guided view presents every metric at equal weight against a cited band. It answers "what did
you measure" thoroughly and "is anything here worth my attention" not at all.

The first draft of this change answered that with joint-load consequences and studied cues for four
metrics. The user then asked (2026-10-13, bead `strides-1ce`) for target ranges most favourable for
running efficiency and for the one or two metrics furthest from them. An economy-specific evidence
sweep found no published target range for any of the thirteen metrics, so neither a target nor a
distance-from-target ranking can be cited. What the record does support is narrower: across runners,
one meta-analysis (Van Hooren et al. 2024, 51 observational studies) found a higher step rate and a
smaller vertical oscillation, measured as a distance, each associated with a lower energy cost. The
user chose that framing (Option A): direction-only headlines, no targets, no distance ranking.

## What changes

1. **`MetricGuidance.economyConsequence`** — `{ text, url, costlySide } | null`, non-null on exactly
   `cadence` (`costlySide: 'below'`) and `verticalOscillationCm` (`'above'`), both citing a new
   verified link, `VAN_HOOREN_2024_LINK`, added to those two metrics' research. Null everywhere else,
   pinned by name.
2. **A "Running economy" section** between the completion line and the contents list. A story — step
   rate, or bounce — gets one headline when its fixed spokesman (`cadence`; `verticalOscillationCm`)
   is in the banded group and reads strictly beyond its band's outermost finite bound on the costly
   side: cadence below 153 (Garmin's 5th-percentile cut), bounce above 9.5 cm. Headlines render in
   `displayRank` order. With none, the section says why in under fifty words.
3. **A headline** states the value and its position (in words that name the range, since no scale is
   beside it), the "Varies with pace" tag, the band's citation, the economy association with its
   citation, the first sentence of each mandatory note, the card's own studied-change line where it
   applies, and a link to the card (step rate) or to the bounce introduction (bounce).

## What does not change

- **No number moves.** No metric value, confidence, caveat, view fit, tier, exemplar or crop, and no
  development-only diagnostic. Nothing under `src/pose`, `src/heuristics`, sampling or workers is
  touched.
- **No band is added, widened or invented**, and "a band is cited or it does not ship" stands.
- **The refusal to grade the runner stands unamended.** A headline states a position and a
  between-runner association attributed to the quantity. It names no target, applies no grading
  word, adds no colour and no icon.
- **Every card still renders below**, unchanged. Headlines render no evidence imagery.
- **The classic view is untouched**, and `?view=guide` stays opt-in.

## Out of scope

- The joint-load consequences of the first draft (Heiderscheit, Lenhart, Braun, Wang) — dropped
  (design.md D3).
- Any economy statement on the cards themselves — the consequence renders only in the headline.
- A typographic running-style signature.
