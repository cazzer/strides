# Design

Presentation-only. No metric calculation, confidence value, tier threshold or evidence-planning
rule is touched. Everything below was measured live in headless Chromium on real GPU
(`ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)` — asserted before each
run, never SwiftShader), against a dev server started from **this** checkout on port 5188.

## D1 — Nest, do not partition

`normalCount = metrics.length - caveatedCount - excluded.length` is a partition. Replaced by

```ts
const measuredCount = metrics.length - excluded.length
```

with the caveated count rendered parenthetically inside the measured fragment. Two counts remain on
the line and they now sum to `metrics.length`, which is the invariant a reader can check against the
screen: *measured* is exactly the number of cards, *not measurable* is exactly the number of entries
in the section below.

Rejected: keeping three fragments and relabelling the first "of which N are clean". It makes the
reader do the arithmetic the line exists to save them, and the caveated tier is not a defect
category — a tier-2 card shows a real number.

## D2 — "measurable", not "measured"

Tier 3 is `value === null || viewFit === 'unsuitable'`. Only the first arm means nothing was
measured. Measured on Demo 2, **four of six** excluded entries carried real computed values and were
excluded purely for the front-facing camera angle:

| excluded metric | value from `[analysis-diagnostics]` | `viewFit` | was it measured? |
|---|---|---|---|
| `verticalRatio` | `null` | `unsuitable` | no |
| `verticalOscillationCm` | `null` (primary; grafted later) | `tolerated` | no |
| `trunkLean` | **3.002058639202935** | `unsuitable` | **yes** |
| `overstriding` | **−0.04349141841777431** | `unsuitable` | **yes** |
| `kneeFlexion` | **106.10266261398448** | `unsuitable` | **yes** |
| `footStrikePattern` | **−0.11326383489723578** | `unsuitable` | **yes** |
| `stepWidthCm` | `null` | `primary` | no |

The old heading was false about the majority of its own contents. "Not measurable" is true of both
arms, so one word covers the union without hedging.

The heading and the summary fragment are changed together and the spec now requires them to match,
because they are two renderings of the same claim.

## D3 — The dead `confidenceLabel` branch

`confidenceLabel` is module-private, called once, from `MetricCard`. `MetricsPanel` routes tier-3
metrics to `ExcludedEntry` and never constructs a `MetricCard` for one, and `metricTier` sends every
`value === null` metric to tier 3. So `if (metric.value === null) return 'Not measurable'` cannot be
reached. It is deleted rather than left as documentation, and the reason is written where the branch
was, so it is not re-added by someone reading the function in isolation.

Its string also collided: `ExcludedEntry`'s fallback is `'Not measurable for this clip.'`, an
*availability* statement, while `confidenceLabel`'s was a *confidence* statement. Two different
claims one word apart, in a change whose whole subject is copy that must be precise.

`ExcludedEntry`'s fallback is deliberately left alone. It is defensive (every live null path in the
heuristics layer sets a caveat) and renaming it is not part of either ticket.

## D4 — Delete the dead container query rather than make it fire

`@container` and `@lg:grid-cols-2` sat on the **same** element. `container-type: inline-size`
establishes a query container for an element's descendants and cannot query itself, so the two
column utilities resolved against the nearest ancestor query container — there is none — and never
matched.

The user decided (2026-08-29) to keep one column, so the utilities are deleted rather than rescued
with a wrapper div. The reason is a product one and is now recorded in `MetricCard`'s doc comment:
full-width cards are what leave room for evidence to sit *beside* the description, which is what the
inline-evidence work was asked for. At three-column density a desktop card is ~311 px, the per-card
container query correctly stacks the thumbnail, and "beside the description on a desktop" stops
happening at any viewport.

### The other container in the same file is genuinely different, and works

Verified before editing rather than assumed. `MetricCard` puts `@container/card` on a wrapper and
`@lg/card:flex-row` on its **child** — two nodes, so the query has a real ancestor container.
Measured on Demo 2, reading `container-type`/`container-name` off the holder and `flex-direction`
off the child:

| viewport | grid width | card holder width | holder `container-type` / `-name` | child `flex-direction` |
|---|---|---|---|---|
| 480 | 448 | 402–404 | `inline-size` / `card` | **`column`** |
| 900 | 852 | 806–808 | `inline-size` / `card` | **`row`** |
| 1440 | 1104 | 1058–1060 | `inline-size` / `card` | **`row`** |

The direction flips with the card's own width. That query fires; the grid's did not. `@container/card`
was not touched.

(The `Cadence` card reports nulls in that probe on every run — it has no evidence, so it renders the
no-evidence branch and has no `@container/card` node at all. Correct, not a measurement failure.)

### Byte-identical rendering, with a zero noise floor

Ticket 2 was applied **alone**, with the summary-line change held back, so the comparison isolates
it. Demo 2 was used because it is local and fast.

**Control first.** Two consecutive baseline runs with no code change between them produced
**byte-identical PNGs of the metrics panel at all three viewports** (`cmp`, not a perceptual diff).
The instrument's noise floor on this clip is exactly zero, so a null result afterwards is a real
null and not a blind test.

**Then the change.** Baseline vs. ticket-2-only, same three viewports:

| viewport | panel PNG | grid rect | every card rect | card container probe | computed-style props differing |
|---|---|---|---|---|---|
| 480 | **identical** | identical | identical | identical | **1** |
| 900 | **identical** | identical | identical | identical | **1** |
| 1440 | **identical** | identical | identical | identical | **1** |

The one differing computed property, at all three widths, is `container-type: inline-size → normal`
— which is precisely the declaration being removed. Nothing resolves against it (no `@`-query has
this element as its container; the panel subtree contains no `absolute`/`fixed`/`sticky`
positioning, no `z-index`, and the only `overflow-hidden` is on the evidence image, which forms its
own formatting context regardless), so the containment it implied was inert.

The panel's entire serialized `outerHTML` is identical once the single edited `class` attribute is
normalized — no other attribute, node or text differs.

`grid-template-columns` before and after, unchanged in both arms:

| viewport | grid width | `gridTemplateColumns` |
|---|---|---|
| 480 | 448 px | `448px` (1 column) |
| 900 | 852 px | `852px` (1 column) |
| 1440 | **1104 px** | `1104px` (**1 column**) |

1104 px is comfortably past both `@lg` (32rem/512px) and `@3xl` (48rem/768px), which is the direct
demonstration that the utilities never matched.

## D5 — Live evidence that the summary line now agrees with the screen

The defect is a disagreement between a sentence and a picture, so both were read off the same
settled render. Each run waited for `analysis complete`, then for the background scale pass's
terminal status, then for the panel's own DOM to stop changing (evidence extraction settles after
`ready`). Tiers were read from the dev-only `[analysis-diagnostics]` console line; the card count was
read from the DOM.

**Demo 2 (front approach) — the mixed case, all three tiers present.** Post-graft tiers: 2 tier-1
(`armSwingSymmetry` 0.98, `stepWidth` 1.00), 3 tier-2 (`verticalOscillation` 0.37, `cadence` 0.37,
`verticalOscillationCm` grafted by the scale pass), 6 tier-3.

| | summary line | cards on screen | excluded entries |
|---|---|---|---|
| before | `2 metrics measured · 3 with caveats · 6 not measured for this clip (listed below)` | **5** | 6 |
| after | `5 metrics measured (3 with caveats) · 6 not measurable for this clip (listed below)` | **5** | 6 |

Before, the line understated the visible cards by 3 — it named 2 where 5 numbers were on screen.
After, `5 == 5` and `6 == 6`, and `5 + 6 = 11`, the whole panel.

**Demo 1 (side view) — a different exclusion profile, as a second witness.** 6 tier-1, 2 tier-2,
3 tier-3.

| | summary line | cards on screen | excluded entries |
|---|---|---|---|
| after | `8 metrics measured (2 with caveats) · 3 not measurable for this clip (listed below)` | **8** | 3 |

(The same run under the old arithmetic would have read "6 metrics measured" above 8 cards.)

The screenshot at 1440 was also read directly: the heading now says *Not measurable for this clip*,
and the four entries under it whose reasons end "…is not reliable from a front view" are exactly the
four metrics the table in D2 shows carried computed values — the case that makes "not measured"
false.

Ticket 1 shifted no geometry: grid columns and every card width are identical between the
ticket-2-only render and the final render at all three viewports. The summary line is one line
either way.

## D6 — Reconciliation hazard for whoever archives this

**This change carries a MODIFIED block on `Evidence renders as annotated thumbnails inside the
metric card`.** Another change is being authored concurrently against the same `results-view`
capability. A MODIFIED block replaces the whole requirement body, so if that change also modifies
this requirement, the later archive silently wins and one set of edits is lost —
`openspec validate --strict` does not catch it.

Only two things in that requirement are changed here, and they are easy to carry forward by hand:

1. The paragraph beginning "Placement within the card SHALL be…" loses its "The card grid is one,
   two, or three columns…" clause and its "at every card-grid density" ending.
2. A new paragraph after it pins the single column, and the scenario
   `The card's own width drives the split, not the viewport's` is restated without its unreachable
   three-column premise; a new scenario `The card grid is one column at every width` is added.

Everything else in that requirement — captions, alt text, canvas adoption, extraction lifetime — is
reproduced verbatim and is not this change's business.

The other MODIFIED block, on `Metrics panel readouts with measurability and confidence tiers`, is
this change's own subject and is the lower-risk of the two.

## D7 — Noticed and deliberately not touched

- The metrics-panel requirement still opens "for each of the ten `MetricId`s". The panel renders
  **eleven** (`stepWidthCm` joined the family). That is a separate drift from either ticket, and the
  body is reproduced verbatim here rather than silently corrected, to keep this change's diff
  reviewable against the concurrent work on the same capability.
- `ResultsView.tsx`'s prose comment on line 44 still says "the panel lists it as not measured". It is
  a comment, not rendered copy, and `ResultsView.tsx` is outside this change's blast radius.
- `ExcludedEntry`'s `'Not measurable for this clip.'` fallback is unchanged, so the section's
  heading and that fallback now read almost identically. The fallback is defensive and never fires
  on a live run (every null path in the heuristics layer sets a caveat); collapsing the redundancy
  is a copy question of its own.
