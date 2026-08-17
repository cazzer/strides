import {
  bboxArea,
  deriveBoundingBox,
  isBoundingBoxContinuous,
} from '../pose/backends/movenetCrop'
import type { BoundingBoxPx } from '../pose/backends/movenetCrop'
import type { PoseSample } from '../pose/robustness/types'

/**
 * The retroactive person-of-interest stage's whole configuration plane (issue #51, Stage 1).
 * Folded into `SamplingRobustnessConfig` as its `personSelection` key rather than given a `window`
 * global of its own — this runs inside the analysis pipeline, which already resolves exactly one
 * sampling/robustness object per run.
 */
export interface RetroactivePersonSelectionConfig {
  /** Kill switch. `false` returns the input samples untouched (`skipReason: 'disabled'`), making
   * a run behave exactly as it did before this stage existed. */
  enabled: boolean
  /**
   * Minimum bounding-box area a detection must reach to be treated as a real person, expressed as
   * a FRACTION of the frame's own area rather than an absolute px² figure.
   *
   * Keypoints are in source-video pixels on both sampling paths, so an absolute floor would be 4x
   * more permissive at 4K than at 1080p — the same physical subject at the same distance produces
   * four times the pixel area. A fraction is resolution-independent by construction.
   */
  minBoundingBoxAreaFraction: number
  /** Per-keypoint score floor handed to `deriveBoundingBox`. */
  minKeypointConfidence: number
  /** How many keypoints must clear `minKeypointConfidence` for a frame to yield a box at all. */
  minConfidentKeypoints: number
  /** Scale-continuity bound between consecutive surviving detections — a larger ratio cuts a
   * segment boundary. */
  maxAreaRatio: number
  /** Position-continuity bound (bbox sides per second of center displacement) between consecutive
   * surviving detections. */
  maxCenterSpeedSidesPerSecond: number
  /** A time gap larger than this between consecutive surviving detections cuts a segment
   * boundary regardless of geometry: across a long enough gap the speed bound degenerates to
   * "anything is reachable", so continuity stops meaning anything. */
  maxContinuityGapSeconds: number
}

/**
 * `enabled: true` — BY EXPLICIT USER DECISION (2026-08-16), OVERRIDING THE PRE-REGISTERED SHIP
 * RULE, WHICH FIRED. Recorded plainly rather than quietly reworded, because the rule's whole
 * purpose was to stop a favourable-looking metric shift excusing a measured false cut.
 *
 * What the rule caught, and what is therefore knowingly accepted as the default: on the side-view
 * track demo this stage cuts the runner's own continuous 55-frame track into pieces and discards
 * the first five (13-16 detected frames lost across trials). One badly-collapsed detection at
 * t=4.32 (24,473 px² at centre (896,606)), wedged between the runner's real 167,867 px² at
 * (574,849) and 108,121 px² at (824,738), fails continuity against BOTH neighbours — chiefly on
 * POSITION (the boxes are disjoint in x, so IoU is 0, and 403px of centre travel in 0.08s is
 * ~12 sides/s against a 3 sides/s bound), which is why no `maxAreaRatio` value heals it. A single
 * bad frame strands everything before it. Side view is this app's most common footage, so this
 * cost is not hypothetical.
 *
 * Every confidence on that clip happened to IMPROVE (the discarded stretch also contained five
 * phantom detections on visibly empty frames) — but that is the exact coincidence the rule exists
 * to refuse as justification.
 *
 * Against that: on the repro clip the stage does what it was built to do, picking the runner over
 * two bystander spans by a 39-46x margin and correcting the SIGN of `trunkLean` (-2.88° -> +4.28°)
 * and `footStrikePattern` (+0.05 -> -0.20) — see the change's design.md for both tables.
 *
 * Revert with `enabled: false` here, or per-run via
 * `window.__STRIDES_SAMPLING_ROBUSTNESS_CONFIG_OVERRIDE__ = { personSelection: { enabled: false } }`.
 * The fix is a splice-tolerant segmentation rule (design.md follow-up 1), built in #54 — plus a
 * widened centre-speed bound, which is what actually unblocked it. See the update below. Of the
 * two open correctness items in design.md's Risks table, documented as prerequisites for
 * enabling, primary/scale-pass selection divergence is CLOSED (#56): the two passes' selected
 * subjects are now compared at matched timestamps before the graft, and a diverging scale pass
 * caveats its two centimetre metrics rather than silently attributing a bystander's numbers to
 * the runner (`src/results/scalePassSubjectAgreement.ts`). Boxless survival inside the winner's
 * span remains live rather than pending.
 *
 * UPDATE (2026-08-16, issue #54): the wedge above is FIXED, and the paragraph stands as the record
 * of what was accepted in the interim, not as current behaviour. Measured live (3 trials, real GPU,
 * vs. the same clip at the previous default): the runner's track is now ONE segment spanning
 * [0.08, 6.32] with 53 detections — the 5-frame prefix, the wedge frame, and the 47-frame tail all
 * merged — where before the winner was the 47-frame tail alone starting at t=4.36. `segmentCount`
 * 5-6 -> 3-4, `rejectedOtherSegment` 13-16 -> 7-10, detected frames 52 -> 58, `bridgedCuts: 1`.
 *
 * It took TWO changes, and the order matters for anyone re-deriving this. The bridge rule alone was
 * measured to be a complete no-op here (`bridgedCuts: 0`, every field bit-identical). Traced frame
 * by frame: the bridge asked exactly the intended question about exactly the intended pair — t=4.24
 * (167,867 px² at (574,849)) against t=4.36 (108,121 px² at (824,738)), 0.12s apart, inside the
 * time-gap tolerance — and `isBoundingBoxContinuous` said NO. Those two boxes are disjoint in x by
 * 0.49 px, so IoU is exactly 0 (issue #54's premise of "IoU ~= 0.13" is WRONG), and the centre-speed
 * term then had to carry position alone: 273.2 px of travel against a 253.9 px budget at 3 sides/s,
 * short by 7.6%. The area ratio (1.553) passes and is never consulted, because
 * `positionContinuous && …` short-circuits first. So the binding constraint was the BOUND, not the
 * rule's shape — hence `maxCenterSpeedSidesPerSecond: 4` below and design.md's D4. Keep that
 * measurement: it is the whole evidence base for the bound, and re-deriving it costs a live run.
 *
 * The rule earns its keep independently of Demo 1: on `e2e/fixtures/multiperson-track.mp4` it fires
 * 4 times, takes `segmentCount` 8 -> 2 and the winner 119 -> 123 frames, without merging a
 * bystander (winner `medianAreaPx` moves 0.84%, `separationRatio` stays 33.5). Demo 2 stays a
 * bit-identical no-op under both changes.
 *
 * Note that Demo 1's `segmentCount` 1 / zero-rejection condition is STILL not met (it measures 3-4
 * with 7-10 rejections), and remains a JOINT #54 + #57 outcome: five phantom detections of
 * 2,279-8,432 px² clear the 4K area floor of 1,659 px² and fail the ratio bound at ~19.9x — a
 * transition the bridge cannot merge and should not. Those three phantom segments are all that is
 * left, and every one of them lies OUTSIDE the winner's span. Demo 1 keeps `segmentCount >= 2`
 * until #57's re-derived floor demotes them to `rejectedBelowFloor`, where D5 makes them harmless.
 *
 * `minBoundingBoxAreaFraction: 2e-4` — 415 px² at 1080p, 1659 px² at 4K. Derived as roughly the
 * geometric mean of the largest measured garbage detection on the repro clip (183 px²) and the
 * smallest measured real person on it (~1000 px²): ~2.3x above the noise, ~40x below the smallest
 * real subject. Deliberately nowhere near either boundary.
 *
 * `minKeypointConfidence: 0.3` / `minConfidentKeypoints: 4` — matched to
 * `DEFAULT_TRACKING_CROP_CONFIG`'s own `deriveBoundingBox` arguments, so "is there a usable box in
 * this frame" means the same thing offline as it does online.
 *
 * `maxAreaRatio: 4` vs. the online continuity gate's 3 — deliberately looser, because the two
 * gates' false-reject costs are asymmetric. A false reject online skips ONE anchor update and the
 * next frame gets another try; a false cut here can strand the rest of the clip in a losing
 * segment. Separating people at genuinely different distances is the easy half of the bound's job
 * (the repro clip's bystanders are ~1/9 the runner's area, far outside either value) — it ALSO has
 * to tolerate intra-person keypoint-dropout noise, which is the half that actually bites:
 * `deriveBoundingBox` hulls only the CONFIDENCE-GATED keypoints, so a frame that drops limbs both
 * shrinks the box and translates its centroid. The measured Demo 1 wedge is a 6.9x intra-person
 * area swing with a simultaneous ~400px centroid jump across two consecutive frames of one person.
 * Extra margin here is cheap, but it is not sufficient — see design.md's D7: that wedge's first
 * cut is a POSITION failure (IoU 0, ~12 sides/s against a 3 sides/s bound) that no value of this
 * bound can heal, which is why the fix is a splice-tolerant segmentation rule (issue #54, the cut
 * loop below) rather than a wider ratio. That rule changes WHICH PAIR continuity is asked about,
 * leaving this bound's own meaning untouched — see `maxCenterSpeedSidesPerSecond` below for the
 * bound that did have to move, and design.md's D4 for why.
 *
 * `maxCenterSpeedSidesPerSecond: 4` vs. the online continuity gate's 3 — deliberately looser, for
 * the SAME asymmetric-false-reject reason `maxAreaRatio` is (above), applied to the bound that had
 * been left at parity. A runner crossing a 1920px frame in ~1.5s is ~1.8 sides/s against a ~700px
 * box, so 3 was never a tight bound on real locomotion — what it is actually bounding here is
 * intra-person CENTROID noise, and `deriveBoundingBox`'s confidence gate moves the centroid
 * whenever limbs drop out, exactly as it moves the area. Both halves of the position test are
 * perturbed by the same mechanism the area bound already got margin for.
 *
 * Sized by the measured Demo 1 wedge (design.md D4): the pair the splice-tolerance bridge must
 * merge, t=4.24 against t=4.36, travels 273.2px against a 253.9px budget at 3 sides/s — it misses
 * by 7.6%, and the boxes are disjoint in x by 0.49px so IoU is exactly 0 and cannot rescue it.
 * **4 is chosen because it is the same 4/3 loosening `maxAreaRatio` already carries**, making the
 * offline stage uniformly 4/3 more permissive than the online gate for one stated reason — NOT
 * because it is the smallest value that clears that measurement. A value fitted to the shortfall
 * (~3.3) would sit 2% above a single clip's failure point; 4 clears it by ~24%.
 *
 * This loosens the ADJACENT check as well as the bridge — `isContinuousPair` is deliberately one
 * helper — so segmentation is uniformly more permissive, not just more forgiving of splices. The
 * multi-person merge gate is what bounds that; see design.md D4 and the A/B tables.
 *
 * `maxContinuityGapSeconds: 1.0` — this pipeline's sampling gaps are tens of milliseconds; a
 * full second without a single usable detection is a different scene, not a stride.
 */
export const DEFAULT_RETROACTIVE_PERSON_SELECTION_CONFIG: RetroactivePersonSelectionConfig = {
  enabled: true,
  minBoundingBoxAreaFraction: 2e-4,
  minKeypointConfidence: 0.3,
  minConfidentKeypoints: 4,
  maxAreaRatio: 4,
  maxCenterSpeedSidesPerSecond: 4,
  maxContinuityGapSeconds: 1.0,
}

export interface PersonSelectionSegmentDiagnostics {
  /** The segment's own span in the index partition — `startTimestamp` is the timestamp of its
   * first sample and `endTimestamp` of its last, so consecutive segments tile the whole clip with
   * no gaps and no overlap. NOT the first/last surviving detection's timestamps. */
  startTimestamp: number
  endTimestamp: number
  /** How many surviving detections (post-floor, box-yielding) this segment contains — the count
   * that produced `integratedAreaPx`, not the number of samples in its span. */
  frameCount: number
  /** Sum of bounding-box area across this segment's surviving detections. The score. */
  integratedAreaPx: number
  /** Median bounding-box area across the same set — `integratedAreaPx` split into its size and
   * duration halves, so a long-and-small segment reads differently from a short-and-large one.
   * `0` for a segment with no surviving detections (impossible today: every segment starts at
   * one). */
  medianAreaPx: number
}

export interface PersonSelectionDiagnostics {
  status: 'selected' | 'skipped'
  /** Why the stage did nothing. `null` exactly when `status` is `'selected'`. */
  skipReason:
    | 'disabled'
    | 'unknown-frame-size'
    | 'no-detections'
    | 'no-detection-above-floor'
    | null
  /** The resolved absolute floor in px² (`minBoundingBoxAreaFraction × frameWidth × frameHeight`),
   * or `0` when the frame size was unusable and no floor could be resolved. */
  minBoundingBoxAreaPx: number
  totalSamples: number
  /** Samples carrying a detection BEFORE this stage ran. `sampling.detectedFrames` in the same
   * diagnostics object is the post-selection count; this preserves the pre-selection one so the
   * two are comparable. */
  detectedSamplesIn: number
  /** Samples still carrying a detection after this stage ran. Equals `detectedSamplesIn` on every
   * skip path. */
  detectedSamplesOut: number
  /** Detections nulled for falling below `minBoundingBoxAreaPx` — or for having a non-finite area
   * at all, which is counted here too — across every segment. */
  rejectedBelowFloor: number
  /** Detections nulled for belonging to a losing segment (floor rejections are not counted twice
   * here). */
  rejectedOtherSegment: number
  segmentCount: number
  /** How many times a cut was DECLINED because the surviving detections either side of the
   * offending one were continuous with each other. Counts bridge EVENTS, not boundaries: one event
   * removes the boundary in front of the frame and prevents the one behind it from ever being
   * evaluated, so the measured Demo 1 wedge reports 1, not 2. Non-zero on a clip that had no wedge
   * means the rule is firing where it should not — this field exists so that a healed clip and a
   * clip that never needed healing are distinguishable, which a smaller `segmentCount` alone
   * cannot do. */
  bridgedCuts: number
  /** Sorted by `integratedAreaPx` DESCENDING and capped at 10, so `segments[0]` is always the
   * winner. Capped because this is a console-logged dev diagnostic and a pathological clip could
   * otherwise produce hundreds of entries; `segmentCount` stays uncapped. */
  segments: PersonSelectionSegmentDiagnostics[]
  /** `segments[0].integratedAreaPx / segments[1].integratedAreaPx` — how decisively the winner
   * won. `null` when there are fewer than two segments (nothing to separate from), or when the
   * ratio isn't finite. */
  separationRatio: number | null
}

const MAX_REPORTED_SEGMENTS = 10

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function skipped(
  samples: PoseSample[],
  detectedSamplesIn: number,
  minBoundingBoxAreaPx: number,
  skipReason: Exclude<PersonSelectionDiagnostics['skipReason'], null>,
): { samples: PoseSample[]; diagnostics: PersonSelectionDiagnostics } {
  return {
    samples,
    diagnostics: {
      status: 'skipped',
      skipReason,
      minBoundingBoxAreaPx,
      totalSamples: samples.length,
      detectedSamplesIn,
      detectedSamplesOut: detectedSamplesIn,
      rejectedBelowFloor: 0,
      rejectedOtherSegment: 0,
      segmentCount: 0,
      bridgedCuts: 0,
      segments: [],
      separationRatio: null,
    },
  }
}

/**
 * Collapses a sampled clip to the frames belonging to ONE person — chosen retroactively, from
 * evidence spanning the whole clip, rather than frame by frame as the online tracker must.
 *
 * The online tracker is causal: it commits to a subject having seen only the past, and on the
 * repro clip that commitment happens on frame 1, before the runner has even entered the frame.
 * Every downstream mechanism then defends the wrong choice. Analysis, however, is offline — the
 * whole sequence exists before any metric is computed — so the decision can simply be made later,
 * with all the evidence in hand.
 *
 * The method:
 *  1. Derive a bounding box per detected frame (`deriveBoundingBox`, the same box the online
 *     tracker uses).
 *  2. Drop any box below the absolute area floor, or whose area is not finite at all. These are
 *     degenerate detections, not people (5–183 px² on the repro clip, at a fixed screen position,
 *     for ~0.5s). They are dropped unconditionally, in every segment, and never start or cut one —
 *     a floor rejection is not evidence about anybody's continuity.
 *  3. Cut a segment boundary between consecutive SURVIVING detections whenever they fail
 *     `isBoundingBoxContinuous` (the online gate's own geometry) or are more than
 *     `maxContinuityGapSeconds` apart — EXCEPT when the surviving detections either side of the
 *     offending one pass that same test (time-gap term included) against each other, in which case
 *     the cut is declined and counted in `bridgedCuts`. One collapsed detection is a measurement
 *     failure on a single frame, not evidence of a second subject, and cutting on it strands
 *     everything before it in a losing segment. The tolerance spans exactly ONE detection, by
 *     construction rather than by a counter: the reference does not advance across a bridged
 *     frame, so the next comparison is against a reference already verified continuous with it.
 *     Two consecutive failures still cut.
 *  4. Score each segment by INTEGRATED bounding-box area — area summed across its frames, which
 *     folds apparent size and duration into one number with no weights to tune. Highest wins.
 *  5. Null every frame outside the winner.
 *
 * Losing frames become `{ timestamp, frame: null }` — a real gap — and NEVER another person's
 * keypoints. `applyRobustness` interpolates across gaps with no identity check whatsoever, so
 * substituting would produce a lerp from person A to person B labelled `'interpolated'`: a
 * fabricated position wearing a trusted status. A gap is honestly missing data; a substitution is
 * a plausible-looking lie.
 *
 * Fails OPEN in every degenerate case (disabled, unusable frame size, no detections at all, no
 * detection above the floor): the input is returned untouched with a typed `skipReason`. This
 * stage may narrow a clip to one person; it must never zero a clip that had detections.
 *
 * Pure — no `window`, no refs, no mutation of `samples` or anything reachable from it. Surviving
 * entries come back by REFERENCE, so `output[i] === input[i]` identifies a kept frame exactly.
 *
 * `samples` MUST already be sorted ascending by `timestamp` (its one caller,
 * `runClipAnalysisPipeline`, sorts immediately before calling). Segmentation reads consecutive
 * pairs and measures elapsed time between them; out-of-order input would produce negative
 * elapsed times and meaningless cuts.
 */
export function selectRetroactivePersonOfInterest(
  samples: PoseSample[],
  frameWidth: number,
  frameHeight: number,
  config: RetroactivePersonSelectionConfig,
): { samples: PoseSample[]; diagnostics: PersonSelectionDiagnostics } {
  const detectedSamplesIn = samples.filter((s) => s.frame !== null).length

  if (!config.enabled) {
    return skipped(samples, detectedSamplesIn, 0, 'disabled')
  }

  const frameArea = frameWidth * frameHeight
  if (!Number.isFinite(frameArea) || frameArea <= 0) {
    return skipped(samples, detectedSamplesIn, 0, 'unknown-frame-size')
  }

  const minBoundingBoxAreaPx = config.minBoundingBoxAreaFraction * frameArea

  if (detectedSamplesIn === 0) {
    return skipped(samples, detectedSamplesIn, minBoundingBoxAreaPx, 'no-detections')
  }

  // Surviving boxes, positionally aligned with `samples`. `null` means "this index neither starts
  // nor cuts a segment and contributes no area" — whether because the sample had no frame, the
  // frame yielded no usable box, or the box fell below the floor. Only the last of those three is
  // a rejection; the other two are simply absences.
  const surviving: (BoundingBoxPx | null)[] = new Array(samples.length).fill(null)
  // Each surviving index's area, computed exactly once here and reused by the scorer, so the
  // finiteness check below is guaranteed to have covered every area that reaches a segment score.
  const survivingAreaPx: number[] = new Array(samples.length).fill(0)
  const belowFloor: boolean[] = new Array(samples.length).fill(false)
  let rejectedBelowFloor = 0

  for (let i = 0; i < samples.length; i += 1) {
    const frame = samples[i].frame
    if (frame === null) continue
    const box = deriveBoundingBox(
      frame.keypoints,
      config.minKeypointConfidence,
      config.minConfidentKeypoints,
    )
    if (box === null) continue
    const area = bboxArea(box)
    // A non-finite area is treated exactly as a below-floor one, not merely as "not less than the
    // floor". `deriveBoundingBox` returns its `±Infinity` sentinels unchanged when every confident
    // keypoint has NaN coordinates (all four comparisons are false, so nothing overwrites them),
    // and that box's area is `+Infinity`. Left unguarded, `Infinity < floor` is false, so the
    // frame would survive, its segment's `integratedAreaPx` would be `Infinity` and beat every
    // real track, and `separationRatio` would be non-finite and report `null` — suppressing the
    // one field that would have flagged it. One such frame would take the whole clip.
    if (!Number.isFinite(area) || area < minBoundingBoxAreaPx) {
      belowFloor[i] = true
      rejectedBelowFloor += 1
      continue
    }
    surviving[i] = box
    survivingAreaPx[i] = area
  }

  // The one continuity question this stage asks, of whichever pair it is asking about. BOTH the
  // adjacent check and the splice-tolerance bridge below go through here, deliberately: routing
  // them through one function makes it structurally impossible to drop the
  // `maxContinuityGapSeconds` term from the bridge pair, which is the edit that would let a bridge
  // merge two detections separated only by time (geometry alone reads a same-position,
  // similar-size pair 4 seconds apart as perfectly continuous).
  //
  // Parameters are CHRONOLOGICAL — `reference` is the earlier index, `candidate` the later — which
  // is the inverse of `isBoundingBoxContinuous`'s own `(candidate, reference)` argument order.
  // The relation is NOT symmetric: the speed bound normalises displacement by the REFERENCE's own
  // side length, so swapping the pair can change the answer.
  const isContinuousPair = (
    referenceIndex: number,
    candidateIndex: number,
  ): boolean => {
    const elapsedSeconds =
      samples[candidateIndex].timestamp - samples[referenceIndex].timestamp
    return (
      elapsedSeconds <= config.maxContinuityGapSeconds &&
      isBoundingBoxContinuous(
        // Non-null by construction: both callers only ever pass surviving indices.
        surviving[candidateIndex] as BoundingBoxPx,
        surviving[referenceIndex] as BoundingBoxPx,
        elapsedSeconds,
        config,
      )
    )
  }

  /** The next surviving index strictly after `after`, or `-1` if there is none. Amortised O(n)
   * across the whole loop: consecutive scans cover disjoint ranges, since a scan at `i` covers
   * `(i, bridgeTarget]` and the next cannot begin before `bridgeTarget`. */
  const nextSurvivingIndex = (after: number): number => {
    for (let j = after + 1; j < samples.length; j += 1) {
      if (surviving[j] !== null) return j
    }
    return -1
  }

  const segmentStarts: number[] = []
  let bridgedCuts = 0
  let previousIndex = -1
  for (let i = 0; i < samples.length; i += 1) {
    if (surviving[i] === null) continue
    if (previousIndex === -1) {
      segmentStarts.push(i)
      previousIndex = i
      continue
    }
    if (isContinuousPair(previousIndex, i)) {
      previousIndex = i
      continue
    }
    // Splice tolerance: one collapsed detection is a measurement failure on a single frame, not
    // evidence of a second subject. Ask the leave-one-out question — is the discontinuity still
    // there with the suspect frame removed? — and decline the cut if it is not. This can only ever
    // merge a pair the UNMODIFIED predicate already accepts, so it cannot admit a transition the
    // adjacent check would have rejected.
    const bridgeTarget = nextSurvivingIndex(i)
    if (bridgeTarget !== -1 && isContinuousPair(previousIndex, bridgeTarget)) {
      bridgedCuts += 1
      // `previousIndex` deliberately NOT advanced: `i` must not become the reference, or the next
      // iteration compares against the frame we just declined to cut on and cuts there instead —
      // healing one boundary while re-stranding everything after it. Leaving the reference put
      // also bounds the tolerance to exactly one detection with no counter: the next surviving
      // frame is compared against a reference we have just verified it is continuous with, so it
      // cannot bridge again. Two consecutive bad frames still cut.
      continue
    }
    segmentStarts.push(i)
    previousIndex = i
  }

  if (segmentStarts.length === 0) {
    // Detections existed, but not one of them cleared the floor (or yielded a box at all). There
    // is nobody to select, so select nobody — and change nothing.
    return skipped(
      samples,
      detectedSamplesIn,
      minBoundingBoxAreaPx,
      'no-detection-above-floor',
    )
  }

  // A TOTAL contiguous partition of the sample indices: segment k owns
  // `[segmentStarts[k], segmentStarts[k + 1] - 1]`, with segment 0 extended back to index 0 and
  // the last extended forward to the end. Every sample therefore belongs to exactly one segment,
  // including the leading/trailing/interior ones that carry no usable detection — those ride with
  // whichever segment contains them and contribute nothing to its score. Without the total
  // partition, "null every frame outside the winner" would be ambiguous for exactly the frames
  // most likely to be junk.
  const partition = segmentStarts.map((start, k) => ({
    from: k === 0 ? 0 : start,
    to:
      k === segmentStarts.length - 1
        ? samples.length - 1
        : segmentStarts[k + 1] - 1,
  }))

  const scored = partition.map(({ from, to }) => {
    const areas: number[] = []
    for (let i = from; i <= to; i += 1) {
      if (surviving[i] !== null) areas.push(survivingAreaPx[i])
    }
    return {
      from,
      to,
      startTimestamp: samples[from].timestamp,
      endTimestamp: samples[to].timestamp,
      frameCount: areas.length,
      integratedAreaPx: areas.reduce((sum, a) => sum + a, 0),
      medianAreaPx: median(areas),
    }
  })

  let winner = scored[0]
  for (const segment of scored) {
    if (segment.integratedAreaPx > winner.integratedAreaPx) winner = segment
  }

  let rejectedOtherSegment = 0
  const selected = samples.map((sample, i) => {
    if (sample.frame === null) return sample
    const inWinner = i >= winner.from && i <= winner.to
    if (inWinner && !belowFloor[i]) return sample
    if (!belowFloor[i]) rejectedOtherSegment += 1
    return { timestamp: sample.timestamp, frame: null }
  })

  // Array.prototype.sort is stable, so an exact tie keeps chronological order — which makes
  // `segments[0]` the same segment the strictly-greater scan above picked as `winner`.
  const ranked = [...scored].sort((a, b) => b.integratedAreaPx - a.integratedAreaPx)
  const separation =
    ranked.length >= 2
      ? ranked[0].integratedAreaPx / ranked[1].integratedAreaPx
      : null

  return {
    samples: selected,
    diagnostics: {
      status: 'selected',
      skipReason: null,
      minBoundingBoxAreaPx,
      totalSamples: samples.length,
      detectedSamplesIn,
      detectedSamplesOut:
        detectedSamplesIn - rejectedBelowFloor - rejectedOtherSegment,
      rejectedBelowFloor,
      rejectedOtherSegment,
      segmentCount: scored.length,
      bridgedCuts,
      segments: ranked.slice(0, MAX_REPORTED_SEGMENTS).map((segment) => ({
        startTimestamp: segment.startTimestamp,
        endTimestamp: segment.endTimestamp,
        frameCount: segment.frameCount,
        integratedAreaPx: segment.integratedAreaPx,
        medianAreaPx: segment.medianAreaPx,
      })),
      separationRatio:
        separation !== null && Number.isFinite(separation) ? separation : null,
    },
  }
}
