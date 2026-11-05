## Context

See proposal.md. Everything below was measured on real GPU (ANGLE Metal, M4 Pro) with a temporary
`[poi-probe]` (reverted before commit) that logged every `estimatePose` decision. The probe also ran
a SEPARATE multi-pose "oracle" instance on every frame, so the trace shows who was in frame next to
what the tracker chose. The oracle shares no state with the detector under test. Its base-arm traces
reproduce the integration-branch gate values exactly (e.g. IMG_9345: 112 detected, segment from
0.100 s). Traces, the probe driver and the summarisers are kept privately in
the second-runner baseline in `fixtures-private/` (folder `strides-p1qt.15/`).

## Root cause (one mechanism, three symptoms)

Identity is decided from ONE multi-pose frame, then defended by continuity: the steady-state gate,
reacquisition and re-verification all prefer whoever is already anchored. Grouping the oracle's
detections into tracks shows that on every failing clip the runner is the dominant person once
she is in frame (largest median and integrated area). She just isn't anchored:

| clip | anchored first | runner enters / is visible | runner vs anchor (oracle area) |
|---|---|---|---|
| IMG_9345 | orange-cap man, f0 | f8 (right edge) | 109k vs 37k at f9, ~150–230k vs 30–140k after |
| IMG_9348 | stationary bystander, f0 (runner below the pose-score floor) | f12 | 36k vs not-detected at f12; 2–4× from f33 |
| IMG_9117 | worker behind the SUV | ~2.2 s | 343k vs 40k |
| side-landscape / multiperson (same footage, 4K / 1080p) | walker behind the fence | ~1.4 s (right edge) | 4–12× |

And at every settle-in exit, `rawDetector.reset()` sends MoveNet back to `initCropRegion`'s
centre square (x 840–3000 of a 3840 landscape frame). A runner at either edge is outside it, so
MoveNet locks onto whoever is inside (IMG_9345 f4: the green-shorts man, tracked to f105; IMG_9348
f16: nobody, then the bystander; IMG_9117 2.40 s: the worker, as d90 recorded).

## Decisions

### D1. One change: decide identity from accumulated evidence, then hand it to MoveNet

Seeding alone (strides-p1qt.3) preserved whatever was anchored, including wrong acquisitions; a
challenge alone (strides-d90) switched correctly and then lost the runner at the next hand-off.
Each half is the other's precondition, so they ship together, each with its own config switch.

### D2. Two regimes, by how well the identity is established

A freshly chosen identity is TENTATIVE: one multi-pose frame is weak evidence (people below the
floor are invisible, and the runner may not have entered yet). Every 4 calls the check re-runs
acquisition over everyone visible. The anchor winning is a confirmation (3 make it settled).
Anyone else wins with ≥1.5× the anchor's box, or with comparable size (≥ 1/1.5) when the check
cannot see the anchor at all. That last clause decides IMG_9348: at f12 multi-pose sees only the
runner, the same size as the unconfirmed bystander pick.

A SETTLED identity changes only to someone ≥3× its box (the continuity gate's own `maxAreaRatio`,
so a challenger is by construction someone the gate would never merge with the anchor) on 2
consecutive checks 10 calls apart, by the same person.

### D3. Scale against the tracked single-pose box, never the multi-pose match

The first version compared against the anchor's multi-pose match, and it flip-flopped on IMG_9345.
At f22 the runner's multi-pose box collapsed to 55k (motion blur at 448 px input) while her
single-pose crop box was 204k, so the orange-cap man (142k) "won" by 2.6×. Then she won back at
f27. Against the tracked box he loses. A collapsed match can now only make a challenger look
smaller, so the rule errs toward the incumbent. The match is still used to answer *who* the
anchor is in the frame.

Also measured and rejected: comparing acquisition SCORES (area × confidence) for the tentative
margin. It did not stop the f18/f22 flips, because blur lowers the runner's keypoint confidence too.

### D4. The settled regime does not need to see the anchor

The second version required the anchor's match in the same frame (apples-to-apples). On
side-landscape and IMG_9117 the anchored walker/worker is 4–40k px² and multi-pose usually
misses him, so a 4× / 8× runner never accumulated a streak (switch delayed from f98 to f138 on
side-landscape; no switch at all on IMG_9117). Comparing against the tracked box fixes both. A
check that sees no one leaves the streak alone; one that sees people but no qualifying challenger
ends it.

### D5. A dedicated, stateless multi-pose instance

d90 measured that borrowing the shared multi-pose instance for extra checks drifts later
acquisition and re-verification output, on clips where no check ever switched. The cause is the
library's `BoundingBoxTracker` and per-track one-euro filters, which every call advances. The
challenge therefore gets its own instance, created with `enableTracking: false,
enableSmoothing: false`, in parallel with the other two. Same cached weights. A failed creation
means "no challenge".

### D6. Seeded hand-off retries only on failure

p1qt.3 seeded unconditionally and moved values on clips where the plain reset was fine
(front-approach VO 0.204 → 0.215). Here the plain reset runs first. Only when its result does
not pass the continuity gate against the anchor (or is empty) is the frame re-run, with MoveNet's
`cropRegion` written from the anchor's keypoints (a rule-for-rule port of
`determineNextCropRegion`). The write is guarded: a detector without the field is left untouched,
not even reset.

## Measurement

Probe arm (final configuration, all 9 + IMG_9117, fresh process each):

| clip | identity switches | seeded hand-offs | segment start (base → new) | frames | cadence | VO |
|---|---|---|---|---|---|---|
| IMG_9345 | 1 (f13, tentative, orange cap → runner) | 3 | 0.100 → 0.250 | 112 → 122 | — → — | — |
| IMG_9346 | 0 | 1 | 0.033 → 0.033 | 70 → 73 | 176.4 → 180 (GT 182) | 0.168 → 0.173 |
| IMG_9347 | 0 | 1 | 0.700 → 0.033 (partition start; runner from f20) | 67 → 86 | 175.2 → 174 (GT 177) | 0.162 → 0.164 |
| IMG_9348 | 1 (f13, tentative) | 2 | 1.233 → 0.250 | 79 → 138 | 176.4 → 180 (GT 176) | 0.229 → 0.185 |
| IMG_9349 | 0 | 0 | unchanged | | | |
| IMG_9117 | 1 (2.433 s, settled, 8.2×) | 2 | 2.733 → 2.433 | 95 → 113 | 157.2 → 163.2 | 0.131 → 0.118 |
| side-landscape | 1 (f98, settled) | 2 | 1.800 → 1.667 | 106 → 114 | 174 → 172.8 | 0.154 → 0.160 |
| side-portrait | 0 | 1 (f23, runner entering at the left edge) | unchanged | 277 → 278 | — | 0.171 → 0.168 |
| front-approach | 0 | 0 | unchanged | | | |
| multiperson | 1 (f94, settled) | 2 | 2.133 → 1.600 | 101 → 119 | 174 → 170.4 | 0.220 → 0.150 |

The gate run (commit 78a6ccb9, `--evidence --scale-pass --outline-pass --perf`, fresh process,
under the gate lock, against the integration branch at 43c81dd7) reproduces every value above. front-approach
and IMG_9349 are bit-identical (0 non-timing fields differ). An arm with both features off is
bit-identical to integration on IMG_9345, and reproduces the 9117 "before" (95 frames from
2.733 s). Metric-tier changes: multiperson cadence/VO/VR caveated → normal; IMG_9347 VR
caveated → normal; IMG_9348 cadence and VO normal → caveated (138-frame window instead of 79;
cadence 180 is inside GT 176 ±4), stepWidth caveated → normal. None elsewhere.

**Every changed public value is runner-for-bystander or runner-for-nothing:**
- *multiperson / side-landscape* are the same footage (keyframes at 2.0 s are identical apart from
  scale). Base anchored the fence walker until a re-verification switch. The challenge switches
  0.53 s / 0.13 s earlier. multiperson's VO moves 0.220 → 0.150, to agree with its own 4K twin
  (0.154 base, 0.160 new); base's 0.220 was the outlier.
- *side-portrait* gains the one frame the f23 hand-off used to drop; VO moves 0.171 → 0.168.
- *IMG_9346 / IMG_9347*: the runner is kept through the hand-off she used to be lost at (she is at
  the frame edge at that moment). 9346 cadence moves toward GT.

## Remaining gap: IMG_9345 cadence (not this change's mechanism)

With the runner now tracked from f13, cadence is still withheld. As she leaves the frame (f107–114)
her box shrinks 213k → 72k, and at f115 MoveNet's crop slides onto the background runner who was
overlapping her (GT: "directly behind the subject's head and torso at f104–109"). 38k is within 3×
of her shrunken 72k, so the gate and retroactive selection both accept the swap. The segment runs
to f137, and the hip trace steps ~200 px. The sinusoid fit then locks onto 1.2 Hz (R² 0.21).
Nulling just those frames (dev-only drop of 1.94–2.30 s, measured) gives **cadence 186**
(GT 190 ±3), R² 0.70, VO 0.166. This is an exit/occlusion hand-over: the identity is right, and
it leaks at the frame edge through the frame-to-frame scale ratchet that the online gate and
retroactive segmentation share. Follow-up bead.

## Risks / Trade-offs

- **Cost.** One more model instance at construction, and one multi-pose call per 4 (tentative) or
  10 (settled) calls; at most one extra single-pose call per settle-in exit. Sequential sampler:
  wall-clock only. Real-time playback sampler (WebM/webcam): may cost sampled frames; not exercised
  by any A/B clip.
- **A bystander genuinely ≥3× the runner, persistently**, would take a settled anchor. Retroactive
  selection downstream still scores by integrated area, which would pick the same person.
- **Tentative switch on an invisible anchor.** A tentative runner whom multi-pose misses for one
  check, next to a comparable-size bystander, can be displaced. This is bounded by the 3-confirmation
  window; never observed on the 10 clips.
