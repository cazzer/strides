import { describe, expect, it } from 'vitest'
import type { RobustPoseFrame } from '../pose/robustness/types'
import { detectView } from './viewDetection'
import { generateSyntheticGait } from './__fixtures__/syntheticGait'
import { buildFrame } from './__fixtures__/testFrames'
import { DEFAULT_HEURISTICS_CONFIG } from './types'

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  cadenceStepsPerMin: 170,
  verticalBouncePx: 20,
  trunkLeanDeg: 5,
}

/**
 * The Bilateral Spread Ratio a DEAD-ON FRONT view produces, for three body builds. BSR's
 * numerator is the pose model's own left/right shoulder and hip separations — shoulders near the
 * acromion, hips at the hip JOINT CENTRES, which are far narrower than external hip breadth — and
 * its denominator is twice the shoulder-mid-to-hip-mid torso length:
 *
 *   BSR_deadOnFront = (biacromial + hip-joint-centre separation) / (2 * torso length)
 *
 *   narrow  (0.33 + 0.16) / (2 * 0.52) = 0.4712
 *   central (0.37 + 0.18) / (2 * 0.49) = 0.5612
 *   broad   (0.41 + 0.22) / (2 * 0.47) = 0.6702
 *
 * The torso figures are this repo's own: `torsoMeters` 0.5041 on Demo 1 and ~0.47 on Demo 2, from
 * the MediaPipe world-landmark scale calibration. These three numbers are why the front bar and
 * the front margin's full-support point sit where they do, and why neither may be raised back
 * toward the old 0.55/1.10 pair — see `compare-view-confidence-across-labels`'s design.md.
 */
const BSR_DEAD_ON_FRONT_NARROW = 0.4712
const BSR_DEAD_ON_FRONT_CENTRAL = 0.5612
const BSR_DEAD_ON_FRONT_BROAD = 0.6702

/**
 * Live-measured signals from this repo's three test clips (headless Chromium, real GPU
 * `ANGLE Metal Renderer: Apple M4 Pro`, 3 trials each, read off `[analysis-diagnostics]`).
 * Body-scale coverage was exactly 1 on all nine runs, so `confidence` there is the plain mean of
 * the two margins.
 */
const MEASURED = {
  demo1: { bsr: 0.13349971941958275, ser: 1.5744423539766672 },
  demo2: { bsr: 0.5507346844574763, ser: 0.3388503866482488 },
  multiperson: { bsr: 0.14815523068912223, ser: 1.7917683813397007 },
} as const

const TORSO_PX = 100

/**
 * Frames engineered to hit an exact (BSR, SER) pair, so a test can state a camera geometry
 * directly rather than steering the gait generator toward one.
 *
 * Torso length is `TORSO_PX` by construction (shoulder-mid and hip-mid share an x, so their
 * distance is the y gap). Both the shoulder and the hip pair get the same separation
 * `bsr * TORSO_PX`, which makes `(shoulderSpread + hipSpread) / (2 * torso)` exactly `bsr`. Each
 * ankle alternates between two positions `ser * TORSO_PX` apart relative to its OWN hip, and over
 * an even, evenly-split sample the p95-p5 range of a two-valued series is exactly that gap — so
 * each side's sagittal range, and therefore SER, is exactly `ser`.
 */
function framesWithSignals(bsr: number, ser: number, count = 20): RobustPoseFrame[] {
  const spread = bsr * TORSO_PX
  const reach = (ser * TORSO_PX) / 2
  return Array.from({ length: count }, (_, i) => {
    const offset = i % 2 === 0 ? -reach : reach
    return buildFrame(
      {
        left_shoulder: { x: -spread / 2, y: 0 },
        right_shoulder: { x: spread / 2, y: 0 },
        left_hip: { x: -spread / 2, y: TORSO_PX },
        right_hip: { x: spread / 2, y: TORSO_PX },
        left_ankle: { x: -spread / 2 + offset, y: 2 * TORSO_PX },
        right_ankle: { x: spread / 2 + offset, y: 2 * TORSO_PX },
      },
      i / 30,
    )
  })
}

describe('detectView', () => {
  it('classifies a clean side-view clip as side, with both signals in-band', () => {
    // TORSO_LENGTH_PX = 150 (fixed in the fixture generator).
    // BSR = (6 + 6) / (2 * 150) = 0.04 -- well under sideViewMaxBilateralSpreadRatio (0.30).
    // SER ~= 2 * strideAmplitudePx / 150 = 160/150 ~= 1.07 -- well over
    // sideViewMinSagittalExcursionRatio (0.8). Both signals vote side -> view: 'side'.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, strideAmplitudePx: 80, view: 'side' })

    const result = detectView(frames)

    expect(result.view).toBe('side')
    expect(result.diagnostics.bilateralSpreadRatio).toBeCloseTo(0.04, 1)
    expect(result.diagnostics.sagittalExcursionRatio).toBeGreaterThan(0.8)
    expect(result.diagnostics.frameCoverage).toBe(1)
    // Both signals land deep in-band (large margin from their thresholds), so confidence should
    // be well above the flat 0.3 "ambiguous" baseline.
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('classifies a clean front-view clip as front, with both signals in-band', () => {
    // BSR = (130 + 130) / (2 * 150) = 0.867 -- well over frontViewMinBilateralSpreadRatio (0.55).
    // SER ~= 2 * (80 * 0.15) / 150 = 24/150 = 0.16 -- well under
    // frontViewMaxSagittalExcursionRatio (0.4). Both signals vote front -> view: 'front'.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, strideAmplitudePx: 80, view: 'front' })

    const result = detectView(frames)

    expect(result.view).toBe('front')
    expect(result.diagnostics.bilateralSpreadRatio).toBeCloseTo(0.867, 1)
    expect(result.diagnostics.sagittalExcursionRatio).toBeLessThan(0.4)
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('returns ambiguous with confidence 0 when frame coverage is below the minimum', () => {
    // Only 2 of 10 frames have a resolvable body scale (0.2 coverage), under
    // minViewDetectionFrameCoverage (0.4).
    const resolvable = buildFrame({
      left_shoulder: { x: -5, y: 0 },
      right_shoulder: { x: 5, y: 0 },
      left_hip: { x: -5, y: 100 },
      right_hip: { x: 5, y: 100 },
    })
    const unresolvable = buildFrame({})
    const frames = [
      resolvable,
      unresolvable,
      unresolvable,
      unresolvable,
      unresolvable,
      resolvable,
      unresolvable,
      unresolvable,
      unresolvable,
      unresolvable,
    ]

    const result = detectView(frames)

    expect(result.view).toBe('ambiguous')
    expect(result.confidence).toBe(0)
    expect(result.diagnostics.bilateralSpreadRatio).toBeNull()
    expect(result.diagnostics.sagittalExcursionRatio).toBeNull()
    expect(result.diagnostics.frameCoverage).toBeCloseTo(0.2)
  })

  it('returns ambiguous when BSR and SER disagree', () => {
    // Side-view bilateral geometry (small offset -> BSR votes side) but a stride amplitude far
    // too small to read as side-view sagittal excursion: SER ~= 2*20/150 = 0.267, under
    // frontViewMaxSagittalExcursionRatio (0.4) -> SER votes front. One vote each -> ambiguous.
    const frames = generateSyntheticGait({
      ...BASE_PARAMS,
      strideAmplitudePx: 20,
      view: 'side',
    })

    const result = detectView(frames)

    expect(result.view).toBe('ambiguous')
    expect(result.diagnostics.bilateralSpreadRatio).toBeLessThanOrEqual(
      DEFAULT_HEURISTICS_CONFIG.sideViewMaxBilateralSpreadRatio,
    )
    expect(result.diagnostics.sagittalExcursionRatio).toBeLessThanOrEqual(
      DEFAULT_HEURISTICS_CONFIG.frontViewMaxSagittalExcursionRatio,
    )
    // Flat, coverage-scaled fallback confidence for the disagreement case.
    expect(result.confidence).toBeCloseTo(0.3, 1)
  })

  it('returns ambiguous when there are no frames at all', () => {
    const result = detectView([])
    expect(result.view).toBe('ambiguous')
    expect(result.confidence).toBe(0)
  })

  it('is a no-op with respect to head keypoints — identical output whether nose/ears are wildly placed or fully unrecoverable', () => {
    // detectView reads shoulders/hips (bilateral spread) and ankles/hips (sagittal excursion) by
    // name only — see viewDetection.ts's module doc. Widening COMMON_KEYPOINT_NAMES to include
    // nose/left_ear/right_ear must not change this function's output at all, regardless of what
    // those three keypoints' positions or resolvability are.
    const frames = generateSyntheticGait({ ...BASE_PARAMS, strideAmplitudePx: 80, view: 'side' })
    const baseline = detectView(frames)

    const wildlyPlacedHead = frames.map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === 'nose' || kp.name === 'left_ear' || kp.name === 'right_ear'
          ? { ...kp, x: 999999, y: -999999 }
          : kp,
      ),
    }))
    const unrecoverableHead = frames.map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === 'nose' || kp.name === 'left_ear' || kp.name === 'right_ear'
          ? { ...kp, x: null, y: null, score: 0, status: 'unrecoverable' as const }
          : kp,
      ),
    }))

    expect(detectView(wildlyPlacedHead)).toEqual(baseline)
    expect(detectView(unrecoverableHead)).toEqual(baseline)
  })

  it('reports a one-hot plausibility for every clip it commits to a label', () => {
    // The invariant the gating change rests on: committing needs both signals strictly inside one
    // view's regions, which is exactly when both of `computeViewPlausibility`'s supports saturate.
    // So a labelled clip is gated by that same label at full strength, and `resolveViewFitTable`
    // is a no-op there.
    const side = detectView(
      generateSyntheticGait({ ...BASE_PARAMS, strideAmplitudePx: 80, view: 'side' }),
    )
    const front = detectView(
      generateSyntheticGait({ ...BASE_PARAMS, strideAmplitudePx: 80, view: 'front' }),
    )

    expect(side.plausibility).toEqual({ side: 1, front: 0, ambiguous: 0 })
    expect(front.plausibility).toEqual({ side: 0, front: 1, ambiguous: 0 })
  })

  it('reports an all-ambiguous plausibility when the two signals disagree', () => {
    const frames = generateSyntheticGait({
      ...BASE_PARAMS,
      strideAmplitudePx: 20,
      view: 'side',
    })

    const result = detectView(frames)

    expect(result.view).toBe('ambiguous')
    expect(result.plausibility).toEqual({ side: 0, front: 0, ambiguous: 1 })
  })

  it('reports an all-ambiguous plausibility below the coverage floor and on empty input', () => {
    // Coverage gates the plausibility rather than weighting it: with too little body scale to
    // classify from, no view is supported at all.
    const resolvable = buildFrame({
      left_shoulder: { x: -5, y: 0 },
      right_shoulder: { x: 5, y: 0 },
      left_hip: { x: -5, y: 100 },
      right_hip: { x: 5, y: 100 },
    })
    const unresolvable = buildFrame({})
    const frames = [resolvable, unresolvable, unresolvable, unresolvable, unresolvable]

    expect(detectView(frames).plausibility).toEqual({ side: 0, front: 0, ambiguous: 1 })
    expect(detectView([]).plausibility).toEqual({ side: 0, front: 0, ambiguous: 1 })
  })

  // -------------------------------------------------------------------------------------------
  // Comparability of `confidence` across the two labels (`strides-2iw`). Each of the four
  // per-(view, signal) margins runs from that view's own decision threshold to the value the
  // signal reads with the camera DEAD-ON for that view. Two of those full-support points are
  // exact projection limits (both 0 — a dead-on side view collapses left/right together, a
  // dead-on front view hides the leg's fore-aft reach in depth) and two are anatomical
  // measurements. What these tests exist to stop coming back: the front BSR margin used to
  // saturate at twice its own threshold, BSR 1.10, roughly twice what any human body can produce,
  // so no front clip could clear ~0.61 while side clips routinely read 0.75+.
  // -------------------------------------------------------------------------------------------

  it('puts a dead-on front view and a dead-on side view on the same scale — both reach 1', () => {
    const front = detectView(framesWithSignals(BSR_DEAD_ON_FRONT_CENTRAL, 0))
    const side = detectView(
      framesWithSignals(0, DEFAULT_HEURISTICS_CONFIG.sideViewFullSagittalExcursionRatio),
    )

    expect(front.view).toBe('front')
    expect(side.view).toBe('side')
    expect(front.confidence).toBe(1)
    expect(side.confidence).toBe(1)
  })

  it('saturates the front bilateral-spread margin at a ratio a human body can actually produce', () => {
    // A typical adult runner filmed square-on: BSR at the anatomical dead-on central value, SER at
    // the exact foreshortening limit. Under the old `2 * threshold` saturation (full support only
    // at BSR 1.10) this identical clip read ((0.5612 - 0.55) / 0.55 + 1) / 2 = 0.510 — a flawless
    // front view scored barely above a coin toss, below the 0.7 the results view calls "High
    // confidence", with no camera position able to fix it.
    expect(detectView(framesWithSignals(BSR_DEAD_ON_FRONT_CENTRAL, 0)).confidence).toBe(1)
    // A broader build reads higher still on the raw signal, and clamps rather than overflowing.
    expect(detectView(framesWithSignals(BSR_DEAD_ON_FRONT_BROAD, 0)).confidence).toBe(1)
  })

  it('keeps the front bilateral-spread bar below what the narrowest plausible build produces dead-on', () => {
    // The classification half of the same defect: a bar at 0.55 sat between the central (0.5612)
    // and narrow (0.4712) dead-on values, so a narrow-shouldered runner filmed perfectly square-on
    // could not clear it AT ANY CAMERA ANGLE and was labelled 'ambiguous' for their build. The bar
    // has to stay under the narrow bound, and far enough under it that such a runner reads a real
    // margin rather than clinging to zero.
    const { frontViewMinBilateralSpreadRatio: bar, frontViewFullBilateralSpreadRatio: full } =
      DEFAULT_HEURISTICS_CONFIG

    expect(bar).toBeLessThan(BSR_DEAD_ON_FRONT_NARROW)
    expect(detectView(framesWithSignals(BSR_DEAD_ON_FRONT_NARROW, 0)).view).toBe('front')
    // (0.4712 - bar) / (full - bar) — the BSR margin the narrowest build gets square-on.
    expect((BSR_DEAD_ON_FRONT_NARROW - bar) / (full - bar)).toBeGreaterThan(0.15)
  })

  it('keeps every margin’s full-support point inside the range its own signal can reach', () => {
    const config = DEFAULT_HEURISTICS_CONFIG

    // Front BSR: inside the anatomical dead-on band, and emphatically NOT twice the threshold —
    // that product sits above even a broad build's square-on reading.
    expect(config.frontViewFullBilateralSpreadRatio).toBeGreaterThan(BSR_DEAD_ON_FRONT_NARROW)
    expect(config.frontViewFullBilateralSpreadRatio).toBeLessThan(BSR_DEAD_ON_FRONT_BROAD)
    expect(2 * config.frontViewMinBilateralSpreadRatio).toBeGreaterThan(BSR_DEAD_ON_FRONT_BROAD)

    // Side SER: this repo's own side-view clips measure 1.574 (Demo 1) to 1.792 (multiperson), so
    // the full-support point sits inside the reachable range — Demo 1 falls just short of it and
    // multiperson exceeds it. This is the one endpoint that happens to equal twice its threshold,
    // which is why the old implicit rule looked serviceable when read off this signal alone.
    expect(config.sideViewFullSagittalExcursionRatio).toBeGreaterThan(MEASURED.demo1.ser)
    expect(config.sideViewFullSagittalExcursionRatio).toBeLessThan(MEASURED.multiperson.ser)

    // Every threshold sits strictly on the far side of its own full-support point, so no margin is
    // a step function or a divide-by-zero. The two zero-valued points are exact, so the check for
    // them is that their thresholds are positive.
    expect(config.frontViewMinBilateralSpreadRatio).toBeLessThan(
      config.frontViewFullBilateralSpreadRatio,
    )
    expect(config.sideViewMinSagittalExcursionRatio).toBeLessThan(
      config.sideViewFullSagittalExcursionRatio,
    )
    expect(config.sideViewMaxBilateralSpreadRatio).toBeGreaterThan(0)
    expect(config.frontViewMaxSagittalExcursionRatio).toBeGreaterThan(0)
  })

  it('scores the three test clips’ own measured signals comparably across labels', () => {
    // The live numbers this fix was measured against. Before it the front clip read 0.0771 against
    // 0.7615 and 0.7531 for the two side clips — a tenfold gap produced entirely by the
    // unreachable saturation point, on a clip whose own geometry rules side out twice over. The
    // two side readings are unchanged to the last digit: nothing in the side direction moved.
    const demo1 = detectView(framesWithSignals(MEASURED.demo1.bsr, MEASURED.demo1.ser))
    const demo2 = detectView(framesWithSignals(MEASURED.demo2.bsr, MEASURED.demo2.ser))
    const multiperson = detectView(
      framesWithSignals(MEASURED.multiperson.bsr, MEASURED.multiperson.ser),
    )

    expect(demo1.view).toBe('side')
    expect(demo2.view).toBe('front')
    expect(multiperson.view).toBe('side')

    expect(demo1.confidence).toBeCloseTo(0.7615, 4)
    expect(multiperson.confidence).toBeCloseTo(0.7531, 4)
    expect(demo2.confidence).toBeCloseTo(0.5343, 4)

    // The comparability claim as a ratio rather than a pair of remembered numbers: the front clip
    // is no longer an order of magnitude adrift of the side ones.
    expect(demo2.confidence / demo1.confidence).toBeGreaterThan(0.5)
  })
})
