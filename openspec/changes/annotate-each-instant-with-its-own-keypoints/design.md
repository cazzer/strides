# Design

## D1. Two sets, because they answer two questions

`cropKeypoints` and the new `annotationKeypoints` look interchangeable and are not:

| | scope | on a pair | why |
|---|---|---|---|
| `cropKeypoints` | the IMAGE | UNION of both instants | one photograph must contain both instants, so the crop rectangle is derived from both frames' boxes |
| `annotationKeypoints` | the INSTANT | that instant's own seed | the joint layer is a statement about what the measurement at that moment was about |

Drawing the union at each instant states that both feet were measured at both moments. On a
mixed-side pair that is false of both halves, and it is stated in the same cyan the correct joints
are drawn in, so nothing on the image distinguishes it.

The fields are OPTIONAL, and may be omitted wherever they would coincide with `cropKeypoints` — a
producer whose two instants can never differ, and every single-instant exemplar. That is not
laziness: on such an exemplar `cropKeypoints` *is* the per-instant set by construction, so the
fallback is independently correct rather than an approximation the consumer tolerates. Making them
required would have meant nine producers restating a value the tenth can already derive.

**The obligation attaches to the CONSTRUCTION, not to how a pairing fell.** `overstriding` states
both fields unconditionally, including on the pairing where its two strikes happen to be the same
foot — because whether they are is a property of the run, and a producer that emitted the fields
only when they diverged would make its own contract a function of the footage, and would leave the
consumer unable to tell "these coincide" from "this producer forgot". On such a pairing the two sets
are equal to each other and to `cropKeypoints`, which `overstriding.test.ts` asserts, so the
statement and the fallback draw the same set.

## D2. Why the annotation set is not derived downstream

A tempting one-line alternative: keep the single `cropKeypoints` field and, in the evidence layer,
filter it by `resolveInstantSide(exemplar, role)` — drop `right_*` names on a left instant.

Rejected, for the same reason `resolveInstantSide` refuses to read the side off `cropKeypoints`
ordering. A crop set legitimately names points belonging to NEITHER instant's measurement:
`stepWidth`'s demoted single exemplar names the OPPOSITE ankle on purpose, because a width read
against the hip midline is only legible with the other foot in frame. A side filter deletes exactly
that, and — worse — it makes the drawn set a silent function of how keypoints are spelled. `nose`
and `left_hip` do not share a naming scheme; `left_heel` does. A rule that reads meaning out of a
name prefix inverts silently the moment a name changes.

The measuring layer states it, or nobody does. That is the identical principle
`measuredSide`/`pairedMeasuredSide` already established one field up.

## D3. Own-frame, not both frames, for `overstriding`'s context knee

`overstriding` builds each instant's set as
`cropKeypoints(seedFor(instant), [KNEE_NAME[instant.side]], [instant.frame])` — filtered against
that instant's OWN frame, where the crop set filters against both.

This makes the set a property of the instant. The same strike appears in several `alternates` pairs
(`selectExtremePairs` ranks pairings, not instants), and with own-frame filtering it carries the
same annotation set in every one of them. Filtering against both frames would make the set a
function of which OTHER strike it happened to be paired with.

It is visually identical either way. A knee that resolves only in the partner's frame would be
named, then come back `'unrecoverable'` from `resolveInstantKeypoints`, and `MarkBuilder.point`
drops an unrecoverable point's mark. So this is a statement about what the set MEANS, not about
what gets drawn.

## D4. The knee stays; the OPPOSITE knee is what leaves

`buildOverstrideMarks` needs only the two hips (for `tolerantMidpoint`) and `ANKLE_NAME[side]`. The
knee is not a measurement input, so a strictly-minimal set could drop it.

It is kept. `MarkBuilder.joints` emits a `SKELETON_EDGES` bone only when the index holds BOTH
endpoints, so naming the knee is what supplies hip→knee and knee→ankle — the two bones that make the
marked ankle read as the end of the leg the caliper measured, rather than a loose dot near a foot.
`KNEE_NAME`'s doc comment in `overstriding.ts` said "Exemplar crop context only"; that stopped being
true and was updated.

The defect is the OPPOSITE knee (and the opposite ankle), and those are what this change removes.

## D5. `stepWidth`'s pair and single are deliberately NOT one expression

The pair path emits `seedFor(base)` / `seedFor(ghost)` with **no context**, matching that pair's own
existing `cropKeypoints(..., [], ...)` call. The single path emits **neither field**.

They must not be flattened into a shared expression. The single exemplar's crop set deliberately
carries the opposite ankle, and for that exemplar that is the correct annotation set too: one strike
against the hip midline is one whole measurement, the opposite foot is what makes a *width* legible,
and there is no second instant for it to be misattributed to. Emitting `annotationKeypoints:
seedFor(sample)` there would strip the opposite ankle from the image's annotation for no reason —
a regression dressed as consistency. `stepWidth.test.ts` and `stepWidthCm.test.ts` both assert the
absence.

**The DEMOTED pair takes a knowingly different path from the genuine single, and that is accepted
here rather than solved — `strides-p11`.** `stepWidthStrike` is in `SINGLE_INSTANT_KINDS`, so a
constructed pair whose ghost does not resolve (same frame, near-identical box, too close in time)
collapses to one drawn instant. That image now draws only the base instant's own ankle, where before
this change it drew the union — so two one-frame step-width images differ purely by how they got
there, while the demoted one's caption still says "Opposite-foot plants either side of the hip
midline".

It is the right narrowing for the reason this whole change exists: an annotation states what THAT
instant measured. The genuine single's opposite ankle is context for a measurement that has no
partner instant; a demoted pair's partner *exists* and was dropped for display reasons, which the
caption already tells the reader. So the drawn set is honest either way; what differs is legibility.

The obvious fix is not available. A blanket "demoted ⇒ fall back to `cropKeypoints`" rule in the
plan layer would be actively WRONG for `overstriding`, whose union is both legs — it would redraw
the bug this change removes, on the one body left in the frame. Making it right per metric means
teaching the planner, per `kind`, which parts of a union are context-for-one-instant and which are
the other instant's measurement — a plan-layer redesign out of proportion to the symptom, since no
measurement mark is lost either way (`buildStepWidthMarks` needs only the two hips and
`ANKLE[instant.side]`, all three of which survive). Filed as `strides-p11` with the options.

## D6. The risk: a narrowed list is indistinguishable from a lost keypoint

`EvidenceInstantPlan.keypoints` has exactly ONE consumer: `positionIndex(instant)` in
`evidenceAnnotations.ts`, whose `Map` is the `index` every mark builder receives.
`builder.point(index, NAME)` resolves only against that map and returns `null` for a name that is
absent — indistinguishably from a keypoint the robustness layer lost. `tolerantMidpoint` and
`strictMidpoint` build on `point`. `joints(index)` requires `index.has(from) && index.has(to)`.

So narrowing the list can silently drop a caliper or a line: no throw, no log, no coverage field.

Walked, per instant, against both new sets:

| builder | inputs | in `overstriding`'s new set | in `stepWidth`'s new set |
|---|---|---|---|
| `tolerantMidpoint(left_hip, right_hip)` | **degrades**, does not require — one hip is enough, and it silently stands in at `INTERPOLATED_OPACITY` | ✅ both seeded | ✅ both seeded |
| `strictMidpoint(left_hip, right_hip)` | both hips | n/a | ✅ both seeded |
| `point(ANKLE_NAME[instant.side])` | this instant's ankle | ✅ `seedFor` leads with it | ✅ `seedFor` leads with it |
| `line('hipWidthSegment', left_hip, right_hip)` | both hips | n/a | ✅ both seeded |

Every measurement mark's inputs survive because `seedFor` on both metrics IS
`[ANKLE[side], 'left_hip', 'right_hip']` — the measurement's own inputs, by definition. That is the
structural reason the narrowing is safe, and it is asserted rather than argued: the annotation tests
build the same plan twice from one fixture, once with the annotation fields and once with them
stripped, and require the MEASUREMENT-layer ops per instant to be IDENTICAL while the joint/bone ops
differ.

**The comparison is the whole op, not its `role`, and that distinction is load-bearing.** A role
sequence would only catch a mark that DISAPPEARED, and `tolerantMidpoint` has a nearer failure than
disappearing: given one hip instead of two it returns the single resolved side at
`INTERPOLATED_OPACITY` rather than `null`. An over-narrowed `overstriding` set that dropped one hip
therefore still emits `hipMidlinePlumb` and `ankleOffsetCaliper`, under the same names in the same
order, with the plumb standing through one hip instead of the midline — a confident picture of a
measurement nobody took, one degree removed from the drop this test exists for. Demonstrated by
mutation: with `right_hip` removed from the base set, the two op arrays come back the same length
with the same kinds and differ only in coordinates and opacity, so the role comparison passes and
the deep comparison fails. (`strictMidpoint` hard-nulls, so `stepWidth` fails a role comparison too
— this specific degradation is `overstriding`-only.)

## D7. Op ordering

`joints()` iterates the index's insertion order, so op arrays SHRINK; retained names keep their
relative order, and nothing moves visually. But `drawEvidenceAnnotations.test.ts` and
`evidenceAnnotations.test.ts` carry order-sensitive `toEqual` assertions, so the full suite is the
gate here, not a spot-check.

## D8. Where `overstriding`'s mixed-foot case is tested, and where it cannot be

`overstriding.test.ts:122-131` already records, with reasoning, that **no** offset series can
produce a mixed-foot overstriding exemplar through `computeOverstriding`: on an alternating-foot
clip the most/least strikes are opposite-signed about a near-zero median, which puts them under the
1.5-MAD typicality ramp, and any fixture wide enough to clear the ramp trips `isOutlier`'s 3-MAD
reject instead. Both squeeze from the same MAD.

So the mixed-foot behaviour is asserted at the PLAN layer (`evidenceFrames.test.ts`) and the
ANNOTATION layer (`evidenceAnnotations.test.ts`) with a hand-built exemplar, exactly as
`measuredSide`'s own mixed-foot assertion already is. `stepWidth`/`stepWidthCm` CAN reach the case
for real, via `buildStrikeFrames({ alternateFeet: true })`, and do.

## D9. Reaching `stepWidth`'s demoted single WITH the opposite ankle resolvable

`buildStrikeFrames` without `alternateFeet` leaves `right_ankle` unrecoverable in every frame, so
`cropKeypoints` correctly drops it and the demoted exemplar's crop set is just the three seed names
— which cannot demonstrate "the single keeps its opposite-ankle context".

The fixture the tests use plants a STATIC right ankle above the left ankle's y range
(`withStaticOppositeAnkle`). `detectFootstrikes` differences the two ankles and requires a maximum
of `ankle_S.y − ankle_opposite.y` to be non-negative on the relative series, so a motionless
opposite foot held ABOVE the moving one yields left strikes only (the right side's series is the
exact negation, and its maxima are therefore negative and rejected). Measured: the exemplar demotes
to a single left strike whose `cropKeypoints` is
`['left_ankle', 'left_hip', 'right_hip', 'right_ankle']` — the opposite ankle present, which is the
"do not flatten the two cases" regression the tests need.

## D10. Live verification

Assertions, all on a fresh Chromium process per trial with real GPU, against this worktree's own
derived dev-server port:

1. **Demo 1 / `overstriding` coverage identical to the pre-fix baseline** — `kind overstrideRange`,
   `timestamp` 6.16, `pairedTimestamp` 5.52, `quality` 0.5, `cropSidePx` 2160, `cropGrowth`
   2.42768425598781, still no `side` key. One assertion that is simultaneously the crop-unchanged
   proof, the same-pair-still-selected proof and the metric-unchanged proof.
2. The Overstriding card's canvas, looked at: **two ankle markers total, not four**, one per body,
   opposite sides; one hip→knee→ankle chain per body, the solid base's on the LEFT leg and the faint
   ghost's on the RIGHT; both bodies keeping their hip-midline plumb and their amber caliper.
3. Demo 2 / `stepWidth`: two ankle markers total, one per body; hip-width segment, midline plumb and
   caliper still on both halves.
4. Image/section counts unchanged: Demo 1 8 / 7, Demo 2 5 / 4.
5. `overstriding.value` and `cadence.value` unchanged against a clean-main run of the same clip.
