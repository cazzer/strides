# Design — gating a footstrike whose two ankles have collapsed onto one point

## D1. The defect, restated in one line

`detectFromBouncePhase` predicts a touchdown from the hip's fitted rhythm and snaps it to the
nearest frame. It never asks whether the body at that frame looks like a foot arriving. On Demo 1
two of four emitted strikes sit on frames where both ankle LABELS have latched onto one foot, and
four metrics measure that as a footstrike.

## D2. Step 0 came back "stop", and that is why this is a design change rather than a fudge

The plan pre-registered a margin rule mirroring `#57`: every degenerate strike at or below `f/2`,
every genuine one at or above `2f`, or the change stops rather than being re-tuned. It was measured
before the constant was written — three clips x (primary + background scale pass), fresh Chromium
per clip, real GPU, dev server started and identity-verified, **two invocations bit-identical**.

**On the pooled corpus the rule fired.** 29 strikes with a defined ratio; the only consecutive gap
of ratio >= 4 is `0.0086 -> 0.0558` (x6.51), and a threshold there keeps BOTH of Demo 1's
keyframe-confirmed collapsed strikes. At the proposed `f = 0.20` the nearest survivor was
**0.2084 at 1.04x f** against a required 2.00x. That holds however the strike is classified: genuine
puts it below `2f`, degenerate puts it above `f/2`. No `f` worked, and the honest report was "stop".

**Separating the two detectors is what dissolved it, and the separation is structural rather than
convenient.** Every keyframe-confirmed degenerate came from the PHASE path; every
threshold-crowding survivor came from the ANKLE-DIFFERENCE path. Pooling them was pooling two
different detectors' verdicts into one distribution.

```
phase path only, sorted dy / torsoLengthPx:

  degenerate   0.0086  demo2 primary t=0.10010
               0.0558  demo1 primary t=6.16000
               0.0976  demo1 primary t=4.20000
                   |                                   gap x4.76
  genuine      0.4649  demo2 primary t=0.76743
               0.5823  demo2 primary t=0.43377
               0.6700  multiperson primary t=3.43333
               ...     up to 1.9102
```

Feasible window **[0.1952, 0.2325]**. `f = 0.20` sits inside it: **2.05x** clearance below,
**2.32x** above. The rule is satisfied, not waived.

**How fragile that is, stated rather than implied.** The window is only **1.19x wide**, and each
bound is a **single observation** — 0.0976 below, 0.4649 above. One more degenerate strike at 0.11,
or one more genuine one at 0.40, and no `f` satisfies the rule at all. The margins are "clears on
the corpus measured", not a property of running, and they rest on `n = 1` at both ends.

What makes it shippable anyway is that **the blast radius of being wrong is bounded and visible**. A
mis-gate drops one strike from a median and surfaces as a smaller `sampleSize`, a lower
`frameCoverage` and a caveat naming the cause. It cannot re-partition a track, change which detector
timed the clip, or delete a clip's sample — the failure modes that make a threshold like `#57`'s
area floor dangerous. That asymmetry, not the margins, is the reason a 1.19x window was accepted.

**And every margin here is stated in T, against a normalizer that is known to be wrong.**
`estimateBodyScale` is a single clip-wide median, while the separation is per-frame; on an approach
clip the torso grows ~4x across the clip, so the effective floor runs ~1.5x stricter at clip-open
and looser at clip-end — biased toward over-gating exactly where the subject is smallest and
detections worst. Deliberately NOT fixed here: it is the same normalizer CLAUDE.md's
vertical-oscillation investigation already documents, and it changes no verdict on this corpus
(MoveNet reported 1.99 px at the Demo 2 strike, which fires under any normalizer).

## D3. Why the ankle-difference path is exempt — ALTERNATION, not an absolute floor

**An earlier draft of this section said that detector "already vets ankle separation, in the same
units, as its selection criterion". That is wrong and is corrected here.** `buildContactSeries`
returns `v = ownAnkle.y - oppositeAnkle.y` and `detectFootstrikesBetweenAnkles` runs
`findLocalExtrema(series, footstrikeMinProminenceRatio * torsoLengthPx)` over it — but PROMINENCE
bounds a peak's rise above its neighbouring trough, **not its absolute value**, and the two
constants differ 4x (0.05 T against this floor's 0.20 T). The fallback path enforces no separation
floor at all, and demonstrably emits strikes below this one: the exemption test emits fallback
strikes at 6 px against a 20 px floor, and the corpus survivor that killed the pooled threshold
(0.2084 T) is on that path.

The exemption is still right, on narrower ground. The fallback selects on **alternation contrast** —
a prominence-confirmed rise above a neighbouring trough of the SIGNED between-legs difference — and
a label collapse destroys alternation, because both labels then trace one foot and the difference
goes flat. The failure this floor catches is suppressed there by the selection itself, without any
absolute bound. Adding one would put a second, differently-shaped constant on the same quantity,
free to disagree with the first. The phase path has no such structure: it predicts an instant from
the hip's fitted rhythm and snaps it to a frame, and vets nothing about the pose.

Pinned by a test at the DEFAULT config rather than a lowered prominence, so it is evidence about
shipped behaviour: a 6 px peak over 0 px troughs has prominence 6 against a 5 px bar, is emitted,
and is reported measurable at 6 px against a 20 px floor.

### D3.1. The coverage gap this leaves — `stepWidthCm` is unprotected on its own clips

The background MediaPipe scale pass was measured running the **fallback** path on both Demo 2 and
the multi-person clip (`path=ankle-difference` in the probe output). Every strike it feeds the
grafted centimetre metrics is therefore exempt from this gate. `stepWidthCm` — the metric Demo 2 is
the primary view for — gets **no protection from this change at all**; the alternation argument
above is the whole of what stands behind it. Stated here because the alternative is a reader
assuming the gate covers a metric it never touches.

## D4. Annotate, do not drop — measured, not argued

`FootstrikeCandidate` gains `ankleMeasurable: boolean`. The name covers the undecidable case
honestly, which `anklesSeparated` would not: an unresolvable contralateral ankle passes.

The drop was **built and run**, as its own arm of the live A/B:

| demo1 | annotate (shipped) | drop arm |
|---|---|---|
| `verticalRatio.value` | **0.0310419** | **null** |
| `verticalRatio.confidence` | 0.479473 | 0 |
| `verticalRatio.sampleSize` | 2 | 0 |

`estimateStrideLength` pairs same-side consecutive strikes. Demo 1's four are `right@4.20,
left@4.84, right@5.52, left@6.16` and exactly the outer two collapse; dropping them leaves
`left@4.84` + `right@5.52` — **zero same-side pairs**. Stride length reads only timestamps and
hip-mid, and an ankle-label collapse touches neither, so it deliberately ignores the annotation and
says so at its call site.

## D5. Vertical, not horizontal

`|dx|` distinguishes the feet only on a side view. Measured on the front-approach Demo 2, the
genuine strikes carry **0.017-0.50 T horizontally** — straddling any usable floor — and
**0.46-1.91 T vertically**. A horizontal rule would delete Demo 2's whole sample and withhold the
three metrics that clip is the primary view for. `ankleDifference` already exists and is already the
module's documented magnitude-of-evidence quantity, so nothing new is measured.

## D6. Interpolation is not part of the predicate

Neither sufficient nor necessary: Demo 1's t = 6.16 collapse is both ankles `detected`, and its
t = 4.20 collapse is both `interpolated`. It is already priced by
`interpolatedFraction x interpolationConfidencePenalty`.

## D7. Ordering — after `attributeSides`, and the failure mode if it were not

The annotation is applied to `detectFromBouncePhase`'s OUTPUT. Applied to its INPUT instead, a clip
whose every instant is sub-threshold would leave the side vote with no evidence, `attributeSides`
would return `null`, the phase path would return `[]`, and `detectFootstrikes` would read that as
"fall back" — silently changing which detector timed the whole clip, with no error anywhere. Pinned
by a test that squeezes every instant below the floor and asserts the phase path's instants are
still the ones reported.

## D8. `MIN_OVERSTRIDE_SAMPLE_SIZE` stays 4

**The arithmetic does not endorse 4, and an earlier draft of this section claimed it did.**
`stepWidth`'s derived `n >= 2k + 3` took `k = 2` from two measured mechanisms, and only ONE has been
removed: boundary strikes (`strides-aah`, excluded in `detectFootstrikes`). The other is
`strides-boc`'s detector-dropout windows, which `stepWidth.ts` calls "NOT fixed and not fixable at
this layer" and which **this change explicitly cannot touch either** (D11). The collapsed-ankle
strikes gated here are a THIRD mechanism, not `stepWidth`'s second one. So `k = 1`, `n >= 5`, and
**4 does not clear it**.

It holds at 4 on the gait-cycle argument alone, which needs no `k`: two strikes per leg is the
smallest sample that has seen both feet do the whole thing once. Moving it is a separate decision
with its own blast radius — precisely the one `stepWidth.ts` reserved when it declined to sweep its
four siblings — and this change is not that decision. Two things bound the cost: the minimum
DISCOUNTS rather than withholds, and raising it would compound with the discount this gate already
applies to the same thinning (`2/4 = 0.5` against a doubly-charged `2/7 = 0.143`). Filed as
`strides-dbh`, to be revisited when `strides-boc` is addressed and `k` really does reach 0. Its
docstring's claim that "fewer strikes than this is too easily dominated by a single noisy detection"
is DELETED rather than repaired — `stepWidth.ts:18-83` demolished it for the identical estimator —
and replaced by the gait-cycle basis, with the trigger for revisiting stated.

## D9. A gated strike stays in the coverage denominator

`usableStrikeCount / candidateStrikeCount` is unchanged. A collapsed ankle pair IS an ankle that
failed to resolve — it merely presents as resolved — so it belongs in the same bucket as the
existing `continue`, which is exactly where the skip goes. The consequence, stated rather than
glossed: the thinning is priced **twice**, once through coverage and once through the sample-size
factor. On Demo 1 that is `0.5 x 0.5 = 0.25`. That is how the pre-existing hip-unresolvable skip
already behaves, and special-casing it here would make one metric's denominator mean something
different from its siblings'.

## D10. Live A/B — 3 clips, 3 trials, fresh process per trial, real GPU

`scripts/ab-person-selection.mjs --arm 'base={}' --clips demo1,demo2,multiperson --trials 3
--evidence`, dev server started and identity-verified, `ANGLE Metal Renderer: Apple M4 Pro`,
compared field-by-field against the `34dc08b` baseline. **Exactly three strikes gated corpus-wide**,
as predicted: demo1 t=4.20 and t=6.16, demo2 primary t=0.10010.

| clip | field | before | after |
|---|---|---|---|
| demo1 | `overstriding.value` | 0.3257433216584835 | **0.3257433216584835** |
| demo1 | `overstriding.sampleSize` | 4 | **2** |
| demo1 | `overstriding.frameCoverage` | 1 | **0.5** |
| demo1 | `overstriding.interpolatedFraction` | 0.25 | **0** |
| demo1 | `overstriding.confidence` | 0.875 | **0.25** |
| demo1 | `footStrikePattern.value` | 0.0010846194307798894 | unchanged |
| demo1 | `footStrikePattern.sampleSize` | 4 | 2 |
| demo1 | `stepWidth.value` | 4.256963997386355 | unchanged |
| demo1 | `verticalRatio` | 0.0310419 @ 0.479473 | **unchanged** |
| demo1 | `cadence` | 91.2 | **unchanged** |
| demo2 | `stepWidth.value` | 0.225311 | 0.151558 |
| demo2 | `overstriding.value` | -0.0305607 | -0.0478918 |
| demo2 | `footStrikePattern.value` | -0.01797 | -0.00814282 |
| demo2 | the three `sampleSize`s | 5 | **4** |
| multiperson | everything but `elapsedMs` | — | **unchanged** |

`sampling.*`, `personSelection.*` and `view.*` are bit-identical on all three clips.

**Demo 1's `overstriding` and `footStrikePattern` values do not move**, because with `n = 4` the
median averages the middle two and the two collapsed strikes happened to be the min and the max.
That accident is the ticket's own point: the number was right for the wrong reason, and one fewer
healthy strike would have moved it. What changes is that it is now *derived from* two strikes rather
than *rescued from* four, and confidence says so.

**Demo 2 loses one strike of five on the primary pass**, and that is a CORRECTION. The plan
pre-registered "sampleSize stays 5" as a front-view stop condition; keyframes settle it the other
way. At t = 0.10010 the planted shoe and the trailing swing foot are ~80 px apart vertically against
a ~232 px clip-median torso (~0.34 T) while MoveNet reports **1.99 px**. Vertical separation is
abundant on that clip — its other four strikes carry 0.46-1.91 T — so this is one bad frame, not the
front-view failure the stop condition guarded against.

**The Demo 2 scale pass is untouched**, as the scoping predicts: the probe measured it on
`path=ankle-difference`, so all four of its strikes (0.9156-1.9857 T) are exempt by construction,
`t = 0.41708` included.

## D11. This does NOT fix `strides-boc`, and the plan's expected corroboration was wrong

The plan predicted this gate would fire on Demo 2's scale-pass strike at t = 0.41708, inside the
`strides-boc` collapse window, and that a failure to fire meant the threshold was too low. Measured,
that strike reads **1.4237 T — the third LARGEST value in the whole corpus.** In that failure mode
MediaPipe places BOTH ankles ~310 px from the HIP while leaving them ~344 px from EACH OTHER, and a
mutual-separation predicate is blind to it by construction, at any threshold. Reaching it would need
`f ~ 1.43`, deleting 26 of 29 strikes. The spec states this non-claim explicitly so nobody reads the
requirement as covering it.

## D12. Known consequence — Demo 1's overstriding card loses its evidence image

`[evidence-coverage]` reports `overstriding: all-gated-out` on Demo 1 after this change. **It is not
the exemplar quality gate**: a probe inside `computeOverstriding` shows the metric still builds and
selects a pair at t = 4.84 / 5.52, quality **0.5**, on the two surviving strikes — exactly what the
plan expected. The drop happens one layer later, at `isTooFarApartPair`.

Measured, same run, `[pair-growth-probe]` inside that guard, `EVIDENCE_MAX_PAIR_CROP_GROWTH` = 2.5
throughout:

| pair | crop growth | outcome |
|---|---|---|
| the two SURVIVING strikes (4.84 / 5.52) | **2.881** | dropped |
| the pair the baseline drew (per CLAUDE.md) | 2.428 | passed |

The baseline's image was the ghost of the two COLLAPSED strikes — they were the value extremes
(-0.7215 and +0.5102), and their compressed poses kept the union crop small enough to clear the cap.
That image is precisely what the user reported: "the Overstriding card's evidence shows a trailing
swing leg, not a footstrike." The card now shows **no** picture rather than a wrong one.

The surviving pair is two genuine strikes one step apart, which on a 4K side view is ~1180 px of
subject translation against a tight hip-to-ankle box — the same structural shape as
`verticalRatio`'s stride pair on this clip (`strides-nrg`, growth 4.53). With `n = 2` there is
exactly one possible pair, so there is no alternate to fall back to. **`EVIDENCE_MAX_PAIR_CROP_GROWTH`
was NOT touched**, for the reasons `strides-nrg` records: 2.881 is not marginal, and admitting it
re-admits `trunkLean`'s 6.1-6.8 pairs on the same clip. Recovering an image here needs a different
construction (a letterboxed crop, or a composed side-by-side rather than a ghost) — a product
decision, filed as a follow-up rather than solved by moving a constant.

## D13. What was deliberately not done

- No `HeuristicsConfig` override plane (CLAUDE.md backlog) — the arms were two checkouts, diffed.
- The +0.11 s footstrike lag (`strides-24s`) is untouched. It is real and reproduces on all four
  Demo 1 strikes, and it is not what makes t = 6.16 report a foot landing behind the hip.
- No `MIN_*_SAMPLE_SIZE` moved, including the four siblings `stepWidth.ts` already declined to sweep.
- No exemplar constant, coverage formula or confidence formula changed anywhere.
