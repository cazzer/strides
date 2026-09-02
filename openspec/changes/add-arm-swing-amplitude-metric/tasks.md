## 1. OpenSpec skeleton with pre-registered decisions

- [ ] 1.1 `openspec/changes/add-arm-swing-amplitude-metric/`: `proposal.md`, `design.md` (D1–D6
      registered BEFORE any live Phase-B run; D3 adjudication and D5 proof sections pending),
      `tasks.md`, spec deltas (`form-heuristics` ADDED ×3, `results-view` MODIFIED ×1: twelve →
      thirteen).
- [ ] 1.2 `openspec validate add-arm-swing-amplitude-metric --strict` passes. Commit the skeleton
      BEFORE Phase A/B land, so pre-registration is verifiable. (Step-0 baseline —
      `wave2/baseline.txt` + the anchor driver — captured at worktree HEAD before any edit.)

## 2. Phase A — extraction refactor (no behavior change)

- [ ] 2.1 New `src/heuristics/armSwing.ts`: MOVE verbatim (docs included) from
      `armSwingSymmetry.ts` — `SideSwing`, `computeSideSwing` + module doc, `buildSideExemplar` +
      doc, `caveatForFailure`, `MIN_ARM_SWING_CYCLES`, `FIT_QUALITY_SATURATION_R2`,
      `MAX_SIDE_FREQUENCY_DISAGREEMENT`, `SIDE_FIT_QUALITY_DISPARITY_R2`,
      `SHOULDER_NAME`/`WRIST_NAME`/`ELBOW_NAME` — all exported. `armSwingSymmetry.ts` keeps only
      `nullResult` + `computeArmSwingSymmetry`, importing from `./armSwing`. Module doc records
      the one deliberate difference from the `hipBounce.ts` precedent (shared gate policy — D5).
      No new test file.
- [ ] 2.2 Phase A proof (hard gate): `npm test`, `tsc -b`, lint clean; rerun the Step-0 command →
      `wave2/afterA.txt`; `diff baseline.txt afterA.txt` EMPTY except the header commit line and
      `elapsedMs` rows. Anything else → revert and investigate; do not proceed. Record in
      design.md D5. Commit refactor + proof record.

## 3. Phase B — the metric

- [ ] 3.1 New `src/heuristics/armSwingAmplitude.ts` — `computeArmSwingAmplitude(frames, view,
      config)` on `computeArmSwingSymmetry`'s skeleton, same check order: unresolvable arms →
      per-side fit failure (shared `caveatForFailure`) → weaker-side R² < `armSwingMinFitR2`
      (GATE REUSE — no new constant) → cross-side frequency disagreement (shared bound, amplitude
      wording) → `estimateBodyScale` null/zero-torso (overstriding's verbatim body-scale caveat,
      with frameCoverage). Value = mean of the two fitted peak-to-peak amplitudes ÷ torso (D1),
      `unit: 'ratio'`. Confidence: every input the worse side's (D2). Caveats: unsuitable-view
      via `viewPhrase`; cycle shortfall; disparity-else-unsteady mirroring the symmetry metric on
      the shared `SIDE_FIT_QUALITY_DISPARITY_R2`, amplitude wording. Exemplars:
      `selectExemplars([...buildSideExemplar('left'…), ...buildSideExemplar('right'…)])`, kind
      `'armSwingCycle'` reused (D4).
- [ ] 3.2 Doc edits (Phase B only): widen `types.ts` `'armSwingCycle'` member doc to name both
      consumers; widen `armSwingMinFitR2`'s doc to name its second consumer.
- [ ] 3.3 `src/heuristics/armSwingAmplitude.test.ts` (synthetic-sinusoid fixtures per
      `armSwingSymmetry.test.ts`): exact clean value (mean of asymmetric sides, known
      amplitude/torso by construction), weaker-side R² gate → null, frequency mismatch → null,
      shoulders+wrists resolve but hips never → body-scale caveat, zero-torso guard, side view
      computed-but-unsuitable, empty frames, disparity caveat fires, exemplar kind/label/sides,
      never-NaN.

## 4. Fan-out + count sweep (twelve → thirteen)

- [ ] 4.1 `src/heuristics/types.ts`: `MetricId` += `'armSwingAmplitude'` appended last (after
      `'kneeDrive'`); `FormHeuristicsResult.armSwingAmplitude` appended last;
      `viewFitTable.armSwingAmplitude` row appended, COPYING `armSwingSymmetry`'s row exactly
      with a comment saying so. No new config key.
- [ ] 4.2 `src/heuristics/index.ts`: wire `armSwingAmplitude` appended last; doc counts twelve →
      thirteen.
- [ ] 4.3 `npx tsc -b`; fix every surfaced site: `fuseHeuristics.ts` both lists + test fixtures;
      `metricConfidence.ts` `METRIC_LABELS` += `'Arm swing amplitude'`; `MetricsPanel.tsx`
      `METRIC_DESCRIPTIONS` (amplitude-proxy copy, distinct-from-symmetry sentence) + metrics
      array + doc count; `MetricsPanel.test.tsx` + counts 12 → 13; `index.test.ts` 'gates all
      thirteen'; remaining fixture builders as surfaced.
- [ ] 4.4 Count sweep via `grep -rn "twelve" src/ CLAUDE.md AGENTS.md` — TRUE sites:
      `viewPlausibility.ts:127-128`, `exemplars.ts:468`, `index.ts:20/22/39`,
      `extractFrames.ts:66`, `analysisDiagnostics.ts:61`, `evidenceFrames.ts:1502-1503`,
      `useSessionEvidence.ts:193`, `MetricsPanel.tsx:349`, `index.test.ts:234`,
      `MetricsPanel.test.tsx:238`, `CLAUDE.md:621`. FALSE positives, LEAVE (verify context):
      `evidenceFrames.ts:660`, `evidenceFrames.test.ts:2436`, `scalePassGraft.ts:79`
      ("twelve grafted exemplar instants"), `form-heuristics` spec's own false positive.
      AGENTS.md carries no counts. Do NOT hand-edit `openspec/specs/`.

## 5. Phase B verification

- [ ] 5.1 `npm test`, `npx tsc -b`, `npm run lint` — all clean.
- [ ] 5.2 Rerun the Step-0 command → `wave2/afterB.txt`; expected diff vs baseline: ONLY the
      header commit line, `elapsedMs` rows, and ADDED `armSwingAmplitude` rows (metric values +
      `evidence.armSwingAmplitude.*` status on all three clips; exemplars Demo 2 only).
      `armSwingSymmetry` explicitly bit-identical. Adjudicate every D3 rule and record in
      design.md D3.
- [ ] 5.3 Anchor driver re-check: `verticalOscillationCm 4.421467928439415`,
      `fit.frequencyHz × 60 = 91.2 == cadence`.

## 6. Ship + archive (NOT this pass — after code review)

- [ ] 6.1 `openspec archive add-arm-swing-amplitude-metric --yes` after ship + verify; close the
      bead per the epic's flow.
