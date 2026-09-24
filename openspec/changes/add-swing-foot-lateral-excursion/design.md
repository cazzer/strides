# Design

## Signal

For each consecutive opposite-side then same-side detected footstrike, the interior frames form
one approximate swing of the foot that strikes second.
The terminal third of each strike-to-strike interval is excluded: the detector's estimated
contact can lag visible landing, so a nominal pre-strike frame can already be in stance. The
retained early-to-mid portion is the only population this metric claims to measure. Frame review
on the front-approach clip shows the left shoe touching by about 0.700 s, while the original
untrimmed evidence endpoint at 0.717383 s was plainly in stance. A terminal-quarter trim
would not reliably exclude the 0.700 s contact; the terminal third reduces that risk on the
observed footage. It does not certify that every retained frame is airborne.

On each retained resolvable frame, compute
`(ankle.x - same-side knee.x) / abs(leftHip.x - rightHip.x)`. Both hips must resolve on that same
frame. Interpolated points are excluded from the percentile population, per the shared policy
for extreme-quantile signals. A frame's hip width must be at least half the clip-median width
and at least one tenth of the clip-median torso length to avoid an unstable divisor. The
per-window value is the 80th minus 20th percentile of this signed series; the result
is the median of usable windows. The difference is unsigned and stable under horizontal image
reflection. It does not say inward versus outward, and neither ankle position nor a 2D path can
establish foot rotation. This is distinct from `stepWidth`, which measures the ankle's position
relative to the hip midline at detected footstrikes; a swing-only path change can change this
metric without changing step width, and a strike-only placement change can do the reverse.

Require six directly detected retained samples so both quantiles sit off the endpoints (sorted
ranks 1 and 4 at n = 6), and
at least 70% direct frame coverage within a complete window. Discard
partial windows at clip boundaries. One or two complete windows may report a value with reduced
confidence; zero trustworthy windows returns null. Confidence uses the shared view, accepted
direct samples divided by all complete candidate-window interior frames, and sample-size inputs,
with three windows as the full-size reference. Interpolated points never contribute, so their
loss is priced through coverage instead of an interpolation penalty.

An apparently adjacent opposite-foot strike pair can be three steps apart when two detections
are missed. Require the same trustworthy hip-bounce rhythm used by cadence, and discard an
interval at least as long as the shortest plausible full stride (`shortestPlausibleStrideSeconds`
from `stridePeriod.ts`). That bound is 2/(1 + 0.15) fitted step periods, well below three steps.
When no trustworthy fitted rhythm exists, abstain instead of treating strike adjacency as proof
of one step.

## Evidence and presentation

Rank complete windows by proximity to the reported median and offer a percentile-near pair from
each to the shared evidence planner. It can try another representative window when the first
pair fails its existing crop or phase-separation gates. Each pair shows the same leg's knee
vertical and ankle horizontal offset at both instants. It illustrates one measured window, while
the card reports the median of all windows. Front and rear are the existing `front` view type;
side and ambiguous angles are unsuitable. No clinical range, threshold, or remediation is claimed.

## Validation limit

In a fresh browser run on `park-approach.mp4`, the P80−P20 / six-sample and rhythm-gated estimator
reported 25.4% of hip width from two usable windows (confidence 0.2745, coverage 0.4118). The
shared planner drew the fallback right-foot pair at 0.800800 and 0.950950 s (crop growth 1, no
demotion); review of both source frames showed the shoe airborne. The side-view demo returned
null/unsuitable. The front clip is brief and yields low confidence, so this is a working proxy,
not evidence of clinical precision. Horizontal reflection is regression-tested on synthetic front
geometry, but no rear-view footage exists in the corpus, so rear-view accuracy remains unvalidated.
