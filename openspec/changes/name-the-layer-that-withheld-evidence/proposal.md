# Name the layer that withheld a metric's evidence

## Why

`strides-tj5`: **overstriding renders a number on both side clips and an evidence image on
neither.** Measured on `08bf71c`, 3 trials, zero spread — `side-landscape` and `side-portrait`
both report `evidence.clips[0].metrics.overstriding.reason = all-gated-out`, and `front-approach`
reports `metric-excluded` (tier 3, unsuitable view).

The bead traced the cause to `exemplars.ts`'s flat-`0.5` typicality fallback multiplied by a `2/3`
`detectionFactor`, and flagged its own doubt about that. **Both halves are refuted by
measurement**, and the third candidate — this layer's own framing rules — never runs at all.

Probed live (real GPU, fresh Chromium, identity-verified server, add-measure-revert):

| | side-landscape | side-portrait |
|---|---|---|
| distribution `sampleCount` / `mad` / `usable` | 5 / 0.12383 / **true** | 13 / 0.45163 / **true** |
| `detectionFactor`, every strike | **1.0** | **1.0** |
| max `devMads` over the clip | **1.3234** | 1.8070 (low side only) |
| best pair `quality` | **0.36723** | **0.43044** |
| exemplars offered to the evidence layer | **0** | **0** |

So: the distribution is usable, hence the flat-`0.5` branch never fires; every seed keypoint is
`'detected'`, hence `detectionFactor` is `1.0` and never 2/3; and the rejection is the **extreme-role
typicality ramp** at the shared `MIN_EXEMPLAR_QUALITY`, applied in `selectExemplars` inside the
metric — one layer *above* evidence planning. The plan layer is handed an empty candidate list on
both clips.

**And the reason it prints for that is wrong.** `all-gated-out`'s own doc reads *"candidates existed
and none survived the quality gate or this layer's own resolution rules"*. On these two clips no
candidate existed, and none of `resolveExemplarFrames`, `frameCropBox`, `isNearIdenticalPair`,
`isTooCloseInTimePair`, `isTooFarApartPair` or `computeEvidenceCropRect` was ever reached. The verdict
names a set of rules that did not run, and points a reader at crop geometry and display constants
that are not involved. This bead's own traced mechanism is a worked example of that misdirection —
five of the six gates it lists as candidates are in a layer the failure never touches.

The image itself cannot be recovered without either moving `MIN_EXEMPLAR_QUALITY` — which
`strides-tj5` forbids, and which CLAUDE.md's 4K-area-floor section is the standing argument
against — or changing what overstriding's picture *means* (from an extreme pair to a representative
instant), which is a product decision that overlaps `strides-9uj` and `strides-n66` and is not this
change. On `side-landscape` the ramp is not merely missed but **structurally unreachable**: clearing
`0.5` needs an instant `≥ 1.5` MADs from the median on *each* side, and the whole clip's maximum is
`1.3234` MADs — no `detectionFactor` can rescue it. So this change takes `strides-tj5`'s second
acceptance branch: make the absence name a reason a reader can act on.

## What Changes

- **`EvidenceUnavailableReason` splits `all-gated-out` into three**, each naming what it establishes:
  - `no-candidates` — the metric offered this layer no exemplar at all. It either formed none or its
    own `MIN_EXEMPLAR_QUALITY` selection kept none; those two are **not** distinguishable from here
    and the reason deliberately claims neither.
  - `below-quality-gate` — candidates were offered and every one scored below `MIN_EXEMPLAR_QUALITY`
    when this layer re-asserted it.
  - `undrawable` — candidates cleared the gate and every one failed this layer's own resolution and
    framing rules.
- `all-gated-out` is **removed**. Keeping it for one of the three would leave the reader unable to
  tell a narrowed meaning from the old conflated one.

## Impact

- `src/results/evidenceFrames.ts` only — the type, its doc, and the three return sites in
  `planMetricEvidence`. No metric module, no heuristic, no calculation.
- **No computed value moves anywhere**, and no image changes. `status` stays `'no-evidence'` and
  `exemplars` stays `[]` in every case; only the `reason` string differs.
- **No UI change.** `EvidenceUnavailableReason` has no reader in `src/results/*.tsx` — it exists for
  the dev-only `[evidence-coverage]` line, plus `useSessionEvidence`'s `'extraction-failed'`
  substitution, which is untouched.
- **A `[evidence-coverage]` contract break**, in the same shape as `demotion` replacing
  `demotedFromPair` (`strides-ddj`) and `focusOffset` being added (`strides-dxd`): a `before.txt`
  captured earlier diffs against a later one on any row carrying this reason. In the measured
  corpus that is **exactly two rows**, both `overstriding`'s, on the two side clips —
  `all-gated-out` occurs nowhere else across all three clips and all twelve metrics.
