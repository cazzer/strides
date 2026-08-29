# Nest the tier counts, and pin the card grid at one column

## Why

Two defects in `src/results/MetricsPanel.tsx`, both of the same kind: the panel describes itself
inaccurately. Neither changes a metric, a confidence, or a tier threshold — this is presentation
copy and one dead class attribute.

### 1. The summary line partitions counts that ought to nest (`strides-a7k`)

`MetricsPanel` derives its "measured" count by subtraction:

```ts
const normalCount = metrics.length - caveatedCount - excluded.length
```

That treats *measured*, *caveated* and *excluded* as three disjoint buckets. They are not: a
caveated metric **was measured**, and its own card is on screen showing a number. Measured live on
Demo 2 (front-approach clip, real GPU) the panel rendered

> 2 metrics measured · 3 with caveats · 6 not measured for this clip (listed below)

directly above **five** cards, each displaying a value. The sentence and the screen disagree by a
factor of two and a half. Demo 1 (side view) shows the same defect at a different split: "6 metrics
measured" above **eight** cards.

The fix is to nest rather than partition — the caveated share belongs *inside* the measured total,
parenthesised:

> 5 metrics measured (3 with caveats) · 6 not measurable for this clip (listed below)

### 2. "Not measured" is false for a metric that was measured and then set aside

The excluded section's heading reads "Not measured for this clip", and the summary line carries the
matching fragment. But tier 3 admits metrics on **two** grounds: `value === null` (genuinely nothing
was measured) *and* `viewFit === 'unsuitable'` (a value was computed, and the camera geometry cannot
support it). On Demo 2, four of the six entries under that heading — trunk lean, overstriding, knee
flexion, foot strike pattern — carry real computed values (3.00°, −0.043, 106.1°, −0.113) and were
excluded purely for the front-facing camera angle. The heading is false about the majority of its
own contents. "Not measurable" is true of both grounds.

### 3. A `confidenceLabel` branch that cannot be reached, whose text now collides

`confidenceLabel` opens with `if (metric.value === null) return 'Not measurable'`. It is module-
private and called from exactly one place, inside `MetricCard`, which the panel only renders for
tier 1 and tier 2 — and `metricTier` sends every null-valued metric to tier 3. The branch is
unreachable. Worse, its string is now one word away from `ExcludedEntry`'s
`'Not measurable for this clip.'` fallback while meaning something else entirely (a *confidence*
statement rather than an availability one). Dead code that reads as a live case, in the copy that
this change is otherwise making precise.

### 4. A container query that has never fired (`strides-49e`)

The card grid renders as:

```tsx
<div className="@container grid gap-4 @lg:grid-cols-2 @3xl:grid-cols-3">
```

An element with `container-type: inline-size` establishes a query container for its **descendants**
and cannot query itself, so `@lg:` / `@3xl:` on that same element resolve against the nearest
*ancestor* query container — of which there is none. Measured on this checkout at three viewports:
the grid is 448 / 852 / 1104 px wide and `grid-template-columns` computes to a single track at all
three, far past `@lg` (512 px) and `@3xl` (768 px). Pre-existing, introduced by `ee7a56e`.

**The user decided on 2026-08-29: keep one column.** Full-width cards are the intended layout —
they are precisely why inline evidence sits *beside* the description on a desktop rather than under
it, which is the behaviour the inline-evidence work was asked for. At three-column density a
desktop card is ~311 px and the per-card container query correctly stacks the thumbnail, so
"beside the description on a desktop" would stop happening anywhere above a phone.

So the fix is to **delete the dead utilities**, not to add the wrapper div that would make them
fire. Rendering must be, and is, byte-identical.

## What Changes

- `MetricsPanel`'s summary line nests: the measured total counts every metric that got a card
  (tier 1 and tier 2 alike), with the caveated share reported parenthetically inside it.
- The excluded section's heading and the summary line's matching fragment both read
  **"not measurable"** rather than "not measured".
- `confidenceLabel`'s unreachable `value === null` branch is deleted.
- The card grid drops `@container`, `@lg:grid-cols-2` and `@3xl:grid-cols-3`, leaving `grid gap-4`.
  Single-column is recorded in the source as a decision, with its reason, so it is not "fixed" back.
- Unit assertions updated to the new strings; the summary-line test now also reads the card count
  off the same render, because agreement between the two *is* the requirement.

## Impact

- Affected specs: `results-view`
- Affected code: `src/results/MetricsPanel.tsx`, `src/results/MetricsPanel.test.tsx`,
  `src/results/ResultsView.test.tsx` (two queries that name the renamed section)
- **No** metric calculation, confidence value or tier threshold is touched.
- **No** rendered pixel changes from item 4 — proven byte-identical at three viewports.

## Out of scope

Tracked elsewhere, deliberately untouched here:

- Card hierarchy under-signalling very low confidence (GitHub #39 item 3, deferred behind #38).
- The vertical-oscillation-family spec debt that still asserts a null-valued centimetre metric
  renders a "Not available" **card** (GitHub #39 item 4).
- `ExcludedEntry`'s `'Not measurable for this clip.'` defensive fallback string, which is left
  exactly as it is.
