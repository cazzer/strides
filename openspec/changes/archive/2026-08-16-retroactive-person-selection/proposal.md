# Retroactive person-of-interest selection (issue #51, Stage 1)

## Why

The pipeline regularly attributes another person's biomechanics to the runner being analyzed.

Today's tracker is **online and causal**: it decides who to follow frame by frame, having seen only
the past, and cannot revisit that decision. Every mechanism built so far — the post-acquisition
settle window, periodic re-verification, the steady-state continuity gate — is a patch on that
structural limitation.

The measured trace on `e2e/fixtures/multiperson-track.mp4` (issue #51, 2026-08-16, real GPU) makes
the point in its strongest form:

| span | tracked | bbox area | centre x |
|---|---|---|---|
| t=0.05–2.05 | background crowd | 1,000–8,000 px² | 50–170 |
| t=0.47–0.93 | *nothing real* — degenerate detections | 5–183 px² | fixed at 493 |
| t=2.15–3.55 | **the runner** | 17,000–49,000 px² | 1248 → 25 |
| t=3.57–3.90 | background crowd | 2,000–10,000 px² | 110–130 |

The runner is tracked for ~1.4s of a 3.9s clip. **No online fix can work here**: acquisition runs
on frame 1, and on frame 1 the runner is not in the frame at all — they enter from the right at
~t=2.1. The acquisition heuristic correctly picks the most prominent person present, which is a
bystander, and every mechanism downstream then defends that choice. The continuity gate added in
`anchor-continuity-gate` actively makes it worse, because it is doing its job against a wrong
anchor. This is not a tuning problem.

## What Changes

Analysis is **offline**. The whole clip exists before any metric is computed, so the subject can
simply be chosen later, with all the evidence in hand. Stop asking "who should I follow next?" and
start asking "who was this clip about?"

- **NEW capability `person-selection`**, one pure module (`src/results/retroactivePersonSelection.ts`):
  walk the sampled sequence, cut a segment boundary wherever consecutive detections are
  discontinuous, score each segment by **integrated bounding-box area** (area summed across its
  frames — duration and apparent size in one number, no weights to tune), keep the winner, and emit
  `null` for every frame in the losers.
- **A minimum bounding-box area floor**, expressed as a fraction of frame area rather than absolute
  px², so it means the same thing at 1080p and 4K. It discards the degenerate 5–183 px² detections
  the online gate currently accepts as an anchor.
- **The shared continuity predicate is extracted**: `isBoundingBoxContinuous` moves into
  `movenetCrop.ts` and both the online anchor gate and this stage's segmentation criterion call it,
  so "these two boxes are the same person" means exactly one thing in this codebase. Behaviour-
  neutral for the online path — no `pose-detection` spec delta.
- **Seam**: inside `runClipAnalysisPipeline`, immediately after the existing sort and before
  `applyRobustness`. Zero extra inference, zero extra decode, no new model. Pure post-processing on
  `PoseSample[]`; nothing downstream changes.
- **Config**: folded into `SamplingRobustnessConfig` as a nested `personSelection` key, mirroring
  `sequentialSampling`. No new `window` global.
- **Diagnostics**: `AnalysisDiagnostics` gains an always-present `personSelection` block.
  `sampling.detectedFrames` becomes post-selection by design; `personSelection.detectedSamplesIn`
  preserves the pre-selection number.

**Ships `enabled: true` — by explicit user decision on 2026-08-16, OVERRIDING the pre-registered ship rule, which fired.** The rule's own verdict was `enabled: false`: the stage does what it was built to do on the repro clip (picks the runner over two bystander spans by a 39-46x margin, bit-identically across three trials, correcting the sign of `trunkLean` and `footStrikePattern`), but it is **not** a no-op on the side-view demo clip — one badly-collapsed detection splits the runner's own continuous track and strands five real frames, 13-16 detected frames lost per run. Side view is this app's most common footage, so that cost is real and is knowingly accepted. The two open correctness items in design.md's Risks table were documented as prerequisites for enabling and are now live rather than pending. Revert via `window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = { personSelection: { enabled: false } }`. See design.md's "Pre-registered ship rule and its outcome".

## Impact

- Affected specs: `person-selection` (new), `analysis-diagnostics`, `sampling-robustness-config`,
  `results-view`.
- Affected code: `src/results/retroactivePersonSelection.ts` (new),
  `src/results/runClipAnalysisPipeline.ts`, `src/results/samplingRobustnessConfig.ts`,
  `src/results/analysisDiagnostics.ts`, `src/results/useVideoAnalysis.ts`,
  `src/pose/backends/movenetCrop.ts`, `src/pose/backends/movenet.ts`.
- **No behaviour change by default.** The stage is off; every clip analyses exactly as it did
  before, verified live on all three clips (3 trials each). The unit test covering the disabled
  path checks the seam rather than the whole result: `applyRobustness` and `computeFormHeuristics`
  are mocked, so what it proves is that with the stage off the samples handed to `applyRobustness`
  deep-equal the plain sorted input (nothing nulled, nothing reordered), that robustness' output
  reaches the caller unchanged, and that the `sampling` and `personSelection` diagnostics blocks
  match their pre-stage and `skipReason: 'disabled'` shapes exactly. It does not re-run the real
  downstream pipeline and compare finished metric values — the live A/B is what covers that.
- Out of scope (Stage 2, per issue #51): a multipose identity pass, gait-periodicity scoring, and a
  non-causal smoothed crop trajectory.
