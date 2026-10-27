# Backlog, tracking crop, person-of-interest

> Moved verbatim from CLAUDE.md on 2026-10-27 to keep the auto-loaded file under the size limit. Index: CLAUDE.md "Notes index". Cross-references like "above"/"below" may now point into a sibling file in this directory.

## Backlog (assessed, not yet built)

One more iteration plane was scoped but deferred as of 2026-08-11 — same "bundle into one
config, thread it through, dev-only override" pattern as the sampling/robustness and
model-backend planes above:
- **Math/heuristics**: `computeFormHeuristics` already takes a `HeuristicsConfig` — threshold
  iteration is free today, just needs the same override-point treatment for a harness to swap
  it without a code edit.

Model/detection backend selection shipped 2026-08-11: `src/pose/detector.ts`'s registry now has
`'movenet'`, `'blazepose'`, `'posenet'`, and `'mediapipePoseLandmarker'`, with a dev-only
override point (`window.__STRIDES_POSE_BACKEND_OVERRIDE__`, see above). MoveNet's
Lightning-vs-Thunder variant is exposed too, via the same override's `movenetModelType` field —
tested, Thunder came out worse (see comparison results above). BlazePose's and MediaPipe
PoseLandmarker's lite/full/heavy-equivalent variant selection is still hardcoded (`full`) —
narrower follow-up if that granularity is ever needed. Status: `movenet` and
`mediapipePoseLandmarker` work; `blazepose` and `posenet` are broken, see "Known issues" above.
GitHub issues #24 (MoveNet variant — done, results recorded), #25 (MediaPipe Tasks Vision — done,
works), #26 (PoseNet — done, confirmed broken, not worth further investment).

Input preprocessing now has a pluggable stage too: MoveNet's backend gained an external
tracking-crop layer (`src/pose/backends/movenetCrop.ts`, `trackingCropConfig.ts`) — once a
subject is detected, subsequent frames run against a padded, upscaled crop centered on the
tracked bounding box instead of the full (possibly 4K, subject-too-small-after-downscale) frame,
falling back to full-frame detection after sustained tracking loss. Config override: the same
`window.__STRIDES_POSE_BACKEND_OVERRIDE__`'s `trackingCrop` field, see "Config overrides" above.
It was the "input preprocessing has no pluggable stage" backlog item (built 2026-08-11, ported
onto the 15-keypoint/9-metric main and re-verified 2026-08-13 — fresh A/B table below).

**Ships `enabled: false` by default** — decided by a pre-registered rule in the 2026-08-13
revival A/B (both demo clips, 3 trials per arm, real GPU, crop-on vs `{ enabled: false }`):

| | track, crop off | track, crop on | park, crop off | park, crop on |
|---|---|---|---|---|
| detectedFrames | 75/75/75 | **77/78/79** | 75/75/76 | 62/75/76 |
| view confidence | 0.755–0.774 | 0.779–0.782 | 0.073–0.136 | 0.099–0.175 |
| kneeFlexion conf | 0.94–0.98 | **0.83–0.85** | ~0.06 (front-gated) | ~0.07 (front-gated) |
| cadence/VO conf | 0.71–0.74 median (one bad-fit 0.15) | 0.60–0.72 | **0.63–0.69, tight** | **0.18–0.77, median 0.32** |

On the side-view track clip cropping helps (more detected frames, slightly higher view
confidence — same direction as the original 2026-08-11 verification), and the known kneeFlexion
confidence cost reproduces (0.83–0.85 vs 0.94–0.98, still tier-1). But on the front-approach
park clip — where the subject's on-screen scale changes ~3× — the lagging tracked box mismatches
the subject and consistently halves cadence/vertical-oscillation confidence (median tier T2→T3),
which fired the pre-registered "any median tier degrades → default off" rule. Two implementation
notes from the revival: the bbox deliberately EXCLUDES the head keypoints (nose/ears) — a
15-point box was measured strictly worse than the original 12-point one (it inflates the padded
crop side ~560→674px on the reference fixture and jitters frame-to-frame; detectedFrames dropped
to 69–72 vs 75 baseline) — and tracking only helps *after* a first confident detection, so it
never addresses the cold-start moment (subject entering frame small/distant), a genuinely
different problem (upstream resize before *any* detection) that remains unbuilt. Full two-round
tables: `openspec/changes/archive/*movenet-tracking-crop/design.md` "Revival note". Enable for
experiments via `{ trackingCrop: { enabled: true } }` in the backend override.

⚠️ **ADDENDUM 2026-08-29/31 (`strides-09k`) — the pre-registered rule NO LONGER FIRES, and the
default stays OFF on a DIFFERENT basis. The 2026-08-13 table above is left exactly as measured.**
Re-run with `scripts/ab-person-selection.mjs --backend-arm`, **3 fresh-process trials per arm**,
both demo clips, real GPU, dev server identity-verified. Every field had **zero spread except
`elapsedMs`**, so there is no range column to read a conclusion out of.

Re-adjudicated cell by cell across all 11 metrics on both clips
(`metricConfidence.ts` boundaries: `normal` ≥ 0.7, else `caveated`, `excluded` on a null value):

| clip | tiers that DEGRADE | tiers that IMPROVE |
|---|---|---|
| demo1 (track) | **none** | `cadence` caveated → **normal** (0.634 → 0.728) |
| demo2 (park) | **none** | none |

**"Any median tier degrades → default off" does not fire.** The cell the 2026-08-13 decision
turned on still degrades — park `cadence`/`verticalOscillation` confidence **0.37247 → 0.155874**,
more than halved — but no longer crosses a tier boundary, because the *off-arm baseline itself*
moved down: 0.63–0.69 then, **0.372 today**, already caveated. There is no tier left to lose. The
cold-trial artifact is gone outright: park `detectedFrames` read 62/75/76 (on) vs 75/75/76 (off) in
2026-08-13 and is now **99/99 in both arms, no spread** — that penalty was the regime, not the arm.

On demo1 the crop is uniformly BETTER: `detectedFrames` 53 → **59**, `segmentCount` 4 → **3**,
`segments[0].endTimestamp` 6.32 → **7.16**, and confidence up on `kneeFlexion` (0.864 → 0.992),
`trunkLean` (0.941 → 0.992), `footStrikePattern` (0.875 → **1.0**), `overstriding` (0.875 → **1.0**),
`verticalOscillation` (0.719 → 0.826), `verticalRatio` (0.479 → 0.550).

**The default stays `enabled: false` anyway, and the reason is new.** A rule that does not fire
removes a reason to keep the crop off; it supplies no reason to switch it on. Meanwhile the fresh
run surfaces what the 2026-08-13 table structurally could not, because that table reported
confidences and not values:

| demo2, **`normal` tier in both arms** | off | on | ratio |
|---|---|---|---|
| `stepWidth.value` @ confidence **1.000** both arms | 0.225311 | **0.0717871** | **3.1×** |
| `kneeFlexion.value` (caveated both arms) | 106.103° | **177.686°** | a straight knee at peak flexion |

A full-confidence card reads 3× differently on the same clip with nothing noticing. Flipping a
shipped default on evidence that also shows that is not a defensible trade. Filed as `strides-90l`.

Person-of-interest (multi-pose acquisition/reacquisition) shipped 2026-08-15 on
`openspec/changes/multi-person-acquisition/` (branch `claude/detection-pipeline-person-id-xh63ni`,
not yet merged to this branch/main as of this writing) — the MoveNet backend gains a
person-of-interest concept it previously lacked entirely. `SINGLEPOSE_LIGHTNING`/
`SINGLEPOSE_THUNDER` have no way to tell people apart; live testing (real browser, headless
Chromium) found the tracked skeleton could lock onto a background bystander instead of the
runner (full repro: proposal.md's "Why"). Fix: a `MULTIPOSE_LIGHTNING` pass, run only at
acquisition (no prior anchor for the run) and reacquisition (anchor confidence dropped below
`reacquisitionLossThreshold`), scored by bbox-area×confidence on acquisition and
IoU/proximity-continuity on reacquisition — plus two additive mechanisms so a correct
acquisition/reacquisition moment actually keeps sticking, not just wins once: a bounded
settle-in window (`POST_ACQUISITION_SETTLE_FRAMES`, default 3 calls) that forces crop-mode
framing around the just-selected/reconfirmed anchor independent of
`trackingCropConfig.enabled`, and periodic re-verification (`REVERIFICATION_INTERVAL_FRAMES`,
default 45 calls) that re-runs multi-pose selection even when confidence hasn't dropped, to
catch MoveNet's own saliency smoothly drifting onto a different person without ever tripping the
confidence-based reacquisition trigger. Ships **`personOfInterest.enabled: true` by default**
(`src/pose/backends/personOfInterestConfig.ts`) — unlike tracking-crop above, this is a
correctness fix for a live-confirmed bug rather than a pure optimization, so the pre-registered
ship rule was "confidence tiers hold → default on," the inverse of tracking-crop's "any median
tier degrades → default off." Config override: the same
`window.__STRIDES_POSE_BACKEND_OVERRIDE__`'s `personOfInterest` field.

**Measured cost — real, not free.** 2026-08-15 live-browser A/B (both demo clips, 3 trials/arm,
real GPU, `enabled: true` vs. `false`): confidence tiers hold (track stays T1 both ways; park is
T2 at baseline and T2-or-better after, never degrading) and metric values stay close (cadence
within ~2-3%, verticalOscillation within ~3-5%), but detected-frame/total-sample counts drop —
track loses ~16% of detected frames (~4% of samples), park loses ~25% of both. Mechanism: the
acquisition dispatch on frame 1 of every run, plus periodic re-verification, both do real
inference work that competes with `sampleClip.ts`'s real-time sampling loop for wall-clock
budget. As of this writing this has not been decomposed into settle-window-only vs.
re-verification-only contributions — `POST_ACQUISITION_SETTLE_FRAMES`/
`REVERIFICATION_INTERVAL_FRAMES` have no runtime override point by design, so isolating them
would need a temporary code patch not made in this A/B; the number above is the combined,
ship-relevant cost. Full table: `openspec/changes/multi-person-acquisition/design.md`'s
"Live-browser A/B results" section.

⚠️ **ADDENDUM 2026-08-29/31 (`strides-09k`) — most of the cost figure above is WITHDRAWN. The
default is NOT under review and does not change. The 2026-08-15 numbers are left as measured.**
Same regime as the tracking-crop addendum: `--backend-arm`, 3 fresh-process trials per arm, both
demo clips, real GPU, zero spread on every field but `elapsedMs`.

**First, the 2026-08-15 figure was measured on a quantity that has since changed meaning.** It read
`sampling.detectedFrames`, which became **post-person-selection on 2026-08-16** — one day later,
when `retroactive-person-selection` shipped. The comparable pre-selection count today is
`personSelection.detectedSamplesIn`. Both are given, because they say different things and only one
is user-visible:

| | demo1 off → on | Δ | demo2 off → on | Δ |
|---|---|---|---|---|
| `detectedSamplesIn` (pre-selection — the 2026-08-15 quantity) | 84 → 66 | **−21.4%** | 99 → 99 | **0%** |
| `sampling.detectedFrames` (post-selection — what a user gets) | 47 → **53** | **+12.8%** | 99 → 99 | **0%** |
| `sampling.totalSamples` | 228 → 228 | **0%** | 99 → 99 | **0%** |
| `elapsedMs` | 3753 → 5765 | **+53.6%** | 2448 → 3134 | **+28.0%** |

- Track's pre-selection cost is **real and slightly larger than claimed** (−21.4% vs −16%).
- **Park's −25% is WITHDRAWN** — measured exactly 0 on both counts, no spread.
- **The "~4% of samples" cost is WITHDRAWN on both clips** — `totalSamples` is identical everywhere.
- **User-visible throughput on track is a GAIN, +12.8%**, because selection keeps far more of what
  the POI path detects than of what it detects without it.
- **The real cost is wall-clock, +28% to +54%, and 2026-08-15 did not report it.**

The mechanism is visible in the selection counters and directly corroborates the ship decision:
with POI **off**, demo1's winning segment does not begin until `segments[0].startTimestamp`
**4.36 s** and `rejectedOtherSegment` is **32**; with it **on**, the winner runs from **0.08 s**
with **10** rejected and `separationRatio` 689 → **2374**.

⚠️ **One honest contradiction: "confidence tiers hold" does NOT fully reproduce.** On demo1
`cadence` degrades `normal` → `caveated` with POI on (0.7176 → 0.6341); no other tier moves either
way on either clip. Read it with the values beside it — `cadence.value` 93.6 (off) vs **91.2**
(on), and **91.2 is this repo's own standing anchor** for that clip
(`fit.frequencyHz × 60 = 91.2 == cadence.value`, re-confirmed three times). The higher-confidence
arm is the one that disagrees with ground truth. Filed as `strides-bfv`.

**Validation gap — the actual reported bug is not yet confirmed fixed on real footage.** This
change also added this repo's first e2e/Playwright test infrastructure
(`e2e/multiPersonAcquisition.spec.ts`, run via `npm run test:e2e`, separate from the mocked
`npm test` Vitest unit suite) against a real multi-person clip (`e2e/fixtures/multiperson-track.mp4`,
e2e-only, not UI-wired). 3 trials, real GPU: the multi-pose dispatch mechanism fires correctly
and identically every trial — roughly 30 acquisition attempts before the runner is confidently
detected (~t=1.52s), then two periodic re-verification dispatches — and a keyframe spot-check
confirms the clip genuinely has a second, near-field person (a walker) in frame alongside the
runner for most of the clip, not just a distant background crowd. But candidate count never
exceeded 1 across ~33 sampled dispatch calls in any of the 3 trials — `MULTIPOSE_LIGHTNING` never
registered two simultaneously-confident poses in these particular runs. So "the tracked skeleton
correctly favors the right person over a bystander" is confirmed only on synthetic unit-test
fixtures, not yet on real footage — closing this needs either more trials (this repo's documented
GPU/frame-timing determinism caveat means different frames get sampled run-to-run) or a clip
where the second person is detected as confidently as the first. What IS confirmed on real
footage: the fixture reliably exercises the acquisition + periodic-re-verification code paths
end-to-end. Full description: same design.md section, "Multi-person fixture" paragraph.

The eval harness/comparison tooling this backlog used to list as missing now exists for the
sampling/robustness plane: `scripts/ab-person-selection.mjs` (#53, documented under "Live-browser
verification harness" above) drives multi-trial, labeled, diffable A/Bs across all three clips.
The backend (`__STRIDES_POSE_BACKEND_OVERRIDE__`), scale-pass and heuristics planes are still
hand-driven — extending the driver to them is unbuilt, not designed away.

From the vertical-oscillation accuracy investigation (2026-08-12, see section above), not yet
built:
- **Ship-or-don't decision on local/smoothed torso-length normalization** in
  `computeVerticalOscillation` — a defensible correctness fix (global-median normalization is
  provably wrong under camera-distance change, verified harmless on a stable clip) that wasn't
  cleanly validated as an *improvement* because the only ground-truth clip is too short/noisy to
  validate anything against. Needs either a decision to ship it anyway on correctness grounds, or
  a better validation clip first.
- **Confirm the Vertical-Ratio-vs-raw-VO assumption with the user** — this investigation targeted
  matching VO_cm/stride_length_cm × 100 (a percentage) since the user's watch reading was given
  as "~10%", but that's inferred from the unit, not confirmed. Changes which normalization
  concept (torso-length vs. stride-length) is even the right target.
- **A lateral-motion ground-truth clip** — the only clip with a known-correct reading (the park
  demo, front/approach view) structurally can't validate stride-length normalization
  (`estimateTravelDirection` returns indeterminate on it — no net horizontal pixel displacement
  at that camera angle). Would need a side-view clip, filmed like the original track demo, with a
  watch reading to actually test the stride-length direction.
- **A longer or multi-trial-averaged ground-truth clip generally** — the park clip is ~1.65s
  (~2-3 real strides); per-half-cycle bounce ratios within a single run spanned 2.8%-59%, and
  which half-cycles even get detected varies between identical runs (GPU non-determinism). No
  normalization scheme can be responsibly validated against a single short run of this clip.

