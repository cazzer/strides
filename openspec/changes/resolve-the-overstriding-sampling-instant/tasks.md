# Tasks: resolve the overstriding sampling instant

**Outcome: FALLBACK** — see design.md D6. Gate G6 (materiality) failed: 9/26 = 34.6%, below the
50% floor.

## 1. Openspec scaffold

- [x] 1.1 `.openspec.yaml`, proposal.md, design.md through D4 (gates verbatim), specs delta
      skeleton, this tasks.md
- [x] 1.2 `openspec validate resolve-the-overstriding-sampling-instant --strict` passes

## 2. Estimator + mechanics tests (written first, against the experimental module)

- [x] 2.1 `src/heuristics/overstrideReach.experimental.ts` — ship-form search function
- [x] 2.2 Fixture helper `src/heuristics/__fixtures__/reachProfile.ts`
      (`withPreContactRetraction`)
- [x] 2.3 Unit tests for search mechanics against the experimental module: cases 1-5 (+5b), 9, 10
      — all 8 passed

## 3. Measurement

- [x] 3.1 Probe log (`[overstride-reach]`) inside `computeOverstriding`, both passes
- [x] 3.2 Throwaway driver `scripts/overstride-reach-harvest.mjs` — first version reused one
      Chromium process across clips, which reproduced the documented cold/warm multiperson
      contamination (`sampleSize` 10 vs the correct 4); fixed to launch a fresh process per clip
      before any gate was adjudicated on its output
- [x] 3.3 BASELINE run: `ab-person-selection.mjs --arm 'base={}' --clips demo1,demo2,multiperson
      --trials 3 --evidence > before.txt`
- [x] 3.4 PROBE HARVEST x2 (determinism check) via the throwaway driver, all three clips — the two
      post-fix invocations were bit-identical (`diff` exit 0)
- [x] 3.5 Keyframe cross-check: ffmpeg + drawgrid pulls at the two eligible GT onsets and their
      extremum instants; read PNGs directly — no disagreement exceeding 0.10 T found
- [x] 3.6 Filled T1-T4 in design.md D5

## 4. Adjudication

- [x] 4.1 Adjudicated G0-G6 mechanically against T1-T4 — G0/G1/G1b/G2/G3/G4/G5 PASS, **G6 FAIL**
      (9/26 = 34.6% < 50%)
- [x] 4.2 G1 passed, so G1-MP was registered per the orchestrator's ruling and partially measured
      on multiperson (2 of 4 strikes: mixed evidence, not a clean confirmatory result). Full
      quantification was stopped once G6 independently and decisively determined FALLBACK — a
      documented deviation from "register + run G1-MP if G1 passed," recorded in design.md T2-MP
      and reported to the orchestrator rather than completed silently or decided locally.
- [x] 4.3 Recorded T7-equivalent gate table in design.md D6
- [x] 4.4 No STOP-AND-REPORT condition was hit (checked explicitly: GT cross-check agreed within
      tolerance, no value exceeded 1.20, G0 held, no G3(c) decrease occurred to adjudicate,
      multiperson strikes examined were judgeable, not unjudgeable)

## 5. Implementation (FALLBACK branch)

- [x] 5.1 Reverted probe instrumentation: `git checkout --` `src/heuristics/overstriding.ts` and
      `src/heuristics/footstrikes.ts`; removed `overstrideReach.experimental.ts`,
      `overstrideReach.experimental.test.ts`, `__fixtures__/reachProfile.ts`,
      `scripts/overstride-reach-harvest.mjs`
- [x] 5.2 FALLBACK: added `SAMPLING_INSTANT_CAVEAT` constant to `overstriding.ts`, seeded
      unconditionally first in the `caveats` array (mirrors `footStrikePattern.ts`'s
      `PROXY_CAVEAT` pattern). `MetricsPanel.tsx` card description updated to match.
- [x] 5.3 Tests: `overstriding.test.ts` — added caveat assertions to the clean-clip case (non-null,
      no digit, matches `/lower bound/i`); verified existing `.toContain(...)` caveat assertions
      elsewhere in the file still pass unmodified
- [x] 5.4 Full unit suite (1420/1420), `tsc -b` clean, eslint clean on touched files

## 6. Verification

- [x] 6.1 AFTER run -> after.txt; `diff before.txt after.txt` — **empty, bit-identical**
- [x] 6.2 Filled T5 (before/after A/B field diff — empty by design, `caveat` is outside the
      driver's comparison surface) and T6 ([evidence-coverage] per-cell drift — none, since its
      inputs are unchanged) in design.md D5
- [x] 6.3 Verified registered FALLBACK regression expectations: every numeric field bit-identical
      on every clip (T5); `overstriding.caveat` is the only change (unit-test-verified, since the
      A/B driver excludes `caveat` from its table by design)

## 7. Close-out

- [x] 7.1 Finished design.md D5-D8 (tables, adjudication, weaknesses)
- [x] 7.2 Finalized specs delta: one ADDED requirement (the unconditional caveat); the
      forward-reach-extremum requirement was NOT added, since it did not ship
- [x] 7.3 CLAUDE.md addenda: corrected "Three metric-layer changes" item 3's framing where it bears
      on this bead, and left the 2026-08-31 evidence-coverage table's overstriding cells UNCHANGED
      (correctly — FALLBACK made no numeric change, so no per-cell drift exists to record)
- [x] 7.4 `bd update strides-pr1` with outcome + gate table (not closed — orchestrator closes)
- [x] 7.5 `openspec validate resolve-the-overstriding-sampling-instant --strict` passes again
- [x] 7.6 Commit on the worktree branch. No push, no merge, no PR.
