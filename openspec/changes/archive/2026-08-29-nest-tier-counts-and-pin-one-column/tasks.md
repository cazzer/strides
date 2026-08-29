# Tasks

## 1. Nest the tier counts (`strides-a7k`, items 1 and 2)

- [x] 1.1 Replace `normalCount = metrics.length - caveatedCount - excluded.length` with
      `measuredCount = metrics.length - excluded.length` in `MetricsPanel`.
- [x] 1.2 Render the caveated count parenthetically inside the measured fragment, keeping both
      singular/plural forms and keeping the fragment absent entirely when the count is zero.
- [x] 1.3 Change the summary line's excluded fragment to "not measurable for this clip
      (listed below)".
- [x] 1.4 Change the excluded section's heading to "Not measurable for this clip".
- [x] 1.5 Write the nesting rule and the measurable/measured distinction into the source as
      comments where each decision lives, so neither reverts as a "simplification".

## 2. Delete the unreachable confidence branch (`strides-a7k`, item 5)

- [x] 2.1 Confirm unreachability: `confidenceLabel` is module-private, called only from
      `MetricCard`; `MetricsPanel` never renders `MetricCard` for a tier-3 metric; `metricTier`
      sends every `value === null` metric to tier 3.
- [x] 2.2 Delete `if (metric.value === null) return 'Not measurable'` and record why there is no
      such branch, including the collision with `ExcludedEntry`'s availability fallback.

## 3. Delete the dead container query (`strides-49e`)

- [x] 3.1 Verify empirically, before editing, that `@container/card` at the card level is a
      **different** container and does fire — read `container-type`/`container-name` off the holder
      and `flex-direction` off its child at three viewports.
- [x] 3.2 Verify empirically that the grid's own `@lg:`/`@3xl:` never match — read
      `gridTemplateColumns` and the grid's width at three viewports.
- [x] 3.3 Replace `@container grid gap-4 @lg:grid-cols-2 @3xl:grid-cols-3` with `grid gap-4`.
- [x] 3.4 Rewrite `MetricCard`'s doc comment: state the single column as an intentional decision
      with its reason (full-width cards are what let evidence sit beside the description), delete
      the "known bug, reported separately" framing, and say plainly not to reintroduce the
      utilities.
- [x] 3.5 Check `openspec/specs/results-view/spec.md` for a responsive/multi-column card-grid
      assertion. **Found one** — the evidence requirement's "The card grid is one, two, or three
      columns…" prose and its "three-column density" scenario. Corrected in the delta.

## 4. Tests

- [x] 4.1 Update the mixed-tier summary assertion to
      `9 metrics measured (1 with caveat) · 2 not measurable for this clip (listed below)`, and
      assert the card count off the same render so the test encodes the agreement, not just the
      string.
- [x] 4.2 Update the below-0.4-confidence summary assertion to `11 metrics measured (1 with caveat)`.
- [x] 4.3 Update every excluded-section accessible-name query in `MetricsPanel.test.tsx` and the two
      in `ResultsView.test.tsx` to the renamed section.
- [x] 4.4 Add an assertion, on the existing unsuitable-view-with-a-value test, that the old
      "Not measured for this clip" heading is nowhere in the document.

## 5. Verification

- [x] 5.1 `npx tsc -b` — clean.
- [x] 5.2 `npx eslint` on `MetricsPanel.tsx`, `MetricsPanel.test.tsx`, `ResultsView.test.tsx` — clean.
- [x] 5.3 `npm test` — 84 files, 1211 tests, all passing.
- [x] 5.4 Live, real GPU (renderer string asserted, never SwiftShader): establish the noise floor by
      running the baseline twice with no code change — panel PNGs byte-identical at 480/900/1440.
- [x] 5.5 Live: apply ticket 2 **alone** and re-run — panel PNGs byte-identical to baseline at all
      three viewports, every rect identical, `outerHTML` identical modulo the edited class, exactly
      one computed-style property changed (`container-type`, the one being removed).
- [x] 5.6 Live: apply ticket 1 and confirm on Demo 2 (all three tiers present) that the rendered
      summary line agrees with the visible card count and the excluded-entry count, read off the
      same settled screen — `5 metrics measured (3 with caveats) · 6 not measurable…` above 5 cards
      and 6 entries.
- [x] 5.7 Live: repeat on Demo 1's different exclusion profile — `8 metrics measured (2 with
      caveats) · 3 not measurable…` above 8 cards and 3 entries.
- [x] 5.8 Confirm ticket 1 shifted no geometry: grid columns and every card width identical between
      the ticket-2-only and final renders at all three viewports.
- [x] 5.9 `openspec validate nest-tier-counts-and-pin-one-column --strict`.

## 6. Handover

- [ ] 6.1 **Do not archive.** A concurrent change targets the same `results-view` capability; see
      design.md D6 for exactly which two edits in the evidence requirement need carrying forward if
      that change also modifies it.
