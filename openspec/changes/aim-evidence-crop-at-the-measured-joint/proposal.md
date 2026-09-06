# Aim an evidence crop at the joint the card reports on

## Why

User report (`strides-dxd`): *"knee flexion evidence isn't centered in the screen cap."* Confirmed
by driving the shipped demo and looking at the image — on `park-side-landscape.mp4` the knee the
card is reporting on sits at `fx 0.050, fy 0.763` of its own thumbnail: the bottom-left corner,
with a bystander occupying the middle.

Two independent causes, both measured (`strides-dxd`'s 2026-09-05 notes; the three causes its
DESCRIPTION originally named are all refuted there and are not what this change addresses).

**1. A bit-exact tie broken by leg-iteration order.** `kneeFlexion` pools 14 swing-phase peaks on
that clip. An EVEN pool makes the median the mean of the two middle values, so those two are
*exactly* equidistant from it; `typicality` is a function of that distance, so their qualities are
bit-identical — `0.993408575524356` for both. `buildExemplars` sorted on quality alone,
`Array.prototype.sort` is stable, and peaks are pushed left-leg-first, so the left-leg candidate
won every such tie unconditionally. The discarded right-leg twin puts the knee at `fx 0.282`,
mid-frame. Nothing about the leg made it the better picture; the iteration order did.
`side-portrait` has 15 peaks and so no tie today — but its runner-up would have put the knee at
`fx 0.961`, the right frame edge. That clip is one parity bit from the same failure.

**2. The crop is aimed at the seed box, not at the joint.** `computeEvidenceCropRect` centres on
the box the exemplar's `cropKeypoints` span, and a joint at one end of a limb chain is not at that
box's centre. At peak flexion the knee is the LOWEST of hip/knee/ankle, so it lands in the bottom
quarter (`fy 0.68–0.77`) on **all fourteen** candidates — systematic, not unlucky. On `kneeDrive`
it is worse than that: the floor-inflated crop qualifies for `subjectCentredCropRect`, which pulls
it 101 px *away* from the knee and puts it at `fx 0.042`.

Both fixes are required. Fix 1 alone leaves the knee at `fy 0.75`; fix 2 alone leaves it at
`fx 0.05`, because at the shipped instant the runner is two-thirds out of frame and the crop is
already flush against `x = 0` — there is no other in-frame placement.

## What Changes

- **`MetricExemplar` gains an optional `cropFocus: KeypointName`** — the ONE joint the card's
  number is about. Absent means "no single joint is at the centre of this picture", which is true
  of every bounce amplitude, stride length and step width, and those exemplars are framed exactly
  as they are today.
- **A crop naming a focus joint is aimed at it**, subject to still containing the measured region
  and still lying inside the frame. That placement takes precedence over centring on the subject,
  which is the rule that was pulling `kneeDrive`'s crop off the knee.
- **`kneeFlexion` and `kneeDrive` name the knee** and **offer their whole ranked candidate list**,
  head plus `alternates`, on the terms the two range metrics already use.
- **The fallback walk separates candidates the metric scored equally by framing.** Quality still
  dominates absolutely; framing only decides where the metric's own ranking is indifferent. An
  exemplar naming no focus joint keeps first-wins ordering exactly.

Nothing that reads a crop's SIZE can observe any of this: `cropSidePx`, `cropGrowth`,
`EVIDENCE_MAX_PAIR_CROP_GROWTH` and `EVIDENCE_CROP_MIN_SIDE_PX` are untouched, and only `x`/`y`
move.

## Impact

- Affected specs: `form-heuristics` (2 modified, 1 added), `results-view` (2 modified)
- Affected code: `src/heuristics/types.ts`, `src/heuristics/kneeFlexion.ts`,
  `src/heuristics/kneeDrive.ts`, `src/heuristics/exemplars.ts` (doc only),
  `src/results/evidenceFrames.ts`
- **No metric value, confidence, viewFit, sampling or person-selection field moves anywhere** —
  verified by a three-clip `scripts/ab-person-selection.mjs --evidence` A/B, where the only
  non-`elapsedMs` differences are `kneeFlexion`'s and `kneeDrive`'s own exemplar rows on
  `park-side-landscape.mp4`.
- `kneeDrive`'s image on that clip changes instant, from a quality-1.000 collapsed single to a
  quality-0.744 genuine pair. That is the pre-existing "demotion is the walk's LAST RESORT" rule
  acting on a list it did not have before, not a new preference — see design.md D5.
