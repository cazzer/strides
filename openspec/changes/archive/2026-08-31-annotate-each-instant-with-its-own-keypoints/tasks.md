# Tasks

## 1. Give the exemplar a per-instant annotation set

- [x] 1.1 Add `annotationKeypoints` / `pairedAnnotationKeypoints` to `MetricExemplar`, documenting
      that the crop set is a property of the image and the annotation set a property of the instant.
- [x] 1.2 State the omit-and-fall-back rule, and that the fallback is independently correct.
- [x] 1.3 State that the fields are REQUIRED wherever `measuredSide !== pairedMeasuredSide`.
- [x] 1.4 State that the set is NOT recoverable by side-filtering `cropKeypoints`, naming
      `stepWidth`'s single exemplar as the live counterexample.
- [x] 1.5 Add both fields to `alternates`' "genuinely vary per pair" enumeration.

## 2. Emit them from the two mixed-side producers

- [x] 2.1 `overstriding.ts`: each instant's own seed plus that instant's own knee, filtered against
      that instant's own frame.
- [x] 2.2 Leave `overstriding.ts`'s `cropKeypoints` call byte-identical.
- [x] 2.3 Update `KNEE_NAME`'s comment — "Exemplar crop context only" is no longer true.
- [x] 2.4 `stepWidthExemplars.ts` PAIR path: each instant's own seed, no context.
- [x] 2.5 `stepWidthExemplars.ts` SINGLE path: emit neither field, and record in the existing
      comment that the omission is deliberate.

## 3. Read them in the plan

- [x] 3.1 Add `resolveInstantAnnotationKeypoints(exemplar, role)` next to `resolveInstantSide`,
      documenting the fallback, why it is not derived by filtering, and how it differs from
      `resolveInstantKeypoints`.
- [x] 3.2 Point `instantPlan`'s `keypoints` at it.
- [x] 3.3 Update `EvidenceInstantPlan.keypoints`'s doc: "Deliberately the exemplar's
      `cropKeypoints`" is now false.
- [x] 3.4 Leave all three CROP call sites untouched — they must keep the union.

## 4. Tests

- [x] 4.1 `evidenceFrames.test.ts`: direct `resolveInstantAnnotationKeypoints` units — per-instant
      wins, each role falls back independently, absent → `cropKeypoints`.
- [x] 4.2 `evidenceFrames.test.ts`: a mixed-foot `overstrideRange` plan whose `base.keypoints` and
      `ghost.keypoints` name DISJOINT legs.
- [x] 4.3 `evidenceFrames.test.ts`: crop invariance — `plan.crop` deep-equals the crop planned from
      the same exemplar with the annotation fields stripped.
- [x] 4.4 `evidenceAnnotations.test.ts`: for `overstrideRange` AND `stepWidthStrike`, joint op names
      on `base` are the measured leg plus both hips, on `ghost` the other leg plus both hips, and no
      bone touches the unmeasured side.
- [x] 4.5 `evidenceAnnotations.test.ts`: the risk guard — same plan built twice from one fixture,
      with and without the annotation fields; MEASUREMENT-layer op roles per instant IDENTICAL,
      joint/bone ops differ.
- [x] 4.6 `evidenceAnnotations.test.ts`: explicit `ankleOffsetCaliper` presence on base and ghost for
      both metrics.
- [x] 4.7 `overstriding.test.ts`: same-side fixture asserts both fields present and equal to each
      other and to `cropKeypoints`; alternates loop asserts them the way it already asserts
      `measuredSide`; a comment records why the mixed-foot case is covered downstream.
- [x] 4.8 `stepWidth.test.ts` / `stepWidthCm.test.ts`: on the `alternateFeet` pair, both sets present
      and ankle-disjoint, `cropKeypoints` still the 4-name union.
- [x] 4.9 `stepWidth.test.ts` / `stepWidthCm.test.ts`: on the demoted single, `annotationKeypoints`
      ABSENT and `cropKeypoints` still carrying the opposite ankle.
- [x] 4.10 `exemplars.test.ts`: source-scan hygiene — any `src/heuristics/` module containing
      `pairedMeasuredSide:` also contains `pairedAnnotationKeypoints:`.
- [x] 4.11 Run the FULL suite, not a spot-check: `joints()` iterates insertion order and there are
      order-sensitive `toEqual` assertions in two annotation test files.

## 5. Mutation checks

Each producer is caught at the METRIC layer and by the hygiene scan, not at the plan layer — the
plan- and annotation-layer tests build their mixed-side exemplars by hand (design D8), so they
cannot see a producer stop emitting. Reverting the plan layer is what those two catch. Recorded as
measured rather than as expected:

- [x] 5.1 Revert `overstriding.ts`'s two fields alone → **4 failures**: the same-side and crop
      assertions in `overstriding.test.ts`, its alternates loop, and `exemplars.test.ts`'s hygiene
      scan.
- [x] 5.2 Revert `stepWidthExemplars.ts`'s two fields alone → **3 failures**: the pair assertions in
      `stepWidth.test.ts` and `stepWidthCm.test.ts`, and the hygiene scan.
- [x] 5.3 Revert `evidenceFrames.ts`'s `instantPlan` line alone → **5 failures**: the mixed-foot plan
      test, and all four mixed-side annotation tests (both metrics × own-limb and no-mark-lost).

## 6. Verify live

- [x] 6.1 Demo 1 `overstriding` coverage identical to the pre-fix baseline, every field.
- [x] 6.2 Look at the Overstriding card: two ankle markers, one leg chain per body, opposite sides.
- [x] 6.3 Demo 2 `stepWidth`: two ankle markers, hip-width segment / plumb / caliper on both halves.
- [x] 6.4 Image/section counts: Demo 1 8 / 7, Demo 2 5 / 4.
- [x] 6.5 `overstriding.value` and `cadence.value` unchanged against a clean-main run — done by
      reverting the four source files in place and re-running the same driver on the same port, so
      the comparison is a measurement rather than a lookup. Every metric value, confidence and
      coverage field on both clips is IDENTICAL, and that baseline's Overstriding image is
      byte-identical to the pre-fix capture taken independently on the main checkout.
- [x] 6.6 `npx tsc -b`, `eslint src`, full `npm test`.

## 7. Review round 1 (on `c022c0f`)

- [x] 7.1 🔴 **The contract said the opposite of what the code does.** The delta, `design.md`,
      `proposal.md` and `types.ts` all stated as a SHALL that a same-side pair omits the per-instant
      fields, and carried a scenario titled "A same-side pair omits the per-instant sets" — while
      `overstriding.ts` emits them unconditionally and this commit's own tests assert exactly that.
      Fixed the WORDING at all four sites, not the code: the obligation is now phrased structurally
      ("a metric whose exemplar pairs two instants that need **not** share a side"), mirroring the
      sibling requirement at `openspec/specs/form-heuristics/spec.md:1398`, and omission is
      permissive (MAY). The scenario is now "A same-side pairing's per-instant sets agree with each
      other and with the crop set", which `overstriding.test.ts` satisfies. Both deltas stay
      ADDED-only.
- [x] 7.2 🟡 **The guard test did not guard what D6 claimed.** It compared `op.role` SEQUENCES, so it
      could only see a mark that vanished. `tolerantMidpoint` degrades instead of vanishing — one
      hip stands in for the pair at `INTERPOLATED_OPACITY` — so an over-narrowed `overstriding` set
      missing a hip kept the same roles in the same order with the plumb through one hip. Now
      compares the filtered measurement-op ARRAYS with `toEqual`. Verified by mutation (`right_hip`
      dropped from the base set): the two arrays come back the same length with the same kinds,
      differing only in coordinates and opacity — the role comparison passes, the deep comparison
      fails. D6's table row corrected: `tolerantMidpoint` DEGRADES, it does not require both hips.
- [x] 7.3 🟡 **Demoted step-width pair recorded, not branched.** A `stepWidthStrike` pair can demote
      to one drawn instant, which now draws one ankle where a genuine single draws two. No branch
      added — a blanket "demoted ⇒ union" rule would redraw both legs for `overstriding`, which is
      the bug. New D5 paragraph states the decision and why the per-metric fix is a plan-layer
      redesign; filed as **`strides-p11`** (P3) and referenced from D5.
- [x] 7.4 🟡 **Ankle-disjointness asserted directly** in `stepWidth.test.ts` and
      `stepWidthCm.test.ts`, rather than only through assertions template-interpolated off
      `measuredSide`. (Note: the reviewer's premise was partly off — the ratio sibling did already
      carry `measuredSide !== pairedMeasuredSide`, at `stepWidth.test.ts:290`, ahead of the new
      block. The direct assertion is strictly stronger and was added to both files anyway.)
- [x] 7.5 🟢 The hygiene scan now names what it does NOT cover: one direction only, file-scoped, and
      nothing anywhere enforces that an emitted set still contains what that `kind`'s mark builder
      reads — which is what `evidenceAnnotations.test.ts` asserts instead.
- [x] 7.6 🟢 `leggedFrame` cross-referenced in both test files, so an edit to one cannot silently
      drift the other out of `isTooFarApartPair`'s band.
- [x] 7.7 Gates re-run: `openspec validate --strict`, `npx tsc -b`, `eslint src`, full `npm test`
      (88 files, 1406 tests). No live-browser re-run: nothing in this round changes rendered output
      — three documentation sites, one test comparison strengthened, two comments.
