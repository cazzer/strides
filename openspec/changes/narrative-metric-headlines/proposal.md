# Narrative headlines above the fold in the guided results view

## Why

The guided view presents twelve metrics at equal weight, each against a cited band where one
exists. It answers "what did you measure" thoroughly and "what should I pay attention to" not at
all. A runner opening it has to read every card to discover that two of them carry a measured
consequence and a studied cue, and that the other ten do not.

The material for a better first screen is already in the record. `metricGuidance.ts` holds 24
verified citations, and among them are measured outcomes (raising step rate 10% cut knee energy
absorption about 34% and patellofemoral force 14%; greater vertical oscillation raises oxygen
consumption) and self-administrable protocols (a metronome 5–10% above your own rate; cueing
yourself low without slouching). Today those sit inside a card's collapsed disclosure, below a
scale, ranked by strength of evidence rather than by whether the reader can act on them.

What is missing is one field and one grouping rule — not new research, and not a change to any
number the pipeline computes.

## What changes

1. **A `consequence` field on `MetricGuidance`** — one cited sentence naming what the literature
   measured as following from this quantity, attributable to one of that metric's own already-
   verified links. Non-null on the seven metrics whose record carries one; `null` on the rest, and
   the null set is named by test so adding one is a visible change.

2. **A headline group above the fold.** A metric is admitted only when all three hold: it resolved
   on this clip, its guidance carries a `consequence`, and its `tryLine` both exists and applies
   (the existing `tryLineApplies` rule, which withholds a cue that would point a runner further
   out of a band they are already outside). Metrics that share a physical story yield one headline
   between them, not one each.

3. **Everything else moves below the fold**, in the three groups it already occupies, collapsed as
   it already is.

## What does not change

- **No number moves.** No metric's value, confidence, caveat, view fit, tier, exemplar or crop, and
  no development-only diagnostic line. The existing requirement pinning this stands.
- **No band is added, widened or invented**, and no citation is added that the research pass did not
  verify.
- **The refusal to grade the runner stands unamended.** A headline states a position, a measured
  consequence of the quantity, and a measured intervention. It applies no grading word to the
  runner's own value, introduces no pass/fail colour, and carries no target. The existing
  `SHALL NOT` needs no exception — see design.md D1.
- **The classic view is untouched**, and `?view=guide` stays opt-in. Flipping the default remains
  `strides-8c3`, a separate decision.

## Scope note

The typographic running-style signature discussed alongside this is deliberately **out of scope**.
Its two axes are cadence and vertical oscillation, which are the two metrics most likely to be
absent — the family is null on `park-side-portrait` (`strides-aha`) and cadence is withheld there
as retimed — so it would be unavailable on two of the three demo clips. Not filed.
