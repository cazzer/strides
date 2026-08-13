# Tasks — plain-language metric copy

## 1. Spec deltas

- [x] 1.1 MODIFIED form-heuristics requirements loosening fit-quality/backend caveat pins to
      plain-language meaning (spectral-fit VO, cadence, vertical ratio, VO-cm availability)
- [x] 1.2 MODIFIED results-view requirements loosening the availability-caveat parenthetical,
      the provenance-sentence parenthetical, and the scale-pass hint/narrative wording
- [x] 1.3 `openspec validate plain-language-metric-copy --strict` passes

## 2. Copy rewrites (strings only; identical firing conditions)

- [x] 2.1 `MetricsPanel.tsx`: VO-cm description drops backend talk; excluded-entry hints say
      "second look at the clip" instead of "second (detection) pass"
- [x] 2.2 `ResultsView.tsx`: scale-pass status narrative in plain words
- [x] 2.3 `scalePassGraft.ts`: provenance caveat simplified, no backend names; doc comment kept
      accurate
- [x] 2.4 `footStrikePattern.ts`: proxy caveat drops the pipeline-capability clause
- [x] 2.5 `cadence.ts`: below-gate null caveat, fit-quality caveat, and grid-edge caveat in
      plain words (no R², no threshold, no Hz band)
- [x] 2.6 `verticalOscillation.ts`: below-gate null caveat and fit-quality caveat in plain words
- [x] 2.7 `verticalRatio.ts`: below-gate null caveat, fit-quality caveat, and dropped-pairs
      caveat in plain words
- [x] 2.8 `verticalOscillationCm.ts`: availability caveat, below-quality-gate and
      degenerate-signal fit-failure caveats, fit-quality caveat, multi-run caveat, and
      scale-coverage caveat in plain words

## 3. Tests

- [x] 3.1 Update every assertion/fixture pinning old wording (cadence, verticalOscillation,
      verticalOscillationCm, MetricsPanel, ResultsView, scalePassGraft, analysisDiagnostics
      tests) to the new copy — no assertion deleted without replacement, none weakened to
      always-pass
- [x] 3.2 Sweep `src/` for stale fragments of every old phrasing ("fit quality", "Hz range",
      "second pass"/"second detection pass", "scale-aware", "pose-detection backend",
      "ground-plane", "tracked stretches", "considered frames", "unresolvable hip position")

## 4. Verification

- [x] 4.1 `npx tsc --noEmit` clean
- [x] 4.2 `npx vitest run` full suite green
- [x] 4.3 Live check on the park demo clip: after analysis + scale pass, page text contains none
      of "backend", "MediaPipe", "MoveNet", "pipeline", "fit quality", "Hz", "scale-aware",
      "ground-plane", "tracked stretches"; card caveats captured for the report
