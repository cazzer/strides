# Tasks

Sections 1–8 map one-to-one onto the sibling tickets of epic #59, in the order the epic's
dependency graph allows. Section 0 is this ticket.

Parallelism: §1 and §4 start together. §2, §3 and §5 all start once §1 lands. §6 needs §5. §7 needs
§4, §5, §6 (and §1–§3 for content). §8 needs everything.

## 0. The openspec change (#60 — this ticket)

- [x] 0.1 Scaffold `openspec new change metric-frame-evidence`.
- [x] 0.2 `proposal.md` — Why / What Changes reflecting the locked product decisions; Out of Scope
  naming export, drawn annotation, and reference-form overlays.
- [x] 0.3 `design.md` D1 — the per-metric exemplar table for all 11 `MetricId`s, each row verified
  against source, with the representative-versus-extreme role distinction.
- [x] 0.4 `design.md` D7 — the `cadence` decision, with both rejected alternatives named.
- [x] 0.5 `design.md` D2 — the per-metric crop-keypoint table, plus the MoveNet heel/foot_index
  degradation rule.
- [x] 0.6 `design.md` D3 — the per-instance quality score, its hard rejects, its threshold, and the
  zero-survivor behaviour at each layer.
- [x] 0.7 `design.md` D4 — the timestamp invariant, written as a rule with its rationale.
- [x] 0.8 `design.md` D5 — the cross-clip provenance decision, including the scale-pass graft rules.
- [x] 0.9 `design.md` D6 — PTS drift and `duration === Infinity`, written as inherited criteria.
- [x] 0.10 Spec deltas for `form-heuristics`, `results-view`, `multi-clip-analysis`.
- [x] 0.11 `openspec validate metric-frame-evidence --strict` passes.
- [ ] 0.12 **Not archived here.** Archiving happens in §8, after live verification.
- [x] 0.13 **Correction pass over `design.md`/`tasks.md`** (post-#61). Six corrections folded in,
  each marked **[correction]** in place: D3 hard reject 1 is `cropDerivable` ("no seed keypoint
  resolves"), D3's factor is `detectionFactor` counted per keypoint, D8 gains
  `verticalOscillationCm`'s `IntegrationRun.frames` widening (and tasks §2.8's file is corrected),
  D2 fixes the crop constants at `1.6` / `320`, D9 names the `[evidence-coverage]` line with a
  schema and an owner, and D11/D1 settle base-versus-ghost for extreme pairs. Plus one
  pre-registered risk recorded, not solved: the extreme role is structurally unreachable on a
  bimodal distribution. **No `src/` change and no spec-delta change** — every correction was
  additive prose over decisions the deltas do not name.

## 1. `MetricResult.exemplars` and the six event-sampled metrics (#61)

- [x] 1.1 `src/heuristics/types.ts`: define `MetricExemplar` and add
  `exemplars?: MetricExemplar[]` to `MetricResult`. Carry `timestamp`, optional `pairedTimestamp`,
  `kind`, optional `side`, `quality`, `label`, `cropKeypoints`. **No frame-index field of any
  kind** — the invariant is enforced by the type (design D4).
- [x] 1.2 Add the shared gate helper: `resolutionFactor` × `typicalityFactor`, the `3·MAD` outlier
  bound, `MIN_EXEMPLAR_QUALITY = 0.5`, `MAX_EXEMPLARS_PER_METRIC = 2` (design D3). One
  implementation, imported by every metric — not copied per module.
  Landed as `src/heuristics/exemplars.ts`. Two corrections to D3, both applied deliberately:
  hard reject 1 is "the crop cannot be derived from the RESOLVABLE seed" (i.e. no seed keypoint
  resolves), not "any seed keypoint is unrecoverable" — the literal rule contradicts D2, which
  unions the resolvable seed, and would discard instants four of these six metrics successfully
  measured. And `resolutionFactor` counts per KEYPOINT rather than per resolved input, because
  `resolveMidpoint` reports `interpolated: true` for a one-sided pair even when that side was
  detected, which would drive a two-midpoint metric to a flat 0 on 17-22% of real frames.
  **Both are now folded into design.md D3 as the stated contract** (shipped as `cropDerivable`
  and `detectionFactor`), along with two decisions #61 made that D3 had left open and #62/#63 must
  match: `pairQuality = min` of the two instants, and base = the instant furthest from the median
  for an extreme pair / closest to it for a representative one (D11 wins over D1's `(base)` column).
  **Import from `exemplars.ts`; do not re-derive any of this from the older prose.**
- [x] 1.3 `kneeFlexion.ts`: stop dropping minima at `:141`; add `timestamp: extremum.timestamp` to
  the `FlexionPeak` literal at `:142`; emit peak-nearest-the-median paired with its adjacent
  same-leg extension minimum. Rank with `legInterpolated[side][frameIndex]` (`:111-113`, read `:158`).
  Ranking reads the peak frame's own keypoint statuses instead, per 1.2's correction.
- [x] 1.4 `overstriding.ts`: carry each surviving candidate alongside its `overstrideRatios` entry
  (the array is index-parallel to survivors only — `continue` at `:82`); emit most- vs
  least-overstriding as an **extreme** pair, after the outlier bound.
- [x] 1.5 `footStrikePattern.ts`: emit up to **two single-instant** exemplars — the strikes nearest
  the median `offsetRatios` value. Caption via the already-exported `classifyFootStrike` (`:54-58`).
  The type must express a single without a null-second-timestamp hack.
- [x] 1.6 `stepWidth.ts`: construct the pair — among **adjacent opposite-side** entries in the
  timestamp-ordered candidate list, the pair minimising mean `|offset − median|`. Demote to a single
  representative strike when no opposite-side adjacency exists. Hard-reject the `outwardSign`
  degenerate case at `:113` rather than ranking it.
- [x] 1.7 `stepWidthCm.ts`: same construction over `offsetsCm` (`:149`); a strike with no usable
  `pixelsPerMeter` is not a candidate. Its `Math.sign(...) || 1` at `:147` is hard-rejected on the
  same terms as `stepWidth.ts:113` — D3 names only the latter, but the fallback is identical.
- [x] 1.8 `trunkLean.ts`: capture `frame.timestamp` (already in scope) alongside each `leanValues`
  push at `:85`; emit max-lean vs most-upright as an **extreme** pair, after the outlier bound.
- [x] 1.9 **Invariant regression test**: on a fixture whose presence window is strictly narrower
  than the clip, an exemplar timestamp resolved against the **untrimmed** `robustFrames` finds the
  same frame object the heuristic saw in the **trimmed** array. First-class, not incidental.
  `exemplars.test.ts`, "the exemplar timestamp invariant across the presence trim" — the fixture
  drops 4 leading frames, and the test asserts the index disagreement is exactly that.
- [x] 1.10 Prove no number moved: every existing metric test passes unmodified except where it
  asserts on the new field. Do **not** widen `FootstrikeCandidate` or `Extremum` — both already
  carry `timestamp`, and 9 whole-object `toEqual`s depend on their current shapes.
  Verified: `git diff` on the test files is purely additive (zero removed lines), and neither
  `footstrikes.ts` nor `extrema.ts` was touched.
- [x] 1.11 `npm test`, `tsc -b`, `eslint` clean.

## 2. Spectral fit phase and the vertical-oscillation family (#62)

- [x] 2.1 `spectralFit.ts`: add `phaseRadians = atan2(b, a)` and `tMeanSeconds` to
  `SpectralFitSuccess`. Assert `peakToPeakAmplitude` and every existing field bit-identical
  before/after — this primitive is shared by four metrics.
  Proved by a temporary before/after harness (added, measured, reverted, per CLAUDE.md's cycle):
  4 raw fits over noisy irregular series plus all four metrics × 4 clips × 3 views, walked
  key-by-key with `Object.is` — **0 shared keys changed, 0 removed**, the only difference being
  the two added fields and `exemplars`. The anchor fixture's 8 pre-existing fields were measured
  on the pre-change tree and are now pinned with exact `toBe` in `spectralFit.test.ts`
  ("holds every pre-existing field bit-identical on a fixed noisy input"), which also cross-checks
  the recovered phase against the fixture's KNOWN 0.7 rad — the only independent evidence that
  `atan2(b, a)` read the right two coefficients in the right order.
- [x] 2.2 A shared helper deriving (max, adjacent min) instants from `(frequencyHz, phaseRadians,
  tMeanSeconds)`, selecting the pair whose midpoint is nearest the centre of `spanSeconds`, then
  snapping each to a sampled frame via `findNearestFrame` + the half-median-interval tolerance.
  Landed as `src/heuristics/bounceInstants.ts` — a new module rather than a home in `spectralFit.ts`
  (which knows nothing of `RobustPoseFrame` and must not learn) or `hipBounce.ts` (whose series
  `verticalOscillationCm` deliberately never reads). It also owns the one `heuristics → results`
  import in the package, for `findNearestFrame`.
  Two points D8 left open, decided here and flagged for a later design correction pass rather than
  edited into design.md by the implementing ticket:
  - **The span centre is the FIT's, not the frame array's** — `resolvedSpanCenter(frames, series)`
    excludes leading/trailing frames that contributed no sample, since ranking cycles against the
    wrong centre picks the wrong cycle.
  - **One candidate pair, no walking outward.** D8 says "if either half fails to snap, the pair is
    rejected", so a failed snap emits nothing rather than falling back to a less-supported cycle,
    which would picture a different bounce from the one the selection claims to have chosen.
- [x] 2.3 **The sign rule (design D8).** `hipBounce.ts:95` fits raw downward-positive image-y;
  `verticalOscillationCm.ts:154` integrates upward-positive deltas. Resolve max-versus-min against
  each fit's own series convention at the call site. Unit-test direction against a synthetic fixture
  with known geometry — a mislabelled caption passes every other check.
  Encoded as a mandatory `maximumIs: 'highest' | 'lowest'` option with no default and no inference,
  stated at each of the three call sites. `bounceInstants.test.ts`'s "bounce exemplar direction"
  block asserts, per metric, that the frame at `timestamp` has a SMALLER hip-mid image-y than the
  one at `pairedTimestamp` and that both sit within 10% of the clip's real bounce extremes.
  **Verified load-bearing**: flipping `maximumIs` on all three metrics fails exactly those three
  tests (`expected 415 to be less than 385`) and nothing else.
- [x] 2.4 `verticalOscillation.ts`: emit the bounce trough/peak pair for one cycle.
  The crop seed follows `verticalOscillationSignal` (hips or ears), so the crop can never show a
  body region this run did not measure.
- [x] 2.5 `verticalOscillationCm.ts`: pair each fit with its producing `IntegrationRun` (which
  carries `timestamps`, `:41-47`) so `selectWeightedMedianFit`'s winner has attributable instants.
  This is the awkward one — budget for it. **Widen `IntegrationRun` with a parallel
  `frames: RobustPoseFrame[]`** (one entry per run sample, pushed in `buildRuns`'s existing loop
  where `frame` is already the loop variable) — see 2.8.
  Done as specified. `selectWeightedMedianFit` now selects over `{ fit, run }` tuples; the sort key
  and the stable-sort/dominance property are unchanged, so the winner is the same run it always
  was. **The winner is deliberately NOT carried on `ScaleCalibratedVerticalOscillation`** — that
  object is spread by reference onto `AnalysisDiagnostics.scaleCalibration` and `JSON.stringify`d
  to the console, so a `RobustPoseFrame[]` reachable from it would break D9's byte-stability
  guarantee and the harness that parses that line. The body moved into a private `calibrate()`
  returning `{ calibration, winner }`; the exported `computeVerticalOscillationCm` is now a thin
  wrapper over it, and the metric layer calls `calibrate` directly — still exactly one computation,
  and `result.calibration` is still that call's object verbatim, so #36's reference-identity
  invariant holds.
  Regression test "takes its instants from the WINNING run": a dominant 40-frame run against a
  14-frame fragment placed on the far side of a long tracking gap. **Verified load-bearing** —
  resolving against the whole clip instead fails it.
- [x] 2.6 `verticalRatio.ts`: numerator exemplar from the same bounce fit.
  Hip-seeded, matching the numerator's own hip-pinning. The file's edits are confined to the
  numerator so #63's stride-pair denominator does not collide.
- [x] 2.7 `cadence.ts`: **emit nothing** (design D7). Add a test asserting `cadence.exemplars` is
  absent, so a future contributor's "fix" fails loudly rather than shipping a borrowed picture.
  The module doc now carries D7's reasoning and both rejected alternatives, so the decision is
  legible where the "fix" would be made. Two tests assert absence — one in `cadence.test.ts`, one
  in `bounceInstants.test.ts` beside the metrics that DO emit from the same fit.
- [x] 2.8 Per-instance signal for this family. **Corrected — the original text ("stop discarding
  `mid.interpolated` at `hipBounce.ts:83`") named the wrong mechanism and, for
  `verticalOscillationCm`, the wrong file.** The shipped gate is FRAME-based: `cropDerivable(frame,
  seed)` and `detectionFactor(frame, seed)` both read `frame.keypoints`, and `ExemplarInstant` is
  `{ frame, seed, value? }`. So:
  - **Pixel path (`verticalOscillation`, `verticalRatio`) — no change to `hipBounce.ts` at all.**
    `analyzeBounceSignal`'s `hipY` is `frames.map(...)` and therefore index-parallel to `frames`,
    and the D4 snap (`findNearestFrame`) hands back the frame object directly. A per-frame
    `interpolated` flag is not needed and must not be added "for the gate".
  - **Centimetre path — `verticalOscillationCm` does NOT go through `hipBounce.ts`.** It builds its
    own series in `buildRuns` (`:78-96`) and drops `hipMid.interpolated` there; its own module doc
    states `analyzeHipBounce`'s series is never read here. Give it 2.5's `frames` array. Do **not**
    add `interpolated: boolean[]` instead — it can neither derive a crop nor be scored, and the
    boolean it would carry is `resolveMidpoint`'s, which reads `true` for a one-sided pair even
    when that side was detected (design D3's `detectionFactor` correction).
  - Snap each instant against the frames the fitted samples came from: the winning run's `frames`
    for the cm path, the metric's own `frames` for the pixel path.
  - Reuse `pairQuality` (`min`) for the bounce pair and D11's base rule; do not invent a mean.

  Done as written — `IntegrationRun.frames`, no `hipBounce.ts` change of any kind, snapping against
  the winning run's `frames` (cm) and the metric's own `frames` (pixel), `pairQuality` reused.
  **Two consequences worth recording, both deliberate:**
  - **The bounce instants carry no `value`, so `scoreExemplarInstant` scores them on
    `detectionFactor` alone.** A fitted amplitude has no per-instance values to build a
    distribution from, and inventing one (the raw hip-y excursion at that frame) would reintroduce
    exactly the jittery quantity the spectral estimator replaced. `ExemplarInstant.value` is
    already optional for precisely this shape of instant, so no gate change was needed.
  - **D11's base rule does not resolve this family**, because it is stated in terms of distance
    from the metric's own median and there is no such median here. D1's row names instant A as the
    bounce trough (body highest on screen), so BASE = highest and GHOST = lowest, unconditionally
    and regardless of which sign convention produced them. Worth a line in a future design
    correction pass; not edited into design.md by this ticket.
  - A pixel-path snap landing on a frame with no resolvable hip is caught by hard reject 1 and the
    exemplar is dropped, exactly as D8 anticipates — measured on a gapped fixture where the
    centre-most cycle straddles the gap: the cm path (which snaps inside its own gapless run) still
    emits, the pixel path does not.
- [ ] 2.9 Regression anchor: track clip VO_cm 4.78–4.79 cm (±0.005 across trials),
  `fit.frequencyHz × 60` == `cadence.value`. A >0.05 cm spread means something moved.
  **Outstanding — needs the live-browser harness, deferred to §8.** What was done instead, and why
  it is meaningful but not a substitute: the anchor's PURPOSE is to catch a perturbed shared
  primitive, and 2.1's key-by-key before/after comparison establishes that no field of any fit or
  any metric moved at all, on four clips and four metrics, including the `fit.frequencyHz × 60` vs
  `cadence.value` cross-check (both sides byte-identical to the pre-change tree). That bounds the
  risk to zero for anything the unit fixtures exercise; it does not exercise the track clip.
- [x] 2.10 `npm test`, `tsc -b`, `eslint` clean.
  `tsc -b`: No errors found. `vitest run`: 900 passed, 0 failed (872 at `2526d64` + 28 new).
  `eslint .`: No issues found. Every existing test file's diff is purely additive — 0 removed
  lines across all five.

## 3. `armSwingSymmetry` and the stride denominator (#63)

- [x] 3.1 `armSwingSymmetry.ts`: widen `SideSwing` to keep each half-swing's extrema pair rather
  than collapsing at `:90`, and add the per-extremum interpolated flag the gate needs (today's
  `interpolatedCount` is per-side/per-frame). Carry the median-amplitude index back from the
  caller's `median(...)` at `:149-150`.
  **Corrected the same way §2.8 was, and for the same reason — no interpolated flag was added.**
  The shipped gate is FRAME-based (`cropDerivable(frame, seed)`/`detectionFactor(frame, seed)` both
  read `frame.keypoints`, and `ExemplarInstant` is `{ frame, seed, value? }`), so a boolean could
  neither derive a crop nor be scored. `amplitudesPx: number[]` became `halfSwings: HalfSwing[]`
  — one record per confirmed swing carrying `amplitudePx` plus the two FRAMES — rather than a
  parallel array beside it, which is the index-parallel hazard D1's `overstriding` note warns about.
  The median-amplitude index does not travel back either: `describeDistribution(amplitudes).median`
  IS the caller's `median(...)` over the same numbers, so the selection is made where the swings
  live instead of threading an index through.
  **The field NAMES are the sign trap's fix**: the series is `wrist.y − shoulder.y` in image-y,
  which grows downward, so the series MINIMUM is the wrist HIGHEST on screen —
  `wristHighFrame`/`wristLowFrame` rather than min/max, exactly as `bounceInstants.ts` names by body
  position. **Verified load-bearing**: flipping the min/max assignment fails exactly two tests
  ("the image-y sign trap", "spans that side's full swing amplitude") and nothing else.
- [x] 3.2 Emit up to one exemplar per side: wrist-high vs wrist-low of that side's median-amplitude
  half-swing. Score both instants through `exemplars.ts`, combine with `pairQuality` (`min`), and
  pick the base by D11's rule — do not hand-roll either.
  Both sides go through ONE `selectExemplars` call, not one each: the budget is per-metric, and
  gating each arm separately would apply the cap twice and could keep two pictures of one arm.
  Each side is judged against its OWN amplitude distribution — the metric compares two per-side
  medians, so a pooled spread would score a left swing on the very asymmetry the metric reports.
  **D11's base rule does not resolve this pair either**, for the same reason #62 recorded for the
  bounce pair: both instants belong to one half-swing and therefore carry the identical value, its
  amplitude. D1's row names instant A as wrist-high, so BASE = wrist-high. Worth folding into a
  future design correction pass alongside #62's note; not edited into design.md by this ticket.
- [x] 3.3 `strideLength.ts`: widen `StrideLengthResult` to keep each displacement's two footstrike
  instants (identity dies at `:151`). Safe — one production caller (`verticalRatio.ts:175`), no
  production object literals.
  Re-verified at `e49692f` before widening: still exactly one production caller, no external object
  literals, and `index.test.ts:158` reads fields rather than the whole object. Landed as a required
  `pairs: StridePair[]` on the ok-branch (`{ side, displacementPx, startFrame, endFrame }`), frames
  not indices — same D4 reasoning, and the same conclusion #62 reached for `IntegrationRun.frames`.
- [x] 3.4 Update the two whole-object `toEqual`s at `strideLength.test.ts:144` and `:176` to the new
  shape — **updated, not deleted, not loosened to `toMatchObject`**.
  Both still `toEqual` the whole object, and they now assert MORE than before: `pairs` is compared
  against `expectedCleanPairs(...)`, derived independently from `detectFootstrikes` rather than read
  back off the result under test, so per-pair side, displacement, order and both endpoint frames are
  all pinned. Both edits are pure insertions — zero removed lines in that file.
- [x] 3.5 `verticalRatio.ts`: emit the median stride pair's two same-side footstrikes as the
  denominator exemplar, `kind`-distinguished from the numerator exemplar.
  Added as `kind: 'stridePair'` beside #62's untouched `'bounceCycle'` block. The two candidate
  arrays are concatenated and passed through ONE `selectExemplars` call — `MAX_EXEMPLARS_PER_METRIC`
  is a per-metric budget, and gating each half separately would apply it twice. Exactly two
  candidates against a cap of two, so neither can crowd the other out; a live test asserts both
  survive. Base is the FIRST strike (D1's instant A) — D11 cannot decide it, both instants bound one
  stride and carry its single displacement value.
- [x] 3.6 Prove `verticalRatio.value` and `armSwingSymmetry.value` are identical before/after.
  Proved the way §2.1 did, with a temporary probe (added, measured, reverted). It dumped every field
  of `computeFormHeuristics` plus `computeVerticalRatio`/`computeArmSwingSymmetry` at all three views
  and `estimateStrideLength`'s raw result, over 5 synthetic-gait clips (side/front, 24–30fps,
  150–185 spm, one scale-calibrated, one treadmill) and 4 arm-swing clips (symmetric, asymmetric,
  fast, slow-short) — the gait fixture holds wrists static relative to the shoulder, so it never
  exercises `armSwingSymmetry`'s value path and a separate fixture family was required. Flattened to
  dotted paths and walked key-by-key with `Object.is`, `exemplars`/`pairs` excluded:
  **4,134 keys, CHANGED 0, ADDED 0, REMOVED 0.**
- [x] 3.7 `npm test`, `tsc -b`, `eslint` clean.
  `tsc -b --force`: No errors found. `vitest run`: 912 passed, 0 failed (900 at `e49692f` + 12 new).
  `eslint .`: No issues found. Three removed lines across every existing test file, all in
  `verticalRatio.test.ts`'s numerator block, which asserted `exemplars` had length 1 — a test
  asserting on the new field; it now selects by `kind` and asserts the same things.

## 4. Fusion provenance and clip plumbing (#64)

- [x] 4.1 `fuseHeuristics.ts`: add `fusionSourceIndices(results): Record<MetricId, number>` as a
  **sibling pure function** reusing the same comparator. Do **not** change
  `fuseFormHeuristicsResults`'s return shape — its single-clip reference identity at `:48-50` is
  load-bearing.
- [x] 4.2 Test that the sibling's winner agrees with `fuseFormHeuristicsResults`'s winner for every
  metric on a multi-clip fixture, and that the single-clip case maps every metric to index 0.
- [x] 4.3 `MultiClipVideoSession.tsx`: pass `clips: ClipSession[]` (which already carry
  `videoSource` → `sourceBlob`/`metadata`, and non-null per-clip `analysis.robustFrames`) plus the
  source-index map down to the gallery's mount point. Handles unbounded N.
  **As built:** `clips` is already a local at the mount point, and the map is one call away —
  `computeFusionSourceIndices(clips)` (`multiClipAnalysis.ts`), which wraps `fusionSourceIndices`
  behind the *same* all-clips-ready gate the fused aggregate uses, so the two can never attribute
  a result that does not exist yet. The mount point itself is a documented JSX seam naming both
  inputs verbatim: `tsconfig.app.json` sets `noUnusedLocals`, so computing the map here with
  nothing rendering it would not compile, and a placeholder component that renders nothing is
  exactly the UI scaffolding 4.6 forbids. #67 adds one import and one element.
- [x] 4.4 Preserve `ResultsView`'s no-hooks/presentational contract (`:28-33`). No hook there, no
  React context — this codebase keeps the dependency explicit (`ClipSlot` reports up,
  `MultiClipVideoSession` fans down). Do not change the aggregate state to carry frames.
- [x] 4.5 Implement design D5's scale-pass graft rules: grafted exemplars resolve their crop rects
  against the **primary** pass's `robustFrames`, and are **dropped entirely** when
  `subjectAgreement.status === 'diverged'`. Check `scalePassGraft.ts:98-106` and `:19-24`, both of
  which spread whole `MetricResult` objects.
  **As built:** the first rule holds by construction and is now documented on the graft — the
  scale pass's own `RobustPoseFrame[]` never leave `useVideoAnalysis`'s scale-pass effect, so the
  primary's are the only frames any consumer can resolve against. The second is a new pure
  `dropGraftedExemplars`, composed by the caller alongside `withSubjectDivergenceCaveat` under the
  identical condition rather than folded into it, so each function's name stays literally true.
- [x] 4.6 No UI in this ticket. It ends with data at the mount point and nothing rendering it.
- [x] 4.7 `npm test`, `tsc -b`, `eslint` clean.

## 5. Pure evidence plan — timestamps, crop rects, blend, gate (#65)

- [x] 5.1 New `src/results/evidenceFrames.ts`. **Zero DOM**: no `document`, no `HTMLVideoElement`,
  no canvas; importable in a node environment.
- [x] 5.2 Exemplar → timestamps → frames via `findNearestFrame`
  (`skeletonGeometry.ts:85-108`), **reused, not reimplemented**, plus the half-median-interval snap
  tolerance it does not provide (it clamps and never returns null for a non-empty array).
- [x] 5.3 Crop rect: `boundingBoxOfPoints` over the exemplar's own `cropKeypoints`, unioned across
  both frames of a pair, then `computeCropRect(box, w, h, EVIDENCE_CROP_PADDING_MULTIPLIER,
  EVIDENCE_CROP_MIN_SIDE_PX)` (`movenetCrop.ts:269`) for padding, squaring and clamping. Do **not**
  reuse `deriveBoundingBox` — it excludes exactly the head/foot names this table wants.
  **The two constants are `1.6` and `320` (design D2), fixed there, not chosen here** — export them
  from this module so tests and #68's report can name them. They are ONE pair for every metric:
  per-metric framing already lives in D2's seed ∪ context table, and a second per-metric table
  would vary apparent subject scale, which is the one thing D13 exists to hold constant. Note
  `computeCropRect` applies the `min(frameWidth, frameHeight)` cap **last**, so the 320 floor can
  never demand pixels a small source does not have.
- [x] 5.4 Context keypoints are strictly optional: a crop must be well-defined from the seed alone,
  and any unresolvable context point is omitted. Never anchor on a `(0,0)` MoveNet foot keypoint.
- [x] 5.5 Blend plan: base = `timestamp`, ghost = `pairedTimestamp`, `globalAlpha` 1.0 / 0.5.
- [x] 5.6 Apply the gate here; return the discriminated per-metric result
  (`{ status: 'planned', items }` | `{ status: 'no-evidence', reason }`) the UI branches on.
- [x] 5.7 Near-identical-pair demotion: crop-box IoU ≥ 0.98 (reuse `computeBoundingBoxIoU`) or both
  instants snapping to the same frame → demote to the base frame, or drop for a metric with no
  honest single-instant semantics.
- [x] 5.8 **`metadata.durationSec` must not appear in this module at all.** A unit test on a
  metadata fixture with `durationSec: Infinity` produces a well-formed plan.
- [x] 5.9 Export the **pure** `summarizeEvidenceCoverage(...)` — plan(s) + `fusionSourceIndices` in,
  the `[evidence-coverage]` payload out, exactly the schema in design D9. **Pure: no `console`, no
  DOM** (§7.12 emits it). Numbers and enums only — no `ImageBitmap`, canvas, `Blob`, object URL or
  data URI may be reachable from the payload, and no metric `value`/`confidence` (that is
  `[analysis-diagnostics]`'s job and two sources of truth can disagree). Unit-test that it
  `JSON.stringify`/`parse`s round-trip and that every `no-evidence` reason reaches it verbatim.
- [x] 5.10 Unit tests: crop rects at frame edges, missing/interpolated keypoints, single vs pair,
  the near-identical case, the gate threshold boundary, degenerate/unbounded keypoint sets, and a
  4K-sized frame. Include the degenerate single-point seed, which must land on the 320 px floor
  rather than a zero-side rect.
- [x] 5.11 `npm test`, `tsc -b`, `eslint` clean.

## 6. Frame extractor — seek, crop, composite (#66)

- [x] 6.1 New `src/video/extractFrames.ts`. Resurrect `seekTo(video, time)` from
  `git show ee7a56e^:src/quality/assessVideoQuality.ts` (`:32-57`) — `seeked` listener,
  `SEEK_TIMEOUT_MS = 2000` fallback, `<0.001s` no-op short-circuit — rather than writing a new one.
- [x] 6.2 Use a **second, detached** `<video>` from `URL.createObjectURL(sourceBlob)`. Never touch
  the visible element, which is loop-playing after ready (`useVideoAnalysis.ts:381-392`). Own and
  revoke this object URL here; never reuse or revoke `useVideoSource`'s private one.
- [x] 6.3 **At most one detached decoder open at a time**: all instants for one clip in one pass,
  tear down, next clip.
- [x] 6.4 Await one `requestVideoFrameCallback` after `seeked` before `drawImage` — `seeked` does not
  mean the new frame is composited.
- [x] 6.5 Draw with the nine-argument `drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh)` — only the
  crop rect, never a full 4K canvas per exemplar.
- [x] 6.6 Ghost compositing via `globalAlpha` at the plan's opacities.
- [x] 6.7 Return canvases / `ImageBitmap`s held in memory. **No `toDataURL`, no `toBlob`, no
  download, no storage** (also unstubbed in jsdom).
- [x] 6.8 A seek that never fires `seeked` degrades to `reason: 'extraction-failed'`, never a
  spinner. Runs strictly after `phase: 'ready'`; no measurable analysis wall-clock regression.
- [x] 6.9 **PTS calibration hook (design D6/R1)**: a per-clip seek-time offset, applied at seek time
  only, never written back into `robustFrames[].timestamp`. Landed here if #68 measures a non-zero
  offset.
- [x] 6.10 Smoke test with `stubCanvas2DContext()` (`canvasTestUtils.ts:29`, fakes `drawImage` at
  `:40` and `globalAlpha` at `:41`) and `makeVideoSeekable(video)` (`videoTestUtils.ts:13`). Assert
  *that* two frames blended at the right opacities and *what* crop rect was passed. Never pixels.
- [x] 6.11 `npm test`, `tsc -b`, `eslint` clean.

## 7. Evidence gallery UI and per-card deep link (#67)

- [x] 7.1 New `src/results/EvidenceGallery.tsx`, mounted as a **third child of `<main>`
  (`MultiClipVideoSession.tsx:155`) with `lg:col-span-2`** — a sibling of `ResultsView`, never a
  child. Without `lg:col-span-2` it lands in column 1 of row 2; the class is required.
- [x] 7.2 Do not use the export seam at `ResultsView.tsx:134-138` — reserved for the export ticket.
- [x] 7.3 Deep link on each metric card that has evidence, wired through `MetricCard`'s existing
  `chart?: ReactNode` slot by metric identity (`MetricsPanel.tsx:86-89`, `:140`, `:236-242`) — no
  new prop path. Only tier-1/tier-2 metrics can have one (design D10).
  **As built:** `MetricCard`'s prop surface is untouched — `cardSlot(chart, link)` composes both
  into the existing slot and returns `undefined` when neither applies, so a card without evidence
  renders byte-identical DOM (asserted). Which metrics HAVE evidence is not derivable from
  `heuristics`, though: an emitted exemplar can still fail to resolve to a sampled frame or fail to
  extract, so the answer only exists after extraction. The gallery therefore reports its settled
  metric set upward (`onEvidenceMetricsChange`, the same report-up/fan-down shape `ClipSlot` uses),
  `MultiClipVideoSession` holds it, and `ResultsView` gained one optional pass-through prop
  (`evidenceMetrics`) to reach `MetricsPanel`. That is the only file outside this ticket's list that
  changed; it stays presentational and calls no hook, so its documented contract (`:28-33`) holds.
  The anchor id scheme is a single exported constant (`EVIDENCE_SECTION_ID_PREFIX`), so the link
  and its target cannot drift.
- [x] 7.4 Cards without evidence render exactly as today: no link, no placeholder, no layout shift.
- [x] 7.5 Captions name the metric, the side where applicable, and state that a ghost is the **same
  runner at two instants** — a user must never read a ghost as two people.
- [x] 7.6 One aspect ratio across every metric (design D13).
- [x] 7.7 N clips: show which clip a section's evidence came from when N > 1, via
  `fusionSourceIndices` — **never** by regexing the prose caveat at `fuseHeuristics.ts:9-11`.
- [x] 7.8 Extraction driven at most once per clip and torn down after; no detached video or canvas
  retained after unmount, no leak across a clip reset.
  **As built:** a per-`clipId` cache keyed on the clip's own inputs (heuristics, frames, frame size
  and `sourceBlob`, all by reference), so adding a second clip re-decodes only the new one; a clip
  whose plan has zero planned items never opens a decoder at all. In-flight runs are invalidated by
  a `runIdRef` bump, `useVideoAnalysis`'s idiom, and a superseded run's canvases are dropped rather
  than parented. The teardown effect also clears the input signature — without that, React's
  `StrictMode` mount → cleanup → mount cycle (the app mounts under it, `main.tsx`) invalidates the
  first pass's extraction and then finds the signature unchanged on the second, skipping the re-run
  and leaving the gallery reporting "pulling frames…" forever. There is a regression test.
- [x] 7.9 Responsive at narrow widths; images carry meaningful alt text; the deep link is
  keyboard-reachable.
  **As built:** verified live at 390 px and 1440 px. Images are a fixed 224 px wide, centred and
  wrapping, rather than a two-column grid — a metric may have one image or two, and a grid orphans
  the single case in the left half of its card. Alt text lives on the host element (`role="img"`),
  not on the adopted canvas: the canvas belongs to the extractor and writing to a prop is what
  `react-hooks/immutability` exists to stop.
- [x] 7.10 Tailwind v4 utilities only; BEM-ish class names are test hooks with no CSS behind them.
  **No new runtime dependencies.**
- [x] 7.11 Emit the `[evidence-coverage]` line — `console.log('[evidence-coverage]',
  JSON.stringify(summarizeEvidenceCoverage(...)))` from §5.9's pure summarizer, `import.meta.env.DEV`-
  gated exactly as `useVideoAnalysis`'s two lines are. **Once per analysis run** (not once per
  clip — clips are an array in the payload), and **after extraction has settled for every clip**,
  so `'extraction-failed'` is a verdict rather than a pending state. This is #68's §8.6 observable;
  without it that task has nothing to read. It must NOT ride on `[analysis-diagnostics]`.
  **As built:** emitted from `EvidenceGallery.tsx`'s `emitCoverage`, once per settled run, on both
  the extracted and nothing-to-extract paths. Confirmed live on Demo 2 (one line, parses, correct
  schema) and confirmed absent from `vite build` output.
- [x] 7.12 `npm test`, `tsc -b`, `eslint`, `npm run build` clean.

**Live check run during this ticket, and a blocker it surfaced for #68.** Driven against Demo 2
(headless Chromium, real GPU — `ANGLE Metal Renderer: Apple M4 Pro`). The gallery, the plan, the
tier gate, the captions, the provenance line, the deep links and the coverage line all work end to
end. But **every metric came back `'extraction-failed'`**, because
`extractFrames.ts`'s `waitForPresentedFrame` never resolves: `requestVideoFrameCallback` does not
fire after a *paused* seek in this Chromium, detached or attached to the document, headless or
headed. Probed directly — `seeked` fires reliably, the API itself works during playback
(`'presented'`), and `drawImage` after `seeked` alone already yields correct and *distinct* pixels
at different timestamps (verified by pixel fingerprint, `differ: true`). So the seek-and-draw
approach is sound and only the presentation wait is wrong. Not fixed here: `extractFrames.ts` is
#66's file and out of this ticket's scope. Everything above was confirmed visually with that one
wait temporarily relaxed locally, then reverted.

## 8. Live verification, then archive (#68)

- [ ] 8.1 Headless Chromium, real GPU (`--headless=new --enable-gpu --ignore-gpu-blocklist`).
  Confirm the renderer via `WEBGL_debug_renderer_info` and **abort** on SwiftShader.
- [ ] 8.2 Run Demo 1 (3840×2160 landscape, network), Demo 2 (`park-approach.mp4`, 2160×3840
  portrait, local), and `e2e/fixtures/multiperson-track.mp4` for the N-clip provenance path.
  Multiple trials per clip; compare medians and ranges.
- [ ] 8.3 **Ground-truth every extracted instant**: `ffmpeg -i clip -ss <t> -frames:v 1 -q:v 3` per
  reported timestamp, read the PNGs, compare against the app's own crop.
- [ ] 8.4 **Report the measured PTS offset per clip.** A "looks fine" without a number does not
  close this. Cross-check by forcing `{ sequentialSampling: { enabled: false } }` via
  `page.addInitScript` and reporting whether the offset changes. If non-zero, §6.9's calibration
  lands and the finding is written into this design.md **before** archiving.
- [ ] 8.5 **Look at the ghosts.** Save the composites and read them. Confirm a legible delta and the
  right body region per metric. An unreadable double-exposure is a finding to report.
- [ ] 8.6 Report per-clip, per-metric coverage: which produced evidence, which were gated out, why.
  Read it off the **`[evidence-coverage]`** console line (§5.9/§7.11), matched exclusively
  (`startsWith('[evidence-coverage]')`), `JSON.parse`d — same pattern as the two
  `[analysis-diagnostics]` lines. A metric gated out on **every** clip is a finding —
  `MIN_EXEMPLAR_QUALITY` is pre-registered and is not to be quietly tuned down to fix it.
- [ ] 8.6b **Measure the extreme-role risk first, before touching any number** (design D3, and the
  Risks row). `overstriding` and `trunkLean` are the epic's only extreme-role metrics, and an
  extreme instant needs `|v − median| ≥ 1.5·MAD` to clear `0.5` — which a tightly bimodal
  per-instance distribution (max deviation **1.0 MAD**) and a clean sinusoid (**≈1.41**)
  structurally cannot reach. Report, per clip and per metric: the per-instance `median`, `MAD`,
  `sampleCount`, the max `|v − median|` **in MADs**, and whether `describeDistribution().usable`
  was even true. If either metric emits nothing on every clip, **write that up as the finding** —
  it says the typicality ramp and the outlier bound share one `3·MAD` scale and cannot both be
  right for a bimodal metric, which is a design question for a follow-up ticket. Loosening
  `MIN_EXEMPLAR_QUALITY` to make the symptom disappear is editing a criterion to match a result and
  is explicitly out of bounds for this ticket.
- [ ] 8.7 Confirm `[analysis-diagnostics]` still `JSON.parse`s and contains no image data or blob
  URLs. Match the prefix exclusively
  (`startsWith('[analysis-diagnostics]') && !startsWith('[analysis-diagnostics:')`). Confirm the
  same of `[evidence-coverage]`: parses, and carries no `ImageBitmap`/canvas/`Blob`/object-URL/
  data-URI value anywhere in the payload.
- [ ] 8.8 Confirm no analysis wall-clock regression against a pre-change baseline on the same
  machine.
- [ ] 8.9 `npm test`, `tsc -b`, `eslint`, `npm run build`, `npm run test:e2e` clean.
- [ ] 8.9b **Fix the one delta sentence that contradicts shipped code, BEFORE archiving.**
  `specs/form-heuristics/spec.md`'s first hard-reject condition still reads "any of the keypoints
  defining its crop region is `'unrecoverable'` at that frame" — the pre-#61 rule, which
  `exemplars.ts`'s `cropDerivable` violates and which already contradicts this change's own
  `results-view` delta ("the **resolvable subset** of the exemplar's named keypoints"). Rewrite that
  clause to "no keypoint defining its crop region resolves to a position at that frame". The block
  is `## ADDED`, so this is an ordinary delta edit. Archiving it unfixed puts the wrong rule into
  `openspec/specs/` as the authoritative contract. See design.md's spec-delta section.
- [ ] 8.10 `openspec validate metric-frame-evidence --strict`, then
  `openspec archive metric-frame-evidence --yes`. **Promptly** — batched archiving has drifted
  `openspec/specs/` in this repo before.
- [ ] 8.11 CLAUDE.md gains a section recording what was measured: per-clip coverage, the PTS offset
  finding, and any metric whose ghost was judged unreadable. Record negative results so nobody
  re-derives them.
