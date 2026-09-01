# Design — demote a far-apart single-instant pair

## D1. The defect, restated as measured

`strides-ddj`. On Demo 1, `[evidence-coverage]` reported
`overstriding: { status: 'no-evidence', reason: 'all-gated-out' }` — the card rendered no picture.

The chain, measured on `0817ca9` and not in dispute:

1. `strides-1mt` gates two collapsed-pose strikes out of `computeOverstriding`'s sample. Two
   strikes survive: t = 4.84 and t = 5.52.
2. With n = 2 there is exactly ONE possible pair, so `alternates: 0` — nothing to fall back to.
3. Those two strikes are one step apart on a 4K side view, ~1180 px of subject translation against
   a tight hip-to-ankle box. `evidencePairCropGrowth` reads **2.881** against
   `EVIDENCE_MAX_PAIR_CROP_GROWTH = 2.5`.
4. `isTooFarApartPair` fires, and `planExemplarFrames` dropped the pair WHOLE, for every kind.

Both obvious escapes were refused before this change was scoped, and stay refused. **The constant
does not move**: 2.881 is 15% past it, not marginal, and admitting it re-admits `trunkLean`'s
6.1–6.8 pairs on the same clip. **The criterion and its calibration are untouched** — a pair is
rejected on exactly the reading it was rejected on before.

## D2. What was actually wrong: the consequence, not the criterion

The far-apart guard dropped unconditionally, justified in its own docstring as:

> every paired label this repo emits is a statement about two instants … and none of them survives
> losing half the pair

That is false for the kinds the collapse rules already demote (`footStrike`, `stepWidthStrike`,
`kneeFlexionPeak`), and false for two more:

| | what the card reports | measured at |
|---|---|---|
| `computeOverstriding` | median of per-strike `(ankle.x − hipMid.x) / torso` | ONE strike |
| `computeTrunkLean` | median of per-frame torso angles | ONE frame |

Neither number is a difference between two instants. The repo already said so in two places before
`SINGLE_INSTANT_KINDS` caught up:

- `measuredAtInstant` (`evidenceAnnotations.ts`) records `trunkLeanRange` and `overstrideRange` as
  measured at **both** instants, while `bounceCycle` is measured at **neither**.
- `buildTrunkLeanMarks` and `buildOverstrideMarks` are pure per-instant builders — they need
  nothing from the other half.

**The kind's NAME is what misled.** `trunkLeanRange` and `overstrideRange` are *ranges* in the
sense that the two instants are the two ends of a spread — which is how the exemplar found a
legible extreme to show — not in the sense that the card reports a spread. `strides-r41` made this
exact correction for `kneeFlexionPeak`; this is the same correction for two more kinds.

### Why `stridePair` cannot join them

Mechanical, not a judgement call. `stridePair`'s only measurement mark, `strideCaliper`, is built
in `planEvidenceAnnotations` under `plan.ghost !== null` — it spans the two hip midpoints, so it
does not exist for one instant. A demoted stride pair would keep `hipMidMarker` + `strideTick` and
lose the span that IS the measurement. `bounceCycle` is excluded for a related reason: it draws one
horizontal at one hip midpoint, and its vocabulary contains no caliper at all (deliberately — the
reported amplitude is a whole-clip spectral fit, and a span between two lines would read as that
number).

**⚠️ A `layer === 'measurement'` count cannot see that distinction.** Asserted and verified: a
demoted `stridePair` DOES emit measurement-layer ops (`hipMidMarker`, `strideTick`), and so does a
demoted `bounceCycle` (`bounceMidpoint`, `bounceHorizontal`). The count invariant in
`evidenceAnnotations.test.ts` therefore passes for the non-members too and is NOT the thing that
distinguishes them — the accompanying role-level assertion is. This corrects the working assumption
this change was scoped under ("the count invariant fails today for `bounceCycle` and `stridePair`");
it does not, and the test says so rather than implying otherwise.

## D3. Demotion is the fallback walk's LAST RESORT — load-bearing

Reclassifying alone would have been a regression wearing a fix's clothes. `planExemplarWithFallback`
returned the first candidate that planned at all; once a kind is demotable, a far-apart winner
plans successfully as a demoted single, so the walk would stop there and never reach the drawable
alternate below it.

Concretely on Demo 1: `trunkLean`'s winner demands **6.1–6.8** growth and its alternate draws at
**1.866**. Without the ordering, that good ghost becomes a lone frame — and the coverage line still
reports `status: 'planned'` with one exemplar, so the regression reads as a fix.

`planExemplarFrames` keeps deciding drop-vs-demote per pair (unchanged signature, no mode flag).
The walk returns the first candidate whose `demotion === null`, remembers the FIRST demoted plan,
and returns that only if no candidate rendered as a pair. `demotion === null` rather than
`ghost !== null`, so a genuine single-instant exemplar — which never had a pair to lose — returns
immediately instead of being filed as a consolation prize.

## D4. The demotion reason travels; the caption tells the truth

Before this change there was one boolean and one sentence:

> Shown as one frame: the paired instant was too similar to tell apart.

TRUE for a collapsed demotion. **The exact inverse of the truth** for a far-apart one, where the
two instants are a full step apart. A boolean cannot carry three states, and two independent fields
could disagree with each other about one image, so:

```ts
export type EvidenceDemotion = 'collapsed-pair' | 'far-apart-pair'
// EvidenceFramePlan.demotion: EvidenceDemotion | null   — REPLACES demotedFromPair: boolean
```

`captionFor` maps through a **total** `Record<EvidenceDemotion, string>`, so a reason added without
a sentence is a type error rather than a caption naming nothing. The collapsed sentence is
unchanged byte-for-byte. The far-apart sentence states the guard's SPATIAL criterion —

> Shown as one frame: the paired instant was too far away to share a legible crop.

— and deliberately says nothing about elapsed time, which this capability rejects as the measure at
that end of the range (a stationary subject seconds apart ghosts perfectly; a fast one a fraction
of a second apart does not). `altFor` needed no change: it already branches on `plan.ghost === null`.

### `cropGrowth` stays `null` on a demoted plan, and the consequence is named

Deliberate, per the spec's "explicit absence for a pair demoted to its base". The consequence is
that **the reading which CAUSED a far-apart demotion is not on the coverage line** — re-checking
`EVIDENCE_MAX_PAIR_CROP_GROWTH`'s bracket against a rejected pair still needs the probe it always
did. Reporting it would make the column mean two different things in one number: "what this image
cost" and "what the image we did not draw would have cost".

### Contract break, recorded rather than hidden

The `[evidence-coverage]` per-exemplar key `demotedFromPair: boolean` becomes
`demotion: EvidenceDemotion | null`. `scripts/ab-person-selection.mjs` needs **no** change —
verified: `flatten` walks whatever keys exist, `scalarize` passes strings through, and `summarize`
tallies non-numerics and handles `null`. But an old `before.txt` diffs against a new `after.txt`
with one deleted and one added row per exemplar (measured: 20 removed, 21 added — the extra is the
newly-planned Demo 1 exemplar's own row). CLAUDE.md's contract paragraph is updated.

## D5. `strides-8i4` is folded in — and it is not optional

`overstriding` and `trunkLean` hardcoded a label naming the HIGH end
("Furthest-reaching footstrike…", "Most forward trunk lean…") while `selectExtremePairs` picks
whichever end is further from the median. `evidenceCaptions.ts` documents the invariant *"Every
paired `label` this repo emits is 'X, ghosted against Y' with the base first"*, and `altFor` builds
"the first instant named above is shown solid" on it. Both metrics violated it whenever the base
was the low end.

That was survivable while every paired image showed both instants. It is a flat falsehood about the
only body on screen once a pair can be demoted to one of them.

**A guard ("refuse to demote unless the base is the furthest-reaching") was rejected on arithmetic.**
With n = 2 survivors, `describeDistribution`'s median is `fl((a + b) / 2)`, so which end wins is
decided by a single unit in the last place of that sum — deterministic, but unknowable from the
record and unstable under any upstream change. Such a guard would have an undetermined outcome on
the very clip this ticket exists to fix.

**And it was the low end.** Measured live on Demo 1: the emitted caption reads

> **Closest-landing footstrike**, ghosted against the furthest-reaching one. Shown as one frame:
> the paired instant was too far away to share a legible crop. 4.84 s into the clip.

Without `strides-8i4` that first clause would have read "Furthest-reaching footstrike" beside a body
that is the closest-landing one. The arithmetic argument is not hypothetical on this clip.

`ExtremePair<T>` gains `baseIsHigh`, set from the `high.deviation >= low.deviation` comparison
`selectExtremePairs` ALREADY performs — reported rather than re-derived, so two answers cannot
disagree. **No ranking, ordering or tie-break change**; ties still resolve to the high end, pinned
by a test.

## D6. Live verification

`node scripts/ab-person-selection.mjs --arm 'base={}' --clips demo1,demo2,multiperson --trials 3
--evidence`, fresh Chromium per trial, dev server started and identity-verified by each run, real
GPU (`ANGLE Metal Renderer: Apple M4 Pro`), reading the LAST `[evidence-coverage]` line. Baseline
captured on `0817ca9` with a clean tree before any `src/` edit.

**The entire non-`elapsedMs`, non-rename diff is eight added rows and two changed ones:**

| Demo 1 `overstriding` | before | after |
|---|---|---|
| `status` | `no-evidence` | **`planned`** |
| `reason` | `all-gated-out` | `null` |
| `kind` | — | `overstrideRange` |
| `demotion` | — | **`far-apart-pair`** |
| `timestamp` | — | **4.84** |
| `pairedTimestamp` | — | `null` |
| `quality` | — | 0.5 |
| `cropSidePx` | — | **912.197** |
| `cropGrowth` | — | `null` |

`cropSidePx` **912.197** sits inside the derived expectation band of 655–1003 native px. It is
neither 2160 (the frame cap, which would mean a whole-frame crop) nor 320 (the
`EVIDENCE_CROP_MIN_SIDE_PX` floor, which would mean a degenerate box).

**Everything else is bit-identical on all three clips**, including the two cells the §D3 ordering
protects:

| the D3 regression check | before | after |
|---|---|---|
| Demo 1 `trunkLean` | ghosted, `pairedTimestamp` 5.08, `cropGrowth` 1.86597 | identical |
| multiperson `trunkLean` | ghosted, `pairedTimestamp` 2.65, `cropGrowth` 2.28948 | identical |
| multiperson `overstriding` | ghosted, `pairedTimestamp` 2.73333, `cropGrowth` 2.17521 | identical |

No metric `value`, `confidence`, `sampleSize`, `frameCoverage` or `interpolatedFraction` moved on
any clip; `sampling.*`, `personSelection.*` and `view.*` are bit-identical. Zero spread across the
three trials on every field but `elapsedMs`.

Anchors re-confirmed:

- Demo 1 `overstriding` **0.325743** @ confidence **0.25**, `sampleSize` **2**
- Demo 1 `cadence` **91.2**
- Scale-pass line, read by a separate temporary driver (the A/B driver does not capture it):
  `verticalOscillationCm` **4.421467928439415**, `fit.frequencyHz` **1.52** (× 60 = 91.2 ==
  `cadence.value`), `sinusoidR2` `0.42451916621964814`, `sampleCount` 57, `torsoMeters`
  `0.504143645953322`, `subjectAgreement` 52/53.

## D7. The picture was pulled and looked at

`canvas.toDataURL('image/png')` called from the HARNESS on the DOM node — never from app source,
which `drawEvidenceAnnotations.test.ts:604` forbids. The driver was added, measured and deleted.

Rendered canvas 640 × 640, displayed at **142 CSS px**. Judged at both sizes.

- **One body.** No ghost, no second figure, no bystander.
- **Not a whole-frame crop.** 912 px of a 3840 × 2160 frame; the runner's lower body fills it.
  Head-cropped, which is correct — `overstriding`'s crop set is ankle + hips + knee and never
  contained the head.
- **A genuine FOOTSTRIKE, not a trailing folded swing foot** — the `strides-1mt` symptom is absent.
  The near leg is planted, shin near-vertical, shoe flat on the track with its contact shadow
  directly beneath it and sharp against a heavily motion-blurred trailing leg folded up behind.
- **The annotation lands on that body.** The amber dashed plumb runs through the hip midpoint; the
  amber caliper runs from the plumb to the **planted** ankle with its arrowhead at the ankle — the
  construction `overstriding` actually measures. The cyan hip → knee → ankle chain is on the
  planted leg.
- **The caption's leading clause is true of the body shown.** "Closest-landing footstrike": the
  caliper is short — the foot lands close under the hip.
- **At 142 px** the gestalt reads (one runner, plumb line, foot, short offset). The caliper's
  end-ticks do not resolve, consistent with what CLAUDE.md already records about fine marks at this
  size.

**Ground truth.** App t = 4.84 → ffmpeg t = 4.76 (this clip's 0.08 s edit-list shift). The ffmpeg
keyframe at 4.76 matches the evidence image frame-for-frame — same pose, same planted foot with its
shadow, same blurred trailing leg, same lane markings. Against `strides-dly`'s corrected
app-domain contact onsets (4.08 / 4.74 / 5.40 / 6.06), t = 4.84 sits **0.10 s** after the second
contact — mid-stance, and exactly the +0.11 s systematic residual already filed as `strides-24s`.

**One thing NOT independently confirmed, stated rather than glossed:** whether t = 4.84 really is
the *closest-landing* of the two surviving strikes. Both keyframes (ffmpeg 4.76 and 5.44) show the
foot slightly ahead of the hip by a visually similar margin — the difference is below what a
keyframe eyeball can adjudicate. The label follows the selector's own comparison, which is the
point of D5; it was not cross-checked by hand.

## D8. Gates

`tsc -b` clean. `npm run lint` clean. `npm test`: **88 files, 1439 tests, all passing.**
`openspec validate --strict` clean.
