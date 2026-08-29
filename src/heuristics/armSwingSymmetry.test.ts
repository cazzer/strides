import { describe, expect, it } from 'vitest'
import { computeArmSwingSymmetry } from './armSwingSymmetry'
import { buildFrame } from './__fixtures__/testFrames'
import { findLocalExtrema } from './extrema'
import { DEFAULT_HEURISTICS_CONFIG } from './types'
import type { RobustPoseFrame } from '../pose/robustness/types'

/**
 * Fixed torso length matching syntheticGait.ts's own convention (shoulder-mid to hip-mid = 150px)
 * so amplitude-vs-prominence-threshold math stays consistent with the rest of this codebase's
 * fixtures.
 */
const TORSO_LENGTH_PX = 150
const SHOULDER_Y = 250
const HIP_Y = SHOULDER_Y + TORSO_LENGTH_PX
const LEFT_SHOULDER_X = 170
const RIGHT_SHOULDER_X = 230
const LEFT_HIP_X = 175
const RIGHT_HIP_X = 225
/** Resting wrist-below-shoulder offset — an arbitrary but plausible carried-arm position; only
 * the OSCILLATION around it (see below) is what the metric measures. */
const BASE_WRIST_OFFSET_Y = 80

/**
 * Deterministic, seedable jitter, so a noise fixture is reproducible run to run — a randomly-seeded
 * one would make a threshold test flaky in exactly the regime it exists to pin down. Mulberry32.
 */
function makeJitter(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let x = Math.imul(state ^ (state >>> 15), 1 | state)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    // Symmetric about 0, in [-1, 1).
    return (((x ^ (x >>> 14)) >>> 0) / 4294967296) * 2 - 1
  }
}

/**
 * Builds a `RobustPoseFrame[]` with a resolvable torso (shoulders+hips) and each wrist oscillating
 * in y relative to its own shoulder — the exact signal `computeArmSwingSymmetry` reads. Left and
 * right swing in opposite phase (natural contralateral arm swing), each with its own configurable
 * amplitude so symmetric and asymmetric cases are both constructible from the same generator.
 *
 * With `harmonicRatio` and the two jitter knobs left at their `0` defaults each side is an exact
 * sinusoid whose peak-to-trough excursion is exactly that side's `amplitudePx`, so the expected
 * per-side fitted amplitude is hand-computable — and, since the metric reports a RATIO of two
 * amplitudes measured in the same pixel space, the expected value is simply
 * `min(left, right) / max(left, right)` with no torso-length term in it at all.
 */
function buildArmSwingFrames(params: {
  durationSec: number
  fps: number
  swingFreqHz: number
  leftAmplitudePx: number
  rightAmplitudePx: number
  /** Peak per-frame tracking jitter added to each wrist's y, px. Models what a real detector does
   * to this series; `0` (the default) keeps every pre-existing case an exact sinusoid. */
  leftJitterPx?: number
  rightJitterPx?: number
  /**
   * Amplitude of a second harmonic at 2x `swingFreqHz`, as a fraction of that side's own
   * amplitude. This is the STEP rhythm riding on the stride rhythm, and it is real rather than
   * decorative: the shoulder itself rises and falls once per step, and it does not cancel out of a
   * wrist-relative-to-shoulder trace cleanly. Live evidence that these traces carry it — the
   * multi-person clip's right-arm fit lands on 2.80 Hz against a 174 spm cadence (2.90 Hz step
   * rate), and Demo 2's right arm reports `secondPeakRatio` 0.31.
   */
  harmonicRatio?: number
  seed?: number
}): RobustPoseFrame[] {
  const {
    durationSec,
    fps,
    swingFreqHz,
    leftAmplitudePx,
    rightAmplitudePx,
    leftJitterPx = 0,
    rightJitterPx = 0,
    harmonicRatio = 0,
    seed = 1,
  } = params
  const frameCount = Math.round(durationSec * fps)
  const jitter = makeJitter(seed)

  const frames: RobustPoseFrame[] = []
  for (let i = 0; i < frameCount; i += 1) {
    const t = i / fps
    const phase = 2 * Math.PI * swingFreqHz * t
    const harmonic = 2 * Math.PI * 2 * swingFreqHz * t
    const leftWristY =
      SHOULDER_Y +
      BASE_WRIST_OFFSET_Y -
      (leftAmplitudePx / 2) * Math.sin(phase) +
      ((leftAmplitudePx * harmonicRatio) / 2) * Math.sin(harmonic) +
      jitter() * leftJitterPx
    const rightWristY =
      SHOULDER_Y +
      BASE_WRIST_OFFSET_Y -
      (rightAmplitudePx / 2) * Math.sin(phase + Math.PI) +
      ((rightAmplitudePx * harmonicRatio) / 2) * Math.sin(harmonic) +
      jitter() * rightJitterPx

    frames.push(
      buildFrame(
        {
          left_shoulder: { x: LEFT_SHOULDER_X, y: SHOULDER_Y },
          right_shoulder: { x: RIGHT_SHOULDER_X, y: SHOULDER_Y },
          left_hip: { x: LEFT_HIP_X, y: HIP_Y },
          right_hip: { x: RIGHT_HIP_X, y: HIP_Y },
          left_wrist: { x: LEFT_SHOULDER_X, y: leftWristY },
          right_wrist: { x: RIGHT_SHOULDER_X, y: rightWristY },
        },
        t,
      ),
    )
  }
  return frames
}

const BASE_PARAMS = {
  durationSec: 4,
  fps: 30,
  swingFreqHz: 1.5,
}

describe('computeArmSwingSymmetry', () => {
  it('a clean front-view clip with symmetric swing: ratio close to 1, primary view, high confidence', () => {
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
    })

    const result = computeArmSwingSymmetry(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(1, 1)
    expect(result.unit).toBe('percent')
    expect(result.viewFit).toBe('primary')
    expect(result.sampleSize).toBeGreaterThanOrEqual(4)
    expect(result.frameCoverage).toBe(1)
    // viewFitMultiplier 1, frameCoverage 1, interpolatedFraction 0, sampleSize well over the
    // minimum (capped at 1) -> confidence at or very near 1.
    expect(result.confidence).toBeGreaterThan(0.9)
    expect(result.caveat).toBeNull()
  })

  it('a genuinely asymmetric clip scores meaningfully lower than an otherwise-identical symmetric one', () => {
    const symmetric = computeArmSwingSymmetry(
      buildArmSwingFrames({
        ...BASE_PARAMS,
        leftAmplitudePx: 40,
        rightAmplitudePx: 40,
      }),
      'front',
    )
    const asymmetric = computeArmSwingSymmetry(
      buildArmSwingFrames({
        ...BASE_PARAMS,
        leftAmplitudePx: 40,
        rightAmplitudePx: 10,
      }),
      'front',
    )

    expect(symmetric.value).not.toBeNull()
    expect(asymmetric.value).not.toBeNull()
    // Expected: symmetric ~= 1, asymmetric ~= 10/40 = 0.25.
    expect(asymmetric.value as number).toBeLessThan(symmetric.value as number)
    expect(asymmetric.value).toBeCloseTo(0.25, 1)
    expect(asymmetric.value as number).toBeLessThan(0.5)
  })

  it('a side-view clip: still computed (never withheld), viewFit unsuitable, confidence capped near the 0.1 multiplier', () => {
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
    })

    const result = computeArmSwingSymmetry(frames, 'side')

    expect(result.value).not.toBeNull() // still computed, per "never a silent wrong number"
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.15)
    expect(result.caveat).toContain('side view')
  })

  it('an ambiguous-view clip: still computed, viewFit unsuitable, confidence capped near the 0.2 multiplier', () => {
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 40,
    })

    const result = computeArmSwingSymmetry(frames, 'ambiguous')

    expect(result.value).not.toBeNull()
    expect(result.viewFit).toBe('unsuitable')
    expect(result.confidence).toBeLessThan(0.25)
    expect(result.caveat).toContain('ambiguous view')
  })

  it('no resolvable wrist position: null value, 0 confidence, no crash', () => {
    // Shoulders/hips resolve (body scale is fine) but wrists never do.
    const frame = buildFrame({
      left_shoulder: { x: LEFT_SHOULDER_X, y: SHOULDER_Y },
      right_shoulder: { x: RIGHT_SHOULDER_X, y: SHOULDER_Y },
      left_hip: { x: LEFT_HIP_X, y: HIP_Y },
      right_hip: { x: RIGHT_HIP_X, y: HIP_Y },
    })
    const frames = Array.from({ length: 10 }, () => frame)

    expect(() => computeArmSwingSymmetry(frames, 'front')).not.toThrow()
    const result = computeArmSwingSymmetry(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.caveat).toContain('No resolvable shoulder/wrist position')
  })

  it('tracked but motionless arms: no complete swing cycle detected, null value, no crash', () => {
    // Wrists resolve every frame but never move relative to the shoulder -- no prominence-
    // clearing extremum, so there is no computable amplitude on either side.
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 0,
      rightAmplitudePx: 0,
    })

    expect(() => computeArmSwingSymmetry(frames, 'front')).not.toThrow()
    const result = computeArmSwingSymmetry(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toContain('no oscillating vertical motion')
  })

  it('returns a null value and 0 confidence when no keypoint resolves at all', () => {
    const frame = buildFrame({})
    const result = computeArmSwingSymmetry([frame, frame], 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).not.toBeNull()
  })

  it('measures a clip with no resolvable torso: the ratio is scale-free, so body scale is not required', () => {
    // Shoulders and wrists resolve; HIPS never do, so `estimateBodyScale` has nothing to measure.
    // The previous estimator needed a torso length only to size an extrema-prominence threshold,
    // and returned null here on a quantity it could perfectly well have measured.
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 20,
    }).map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === 'left_hip' || kp.name === 'right_hip'
          ? { ...kp, x: null, y: null, score: 0, status: 'unrecoverable' as const }
          : kp,
      ),
    }))

    const result = computeArmSwingSymmetry(frames, 'front')

    expect(result.value).not.toBeNull()
    expect(result.value).toBeCloseTo(0.5, 1)
  })
})

/**
 * The defect bead `strides-gzl` names: at a prominence floor sized in pixels, ordinary tracking
 * jitter confirms extrema BETWEEN the real turning points, so the paired "half-swings" span a
 * fraction of a half-cycle and their median amplitude is a statistic over wiggle rather than over
 * swing. Measured on Demo 2 before the fix: 9 confirmed half-swings per side across a window
 * holding ~2.4 arm-swing cycles (so ~5 real half-swings), spaced as little as 0.050 s against a
 * 0.331 s half-cycle.
 *
 * These cases pin the fix against a fixture whose true half-cycle is known exactly, and the first
 * one asserts the old failure still reproduces in the primitive that caused it — so this is a
 * regression test for a mechanism, not just for today's numbers.
 */
describe('computeArmSwingSymmetry — sub-cycle wiggle (strides-gzl)', () => {
  /**
   * A stride-rate swing carrying a step-rate harmonic and modest tracking jitter — the shape a
   * real wrist-relative-to-shoulder trace actually has, rather than the exact sinusoid every case
   * above uses.
   */
  const REALISTIC = {
    durationSec: 4,
    fps: 30,
    swingFreqHz: 1.5,
    leftAmplitudePx: 40,
    rightAmplitudePx: 20,
    leftJitterPx: 4,
    rightJitterPx: 4,
    harmonicRatio: 0.4,
    seed: 20260829,
  }
  /** One swing cycle is 1/1.5 s, so top-to-bottom is half that. */
  const HALF_CYCLE_SEC = 1 / (2 * REALISTIC.swingFreqHz)

  it('the retired prominence-threshold scan pairs extrema that are not half a cycle apart', () => {
    const frames = buildArmSwingFrames(REALISTIC)
    // Exactly what `computeSideSwing` used to do: this series, at the retired
    // `armSwingMinProminenceRatio` (0.03) times the fixture's own 150px torso.
    const series = frames.map((frame) => {
      const at = (name: string) => frame.keypoints.find((kp) => kp.name === name)!.y!
      return { t: frame.timestamp, v: at('left_wrist') - at('left_shoulder') }
    })
    const extrema = findLocalExtrema(series, 0.03 * TORSO_LENGTH_PX)

    const gaps: number[] = []
    for (let i = 1; i < extrema.length; i += 1) {
      if (extrema[i].kind !== extrema[i - 1].kind) {
        gaps.push(Math.abs(extrema[i].timestamp - extrema[i - 1].timestamp))
      }
    }

    // The harmonic drags every confirmed turning point off the real half-cycle, alternately early
    // and late — so EVERY pair the scan would hand an exemplar spans the wrong interval, by 20% or
    // more, even though the count of them happens to come out about right. On real footage the
    // count goes wrong too: Demo 2 produced 9 half-swings across ~4.8 real ones, spaced as little
    // as 0.050 s against a 0.331 s half-cycle.
    expect(gaps.length).toBeGreaterThan(0)
    for (const gap of gaps) {
      expect(Math.abs(gap - HALF_CYCLE_SEC) / HALF_CYCLE_SEC).toBeGreaterThan(0.15)
    }
  })

  it('the exemplar pair spans one half-swing, not a sub-cycle wiggle', () => {
    const exemplars = computeArmSwingSymmetry(buildArmSwingFrames(REALISTIC), 'front').exemplars!

    expect(exemplars).toHaveLength(2)
    for (const exemplar of exemplars) {
      const spacing = Math.abs(exemplar.pairedTimestamp! - exemplar.timestamp)
      // Snapping each fitted instant to its nearest sampled frame can move it by up to half a
      // frame interval either way, so the tolerance is the frame interval, not zero.
      expect(spacing).toBeGreaterThan(HALF_CYCLE_SEC - 1 / REALISTIC.fps)
      expect(spacing).toBeLessThan(HALF_CYCLE_SEC + 1 / REALISTIC.fps)
    }
  })

  it('the reported ratio tracks the fixture’s real amplitude ratio despite the jitter', () => {
    const result = computeArmSwingSymmetry(buildArmSwingFrames(REALISTIC), 'front')

    expect(result.value).toBeCloseTo(20 / 40, 1)
  })

  it('a rhythm mismatch between the two arms is not reported as an asymmetry', () => {
    // The right arm oscillates at a different rate from the left — physically impossible for one
    // body, so at least one fit has found something that is not the arm swing. Measured live on
    // `multiperson-track.mp4`: left 1.48Hz, right 2.80Hz (the step rhythm), both clearing the R²
    // gate, and the 0.349 ratio between them was a comparison of two different oscillations.
    const left = buildArmSwingFrames({
      ...BASE_PARAMS,
      swingFreqHz: 1.5,
      leftAmplitudePx: 40,
      rightAmplitudePx: 0,
    })
    const right = buildArmSwingFrames({
      ...BASE_PARAMS,
      swingFreqHz: 3.0,
      leftAmplitudePx: 0,
      rightAmplitudePx: 40,
    })
    const merged = left.map((frame, i) => ({
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === 'right_wrist'
          ? right[i].keypoints.find((other) => other.name === 'right_wrist')!
          : kp,
      ),
    }))

    const result = computeArmSwingSymmetry(merged, 'front')

    expect(result.value).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.caveat).toContain('not comparable')
  })

  it('a swing rhythm too irregular to fit on one arm yields null, never a fabricated asymmetry', () => {
    // The left arm swings cleanly; the right arm is jitter with no rhythm in it at all. An
    // estimator that reads *some* amplitude off the right arm reports a confident, entirely
    // fictional asymmetry.
    const frames = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 40,
      rightAmplitudePx: 0,
      rightJitterPx: 20,
      seed: 7,
    })

    const result = computeArmSwingSymmetry(frames, 'front')

    expect(result.value).toBeNull()
    expect(result.caveat).toContain('too irregular to measure')
  })

  it('confidence reads the WORSE-tracked arm, and says so, rather than averaging the two', () => {
    const bothEqual = computeArmSwingSymmetry(buildArmSwingFrames(REALISTIC), 'front')
    // Identical swing on both arms; only the RIGHT arm's tracking is degraded — the near/far-from-
    // camera asymmetry Demo 2 exhibits (left fit R² 0.778, right 0.497 on the same clip, with the
    // weaker-looking arm also the one measured further away).
    const rightArmWorse = computeArmSwingSymmetry(
      buildArmSwingFrames({ ...REALISTIC, rightJitterPx: 9, seed: 42 }),
      'front',
    )

    expect(rightArmWorse.value).not.toBeNull()
    expect(rightArmWorse.confidence).toBeLessThan(bothEqual.confidence * 0.9)
    expect(rightArmWorse.caveat).toContain('tracked noticeably better')
    // Averaging would have hidden this: the LEFT arm's own fit is untouched between the two cases,
    // so a mean of the two sides still reads comfortable.
    expect(bothEqual.caveat ?? '').not.toContain('tracked noticeably better')
  })

  it('below the fit-quality gate the metric publishes nothing, on either arm', () => {
    const frames = buildArmSwingFrames(REALISTIC)

    // The realistic fixture's own fits sit around 0.79-0.84, so a 0.9 gate rejects it — the same
    // shape as a clip whose swing rhythm the detector could not follow.
    const strict = computeArmSwingSymmetry(frames, 'front', {
      ...DEFAULT_HEURISTICS_CONFIG,
      armSwingMinFitR2: 0.9,
    })

    expect(computeArmSwingSymmetry(frames, 'front').value).not.toBeNull()
    expect(strict.value).toBeNull()
    expect(strict.caveat).toContain('too irregular to measure')
  })
})

/**
 * Reads the exact series `computeSideSwing` reads — `wrist.y − shoulder.y` in image-y — at the
 * frame carrying `timestamp`. Image-y grows downward, so a SMALLER value is the wrist higher on
 * screen. The direction assertions below depend on this and on nothing else.
 */
function wristBelowShoulderPx(
  frames: RobustPoseFrame[],
  timestamp: number,
  side: 'left' | 'right',
): number {
  const frame = frames.find((candidate) => candidate.timestamp === timestamp)!
  const at = (name: string) => frame.keypoints.find((kp) => kp.name === name)!.y!
  return at(`${side}_wrist`) - at(`${side}_shoulder`)
}

describe('computeArmSwingSymmetry — exemplars', () => {
  const frames = buildArmSwingFrames({
    ...BASE_PARAMS,
    leftAmplitudePx: 40,
    rightAmplitudePx: 24,
  })

  it('emits one pair per side — the comparison is what makes an asymmetry metric legible', () => {
    const exemplars = computeArmSwingSymmetry(frames, 'front').exemplars!

    expect(exemplars).toHaveLength(2)
    expect(exemplars.map((exemplar) => exemplar.kind)).toEqual([
      'armSwingCycle',
      'armSwingCycle',
    ])
    // One per arm, never two of the same one.
    expect([...exemplars.map((exemplar) => exemplar.side)].sort()).toEqual(['left', 'right'])
    for (const exemplar of exemplars) {
      expect(exemplar.quality).toBeGreaterThanOrEqual(0.5)
      expect(frames.map((frame) => frame.timestamp)).toContain(exemplar.timestamp)
      expect(frames.map((frame) => frame.timestamp)).toContain(exemplar.pairedTimestamp)
    }
  })

  it('the base instant is the wrist HIGH frame, on both sides — the image-y sign trap', () => {
    // `wrist.y − shoulder.y` grows downward, so the series MINIMUM is the wrist at its highest.
    // Reading the extremum kind straight through would caption every one of these backwards while
    // passing every other assertion in this file.
    for (const exemplar of computeArmSwingSymmetry(frames, 'front').exemplars!) {
      const side = exemplar.side!
      expect(wristBelowShoulderPx(frames, exemplar.timestamp, side)).toBeLessThan(
        wristBelowShoulderPx(frames, exemplar.pairedTimestamp!, side),
      )
    }
  })

  it('the pair spans that side’s full swing amplitude, not some smaller excursion', () => {
    for (const exemplar of computeArmSwingSymmetry(frames, 'front').exemplars!) {
      const side = exemplar.side!
      const spanned =
        wristBelowShoulderPx(frames, exemplar.pairedTimestamp!, side) -
        wristBelowShoulderPx(frames, exemplar.timestamp, side)
      // The fixture builds each side's peak-to-trough excursion as exactly `amplitudePx`; discrete
      // 30fps sampling can only land at or just inside that.
      const amplitudePx = side === 'left' ? 40 : 24
      expect(spanned).toBeGreaterThan(amplitudePx * 0.9)
      expect(spanned).toBeLessThanOrEqual(amplitudePx)
    }
  })

  it('seeds the crop on that side’s own shoulder and wrist, dropping context that resolves nowhere', () => {
    for (const exemplar of computeArmSwingSymmetry(frames, 'front').exemplars!) {
      const side = exemplar.side!
      // The elbow is context (design D2) and this fixture never resolves one, so it is omitted
      // rather than anchoring the crop at a keypoint with no position.
      expect(exemplar.cropKeypoints).toEqual([`${side}_shoulder`, `${side}_wrist`])
    }
  })

  it('adds the elbow to the crop when it actually resolves', () => {
    const withElbows = frames.map((frame) => ({
      ...frame,
      keypoints: frame.keypoints.map((kp) =>
        kp.name === 'left_elbow' || kp.name === 'right_elbow'
          ? { ...kp, x: 200, y: 300, score: 0.9, status: 'detected' as const }
          : kp,
      ),
    }))

    for (const exemplar of computeArmSwingSymmetry(withElbows, 'front').exemplars!) {
      const side = exemplar.side!
      expect(exemplar.cropKeypoints).toEqual([
        `${side}_shoulder`,
        `${side}_wrist`,
        `${side}_elbow`,
      ])
    }
  })

  it('emits nothing when the metric reports no value', () => {
    const flat = buildArmSwingFrames({
      ...BASE_PARAMS,
      leftAmplitudePx: 0,
      rightAmplitudePx: 0,
    })

    const result = computeArmSwingSymmetry(flat, 'front')

    expect(result.value).toBeNull()
    expect(result.exemplars).toBeUndefined()
  })
})
