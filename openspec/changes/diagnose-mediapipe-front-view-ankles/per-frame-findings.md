# H1 key numbers (ankle per-frame data, raw pre-robustness)

Source: probe-raw-output.json (per-frame console dumps), probe-analysis.json (computed stats),
analyze-summary.txt (condensed printout), analyze.mjs (analysis script), keyframes/ (visual checks).

## torsoLengthPx / BSR sanity check (validates methodology against production numbers)

| clip | backend | torsoLengthPx (median) | BSR (my calc) | BSR (production) |
|---|---|---|---|---|
| demo2 | mediapipe | 250.39 | 0.5216 | 0.5229 |
| demo2 | movenet   | 232.81 | 0.5570 | 0.5510 |
| demo1 | mediapipe | 437.61 | 0.1207 | 0.1207 |
| demo1 | movenet   | 413.51 | 0.1009 | 0.1335 |

torsoLengthPx ratio mp/mn: demo2 = 1.075x, demo1 = 1.058x. NOT a 4.8x-scale denominator problem —
mediapipe's torso reads consistently ~6-8% larger than movenet's in both clips, nowhere near
enough to explain the SER gap. Denominator effectively ruled out as the primary driver.

## SER numerator, raw (pre-robustness) vs what it would need to be

meanRange = mean(p95-p5 of ankle.x-hip.x, left leg; same, right leg), matching computeSagittalRange.

demo2: mp meanRange=163.0, mn meanRange=77.13 -> raw SER_mp=163.0/250.39=0.651, SER_mn=77.13/232.81=0.331
  production SER: mp=1.5911, mn=0.3284
  my SER_mn (0.331) matches production almost exactly (1% off) -> methodology validated.
  my SER_mp (0.651) is only ~2x production SER_mp/SER_mn=4.8x -> raw detection alone explains
  ~2x of the 4.8x gap. The remaining ~2.4x is NOT visible in raw per-frame data -> points at the
  INTERPOLATION layer amplifying a small number of bad raw frames (see mechanism below).

## THE SINGLE MOST IMPORTANT NUMBER

demo2, mediapipe, left ankle: dropping just the 13 most-extreme frames out of 87 (14.9%) —
all of which fall in t<0.45s — collapses meanRange from 163.0 to 70.8, i.e. BELOW MoveNet's own
77.1. Full trim curve (mean of both legs' p95-p5 range, dropping k extremes from each tail):

| tMin cutoff | n | rangeL | rangeR | meanRange |
|---|---|---|---|---|
| 0 (all frames) | 87 | 256.4 | 69.6 | 163.0 |
| 0.30s | 83 | 243.0 | 67.9 | 155.5 |
| 0.45s | 74 | 88.6 | 53.1 | **70.8** |
| MoveNet reference (full clip) | 96 | 103.0 | 51.3 | 77.1 |

14.9% of frames account for >100% of the raw numerator inflation. This is a HANDFUL OF OUTLIERS,
not a smooth systematic bias, in the raw per-frame data.

## Mechanism (confirmed by reading src/pose/robustness/interpolate.ts, no fix applied)

1. MediaPipe fails to detect at all for 10 of 12 frames in a ~0.18s window at clip start
   (t=0.083-0.234s), sandwiched between two detected-but-WRONG frames at t=0.067 (rel_l=307px)
   and t=0.250 (rel_l=327px). MoveNet has ZERO missing frames in this window and reads normal
   values throughout (rel_l -18 to -50, rel_r -4 to +40) — confirms no real excursion is
   happening here; this is a MediaPipe-only failure.
2. `interpolateChannel` in interpolate.ts does a straight lerp between the nearest 'present'
   samples flanking any run of missing/low-confidence states, gated only by maxGapSeconds=0.5s
   (this gap is 0.183s, well inside tolerance). Because BOTH flanking real detections (307, 327)
   are themselves extreme/wrong, all ~10 interpolated frames in between are lerp'd between two
   near-identical extreme values, so they ALSO land in the extreme zone.
3. Net effect: what is only 2-4 raw detected outlier frames becomes ~14 total frames (raw +
   interpolated) all sitting in the 300+px tail once robustness/interpolation runs — pushing
   that population from ~4.6% up past the 5th/95th percentile cutoff, so percentile(0.95) stops
   being protected by the trim and reads close to the raw extreme value directly. This is the
   most likely explanation for the gap between my raw ~2x finding and production's ~4.8x.
   NOT independently verified by re-running the actual robustness pipeline in this probe —
   verified only by reading interpolate.ts's logic and confirming the gap (0.183s) and endpoint
   values (307, 327) satisfy its interpolation-triggering conditions. Worth a follow-up
   hypothesis/agent replaying this exact window through `applyRobustness` directly if further
   confirmation is wanted.

## What's actually happening at t<0.45s (why MediaPipe fails here specifically)

At t=0.050/0.067/0.250/0.284, MediaPipe's left_ankle AND right_ankle land within 1-20px of EACH
OTHER (both collapse onto nearly the same image point) while sitting 150-330px from the hip.
MoveNet, looking at the same frames, reports both ankles near the hip (~30-40px), consistent with
a normal running gait, and also shows its own ankles converging at t=0.083 (la=826.4, ra=826.4,
a natural footstrike/pass-through) WITHOUT any wild divergence following it.
Interpretation: the subject is still small/distant at clip open (t<~0.28s is exactly where
MediaPipe fails to detect at all 10/12 frames) and MediaPipe's independent per-frame left/right
ankle regression appears to collapse both labels onto one ambiguous/unresolved point that happens
to read far from the hip. This is NOT a clean left<->right label swap (a strict nearest-neighbor
repairing test found dSwap NOT << dSame for these transitions — see analyze-summary.txt
"sign flips" / swap-test section) and it is NOT out-of-frame extrapolation (zero normalized
coords outside [0,1] on demo2, confirmed below).

## Cross-check against the keyframe investigator's occlusion findings — NEGATIVE

Occlusion-confirmed frames (ffmpeg n=58,60,66,70,82,84,90,98 -> app-domain t ~= 1.001, 1.034,
1.134, 1.201, 1.401, 1.435, 1.535, 1.668s) were checked directly against my per-frame series.
ALL EIGHT read unremarkable, MoveNet-like values (rel_l between -22 and -126, well inside the
normal cluster, nowhere near the 150-330px outlier zone). The frames actually driving the SER
inflation (t<0.45s) are a DIFFERENT, earlier part of the clip than the confirmed-occluded window.
Conclusion: swing-leg occlusion (t~1.0-1.7s) does NOT appear to be what's inflating SER on this
clip — the outlier-driving failure is specifically a clip-opening/small-subject phenomenon, not
an occlusion-during-normal-stride phenomenon. This is a genuine disagreement with the occlusion
hypothesis as an explanation for the numerator inflation specifically (occlusion may still be
real and may still affect other things, e.g. general position noise — just not this).

## Q2: Out-of-frame (normalized coords outside [0,1])

- demo2 (the clip with the actual 4.8x problem): ZERO out-of-frame ankle/heel/toe events across
  all 87 detected frames. Out-of-frame extrapolation is REFUTED as the demo2 mechanism.
- demo1: 4 out-of-frame LEFT ankle frames (t=4.00-4.12s, nx just barely negative, -0.0005 to
  -0.034), heel/toe co-affected. Visibility on these ~0.775-0.783, not dramatically lower than
  demo1's overall median (0.94) but not the highest either. Demo1's raw numerator range is
  essentially IDENTICAL between backends regardless (see Q6 below), so this doesn't move SER
  there either.

## Q6: Demo1 (side view) — genuinely clean, not just masked

Raw p95-p5 meanRange: mp=619.08px, mn=627.49px -> ratio 0.987 (1.3% apart). This is NOT "a
proportionally-equal hidden defect masked by large amplitude" — the two backends' raw numerator
distributions are statistically indistinguishable on this clip. Demo1 is clean.

## Q7: The 12 missing demo2 frames

Concentrated at the very START of the clip (t=0.033-0.267s, 12 of 99 calls), NOT late in the clip
as the task's initial hypothesis speculated (subject largest/most cropped). This is the opposite
timing — earliest frames, subject smallest/most distant. Directly adjacent to (interleaved with)
the same window that produces the worst outlier detections (see mechanism above).

## Q5: Left/right sign-ordering — real but NOT the SER driver

Static ankle crossover count (fraction of frames where left_ankle.x > right_ankle.x):
- demo2 mediapipe: 84/87 (96.6%)
- demo2 movenet: 0/96 (0%, i.e. always the opposite ordering)
- demo1 mediapipe: 29/57 (51%, alternates roughly evenly — expected for a side view stride)
- demo1 movenet: 0/63 (0%, always one ordering — itself a bit surprising for a side view)

MediaPipe and MoveNet disagree, consistently, about which physical leg is screen-left vs
screen-right on demo2 (a front-approach clip) — a real, systematic labeling-convention
difference between the backends worth downstream awareness. BUT this does not explain SER's
inflation: SER is computed per-leg-label against that SAME leg's own hip
(ankle.x - hip.x), independent of the other leg's absolute position, so a globally-consistent
left/right relabeling does not by itself change the percentile range — it would only matter if
the labeling flips WITHIN a leg's own series over time. The automated pairwise nearest-neighbor
swap test (dSwap vs dSame) found no transitions on demo2 matching a clean intra-series swap
signature. Net: this is a real, notable side-finding, not the SER driver.
