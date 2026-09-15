# Tasks

## 1. Caption

- [x] 1.1 `captionFor` returns the label alone for a blended pair and for a single instant, and the
      label plus the demotion sentence for a demoted one.
- [x] 1.2 Delete `formatSeconds`, now uncalled.
- [x] 1.3 Update `captionFor`'s doc comment, which opens by promising "when in the clip it
      happened".

## 2. Tests

- [x] 2.1 Repoint `evidenceCaptions.test.ts`'s blended-pair assertion off the two timestamps, and
      add a negative assertion that no caption shape names a clip time.
- [x] 2.2 Repoint `MetricsPanel.test.tsx`'s rendered-caption assertion.
- [x] 2.3 Assert `altFor` still states the shape, so the statement that moved there is pinned.

## 3. Gates

- [x] 3.1 `npm run typecheck`, `npm run lint`, `npm test`.
- [x] 3.2 Drive the app live and read a rendered caption off a card.
