# Remove the grafted-metric polarity suppression

## Why

`GRAFTED_METRICS` (`evidenceAnnotations.ts`) withheld the directional polarity of any mark belonging
to `verticalOscillationCm` or `stepWidthCm`. Its stated premise:

> their joint positions AND their hip polarity are therefore resolved off a primary-pass frame
> snapped within tolerance — never the MediaPipe frame the metric actually measured

**That premise is now false.** `strides-3a1` closed the seam: `planClipEvidence` takes the scale
pass's own `RobustPoseFrame[]` as a fourth argument and plans every metric in `GRAFTED_METRIC_IDS`
against them — their frames, their snap tolerance, their travel direction. A grafted metric's hip
ordering now comes from the detector that took the measurement.

So the set is obsolete rather than redundant-but-safe. What it still does is withhold a polarity
that is **correct**: `stepWidthCm`'s caliper draws as an unsigned span when it could honestly point,
and `verticalOscillationCm` pays nothing either way because none of its marks carry a polarity at
all.

`strides-3a1` deliberately left it in place — another change held `evidenceAnnotations.ts` in the
same session, and deleting a set out from under an in-flight annotation rework is how two correct
changes clobber each other.

## What Changes

- `GRAFTED_METRICS` is deleted. With it goes the `polarityAllowed` flag threaded through
  `InstantContext`, and `polaritySource`, which becomes the identity function once the set is gone.
- Every directional mark now reads its orientation straight from the plan.
- The spec's "A suppressed polarity still draws the span" scenario drops its now-false grafted
  example, and the requirement gains an explicit prohibition on suppressing polarity by metric id
  plus a scenario pinning the grafted case the other way round.
- The test that asserted the set's membership is replaced by one asserting the inverse: a grafted
  metric's caliper carries the **same** polarity as its pixel-space sibling on identical geometry.

## Impact

- `src/results/evidenceAnnotations.ts`, its test, and `openspec/specs/results-view/spec.md`.
- No behaviour change observable on any of the three test clips today — see design D3.
