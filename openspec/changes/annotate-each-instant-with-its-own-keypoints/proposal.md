# Annotate each instant of a ghosted pair with its own measured keypoints

## Why

On Demo 1's Overstriding card the thumbnail draws joint markers for **both** legs on **both**
ghosted bodies, so each skeleton shows the ankle and knee of the leg its own caliper did not
measure — in the same cyan, with nothing distinguishing it. The picture says the metric measured
the trailing leg as well as the landing one, which it did not.

The number is unaffected and both mark builders are already correct. `overstriding.ts` measures
only `ANKLE_NAME[sample.side]` against the hip midline, and `buildOverstrideMarks` draws its amber
caliper from `instant.side` alone. The defect is one line up, in the **joint** layer:
`evidenceFrames.ts`'s `instantPlan` resolved each instant's drawn keypoints from
`exemplar.cropKeypoints`, and for a pair that is the UNION of both instants' seeds. When the two
strikes are opposite feet — which `overstriding.ts` itself calls "the usual case", since nothing
constrains the furthest-reaching and closest-landing strikes to one foot — that union is
`{left_ankle, right_ankle, left_hip, right_hip, left_knee, right_knee}`, and the same list is drawn
at both instants.

Measured on Demo 1 (fresh Chromium, real GPU, last `[evidence-coverage]` line): `overstrideRange`,
`timestamp` 6.16, `pairedTimestamp` 5.52, no `side` key — a mixed-foot pair by that field's own
contract. `footStrikePattern` independently reports t = 5.52 as the RIGHT foot, so the solid base at
6.16 is the LEFT one. The crop is at `cropSidePx` 2160, the frame-height cap on this 3840×2160 clip,
so both bodies render small and the four leg markers crowd together.

The same shape is in `stepWidth`'s paired exemplar, whose own comment says the two instants are
"deliberately opposite feet" — that is Demo 2's card.

The crop set must stay unioned: one photograph has to contain both instants. What is wrong is
reusing it as the annotation set. `evidenceFrames.ts` already states the intent — "the metric that
measured the instant is the only layer that knows which points its measurement is about" — which
the union is not, per instant.

## What Changes

- **`MetricExemplar` gains `annotationKeypoints` / `pairedAnnotationKeypoints`**, per instant,
  optional. The CROP set is a property of the image and must be the union across a pair; the
  ANNOTATION set is a property of the instant. Omittable wherever they would coincide (a producer
  whose two instants can never differ, every single-instant exemplar), where the consumer falls back
  to `cropKeypoints` — which on such an exemplar IS the per-instant set by construction. The
  obligation attaches to a producer's construction, not to how one pairing fell, so `overstriding`
  states both even on the pairing where its two strikes share a foot.
- **`overstriding.ts` emits both**, each built from that instant's own seed plus that instant's own
  knee, filtered against that instant's own frame. The knee is deliberately kept: `SKELETON_EDGES`
  supplies hip→knee and knee→ankle only when that side's knee is named, and those two bones are
  what make the marked ankle read as the end of the leg the caliper measured. What leaves is the
  OPPOSITE knee and the OPPOSITE ankle.
- **`stepWidthExemplars.ts` emits both on its PAIR path only**, with no context — matching that
  pair's existing `cropKeypoints(..., [], ...)` call. Its demoted SINGLE path emits neither,
  deliberately: the opposite ankle it names is context this one measurement genuinely is about, and
  there is no second instant for it to be attributed to.
- **`evidenceFrames.ts` gains `resolveInstantAnnotationKeypoints`**, a sibling of
  `resolveInstantSide`, and `instantPlan` reads through it. The three crop call sites are untouched.

Not changed, deliberately: every mark builder, the amber calipers, the crop rectangle, all metric
math, and the six exemplar producers that never build a mixed-side pair (`armSwingSymmetry`,
`bounceInstants`, `footStrikePattern`, `kneeFlexion`, `trunkLean`, `verticalRatio`).

## Impact

- Affected specs: `form-heuristics` (the producer-side obligation), `results-view` (the rendering
  half)
- Affected code: `src/heuristics/types.ts`, `src/heuristics/overstriding.ts`,
  `src/heuristics/stepWidthExemplars.ts`, `src/results/evidenceFrames.ts`

Narrowing the drawn set is functionally identical to those keypoints going unrecoverable, and
`MarkBuilder.point` returns `null` for a missing name indistinguishably from one the robustness
layer lost — so a caliper whose endpoint left the map would be dropped SILENTLY. Both mark builders
were walked against both new sets and every measurement mark's inputs survive; the tests assert it
rather than trusting it, per instant, on both metrics.
