# Tasks

## 0. Blocking precondition (measured before any code)

- [x] 0.1 Hand-driven Playwright run, real GPU, capturing BOTH `[analysis-diagnostics]` and
  `[analysis-diagnostics:scale-pass]`, across demo1 / demo2 / `multiperson-track.mp4`. Record per
  clip, per pass: `personSelection.status`/`skipReason`/`segmentCount`/`segments[0]`, plus
  `sampling.detectedFrames`/`totalSamples`/`path`. (`scripts/ab-person-selection.mjs` drops the
  scale-pass line and cannot do this.)
- [x] 0.2 Evaluate S1: the scale pass must reach `personSelection.status === 'selected'` on all
  three clips. **Failure is R4 — escalate to epic #52, do not ship a check that can never fire.**
  Result: PASSES on all three. Table in design.md.
- [x] 0.3 Record the measured same-person cross-backend `segments[0].medianAreaPx` ratio against
  the `maxAreaRatio: 4` band, and bound `comparedInstants` from the two passes' detected counts.

## 1. `src/results/scalePassSubjectAgreement.ts` (new)

- [x] 1.1 Export `SubjectAgreement` (`status`, `reason`, `comparedInstants`, `agreeingInstants`)
  and `assessScalePassSubjectAgreement(primary, scale, bounds)`.
- [x] 1.2 Three module constants with D3's derivations in their doc comments:
  `MAX_PAIRING_GAP_SECONDS = 0.1`, `MIN_COMPARABLE_INSTANTS = 10`, `MIN_AGREEING_FRACTION = 0.5`.
  **No new geometric constant** — the per-instant predicate reuses the caller's bounds.
- [x] 1.3 Skip-path branch first (D4): either side not `'selected'` → no opinion with the typed
  reason and `comparedInstants: 0`.
- [x] 1.4 Per-array `(timestamp, box)` extraction via `deriveBoundingBox` over `status ===
  'detected'` keypoints, at the bounds' own `minKeypointConfidence`/`minConfidentKeypoints`.
- [x] 1.5 Two-pointer nearest-neighbour pairing over the scale list (both arrays ascending —
  document the precondition the way `selectRetroactivePersonOfInterest` does).
- [x] 1.6 `isBoundingBoxContinuous(scaleBox, primaryBox, |Δt|, bounds)` per compared instant.
  **Primary is the `reference`** — the relation is not symmetric.
- [x] 1.7 Floor, then majority rule. Pure, no mutation of either input.

## 2. `src/results/types.ts`

- [x] 2.1 Add `subjectAgreement?: SubjectAgreement` to `ScalePassState`, following the
  `reason`/`error` "set only when…" idiom. Optional, so `multiClipAnalysis.ts`'s
  `{ status, diagnostics }` literal stays type-legal.
- [x] 2.2 Do NOT add it to `sameClipSession`'s comparator in `MultiClipVideoSession.tsx` — note the
  reasoning in design.md (D5) so a reviewer doesn't flag the omission.
- [x] 2.3 Do NOT add any field to `PersonSelectionSegmentDiagnostics`,
  `PersonSelectionDiagnostics`, `AnalysisDiagnostics`, or `ClipPipelineResult`.

## 3. `src/results/scalePassGraft.ts`

- [x] 3.1 Add `SCALE_PASS_SUBJECT_DIVERGENCE_CAVEAT`, worded to read correctly after the
  provenance sentence.
- [x] 3.2 Add `withSubjectDivergenceCaveat(result)`, appending to `verticalOscillationCm` and
  `stepWidthCm` only. Duplicate the three-line `.filter(Boolean).join(' ')` idiom rather than
  lifting a shared helper — three similar lines beat a premature abstraction.
- [x] 3.3 `withProvenance` and `graftScalePassResult` unchanged.

## 4. `src/results/useVideoAnalysis.ts` (the only behavioural edit)

- [x] 4.1 Lift `state.robustFrames` and `state.diagnostics` alongside `primaryHeuristics`, and
  make the guard's message name the precondition that actually failed. **Kept as ONE guard block
  with a ternary message rather than two sequential early returns** — the split shape trips
  `react-hooks/set-state-in-effect`, bisected against a clean baseline; see design.md D4b.
- [x] 4.2 Destructure `robustFrames: scaleRobustFrames` from the scale pass's pipeline result and
  update the now-false comment saying they aren't retained.
- [x] 4.3 After the calibration gate, before the graft: call
  `assessScalePassSubjectAgreement` with the run's already-resolved
  `samplingRobustnessConfig.personSelection`, then compose
  `withSubjectDivergenceCaveat` over the graft only on `'diverged'`.
- [x] 4.4 Write `heuristics: displayed` and `scalePass: { status: 'done', diagnostics, subjectAgreement }`.
- [x] 4.5 Add `state.robustFrames` and `state.diagnostics` to the effect's dep array.

## 5. Dev console line

- [x] 5.1 Destructure and conditionally spread `subjectAgreement` into the scale-pass payload,
  matching the existing `reason`/`error`/`diagnostics` conditional-spread pattern. No new prefix.

## 6. Tests

- [x] 6.1 `src/results/scalePassSubjectAgreement.test.ts` (new): identical tracks; same person with
  offset timestamps and modestly different boxes; disjoint boxes; ~10× area ratio at the same
  centre; each of the four skip reasons on each side; never-pairable timestamps; **9 comparable
  instants all disagreeing → no-opinion**; **boundary 10/5 → agreed, 10/4 → diverged**; frames whose
  keypoints are all interpolated/unrecoverable contribute nothing; no mutation.
- [x] 6.2 `src/results/scalePassGraft.test.ts` (extend, don't edit existing):
  `withSubjectDivergenceCaveat` appends to the two metrics only, leaves everything else
  reference-identical, composes after provenance, handles a `null` caveat, and asserts the constant
  verbatim.
- [x] 6.3 `src/results/useVideoAnalysis.test.ts` — three new cases only (agree / diverge / either
  side skipped). **Every existing scale-pass test in this file must pass UNMODIFIED — treat any
  edit needed there as a signal the gate is wrong (R5).**

## 7. Documentation

- [x] 7.1 CLAUDE.md: the `[analysis-diagnostics:scale-pass]` payload shape gains
  `subjectAgreement`, with a one-line note that it is this check's observable.
- [x] 7.2 CLAUDE.md: "primary/scale-pass selection divergence … knowingly accepted" now names #56
  as closed.
- [x] 7.3 `retroactivePersonSelection.ts`'s doc block: divergence is no longer an open accepted
  cost. Doc-only touch — #55 edits the same block, so keep it surgical.

## 8. Gates

- [x] 8.1 `npm test`, `npm run build`, `npm run lint` all green.
- [x] 8.2 `openspec validate detect-scale-pass-subject-divergence --strict` passes.

## 9. Live verification

- [x] 9.1 3 trials × 3 clips, capturing `subjectAgreement` from the scale-pass line. Evaluate S2,
  S3, S4 and R1–R3, R6. Result: `agreed` on 9/9 runs, `comparedInstants` 53/99/114, minimum
  agreeing fraction 0.9649. S2/S3/S4 pass; R1/R2/R3/R6 clear. Table in design.md.
- [x] 9.2 Opportunistic true-positive attempt on `multiperson-track.mp4`. **Did NOT fire**, as
  predicted — `agreed` at 0.9649 every trial, because MediaPipe's `numPoses: 1` shares the area
  scorer's largest-subject bias. Reported as a known unverified direction, not as a passed
  criterion. No threshold was loosened.
