# Tasks

## 1. Caption

- [x] 1.1 Drop the "same runner … not two people" sentence from `captionFor`'s ghost branch in
      `src/results/evidenceCaptions.ts`, keeping the label and the two timestamps.
- [x] 1.2 Leave `altFor` unchanged, and update the module/function doc comments that justify the
      removed sentence so they describe what the code now does.

## 2. Tests

- [x] 2.1 Replace the `MetricsPanel.test.tsx` assertion that pinned the removed sentence with one
      that pins its absence alongside the label and timestamps.

## 3. Verify

- [x] 3.1 `npx tsc -b` clean.
- [x] 3.2 `npm test` green.
- [x] 3.3 Read a rendered caption in a real browser run (Demo 1, `verticalOscillation` card).
