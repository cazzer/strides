# Declutter the guided results view

## Why

The guided view shipped (`main` d6a05c2) and the first reader's verdict was two sentences:
**"significantly too verbose"**, and the grayscale scales are **"impossible to read"**.

Both are measurable rather than matters of taste.

- **Verbosity.** `cadence`'s card carries **363 words** before a reader opens anything. That is a
  page of prose standing between the reader and the one fact they came for — what their number is,
  and where it sits. The material is all true and all sourced; it is simply all on screen at once,
  with no order of importance.
- **Legibility.** The scale draws its zones in two alternating neutral tints,
  `bg-neutral-300`/`bg-neutral-400` (light) and `600`/`500` (dark). Adjacent tints differ by a
  contrast ratio of about **1.2:1**. They were chosen to be *ungraded* — no hue may mean "bad" — and
  they achieve that by being nearly invisible. A five-zone percentile table rendered in two tints a
  fifth of a step apart tells the reader nothing about which zone is which.

The second problem has a real constraint behind it and cannot be fixed by reaching for colour: the
shipped spec forbids any element that grades the runner, by colour, word or icon, and forbids a
preferred end on the band. That rules out red/green, and it rules out a single ramp read as
worse→better.

**There is a shading dimension that is not a grade: how many runners each zone holds.** Garmin
publishes the percentile cut points, so the middle zone genuinely holds 40% of the table and each
outer zone 5%. Shading by share of runners is a statement about the *population*, in one hue family
with no favourable end — the same thing the band itself already says, drawn instead of only written.
A runner in the darkest zone is in the most common zone, which is a fact and not a verdict.

## What Changes

Eight changes, all to presentation. **No measurement, value, confidence, caveat, tier, exemplar,
crop or image moves.**

1. **A headline that states the value and its position in one line** — `172 steps/min · 30th–69th
   percentile of Garmin's table` — so the card's first line answers the question the reader came
   with.
2. **Zone shading by share of runners**, in one hue family, darkest (light theme) / brightest (dark
   theme) = most runners, with a legend saying so. Never a grade, never red/green/amber, never the
   brand colour.
3. **Only three numbers printed on the scale**: the band's two outer bounds and the measured value.
   Every interior zone boundary becomes an unlabelled seam. The text alternative still carries every
   bound, so nothing is lost — only the crowd of stacked labels under the track.
4. **The speed caveat becomes a visible `Varies with pace` tag** beside the headline, with the full
   two-part caveat moved into the card's disclosure.
5. **Provenance becomes one citation line** — `Malisoux et al. 2023 · recreational runners ·
   n = 860` — with the full population sentence, the derivation statement and what it rests on
   inside the disclosure.
6. ~~**The description leaves banded cards.**~~ **WITHDRAWN under review** (design.md D1, D8.2): a
   scale says where a number sits, and nothing else on the card said what the number was —
   `110° · within the range shown` never says 110° of what. Every card keeps its description.
7. **At most one studied change per card**, as a single `Try:` line stating a change relative to the
   runner's own value. The remaining remediation links move into the disclosure, keeping every link's
   kind and summary reachable.
8. **The group intro paragraphs go**, and the three headings the disclosure used to carry
   ("Where this range comes from", the bordered speed box) collapse into the one disclosure.

## Impact

- **Changed**: `src/index.css` (scale colour tokens), `src/guidance/types.ts`,
  `src/guidance/metricGuidance.ts`, `src/guidance/bandPosition.ts`, `src/guidance/MetricScale.tsx`,
  `src/results/formatGuidedValue.ts`, `src/results/guidedGroups.ts`,
  `src/results/GuidedMetricCard.tsx`, `src/results/GuidedResultsView.tsx`, and their tests.
- **Zero edits** to `ResultsView.tsx`, `MetricsPanel.tsx`, `metricDescriptions.ts`,
  `MultiClipVideoSession.tsx`, `src/heuristics/`, `src/pose/`, `src/video/`.
- **No new reference numbers and no new research claims.** Every string added here is a shortening
  of one already in the record, or a sentence traceable to a link already in that metric's own
  remediation list.
- **Spec**: three MODIFIED and three ADDED requirements on `guided-results-view`. Two of them
  deliberately reverse a decision the shipped change made — see design.md D1.
- **Review round 1** added nine further presentation changes and withdrew one of the eight above.
  Still no measurement, value, confidence, caveat, tier, exemplar, crop or image moves, and still no
  new research claim — see design.md D8.
