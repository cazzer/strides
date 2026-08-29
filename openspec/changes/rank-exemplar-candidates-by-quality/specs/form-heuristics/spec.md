## ADDED Requirements

### Requirement: A range exemplar's ends are the best-scoring candidate on each side of the median

For an exemplar that depicts the two ends of a measured range, the system SHALL choose each end by
**ranking every surviving candidate instant by the quality score that instant would itself receive**
and taking the best-scoring one. It SHALL NOT choose an end by its raw measured value and score that
choice afterwards. Scoring a decision already made is not ranking: it can only ever confirm or
discard one candidate, so a single badly-tracked instant sitting at the value extreme takes the whole
pair to zero — `pairQuality` is a minimum — and gates out a metric that had many well-tracked
candidates the ranking never reached.

The pair SHALL still depict a **range**: one end SHALL be drawn from the candidates whose value sits
at or above the metric's own median and the other from those at or below it. Quality is
sign-blind — an extreme instant's typicality term reads distance from the median, not direction — so
an unconstrained ranking could return two instants from the same end of the distribution, and a ghost
of two near-identical instants depicts no range at all.

Where the candidates are equally well tracked, this SHALL reduce to the most extreme surviving
instant at each end, because among survivors the typicality term rises strictly with distance from
the median. Ranking by quality therefore never narrows the depicted range without a tracking reason
for it, and the existing rule that an outlier is rejected outright in favour of the most extreme
*surviving* instant continues to hold on such a clip.

A pair whose two ends resolve to the same instant, or to two instants with the same measured value,
SHALL emit nothing rather than ghost a frame against itself.

Ranking SHALL be applied **after** the hard rejects, not instead of them: an instant with no
derivable crop, or beyond the robust outlier bound, is ineligible rather than merely low-ranked, so
ranking can never promote a tracking glitch into the picture.

#### Scenario: A well-tracked near-extreme instant outranks an untracked value-extreme one

- **WHEN** the instant with the most extreme surviving value resolved every one of the metric's input
  keypoints as `'interpolated'`, while a slightly less extreme instant resolved them as `'detected'`
- **THEN** the less extreme, well-tracked instant is selected as that end of the range, and the
  exemplar is emitted rather than gated out by the fully interpolated instant's zero score

#### Scenario: Ranking still spans the median

- **WHEN** the highest-scoring candidates overall both sit on the same side of the metric's median
- **THEN** the emitted pair still takes one end from each side of the median, so the image depicts a
  range rather than two views of the same end

#### Scenario: Uniformly tracked candidates select the value extremes

- **WHEN** every surviving candidate resolved its metric's input keypoints identically, so they
  differ only in how far their values sit from the median
- **THEN** the selected ends are the most extreme surviving instants — the same pair a
  rank-by-value rule would have chosen
