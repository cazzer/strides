# Swing-foot lateral excursion

## Why

The existing step-width metric samples where the foot lands. It does not describe how far the
foot travels sideways while airborne. Front and rear recordings can show that path, even though
the project has no rear-view example yet. This is a foot-path measurement distinct from
conventional heel whip, which describes rotation of the foot.

## What changes

Add a front/rear-primary `swingFootLateralExcursion` result in percent of same-frame hip width,
with complete-swing sampling, confidence and null gates, a paired evidence image, and neutral
unbanded guidance. Append it to all result, fusion, and presentation contracts.
