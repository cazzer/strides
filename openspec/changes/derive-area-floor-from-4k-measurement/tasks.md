# Tasks

## 0. Pre-register before measuring

- [x] 0.1 Create the change and write `proposal.md`, `design.md`, `specs/person-selection/spec.md`
  and this file **before any measurement exists**, with the four endpoints as named unknowns
  (`G4`, `S4`, `G1`, `S1`) and the chosen value as `f`.
- [x] 0.2 Write the pre-registered criteria (A/B/C/D and the seven do-not-ship conditions) and the
  margin ship rule into `design.md` verbatim, before any number exists.
- [x] 0.3 Confirm the current rejection-bucket accounting identity against
  `retroactivePersonSelection.ts` rather than against a stale note — #55 added
  `rejectedOutsideEvidence` as a fourth bucket.
- [x] 0.4 `openspec validate derive-area-floor-from-4k-measurement --strict`.

## 1. Add the temporary probe (add-measure-revert cycle)

- [x] 1.1 New `src/results/boundingBoxTrace.experimental.ts` — `traceBoundingBoxes(samples,
  frameWidth, frameHeight, config)` returning `{ frameWidth, frameHeight, frameArea, totalSamples,
  detectedSamples, boxlessSamples, detections: [{ t, a, cx, cy, w, h, n, s }] }`. Reuse
  `deriveBoundingBox` / `bboxArea` / `meanConfidence` from `movenetCrop.ts` with the SAME
  `minKeypointConfidence` / `minConfidentKeypoints` the stage passes, so the trace is exactly the
  box the stage sees. **No floor applied** — every box-yielding detection is reported, which is
  what makes the trace independent of the value under test.
- [x] 1.2 One dev-only `console.log('[bbox-trace]', JSON.stringify(...))` in
  `src/results/useVideoAnalysis.ts`, immediately BEFORE the PRIMARY `runClipAnalysisPipeline(`
  call. Primary pass only — the scale-pass call is deliberately not probed (that pass's selection
  is #56's subject). `runClipAnalysisPipeline.ts` stays untouched, so exactly one trace line is
  emitted per run.
- [x] 1.3 New, temporary `scripts/bbox-trace-harvest.mjs`, mirroring
  `scripts/ab-person-selection.mjs`'s scaffolding (import `playwright.config.ts` for launch args /
  baseURL / dev-server command, refuse a server it did not start, refuse SwiftShader, drive
  `/demo 1/i`, `/demo 2/i`, or the Upload tab). Flags: `--clip`, `--file`, `--trials`, `--port`,
  `--timeout`, `--reuse-server`, `--json`.
- [x] 1.4 **Do NOT edit `scripts/ab-person-selection.mjs`.** It is shared by four #52 tickets and
  every A/B in the epic must stay comparable.

## 2. Measure — NEEDS THE VERIFICATION LANE

- [ ] 2.1 `--port 5199` on every invocation.
- [ ] 2.2 Harvest traces: 3 trials × {demo1, demo2, multiperson}, no config override.
- [ ] 2.3 Fetch the clips for keyframe extraction into the scratchpad, never the repo (Demo 1 from
  Pexels per `DemoVideoButton.tsx`; Demo 2 is `src/video/demo-clips/park-approach.mp4`, portrait
  4K; multiperson is `e2e/fixtures/multiperson-track.mp4`, 1920×1080).
- [ ] 2.4 Classify: per clip, the N smallest detections inside the winner's span and the N largest
  outside it; `ffmpeg -i clip.mp4 -ss <t> -frames:v 1 -q:v 3 out.png` (output seeking) per
  timestamp, and read the PNGs. Label each phantom / genuine-subject / bystander. **This is the
  step that produces `G4`, `S4`, `G1`, `S1`, and the step a sweep cannot replace.**
- [ ] 2.5 Record per-clip, per-trial distributions and the four endpoints in `design.md`, each
  endpoint carrying its timestamp and keyframe verdict.

## 3. Derive and decide

- [ ] 3.1 Compute both windows, apply the margin rule, `f = √(lower × upper)` to 2 s.f.
- [ ] 3.2 Model verdict. Overlap with ratio ≥ 4 → D1 stands, no fraction-requirement delta.
  Disjoint → run the controlled downscale pair, then switch to the REMOVE + ADD branch.
- [ ] 3.3 Margin fails → STOP. Write up the measurement, re-accept `2e-4`, close #57 with recorded
  evidence, say so in `design.md`. **An accepted outcome, not a failure.**

## 4. Revert the probe, then implement

- [ ] 4.1 Revert the probe BEFORE any A/B arm runs, so the A/B measures the shipped code path
  exactly: `git checkout -- src/results/useVideoAnalysis.ts`, `rm
  src/results/boundingBoxTrace.experimental.ts scripts/bbox-trace-harvest.mjs`. Keep the diff in
  the scratchpad. Verify `grep -rn "bbox-trace" src scripts e2e` returns nothing.
- [x] 4.2 **Decouple the algorithm suite from the shipped number.** Add
  `minBoundingBoxAreaFraction: 2e-4` explicitly to the test-local `CONFIG` in
  `retroactivePersonSelection.test.ts` alongside `enabled: true`, extending the existing comment's
  rationale to the area fraction, so `FLOOR_1080P`, `ABOVE_FLOOR_SIDE` / `BELOW_FLOOR_SIDE`, the
  3,600 px² bystanders and the 1,600 px² alternating fixture all keep their meanings and no future
  default change can silently reclassify a fixture. Check `runClipAnalysisPipeline.test.ts`'s
  `SELECTING` the same way and pin there too if any assertion flips.
- [ ] 4.3 Set the derived value, and rewrite the derivation comment in
  `retroactivePersonSelection.ts` with the four measured endpoints, both resolved absolute floors,
  both margins, and the classification evidence. Rewrite the paragraph that currently says Demo 1
  keeps `segmentCount >= 2` "until #57's re-derived floor demotes them" into the record of the
  joint #54 + #57 outcome. Extend `minBoundingBoxAreaFraction`'s field doc to say what the number
  is sized against (the model rationale there is unchanged and correct).
- [ ] 4.4 Add the four pinning tests (P1–P4, design.md D4), all against
  `DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG` directly. Update `FLOOR_1080P`'s comment to say it
  is the *test-local* fraction. Confirm the resolution-independence test still passes and leave it
  alone.

## 5. Verify live — NEEDS THE VERIFICATION LANE

- [ ] 5.1 4-arm A/B via `scripts/ab-person-selection.mjs`, `--clips demo1,demo2,multiperson
  --trials 3 --port 5199`. The baseline arm must spell out the OLD value
  (`{"personSelection":{"minBoundingBoxAreaFraction":2e-4}}`), not `{}` — once 4.3 lands, `{}` is
  the new default. Arms: `base`, `chosen` (`f`), `half` (`f/2`), `double` (`f×2`).
- [ ] 5.2 A 1-arm confirmation after 4.3 lands: `--arm 'shipped={}'` must reproduce the `chosen`
  column. That is the proof the default edit and the measured arm are the same thing.
- [ ] 5.3 `npm test`, `npm run build`, `npm run lint`.
- [ ] 5.4 Fill `design.md`'s "Measured results" and gate-by-gate verdict;
  `openspec validate derive-area-floor-from-4k-measurement --strict`. **Do NOT archive** — report.
