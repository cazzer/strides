# Tasks

## 1. Name the pending metrics

- [x] 1.1 `plannedMetrics` reads each metric's winning-clip plan entry for `status: 'planned'`.
- [x] 1.2 `startRun` returns it; the `extracting` state carries `pending: MetricId[]`.
- [x] 1.3 Subtract the carried sections, so a metric with an image up is never pending.

## 2. Render it

- [x] 2.1 `MetricCardEvidence.pending`, documented as why the two absences differ.
- [x] 2.2 `MultiClipVideoSession` folds pending metrics into the card evidence list.
- [x] 2.3 `CardEvidence` renders a thumbnail-sized pulsing placeholder plus a `role="status"` line,
      and no canvas, figure or caption.

## 3. Tests

- [x] 3.1 Hook: every planned metric is pending on a first extraction.
- [x] 3.2 Hook: a metric whose image was carried forward is not pending.
- [x] 3.3 Hook: a changed clip set carries nothing and so reports everything planned as pending.
- [x] 3.4 Panel: a pending entry renders the placeholder and the announced line, and no imagery.
- [x] 3.5 Panel: other cards are untouched, and a settled entry renders imagery and no placeholder.

## 4. Gates

- [x] 4.1 `npm run typecheck`, `npm run lint`, `npm test`.
- [x] 4.2 Drive the app live and observe the placeholder during both extraction passes.
