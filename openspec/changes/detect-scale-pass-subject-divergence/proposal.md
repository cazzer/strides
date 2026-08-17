# Detect primary/scale-pass subject divergence before grafting (issue #56, epic #52 item 3)

## Why

`useVideoAnalysis.ts` runs `runClipAnalysisPipeline` twice per analysis — once for the primary
pass and once for the background MediaPipe scale pass. Each runs retroactive person selection
independently, over a different sample sequence from a different backend, and each commits to its
own subject identity. **Nothing reconciles the two.**

So if MoveNet-primary's winner is the runner and the scale pass's own integrated-area winner is a
bystander, `graftScalePassResult` writes *that bystander's* `verticalOscillationCm` and
`stepWidthCm` onto a result whose other seven metrics describe the runner — silently, with no
caveat, displayed as one person's form report. The graft's existing gate only asks whether the
pass measured a real-world scale *at all*; it has no notion of *whose*.

Latent before the retroactive person-selection stage shipped (both passes took the
`skipReason: 'disabled'` path and agreed trivially). Live now.

### The sketched fix does not work

Epic #52 and the archived design both proposed "compare `segments[0]`'s span between the two
diagnostics." That is largely vacuous as the diagnostics are shipped:
`PersonSelectionSegmentDiagnostics.startTimestamp`/`endTimestamp` are the **partition** span, not
the winner's evidence span, and the block carries **no positional data at all**. A clip with
`segmentCount === 1` has a winner span of the whole clip on both passes and overlaps trivially.

Measured live on this branch (Step 0, real GPU) — the same-subject Demo 1 clip already produces
**disagreeing partition spans across the two passes**: primary `[0.08, 6.32]` vs. scale
`[0.08, 9.16]`, for indisputably the same runner. A span comparison would fire a false positive on
this repo's own regression-anchor clip.

## What Changes

- **A new pure module, `src/results/scalePassSubjectAgreement.ts`.** It compares the two passes'
  *surviving* bounding boxes **at matched timestamps** — the only comparison that controls for the
  two winners being aggregates over different sample sets. At a common instant the same person has
  the same apparent size and image position regardless of backend, so span-dependence vanishes by
  construction and positional plus scale evidence arrive together.
- **The predicate is the existing `isBoundingBoxContinuous`**, this codebase's single answer to
  "could these two boxes be the same person," fed the run's own already-resolved
  `personSelection` bounds. **No new geometric constant.** Three module constants only:
  `MAX_PAIRING_GAP_SECONDS = 0.1`, `MIN_COMPARABLE_INSTANTS = 10`, `MIN_AGREEING_FRACTION = 0.5`.
- **Both passes must report `personSelection.status === 'selected'`** for an opinion to exist at
  all. Otherwise: no opinion, graft unchanged, with a typed reason.
- **Remedy on divergence: a caveat, not suppression.** One string constant plus one more
  `.filter(Boolean).join(' ')` term, appended to the two grafted metrics'
  caveats. **Zero UI-component changes** — it reaches the user through elements both rendering
  paths already have.
- **`ScalePassState` gains one optional field, `subjectAgreement`**, emitted on the existing
  `[analysis-diagnostics:scale-pass]` console line so the *margin* is readable on every dev run,
  not just a boolean.

### What deliberately does not change

- **No field is added to `PersonSelectionSegmentDiagnostics`, `PersonSelectionDiagnostics`,
  `AnalysisDiagnostics`, or `ClipPipelineResult`.** The signal needs none — it reads
  `RobustPoseFrame.keypoints[i].status === 'detected'`, which is set only on frames that survived
  person selection, and at the shipped defaults reproduces the boxes that stage scored (see
  design.md D1 for the one condition that qualifies on). This also keeps the merge surface with
  #55 and #57 at zero.
- `graftScalePassResult`'s signature and body are untouched, so its module contract ("its gate
  lives at the call site") stays literally true. The check lives at the call site.
- `src/results/retroactivePersonSelection.ts` is touched for documentation only.

## Impact

- Affected specs: `results-view` (the graft requirement, plus one new requirement),
  `analysis-diagnostics` (the scale-pass console line's payload).
- Affected code: `src/results/scalePassSubjectAgreement.ts` (new),
  `src/results/scalePassGraft.ts` (one constant, one exported function),
  `src/results/types.ts` (one optional field), `src/results/useVideoAnalysis.ts` (the call site
  and the dev console line).
- **Not affected:** `src/pose/backends/movenetCrop.ts`, `scripts/ab-person-selection.mjs`, and
  every UI component. `retroactivePersonSelection.ts` is doc-only.
