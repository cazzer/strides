# Tasks

## 1. Measure which gate actually fires

- [x] 1.1 Probe `overstriding`'s distribution, per-strike `detectionFactor`/`devMads`/`typicality`
      and the built pairs' qualities on both side clips (added, measured, reverted).
- [x] 1.2 Probe what `planMetricEvidence` is actually offered, so the plan layer's involvement is
      measured rather than deduced (added, measured, reverted).
- [x] 1.3 Record the verdict per candidate gate in `design.md` D1, including the two refutations of
      the bead's own stated mechanism.

## 2. Split the reason

- [x] 2.1 Replace `all-gated-out` in `EvidenceUnavailableReason` with `no-candidates`,
      `below-quality-gate` and `undrawable`, documenting what each establishes and, for
      `no-candidates`, what it deliberately declines to claim.
- [x] 2.2 `planMetricEvidence` returns `no-candidates` when the metric offered nothing.
- [x] 2.3 `planMetricEvidence` returns `below-quality-gate` when candidates were offered and none
      cleared the re-asserted gate.
- [x] 2.4 `planMetricEvidence` returns `undrawable` when candidates cleared the gate and none could
      be planned.

## 3. Tests

- [x] 3.1 Repoint the four existing `all-gated-out` assertions to the reason each case now names.
- [x] 3.2 Add a test that the three reasons are mutually distinct on the same metric, so a future
      collapse back to one string fails.
- [x] 3.3 Extend the coverage-line reason round-trip test to the full new set.

## 4. Gates

- [x] 4.1 `npx tsc -b` — no new error.
- [x] 4.2 `npm run lint`.
- [x] 4.3 `npx vitest run`.
- [x] 4.4 `openspec validate name-the-layer-that-withheld-evidence --strict`.
- [x] 4.5 Live A/B, 3 trials, three clips, `--evidence`: only `overstriding`'s two reason rows move,
      nothing outside `evidence.*` moves, and no other metric's evidence moves.
