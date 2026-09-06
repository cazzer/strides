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
Composition is not available: on `kneeDrive` subject-centring is precisely what moves the crop away
from the knee, so any scheme that lets it act first and then aims within what it left would have to
undo it.

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

## D5. `kneeDrive`'s image changes instant on `side-landscape`, and why that is a pre-existing rule

Giving `kneeDrive` alternates hands the walk a list it did not have, and the walk's **existing**
"demotion is the LAST RESORT" ordering (`strides-ddj`) then applies:

| | before | after |
|---|---|---|
| instant | 2.26667, right | **3.28333, right** |
| paired | `null` (**collapsed-pair**) | **3.35** (a real ghost) |
| quality | 1.000 | **0.7437** |
| `cropSidePx` | 320 | 357.786 |
| knee `fx` / `fy` | 0.042 / 0.677 | **0.500 / 0.500** |

The walk planned three candidates and stopped: 1.000 collapsed, 0.795 far-apart-demoted, 0.744 a
drawable pair. 0.744 is therefore the **best-scoring candidate that renders as a pair**.

Trading a quality-1.000 demoted single for a quality-0.744 genuine pair is the repo's own written
policy, and `kneeDrive`'s own module doc agrees with it: "one still of a lifted thigh, with nothing
to read the lift against, is not evidence." The new image is busier at the 142 px inline size — the
runner is smaller and behind a chain-link fence at t ≈ 3.3 — but it shows the comparison the
caption promises, where the old one could not. Recorded here rather than smoothed over, so a
reviewer can overrule it on sight.

`kneeFlexion` on the same clip takes the same route and the result is unambiguous: the winning
candidate is a real pair at t = 2.5 ↔ 2.6333, quality 0.806, knee at **0.500 / 0.500**.

## D6. Measured framing, before and after

Fresh Chromium per clip, real GPU, one dev-only `[crop-probe]` in `planExemplarFrames` dumping
`{metric, kind, side, quality, timestamp, demotion, crop, frameSize}` plus every crop keypoint's
resolved position — added, measured and **reverted** per the repo's add-measure-revert cycle.
`fx`/`fy` are the reported knee's position within its own crop, `0.5` being dead centre.

| clip | metric | before: instant / `fx` / `fy` | after: instant / `fx` / `fy` |
|---|---|---|---|
| `side-landscape` | `kneeFlexion` | 3.51667 left / **0.0501** / **0.7626** | 2.5 right / **0.5000** / **0.5000** |
| `side-landscape` | `kneeDrive` | 2.26667 right / **0.0422** / **0.6771** | 3.28333 right / **0.5000** / **0.5000** |
| `side-portrait` | `kneeFlexion` | 5.7 left / 0.3983 / 0.4871 | 5.7 left (**unchanged**) / **0.5000** / **0.5000** |
| `side-portrait` | `kneeDrive` | 5.46667 right / 0.5678 / 0.5979 | 5.46667 right (**unchanged**) / **0.5000** / **0.5000** |

**`side-portrait` does not regress**: both metrics keep their instant, their quality
(1.0 and 0.955047), their `cropSidePx` (330.58890281989864 and 320) and their `cropGrowth`. Only
the crop's `x`/`y` move, which the coverage line does not report — which is why the A/B shows
nothing for that clip and the probe is what demonstrates the improvement.

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

`focusOffset` is added to `EvidenceFramePlan` but deliberately **not** to the
`[evidence-coverage]` payload: that payload is an enumerated field list, so adding one would put a
new row on every metric of every clip and swamp the diff that is this change's own gate. The cost
is that a future regression in aiming is not visible on the coverage line — see "Open" below.

## D9. A/B gate

```
node scripts/ab-person-selection.mjs --arm 'base={}' \
  --clips side-landscape,side-portrait,front-approach --trials 3 --evidence
```

Three trials per clip, fresh Chromium per trial, dev server started and identity-verified by the
run, real GPU. Before/after differ on **exactly** these lines:

- `evidence.clips[0].metrics.kneeFlexion.exemplars[0].*` on `side-landscape` — `cropGrowth`
  `null` → 1.41593, `cropSidePx` 320 → 656.637, `demotion` `collapsed-pair` → `null`,
  `pairedTimestamp` `null` → 2.63333, `quality` 0.993409 → 0.806473, `side` left → right,
  `timestamp` 3.51667 → 2.5
- `evidence.clips[0].metrics.kneeDrive.exemplars[0].*` on `side-landscape` — as tabulated in D5
- three `elapsedMs` lines, ranges overlapping in both directions

**Nothing in `metrics.*`, `sampling.*`, `personSelection.*` or `view.*` moved on any clip**, and
neither `side-portrait` nor `front-approach` moved at all. Compared with
`rtk proxy diff` and cross-checked with `md5` on the body below the provenance header
(`b5d7544f116901b61a988a68db177255` → `cfaa04c7276288fe7f252c504431f7b4`), per `strides-ef5`.

## Open

- **`focusOffset` is not on the `[evidence-coverage]` line**, so the aiming this change adds is not
  observable from a harness without a probe. Deliberate, to keep this change's own A/B diff
  readable; worth revisiting if a second consumer of the number appears.
- **`kneeDrive`'s new `side-landscape` image is a busier picture than the one it replaces** (D5). It
  is the correct outcome under the repo's own last-resort ordering and it shows the comparison its
  caption promises, but it is a visible change a reviewer may want to overrule.
