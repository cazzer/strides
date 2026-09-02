## 1. OpenSpec skeleton with pre-registered probe rules

- [x] 1.1 `openspec/changes/add-knee-drive-metric/`: `proposal.md`, `design.md` (D1–D6, decision
      rules pre-registered, measurements pending), `tasks.md`, spec deltas (`form-heuristics`
      ADDED ×3, `results-view` MODIFIED ×1: eleven → twelve).
- [x] 1.2 `openspec validate add-knee-drive-metric --strict` passes. Commit the skeleton BEFORE
      the probe runs, so pre-registration is verifiable.

## 2. Empirical probe (add–measure–revert)

- [x] 2.1 `src/heuristics/kneeDrive.experimental.ts`: `probeKneeDrive(frames, config)` — per-leg
      signed/unsigned thigh-angle series, prominence ladder on both, kneeFlexion replica maxima,
      raw θs series. One dev-only `console.log('[knee-drive-probe]', ...)` in
      `useVideoAnalysis.ts`'s diagnostics effect.
- [x] 2.2 Throwaway scratchpad driver: TWO fresh-process Demo 1 trials (+ optional multiperson
      corroboration), capture `[knee-drive-probe]`.
- [x] 2.3 Adjudicate D1's pre-registered rule (a/b), plausibility gate, STOP/escalate rule vs
      kneeFlexion instants, sample-count gate. Record measurements + verdict in design.md
      D1/D4/D6.
- [x] 2.4 Revert instrumentation: `git checkout -- src/results/useVideoAnalysis.ts && rm
      src/heuristics/kneeDrive.experimental.ts`. Re-validate. Commit "design: record knee-drive
      probe measurements".

## 3. Types

- [ ] 3.1 `src/heuristics/types.ts`: `MetricId` += `'kneeDrive'` appended last;
      `FormHeuristicsResult.kneeDrive` appended last; `viewFitTable.kneeDrive` row (sagittal-plane
      comment, D3); `kneeDriveMinProminenceDegrees` config key with probe-derived default +
      `DEFAULT_HEURISTICS_CONFIG` entry; `MetricExemplarKind` += `'kneeDrivePeak'` with doc
      comment.

## 4. `kneeDrive.ts`

- [ ] 4.1 New `src/heuristics/kneeDrive.ts` modeled on `kneeFlexion.ts`: per-leg hip→knee series
      via `resolvePoint`, probe-chosen angle (D2), `findLocalExtrema(series,
      config.kneeDriveMinProminenceDegrees)`, maxima pooled both legs, median,
      `computeMetricConfidence` with `MIN_KNEE_DRIVE_SAMPLE_SIZE = 4`, unsuitable-view caveat via
      `viewPhrase`, `buildExemplars` pairing the median-nearest peak with its same-leg
      `adjacentMinimum` trough (drop when no trough). If D1 lands on (b): `estimateTravelDirection`
      per trunkLean's pattern; direction 0 → `value: null` with a distinct caveat.
- [ ] 4.2 `src/heuristics/kneeDrive.test.ts` with its OWN frame builder (rotating fixed-length
      thigh about a fixed hip — the shared syntheticGait fixture places knees at the hip–ankle
      midpoint, making thigh angle fore-aft symmetric). Cover: exact-value clean case, front-view
      computed-but-unsuitable, never-lifts → null + caveat, unresolvable → null, exemplar pairing
      + label, and (if b) indeterminate-direction → null.

## 5. Orchestration + enumeration fan-out

- [ ] 5.1 `src/heuristics/index.ts`: wire `kneeDrive` appended last; doc counts eleven → twelve.
- [ ] 5.2 `npx tsc -b`; fix every compiler-surfaced site: `fuseHeuristics.ts` both lists + test
      fixtures; `metricConfidence.ts` `METRIC_LABELS` (`'Knee drive'`); `MetricsPanel.tsx`
      `METRIC_DESCRIPTIONS` (honest thigh-lift copy) + metrics array + doc count;
      `MetricsPanel.test.tsx` title/count assertions 11 → 12; `index.test.ts` 'gates all twelve
      metrics' + never-throws + fully-populated tests; remaining fixture builders as tsc surfaces
      them.
- [ ] 5.3 `evidenceAnnotations.ts`: `EvidenceMarkRole` += `'kneeDriveArc'`; `buildKneeDriveMarks`
      (thigh both roles; base only: down-vertical `'verticalReference'` ray at hip + arc; widen
      `'verticalReference'`'s doc to name both directions); register in `INSTANT_MARK_BUILDERS`;
      `measuredAtInstant` ghost-unmeasured branch; test coverage.
- [ ] 5.4 `evidenceFrames.ts`: `'kneeDrivePeak'` into `SINGLE_INSTANT_KINDS` with doc argument +
      the prose enumerations; test.
- [ ] 5.5 Count sweep driven by `grep -rn "eleven" src/ CLAUDE.md AGENTS.md`:
      `analysisDiagnostics.ts`, `viewPlausibility.ts`, `exemplars.ts`, `extractFrames.ts`,
      `evidenceFrames.ts` (:1498-1499 only — :245 is a false positive), `useSessionEvidence.ts`,
      CLAUDE.md. Leave `form-heuristics/spec.md:2254` (false positive). Do NOT hand-edit
      `openspec/specs/` — the delta fixes results-view at archive time.

## 6. Verification

- [ ] 6.1 `npm test`, `npx tsc -b`, `npm run lint` — all clean.
- [ ] 6.2 Rerun the exact Phase-0 baseline driver command → after.txt; `diff baseline.txt
      after.txt` shows ONLY the provenance commit line + ADDED kneeDrive rows (value on demo1 +
      multiperson, exemplar on at least Demo 1, tier-3 excluded on demo2); every pre-existing
      metric value/confidence bit-identical.
- [ ] 6.3 Rerun the scale-pass anchor driver: VO_cm 4.421467928439415, fit 1.52 × 60 = 91.2 ==
      cadence, unchanged.
