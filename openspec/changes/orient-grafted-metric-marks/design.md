# Design — deleting the polarity suppression

## D1. The premise, checked rather than assumed

`planClipEvidence` (`evidenceFrames.ts`):

```ts
const useGrafted = graftedFrames !== null && GRAFTED_METRIC_IDS.has(id)
plan[id] = useGrafted
  ? planMetricEvidence(metric, graftedFrames, frameSize, graftedTravelDirection)
  : planMetricEvidence(metric, frames, frameSize, travelDirection)
```

`graftedFrames` is `clip.analysis.scalePass.robustFrames ?? null` (`useSessionEvidence.ts:102`).
Every reachable case resolves a grafted metric's marks against the frames that measured it:

| case | `graftedFrames` | frames the marks are planned from | correct? |
|---|---|---|---|
| MoveNet primary + completed scale pass | the scale pass's | the scale pass's | ✅ |
| MediaPipe primary (no graft happens) | `null` | the primary's — which ARE the measuring frames | ✅ |
| scale pass disabled or failed | `null` | irrelevant: the metric's `value` is `null`, so it is tier-3 excluded and plans no evidence | ✅ (vacuous) |

There is no path on which a grafted metric's polarity is read from a pass that did not measure it.
The set guards nothing.

## D2. `polaritySource` goes with the flag, not after it

`polaritySource(ctx, direction)` is `ctx.polarityAllowed ? direction : null`. With the set deleted,
`polarityAllowed` is `true` at every call site and the helper is the identity function. Keeping an
identity function named `polaritySource` would read as though there were still a decision being
made at each of its four call sites, which is precisely the "two mechanisms guarding one thing"
state the ticket exists to end. All four call sites now pass the direction directly.

`EvidenceCaliperOp.polarity`'s doc no longer lists withholding as a case, and says instead — in one
paragraph, so a future reader does not re-derive the set — that there used to be one and why there
is not any more.

## D3. Verification, and its honest limit

**`stepWidthCm`'s caliper cannot be seen live today.** It is tier-3 excluded on all three test
clips, and `strides-fn4` establishes why: the background scale pass IS MediaPipe, MediaPipe reads
Demo 2's view as `ambiguous` where MoveNet reads `front`, and `viewFit: 'unsuitable'` excludes the
card. So the change's user-visible effect is unobservable until `strides-fn4` is resolved. This was
anticipated in the ticket, which offered exactly this fallback.

What was verified instead:

1. **Unit.** The replaced test pins `stepWidthCm`'s caliper polarity as **equal to `stepWidth`'s**
   on identical geometry, rather than as a bare `toBe(1)`. The property being defended is that a
   metric's id no longer changes how its marks are oriented — which is exactly what a
   re-introduced suppression set would break. Full suite: **1368 passed, 87 files.**
2. **Live, coverage unchanged on all three clips.** `scripts/ab-person-selection.mjs --arm 'base={}'
   --clips demo1,demo2,multiperson --trials 2 --evidence`, fresh process per trial, real GPU, run
   on the stashed tree and again on the changed tree. The two reports differ on **5 lines out of
   441**: three `elapsedMs` rows and the two column-width separator rows that shift because an
   `elapsedMs` string changed length. Every per-metric status, every exemplar `timestamp` /
   `pairedTimestamp` / `quality` / `cropSidePx` / `cropGrowth` is byte-identical.
   `verticalOscillationCm` — the one grafted metric that does reach a rendered card on all three
   clips — is unchanged, as predicted: none of its marks carry a polarity.
3. `npx tsc -b` and `npm run lint` clean.

The live check is a **negative** result by design: with `stepWidthCm` excluded everywhere, the only
grafted metric on screen is one that carries no polarity, so "nothing moved" is the correct and
expected outcome. It rules out an unintended change; it cannot demonstrate the intended one. When a
clip renders `stepWidthCm`, the caliper should be looked at.
