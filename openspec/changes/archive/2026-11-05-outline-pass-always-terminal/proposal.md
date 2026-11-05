## Why

`strides-p1qt.4`: the desktop baseline at 01c4ef04 recorded private IMG_9348's outline pass never
reporting. That did not reproduce in ~55 fresh trials, and the baseline's missing signals point at
the page itself going silent (see design.md). The RCA did turn up a real hole, though: the outline
pass's async body has no catch. A throw before its watchdog is armed, in reader or decoder setup,
leaves the pass 'running' forever. The card then keeps "Checking sideways foot travel…", no
outline-pass line is logged, and evidence never settles. The spec lists the failures that end on
'failed', and this one isn't among them.

## What Changes

- Any error the outline pass raises, wherever it is raised, ends the pass 'failed' with the existing
  couldn't-run caveat.
- Dev tooling only: when its settle wait gives up, `ab-person-selection.mjs` now reports whether the
  page had crashed, was unresponsive or was live (`harness.pageAtSettleTimeout`, plus the WARNING
  line with the last console lines).

## Impact

- `src/results/useVideoAnalysis.ts` (outline-pass effect), its outline test.
- `scripts/ab-person-selection.mjs`. A settled trial's rows are unchanged.
- No reading changes: the new branch runs only when the pass throws.
