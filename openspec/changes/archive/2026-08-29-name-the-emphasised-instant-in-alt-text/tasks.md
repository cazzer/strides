# Tasks

## 1. Alt text

- [x] 1.1 `altFor` names the emphasised instant for a blended image, and only for a blended one.
- [x] 1.2 Document why naming the *first* instant is general — every paired label is
      `"X, ghosted against Y"` with the base first.

## 2. Tests

- [x] 2.1 Create `src/results/evidenceCaptions.test.ts`, which did not exist.
- [x] 2.2 Assert the emphasis clause is present for a blended plan, and **absent** for a
      single-frame plan and for a pair demoted to its base.
- [x] 2.3 Cover the previously-unasserted branches: the per-side clause, the demoted-pair caption,
      and `provenanceFor`'s single-clip null.
- [x] 2.4 Update the `MetricsPanel.test.tsx` assertion that pinned the old sentence verbatim.
- [x] 2.5 Mutation-check the new assertion: reverting the sentence must fail it. *(Verified —
      1 failed / 7 passed on the mutant, green on restore.)*

## 3. Spec

- [x] 3.1 MODIFIED *Evidence renders as annotated thumbnails inside the metric card*: text-alternative
      prose plus the scenario *A ghosted thumbnail says it is one runner, not two people*.
- [x] 3.2 `openspec validate --strict`.

## 4. Gates

- [x] 4.1 `npx tsc -b`, `npx eslint`, full unit suite.
