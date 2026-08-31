# Tasks

## 1. Reuse key

- [x] 1.1 Store the plan a clip's evidence was extracted from in the cache entry.
- [x] 1.2 Reuse cached evidence when the newly computed plan and the source blob are unchanged,
      replacing the whole-`ClipEvidenceInputs` reference comparison at the reuse site.
- [x] 1.3 Keep `sameClipInputs`/`sameInputList` as the effect's cheap every-render guard, documented
      as the outer layer of a two-layer comparison.

## 2. Non-destructive transition

- [x] 2.1 Give `extracting` a `sections` field so entering it is non-destructive.
- [x] 2.2 Carry the previous sections into `extracting` only when the clip id list is unchanged.
- [x] 2.3 Read sections from both non-idle states in `MultiClipVideoSession`.

## 3. Tests

- [x] 3.1 Unit-test the hook: an unchanged plan reuses and opens no decoder; a changed plan
      re-extracts while keeping the previous sections rendered; a changed clip set does not carry.
- [x] 3.2 Run the existing suite, type check and lint.

## 4. Live verification

- [x] 4.1 Reproduce on a >10 s clip and confirm the canvas count never returns to zero after the
      first appearance, across the scale-pass graft.
- [x] 4.2 Confirm Demo 1 and Demo 2 still settle with their recorded coverage.
