import type { KeypointName } from '../pose/types'
import { COMMON_KEYPOINT_NAMES } from '../pose/types'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { BoundingBoxPx, CropRectPx } from '../pose/backends/movenetCrop'
import {
  computeBoundingBoxIoU,
  computeCropRect,
} from '../pose/backends/movenetCrop'
import type {
  FormHeuristicsResult,
  MetricExemplar,
  MetricExemplarKind,
  MetricId,
  MetricResult,
} from '../heuristics/types'
import {
  MAX_EXEMPLARS_PER_METRIC,
  MIN_EXEMPLAR_QUALITY,
} from '../heuristics/exemplars'
import { resolveBilateralPair, resolvePoint } from '../heuristics/keypoints'
import { median } from '../heuristics/mathUtils'
import { estimateBodyScale } from '../heuristics/bodyScale'
import { estimateTravelDirection } from '../heuristics/travelDirection'
import { trimToPresenceWindow } from '../heuristics/presenceWindow'
import { findNearestFrame } from './skeletonGeometry'
import { metricTier } from './metricConfidence'
import { GRAFTED_METRIC_IDS } from './scalePassGraft'

/**
 * The PURE half of evidence-frame extraction: given a metric's exemplars plus that clip's
 * `robustFrames` and pixel dimensions, decide which timestamps to pull, what rectangle to crop
 * each to, which two to blend, and at what opacities. The impure half — a detached `<video>`,
 * seeking, `drawImage`, compositing — consumes this and lives elsewhere.
 *
 * **Zero DOM, zero canvas, deliberately.** jsdom has no canvas and this repo refuses the `canvas`
 * npm package as a native-binary CI/sandbox risk (`src/test/canvasTestUtils.ts`), so anything
 * decided in the drawing layer is untestable. The precedent is exact: `skeletonGeometry.ts`'s
 * `toDrawOps` is fully unit-tested while `SkeletonOverlay` gets a thin smoke test. Everything
 * decidable is decided here.
 *
 * **Timestamps come from `robustFrames[].timestamp` and nothing else.** `VideoMetadata.durationSec`
 * does not appear in this module, and this module's frame-size parameter is deliberately narrowed
 * to `{ width, height }` so it cannot: MediaRecorder WebM blobs commonly report an infinite
 * duration and `useVideoSource.ts` copies `video.duration` in unguarded, so any
 * fraction-of-duration arithmetic would produce garbage on webcam clips.
 */

/**
 * Relative enlargement of the box the exemplar's own crop keypoints produced. ONE pair of
 * constants for every metric, not a per-metric table: per-metric framing already exists one layer
 * up, in the seed ∪ context keypoint set each metric names on its own exemplars, so a foot crop
 * and a full-body crop already differ by an order of magnitude before any padding. A second
 * per-metric table would vary apparent subject scale across the evidence images, which is the one
 * thing a single aspect ratio exists to hold constant.
 *
 * Lower than the tracking crop's 1.75 because the two buy different things. The tracking crop pads
 * for MOTION — its box is one frame old and the subject moves before the next inference. This box
 * is the union across both frames it will actually draw, so the motion is already inside it and
 * padding buys context only. `computeCropRect` squares by taking `max(width, height)`, so on the
 * tall-thin box a human produces the multiplier only controls the long-axis margin: 1.6 leaves
 * 30% of the box's own long dimension as margin at each end.
 */
export const EVIDENCE_CROP_PADDING_MULTIPLIER = 1.6

/**
 * Floor on the crop's side, in native video pixels — a guard against a DEGENERATE box, not a
 * target. `max(boxWidth, boxHeight) × 1.6` is `0` for a seed that resolves to a single point (one
 * hip with no resolvable context, or a knee/hip/ankle that nearly align), and without the floor
 * that crop is empty.
 *
 * Chosen against the VIEWER rather than a detector: an evidence image renders at a couple of
 * hundred CSS px at most — the inline card thumbnail is `w-36`, i.e. 144 CSS px nominal and 142
 * measured — so 320 native px survives a 2× DPR display without upscaling to mush. Note
 * `computeCropRect` applies its `min(frameWidth, frameHeight)` cap LAST, so on a small source
 * (a 320×240 webcam clip) the cap wins and this floor can never demand pixels the source lacks.
 */
export const EVIDENCE_CROP_MIN_SIDE_PX = 320

/**
 * The base instant is drawn first, at full opacity — in BOTH jobs below, which is why this is one
 * constant and not two. Two constants that must always be equal are a coupling waiting to break.
 */
export const EVIDENCE_BASE_OPACITY = 1
/**
 * The `globalAlpha` the ghost PHOTOGRAPH is composited at, over an already-drawn base. `source-over`
 * onto a transparent canvas makes the result `α·ghost + (1 − α)·base`, so this is a **65/35 split in
 * the base's favour** — the compositing input and the resulting weight are different numbers, which
 * is what the `ALPHA`/`OPACITY` split in these two names is recording. Keep it below
 * `EVIDENCE_GHOST_MARK_OPACITY`, so the ghost's photograph is fainter than the DETECTED marks drawn
 * on it. Its interpolated marks are already fainter still — a ghost interpolated joint paints at
 * `INTERPOLATED_OPACITY × EVIDENCE_GHOST_MARK_OPACITY`, below this — so the bound is about the marks
 * a reader is meant to trust, not about every mark. Both bounds are pinned in
 * `evidenceFrames.test.ts`.
 *
 * **Why not symmetric.** The caption names one instant *ghosted against* another and the annotation
 * layer draws the base's marks solid and the ghost's weak — both by requirement. A 50/50 photograph
 * under those two picks no winner, and a reader resolves the contradiction from whatever cue is
 * strongest in that image, which is not reliably the base (`strides-c37`).
 *
 * **Why not lower.** On a static camera the shared background reproduces at `α + (1 − α) = 1`
 * whatever this is, while each body's contrast against it scales with that body's own weight. Fading
 * the ghost therefore fades it against a background that never fades, and the floor is a function of
 * each clip's own subject-against-background contrast rather than of this number alone.
 *
 * Measured, not chosen: five arms (0.50 / 0.40 / 0.35 / 0.30 / 0.25) composited from one extraction
 * per clip and judged on every ghosted exemplar of all three test clips **at the 144 px size the
 * card actually renders** — not at full resolution, where 0.40 also looks emphatic and 0.25 still
 * looks fine. 0.40's emphasis does not survive the 640→144 downscale; 0.25 loses the ghost entirely
 * on the lowest-contrast clip. Full sweep:
 * `openspec/changes/weight-evidence-ghost-below-base/design.md`.
 */
export const EVIDENCE_GHOST_BLEND_ALPHA = 0.35
/**
 * The frame-level multiplier on the ghost's ANNOTATION marks — a different decision from
 * `EVIDENCE_GHOST_BLEND_ALPHA` above, deliberately carried by its own constant so that moving the
 * photographic weight cannot silently move the marks. Read only by `evidenceAnnotations.ts`; this
 * module never applies it.
 */
export const EVIDENCE_GHOST_MARK_OPACITY = 0.5

/**
 * Intersection-over-union above which a pair's two per-frame boxes are treated as the same
 * instant. A ghost of two indistinguishable frames is a blurry mess rather than a delta, and a
 * blurry double exposure is worse than one clean still.
 *
 * **This number was measured and deliberately NOT moved (`strides-r41`).** It is one of two
 * near-identical tests, and it is the one that catches a pair whose boxes coincide; it does not
 * and cannot catch a pair that is merely too CLOSE IN TIME — see
 * `EVIDENCE_MIN_PAIR_SEPARATION_INTERVALS`, which does. The temptation is to lower this until the
 * close-in-time case falls out of it, and the live data says that is unreachable: on
 * `e2e/fixtures/multiperson-track.mp4` the two-sampled-frame `kneeFlexion` pair reads IoU
 * **0.2476**, while Demo 2's perfectly legible `verticalOscillation` bounce reads **0.8330** and
 * its `armSwingSymmetry` and `stepWidth` pairs read 0.3656 and 0.2984. IoU orders these BACKWARDS
 * — any threshold low enough to reject the broken pair rejects three good ones first — because a
 * bounding box is blind to motion INSIDE itself: a knee swinging through a box changes the pose
 * completely while barely moving the hull, and a small far-away limb box changes shape a lot
 * between two adjacent frames while depicting one pose.
 */
export const EVIDENCE_NEAR_IDENTICAL_IOU = 0.98

/**
 * The fewest SAMPLED FRAME INTERVALS a pair's two instants may be apart and still be drawn as two.
 * The companion to `EVIDENCE_NEAR_IDENTICAL_IOU` above: that one asks whether the two boxes
 * coincide, this one asks whether the two moments do.
 *
 * **Why time, here, when time is the wrong measure at the far end.** `EVIDENCE_MAX_PAIR_CROP_GROWTH`
 * rejects elapsed time explicitly, and that rejection stands — at the FAR end the question is
 * whether two bodies can share one legible crop, which is spatial, and a stationary subject 1.667 s
 * apart ghosts perfectly while a sprinter 0.3 s apart does not. At the NEAR end the question is a
 * different one: not "can a reader see two bodies" but "are these two instants the two distinct
 * phases the label names". Every paired label this repo emits is a claim about gait phase — peak
 * flexion against extension, top of the bounce against the bottom, opposite-foot plants — and a
 * pair sampled two frames apart cannot be any of them at any human cadence. That is a claim about
 * the SIGNAL, whose natural unit is time, not about the picture.
 *
 * **The display measures were tried first and all three fail.** Measured live on all three test
 * clips, real GPU, against the one known-broken pair (`kneeFlexion` on
 * `e2e/fixtures/multiperson-track.mp4`, two sampled frames apart, an image showing one bent leg
 * plus a smeared foot where the caption promises a second pose):
 *
 * | measure | broken pair | tightest GOOD pair | separates? |
 * |---|---|---|---|
 * | box IoU | 0.2476 | 0.8330 (demo2 bounce) | no — backwards |
 * | median joint travel, output px | 7.10 | 5.19 (demo2 bounce) | no — backwards |
 * | joint travel ÷ box diagonal | 0.128 | 0.054 (demo2 bounce) | no — backwards |
 * | **elapsed, in sampled intervals** | **2** | **8** (demo1 `verticalOscillationCm`) | **yes, 4×** |
 *
 * The broken pair MOVES MORE than a good one on every display measure, because what moved is one
 * jittered ankle rather than a body. Only elapsed time orders them correctly, and in sampled
 * intervals the gap is empty on both sides: nothing measured sits at 3, 4, 5, 6 or 7.
 *
 * **Why intervals and not seconds.** A sampled interval is this module's own time resolution, and
 * `snapToSampledFrame` already declares that anything within half of one is the same frame. It also
 * scales the right way: a clip sampled sparsely genuinely cannot resolve phase as finely as a dense
 * one, so the floor should grow with the interval, which a fixed number of seconds would not.
 * `toleranceSeconds` is half the median interval, so twice it is the interval itself and no new
 * plumbing is needed.
 *
 * **3, and why it cannot reject a legitimate pair.** The tightest pair any metric here can honestly
 * emit is half a bounce cycle at `spectralFitMaxFrequencyHz` (4.0 Hz) — 0.125 s. Every other paired
 * kind is wider: a knee peak-to-extension and an arm-swing half cycle are half a STRIDE, twice that
 * again. At a sampled rate `r`, 0.125 s is `0.125 × r` intervals, which is at least 3 whenever
 * `r ≥ 24`. Sampling defaults to every decoded frame (`targetSamplesPerSecond: null`) and no
 * consumer capture rate is below 24 fps, so on any clip this pipeline can meaningfully fit, half a
 * bounce is three intervals or more. Measured margins: the floor lands at 0.12 s on Demo 1 (25 fps)
 * and 0.05 s on both 60 fps clips, against tightest real pairs of 0.32 s, 0.167 s and 0.167 s —
 * 2.7×, 3.3× and 3.3× clear, with the broken pair 1.5× below it.
 *
 * Honest limit: at exactly 24-25 fps the floor (0.120-0.125 s) meets that 0.125 s bound with almost
 * no margin, so a 240 spm cadence filmed at 25 fps is the one case where this could reject a real
 * bounce pair. That clip is already unfittable for an unrelated reason — 6.25 samples per cycle is
 * barely above Nyquist — so the pair would not survive its own metric's quality gate either.
 */
export const EVIDENCE_MIN_PAIR_SEPARATION_INTERVALS = 3

/**
 * The most a pair may enlarge its own crop, relative to the crop the better-framed of its two
 * instants would get on its own. `EVIDENCE_NEAR_IDENTICAL_IOU` above rejects a pair that is too
 * SIMILAR; this rejects one that is too far APART. Both defend the same thing — that the image
 * shows a delta a reader can see — from opposite directions.
 *
 * **Why a growth RATIO and not a separation.** The failure this exists for (gh #71) is a runner
 * crossing the frame between two instants: `computeEvidenceCropRect` unions both boxes, squares by
 * the long side, and the subject ends up a smudge at each edge of a picture that is mostly
 * background. What makes that unreadable is not how far the two boxes are apart, it is how far
 * apart they are RELATIVE TO THE SUBJECT — so the measure is the crop the pair needs divided by
 * the crop one instant needs, which is exactly the factor by which ghosting shrinks the subject on
 * screen. Dimensionless, so it needs no per-clip unit.
 *
 * **Read off the crop each side DEMANDS, before the frame cap** — `evidenceCropSideDemand`, and
 * `strides-492`. `computeCropRect`'s two clamps do not behave alike here, and the claim this
 * comment used to make — that the measure is "self-cancelling under both of `computeCropRect`'s
 * clamps, since a floor or a cap that binds on the pair's crop binds on the single's too" — held
 * for only one of them. The FLOOR does cancel, and in the right direction: it binds from BELOW, so
 * a pair whose union the 320 px floor already frames really is no smaller on screen than its
 * single would have been, and 1 is the honest reading. The CAP does not cancel, it ANNIHILATES: it
 * binds from ABOVE, so once the union exceeds `min(frameWidth, frameHeight)` the numerator stops
 * growing while the separation does not, and every pair past that point reads the same number.
 * Measured on 3840×2160 with a 320×1240 full-body box, the post-cap reading is 1.089 for a pair
 * half a frame apart and 1.089 again for one at OPPOSITE EDGES — the worst pair there is, scoring
 * 1.089 against this 2.5. The demand reading separates them: 1.806 and 3.097.
 *
 * That is NOT the "did the crop hit the cap" test rejected below, and the difference is not
 * cosmetic. This never asks whether a clamp bound; it is a continuous ratio of two demands, and it
 * KEEPS the floor — which is exactly what makes a small source safe. On a frame whose larger
 * dimension is `D`, the union's long side cannot exceed `D`, so the numerator cannot exceed
 * `D × 1.6` while the denominator sits on the 320 px floor: the ratio is bounded by `D × 1.6 / 320`
 * and reaches 2.5 only at `D ≥ 500`. On a 320×240 webcam clip this guard therefore cannot fire at
 * ANY separation (its ceiling there is 1.6), where a cap test would have deleted every ghost.
 *
 * **2.5, from the framing contract and bracketed by measurement.** A single frames its subject to
 * span `1 / EVIDENCE_CROP_PADDING_MULTIPLIER` = 62.5% of the image's side; growth `R` shrinks that
 * to `62.5% / R`. Requiring the better-framed instant to still span a QUARTER of the side gives
 * `0.625 / 0.25 = 2.5`. A quarter is the display floor: these images render as small as the inline
 * card thumbnail, which was 112 px when this number was derived (`strides-ac9.2`) and is 144 px
 * nominal / 142 measured since the cards were widened — a quarter of the smaller is ~28 px of
 * subject, about the least at which a human figure is still a figure. Derived against the 112 px
 * reading and deliberately NOT re-derived when the thumbnail grew: a larger display only makes
 * the same threshold more comfortable.
 *
 * Both sides of that number are pinned by images that were extracted from real clips and looked
 * at, not by taste (`strides-ac9.11`, 3 trials, bit-identical). It must exceed 2.190 —
 * `kneeFlexion` on `e2e/fixtures/multiperson-track.mp4`, two clearly legible runner positions —
 * and must not reach 3.375, the same clip's `trunkLean`, which is #71's whole-frame crop. The
 * eleven other pairs measured across the three test clips sit at 1.000–2.068, so nothing measured
 * lands between those two: moving this number is a decision to reclassify one of those images.
 *
 * Those thirteen readings were taken under the capped formula. Switching to the demand reading can
 * only RAISE a reading and never lower it — the denominator is untouched and the numerator loses a
 * ceiling — and it moves a pair at all only if that pair's own union crop was capped. Of the three
 * whose box geometry is on record here, both legible ones are byte-unchanged (`STRIDE_PAIR`
 * 2.0675, `LOPSIDED` 1.915: neither union reaches the 2160 cap on a 4K clip) and only the broken
 * one moves, 3.375 → 5.815, further from this threshold rather than nearer it. `3.375` was itself
 * `1080 / 320` exactly — union at the cap over solo at the floor — i.e. a saturated reading whose
 * true value was always larger. The 2.190 pair's boxes were not recorded, so its demand reading is
 * re-measured live rather than asserted; `cropGrowth` on the `[evidence-coverage]` line is the
 * instrument for that.
 *
 * **What it is NOT.** Not elapsed time between the instants: on that same data the good
 * `stridePair` on Demo 1 unions to 1164 px and the broken `trunkLean` to 1144 px, so absolute
 * separation orders the two backwards, and time does the same (0.56 s good, 1.667 s bad) only by
 * coincidence of these clips — a stationary subject 1.667 s apart ghosts perfectly and a sprinter
 * 0.3 s apart does not. Not "the crop hit the frame cap" either, though that is the visible
 * symptom here: `computeCropRect`'s cap binds on every crop on a small source, so a cap test would
 * delete every ghost on a 320x240 webcam clip. And not box overlap — IoU is already 0 on eight of
 * the thirteen measured pairs, including all five on Demo 1, because non-overlap is what a ghost
 * is FOR.
 */
export const EVIDENCE_MAX_PAIR_CROP_GROWTH = 2.5

/**
 * Metrics that emit no exemplars by design, so their absence is a decision rather than this run's
 * candidates all being gated out. `cadence` is a property of a SEQUENCE — two stills of a bounce
 * peak and trough depict an amplitude, which is the number the vertical-oscillation card reports
 * and the one cadence does not.
 */
const METRICS_WITHOUT_EVIDENCE: ReadonlySet<MetricId> = new Set(['cadence'])

/**
 * Exemplar kinds that still say something true from ONE frame, and may therefore be demoted to a
 * single rather than dropped when their pair cannot be drawn as a pair — whether because it
 * collapsed onto one instant or because its two instants are too far apart to share a legible
 * crop. A CYCLE (`bounceCycle`, `armSwingCycle`, `stridePair`) has nothing to say from one
 * instant, so an undrawable pair of those is dropped instead.
 *
 * **The discriminator is where the REPORTED NUMBER lives, not whether the exemplar arrived as a
 * pair.** A footstrike angle measured against the hip midline, a step width, a peak knee flexion
 * angle, a trunk-lean angle and an overstride offset are each read off a single frame; the paired
 * instant is context that helps a reader see the extreme, and losing it costs the picture its
 * comparison but not its subject. A bounce amplitude, an arm-swing amplitude and a stride length
 * are quantities OF THE DIFFERENCE between two instants — one frame of those depicts no part of
 * the number on the card.
 *
 * **A kind's NAME describes how the exemplar was BUILT, not what the card REPORTS**, and that is
 * exactly what has misled this set twice. `trunkLeanRange` and `overstrideRange` are *ranges* in
 * the sense that the two instants are the two ends of a spread — which is how the exemplar found a
 * legible extreme to show — but `computeTrunkLean` returns the median of per-frame angles and
 * `computeOverstriding` the median of per-strike ratios, each measured at ONE instant. Neither
 * card reports a difference. The repo already said so in two places before this set caught up:
 * `measuredAtInstant` (`evidenceAnnotations.ts`) records both kinds as measured at BOTH instants
 * while `bounceCycle` is measured at NEITHER, and `buildTrunkLeanMarks`/`buildOverstrideMarks` are
 * pure per-instant builders that need nothing from the other half.
 *
 * `kneeFlexionPeak` moved into this set with `strides-r41`, and on that principle rather than for
 * coverage: `kneeFlexion.value` is a peak angle at one instant, and the annotation draws that
 * angle's arc at that instant, so a demoted single still shows exactly what the card reports. It
 * was previously grouped with the cycles on the grounds that the peak "needs its adjacent trough to
 * be legible", which conflates a helpful comparison with a necessary one — and had the concrete
 * effect that the near-identical rules, which exist to REPLACE a bad ghost with an honest still,
 * silently deleted this metric's evidence instead. `trunkLeanRange` and `overstrideRange` followed
 * with `strides-ddj`, for the identical reason and with the identical concrete effect: Demo 1's
 * only surviving overstride pair demands 2.881× growth, so the card rendered nothing at all.
 *
 * **`stridePair` cannot join them, and the reason is mechanical rather than a judgement call.**
 * Its only measurement mark, `strideCaliper`, is built in `planEvidenceAnnotations` under
 * `plan.ghost !== null` — it spans the two hip midpoints, so it does not exist for one instant.
 * A demoted stride pair would keep its per-instant ticks and lose the span that IS the
 * measurement.
 *
 * Keyed on the exemplar's own `kind` rather than on `MetricId` deliberately: the kind is what the
 * exemplar says about itself and travels with it, so this module never has to hold an opinion
 * about what a given metric measured.
 *
 * Exported so the annotation suite can assert, for every member, that a demoted plan still emits a
 * measurement mark. That invariant is the whole justification for membership, and stated only in
 * this comment it would be prose no test can reach.
 */
export const SINGLE_INSTANT_KINDS: ReadonlySet<MetricExemplarKind> = new Set([
  'footStrike',
  'stepWidthStrike',
  'kneeFlexionPeak',
  'trunkLeanRange',
  'overstrideRange',
])

/**
 * The clip's pixel dimensions, in the video's own native resolution — deliberately NOT
 * `VideoMetadata`, whose `durationSec` must not be reachable from this module (see the module
 * doc). A `VideoMetadata` value passes straight in.
 */
export interface EvidenceFrameSize {
  width: number
  height: number
}

/**
 * One keypoint an exemplar named, at one instant, in NATIVE VIDEO PIXELS — the same space
 * `crop` is in, so `toEvidenceOutputSpace` is the single step between the two.
 *
 * Three-state by construction, not two: `resolvePoint` treats `'detected'` and `'interpolated'`
 * alike as *resolvable* and only `'unrecoverable'` as absent, and collapsing that to
 * resolvable/not would erase exactly the distinction an annotation exists to show — an
 * interpolated joint is a position the pipeline INFERRED, and a thumbnail that draws it as
 * confidently as a detected one overstates what was measured. The unrecoverable arm carries no
 * coordinates at all, so a mark for it cannot be accidentally anchored at the origin: the type
 * makes "drop the mark" the only reachable option.
 */
export type EvidenceKeypointPosition =
  | {
      name: KeypointName
      status: 'detected' | 'interpolated'
      x: number
      y: number
    }
  | { name: KeypointName; status: 'unrecoverable' }

/**
 * Which screen-x direction counts as "outward" (away from the body's midline) for each side, at
 * ONE instant. `stepWidth`/`stepWidthCm` multiply their raw `ankle.x - hipMid.x` by this to turn
 * it into "landed on its own side" (+) versus "crossed over" (−) (`stepWidth.ts:222-224`), so a
 * caliper drawn without it points the wrong way on exactly half of all clips.
 *
 * Per-INSTANT, never clip-wide: the metric recomputes it at every footstrike from that frame's
 * own hips, and a runner's hips swap screen sides whenever the camera crosses them.
 */
export interface EvidenceOutwardSigns {
  left: 1 | -1
  right: 1 | -1
}

/** `0` is "indeterminate", not "no travel" — `estimateTravelDirection` returns it below a
 * half-torso net displacement, and a mark whose orientation depends on it must then be drawn
 * unoriented rather than guessed. */
export type EvidenceTravelDirection = 1 | -1 | 0

/** One frame of a plan: which instant to seek to, at what opacity to draw it, and everything an
 * annotation of that instant needs. */
export interface EvidenceInstantPlan {
  /**
   * Seconds on the clip's own media clock — the timestamp of the SAMPLED frame this instant
   * snapped to, not the continuous timestamp the exemplar asked for. The extractor seeks to a
   * frame that exists.
   */
  timestamp: number
  opacity: number
  /**
   * The keypoints THIS instant's own measurement was about, resolved at THIS instant, in the
   * stated order and deduplicated. Both halves of a ghosted pair carry their own list, so an
   * annotation of the base and an annotation of the ghost are independently drawable.
   *
   * Deliberately the exemplar's `annotationKeypoints`/`pairedAnnotationKeypoints` (falling back to
   * `cropKeypoints`, see `resolveInstantAnnotationKeypoints`) and not the whole skeleton: the
   * metric that measured the instant is the only layer that knows which points its measurement is
   * about, and a tight crop drawn with all 21 points is mostly marks for joints outside the frame
   * (design D5). The CROP still unions both instants of a pair — the image has to contain both —
   * so a mixed-side pair's two lists are narrower than the crop set and differ from each other.
   */
  keypoints: EvidenceKeypointPosition[]
  /** `null` when this frame's two hips do not both independently resolve, or resolve to the same
   * x — the degenerate case `stepWidth` records and hard-rejects (`stepWidth.ts:230`). Guessing a
   * side here would be a false statement about which way the runner's foot crossed. */
  outwardSign: EvidenceOutwardSigns | null
  /**
   * Which side of the body THIS instant's measurement was about — `null` where the metric is not
   * per-side at all, or where it is but did not say. Resolved by `resolveInstantSide`; never
   * guessed, and never defaulted to a side.
   *
   * Distinct from `EvidenceFramePlan.side`, which is present only when BOTH instants share a side.
   * `overstriding` and `stepWidth` both pair instants that need not be the same foot, so on their
   * pairs — the common case for both — the frame-level field is absent while this one is not.
   */
  side: 'left' | 'right' | null
}

/** One renderable image: a base frame, optionally a ghost composited over it, and the square crop
 * both are drawn through. */
export interface EvidenceFramePlan {
  metric: MetricId
  kind: MetricExemplarKind
  /** Present only where the metric measures per side and both instants share it. */
  side?: 'left' | 'right'
  quality: number
  label: string
  base: EvidenceInstantPlan
  /** `null` for a single-instant exemplar, and for a pair that collapsed to its base. */
  ghost: EvidenceInstantPlan | null
  /** Square, in native video pixels — the display size is the renderer's decision, not this one. */
  crop: CropRectPx
  /**
   * Which way the runner is travelling across the frame, clip-wide. `trunkLean` (`:171`),
   * `overstriding` (`:177`), `footStrikePattern` (`:192`) and `strideLength` (`:182`) all
   * multiply their raw screen-relative offset by it, so on a right-to-left runner the reported
   * sign is the OPPOSITE of the on-screen one — an arrow or arc oriented from the picture alone
   * would point the wrong way with nothing to catch it.
   *
   * Same value on every item of a clip. Duplicated per item rather than hung off
   * `ClipEvidencePlan`, which is a total `Record<MetricId, …>` with no room for a sibling key,
   * and duplication keeps the draw layer from needing a second lookup.
   */
  travelDirection: EvidenceTravelDirection
  /** Why the exemplar arrived as a pair and is planned as a single, or `null` where it was not
   * demoted. See `EvidenceDemotion` for why this is not a boolean. */
  demotion: EvidenceDemotion | null
  /**
   * `evidencePairCropGrowth` for the two instants this plan actually DRAWS — the factor by which
   * ghosting shrank the subject in this image. `null` whenever no ghost is drawn (a single-instant
   * exemplar, or a pair demoted to its base), where the quantity does not exist rather than being
   * 1.
   *
   * A diagnostic, not a render input: nothing in the drawing layer reads it. It is here so the
   * DEV-only `[evidence-coverage]` line can report the reading that `EVIDENCE_MAX_PAIR_CROP_GROWTH`
   * is calibrated against, per clip and per exemplar, without a probe patch (`strides-492`). Every
   * value that reaches that line is by construction BELOW the threshold — a pair at or above it was
   * dropped and has no plan to carry a field.
   */
  cropGrowth: number | null
}

/**
 * Which rule took a pair apart, for an exemplar that arrived as a pair and is planned as a single.
 *
 * - `'collapsed-pair'` — the two instants were indistinguishable: near-identical crop regions, both
 *   snapping to one sampled frame, too few sampled intervals apart to express a change of gait
 *   phase, or a ghost that did not resolve at all.
 * - `'far-apart-pair'` — both instants are real and distinct, and they cannot share one legible
 *   crop (`isTooFarApartPair`).
 *
 * **Deliberately not a boolean, and deliberately not two fields.** The caption has to say WHICH,
 * because "the paired instant was too similar to tell apart" is the exact inverse of what a
 * far-apart demotion did — a false sentence under the picture, not a vague one. A boolean cannot
 * carry three states, and a boolean beside a reason could disagree with itself about one image.
 * `captionFor` maps this through a total `Record`, so a reason added here without a sentence is a
 * type error rather than a caption naming nothing.
 */
export type EvidenceDemotion = 'collapsed-pair' | 'far-apart-pair'

/**
 * Why a metric has no evidence, distinguished so the UI (and the coverage line) can tell "this
 * metric never emits" from "this run produced nothing" from "we never got as far as trying".
 *
 * - `not-emitted` — the metric emits no exemplars by design (`cadence`).
 * - `all-gated-out` — candidates existed and none survived the quality gate or this layer's own
 *   resolution rules.
 * - `metric-excluded` — the metric renders no card at all (no value, or camera geometry that
 *   cannot support the measurement), so there is nothing for a picture to explain.
 * - `frames-unavailable` — the clip has no usable sampled frames or no usable pixel dimensions.
 * - `extraction-failed` — planned fine, but the impure extractor could not produce the image. Never
 *   produced by this module; the layer that extracts substitutes it before summarizing.
 */
export type EvidenceUnavailableReason =
  | 'not-emitted'
  | 'all-gated-out'
  | 'metric-excluded'
  | 'frames-unavailable'
  | 'extraction-failed'

/** Discriminated so "no evidence" is never an empty array indistinguishable from "not computed
 * yet". */
export type MetricEvidencePlan =
  | { status: 'planned'; items: EvidenceFramePlan[] }
  | { status: 'no-evidence'; reason: EvidenceUnavailableReason }

/** Every metric gets an entry — a missing key would reintroduce exactly the ambiguity the
 * discriminated result above exists to remove. */
export type ClipEvidencePlan = Record<MetricId, MetricEvidencePlan>

/**
 * Half the median interval between consecutive sampled frames — the distance beyond which a
 * requested instant is closer to some other frame than to the one `findNearestFrame` returned.
 *
 * A tolerance is mandatory rather than nice-to-have: `findNearestFrame` CLAMPS and carries no
 * distance limit of its own, so without this check a timestamp from a different clip (or from a
 * separately-sampled scale pass) resolves silently to the first or last frame of this one.
 *
 * `null` below two frames, where there is no interval to measure.
 */
export function evidenceSnapToleranceSeconds(
  frames: RobustPoseFrame[],
): number | null {
  if (frames.length < 2) return null
  const intervals: number[] = []
  for (let i = 1; i < frames.length; i += 1) {
    intervals.push(frames[i].timestamp - frames[i - 1].timestamp)
  }
  const tolerance = median(intervals) / 2
  return Number.isFinite(tolerance) && tolerance > 0 ? tolerance : null
}

/** `findNearestFrame` plus the distance check it does not provide. `null` when the nearest frame
 * is further away than the tolerance allows — a foreign timestamp is rejected, never clamped. */
export function snapToSampledFrame(
  frames: RobustPoseFrame[],
  timestamp: number,
  toleranceSeconds: number,
): RobustPoseFrame | null {
  const frame = findNearestFrame(frames, timestamp)
  if (frame === null) return null
  return Math.abs(frame.timestamp - timestamp) <= toleranceSeconds ? frame : null
}

/**
 * Axis-aligned box over a set of positions. `null` for an empty set, and non-finite coordinates
 * are skipped rather than poisoning the box into `Infinity` — the robustness layer should never
 * emit one, but a box is what the whole crop is derived from and an unbounded rect is worse than
 * no rect.
 *
 * Deliberately NOT `deriveBoundingBox` (`movenetCrop.ts`): that one takes raw scored keypoints and
 * hard-excludes the head and foot names, which is the opposite of what the per-metric crop sets
 * ask for — `trunkLean` seeds on the head to read "upright", and `footStrikePattern` on the foot.
 */
export function boundingBoxOfPoints(
  points: ReadonlyArray<{ x: number; y: number }>,
): BoundingBoxPx | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY }
}

/**
 * The box the exemplar's own crop keypoints occupy at one frame. Any keypoint that does not
 * resolve is simply omitted — context keypoints are strictly optional (`left_heel` and friends are
 * MediaPipe-only and resolve `'unrecoverable'` on MoveNet, the default backend), so a crop must be
 * well-defined from whatever part of the set does resolve. `null` when none of them do.
 */
export function frameCropBox(
  frame: RobustPoseFrame,
  cropKeypoints: KeypointName[],
): BoundingBoxPx | null {
  const points = cropKeypoints
    .map((name) => resolvePoint(frame, name))
    .filter((point): point is NonNullable<typeof point> => point !== null)
  return boundingBoxOfPoints(points)
}

/**
 * The exemplar's named keypoints resolved at one frame, in native video pixels — the annotation
 * half of what `frameCropBox` does for the crop half, sharing `resolvePoint` so the two can never
 * disagree about whether a point exists.
 *
 * Every named keypoint gets an entry, including the ones that did not resolve: "this metric never
 * named that joint" and "it named it and the pipeline lost it" are different facts, and only the
 * second one is worth telling a reader about. Duplicates are dropped so a name appearing twice in
 * an exemplar's crop set (two same-side seeds unioned across a pair, say) cannot produce two marks
 * stacked at one position.
 */
export function resolveInstantKeypoints(
  frame: RobustPoseFrame,
  names: KeypointName[],
): EvidenceKeypointPosition[] {
  return [...new Set(names)].map((name) => {
    const point = resolvePoint(frame, name)
    if (point === null) return { name, status: 'unrecoverable' as const }
    return {
      name,
      status: point.interpolated ? ('interpolated' as const) : ('detected' as const),
      x: point.x,
      y: point.y,
    }
  })
}

/**
 * `stepWidth`'s per-footstrike outward polarity, recomputed here from the frame's own hips —
 * `stepWidth.ts:222-223` verbatim, not an approximation of it, including its STRICT bilateral
 * gate (`resolveBilateralPair`, not the tolerant `resolveMidpoint`): a hip-mid that collapsed onto
 * one side would make `sideHip.x - hipMid.x` identically zero and the sign meaningless, which is
 * the exact bug that file was fixed for.
 *
 * **"Verbatim" is now true for the GRAFTED metrics too, and only because `planClipEvidence`
 * routes them** (`strides-3a1`). `stepWidthCm` and `verticalOscillationCm` arrive from the
 * background MediaPipe scale pass carrying its exemplars' timestamps; that pass's own
 * `RobustPoseFrame[]` now travel with them, and the planner hands THOSE to this function for
 * those two metrics. This function itself is unconditional — it reads whatever frame it is
 * handed — so the guarantee lives entirely in which frame the caller chose. Hand it the primary
 * pass's frame for a grafted metric and the sign below is a different detector's opinion about
 * the same instant, silently.
 *
 * That is a measured failure, not a hypothetical one. On this repo's own footage the two
 * detectors order the hips OPPOSITELY at 26% of the side-view demo's instants and 17% of the
 * multi-person clip's (0% of the front-approach demo's, where the hips sit ~93 px apart rather
 * than 9-32 px). Three of the twelve grafted exemplar instants those clips plan carry the inverse
 * ordering, one of them a step-width strike whose two hips the scale pass placed 4.4 px apart —
 * which drawn oriented would label a crossover strike as landing on its own side, contradicting
 * `stepWidth.ts`'s own crossover caveat in the same viewport. See `scalePassGraft.ts` for the
 * full measurement, and for why the subject-agreement check cannot see any of it.
 *
 * `evidenceAnnotations.ts`'s `GRAFTED_METRICS` still refuses to orient a grafted metric's marks.
 * After this routing that suppression guards nothing — the polarity it withholds is the correct
 * one — and its own doc comment states a premise that is no longer true. Removing it is a
 * separate single-file change, deliberately not made here.
 *
 * `null` rather than the metric's `|| 1` fallback where the sign is zero. The metric needs a
 * number to finish an arithmetic expression and records the frame as `degenerate` so the exemplar
 * is rejected; a plan has no such obligation and an annotation must simply not claim a direction
 * it cannot derive.
 */
export function resolveOutwardSigns(
  frame: RobustPoseFrame,
): EvidenceOutwardSigns | null {
  const hips = resolveBilateralPair(frame, 'left_hip', 'right_hip')
  if (hips === null) return null
  const hipMidX = (hips.left.x + hips.right.x) / 2
  // Each side is signed against the midline independently rather than one being negated from the
  // other: exact antisymmetry holds in real arithmetic but a float midpoint need not sit exactly
  // between its endpoints, and a derived sign that disagreed with a measured one would be worse
  // than no sign.
  const left = Math.sign(hips.left.x - hipMidX)
  const right = Math.sign(hips.right.x - hipMidX)
  if (left === 0 || right === 0) return null
  return { left: left as 1 | -1, right: right as 1 | -1 }
}

/**
 * Which side of the body one instant of an exemplar was measured on — RESOLVED from what the
 * metric stated, never inferred from anything positional.
 *
 * Two fields, in priority order, because they answer two different questions:
 *
 * 1. `measuredSide`/`pairedMeasuredSide` — the per-INSTANT fact, emitted by the metric that took
 *    the measurement. The narrower statement, so it wins where present.
 * 2. `side` — the PAIR-level fact, whose own contract is "present only where the metric measures
 *    per side, and only when both instants of a pair share that side". Its presence therefore
 *    licenses attributing it to either instant; this is a reading of a documented invariant, not a
 *    guess. It is what every same-side metric (`kneeFlexionPeak`, `stridePair`, `armSwingCycle`,
 *    `footStrike`) supplies, and why those metrics needed no change to be answerable here.
 *
 * `null` — an explicit absence — when neither is present. The alternative, defaulting to a side,
 * would point a caliper at the wrong foot with nothing downstream able to tell.
 *
 * **What this deliberately does NOT do is read `cropKeypoints`.** The measured ankle is ordered
 * first in both `overstriding`'s and `stepWidth`'s crop sets today, so the side is technically
 * recoverable from position 0 of that array — but that ordering is a private consequence of two
 * modules concatenating `seedFor(base)` before `seedFor(ghost)`, is asserted by no test as a
 * contract, and would silently invert the moment either module reordered a seed. A wrong side here
 * is not a visible failure; it is a caliper confidently drawn to the other foot.
 */
export function resolveInstantSide(
  exemplar: MetricExemplar,
  role: 'base' | 'ghost',
): 'left' | 'right' | null {
  const measured =
    role === 'base' ? exemplar.measuredSide : exemplar.pairedMeasuredSide
  return measured ?? exemplar.side ?? null
}

/**
 * Which keypoint NAMES one instant of an exemplar should be annotated with — the metric's own
 * per-instant statement where it made one, and `cropKeypoints` where it did not.
 *
 * **Not to be confused with `resolveInstantKeypoints` above**, which takes a frame and a list of
 * names and resolves POSITIONS. This one takes an exemplar and a role and resolves NAMES. They
 * compose — the planner reads the names here and hands them there — and nothing else about them is
 * alike.
 *
 * The fallback is independently correct, not a tolerated approximation: the per-instant fields are
 * omitted exactly where the two sets coincide (a same-side pair, and every single-instant
 * exemplar), so on such an exemplar `cropKeypoints` IS the per-instant set by construction.
 *
 * **What this deliberately does NOT do is derive the set by filtering `cropKeypoints` by side.**
 * A crop set legitimately names points belonging to neither instant's measurement — `stepWidth`'s
 * single exemplar names the OPPOSITE ankle on purpose, because a width against the hip midline is
 * only legible with the other foot in frame. Filtering by the spelling of a keypoint's name would
 * drop that, and would make the drawn set a silent function of keypoint naming rather than of what
 * the metric measured. The measuring layer states it or nobody does.
 */
export function resolveInstantAnnotationKeypoints(
  exemplar: MetricExemplar,
  role: 'base' | 'ghost',
): KeypointName[] {
  const stated =
    role === 'base'
      ? exemplar.annotationKeypoints
      : exemplar.pairedAnnotationKeypoints
  return stated ?? exemplar.cropKeypoints
}

/**
 * The clip's direction of travel, computed the way the METRICS compute it and not merely the way
 * that reads naturally here: over the presence-TRIMMED frames, with a body scale estimated from
 * those same trimmed frames.
 *
 * This is load-bearing, not tidiness. The plan is handed the UNTRIMMED `robustFrames` while
 * `runClipAnalysisPipeline.ts:59-60` hands `computeFormHeuristics` the output of
 * `trimToPresenceWindow`, and the two arrays can disagree about the sign outright — not only near
 * the indeterminate threshold. `estimateTravelDirection` reads the first and last frame where
 * hip-mid resolves *at all*, while the presence trim also demands shoulder-mid and a minimum run
 * length, so a frame outside the window (a bystander, or the subject with an occluded torso) can
 * supply an endpoint the metric never saw and flip the sign with both readings well clear of the
 * threshold. `evidenceFrames.test.ts` builds exactly that clip. Reproducing the metrics' own input
 * removes the disagreement by construction instead of arguing it is rare.
 *
 * Both `trimToPresenceWindow` and `computeFormHeuristics` are called at their default
 * `HeuristicsConfig` in that pipeline, which is why this needs no config of its own — if either
 * call ever takes a non-default config, this one has to take the same one.
 */
export function evidenceTravelDirection(
  frames: RobustPoseFrame[],
): EvidenceTravelDirection {
  const metricFrames = trimToPresenceWindow(frames)
  const bodyScale = estimateBodyScale(metricFrames)
  if (bodyScale === null) return 0
  return estimateTravelDirection(metricFrames, bodyScale)
}

/**
 * The side of the square canvas one crop is drawn into. Owned here rather than in the extractor
 * so the pure layer can express the video→output transform below without importing the impure
 * module; the cap arrives as an argument for the same reason (`EVIDENCE_OUTPUT_MAX_SIDE_PX` lives
 * next to the drawing, and importing it here would be a cycle).
 *
 * The crop is never UPSCALED to reach the cap — `min` before `round`, so a small crop keeps its
 * own size.
 */
export function evidenceOutputSide(
  cropSide: number,
  maxOutputSidePx: number,
): number {
  return Math.max(1, Math.round(Math.min(cropSide, maxOutputSidePx)))
}

/**
 * Native video pixels → the output canvas's own coordinate space. The forward direction of
 * `movenet.ts:86-95`'s `toVideoSpaceKeypoints`, and the algebra implicit in the nine-argument
 * `drawImage` the extractor issues — written here, in the pure half, so annotation geometry is
 * asserted by tests rather than by looking at a picture.
 *
 * **The scale is `outputSide / crop.side`, not `maxOutputSidePx / crop.side`.** The rounding is in
 * the numerator only and `computeCropRect` returns a FLOAT side, so the scale is ≠ 1 even for a
 * crop well under the cap. Assuming otherwise puts every mark a fraction of a pixel off on most
 * clips and visibly off on some.
 */
export function toEvidenceOutputSpace(
  point: { x: number; y: number },
  crop: CropRectPx,
  outputSide: number,
): { x: number; y: number } {
  const scale = outputSide / crop.side
  return { x: (point.x - crop.x) * scale, y: (point.y - crop.y) * scale }
}

function unionBoxes(boxes: BoundingBoxPx[]): BoundingBoxPx | null {
  if (boxes.length === 0) return null
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  }
}

function isUsableFrameSize(frameSize: EvidenceFrameSize): boolean {
  return (
    Number.isFinite(frameSize.width) &&
    Number.isFinite(frameSize.height) &&
    frameSize.width > 0 &&
    frameSize.height > 0
  )
}

/**
 * The square crop both frames of an exemplar are drawn through, unioned across every frame passed
 * so a ghost reads as one runner at two instants rather than as two different shots.
 *
 * Padding, squaring and clamping all come from `computeCropRect`, reused rather than
 * reimplemented: it already clamps to the frame by SHIFTING rather than shrinking, so the returned
 * side is always exactly what the padding/floor/cap math produced, and a subject half out of frame
 * yields an in-bounds rect rather than a negative-width one. Squareness is what makes the evidence
 * read as a coherent set rather than a ragged pile.
 */
export function computeEvidenceCropRect(
  frames: RobustPoseFrame[],
  cropKeypoints: KeypointName[],
  frameSize: EvidenceFrameSize,
): CropRectPx | null {
  if (!isUsableFrameSize(frameSize)) return null
  const boxes = frames
    .map((frame) => frameCropBox(frame, cropKeypoints))
    .filter((box): box is BoundingBoxPx => box !== null)
  const union = unionBoxes(boxes)
  if (union === null) return null
  const crop = computeCropRect(
    union,
    frameSize.width,
    frameSize.height,
    EVIDENCE_CROP_PADDING_MULTIPLIER,
    EVIDENCE_CROP_MIN_SIDE_PX,
  )
  const subject = frameSubjectExtentBox(frames)
  return subject === null
    ? crop
    : subjectCentredCropRect(crop, union, subject, frameSize)
}

/**
 * The subject's own extent across the drawn instants: the box over EVERY keypoint name that
 * resolves at those frames, not just the ones this exemplar named for its crop.
 *
 * **This is a LOWER BOUND on the subject, and treating it as one is the whole design.** It is
 * built from `COMMON_KEYPOINT_NAMES` through the same `resolvePoint` the crop uses, so a name the
 * pipeline could not recover simply does not contribute — and on MoveNet, the default backend,
 * `left_heel`/`right_heel`/`left_foot_index`/`right_foot_index` NEVER recover, so this box ends at
 * the ankles and the runner's shoes hang below it. `frameCropBox`'s doc records the same fact for
 * the crop set. Anything reading this box as "where the body ends" will therefore mis-frame the
 * bottom of every MoveNet subject; `subjectCentredCropRect` reads it as "where the body certainly
 * IS" instead, which is a claim the data supports.
 *
 * Unioned across the frames rather than per frame, because one crop is drawn through both
 * instants and a box that described only one of them would describe neither picture.
 *
 * `null` when nothing resolves at any frame. The crop set is a subset of these names, so a null
 * here implies a null crop box: a caller that already has a crop box can rely on this being
 * non-null, and on the crop box being CONTAINED in it.
 */
export function frameSubjectExtentBox(
  frames: RobustPoseFrame[],
): BoundingBoxPx | null {
  const points: Array<{ x: number; y: number }> = []
  for (const frame of frames) {
    for (const name of COMMON_KEYPOINT_NAMES) {
      const point = resolvePoint(frame, name)
      if (point !== null) points.push(point)
    }
  }
  return boundingBoxOfPoints(points)
}

/**
 * Re-places an already-sized crop so that, on an axis where the DISPLAY FLOOR made it wider than
 * the subject, it is centred on the subject instead of on the measured region. Same `side`, same
 * frame, only `x`/`y` move — so nothing that reads a crop's size (`evidencePairCropGrowth`,
 * `isTooFarApartPair`, the coverage line's `cropSidePx`) can observe this at all.
 *
 * **The defect (`strides-e9b`).** `EVIDENCE_CROP_MIN_SIDE_PX` is a floor on PIXELS, sized against
 * the viewer so a thumbnail is not upscaled mush; it is not a framing decision and it knows nothing
 * about what is beside the runner. On a three-keypoint limb box it roughly doubles the crop, and
 * because `computeCropRect` centres on the box it always was, half of that new area is spent on
 * whichever side of the arm has no runner in it. On `park-approach.mp4` that side holds a man in a
 * yellow shirt, who then reads as a second body in a ghosted composite whose caption describes one.
 *
 * **What is available to fix it, and what is not.** There is no per-frame record of anybody else:
 * detection is single-person, `RobustPoseFrame` carries no bounding box, and
 * `selectRetroactivePersonOfInterest` derives per-frame boxes only to rank tracks and then discards
 * them. So a bystander cannot be looked up and cannot be avoided by name. What IS in hand at this
 * exact point is the frame's complete keypoint set, and therefore the SUBJECT's own extent — and
 * covering the subject is the same act as not covering what is beside them.
 *
 * **The two conditions, per axis, both load-bearing.**
 *
 * 1. `paddedSide <= subjectExtent < side` — the FLOOR, not the padding, is what made the crop
 *    wider than the subject here. Below the floor the crop would have been `paddedSide`, which this
 *    says is no wider than the subject; at the floor it is wider. That is the precise statement of
 *    "area the metric did not ask for", and it is what keeps this away from crops the padding sized:
 *    Demo 2's `verticalOscillation` crop is 720 px over a 283 px-wide subject, four times wider than
 *    the body and nowhere near the floor, and it must not be re-framed by this rule (its own
 *    bystander problem is `strides-a8y`, and it is not this mechanism). Note this subsumes the
 *    frame cap too: a capped crop has `side < paddedSide`, which the chain cannot satisfy.
 * 2. `subjectExtent(other axis) >= side` — the crop is a BAND ACROSS one body, a detail rather than
 *    a scene that contains a whole person. When the crop is larger than the subject on both axes it
 *    already holds all of them, and moving it only swaps one piece of background for another with
 *    nothing in hand to prefer either. Dropping this clause is not a theoretical loss: on
 *    `multiperson-track.mp4` it is what stops `kneeFlexion` from riding 66 px up the body (which
 *    promotes a walking bystander from a pair of legs at the edge into the centre of the picture)
 *    and `footStrikePattern` from riding 104 px up (which reframes a foot close-up as a whole-body
 *    shot with the sole clipped off). Both were measured, both on this clip, both prevented here.
 *
 * **Why CENTRED and not flush.** Centring leaves `(side − subjectExtent) / 2` of margin at BOTH
 * ends of the axis, which is the largest margin obtainable at either end — the minimax placement
 * under uncertainty about where the subject really stops. That matters because
 * `frameSubjectExtentBox` is a lower bound: on MoveNet the shoes are below the box, and the
 * placement that best protects an unobserved extension is the one that reserves the most room at
 * every end. The alternative — sliding just far enough to contain the box — reserves nothing on the
 * side it slid toward, which is exactly where an unobserved foot would be.
 *
 * **The measured region cannot leave the picture.** `cropBox` is built from a SUBSET of the names
 * `frameSubjectExtentBox` reads, so `cropBox ⊆ subjectBox`; on a qualifying axis the whole subject
 * box fits inside `side`, so the crop contains all of it and hence all of the measured region. The
 * un-qualifying axis does not move. No clamp on the shift is needed for that guarantee and none is
 * applied — a cap would only trade picture quality for a property that already holds.
 *
 * The frame clamp repeats `computeCropRect`'s two positioning lines rather than calling it: passing
 * a reconstructed square back through it risks a one-ulp change in `side`, and `side` is on the
 * coverage line. Same shift-not-shrink behaviour, pinned by a test against `computeCropRect` itself.
 */
export function subjectCentredCropRect(
  crop: CropRectPx,
  cropBox: BoundingBoxPx,
  subjectBox: BoundingBoxPx,
  frameSize: EvidenceFrameSize,
): CropRectPx {
  if (!isUsableFrameSize(frameSize)) return crop
  const paddedSide = evidenceCropPaddedSide(cropBox)
  const subjectWidth = subjectBox.maxX - subjectBox.minX
  const subjectHeight = subjectBox.maxY - subjectBox.minY
  const qualifies = (own: number, other: number) =>
    paddedSide <= own && own < crop.side && other >= crop.side

  const centerX = qualifies(subjectWidth, subjectHeight)
    ? (subjectBox.minX + subjectBox.maxX) / 2
    : crop.x + crop.side / 2
  const centerY = qualifies(subjectHeight, subjectWidth)
    ? (subjectBox.minY + subjectBox.maxY) / 2
    : crop.y + crop.side / 2

  const x = Math.min(
    Math.max(centerX - crop.side / 2, 0),
    frameSize.width - crop.side,
  )
  const y = Math.min(
    Math.max(centerY - crop.side / 2, 0),
    frameSize.height - crop.side,
  )
  return { x, y, side: crop.side }
}

/**
 * The crop side a box DEMANDS: `computeCropRect`'s padding and its degenerate-box floor, without
 * its `min(frameWidth, frameHeight)` cap. Native video pixels, and never a rect — nothing is drawn
 * through this, so it deliberately has no position and no frame to be positioned in.
 *
 * The only consumer is `evidencePairCropGrowth`, and the cap's absence is the whole point of
 * `strides-492`: the cap is what the frame can SUPPLY, and a ratio of two supplies stops carrying
 * separation the moment both sides saturate. `EVIDENCE_MAX_PAIR_CROP_GROWTH` holds the argument in
 * full, including why the floor stays and why this is not a "did the crop hit the cap" test.
 *
 * It re-derives two lines of `computeCropRect` rather than calling it, which is a real drift risk
 * and is pinned by a test: wherever the cap does not bind, this equals `computeCropRect`'s own
 * `side` exactly. Do not "simplify" this by passing an infinite frame size — `computeCropRect`
 * would then return a rect whose position is arithmetic on infinities, and a caller could read it.
 */
export function evidenceCropSideDemand(box: BoundingBoxPx): number {
  return Math.max(evidenceCropPaddedSide(box), EVIDENCE_CROP_MIN_SIDE_PX)
}

/**
 * The crop side the exemplar's own keypoints ASK FOR — padding only, before the display floor and
 * before the frame cap. Split out of `evidenceCropSideDemand` rather than inlined twice because
 * the difference between this and the returned side is exactly the area the FLOOR added, and
 * `subjectCentredCropRect` decides what to do with that area. Two copies of the padding arithmetic
 * would let the two consumers disagree about how much of a crop the metric actually requested.
 */
export function evidenceCropPaddedSide(box: BoundingBoxPx): number {
  return (
    Math.max(box.maxX - box.minX, box.maxY - box.minY) *
    EVIDENCE_CROP_PADDING_MULTIPLIER
  )
}

/**
 * How much bigger the crop a pair needs is than the crop the BETTER-FRAMED of its two instants
 * needs alone — the factor by which ghosting shrinks the subject in the finished image. `1` when
 * ghosting costs nothing; see `EVIDENCE_MAX_PAIR_CROP_GROWTH` for why this is the quantity.
 *
 * `max` of the two single crops, never `min`. The question a reader's eye asks is whether the
 * best-framed instant is still legible, not whether the worst one is: a pair whose two instants
 * are legitimately different sizes (a leg near the camera at one instant and far at the other)
 * would read as catastrophically degraded against its smaller half while the larger half carries
 * the picture perfectly well. Measured, not asserted — on Demo 1's `kneeFlexion`, whose two boxes
 * are 303 px and 553 px tall, the `min` reading is 3.495 and the `max` reading 1.915, and the
 * image is legible; a `min` reading would put a picture two reviewers called clearly readable a
 * full 40% past `EVIDENCE_MAX_PAIR_CROP_GROWTH` and drop it. Neither reading moves between the
 * capped and the demand formulas on that pair — its union is nowhere near a 4K clip's cap — so the
 * argument for `max` is independent of `strides-492`.
 *
 * `null` where there is nothing to compare — an unusable frame size, or a degenerate single crop.
 * A ratio that cannot be formed must never be read as a small one.
 */
export function evidencePairCropGrowth(
  baseBox: BoundingBoxPx,
  ghostBox: BoundingBoxPx,
  frameSize: EvidenceFrameSize,
): number | null {
  if (!isUsableFrameSize(frameSize)) return null
  const union = unionBoxes([baseBox, ghostBox])
  if (union === null) return null
  const soloSide = Math.max(
    evidenceCropSideDemand(baseBox),
    evidenceCropSideDemand(ghostBox),
  )
  if (!Number.isFinite(soloSide) || soloSide <= 0) return null
  return evidenceCropSideDemand(union) / soloSide
}

/**
 * Whether ghosting these two instants together would shrink the subject past legibility — the
 * symmetric counterpart to `isNearIdenticalPair`, and the guard gh #71 was filed for.
 *
 * **This predicate answers one question and no longer decides the consequence.** A pair that fails
 * it is routed through `SINGLE_INSTANT_KINDS`, exactly as a collapsed pair is: demoted to its base
 * where the card's number is read off one instant, dropped where that number is a difference
 * between two. What this function establishes is that the two instants cannot share one legible
 * image — it establishes nothing about whether either instant alone is worth showing, and that
 * second question already has an answer one layer up.
 *
 * The criterion, `EVIDENCE_MAX_PAIR_CROP_GROWTH`, and its calibration are untouched by that
 * (`strides-ddj`): a pair is rejected on exactly the reading it was rejected on before. It used to
 * be justified with "every paired label this repo emits is a statement about two instants… and
 * none of them survives losing half the pair", which is FALSE for a label whose leading clause
 * names the base — `overstriding`'s and `trunkLean`'s do, and since `strides-8i4` they name
 * whichever end actually became the base rather than a hardcoded one. It remains true for the
 * cycles, which are not in `SINGLE_INSTANT_KINDS` and are still dropped here.
 */
export function isTooFarApartPair(
  baseBox: BoundingBoxPx,
  ghostBox: BoundingBoxPx,
  frameSize: EvidenceFrameSize,
): boolean {
  const growth = evidencePairCropGrowth(baseBox, ghostBox, frameSize)
  return growth !== null && growth >= EVIDENCE_MAX_PAIR_CROP_GROWTH
}

/** The sampled frames one exemplar resolves to. `ghost` is `null` for a single-instant exemplar
 * and for a pair whose ghost half did not snap. */
export interface ResolvedExemplarFrames {
  base: RobustPoseFrame
  ghost: RobustPoseFrame | null
  /** The exemplar named a paired instant that could not be resolved to a sampled frame. */
  ghostUnresolved: boolean
}

/**
 * Exemplar → the sampled frames it names. `null` when the BASE does not snap: the base is the
 * instant the reported value is most directly about, so an exemplar that cannot name it has no
 * picture to show.
 *
 * The base is `timestamp` and the ghost is `pairedTimestamp`, read straight off the exemplar
 * rather than re-derived. Which of a pair is the base was decided by the metric that emitted it —
 * furthest from its own median for a range exemplar, closest for a representative one — and this
 * module cannot recompute that: a metric's per-instance distribution is not reachable from here,
 * and for a bounce cycle or a stride pair the two instants share one value and there is no median
 * to be distant from at all.
 */
export function resolveExemplarFrames(
  exemplar: MetricExemplar,
  frames: RobustPoseFrame[],
  toleranceSeconds: number,
): ResolvedExemplarFrames | null {
  const base = snapToSampledFrame(frames, exemplar.timestamp, toleranceSeconds)
  if (base === null) return null
  if (exemplar.pairedTimestamp === undefined) {
    return { base, ghost: null, ghostUnresolved: false }
  }
  const ghost = snapToSampledFrame(
    frames,
    exemplar.pairedTimestamp,
    toleranceSeconds,
  )
  return { base, ghost, ghostUnresolved: ghost === null }
}

/**
 * Whether a pair's two boxes describe the same picture — one of the two near-identical tests, the
 * other being both instants snapping to the same sampled frame, which `planExemplarFrames` applies
 * directly since it holds the frames.
 *
 * The comparison is between the two unpadded per-frame boxes, NOT between two padded crop rects.
 * The padded rect is a single union across both frames, so there is only one of it to compare;
 * and even derived per frame it would be the wrong input, because padding, squaring, the 320 px
 * floor and the frame clamp each compress differences — two genuinely different instants near a
 * frame edge can clamp to the identical square, and any small box lands on the floor. The
 * unpadded box is the body geometry at that instant, which is what "do these two look the same"
 * means.
 */
export function isNearIdenticalPair(
  baseBox: BoundingBoxPx,
  ghostBox: BoundingBoxPx,
): boolean {
  // Exact equality first, because IoU cannot see it on a DEGENERATE box: `computeBoundingBoxIoU`
  // returns 0 whenever the intersection has zero area, so two boxes that collapsed to the same
  // single point — or to the same perfectly horizontal line, which a bilateral pair at one height
  // produces — would otherwise read as "completely different" and ship the blurry double exposure
  // this check exists to prevent. Strict equality needs no threshold of its own and cannot fire on
  // a pair that genuinely moved.
  if (
    baseBox.minX === ghostBox.minX &&
    baseBox.minY === ghostBox.minY &&
    baseBox.maxX === ghostBox.maxX &&
    baseBox.maxY === ghostBox.maxY
  ) {
    return true
  }
  return computeBoundingBoxIoU(baseBox, ghostBox) >= EVIDENCE_NEAR_IDENTICAL_IOU
}

/**
 * Whether a pair's two instants are too close in TIME to depict the two phases its label names —
 * the second of the two near-identical tests, and the one `isNearIdenticalPair` structurally
 * cannot perform. `EVIDENCE_MIN_PAIR_SEPARATION_INTERVALS` carries the criterion, the measurement
 * that chose it over three display-space alternatives, and why it does not contradict
 * `EVIDENCE_MAX_PAIR_CROP_GROWTH`'s rejection of elapsed time at the far end.
 *
 * `toleranceSeconds` is half the median sampled interval (`evidenceSnapToleranceSeconds`), so
 * `2 × toleranceSeconds` is that interval exactly. A non-finite or non-positive tolerance answers
 * `false` rather than rejecting everything: with no measurable interval there is no scale to judge
 * a separation against, and a guard that cannot form its own criterion must not fire.
 */
export function isTooCloseInTimePair(
  baseTimestamp: number,
  ghostTimestamp: number,
  toleranceSeconds: number,
): boolean {
  const intervalSeconds = 2 * toleranceSeconds
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return false
  const separation = Math.abs(ghostTimestamp - baseTimestamp)
  return separation < EVIDENCE_MIN_PAIR_SEPARATION_INTERVALS * intervalSeconds
}

/**
 * One resolved frame → the instant the extractor seeks to and the annotation layer draws over.
 * Everything positional is captured HERE, while the `RobustPoseFrame` is still in hand — the plan
 * is the last place that holds it, and re-resolving downstream would either need the frames
 * threaded into the impure extractor or a second snap that could land on a different frame.
 */
function instantPlan(
  frame: RobustPoseFrame,
  exemplar: MetricExemplar,
  role: 'base' | 'ghost',
  opacity: number,
): EvidenceInstantPlan {
  return {
    timestamp: frame.timestamp,
    opacity,
    keypoints: resolveInstantKeypoints(
      frame,
      resolveInstantAnnotationKeypoints(exemplar, role),
    ),
    outwardSign: resolveOutwardSigns(frame),
    side: resolveInstantSide(exemplar, role),
  }
}

/**
 * One exemplar → one renderable plan, or `null` when it cannot be rendered honestly.
 *
 * A pair falls back to its base — demoted for a kind that still says something true from one
 * frame, dropped otherwise — when its ghost does not resolve to a sampled frame, when both halves
 * land on the same frame, when the ghost frame has no resolvable crop keypoint (so there is no
 * evidence the measured region is even inside the crop at that instant), when the two per-frame
 * boxes are near-identical, or when the two instants are too far apart to share one legible crop.
 * The last of those reports `'far-apart-pair'` and the rest `'collapsed-pair'`; both consult the
 * same `SINGLE_INSTANT_KINDS` classification.
 *
 * **A caller wanting the FALLBACK ordering must use `planExemplarWithFallback`.** This function
 * answers one pair in isolation, so it demotes a far-apart pair rather than looking for another —
 * it has no other to look at. Preferring a drawable lower-ranked pair over a demoted higher-ranked
 * one is the walk's job, and is why that ordering lives there rather than here.
 *
 * Every `null` here is a verdict about THIS PAIR, never about the metric. `planExemplarWithFallback`
 * is the caller that acts on that distinction, retrying the exemplar's lower-ranked pairs; call this
 * one directly only when a single pair really is the whole question.
 *
 * `travelDirection` is threaded in rather than derived per exemplar because it is a property of
 * the CLIP: `planClipEvidence` computes it once and every item of every metric carries the same
 * value. The default keeps this function independently callable — it is exported and unit-tested
 * directly — and derives the identical number from the same frames.
 *
 * The parameter is a plain override, NOT a guarantee: passing an explicit value that disagrees
 * with `evidenceTravelDirection(frames)` yields a plan whose sign contradicts its own frames, and
 * nothing here rejects that. Every in-repo caller passes the derived value. If you are writing a
 * new caller, pass the derived value or omit the argument — an inverted sign silently flips the
 * direction of every caliper drawn from this plan, and no test downstream will catch it.
 */
export function planExemplarFrames(
  metric: MetricId,
  exemplar: MetricExemplar,
  frames: RobustPoseFrame[],
  frameSize: EvidenceFrameSize,
  toleranceSeconds: number,
  travelDirection: EvidenceTravelDirection = evidenceTravelDirection(frames),
): EvidenceFramePlan | null {
  const resolved = resolveExemplarFrames(exemplar, frames, toleranceSeconds)
  if (resolved === null) return null

  const baseBox = frameCropBox(resolved.base, exemplar.cropKeypoints)
  if (baseBox === null) return null

  const ghostBox =
    resolved.ghost === null
      ? null
      : frameCropBox(resolved.ghost, exemplar.cropKeypoints)

  const isPair = exemplar.pairedTimestamp !== undefined
  const pairCollapsed =
    isPair &&
    (resolved.ghost === null ||
      ghostBox === null ||
      resolved.ghost === resolved.base ||
      isNearIdenticalPair(baseBox, ghostBox) ||
      isTooCloseInTimePair(
        resolved.base.timestamp,
        resolved.ghost.timestamp,
        toleranceSeconds,
      ))

  // Measured only once the collapse rules have passed, which is not an ordering preference: a
  // collapsed pair has no second box to measure a separation against, and a near-identical one is
  // by definition at growth ~1 anyway.
  const pairTooFarApart =
    isPair &&
    !pairCollapsed &&
    ghostBox !== null &&
    isTooFarApartPair(baseBox, ghostBox, frameSize)

  // Both rejections route through the SAME classification (`strides-ddj`). They differ in what
  // they establish about the pair and not in what either says about one instant: a collapsed pair
  // has nothing left to compare against, a far-apart one has two good instants that cannot share a
  // crop, and in both cases whether the surviving frame is worth showing is a property of the
  // metric's own number.
  const demotion: EvidenceDemotion | null = pairCollapsed
    ? 'collapsed-pair'
    : pairTooFarApart
      ? 'far-apart-pair'
      : null
  if (demotion !== null && !SINGLE_INSTANT_KINDS.has(exemplar.kind)) return null

  const ghost = demotion === null ? resolved.ghost : null
  // A demoted plan draws ONE frame, and the crop derives from `drawnFrames` alone — so gh #71's
  // whole-frame two-instant union is unreachable here by construction. A demoted single gets
  // exactly the crop a single-instant exemplar of the same geometry would have got, inheriting
  // every existing guard (padding, floor, subject-centring, frame clamp) and adding none.
  const drawnFrames =
    ghost === null ? [resolved.base] : [resolved.base, ghost]
  const crop = computeEvidenceCropRect(
    drawnFrames,
    exemplar.cropKeypoints,
    frameSize,
  )
  if (crop === null) return null

  return {
    metric,
    kind: exemplar.kind,
    ...(exemplar.side === undefined ? {} : { side: exemplar.side }),
    quality: exemplar.quality,
    label: exemplar.label,
    base: instantPlan(resolved.base, exemplar, 'base', EVIDENCE_BASE_OPACITY),
    ghost:
      ghost === null
        ? null
        : instantPlan(ghost, exemplar, 'ghost', EVIDENCE_GHOST_BLEND_ALPHA),
    crop,
    travelDirection,
    demotion,
    // `null` on a demoted plan, deliberately — nothing was ghosted, so the quantity does not
    // exist. The consequence is that the reading which CAUSED a far-apart demotion is not on the
    // coverage line; re-checking `EVIDENCE_MAX_PAIR_CROP_GROWTH`'s bracket against a rejected pair
    // still needs the probe it always did. Reporting it here would make the column mean two
    // different things — "what this image cost" and "what the image we did not draw would have
    // cost" — in one number.
    //
    // Recomputed from the boxes rather than carried down from the checks above, which do not run
    // for every branch. `ghostBox` is non-null whenever `ghost` is: `ghost` is null exactly when
    // `demotion` is set, and a null `ghostBox` is one of the conditions that sets it.
    cropGrowth:
      ghost === null || ghostBox === null
        ? null
        : evidencePairCropGrowth(baseBox, ghostBox, frameSize),
  }
}

/**
 * One exemplar → the plan for the first of its ranked pairs that can actually be DRAWN.
 *
 * `planExemplarFrames` answers "can this exact pair be rendered honestly", and its `null` is
 * final for that pair — but it was being treated as final for the whole metric. The emitting
 * metric cannot make that call: whether two instants can share one legible crop depends on pixel
 * geometry and on this module's own display constants, neither of which reaches `src/heuristics/`.
 * So a range exemplar arrives carrying `alternates`, the pairs it ranked below the winner, and
 * this walks them. Measured on this repo's side-view reference clip, `trunkLean`'s best-scoring
 * pair puts the runner at opposite edges of a 4K frame — growth ~6.8 against a 2.5 threshold —
 * while 18 instants clear the typicality ramp and plenty of drawable pairs sit among them.
 *
 * **Retries on EVERY failure, not only on `isTooFarApartPair`.** A ghost that does not snap, two
 * halves landing on one frame, near-identical boxes, no derivable crop box: each is "this pair
 * cannot be drawn", and a lower-ranked pair may suffer from none of them. Retrying only on the
 * far-apart rejection would fix one symptom of a defect that is about the absence of a fallback.
 *
 * **Nothing is weakened by retrying.** Every candidate goes through the same `planExemplarFrames`
 * under the same rules, and `MIN_EXEMPLAR_QUALITY` is re-asserted per candidate exactly as
 * `planMetricEvidence` re-asserts it for the winner — so an alternate can only render on terms the
 * winner would also have had to meet.
 *
 * **Demotion is the LAST RESORT, and that ordering is load-bearing** (`strides-ddj`). Any pair
 * that renders AS A PAIR, at any rank, beats a demoted single from a higher-ranked one; the first
 * demoted plan is remembered and returned only once every candidate has failed to render as a
 * pair. Without it, admitting a kind to `SINGLE_INSTANT_KINDS` silently converts a fallback into a
 * demotion — the winner would stop at its own base and the walk would never reach the drawable
 * alternate below it. Measured on Demo 1's `trunkLean`, whose winner demands 6.1–6.8 growth and
 * whose alternate draws at 1.866: a good ghost would have become a lone frame, and the coverage
 * line would still have shown an image, so the regression would have read as a fix.
 *
 * The returned plan is the SELECTED pair's own throughout — its instants, its `quality`, its
 * `cropGrowth` — so nothing downstream, the `[evidence-coverage]` line included, is ever told
 * about a pair the image does not show.
 */
export function planExemplarWithFallback(
  metric: MetricId,
  exemplar: MetricExemplar,
  frames: RobustPoseFrame[],
  frameSize: EvidenceFrameSize,
  toleranceSeconds: number,
  travelDirection: EvidenceTravelDirection = evidenceTravelDirection(frames),
): EvidenceFramePlan | null {
  let demoted: EvidenceFramePlan | null = null
  for (const candidate of [exemplar, ...(exemplar.alternates ?? [])]) {
    if (candidate.quality < MIN_EXEMPLAR_QUALITY) continue
    const plan = planExemplarFrames(
      metric,
      candidate,
      frames,
      frameSize,
      toleranceSeconds,
      travelDirection,
    )
    if (plan === null) continue
    // `demotion === null` rather than `ghost !== null`, so that a genuine single-instant exemplar
    // — which never had a pair to lose — returns immediately instead of being filed as a
    // consolation prize and walked past.
    if (plan.demotion === null) return plan
    // The FIRST demotable candidate is kept, not the last: candidates arrive best-first, so the
    // best demoted single is the one the highest-ranked demotable pair produced.
    demoted ??= plan
  }
  return demoted
}

/**
 * One metric → its evidence, or a named reason there is none.
 *
 * Each exemplar is resolved through `planExemplarWithFallback`, so an exemplar offering ranked
 * alternative pairs spends its slot on the best one that can actually be drawn rather than losing
 * the slot to an un-drawable winner. The budget below still counts IMAGES: alternatives belong to
 * an exemplar and at most one of them is ever rendered.
 *
 * The quality gate and the per-metric budget are re-applied here rather than trusted from
 * upstream. Both are the same constants imported from the same module, so the two layers cannot
 * drift; re-asserting them means an exemplar that reached a `MetricResult` without going through
 * the shared selector still cannot render as evidence, and the renderer gets a hard bound on how
 * many images one card can grow. The budget is applied AFTER this layer's own drops, so a metric
 * whose first choice cannot be resolved here still spends its second — and without re-sorting,
 * because the emitting metric already ranked them and a second ranking here could disagree.
 */
export function planMetricEvidence(
  metric: MetricResult,
  frames: RobustPoseFrame[],
  frameSize: EvidenceFrameSize,
  travelDirection: EvidenceTravelDirection = evidenceTravelDirection(frames),
): MetricEvidencePlan {
  // Evidence renders only for metrics that render a card. A tier-3 metric has no card to hang a
  // deep link on, and a picture explaining a number the app declined to report — or one the camera
  // geometry could not support — is a picture of a measurement that was not made.
  if (metricTier(metric) === 'excluded') {
    return { status: 'no-evidence', reason: 'metric-excluded' }
  }
  if (METRICS_WITHOUT_EVIDENCE.has(metric.metric)) {
    return { status: 'no-evidence', reason: 'not-emitted' }
  }

  const tolerance = evidenceSnapToleranceSeconds(frames)
  if (tolerance === null || !isUsableFrameSize(frameSize)) {
    return { status: 'no-evidence', reason: 'frames-unavailable' }
  }

  const candidates = (metric.exemplars ?? []).filter(
    (exemplar) => exemplar.quality >= MIN_EXEMPLAR_QUALITY,
  )
  const items = candidates
    .map((exemplar) =>
      planExemplarWithFallback(
        metric.metric,
        exemplar,
        frames,
        frameSize,
        tolerance,
        travelDirection,
      ),
    )
    .filter((item): item is EvidenceFramePlan => item !== null)
    .slice(0, MAX_EXEMPLARS_PER_METRIC)

  return items.length > 0
    ? { status: 'planned', items }
    : { status: 'no-evidence', reason: 'all-gated-out' }
}

/**
 * One clip's whole plan, one entry per metric. Iterates the heuristics result's own property order
 * (minus `view`, which is not a metric) the same way `computeAnalysisDiagnostics` does, so the key
 * order is fixed and the coverage line downstream stays diffable between runs.
 *
 * **`graftedFrames` is the background scale pass's own `RobustPoseFrame[]`, and passing it is what
 * makes a grafted metric's evidence describe the pass that measured it** (`strides-3a1`). Where it
 * is non-null, every metric in `GRAFTED_METRIC_IDS` is planned against IT — its frames, its own
 * snap tolerance, its own travel direction — and every other metric against `frames` exactly as
 * before. Where it is null nothing is routed and this behaves as it always did.
 *
 * Its presence, not membership of `GRAFTED_METRIC_IDS`, is what says a graft happened: the state
 * that carries it is written in the same object literal as the grafted metrics themselves, so
 * "these two metrics came from the scale pass" and "here are the scale pass's frames" are one fact
 * committed together. A MediaPipe-PRIMARY run grafts nothing, carries no scale-pass frames, and
 * correctly plans its centimetre metrics against `frames` — which already ARE the frames that
 * measured them.
 *
 * The two arrays are not interchangeable and the routing is not a preference. A frame carries the
 * joint positions an annotation draws and the hip ORDER a caliper's polarity is read from, and the
 * two detectors disagree about that ordering on a quarter of the side-view demo's instants while
 * agreeing about which PERSON they are looking at — see `scalePassGraft.ts` for the measurement,
 * and for why `scalePassSubjectAgreement.ts` structurally cannot see it.
 */
export function planClipEvidence(
  heuristics: FormHeuristicsResult,
  frames: RobustPoseFrame[],
  frameSize: EvidenceFrameSize,
  graftedFrames: RobustPoseFrame[] | null = null,
): ClipEvidencePlan {
  const metricEntries = Object.entries(heuristics).filter(
    (entry): entry is [MetricId, FormHeuristicsResult[MetricId]] =>
      entry[0] !== 'view',
  )
  // Once per clip, not once per metric: it costs three passes over every frame and eleven metrics
  // asking the same question of the same array would get the same answer eleven times. The grafted
  // direction is derived the same way from the other array, and only when there is one — it is a
  // property of the clip AS THAT PASS SAMPLED IT, and two passes can read it differently for the
  // same reason they read anything else differently.
  const travelDirection = evidenceTravelDirection(frames)
  const graftedTravelDirection: EvidenceTravelDirection =
    graftedFrames === null ? 0 : evidenceTravelDirection(graftedFrames)
  const plan = {} as ClipEvidencePlan
  for (const [id, metric] of metricEntries) {
    const useGrafted = graftedFrames !== null && GRAFTED_METRIC_IDS.has(id)
    plan[id] = useGrafted
      ? planMetricEvidence(metric, graftedFrames, frameSize, graftedTravelDirection)
      : planMetricEvidence(metric, frames, frameSize, travelDirection)
  }
  return plan
}

/**
 * One clip's contribution to the coverage line. `plan` is that clip's own plan, with any
 * `'extraction-failed'` verdict already substituted by the layer that extracted — this module
 * never produces that reason, and summarizing before extraction has settled would report a pending
 * state as a verdict.
 */
export interface EvidenceCoverageClip {
  clipIndex: number
  /** That clip's `robustFrames.length`. */
  frameCount: number
  plan: ClipEvidencePlan
}

export interface EvidenceCoverageExemplar {
  kind: MetricExemplarKind
  side?: 'left' | 'right'
  quality: number
  timestamp: number
  /** `null` on a single, and after any demotion. */
  pairedTimestamp: number | null
  /** Which rule took the pair apart, or `null` where the image was not demoted. Replaces the
   * `demotedFromPair` boolean this line used to carry — a CONTRACT BREAK for anything diffing an
   * older capture, recorded in `demote-a-far-apart-single-instant-pair`'s design. */
  demotion: EvidenceDemotion | null
  cropSidePx: number
  /**
   * `EvidenceFramePlan.cropGrowth` — how much this image's ghost enlarged its crop over what the
   * better-framed of its two instants needed alone, read BEFORE `computeCropRect`'s frame cap.
   * `null` on a single and on a demoted pair, where nothing was ghosted — so the reading that
   * caused a far-apart demotion is NOT on this line; see `EvidenceFramePlan.cropGrowth`.
   *
   * A number, like `cropSidePx` beside it, and for the same reason: it is what
   * `EVIDENCE_MAX_PAIR_CROP_GROWTH`'s calibration bracket is stated in, so re-checking that bracket
   * on real footage should not need a probe patch and a private console prefix.
   */
  cropGrowth: number | null
}

export interface EvidenceCoverageMetric {
  status: 'planned' | 'no-evidence'
  /** `null` iff `status === 'planned'`. */
  reason: EvidenceUnavailableReason | null
  exemplars: EvidenceCoverageExemplar[]
}

export interface EvidenceCoveragePayload {
  clips: Array<{
    clipIndex: number
    frameCount: number
    metrics: Partial<Record<MetricId, EvidenceCoverageMetric>>
  }>
  /** Per-metric winning clip index across a multi-clip session, so N-clip provenance is checkable
   * without reading it off the DOM. */
  sourceIndices: Partial<Record<MetricId, number>>
}

/**
 * The `[evidence-coverage]` payload, built purely. The layer that owns the console emits it once
 * per run, DEV-gated; this function does no logging and touches no DOM, so the schema is
 * unit-testable on its own.
 *
 * **Nothing image-shaped, ever** — no `ImageBitmap`, canvas, `Blob`, object URL or data URI is
 * reachable from here. Numbers and enums only; a crop rect's SIDE is a number and is fine, a crop
 * is not. And no metric `value`/`confidence`: `[analysis-diagnostics]` already carries those, and
 * two sources of truth for the same number can disagree. `quality` here is the exemplar's own gate
 * score, which that line does not carry.
 *
 * `timestamp`/`pairedTimestamp` are on it deliberately — they are exactly what a
 * `ffmpeg -i clip -ss <t> -frames:v 1` ground-truthing pass needs as input.
 */
export function summarizeEvidenceCoverage(
  clips: EvidenceCoverageClip[],
  sourceIndices: Partial<Record<MetricId, number>>,
): EvidenceCoveragePayload {
  return {
    clips: clips.map((clip) => {
      const metrics: Partial<Record<MetricId, EvidenceCoverageMetric>> = {}
      for (const [id, entry] of Object.entries(clip.plan) as Array<
        [MetricId, MetricEvidencePlan]
      >) {
        metrics[id] =
          entry.status === 'planned'
            ? {
                status: 'planned',
                reason: null,
                exemplars: entry.items.map((item) => ({
                  kind: item.kind,
                  ...(item.side === undefined ? {} : { side: item.side }),
                  quality: item.quality,
                  timestamp: item.base.timestamp,
                  pairedTimestamp: item.ghost?.timestamp ?? null,
                  demotion: item.demotion,
                  cropSidePx: item.crop.side,
                  cropGrowth: item.cropGrowth,
                })),
              }
            : { status: 'no-evidence', reason: entry.reason, exemplars: [] }
      }
      return {
        clipIndex: clip.clipIndex,
        frameCount: clip.frameCount,
        metrics,
      }
    }),
    sourceIndices,
  }
}
