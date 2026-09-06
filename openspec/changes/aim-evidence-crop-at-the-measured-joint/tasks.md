# Tasks

## 1. Name the joint

- [x] 1.1 Add optional `cropFocus: KeypointName` to `MetricExemplar`, documenting what it is for
      and why a relation-shaped exemplar names none.
- [x] 1.2 `kneeFlexion` names that side's knee on every candidate.
- [x] 1.3 `kneeDrive` names that side's knee on every candidate.

## 2. Aim the crop at it

- [x] 2.1 `focusAimedCropRect` in `evidenceFrames.ts` — clamp the aim into the positions that still
      contain the crop box, then into the frame; keep the existing placement where that interval is
      empty; never touch `side`.
- [x] 2.2 `computeEvidenceCropRect` takes an optional resolved focus point and, when given one,
      uses it INSTEAD of `subjectCentredCropRect`.
- [x] 2.3 `planExemplarFrames` resolves `cropFocus` at the BASE frame, passes it down, and carries
      `focusOffset` on the plan.
- [x] 2.4 `evidenceFocusOffset` — Chebyshev distance from the crop's centre, as a fraction of the
      side.

## 3. Break the tie on framing

- [x] 3.1 `kneeFlexion` and `kneeDrive` emit their whole ranked candidate list via the shared
      `attachPairAlternates`, instead of `slice(0, 1)`.
- [x] 3.2 `planExemplarWithFallback` orders drawable candidates by `(quality desc, focusOffset
      asc)` and stops as soon as no remaining candidate can match the quality already held.
- [x] 3.3 The demoted pool is ordered by the same rule, not by arrival.

## 4. Tests

- [x] 4.1 `focusAimedCropRect`: centres when there is room; takes precedence over subject-centring;
      never pushes the crop box out; stays in frame and is never worse than not aiming; no-ops on a
      frame-capped crop and an unusable frame size; never changes the side.
- [x] 4.2 `evidenceFocusOffset`: 0 at the centre, 0.5 at an edge, Chebyshev not Euclidean.
- [x] 4.3 The walk: prefers the better-framed of two equally-scored candidates; never lets framing
      outrank the score; orders the demoted pool too; leaves a focus-less exemplar on first-wins.
- [x] 4.4 Both knee metrics: name the knee, and offer ranked one-level-deep alternates.
- [x] 4.5 Falsified — disabling the aiming branch fails exactly the two behavioural aiming tests,
      and disabling the framing comparison fails exactly the two tie-break tests.

## 5. Verify live

- [x] 5.1 Measure knee `fx`/`fy` per clip before and after with a temporary `[crop-probe]`, fresh
      Chromium per clip, real GPU — then REVERT the probe.
- [x] 5.2 Look at the rendered canvases at the real 142 px inline size, before and after, on both
      side clips.
- [x] 5.3 Check `multiperson-track.mp4` for the bystander-promotion risk
      `subjectCentredCropRect`'s doc names.
- [x] 5.4 Three-clip `--evidence` A/B; confirm nothing outside `evidence.*` for the two knee
      metrics moves, with `rtk proxy diff` plus an `md5` cross-check.

## 6. Gates

- [x] 6.1 `npx tsc -b` — one pre-existing error (`vite.config.ts(10,1)`, `strides-3rp`), no others.
- [x] 6.2 `npm run lint`.
- [x] 6.3 `npx vitest run` — 1490 passing (baseline 1477).
- [x] 6.4 `openspec validate aim-evidence-crop-at-the-measured-joint --strict`.
