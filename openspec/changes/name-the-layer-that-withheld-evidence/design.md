# Design

## D1. What was measured, and what it refutes

Probe: a dev-only `[overstride-probe]` dumping `describeDistribution`'s output plus every strike's
`detectionFactor`, `devMads`, `typicality` and `scoreExemplarInstant` score, and a dev-only
`[overstride-plan-probe]` in `planMetricEvidence` dumping what the evidence layer was actually
offered. Both added, measured and reverted (`git status` clean; neither file survives this change).
Driven through the Upload tab, one clip per fresh Chromium process, `--headless=new --enable-gpu
--ignore-gpu-blocklist`, `ANGLE Metal Renderer: Apple M4 Pro`, dev server on the derived port 5326.

### `park-side-landscape.mp4` — 5 strikes

`median 0.5121345174306323`, `mad 0.12382769823617035`, `sampleCount 5`, **`usable: true`**.

| t | side | ratio | devMads | typicality | detectionFactor | score |
|---|---|---|---|---|---|---|
| 2.05 | right | 0.38831 | 1.0000 | 0.33333 | **1** | 0.33333 |
| 2.4 | left | 0.34826 | **1.3234** | 0.44114 | **1** | 0.44114 |
| 2.733333 | right | 0.52580 | 0.1103 | 0.03678 | **1** | 0.03678 |
| 3.083333 | left | 0.64856 | 1.1017 | 0.36723 | **1** | 0.36723 |
| 3.433333 | right | 0.51213 | 0.0000 | 0.00000 | **1** | 0.00000 |

Best pair: base `t=2.4`, ghost `t=3.083333`, `quality` **0.36723** = `min(0.44114, 0.36723)`.
`alternates: []` — `attachPairAlternates` gates alternates at `MIN_EXEMPLAR_QUALITY` and none clear
it. `selectExemplars` then drops the head. `MetricResult.exemplars` is **absent**.

### `park-side-portrait.mp4` — 13 strikes

`median -0.008094972685158314`, `mad 0.45163243245986706`, `sampleCount 13`, **`usable: true`**.
`detectionFactor` **1.0 on all 13**. Best low end `t=5.866667` at `1.8070` MADs → `0.60233`, which
**does** clear the ramp; best high end `t=6.866667` at `1.2913` MADs → `0.43044`, which does not.
`pairQuality` is a minimum, so the pair scores **0.43044**. `exemplars` absent.

### What the evidence layer saw

Both clips, both `[evidence-coverage]` emissions (primary and post-graft):

```
{"offered":[],"offeredCount":0,"candidateCount":0,"plannedCount":0}
```

**Measured, not deduced.** Zero candidates reach `planMetricEvidence`.

### Verdicts on the six candidate gates

| gate | verdict |
|---|---|
| `MIN_EXEMPLAR_QUALITY` | **FIRES** — in `selectExemplars`, inside the metric |
| typicality ramp | **THE CAUSE** — extreme-role, `min(1, dev / (3·mad))` |
| `detectionFactor` | REFUTED — `1.0` on every strike of both clips |
| flat-`0.5` fallback | REFUTED — `usable: true` on both clips, so the branch never runs |
| `3·MAD` hard reject (`isOutlier`) | REFUTED — nothing is rejected; max dev is 1.32 / 1.81 MADs |
| `isTooFarApartPair` / `isNearIdenticalPair` / `isTooCloseInTimePair` | **UNREACHED** — no candidate |

Two further notes on the bead's stated mechanism. First, `interpolatedFraction: 0` on both clips
already implies `detectionFactor = 1`: overstriding counts a strike as interpolated when
`ankle.interpolated || hipMid.interpolated`, and `resolveMidpoint` flags `interpolated` whenever
either hip is interpolated or one side stood in for the pair — so a zero fraction means all three
seed keypoints resolved `'detected'`. Second, **the flat `0.5` fallback would have PASSED the gate
anyway**: `selectExemplars` filters on `quality >= MIN_EXEMPLAR_QUALITY` and `0.5 >= 0.5`. Even had
it fired, it could not explain an absent image.

## D2. Why no image is produced by this change

`side-landscape` is the clean proof, in the same shape as CLAUDE.md's multiperson reading
(`maxDevMads 1.389`, zero instants ≥ 1.5). An extreme pair clears `0.5` only when **both** ends sit
`≥ 1.5` MADs from the median. That clip's **maximum over all five strikes is 1.3234 MADs**, so not
one instant clears it, on either side — unreachable at any `detectionFactor`, and unreachable by any
change to how the pair is chosen. `side-portrait` reaches 1.807 on its low side and 1.2913 on its
high side, so it fails on the high side alone.

The three ways to get an image, and why none is taken here:

1. **Move `MIN_EXEMPLAR_QUALITY`.** Forbidden by `strides-tj5`, and CLAUDE.md records that
   `overstriding` and `trunkLean` land at *exactly* `0.500` on the clips where they do emit — so
   shaving the ramp takes coverage out elsewhere while adding it here.
2. **Change the exemplar's role from `extreme` to `representative`.** This would work — typicality
   becomes `1 − spread`, and the median-most strike scores near `1.0`. It is also a change to what
   the picture *means* (the card's label reads "Furthest-reaching footstrike, ghosted against the
   closest-landing one"), it overlaps the open `strides-9uj` and `strides-n66`, and it is a metric
   redesign rather than an evidence-planning fix. Not taken; recorded for whoever picks those up.
   Worth knowing that `strides-ddj` already put `overstrideRange` in `SINGLE_INSTANT_KINDS`
   *because* the card reports a median — so the mismatch between a median-reporting card and an
   extreme-pair picture is already noted in the codebase.
3. **Name the reason.** Taken.

## D3. Why three reasons rather than two

The plan layer can observe exactly three states, and they are not collapsible:

- `metric.exemplars` absent or empty → nothing was offered.
- offered, and every one below `MIN_EXEMPLAR_QUALITY` → the gate this layer re-asserts.
- offered, above the gate, and every plan `null` → this layer's own rules.

The middle one is unreachable through `selectExemplars`, which already filters — but
`planMetricEvidence` re-asserts the gate *deliberately*, so that "an exemplar that reached a
`MetricResult` without going through the shared selector still cannot render as evidence". A reason
set that cannot name that outcome would have to fold it into `undrawable`, which would be a false
statement about which rule fired. It is already covered by an existing test
(`re-applies the quality gate at exactly the shared threshold`).

`no-candidates` deliberately does **not** claim which of its two causes applied. From this layer,
"the metric formed no candidate" (one surviving strike, so no pair exists) and "the metric's own
`selectExemplars` kept none" (this bead's case) are the identical observation: `exemplars` absent.
Distinguishing them needs the metric to report its best rejected candidate quality, which means a
new `MetricResult` field and an edit to all eleven `selectExemplars` call sites — materially beyond
an evidence-planning fix, and filed rather than done. See D5.

## D4. Naming

`undrawable` rather than keeping `all-gated-out` for that branch: the codebase's own vocabulary for
this predicate is drawability (`planExemplarWithFallback` — "the best of its ranked pairs that can
actually be DRAWN"; `selectExtremePairs` — "whether a pair can be DRAWN as one legible image"), and
retaining the old name for a narrowed meaning would leave a reader unable to tell the narrowed sense
from the old conflated one in a diff.

The existing test suite already separated these three cases and asserted the same string for all
three, which is the strongest available evidence the split is the right one:

| existing test | new reason |
|---|---|
| `reports all-gated-out when the metric emitted nothing this run` | `no-candidates` |
| `re-applies the quality gate at exactly the shared threshold` (drop half) | `below-quality-gate` |
| `reports all-gated-out when no exemplar offers a drawable pair` | `undrawable` |
| `reports all-gated-out when every candidate fails to resolve here` | `undrawable` |

## D5. Not done, and filed

- **The magnitude.** `strides-tj5` asked for "which gate rejected **and by how much**". This change
  delivers *which layer*; the margin (`0.36723` and `0.43044` against `0.5`) is not on the coverage
  line, because it is destroyed by `selectExemplars` before the evidence layer runs. Recovering it
  needs a `MetricResult` field set at eleven call sites. Filed as a follow-up.
- **An image for overstriding.** Filed as a follow-up against option 2 above, alongside
  `strides-9uj` / `strides-n66`.
- `strides-hw8` (make the walk's last-resort rule quality-aware) touches
  `planExemplarWithFallback`; this change touches only `planMetricEvidence`'s return sites and the
  reason type. No collision.
