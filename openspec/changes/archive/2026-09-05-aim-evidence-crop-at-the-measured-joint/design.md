# Design — aim an evidence crop at the joint the card reports on

Bead `strides-dxd`. Everything below was measured in headless Chromium on real GPU
(`ANGLE Metal Renderer: Apple M4 Pro`, never SwiftShader), fresh Chromium process per clip, dev
server on the derived per-checkout port and identity-verified, reading the LAST
`[evidence-coverage]` line. Base commit `a23fd4d`.

## D0. What the ticket's DESCRIPTION said, and why none of it is implemented

`strides-dxd` originally named three causes. Its own 2026-09-05 measurement pass refutes all three,
and this change deliberately implements none of them. Recorded so nobody re-derives them:

1. *"`kneeFlexion` seeds on one leg with an EMPTY context set, so the torso and head hang outside
   by construction."* **Backwards.** Passing a non-empty context set makes it strictly worse:
   growing the box toward the subject's full extent gives `paddedSide` 923.6, `x` clamps to 0
   again, and the knee lands at `fx` 0.017 — three times worse than the 0.050 measured. Also
   `footStrikePattern`'s context (`left_heel`/`left_foot_index`) is MediaPipe-only and resolves to
   nothing on MoveNet, so the comparison the description drew does not hold on the shipped backend.
2. *"For a genuine pair the crop centre falls BETWEEN the two bodies."* **Not active on either
   clip.** `side-landscape`'s exemplar is a collapsed pair — one box, no union — and
   `side-portrait`'s pair growth is 1.033, so its two instants are essentially co-located.
3. *"`subjectCentredCropRect` fires only when the floor binds, and it is off-centre anyway, so it
   is either not firing or firing and not centring."* **Neither.** On `kneeFlexion` it does not
   fire (`qualifiesX` false: `paddedSide` 289.275 ≤ `subjectW` 191.95 is false; `qualifiesY` false:
   `subjectH` 577.22 < `side` 320 is false) — **and firing it would have been bit-identical**,
   because subject x-centre 100.86 and crop x-centre 106.44 both give a negative `x` and both clamp
   to 0. The runner is two-thirds out of frame at that instant, occupying `x ∈ [4.9, 196.8]` of
   3840. There is no other in-frame placement of that crop.

The real causes are D1 and D2.

## D1. A bit-exact tie broken by leg-iteration order

`kneeFlexion` pools **14** peaks on `park-side-landscape.mp4`. An EVEN pool makes the median the
mean of the two middle values, so those two are *exactly* equidistant from it; `typicality` is
`1 − dev/(3·MAD)`, so their qualities are bit-identical. `c[0].quality === c[1].quality` is exactly
`true`.

| candidate | quality | knee `fx` | knee `fy` | x clamped |
|---|---|---|---|---|
| t = 3.5167 **left — shipped** | `0.993408575524356` | **0.050** | 0.763 | **yes** |
| t = 2.4167 **right — tied, discarded** | `0.993408575524356` | **0.282** | 0.752 | no |

`buildExemplars` sorted with a bare `(a, b) => b.quality - a.quality`; `Array.prototype.sort` is
stable; peaks are pushed left-leg-first. So the left-leg candidate won every such tie
unconditionally.

`side-portrait` has **15** peaks (odd), so its winner is the unique median at quality `1.0` and
there is no tie today — but its runner-up would have put the knee at `fx` **0.961**, the right
frame edge. **That clip is one parity bit from the same failure**, which is why this is fixed as a
general tie-break rather than for the even case.

⚠️ **Explicitly NOT fixed by flipping the leg iteration order or preferring the right leg.** That
fixes one clip by luck and leaves the mechanism intact.

## D2. The crop is aimed at the seed box, not at the joint

`computeCropRect` centres on the box `cropKeypoints` spans. At peak flexion the knee is the LOWEST
of hip/knee/ankle, so it lands in the bottom quarter — `fy` 0.68–0.77 — on **all fourteen**
candidates. Systematic, not unlucky.

`kneeDrive` is worse, and for a second reason: its floor-inflated crop DOES qualify for
`subjectCentredCropRect`, which moves it +101 px toward the subject's centre and away from the
knee. Measured at its shipped instant (t = 2.2667, right): hip (2245.6, 1365.3), knee
(2155.6, 1478.6), box 90 × 113, `paddedSide` 181.3 → floor 320. Box-centred the crop would sit at
`x` 2040.6; subject-centred it sits at **2142.1**, putting the knee at `fx` **0.042**.

That is the collision this change resolves in favour of the joint (see D4).

## D3. Both fixes are required

- Fix 1 alone: the tie goes to the right-leg twin at `fx` 0.282 — better, but `fy` stays ~0.75.
- Fix 2 alone: the shipped left-leg instant's `x` cannot move (already at 0), so `fx` stays 0.050;
  only `fy` improves, to 0.525.

## D4. Why aiming REPLACES subject-centring rather than composing with it

Both rules re-place the same rectangle on the same axes, so where both apply only one can win.
Composition is not available **where aiming actually moves the crop**: on `kneeDrive`
subject-centring is precisely what moves the crop away from the knee, so any scheme that lets it act
first and then aims within what it left would have to undo it.

Considered and rejected: composing them only where aiming is a no-op. Where containment or the frame
clamp pins the aim, `focusAimedCropRect`'s interval collapses and it returns `current` unchanged, so
subject-centring could still run there without ever contradicting an aim. Rejected because it buys
nothing and costs clarity — the rule would then read "aiming wins, except when it had no opinion, in
which case a different rule wins", and a reader would have to derive which regime a given crop is in
before predicting its placement. A metric that names a focus joint is framed by one rule on every
clip.

Aiming is the narrower and better-evidenced statement of the same intent. `subjectCentredCropRect`
exists (`strides-e9b`) to stop floor-inflated area landing on whoever stands beside the runner; a
crop centred on the runner's own knee is centred on the runner by construction. Its documented
counter-example — `kneeFlexion` on `multiperson-track.mp4` "riding 66 px UP the body" and promoting
a walking bystander — is not reachable here, because aiming at the knee moves the crop DOWN the
body, not up. Verified by looking at the rendered image on that clip: the knee is centred on the
runner and no bystander is promoted (see D7).

**Containment is what keeps aiming honest.** The aim is clamped into the interval of positions that
still contain the exemplar's own crop box, and only then into the frame. `kneeFlexion`'s image has
to show the hip and the ankle or the angle at the knee reads against nothing — and unclamped aiming
would push the hip out: at the shipped instant the box spans `y ∈ [1418.97, 1587.03]`, the knee is
at `y` 1587.03 (the box's own bottom), and centring exactly on it would put the crop at `y` 1427.03
with the hip 8 px above the top edge.

That clamp is also why aiming is never worse than not aiming: `computeCropRect`'s own box-centred
placement satisfies containment whenever the box fits inside the side, so the aimed position is a
move from there TOWARD the joint on each axis, never away.

Where the interval is empty — the frame cap made the crop narrower than the box it must hold — the
crop keeps its existing placement, that being the best available placement of a square that cannot
contain its own contents.

## D5. `kneeDrive` keeps `slice(0, 1)` and takes `cropFocus` alone — the alternates were reverted

**Review round 1 overruled the first pass here, and the evidence is in the first pass's own probe.**
Fix 1 (the ranked-alternates list) is load-bearing for `kneeFlexion` and a pure cost for
`kneeDrive`. What the first pass measured, and what that measurement actually shows:

| | baseline | with alternates (reverted) | shipped: `cropFocus` only |
|---|---|---|---|
| instant | 2.26667, right | 3.28333, right | **2.26667, right** |
| paired | `null` (**collapsed-pair**) | 3.35 (a real ghost) | `null` (**collapsed-pair**) |
| quality | 1.000 | 0.7437 | **1.000** |
| `cropSidePx` | 320 | 357.786 | **320** |
| crop `x` / `y` | 2142.115 / 1261.949 | — | **1995.621 / 1318.611** |
| knee `fx` / `fy` | 0.042 / 0.677 | 0.500 / 0.500 | **0.500 / 0.500** |

The `cropFocus`-only column is not a new measurement: it is the first pass's own probe line for the
candidate the alternates list DISCARDED. Its crop centres on (2155.62, 1478.61), which is the knee
to full precision. **So aiming alone already reaches 0.500 / 0.500 on this metric's old instant, and
the alternates list buys it nothing.**

What the list cost: the t = 3.283 image has the runner smaller and cut off at the crop's right edge,
a fence post down the middle, and the 35 % ghost sitting directly on a bystander in a white cap
(confirmed present in the source frame). And the quality drop is **not** a `detectionFactor`
artifact — `pairQuality` is a `Math.min`, and `detectionFactor` over `kneeDrive`'s two-keypoint seed
can only be 0, 0.5 or 1, so 0.7437 is the peak's own `typicalityFactor`. Typicality is exactly what
that card's median number is about, so this is a real loss of representativeness, not a bookkeeping
one.

**The principled counter is real and is preserved, not dismissed.** `kneeDrive` has the same even-pool
exposure `kneeFlexion` has, and `slice(0, 1)` leaves it one parity bit from the same bug. But on
this corpus its candidates score 1.000 / 0.7955 / 0.7437 — **no tie was ever active** — so the list
bought a latent guarantee and spent a live image for it. The real culprit is the walk's
unconditional "a pair at ANY rank beats a demoted single" rule meeting a longer list; a
quality-aware version would let both metrics carry alternates with no regression. Filed as
**`strides-hw8`**, which also records what to change here when it ships.

`kneeFlexion` keeps its list, and on the same clip the result is unambiguous: the winning candidate
is a real pair at t = 2.5 ↔ 2.6333, quality 0.806, knee at **0.500 / 0.500** — where its baseline
was a collapsed single at `fx` 0.050 with the runner two-thirds out of frame.

## D6. Measured framing, before and after

Fresh Chromium per clip, real GPU, one dev-only `[crop-probe]` in `planExemplarFrames` dumping
`{metric, kind, side, quality, timestamp, demotion, crop, frameSize}` plus every crop keypoint's
resolved position — added, measured and **reverted** per the repo's add-measure-revert cycle.
`fx`/`fy` are the reported knee's position within its own crop, `0.5` being dead centre.

| clip | metric | before: instant / `fx` / `fy` | after: instant / `fx` / `fy` |
|---|---|---|---|
| `side-landscape` | `kneeFlexion` | 3.51667 left / **0.0501** / **0.7626** | 2.5 right / **0.5000** / **0.5000** |
| `side-landscape` | `kneeDrive` | 2.26667 right / **0.0422** / **0.6771** | 2.26667 right (**unchanged**) / **0.5000** / **0.5000** |
| `side-portrait` | `kneeFlexion` | 5.7 left / 0.3983 / 0.4871 | 5.7 left (**unchanged**) / **0.5000** / **0.5000** |
| `side-portrait` | `kneeDrive` | 5.46667 right / 0.5678 / 0.5979 | 5.46667 right (**unchanged**) / **0.5000** / **0.5000** |

**`side-portrait` does not regress**: both metrics keep their instant, their quality
(1.0 and 0.955047), their `cropSidePx` (330.58890281989864 and 320) and their `cropGrowth`. Only
the crop's `x`/`y` move. When this table was first measured that made the clip invisible to the
A/B — the coverage line reported no field that could change — and the probe was the only
demonstration. **That gap is now closed**: `focusOffset` is on the line (D8), so `side-portrait`'s
improvement is visible in the A/B itself and a later aiming regression there cannot ship green.

⚠️ **The `kneeDrive` after-column is the `cropFocus`-only result**, per D5 — the alternates list
that moved its instant to 3.28333 was reverted in review round 1. Aiming alone reaches
0.5000/0.5000 at its original 2.26667 instant.

`front-approach` is **out of scope and vacuous, not failed**: `kneeFlexion` and `kneeDrive` are
both `viewFit: unsuitable` there, tier-3 excluded, and report `metric-excluded` on the coverage
line. There is no card to centre anything in.

## D7. `multiperson-track.mp4`, checked for the documented bystander risk

Not part of the acceptance criterion, checked because `subjectCentredCropRect`'s own doc names this
clip as the one where re-placing a knee crop promoted a walking bystander. Rendered images pulled
out of the DOM and looked at: `kneeFlexion` (t = 3.15, right, quality 0.887, crop 561.3 px) and
`kneeDrive` (t = 3.41667, right, quality 0.753, crop 320 px) both centre on the RUNNER's knee, with
the bystander at the left edge where they were. No promotion.

## D8. Constants, and what cannot observe this change

`EVIDENCE_CROP_MIN_SIDE_PX` (320), `EVIDENCE_MAX_PAIR_CROP_GROWTH` (2.5),
`EVIDENCE_CROP_PADDING_MULTIPLIER` (1.6) and `MIN_EXEMPLAR_QUALITY` (0.5) are **untouched** — `git
diff` shows zero changed assignments. Only a crop's `x`/`y` move, so `cropSidePx`, `cropGrowth`,
`isTooFarApartPair` and `evidencePairCropGrowth` are all blind to the aiming.

`focusOffset` is added to `EvidenceFramePlan` **and to the `[evidence-coverage]` payload**. The
first pass omitted it, on the grounds that the payload is an enumerated field list so a new row on
every metric of every clip would swamp this change's own gate diff. **Review round 1 overruled
that**, on the repo's own written precedent: `EvidenceCoverageExemplar.cropGrowth`'s doc says it is
a number on that line "for the same reason: it is what `EVIDENCE_MAX_PAIR_CROP_GROWTH`'s calibration
bracket is stated in, so re-checking that bracket on real footage should not need a probe patch and
a private console prefix." This change's acceptance criterion is stated in exactly the quantity
`focusOffset` measures, and re-checking it DID need a probe patch and a private prefix — with the
consequence, admitted in D6, that on `side-portrait` (one of the two in-scope clips) the A/B is
blind to the entire effect of the change and a future aiming regression ships green. A one-time
measurement artifact is not a reason for a permanent contract gap, and
`scripts/ab-person-selection.mjs` flattens whatever keys are present precisely so a ticket adding a
diagnostic need not edit the harness. `strides-ddj` broke this same contract three days earlier
(`demotedFromPair` → `demotion`), took the 20-removed / 21-added diff, and recorded it.

**Recorded, because this change inherits a blind spot rather than opening one:** the coverage line
carries `cropSidePx` but not `crop.x` / `crop.y`, so `subjectCentredCropRect` (`strides-e9b`) is
equally invisible to any harness reading that line — it too moves only a crop's position. That
predates this change. But it is now the second placement rule to ship unobservable, and two is when
a gap becomes a policy; `focusOffset` closes the half of it this change is responsible for.

## D9. A/B gate

```
node scripts/ab-person-selection.mjs --arm 'base={}' \
  --clips side-landscape,side-portrait,front-approach --trials 3 --evidence
```

Three trials per clip, fresh Chromium per trial, dev server started and identity-verified by the
run, real GPU (`ANGLE Metal Renderer: Apple M4 Pro`). **Re-run after review round 1**, because two
of that round's fixes change what the report contains: reverting `kneeDrive`'s alternates puts its
rows back on baseline, and putting `focusOffset` on the coverage line adds a row per exemplar.

`before.txt` is base `a23fd4d`. **69 differing lines: 11 removed, 29 added, and 29 unchanged
context.** Nothing outside `evidence.*` and `elapsedMs` appears anywhere in the diff — verified by
filtering the diff for changed lines matching neither prefix, which returns empty. No `metrics.*`,
`sampling.*`, `personSelection.*` or `view.*` field moved on any clip.

| | removed | added |
|---|---|---|
| provenance header (`# commit:`) | 1 | 1 |
| `kneeFlexion.exemplars[0]` on `side-landscape` | 7 | 7 |
| `elapsedMs` | 3 | 3 |
| `focusOffset` rows (new field, no removals) | 0 | **18** |
| **total** | **11** | **29** |

**`kneeDrive` is back to baseline.** It contributes no removed line at all, and exactly one added
one — its own `focusOffset`. Its instant, quality, `cropSidePx`, `demotion` and `side` on both side
clips are bit-identical to `a23fd4d`.

**`kneeFlexion` on `side-landscape` is the only pre-existing field set that moves**, and it is the
defect: `timestamp` 3.51667 → **2.5**, `side` left → **right**, `demotion` `collapsed-pair` →
**`null`** (a real ghost), `pairedTimestamp` `null` → **2.63333**, `cropSidePx` 320 → **656.637**,
`cropGrowth` `null` → **1.41593**, `quality` 0.993409 → **0.806473**.

**The new field reports the fix directly, which is what it was added for.** Every knee row on both
side clips reads `focusOffset` **exactly `0`** — integer zero in the JSON, not a rounded float, on
all three trials of both clips:

| clip | metric | instant | `focusOffset` |
|---|---|---|---|
| `side-landscape` | `kneeFlexion` | 2.5 right | **0** |
| `side-landscape` | `kneeDrive` | 2.26667 right (**unchanged**) | **0** |
| `side-portrait` | `kneeFlexion` | 5.7 left (**unchanged**) | **0** |
| `side-portrait` | `kneeDrive` | 5.46667 right (**unchanged**) | **0** |

`0` is Chebyshev distance zero, i.e. `fx` = `fy` = 0.500 exactly — the D6 probe reading, now
reproduced by the standing harness with no probe patch. **`side-portrait` was invisible to this
gate before round 1** (nothing it reported could move on that clip); it now demonstrates its own
improvement.

Every other metric on every clip gained a `focusOffset` of `null` and moved nothing else.
`front-approach` contributes only `null` rows: both knee metrics are `metric-excluded` there, so
they have no exemplar rows at all.

⚠️ **`elapsedMs` on `front-approach` reads high**, 2880 [2859..3559] → 3606 [3527..4876], barely
overlapping. Wall-clock only, and this run shared the machine with other work; `detected 99/99` is
identical on all three trials, so throughput is unaffected. Recorded rather than smoothed.

Compared with `rtk proxy diff`, per `strides-ef5`. The body-below-header md5s
(`b5d7544f116901b61a988a68db177255` → `4cb600a504e21504c1d4fe2ebc073f38`) differ, which is the
expected direction here — the failure mode that rule guards against is a false "identical", and
this diff is not empty.

## Open

- **The walk's "a pair at ANY rank beats a demoted single" rule is not quality-aware** — filed as
  **`strides-hw8`**. It is why `kneeDrive` ships `slice(0, 1)` rather than the alternates list its
  shape otherwise warrants (D5), and until it is fixed that metric keeps the even-pool tie exposure
  `kneeFlexion` actually hit. `strides-hw8` records exactly what to change here when it ships.
- **`crop.x` / `crop.y` are still absent from the `[evidence-coverage]` line**, so
  `subjectCentredCropRect`'s placement remains unobservable from a harness (D8). Pre-existing, not
  opened here, and `focusOffset` closes the half this change is responsible for.
