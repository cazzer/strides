import { describe, expect, it } from 'vitest'
import { computeStepWidthCm } from './stepWidthCm'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildStrikeFrames, withStaticOppositeAnkle } from './__fixtures__/strikeFrames'
import { buildFrame } from './__fixtures__/testFrames'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { planMetricEvidence } from '../results/evidenceFrames'
import { planEvidenceAnnotations } from '../results/evidenceAnnotations'
import type { EvidenceCaliperOp } from '../results/evidenceAnnotations'

/**
 * Translates the whole body a little further right on each frame.
 *
 * Without it the two opposite-foot plants sit at near-identical crops and `isNearIdenticalPair`
 * correctly demotes the pair to its base alone — which still exercises the defect, but only on one
 * half. A single pixel per frame is enough to keep both instants (and stays far under
 * `EVIDENCE_MAX_PAIR_CROP_GROWTH`), so the assertion can be about the ghost as well as the base.
 */
function withPerFrameDrift(
  frames: RobustPoseFrame[],
  perFramePx: number,
): RobustPoseFrame[] {
  return frames.map((frame, i) => ({
    ...frame,
    keypoints: frame.keypoints.map((kp) => ({
      ...kp,
      x: kp.x === null ? kp.x : kp.x + i * perFramePx,
    })),
  }))
}

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  strideAmplitudePx: 80,
  verticalBouncePx: 20,
  trunkLeanDeg: 5,
}

/**
 * Rewrites every frame's ankle x-position so that the sign-corrected own-side offset (the exact
 * quantity `computeStepWidthCm` now reports — `(ankle.x - hipMid.x) * sign(sideHip.x - hipMid.x)`)
 * is exactly `ownSideOffsetPx` on BOTH legs, at every frame — not just at footstrikes. Same
 * technique `footStrikePattern.test.ts`'s `withKneeAnkleOffset` uses: it pins the signal this
 * metric reads to a known value while leaving footstrike timing (still driven by the fixture's
 * own ankle-y) and everything else about the clip realistic.
 *
 * Deliberately NOT a single shared absolute x for both ankles (as an earlier version of this
 * fixture used): `generateSyntheticGait` places `left_hip.x` below hip-mid and `right_hip.x`
 * above it, so pinning both ankles to the same absolute x makes one leg's offset read as
 * "own side" and the other leg's the mirror-image "crossover" under the sign-corrected formula
 * — the two legs' sign-corrected offsets become structural negatives of each other and the
 * median collapses toward whichever side has more detected footstrikes, not toward the pinned
 * value. Mirroring each ankle's offset outward from ITS OWN hip (`-` for the left leg, whose own
 * side is the lower-x direction; `+` for the right) keeps both legs' sign-corrected offsets
 * identically `ownSideOffsetPx`, positive or negative, regardless of footstrike-side balance —
 * see `stepWidth.test.ts`'s (the ratio sibling, #46) `buildStepWidthFrames` for the same finding
 * verified independently on that metric.
 */
function withOwnSideAnkleHipOffset(
  frames: RobustPoseFrame[],
  ownSideOffsetPx: number,
): RobustPoseFrame[] {
  return frames.map((frame) => {
    const leftHip = frame.keypoints.find((k) => k.name === 'left_hip')
    const rightHip = frame.keypoints.find((k) => k.name === 'right_hip')
    const hipMidX = ((leftHip?.x ?? 0) + (rightHip?.x ?? 0)) / 2
    return {
      ...frame,
      keypoints: frame.keypoints.map((kp) => {
        if (kp.name === 'left_ankle') return { ...kp, x: hipMidX - ownSideOffsetPx }
        if (kp.name === 'right_ankle') return { ...kp, x: hipMidX + ownSideOffsetPx }
        return kp
      }),
    }
  })
}

describe('computeStepWidthCm', () => {
  it('a clean front-view clip with a pinned own-side offset: value close to offsetPx / scale in cm, sane sample size, high confidence', () => {
    const scale = 300 // px/m
    const base = generateSyntheticGait({ ...BASE_PARAMS, view: 'front', pixelsPerMeter: scale })
    const frames = withOwnSideAnkleHipOffset(base, 15) // 15px = 5cm at 300px/m

    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(5, 6)
    expect(result.value as number).toBeGreaterThan(0)
    expect(result.sampleSize).toBeGreaterThanOrEqual(4)
    expect(result.frameCoverage).toBe(1)
    expect(result.viewFit).toBe('primary')
    expect(result.unit).toBe('centimeters')
    expect(result.caveat).toBeNull()
    // viewFitMultiplier 1, frameCoverage 1, interpolatedFraction 0, sampleSize well over the
    // minimum (capped at 1) -> confidence at or very near 1.
    expect(result.confidence).toBeGreaterThan(0.9)
  })

  it('a crossover-gait clip (each foot lands on the OPPOSITE side of its own hip): negative value, crossover caveat fires', () => {
    // A negative `ownSideOffsetPx` pushes both legs' ankles past hip-mid onto the opposite side
    // from their own hip -- a genuine crossover, not merely "positive x" on an arbitrary axis.
    // Both legs land on the wrong side, so this isn't sensitive to detected-footstrike side
    // balance the way a single-absolute-x fixture would be -- see `withOwnSideAnkleHipOffset`'s
    // doc for why that construction was rejected.
    const scale = 300
    const base = generateSyntheticGait({ ...BASE_PARAMS, view: 'front', pixelsPerMeter: scale })
    const frames = withOwnSideAnkleHipOffset(base, -15) // -15px = -5cm at 300px/m

    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(-5, 6)
    expect(result.value as number).toBeLessThan(0)
    expect(result.viewFit).toBe('primary')
    expect(result.caveat).toContain('crossover gait')
  })

  it('a side-view clip: viewFit unsuitable, confidence discounted to the 0.1 multiplier', () => {
    const scale = 300
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'side', pixelsPerMeter: scale })

    const result = computeStepWidthCm(frames, 'side')

    expect(result.value).not.toBeNull() // still computed, per "never a silent wrong number"
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toContain('side view')
  })

  it("reports the backend-gate availability caveat, verbatim, when no frame carries a measured scale", () => {
    const frames = generateSyntheticGait({ ...BASE_PARAMS, view: 'front' }) // no pixelsPerMeter
    const NO_SCALE_CAVEAT =
      "No real-world scale could be measured for this clip, so step width can't be reported in centimetres."

    expect(() => computeStepWidthCm(frames, 'front')).not.toThrow()
    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.unit).toBe('centimeters')
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toBe(NO_SCALE_CAVEAT)
  })

  it('behaves identically on an empty frame list', () => {
    expect(() => computeStepWidthCm([], 'front')).not.toThrow()
    const result = computeStepWidthCm([], 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toMatch(/no real-world scale could be measured/i)
  })

  it('excludes candidate footstrikes on frames with no usable scale, using only the scaled ones', () => {
    const scale = 300
    const base = generateSyntheticGait({ ...BASE_PARAMS, view: 'front', pixelsPerMeter: scale })
    const pinned = withOwnSideAnkleHipOffset(base, 15)
    // Null out the scale on every OTHER frame -- some footstrike candidates now sit on an
    // unscaled frame and must be excluded rather than crash or corrupt the median.
    const mixed = pinned.map((frame, i) => ({
      ...frame,
      pixelsPerMeter: i % 2 === 0 ? null : frame.pixelsPerMeter,
    }))

    const scaledOnly = computeStepWidthCm(pinned, 'front')
    const result = computeStepWidthCm(mixed, 'front')

    expect(result.value).not.toBeNull()
    // The pinned offset is identical on every frame, so which subset of footstrikes survives the
    // scale filter doesn't move the value -- only coverage/confidence should differ.
    expect(result.value).toBeCloseTo(scaledOnly.value ?? 0, 6)
    expect(result.frameCoverage).toBeLessThan(1)
    expect(result.sampleSize).toBeLessThan(scaledOnly.sampleSize)
  })

  it('too few footstrikes: null value, 0 confidence, no crash', () => {
    // A flat, unchanging ankle trace -- no prominence-confirmed extrema, so no footstrike
    // candidates at all. Carries a scale so this reaches the "no footstrikes" branch, not the
    // backend gate.
    const frame = buildFrame(
      {
        left_hip: { x: 200, y: 400 },
        right_hip: { x: 200, y: 400 },
        left_shoulder: { x: 70, y: 250 },
        right_shoulder: { x: 330, y: 250 },
        left_ankle: { x: 190, y: 550 },
        right_ankle: { x: 210, y: 550 },
      },
      0,
      300,
    )
    const frames = Array.from({ length: 10 }, () => frame)

    expect(() => computeStepWidthCm(frames, 'front')).not.toThrow()
    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toBe('No footstrikes could be detected in this clip.')
  })

  it('reports a below-minimum-sample caveat and reduced confidence with fewer than 4 footstrikes', () => {
    const scale = 300
    // A short clip at a slow cadence yields only a couple of footstrikes.
    const base = generateSyntheticGait({
      ...BASE_PARAMS,
      durationSec: 0.5,
      cadenceStepsPerMin: 170,
      view: 'front',
      pixelsPerMeter: scale,
    })
    const frames = withOwnSideAnkleHipOffset(base, 15)

    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.sampleSize).toBeLessThan(4)
    expect(result.sampleSize).toBeGreaterThan(0)
    expect(result.caveat).toMatch(/footstrike\(s\) detected/i)
    expect(result.confidence).toBeLessThan(1)
  })

  it('returns a null value and 0 confidence when there is no resolvable hip/ankle at any candidate (degenerate scale-only input)', () => {
    // A scale is present, but no keypoints resolve at all -- detectFootstrikes needs a body-scale
    // reference (shoulders/hips) to size its prominence threshold, so it returns no candidates,
    // landing this on the "no footstrikes" branch rather than crashing on missing points.
    const frame = buildFrame({}, 0, 300)
    const result = computeStepWidthCm([frame, frame], 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toBe('No footstrikes could be detected in this clip.')
    expect(result.exemplars).toBeUndefined()
  })
})

describe('computeStepWidthCm exemplars', () => {
  const OFFSETS = [75, 75, 60, 75, 75, 90, 75]

  it('constructs the same opposite-foot pair its ratio sibling does, over centimetre offsets', () => {
    const frames = buildStrikeFrames({
      ankleOffsetsPx: OFFSETS,
      alternateFeet: true,
      pixelsPerMeter: 400,
    })

    const result = computeStepWidthCm(frames, 'front')
    const [evidence] = result.exemplars!

    expect(result.exemplars).toHaveLength(1)
    expect(evidence.kind).toBe('stepWidthStrike')
    expect(evidence.pairedTimestamp).not.toBeUndefined()
    expect(evidence).not.toHaveProperty('side')
    // Left base, right ghost — the same pair `stepWidth.test.ts` asserts, and for the same reason:
    // this fixture's first right plant sits on frame 0, which `detectFootstrikes` no longer emits.
    // "The same pair its ratio sibling constructs" is the property; which foot leads is not.
    expect(evidence.cropKeypoints).toEqual(['left_ankle', 'left_hip', 'right_hip', 'right_ankle'])
    // ...and each instant names the keypoints its OWN measurement was about, which the crop set
    // structurally cannot: the crop is the union because one photograph has to hold both plants.
    expect(evidence.annotationKeypoints).toEqual([
      `${evidence.measuredSide}_ankle`,
      'left_hip',
      'right_hip',
    ])
    expect(evidence.pairedAnnotationKeypoints).toEqual([
      `${evidence.pairedMeasuredSide}_ankle`,
      'left_hip',
      'right_hip',
    ])
    expect(evidence.measuredSide).not.toBe(evidence.pairedMeasuredSide)
    // Ankle-disjointness asserted DIRECTLY, not only through the two interpolations above: those
    // are both written off `measuredSide`, so a run where the pair's two feet coincided would
    // satisfy them while stating one ankle twice.
    expect(evidence.annotationKeypoints).toContain('left_ankle')
    expect(evidence.pairedAnnotationKeypoints).toContain('right_ankle')
    expect(evidence.annotationKeypoints).not.toContain('right_ankle')
    expect(evidence.pairedAnnotationKeypoints).not.toContain('left_ankle')
  })

  it('demotes to a single representative strike when every plant is the same foot', () => {
    const frames = buildStrikeFrames({ ankleOffsetsPx: OFFSETS, pixelsPerMeter: 400 })

    const [evidence] = computeStepWidthCm(frames, 'front').exemplars!

    expect(evidence).not.toHaveProperty('pairedTimestamp')
    expect(evidence.side).toBe('left')
  })

  it('keeps the opposite ankle on the demoted single, and states no per-instant set', () => {
    // The pair and the single are NOT one expression. On the single, the opposite ankle is context
    // this one measurement genuinely is about — a width is read against the midline, which is only
    // legible with the other foot in frame — and there is no second instant for it to be
    // misattributed to. Stated here as well as on the ratio sibling: the two metrics share one
    // construction, and this file exists because a divergence between them went unnoticed once.
    const frames = withStaticOppositeAnkle(
      buildStrikeFrames({ ankleOffsetsPx: OFFSETS, pixelsPerMeter: 400 }),
    )

    const [evidence] = computeStepWidthCm(frames, 'front').exemplars!

    expect(evidence).not.toHaveProperty('pairedTimestamp')
    expect(evidence.side).toBe('left')
    expect(evidence.cropKeypoints).toEqual([
      'left_ankle',
      'left_hip',
      'right_hip',
      'right_ankle',
    ])
    expect(evidence).not.toHaveProperty('annotationKeypoints')
    expect(evidence).not.toHaveProperty('pairedAnnotationKeypoints')
  })

  it('gates out every strike whose outward polarity was invented by the sign fallback', () => {
    // The same `Math.sign(...) || 1` degenerate case `stepWidth.ts` has, gated on the same terms.
    const frames = buildStrikeFrames({
      ankleOffsetsPx: OFFSETS,
      hipSpreadPx: 0,
      pixelsPerMeter: 400,
    })

    const result = computeStepWidthCm(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.exemplars).toBeUndefined()
  })

  it('never offers a strike that carried no real-world scale', () => {
    // A strike with no usable `pixelsPerMeter` never entered `offsetsCm`, so it has no measured
    // value to be an exemplar of.
    const frames = buildStrikeFrames({ ankleOffsetsPx: OFFSETS, pixelsPerMeter: null }).map(
      (frame, i) => ({ ...frame, pixelsPerMeter: i === 5 ? 400 : null }),
    )

    const result = computeStepWidthCm(frames, 'front')

    expect(result.sampleSize).toBe(1)
    expect(result.exemplars).toHaveLength(1)
    expect(result.exemplars![0].timestamp).toBeCloseTo(5 / 30, 10)
  })

  it('names each instant’s own foot, so both halves of the pair get their caliper drawn', () => {
    // REGRESSION (`strides-b5o`). This module's `buildExemplars` was a line-for-line copy of
    // `stepWidth.ts`'s that had lost `measuredSide`/`pairedMeasuredSide`. Neither module sets a
    // pair-level `side` (deliberately — the two instants are opposite feet), so without them
    // `resolveInstantSide` resolves `null` for BOTH halves and `buildStepWidthMarks` returns on
    // `side === null` before reaching `builder.caliper`. The hip-width segment and hip-midline
    // plumb still drew, so the image looked deliberate rather than broken.
    //
    // Asserted end to end rather than only on the exemplar, because the two-field omission is
    // invisible at the metric layer — the missing caliper is the whole consequence, and this
    // metric is tier-3 on every clip this repo has, so no live image can show it.
    const frames = withPerFrameDrift(
      buildStrikeFrames({
        ankleOffsetsPx: OFFSETS,
        alternateFeet: true,
        pixelsPerMeter: 400,
      }),
      1,
    )

    const result = computeStepWidthCm(frames, 'front')
    const [evidence] = result.exemplars!

    // The metric-layer contract, stated exactly as `stepWidth.test.ts` states it for the sibling.
    expect(evidence.pairedTimestamp).not.toBeUndefined()
    expect(evidence).not.toHaveProperty('side')
    expect(evidence.measuredSide).not.toBeUndefined()
    expect(evidence.pairedMeasuredSide).not.toBeUndefined()
    expect(evidence.measuredSide).not.toBe(evidence.pairedMeasuredSide)

    // ...and its consequence: a caliper on each half of a genuinely two-instant ghost.
    const plan = planMetricEvidence(result, frames, { width: 1920, height: 1080 })
    expect(plan.status).toBe('planned')
    const item = (plan as Extract<typeof plan, { status: 'planned' }>).items[0]
    expect(item.ghost).not.toBeNull()

    const calipers = planEvidenceAnnotations(item, 640).ops.filter(
      (op): op is EvidenceCaliperOp =>
        op.kind === 'caliper' && op.role === 'ankleOffsetCaliper',
    )
    expect(calipers.map((op) => op.instant).sort()).toEqual(['base', 'ghost'])
  })
})
